import { supabase } from '../supabase.js'
import { calcularPeriodoCiclo } from './ciclos.js'

/**
 * ─── VEHÍCULOS / FURGONETAS (esquema v6.0) ─────────────────
 * Tabla `furgoneta` (apodo/costo_plaza) + `pin_furgoneta` (1:1). Esta capa
 * traduce a la forma que ya usa la app:
 *   furgoneta.apodo        → .nombre
 *   furgoneta.costo_plaza  → .tarifa_plaza
 *   pin_furgoneta.pin      → .pin_actual
 * Plazas del día viven en `jornada_furgoneta` (antes `plazas_vehiculo`);
 * los adelantos en `adelanto_furgoneta`.
 */

const soloFecha = (ts) => (ts ? String(ts).slice(0, 10) : ts)

const SELECT_FURGONETA =
  'id, nombre:apodo, matricula, plazas_totales, tarifa_plaza:costo_plaza, propietario, tipo_pago, tipo_pago_pendiente, pin_furgoneta ( pin, created_at )'

// Aplana el PIN embebido a `pin_actual` y expone `activo: true` sintético
// (v6.0 no tiene borrado lógico).
const mapFurgoneta = (v) => v && {
  id: v.id,
  nombre: v.nombre,
  matricula: v.matricula,
  plazas_totales: v.plazas_totales,
  tarifa_plaza: v.tarifa_plaza,
  propietario: v.propietario,
  tipo_pago: v.tipo_pago,
  tipo_pago_pendiente: v.tipo_pago_pendiente,
  pin_actual: v.pin_furgoneta?.pin,
  pin_actualizado_en: v.pin_furgoneta?.created_at,
  activo: true,
}

// Traduce un payload de la app a las columnas de `furgoneta`. `pin_actual`
// no se guarda aquí (vive en pin_furgoneta, autogenerado por trigger).
function aColumnasFurgoneta(datos) {
  const out = {}
  if ('nombre' in datos)              out.apodo               = datos.nombre
  if ('matricula' in datos)           out.matricula           = datos.matricula?.trim() || null
  if ('tarifa_plaza' in datos)        out.costo_plaza         = datos.tarifa_plaza
  if ('tipo_pago' in datos)           out.tipo_pago           = datos.tipo_pago
  if ('tipo_pago_pendiente' in datos) out.tipo_pago_pendiente = datos.tipo_pago_pendiente
  if ('plazas_totales' in datos)      out.plazas_totales      = datos.plazas_totales
  if ('propietario' in datos)         out.propietario         = datos.propietario?.trim() || null
  return out
}

export async function listarVehiculos() {
  const { data, error } = await supabase
    .from('furgoneta')
    .select(SELECT_FURGONETA)
    .order('apodo')
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapFurgoneta)
}

export async function getVehiculoPorId(id) {
  const { data, error } = await supabase
    .from('furgoneta').select(SELECT_FURGONETA).eq('id', id).single()
  if (error) throw new Error(error.message)
  return mapFurgoneta(data)
}

/* ─── Ciclo global a pagar — Furgonetas ────────────────────────────────
 * Espejo de records.js (ver el comentario largo ahí): candado global por
 * tipo_pago, un ciclo a la vez, con confirmación explícita del admin antes
 * de exponer el siguiente. Dos piezas internas:
 *   - cicloCandidatoPendienteVehiculo: el bloque que contiene la fecha
 *     pendiente más antigua de TODA la flota de ese tipo_pago (null si no
 *     queda nada pendiente).
 *   - cicloSinConfirmarAntesDeVehiculo: un ciclo ya pagado por completo
 *     (fecha_cierre_ciclo) pero que el admin todavía no confirmó en
 *     ciclo_confirmado — si existe, es ese el que hay que seguir
 *     mostrando (el candado no avanza hasta que se confirme).
 */
async function cicloCandidatoPendienteVehiculo(tipoPago) {
  if (tipoPago !== 'quincenal' && tipoPago !== 'mensual') return null

  const [jor, adel] = await Promise.all([
    supabase.from('jornada_furgoneta')
      .select('fecha_trabajo, furgoneta:furgoneta_id!inner(tipo_pago)')
      .eq('fue_liquidado', false)
      .not('fecha_trabajo', 'is', null)
      .eq('furgoneta.tipo_pago', tipoPago)
      .order('fecha_trabajo', { ascending: true })
      .limit(1),
    supabase.from('adelanto_furgoneta')
      .select('fecha_adelanto, furgoneta:furgoneta_id!inner(tipo_pago)')
      .eq('fue_liquidado', false)
      .eq('furgoneta.tipo_pago', tipoPago)
      .order('fecha_adelanto', { ascending: true })
      .limit(1),
  ])
  if (jor.error) throw new Error(jor.error.message)
  if (adel.error) throw new Error(adel.error.message)

  const fechas = [
    soloFecha(jor.data?.[0]?.fecha_trabajo),
    adel.data?.[0]?.fecha_adelanto,
  ].filter(Boolean)
  if (fechas.length === 0) return null

  const masAntigua = fechas.sort()[0]
  return calcularPeriodoCiclo(tipoPago, new Date(`${masAntigua}T12:00:00`))
}

