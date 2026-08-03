import { supabase } from '../supabase.js'
import { listarTrabajadores, promoverTipoPagoPendiente } from './workers.js'
import {
  getJornadasTrabajadorPorPeriodo, getAdelantosPendientes, ejecutarPago,
  getJornadasTrabajadorHistorico, getCicloActivoAPagar,
} from './records.js'

/**
 * ─── LISTA DE PAGO (Cambio 1.4.1 · revisado en la Décima entrega) ───────
 * Agrupa a empleados quincenales para entregar el efectivo a un tercero.
 *
 * Cambio Décima: se elimina el estado intermedio pendiente/confirmada. Al
 * generar la lista, el pago se ejecuta de inmediato (cada item dispara
 * `ejecutar_pago`, la misma RPC de Escanear) y se guarda el nombre del
 * encargado que reparte el efectivo. Aplica solo al ciclo quincenal.
 */

// Trae los empleados del CICLO A PAGAR (candado global, ver
// getCicloActivoAPagar — nunca "el ciclo de hoy") con sus jornadas y
// adelantos pendientes hasta el fin de ESE ciclo, y los totales ya
// calculados (horas·tarifa + destajo − adelantos). Base de datos
// compartida por la Planilla (1.4.2) y la Lista de Pago (1.4.1): ambas
// muestran exactamente los mismos números.
export async function getDatosCicloParaPago(ciclo) {
  const periodo = await getCicloActivoAPagar(ciclo)

  // Nada pendiente de ningún ciclo de este tipo_pago: no hay período que
  // mostrar ni empleados que listar.
  if (!periodo) return { periodo: null, empleados: [] }

  const empleados = await listarTrabajadores({ periodo: ciclo })

  const conDatos = await Promise.all(
    empleados.map(async (e) => {
      // periodo.fin ya es el fin exacto del ciclo a pagar (el más viejo con
      // algo pendiente en TODA la nómina) — un empleado sin nada dentro de
      // ese rango simplemente no tiene nada que cobrar todavía, aunque
      // tenga trabajo más reciente en un ciclo posterior (queda bloqueado
      // hasta que este ciclo se liquide para todos).
      const [jornadas, adelantos] = await Promise.all([
        getJornadasTrabajadorPorPeriodo(e.id, null, periodo.fin),
        getAdelantosPendientes(e.id, null, periodo.fin),
      ])
      const totalHoras   = jornadas.reduce((s, j) => s + Number(j.horas), 0)
      // Cada jornada usa SU tarifa (snapshot al crearse), no la tarifa
      // actual del empleado — así coincide con lo que ejecutar_pago_empleado
      // realmente cobra si hubo un aumento a mitad de ciclo.
      const totalDevengado = jornadas.reduce(
        (s, j) => s + Number(j.horas) * (j.tarifa ?? e.tarifa_hora ?? 0) + Number(j.destajo), 0
      )
      const totalAdelantos = adelantos.reduce((s, a) => s + Number(a.monto), 0)

      const fechas = [...jornadas.map((j) => j.fecha), ...adelantos.map((a) => a.fecha)].filter(Boolean)
      const periodoInicioReal = fechas.length ? fechas.sort()[0] : periodo.inicio

      // Bloqueo de pago anticipado: como jornadas/adelantos ya vienen
      // acotados a fecha ≤ finArrastre (ciclos cerrados), basta con que
      // exista algo para que sea pagable — ya no hace falta comparar contra
      // periodo.inicio.
      const puedePagar = fechas.length > 0

      return {
        ...e,
        jornadas,
        adelantos,
        totalHoras,
        totalDevengado,
        totalAdelantos,
        totalPagar: totalDevengado - totalAdelantos,
        periodoInicioReal,
        puedePagar,
      }
    })
  )
  return { periodo, empleados: conDatos }
}

/* ─── CRUD de listas_pago ──────────────────────────────────────────── */

