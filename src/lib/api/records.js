import { supabase } from '../supabase.js'

/**
 * ─── REGISTROS OPERATIVOS (esquema v6.0) ───────────────────
 * Jornadas (empleado / encargado / furgoneta), temporales, adelantos y
 * pagos. Esta capa traduce el esquema v6.0 a la forma que ya usa la app:
 *   jornada.fecha_trabajo   → .fecha (YYYY-MM-DD)
 *   jornada.horas_trabajadas→ .horas
 *   jornada.pago_destajo    → .destajo
 *   adelanto.fecha_adelanto → .fecha ; fue_liquidado → .pagado_en
 *   pago.fecha_inicio/cierre_ciclo → .periodo_inicio/.periodo_fin
 */

const soloFecha = (ts) => (ts ? String(ts).slice(0, 10) : ts)

const mapJornada = (r) => ({
  id: r.id,
  fecha: soloFecha(r.fecha_trabajo),
  horas: Number(r.horas_trabajadas ?? 0),
  destajo: Number(r.pago_destajo ?? 0),
  // Tarifa vigente cuando SE CREÓ esta jornada (snapshot en BD), no la
  // tarifa actual del empleado — así un aumento a mitad de ciclo no
  // repriced horas ya trabajadas.
  tarifa: r.tarifa_aplicada != null ? Number(r.tarifa_aplicada) : null,
  created_at: r.created_at,
  // Tabla de origen (jornada_empleado / jornada_encargado): necesaria para
  // saber dónde hacer el UPDATE al editar, ya que ambas tablas se mezclan
  // en un solo listado de cara al usuario.
  tabla: r.tabla,
})

const mapAdelanto = (r) => ({
  id: r.id,
  monto: Number(r.monto),
  fecha: r.fecha_adelanto,
  created_at: r.created_at,
  // La app usa `pagado_en` como "ya liquidado" (truthy/null).
  pagado_en: r.fue_liquidado ? (r.created_at ?? true) : null,
})

const mapPago = (r) => ({
  id: r.id,
  periodo_inicio: soloFecha(r.fecha_inicio_ciclo),
  periodo_fin: soloFecha(r.fecha_cierre_ciclo),
  total_adelantos: Number(r.total_adelantos ?? 0),
  total_pagado: Number(r.total_pagado ?? 0),
  // v6.0 no guarda el devengado; se reconstruye (pagado + adelantos).
  total_devengado: Number(r.total_pagado ?? 0) + Number(r.total_adelantos ?? 0),
  created_at: r.created_at,
})

/* ─── Jornadas ─────────────────────────────────────────── */

