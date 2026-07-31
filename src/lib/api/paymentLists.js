import { supabase } from '../supabase.js'
import { listarTrabajadores, promoverTipoPagoPendiente } from './workers.js'
import {
  getJornadasTrabajadorPorPeriodo, getAdelantosPendientes, ejecutarPago,
  getJornadasTrabajadorHistorico,
} from './records.js'
import { calcularPeriodoCiclo } from './ciclos.js'

/**
 * ─── LISTA DE PAGO (Cambio 1.4.1 · revisado en la Décima entrega) ───────
 * Agrupa a empleados quincenales para entregar el efectivo a un tercero.
 *
 * Cambio Décima: se elimina el estado intermedio pendiente/confirmada. Al
 * generar la lista, el pago se ejecuta de inmediato (cada item dispara
 * `ejecutar_pago`, la misma RPC de Escanear) y se guarda el nombre del
 * encargado que reparte el efectivo. Aplica solo al ciclo quincenal.
 */

// Trae los empleados del ciclo con sus jornadas y adelantos pendientes
// HASTA el fin del período activo (sin límite inferior — ver
// getJornadasTrabajadorPorPeriodo), y los totales ya calculados
// (horas·tarifa + destajo − adelantos). Base de datos compartida por la
// Planilla (1.4.2) y la Lista de Pago (1.4.1): ambas muestran exactamente
// los mismos números.
//
// Arrastre de ciclos cerrados sin pagar: si un empleado tiene jornadas o
// adelantos de ANTES del inicio oficial del ciclo (un ciclo anterior que se
// cerró sin liquidarle), igual entran aquí — así el admin los ve y los paga
// junto con el ciclo activo, en vez de quedar invisibles para siempre. Por
// eso se calcula `periodoInicioReal`: la fecha más antigua realmente
// pendiente de este empleado (o el inicio oficial si no hay arrastre). Es la
// que se le debe pasar a `ejecutarPago` — el RPC del servidor solo liquida
// lo que cae en `[p_inicio, p_fin]`, así que si aquí se le cobra al admin
// ese arrastre pero al pagar se le manda el inicio oficial (más tarde), esos
// días viejos nunca se marcarían como liquidados en el servidor.
export async function getDatosCicloParaPago(ciclo) {
  const periodo = calcularPeriodoCiclo(ciclo)
  const empleados = await listarTrabajadores({ periodo: ciclo })

  const conDatos = await Promise.all(
    empleados.map(async (e) => {
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
      const periodoInicioReal = fechas.length ? [...fechas, periodo.inicio].sort()[0] : periodo.inicio

      // Bloqueo de pago anticipado: solo se desbloquea si hay arrastre —
      // algo fechado antes del inicio del bloque activo, es decir, de un
      // bloque que YA cerró y tiene derecho a cobrarse ya. Si todo lo
      // pendiente es del bloque en curso (periodoInicioReal === inicio),
      // sigue bloqueado hasta que ese bloque llegue a su día de pago — lo
      // cual pasa solo (sin ninguna comparación de fecha aparte): en cuanto
      // el bloque activo avance, esas mismas fechas quedan antes del nuevo
      // inicio y se vuelven arrastre.
      const puedePagar = periodoInicioReal < periodo.inicio

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
      periodoFin: periodo.fin,
    })
    // Justo después de un pago exitoso: si este empleado tenía un cambio de
    // periodicidad pendiente, aquí es donde entra en vigor (ver 2.1).
    await promoverTipoPagoPendiente(i.empleadoId)
    liquidados.push({ ...i, totalPagar: pago.total_pagado })
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
    })))
  if (errItems) throw new Error(errItems.message)

  return lista
}

export async function listarListasPago() {
  const { data, error } = await supabase
    .from('lista_pago_quincenal')
    .select('id, ciclo, periodo_inicio, periodo_fin, total_monto:monto_total, encargado, created_at')
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