async function cicloSinConfirmarAntesDeVehiculo(tipoPago, tope) {
  let query = supabase
    .from('pago_furgoneta')
    .select('fecha_cierre_ciclo, furgoneta:furgoneta_id!inner(tipo_pago)')
    .eq('furgoneta.tipo_pago', tipoPago)
  if (tope) query = query.lte('fecha_cierre_ciclo', tope)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const cerrados = [...new Set((data ?? []).map((r) => soloFecha(r.fecha_cierre_ciclo)))].sort()
  if (cerrados.length === 0) return null

  const { data: confirmados, error: errC } = await supabase
    .from('ciclo_confirmado')
    .select('periodo_fin')
    .eq('tipo_entidad', 'furgoneta')
    .eq('tipo_pago', tipoPago)
  if (errC) throw new Error(errC.message)
  const yaConfirmados = new Set((confirmados ?? []).map((r) => r.periodo_fin))

  const finSinConfirmar = cerrados.find((f) => !yaConfirmados.has(f))
  if (!finSinConfirmar) return null

  return calcularPeriodoCiclo(tipoPago, new Date(`${finSinConfirmar}T12:00:00`))
}

export async function getCicloActivoAPagarVehiculo(tipoPago) {
  const candidato = await cicloCandidatoPendienteVehiculo(tipoPago)
  const sinConfirmar = await cicloSinConfirmarAntesDeVehiculo(tipoPago, candidato?.inicio ?? null)
  return sinConfirmar ?? candidato
}

// Espejo de getCicloPendienteDeConfirmar (records.js). Hoy no hay ningún
// mecanismo de "cancelar" pago de furgoneta, así que esto es solo para que
// el admin lleve el mismo registro/control que en empleados.
export async function getCicloPendienteDeConfirmarVehiculo(tipoPago) {
  const candidato = await cicloCandidatoPendienteVehiculo(tipoPago)
  return cicloSinConfirmarAntesDeVehiculo(tipoPago, candidato?.inicio ?? null)
}

export async function confirmarCicloPagadoVehiculo(tipoPago, periodoFin) {
  const { error } = await supabase
    .from('ciclo_confirmado')
    .insert({ tipo_entidad: 'furgoneta', tipo_pago: tipoPago, periodo_fin: periodoFin })
  if (error) throw new Error(error.message)
}

/* ─── Resumen de pagos pendientes — Furgonetas (Panel Central) ────────
 * Mismo criterio que getResumenPagos (records.js): candado global de un
 * ciclo a la vez (getCicloActivoAPagarVehiculo), no "el ciclo de hoy".
 */
export async function getResumenPagosVehiculos() {
  const [periodoQ, periodoM] = await Promise.all([
    getCicloActivoAPagarVehiculo('quincenal'),
    getCicloActivoAPagarVehiculo('mensual'),
  ])
  const periodos = { quincenal: periodoQ, mensual: periodoM }

  const [jornadas, adelantos] = await Promise.all([
    supabase.from('jornada_furgoneta')
      .select('plazas_ocupadas, tarifa_aplicada, fecha_trabajo, furgoneta:furgoneta_id(tipo_pago)')
      .eq('fue_liquidado', false),
    supabase.from('adelanto_furgoneta')
      .select('monto, fecha_adelanto, furgoneta:furgoneta_id(tipo_pago)')
      .eq('fue_liquidado', false),
  ])
  if (jornadas.error) throw new Error(jornadas.error.message)
  if (adelantos.error) throw new Error(adelantos.error.message)

  const resumen = { quincenal: 0, mensual: 0 }

  jornadas.data?.forEach((j) => {
    const periodo = periodos[j.furgoneta?.tipo_pago]
    if (!periodo) return
    const fecha = soloFecha(j.fecha_trabajo)
    if (!fecha || fecha > periodo.fin) return
    resumen[j.furgoneta.tipo_pago] += Number(j.plazas_ocupadas || 0) * Number(j.tarifa_aplicada || 0)
  })

  adelantos.data?.forEach((a) => {
    const periodo = periodos[a.furgoneta?.tipo_pago]
    if (!periodo) return
    if (!a.fecha_adelanto || a.fecha_adelanto > periodo.fin) return
    resumen[a.furgoneta.tipo_pago] -= Number(a.monto || 0)
  })

  // Igual que getResumenPagos (records.js): el total viaja junto con el
  // propio ciclo que se está pagando, para que ResumenPage muestre
  // "Ciclo a pagar: ..." y avance solo en cuanto llegue a €0.
  return {
    quincenal: { total: resumen.quincenal, periodo: periodoQ },
    mensual:   { total: resumen.mensual,   periodo: periodoM },
  }
}

