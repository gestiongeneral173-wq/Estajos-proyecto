import { supabase } from '../supabase.js'
import { listarTrabajadores } from './workers.js'
import { getJornadasTrabajadorPorPeriodo, getAdelantosPendientes, ejecutarPago } from './records.js'

/**
 * ─── LISTA DE PAGO (Cambio 1.4.1 · revisado en la Décima entrega) ───────
 * Agrupa a empleados quincenales para entregar el efectivo a un tercero.
 *
 * Cambio Décima: se elimina el estado intermedio pendiente/confirmada. Al
 * generar la lista, el pago se ejecuta de inmediato (cada item dispara
 * `ejecutar_pago`, la misma RPC de Escanear) y se guarda el nombre del
 * encargado que reparte el efectivo. Aplica solo al ciclo quincenal.
 */

// Mismo cálculo de período que EscanearPage, pero por ciclo (no por
// empleado individual) — 1-15 / 16-fin de mes para quincenal, mes
// calendario completo para mensual.
export function calcularPeriodoCiclo(ciclo, fechaRef = new Date()) {
  const year = fechaRef.getFullYear()
  const month = fechaRef.getMonth()
  const day = fechaRef.getDate()

  if (ciclo === 'quincenal') {
    const inicio = day <= 15
      ? new Date(year, month, 1).toISOString().slice(0, 10)
      : new Date(year, month, 16).toISOString().slice(0, 10)
    const fin = day <= 15
      ? new Date(year, month, 15).toISOString().slice(0, 10)
      : new Date(year, month + 1, 0).toISOString().slice(0, 10)
    return { inicio, fin, label: `${day <= 15 ? '1-15' : '16-fin'} ${fechaRef.toLocaleString('es-ES', { month: 'short', year: '2-digit' })}` }
  }
  return {
    inicio: new Date(year, month, 1).toISOString().slice(0, 10),
    fin:    new Date(year, month + 1, 0).toISOString().slice(0, 10),
    label:  fechaRef.toLocaleString('es-ES', { month: 'long', year: 'numeric' })
  }
}

// Trae los empleados del ciclo con sus jornadas y adelantos pendientes del
// período activo, y los totales ya calculados (horas·tarifa + destajo −
// adelantos). Base de datos compartida por la Planilla (1.4.2) y la Lista
// de Pago (1.4.1): ambas muestran exactamente los mismos números.
export async function getDatosCicloParaPago(ciclo) {
  const periodo = calcularPeriodoCiclo(ciclo)
  const empleados = await listarTrabajadores({ periodo: ciclo })

  const conDatos = await Promise.all(
    empleados.map(async (e) => {
      const [jornadas, adelantos] = await Promise.all([
        getJornadasTrabajadorPorPeriodo(e.id, periodo.inicio, periodo.fin),
        getAdelantosPendientes(e.id, periodo.inicio, periodo.fin),
      ])
      const totalHoras   = jornadas.reduce((s, j) => s + Number(j.horas), 0)
      // Cada jornada usa SU tarifa (snapshot al crearse), no la tarifa
      // actual del empleado — así coincide con lo que ejecutar_pago_empleado
      // realmente cobra si hubo un aumento a mitad de ciclo.
      const totalDevengado = jornadas.reduce(
        (s, j) => s + Number(j.horas) * (j.tarifa ?? e.tarifa_hora ?? 0) + Number(j.destajo), 0
      )
      const totalAdelantos = adelantos.reduce((s, a) => s + Number(a.monto), 0)
      return {
        ...e,
        jornadas,
        adelantos,
        totalHoras,
        totalDevengado,
        totalAdelantos,
        totalPagar: totalDevengado - totalAdelantos,
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
// items: [{ empleadoId, totalDevengado, totalAdelantos, totalPagar }]
export async function generarListaPago({ ciclo, periodo, items, encargado }) {
  if (!items.length) throw new Error('Selecciona al menos un empleado.')
  if (!encargado || !encargado.trim()) throw new Error('Ingresa el nombre del encargado.')

  const liquidados = []
  for (const i of items) {
    const pago = await ejecutarPago({
      empleadoId: i.empleadoId,
      periodoInicio: periodo.inicio,
      periodoFin: periodo.fin,
    })
    liquidados.push({ ...i, totalPagar: pago.total_pagado })
  }

  const totalMonto = liquidados.reduce((s, i) => s + i.totalPagar, 0)

  const { data: lista, error: errLista } = await supabase
    .from('lista_pago_quincenal')
    .insert({
      ciclo,
      periodo_inicio: periodo.inicio,
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
// impresión (columnas de la planilla). Solo válido mientras la lista está
// `pendiente`: al confirmar, `ejecutar_pago` cierra las jornadas
// (`pagado_en`) y dejan de aparecer en `getJornadasTrabajadorPorPeriodo`.
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
      ? await getJornadasTrabajadorPorPeriodo(it.empleado.id, lista.periodo_inicio, lista.periodo_fin)
      : [],
  })))
}