// Registro de la jornada de un empleado normal (encargado, anónimo).
// `fecha` es la fecha elegida en el calendario del encargado (YYYY-MM-DD);
// si no se manda, la RPC usa CURRENT_DATE por default.
export async function registrarJornadaEmpleado({ empleadoId, encargadoId, horas, destajo = 0, fecha }) {
  const { data, error } = await supabase.rpc('registrar_jornada_empleado', {
    p_empleado_id:  empleadoId,
    p_encargado_id: encargadoId,
    p_horas:        horas,
    p_destajo:      destajo,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error) throw new Error(error.message)
  return data   // uuid
}

// Inicio de turno del encargado: crea (idempotente) su jornada + la de la
// furgoneta, ambas en curso. Se llama al validar el PIN de la furgoneta.
//
// H-04 (2026-07-29): la RPC ahora exige y valida el PIN del lado del
// servidor, para que no se pueda invocar directamente desde la consola
// saltándose login_encargado. Se pasa el mismo PIN que ya se usó ahí.
export async function iniciarJornadaEncargado({ encargadoId, furgonetaId, pin }) {
  const { data, error } = await supabase.rpc('iniciar_jornada_encargado', {
    p_encargado_id: encargadoId,
    p_furgoneta_id: furgonetaId,
    p_pin:          pin,
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : data
}

// Cierre del turno del encargado: rellena sus horas/destajo y sella el día.
export async function cerrarJornadaEncargado({ encargadoId, horas, destajo = 0 }) {
  const { data, error } = await supabase.rpc('cerrar_jornada_encargado', {
    p_encargado_id: encargadoId,
    p_horas:        horas,
    p_destajo:      destajo,
  })
  if (error) throw new Error(error.message)
  return data   // uuid
}

export async function getJornadasDelDia(fecha) {
  const { data, error } = await supabase
    .from('jornada_empleado')
    .select(`
      id, horas:horas_trabajadas, destajo:pago_destajo, fecha:fecha_trabajo,
      empleado:empleado_id ( id, nombre:nombre_completo ),
      vehiculo:furgoneta_id ( id, nombre:apodo, matricula ),
      encargado:encargado_id ( id, nombre:nombre_completo )
    `)
    .gte('fecha_trabajo', `${fecha}T00:00:00`)
    .lte('fecha_trabajo', `${fecha}T23:59:59.999`)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/* ─── Plazas / Jornada de furgoneta ───────────────────────
 * Un total de pasajeros por furgoneta+día. Rellena la jornada de furgoneta
 * abierta del turno.
 */
export async function registrarPlazasVehiculo({ vehiculoId, plazas }) {
  const { data, error } = await supabase.rpc('registrar_plazas_furgoneta', {
    p_furgoneta_id: vehiculoId,
    p_plazas:       plazas,
  })
  if (error) throw new Error(error.message)
  return data   // uuid
}

// Corrección de la jornada de un empleado (admin): horas, destajo y fecha.
// La tarifa_aplicada (snapshot histórico) nunca se toca aquí — solo se
// corrigen valores mal capturados, no se recalcula el precio.
// `tabla` indica el origen real de la fila (jornada_empleado o
// jornada_encargado — ver mapJornada/getJornadasTrabajador), porque el
// listado del trabajador mezcla ambas tablas y hay que actualizar la que
// realmente contiene esta jornada.
export async function actualizarJornadaTrabajador(jornadaId, { horas, destajo, fecha, tabla = 'jornada_empleado' }) {
  const cambios = { horas_trabajadas: horas, pago_destajo: destajo }
  if (fecha) cambios.fecha_trabajo = fecha
  const { data, error } = await supabase
    .from(tabla)
    .update(cambios)
    .eq('id', jornadaId)
    .eq('fue_liquidado', false)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Esta jornada ya fue liquidada y no se puede editar.')
  }
  return data[0]
}

/* ─── Adelantos a trabajadores ─────────────────────────── */

export async function registrarAdelanto({ empleadoId, monto }) {
  const { data, error } = await supabase
    .from('adelanto_empleado')
    .insert({ empleado_id: empleadoId, monto })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function listarAdelantosEmpleado(empleadoId) {
  const { data, error } = await supabase
    .from('adelanto_empleado')
    .select('id, monto, fecha_adelanto, fue_liquidado, created_at')
    .eq('empleado_id', empleadoId)
    .order('fecha_adelanto', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapAdelanto)
}

export async function actualizarMontoAdelantoEmpleado(id, monto) {
  const { data, error } = await supabase
    .from('adelanto_empleado')
    .update({ monto })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function eliminarAdelantoEmpleado(id) {
  const { error } = await supabase.from('adelanto_empleado').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* ─── Pago / Liquidación (RPC atómica) ─────────────────── */

export async function ejecutarPago({ empleadoId, periodoInicio, periodoFin }) {
  const { data, error } = await supabase.rpc('ejecutar_pago_empleado', {
    p_empleado_id: empleadoId,
    p_inicio:      periodoInicio,
    p_fin:         periodoFin,
  })
  if (error) throw new Error(error.message)
  return data?.[0] ?? null   // { pago_id, total_pagado }
}

export async function ejecutarPagoVehiculo({ vehiculoId, periodoInicio, periodoFin }) {
  const { data, error } = await supabase.rpc('ejecutar_pago_furgoneta', {
    p_furgoneta_id: vehiculoId,
    p_inicio:       periodoInicio,
    p_fin:          periodoFin,
  })
  if (error) throw new Error(error.message)
  return data?.[0] ?? null   // { pago_id, total_pagado }
}

/* ─── Resumen global (KPIs del Panel Central) ─────────── */

export async function getResumenGlobal() {
  const [emp, veh] = await Promise.all([
    supabase.from('empleados').select('id', { count: 'exact', head: true }),
    supabase.from('furgoneta').select('id', { count: 'exact', head: true }),
  ])
  return { trabajadores: emp.count ?? 0, vehiculos: veh.count ?? 0 }
}

export async function getResumenPagos() {
  // Devengado pendiente por ciclo (quincenal/mensual), sumando el trabajo de
  // empleados normales y el propio de los encargados, neto de adelantos
  // pendientes — mismo criterio que calcular_baja_empleado (workers.js) y
  // que totalPagar en la Lista de Pago: sin restar adelantos esto mostraba
  // el devengado BRUTO, inflado respecto a lo que realmente se paga.
  const [emp, enc, adelantos] = await Promise.all([
    supabase.from('jornada_empleado')
      .select('horas_trabajadas, pago_destajo, tarifa_aplicada, empleado:empleado_id(tipo_pago, pago_x_hora)')
      .eq('fue_liquidado', false),
    supabase.from('jornada_encargado')
      .select('horas_trabajadas, pago_destajo, tarifa_aplicada, encargado:encargado_id(tipo_pago, pago_x_hora)')
      .eq('fue_liquidado', false),
    supabase.from('adelanto_empleado')
      .select('monto, empleado:empleado_id(tipo_pago)')
      .eq('fue_liquidado', false),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  if (adelantos.error) throw new Error(adelantos.error.message)

  const resumen = { quincenal: 0, mensual: 0 }
  const sumar = (rows, joinKey) => {
    rows?.forEach((j) => {
      const e = j[joinKey]
      // Tarifa vigente cuando SE CREÓ la jornada, no la actual del empleado.
      const tarifa = j.tarifa_aplicada ?? e?.pago_x_hora ?? 0
      const total = Number(j.horas_trabajadas || 0) * Number(tarifa) + Number(j.pago_destajo || 0)
      if (e?.tipo_pago === 'quincenal') resumen.quincenal += total
      else if (e?.tipo_pago === 'mensual') resumen.mensual += total
    })
  }
  sumar(emp.data, 'empleado')
  sumar(enc.data, 'encargado')

  adelantos.data?.forEach((a) => {
    const tipo = a.empleado?.tipo_pago
    if (tipo === 'quincenal') resumen.quincenal -= Number(a.monto || 0)
    else if (tipo === 'mensual') resumen.mensual -= Number(a.monto || 0)
  })

  return resumen
}

/* ─── Agregados de visualización desde panel central ────── */

export async function getHistorialPagos(empleadoId) {
  const { data, error } = await supabase
    .from('pago_empleado')
    .select('id, fecha_inicio_ciclo, fecha_cierre_ciclo, total_adelantos, total_pagado, created_at')
    .eq('empleado_id', empleadoId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapPago)
}

export async function getHistorialAdelantos(empleadoId) {
  const { data, error } = await supabase
    .from('adelanto_empleado')
    .select('id, monto, fecha_adelanto, fue_liquidado, created_at')
    .eq('empleado_id', empleadoId)
    .eq('fue_liquidado', false)
    .order('fecha_adelanto', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapAdelanto)
}

// Días trabajados pendientes del empleado. Cubre ambos roles: su trabajo
// normal (jornada_empleado) y, si es encargado, su turno (jornada_encargado).
export async function getJornadasTrabajador(empleadoId, limit = 60) {
  const [emp, enc] = await Promise.all([
    supabase.from('jornada_empleado')
      .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada, created_at')
      .eq('empleado_id', empleadoId).eq('fue_liquidado', false)
      .order('fecha_trabajo', { ascending: false }).limit(limit),
    supabase.from('jornada_encargado')
      .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada, created_at')
      .eq('encargado_id', empleadoId).eq('fue_liquidado', false)
      .not('fecha_trabajo', 'is', null)
      .order('fecha_trabajo', { ascending: false }).limit(limit),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  return [
    ...(emp.data ?? []).map((r) => ({ ...r, tabla: 'jornada_empleado' })),
    ...(enc.data ?? []).map((r) => ({ ...r, tabla: 'jornada_encargado' })),
  ].map(mapJornada)
}

/* ─── Buscador de empleados del encargado ───── */

export async function buscarEmpleadosEncargado(fecha) {
  const { data, error } = await supabase
    .rpc('buscar_empleados_encargado', { p_fecha: fecha })
  if (error) throw new Error(error.message)
  // [{ id, nombre, telefono, codigo_corto, registrado, completo,
  //    jornada_id, horas_trabajadas, pago_destajo }]
  return data ?? []
}

// Estado propio del encargado en la fecha vista (excluido del buscador de
// arriba). Usado para decidir si "Mis horas" debe crear, completar o solo
// mostrar — ya no es un booleano, ahora trae la jornada completa (o vacía).
export async function estadoJornadaPropiaEncargado(encargadoId, fecha) {
  const { data, error } = await supabase
    .rpc('estado_jornada_propia_encargado', { p_encargado_id: encargadoId, p_fecha: fecha })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return r ?? { registrado: false, completo: false, jornada_id: null, horas_trabajadas: null, pago_destajo: null }
}

// Corrección retroactiva: completa horas_trabajadas o pago_destajo de una
// jornada ya registrada, SOLO si ese campo específico sigue en 0. Valida
// fue_liquidado del lado del servidor, y que la jornada pertenezca al
// encargado que llama (p_encargado_id) — nadie puede corregir el registro
// de un empleado que no es suyo.
export async function corregirJornadaEmpleado({ jornadaId, encargadoId, horas, destajo }) {
  const { error } = await supabase.rpc('corregir_jornada_empleado', {
    p_jornada_id:   jornadaId,
    p_encargado_id: encargadoId,
    p_horas:        horas,
    p_destajo:      destajo,
  })
  if (error) throw new Error(error.message)
}

// Igual que corregirJornadaEmpleado, pero para la jornada propia del
// encargado (jornada_encargado) ya cerrada — no dispara ningún cierre de
// sesión, es una corrección pura. También exige que el turno sea suyo.
export async function corregirJornadaEncargado({ jornadaId, encargadoId, horas, destajo }) {
  const { error } = await supabase.rpc('corregir_jornada_encargado', {
    p_jornada_id:   jornadaId,
    p_encargado_id: encargadoId,
    p_horas:        horas,
    p_destajo:      destajo,
  })
  if (error) throw new Error(error.message)
}

// Jornadas del empleado dentro de un período (para listas de pago/planilla).
export async function getJornadasTrabajadorPorPeriodo(empleadoId, fechaInicio, fechaFin) {
  const rango = (q, campo) => q
    .gte(campo, `${fechaInicio}T00:00:00`)
    .lte(campo, `${fechaFin}T23:59:59.999`)

  const [emp, enc] = await Promise.all([
    rango(supabase.from('jornada_empleado')
      .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada')
      .eq('empleado_id', empleadoId).eq('fue_liquidado', false), 'fecha_trabajo')
      .order('fecha_trabajo', { ascending: true }),
    rango(supabase.from('jornada_encargado')
      .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada')
      .eq('encargado_id', empleadoId).eq('fue_liquidado', false)
      .not('fecha_trabajo', 'is', null), 'fecha_trabajo')
      .order('fecha_trabajo', { ascending: true }),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  return [...(emp.data ?? []), ...(enc.data ?? [])].map(mapJornada)
}

export async function getPagoPorPeriodo(empleadoId, fechaInicio, fechaFin) {
  const { data, error } = await supabase
    .from('pago_empleado')
    .select('id, total_pagado, created_at')
    .eq('empleado_id', empleadoId)
    .eq('fecha_inicio_ciclo', fechaInicio)
    .eq('fecha_cierre_ciclo', fechaFin)
  if (error) throw new Error(error.message)
  return data?.[0] ?? null
}

export async function getHistorialPagosVehiculo(vehiculoId, retentionDays = 60) {
  const corte = new Date()
  corte.setDate(corte.getDate() - retentionDays)
  const { data, error } = await supabase
    .from('pago_furgoneta')
    .select('id, fecha_inicio_ciclo, fecha_cierre_ciclo, total_adelantos, total_pagado, created_at')
    .eq('furgoneta_id', vehiculoId)
    .gte('created_at', corte.toISOString())
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapPago)
}

// H-09 (2026-07-29): filtrado por fecha de ciclo, igual que ejecutar_pago_
// empleado en la BD — antes traía todos los adelantos pendientes sin
// importar su fecha, y la planilla/Escanear restaban un total que la RPC
// nunca iba a descontar en su totalidad.
export async function getAdelantosPendientes(empleadoId, fechaInicio, fechaFin) {
  const { data, error } = await supabase
    .from('adelanto_empleado')
    .select('id, monto, fecha_adelanto, fue_liquidado, created_at')
    .eq('empleado_id', empleadoId)
    .eq('fue_liquidado', false)
    .gte('fecha_adelanto', fechaInicio)
    .lte('fecha_adelanto', fechaFin)
    .order('fecha_adelanto', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapAdelanto)
}

/* ─── Temporal: alta (registro, se paga en efectivo aparte) ───────── */

// v6.0: el temporal solo se registra (tarifa por hora copiada de
// configuracion_temporal). No genera jornada ni pago en el sistema.
export async function registrarTemporal({ nombre, horas = 0, destajo }) {
  const { data, error } = await supabase.rpc('registrar_temporal', {
    p_nombre_completo: nombre,
    p_horas:           horas,
    p_destajo:         destajo,
  })
  if (error) throw new Error(error.message)
  return data   // uuid
}