// Traduce el error crudo de Postgres del CHECK(costo_plaza > 0) a un mensaje
// legible. Defensa en profundidad: el formulario ya bloquea esto del lado
// del cliente, esto cubre cualquier otra vía que llegue directo a la RPC/tabla.
function traducirErrorFurgoneta(error) {
  if (error.code === '23514' || error.message?.includes('costo_plaza')) {
    return new Error('La tarifa por plaza debe ser mayor a 0.')
  }
  return new Error(error.message)
}

export async function crearVehiculo(payload) {
  // El trigger de BD crea la fila de pin_furgoneta automáticamente.
  const { data, error } = await supabase
    .from('furgoneta').insert(aColumnasFurgoneta(payload)).select(SELECT_FURGONETA).single()
  if (error) throw traducirErrorFurgoneta(error)
  return mapFurgoneta(data)
}

export async function actualizarVehiculo(id, cambios) {
  const { data, error } = await supabase
    .from('furgoneta').update(aColumnasFurgoneta(cambios)).eq('id', id).select(SELECT_FURGONETA).single()
  if (error) throw traducirErrorFurgoneta(error)
  return mapFurgoneta(data)
}

/**
 * Cambio de ciclo (quincenal/mensual) diferido — mismo patrón exacto que
 * `empleados.tipo_pago_pendiente` (ver `resolverPendientePeriodo` y
 * `promoverTipoPagoPendiente` en workers.js). `actualizarVehiculo` NUNCA
 * escribe `tipo_pago` directo desde el formulario de edición — solo su
 * versión "pendiente" (calculada con `resolverPendientePeriodo`, reusada tal
 * cual, es una función pura sin nada específico de empleados). El cambio
 * real solo entra en vigor aquí, justo después de que el pago del ciclo
 * activo de esta furgoneta se ejecutó con éxito — nunca antes, y nunca desde
 * "Dar de baja" (esa RPC borra la fila entera, no hay nada que promover).
 *
 * Best-effort a propósito, igual que su par de empleados: en este punto el
 * pago ya es irreversible, así que un fallo aquí no debe aparentar que el
 * pago falló — el pendiente simplemente se reintenta en el próximo pago.
 */
export async function promoverTipoPagoPendienteVehiculo(furgonetaId) {
  try {
    const { data, error } = await supabase
      .from('furgoneta')
      .select('tipo_pago_pendiente')
      .eq('id', furgonetaId)
      .single()
    if (error) throw error
    if (!data.tipo_pago_pendiente) return null

    return await actualizarVehiculo(furgonetaId, {
      tipo_pago:           data.tipo_pago_pendiente,
      tipo_pago_pendiente: null,
    })
  } catch (err) {
    console.error(`No se pudo promover tipo_pago_pendiente de la furgoneta ${furgonetaId}:`, err.message)
    return null
  }
}

// Baja con liquidación forzada — Fase A (solo lectura, se puede repetir).
// Calcula, sin escribir nada, cuánto se le debe a la furgoneta: suma
// tarifa_aplicada × plazas_ocupadas de jornada_furgoneta (fue_liquidado =
// false, sin filtro de fecha) menos adelanto_furgoneta pendiente.
export async function calcularBajaVehiculo(id) {
  const { data, error } = await supabase.rpc('calcular_baja_furgoneta', { p_furgoneta_id: id })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return {
    total_devengado: Number(r?.total_devengado ?? 0),
    total_adelantos: Number(r?.total_adelantos ?? 0),
    monto_neto: Number(r?.monto_neto ?? 0),
  }
}

// Baja con liquidación forzada — Fase B (transaccional). Recalcula en el
// servidor y compara contra `montoEsperado`; si difiere, aborta con la
// cifra nueva. Si coincide, genera el recibo, marca todo como liquidado y
// borra la furgoneta — las tres cosas en la misma transacción de la RPC.
export async function darDeBajaVehiculo({ id, montoEsperado, periodoInicio, periodoFin }) {
  const { data, error } = await supabase.rpc('dar_de_baja_furgoneta', {
    p_furgoneta_id: id,
    p_monto_esperado: montoEsperado,
    p_fecha_inicio_ciclo: periodoInicio,
    p_fecha_cierre_ciclo: periodoFin,
  })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return {
    total_devengado: Number(r?.total_devengado ?? 0),
    total_adelantos: Number(r?.total_adelantos ?? 0),
    total_pagado: Number(r?.total_pagado ?? 0),
  }
}