// Genera la lista y ejecuta el pago en un solo paso (Cambio Décima: sin
// estado pendiente). Registra el `encargado` (texto libre) que reparte el
// efectivo y dispara `ejecutarPago` por cada empleado (cierra sus jornadas y
// descuenta los adelantos del ciclo) **antes** de grabar `lista_pago_detalle`,
// usando el `total_pagado` que la RPC realmente liquidó — no el cálculo
// hecho en el navegador, que podía divergir (un adelanto registrado un
// segundo antes del clic, una jornada que entró en el ínterin).
//
// No es atómico entre items: si un pago falla a la mitad, los anteriores ya
// quedaron liquidados y la lista queda registrada — se informa el error para
// revisar. Mismo caveat que tenía la antigua confirmación de lista.
//
// items: [{ empleadoId, totalDevengado, totalAdelantos, totalPagar, periodoInicio }]
// `periodoInicio` es el `periodoInicioReal` por empleado que devuelve
// getDatosCicloParaPago (arrastre incluido) — nunca el inicio oficial del
// ciclo a secas, o el RPC dejaría sin liquidar los días arrastrados que ya
// se le cobraron al admin en pantalla.
export async function generarListaPago({ ciclo, periodo, items, encargado }) {
  if (!items.length) throw new Error('Selecciona al menos un empleado.')
  if (!encargado || !encargado.trim()) throw new Error('Ingresa el nombre del encargado.')

  const liquidados = []
  for (const i of items) {
    const pago = await ejecutarPago({
      empleadoId: i.empleadoId,
      periodoInicio: i.periodoInicio ?? periodo.inicio,
      // periodo.fin: aquí `periodo` ya ES el ciclo específico a pagar
      // (getCicloActivoAPagar), nunca "el ciclo de hoy" — liquida
      // exactamente ese rango, nada más nuevo.
      periodoFin: periodo.fin,
    })
    // Justo después de un pago exitoso: si este empleado tenía un cambio de
    // periodicidad pendiente, aquí es donde entra en vigor (ver 2.1).
    // `tipoPagoAnterior` (null si no había nada que promover) se guarda en
    // el detalle de la lista — es lo único que le permite a
    // `cancelar_lista_pago` restaurar el ciclo viejo si esta lista se
    // cancela más tarde (ver promoverTipoPagoPendiente en workers.js).
    const tipoPagoAnterior = await promoverTipoPagoPendiente(i.empleadoId)
    liquidados.push({ ...i, totalPagar: pago.total_pagado, tipoPagoAnterior })
  }

  const totalMonto = liquidados.reduce((s, i) => s + i.totalPagar, 0)

  // El inicio guardado en la lista se ensancha al más antiguo realmente
  // usado entre sus items (arrastre incluido) — nunca el oficial a secas.
  // Si se guardara siempre el oficial, reimprimir esta lista más tarde
  // (getItemsListaPagoConJornadas, acotado a este mismo rango) dejaría
  // fuera los días arrastrados de cualquier empleado que los tuviera,
  // aunque su `total_pagado` sí los haya incluido.
  const periodoInicioLista = liquidados.reduce(
    (min, i) => (i.periodoInicio && i.periodoInicio < min ? i.periodoInicio : min),
    periodo.inicio
  )

  const { data: lista, error: errLista } = await supabase
    .from('lista_pago_quincenal')
    .insert({
      ciclo,
      periodo_inicio: periodoInicioLista,
      periodo_fin: periodo.fin,
      monto_total: totalMonto,
      encargado: encargado.trim(),
    })
    .select().single()
  if (errLista) throw new Error(errLista.message)

  const { error: errItems } = await supabase
    .from('lista_pago_detalle')
    .insert(liquidados.map((i) => ({
      lista_pago_quincenal_id: lista.id,
      empleado_id: i.empleadoId,
      total_devengado: i.totalDevengado,
      total_adelantos: i.totalAdelantos,
      monto_incluido: i.totalPagar,
      tipo_pago_anterior: i.tipoPagoAnterior,
    })))
  if (errItems) throw new Error(errItems.message)

  return lista
}

export async function listarListasPago() {
  const { data, error } = await supabase
    .from('lista_pago_quincenal')
    .select('id, ciclo, periodo_inicio, periodo_fin, total_monto:monto_total, encargado, created_at')
    .eq('oculta', false)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getItemsListaPago(listaId) {
  const { data, error } = await supabase
    .from('lista_pago_detalle')
    .select('id, total_devengado, total_adelantos, total_pagado:monto_incluido, empleado:empleado_id(id, nombre:nombre_completo, tarifa_hora:pago_x_hora)')
    .eq('lista_pago_quincenal_id', listaId)
  if (error) throw new Error(error.message)
  return data ?? []
}

// Mismos items, con el detalle día-por-día de cada empleado para la
// impresión (columnas de la planilla). Esta lista ya fue pagada al
// generarse (Cambio Décima: no hay estado "pendiente"), así que sus
// jornadas ya están `fue_liquidado = true` — se reconstruyen por fecha con
// getJornadasTrabajadorHistorico, no con la función de "pendientes".
// `lista.periodo_inicio` ya viene ensanchado al arrastre real de cada
// item (ver generarListaPago), así que este rango cubre exactamente lo
// que se pagó, sin dejar días fuera.
// Revierte una lista ya pagada: RPC `cancelar_lista_pago` (atómica en el
// servidor, simétrica a ejecutar_pago_empleado). Por cada empleado de la
// lista reabre exactamente el rango de SU pago_empleado (fue_liquidado
// vuelve a false en jornadas/adelantos) y borra ese pago; también restaura
// `tipo_pago`/`tipo_pago_pendiente` si esta lista había disparado una
// promoción de ciclo (ver tipo_pago_anterior en generarListaPago). Al final
// borra lista_pago_detalle + lista_pago_quincenal. El caller debe recargar
// listas/ciclo/stats después (mismo trío que tras generar una lista).
export async function cancelarListaPago(listaId) {
  const { error } = await supabase.rpc('cancelar_lista_pago', { p_lista_id: listaId })
  if (error) throw new Error(error.message)
}

// "Ocultar" (2026-08-02): para una lista de un ciclo ya CONFIRMADO/
// archivado (ver confirmarCicloPagado en records.js) — a diferencia de
// cancelarListaPago, esto NO revierte el pago (las jornadas/adelantos
// siguen liquidados) ni borra la lista, solo deja de mostrarla en
// "Listas generadas". Evita que cancelar algo de un ciclo ya dado por
// cerrado haga "resucitar" ese ciclo como pendiente otra vez.
export async function ocultarListaPago(listaId) {
  const { error } = await supabase.rpc('ocultar_lista_pago', { p_lista_id: listaId })
  if (error) throw new Error(error.message)
}

export async function getItemsListaPagoConJornadas(listaId) {
  const { data: lista, error: errLista } = await supabase
    .from('lista_pago_quincenal').select('periodo_inicio, periodo_fin').eq('id', listaId).single()
  if (errLista) throw new Error(errLista.message)

  const items = await getItemsListaPago(listaId)
  return Promise.all(items.map(async (it) => ({
    ...it,
    // it.empleado puede venir null si el empleado fue eliminado — sin este
    // guard, un solo empleado borrado tumbaba el Promise.all completo y la
    // lista entera dejaba de mostrarse (aunque el resto de items sí tenía datos).
    jornadas: it.empleado
      ? await getJornadasTrabajadorHistorico(it.empleado.id, lista.periodo_inicio, lista.periodo_fin)
      : [],
  })))
}