/* ─── Jornada de furgoneta (plazas por día) ──────────────────────────── */

// Editar plazas de un día puntual (admin). Único campo editable.
export async function actualizarPlazasVehiculoDia(id, plazas) {
  const { data, error } = await supabase
    .from('jornada_furgoneta')
    .update({ plazas_ocupadas: plazas })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// Días pendientes de pago de la furgoneta (para "Nómina Actual"/"Historial
// de Días"). `fechaFin` (se le pasa `finArrastre` desde VehiculoDetallePage):
// solo muestra los días del ciclo YA CERRADO, igual que "Nómina Actual" del
// lado de empleados — sin ella, mezclaba el ciclo cerrado con cualquier día
// del bloque activo.
export async function listarPlazasVehiculoPendientes(vehiculoId, fechaFin) {
  let query = supabase
    .from('jornada_furgoneta')
    .select('id, fecha:fecha_trabajo, plazas:plazas_ocupadas, tarifa_plaza_aplicada:tarifa_aplicada')
    .eq('furgoneta_id', vehiculoId)
    .eq('fue_liquidado', false)
    .not('fecha_trabajo', 'is', null)
  if (fechaFin) query = query.lte('fecha_trabajo', `${fechaFin}T23:59:59.999`)
  const { data, error } = await query.order('fecha_trabajo', { ascending: false })
  if (error) throw new Error(error.message)
  // Tarifa congelada al abrir el turno (jornada_furgoneta.tarifa_aplicada,
  // H-11 cerrado) — ya no se aproxima con el costo_plaza en vivo.
  return (data ?? []).map((d) => ({
    id: d.id,
    fecha: d.fecha ? String(d.fecha).slice(0, 10) : d.fecha,
    plazas: d.plazas,
    tarifa_plaza_aplicada: d.tarifa_plaza_aplicada != null ? Number(d.tarifa_plaza_aplicada) : null,
    encargado: null,
  }))
}

/* ─── Adelantos de furgoneta ─────────────────────────────────────────── */

// `fechaFin` (se le pasa `finArrastre` desde VehiculoDetallePage): solo
// muestra adelantos del ciclo YA CERRADO, mismo criterio que el resto.
export async function listarAdelantosVehiculoPendientes(vehiculoId, fechaFin) {
  let query = supabase
    .from('adelanto_furgoneta')
    .select('id, concepto, monto, fecha_adelanto, fue_liquidado')
    .eq('furgoneta_id', vehiculoId)
    .eq('fue_liquidado', false)
  if (fechaFin) query = query.lte('fecha_adelanto', fechaFin)
  const { data, error } = await query.order('fecha_adelanto', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((a) => ({
    id: a.id, concepto: a.concepto, monto: Number(a.monto),
    fecha: a.fecha_adelanto, pagado_en: a.fue_liquidado ? true : null,
  }))
}

// `fechaFin` (resuelto por el caller con getCicloActivoAPagarVehiculo —
// el ciclo específico a pagar, candado global): solo cuenta adelantos de
// ESE ciclo. Sin ella (nada pendiente de ningún ciclo), devuelve 0.
export async function getTotalAdelantosVehiculoPendientes(vehiculoId, fechaFin) {
  if (!fechaFin) return 0
  const { data, error } = await supabase
    .from('adelanto_furgoneta')
    .select('monto, fecha_adelanto')
    .eq('furgoneta_id', vehiculoId)
    .eq('fue_liquidado', false)
    .lte('fecha_adelanto', fechaFin)
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((s, a) => s + Number(a.monto || 0), 0)
}

export async function registrarAdelantoVehiculo({ vehiculoId, concepto, monto }) {
  const { data, error } = await supabase
    .from('adelanto_furgoneta')
    .insert({ furgoneta_id: vehiculoId, concepto: concepto?.trim() || null, monto })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarMontoAdelantoVehiculo(id, monto) {
  const { data, error } = await supabase
    .from('adelanto_furgoneta')
    .update({ monto })
    .eq('id', id)
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function eliminarAdelantoVehiculo(id) {
  const { data, error } = await supabase
    .from('adelanto_furgoneta')
    .delete()
    .eq('id', id)
    .eq('fue_liquidado', false)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Este adelanto ya fue liquidado y no se puede eliminar.')
  }
}

/* ─── PIN de la furgoneta (tabla pin_furgoneta, rotación) ─────────────── */

export async function rotarPinVehiculo(vehiculoId) {
  const { data, error } = await supabase.rpc('rotar_pin_furgoneta', { p_furgoneta_id: vehiculoId })
  if (error) throw new Error(error.message)
  return { pin_actual: data }   // la RPC devuelve el nuevo PIN
}
