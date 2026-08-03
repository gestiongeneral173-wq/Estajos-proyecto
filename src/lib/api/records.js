import { supabase } from '../supabase.js'
import { calcularPeriodoCiclo } from './ciclos.js'
import { listarTrabajadores } from './workers.js'

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
  // Presente solo cuando el caller lo selecciona explícitamente (ver
  // getJornadasTrabajadorHistorico) — usado por "Agregar horas" en
  // EscanearPage para distinguir si la jornada de hoy ya se puede editar.
  fue_liquidado: r.fue_liquidado ?? false,
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

/* ─── Ciclo global a pagar (candado por ciclo, no arrastre acumulado) ──
 * Decisión de negocio (2026-08-02): el pago es ESTRICTAMENTE un ciclo a la
 * vez, para TODA la nómina de un tipo_pago a la vez (no por persona). No
 * se puede cobrar el ciclo 2 mientras quede aunque sea un empleado con
 * algo pendiente del ciclo 1 — el sistema debe quedarse "atorado" en el
 * ciclo más viejo con algo pendiente hasta que se liquide por completo
 * para todos, Y ADEMÁS el admin confirme explícitamente que ya terminó
 * con ese ciclo (alerta "Ciclo completado" en ResumenPage) — llegar a €0
 * no basta por sí solo para avanzar, hace falta la confirmación.
 */

// Fecha pendiente MÁS ANTIGUA de TODA la nómina de ese tipo_pago
// (jornada_empleado + jornada_encargado + adelanto_empleado, sin importar
// de quién sea), ya resuelta al bloque que la contiene. null si no hay
// absolutamente nada pendiente. Con bloques contiguos (ver ciclos.js) no
// hace falta ningún ajuste especial: cualquier fecha, incluida una que sea
// el diaPago de otro bloque, resuelve sola al bloque correcto.
async function cicloCandidatoPendiente(tipoPago) {
  if (tipoPago !== 'quincenal' && tipoPago !== 'mensual') return null

  const [emp, enc, adel] = await Promise.all([
    supabase.from('jornada_empleado')
      .select('fecha_trabajo, empleado:empleado_id!inner(tipo_pago)')
      .eq('fue_liquidado', false)
      .eq('empleado.tipo_pago', tipoPago)
      .order('fecha_trabajo', { ascending: true })
      .limit(1),
    supabase.from('jornada_encargado')
      .select('fecha_trabajo, encargado:encargado_id!inner(tipo_pago)')
      .eq('fue_liquidado', false)
      .not('fecha_trabajo', 'is', null)
      .eq('encargado.tipo_pago', tipoPago)
      .order('fecha_trabajo', { ascending: true })
      .limit(1),
    supabase.from('adelanto_empleado')
      .select('fecha_adelanto, empleado:empleado_id!inner(tipo_pago)')
      .eq('fue_liquidado', false)
      .eq('empleado.tipo_pago', tipoPago)
      .order('fecha_adelanto', { ascending: true })
      .limit(1),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  if (adel.error) throw new Error(adel.error.message)

  const fechas = [
    soloFecha(emp.data?.[0]?.fecha_trabajo),
    soloFecha(enc.data?.[0]?.fecha_trabajo),
    adel.data?.[0]?.fecha_adelanto,
  ].filter(Boolean)
  if (fechas.length === 0) return null

  const masAntigua = fechas.sort()[0]
  return calcularPeriodoCiclo(tipoPago, new Date(`${masAntigua}T12:00:00`))
}

// Ciclo ya completamente pagado (existe un pago con esa fecha_cierre_ciclo)
// pero TODAVÍA sin confirmar/archivar, anterior (o igual) a `tope` — si no
// se da `tope`, cualquiera. null si no hay ninguno.
async function cicloSinConfirmarAntesDe(tipoPago, tope) {
  let query = supabase
    .from('pago_empleado')
    .select('fecha_cierre_ciclo, empleado:empleado_id!inner(tipo_pago)')
    .eq('empleado.tipo_pago', tipoPago)
  if (tope) query = query.lte('fecha_cierre_ciclo', tope)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const cerrados = [...new Set((data ?? []).map((r) => soloFecha(r.fecha_cierre_ciclo)))].sort()
  if (cerrados.length === 0) return null

  const { data: confirmados, error: errC } = await supabase
    .from('ciclo_confirmado')
    .select('periodo_fin')
    .eq('tipo_entidad', 'empleado')
    .eq('tipo_pago', tipoPago)
  if (errC) throw new Error(errC.message)
  const yaConfirmados = new Set((confirmados ?? []).map((r) => r.periodo_fin))

  const finSinConfirmar = cerrados.find((f) => !yaConfirmados.has(f))
  if (!finSinConfirmar) return null

  return calcularPeriodoCiclo(tipoPago, new Date(`${finSinConfirmar}T12:00:00`))
}

// El ciclo a pagar AHORA MISMO: si hay un ciclo ya pagado pero sin
// confirmar (anterior o igual al candidato real), ESE manda — el sistema
// se queda mostrándolo (con su total en €0) hasta que el admin confirme,
// en vez de saltar solo al siguiente. Solo si no hay nada pendiente de
// confirmar se devuelve el candidato genuinamente pendiente de pago.
export async function getCicloActivoAPagar(tipoPago) {
  const candidato = await cicloCandidatoPendiente(tipoPago)
  const sinConfirmar = await cicloSinConfirmarAntesDe(tipoPago, candidato?.inicio ?? null)
  return sinConfirmar ?? candidato
}

/* ─── Confirmar/archivar un ciclo ya completamente pagado (2026-08-02) ──
 * El admin debe confirmar explícitamente "este ciclo ya quedó pagado y
 * cerrado" (alerta "Ciclo completado" en ResumenPage) para que el sistema
 * avance al siguiente — llegar a €0 solo no alcanza (ver
 * getCicloActivoAPagar). Además, a partir de la confirmación, cancelar una
 * lista de ESE ciclo solo la oculta (ocultarListaPago), nunca revierte el
 * pago ni hace que el ciclo vuelva a aparecer como pendiente.
 */
export async function getCicloPendienteDeConfirmar(tipoPago) {
  const candidato = await cicloCandidatoPendiente(tipoPago)
  return cicloSinConfirmarAntesDe(tipoPago, candidato?.inicio ?? null)
}

export async function confirmarCicloPagado(tipoPago, periodoFin) {
  const { error } = await supabase
    .from('ciclo_confirmado')
    .insert({ tipo_entidad: 'empleado', tipo_pago: tipoPago, periodo_fin: periodoFin })
  if (error) throw new Error(error.message)
}

// ¿Esta lista pertenece a un ciclo ya confirmado/archivado? Lo decide
// ResumenPage antes de cancelar: si es true, llama a ocultarListaPago
// (paymentLists.js) en vez de cancelarListaPago.
export async function esListaDeCicloConfirmado(ciclo, periodoFin) {
  const { data, error } = await supabase
    .from('ciclo_confirmado')
    .select('id')
    .eq('tipo_entidad', 'empleado')
    .eq('tipo_pago', ciclo)
    .eq('periodo_fin', periodoFin)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

/* ─── Jornadas ─────────────────────────────────────────── */

// Registro de la jornada de un empleado normal (encargado, anónimo).
// `fecha` es la fecha elegida en el calendario del encargado (YYYY-MM-DD);
// si no se manda, la RPC usa CURRENT_DATE por default.
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada.
export async function registrarJornadaEmpleado({ tokenTurno, empleadoId, encargadoId, horas, destajo = 0, fecha }) {
  const { data, error } = await supabase.rpc('registrar_jornada_empleado', {
    p_token_turno:  tokenTurno,
    p_empleado_id:  empleadoId,
    p_encargado_id: encargadoId,
    p_horas:        horas,
    p_destajo:      destajo,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error) throw new Error(error.message)
  return data   // uuid
}

// "Agregar horas" desde Central (EscanearPage): crea una jornada de HOY
// para un empleado sin pasar por el flujo de campo — sin tokenTurno, sin
// encargado ni furgoneta (la RPC las deja en NULL, marcando
// `origen = 'central'`). Exclusiva de admin (verificado del lado del
// servidor). Replica el mismo guard que `registrar_jornada_empleado`: si ya
// existe una jornada de hoy para este empleado (liquidada o no), la RPC
// rechaza — la UI debe chequear eso antes con `getJornadasTrabajadorHistorico`
// y ofrecer editar en vez de crear.
export async function registrarJornadaEmpleadoCentral({ empleadoId, horas, destajo = 0 }) {
  const { data, error } = await supabase.rpc('registrar_jornada_empleado_central', {
    p_empleado_id: empleadoId,
    p_horas:       horas,
    p_destajo:     destajo,
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
//
// A2 (2026-07-30): también exige tokenTurno — la ficha que devolvió
// login_encargado, prueba de que esa llamada sí ocurrió. Sin ella, la RPC
// rechaza antes de validar nada más.
export async function iniciarJornadaEncargado({ tokenTurno, encargadoId, furgonetaId, pin }) {
  const { data, error } = await supabase.rpc('iniciar_jornada_encargado', {
    p_token_turno:  tokenTurno,
    p_encargado_id: encargadoId,
    p_furgoneta_id: furgonetaId,
    p_pin:          pin,
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : data
}

// Cierre del turno del encargado: rellena sus horas/destajo y sella el día.
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada.
export async function cerrarJornadaEncargado({ tokenTurno, encargadoId, horas, destajo = 0 }) {
  const { data, error } = await supabase.rpc('cerrar_jornada_encargado', {
    p_token_turno:  tokenTurno,
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
      id, horas:horas_trabajadas, destajo:pago_destajo, fecha:fecha_trabajo, fue_liquidado, origen,
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
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada.
export async function registrarPlazasVehiculo({ tokenTurno, vehiculoId, plazas }) {
  const { data, error } = await supabase.rpc('registrar_plazas_furgoneta', {
    p_token_turno:  tokenTurno,
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
export async function actualizarJornadaTrabajador(jornadaId, { horas, destajo, tabla = 'jornada_empleado' }) {
  const cambios = { horas_trabajadas: horas, pago_destajo: destajo }
  const { data, error } = await supabase
    .from(tabla)
    .update(cambios)
    .eq('id', jornadaId)
    .eq('fue_liquidado', false)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    // 0 filas puede ser por dos motivos distintos: ya se liquidó, o la fila
    // ya no existe (por ejemplo, otra pestaña la borró mientras se editaba
    // — ver "rehacer furgoneta" en ReporteDiarioPage). Se distingue con una
    // segunda consulta, solo en este camino de error, para no dar un
    // mensaje incorrecto.
    const { data: sigueExistiendo } = await supabase.from(tabla).select('id').eq('id', jornadaId)
    throw new Error(
      sigueExistiendo && sigueExistiendo.length > 0
        ? 'Esta jornada ya fue liquidada y no se puede editar.'
        : 'Esta jornada ya no existe — probablemente se eliminó desde otra pantalla. Actualiza la lista.'
    )
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
  // Devengado pendiente del CICLO A PAGAR — candado global (ver
  // getCicloActivoAPagar), no arrastre acumulado: un solo ciclo a la vez
  // para TODA la nómina de cada tipo_pago. Mientras quede aunque sea una
  // persona con algo pendiente de un ciclo viejo, ese es el único ciclo
  // que cuenta aquí — nada de ciclos más recientes se suma todavía, ni
  // siquiera si son de otra persona sin nada pendiente en el ciclo viejo.
  const [periodoQ, periodoM] = await Promise.all([
    getCicloActivoAPagar('quincenal'),
    getCicloActivoAPagar('mensual'),
  ])
  // null cuando no hay absolutamente nada pendiente de ningún ciclo para
  // ese tipo_pago — el contador correspondiente se queda en 0.
  const periodos = { quincenal: periodoQ, mensual: periodoM }

  const [emp, enc, adelantos] = await Promise.all([
    supabase.from('jornada_empleado')
      .select('horas_trabajadas, pago_destajo, tarifa_aplicada, fecha_trabajo, empleado:empleado_id(tipo_pago, pago_x_hora)')
      .eq('fue_liquidado', false),
    supabase.from('jornada_encargado')
      .select('horas_trabajadas, pago_destajo, tarifa_aplicada, fecha_trabajo, encargado:encargado_id(tipo_pago, pago_x_hora)')
      .eq('fue_liquidado', false)
      .not('fecha_trabajo', 'is', null),
    supabase.from('adelanto_empleado')
      .select('monto, fecha_adelanto, empleado:empleado_id(tipo_pago)')
      .eq('fue_liquidado', false),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  if (adelantos.error) throw new Error(adelantos.error.message)

  const resumen = { quincenal: 0, mensual: 0 }
  const sumar = (rows, joinKey) => {
    rows?.forEach((j) => {
      const e = j[joinKey]
      const periodo = periodos[e?.tipo_pago]
      if (!periodo) return
      const fecha = soloFecha(j.fecha_trabajo)
      if (!fecha || fecha > periodo.fin) return
      // Tarifa vigente cuando SE CREÓ la jornada, no la actual del empleado.
      const tarifa = j.tarifa_aplicada ?? e?.pago_x_hora ?? 0
      resumen[e.tipo_pago] += Number(j.horas_trabajadas || 0) * Number(tarifa) + Number(j.pago_destajo || 0)
    })
  }
  sumar(emp.data, 'empleado')
  sumar(enc.data, 'encargado')

  adelantos.data?.forEach((a) => {
    const periodo = periodos[a.empleado?.tipo_pago]
    if (!periodo) return
    if (!a.fecha_adelanto || a.fecha_adelanto > periodo.fin) return
    resumen[a.empleado.tipo_pago] -= Number(a.monto || 0)
  })

  // Se devuelve el total JUNTO con el propio ciclo que se está pagando —
  // ResumenPage lo usa para mostrar "Ciclo a pagar: ..." bajo cada
  // contador, y como se recalcula fresco en cada carga, el texto avanza
  // solo al ciclo siguiente en cuanto el actual llega a €0.
  return {
    quincenal: { total: resumen.quincenal, periodo: periodoQ },
    mensual:   { total: resumen.mensual,   periodo: periodoM },
  }
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

// `fechaFin` (opcional, se le pasa `finArrastre` desde TrabajadorDetallePage):
// sin ella, mostraba TODOS los adelantos sin liquidar sin importar el
// ciclo — con ella, "Adelantos" solo muestra los que pertenecen al ciclo
// ya cerrado (pagable ahora), igual que el resto de los contadores.
export async function getHistorialAdelantos(empleadoId, fechaFin) {
  let query = supabase
    .from('adelanto_empleado')
    .select('id, monto, fecha_adelanto, fue_liquidado, created_at')
    .eq('empleado_id', empleadoId)
    .eq('fue_liquidado', false)
  if (fechaFin) query = query.lte('fecha_adelanto', fechaFin)
  const { data, error } = await query.order('fecha_adelanto', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapAdelanto)
}

// Días trabajados pendientes del empleado. Cubre ambos roles: su trabajo
// normal (jornada_empleado) y, si es encargado, su turno (jornada_encargado).
//
// `fechaFin` (opcional, se le pasa `finArrastre` desde TrabajadorDetallePage):
// "Nómina Actual" debe mostrar solo los días del ciclo YA CERRADO (pagable
// ahora), no todo lo pendiente sin liquidar sin importar cuán reciente sea
// — antes esta función no tenía ningún límite de fecha, así que mezclaba
// el ciclo cerrado con cualquier día del bloque activo (incluido el día de
// pago de hoy), igual que el resto de los contadores antes del fix.
export async function getJornadasTrabajador(empleadoId, fechaFin, limit = 60) {
  const rango = (q) => (fechaFin ? q.lte('fecha_trabajo', `${fechaFin}T23:59:59.999`) : q)
  const [emp, enc] = await Promise.all([
    rango(
      supabase.from('jornada_empleado')
        .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada, created_at')
        .eq('empleado_id', empleadoId).eq('fue_liquidado', false)
    ).order('fecha_trabajo', { ascending: false }).limit(limit),
    rango(
      supabase.from('jornada_encargado')
        .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada, created_at')
        .eq('encargado_id', empleadoId).eq('fue_liquidado', false)
        .not('fecha_trabajo', 'is', null)
    ).order('fecha_trabajo', { ascending: false }).limit(limit),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  return [
    ...(emp.data ?? []).map((r) => ({ ...r, tabla: 'jornada_empleado' })),
    ...(enc.data ?? []).map((r) => ({ ...r, tabla: 'jornada_encargado' })),
  ].map(mapJornada)
}

/* ─── Buscador de empleados del encargado ───── */

// A2/H-06 (2026-07-30): exige tokenTurno — cierra el acceso anónimo puro
// (antes cualquiera con la clave anon podía bajar nombre+teléfono de toda
// la plantilla sin login). No filtra la lista: los empleados no están
// atados a una furgoneta fija, así que el buscador sigue viendo a todos.
export async function buscarEmpleadosEncargado(tokenTurno, fecha) {
  const { data, error } = await supabase
    .rpc('buscar_empleados_encargado', { p_token_turno: tokenTurno, p_fecha: fecha })
  if (error) throw new Error(error.message)
  // [{ id, nombre, telefono, codigo_corto, registrado, completo,
  //    jornada_id, horas_trabajadas, pago_destajo }]
  return data ?? []
}

// Estado propio del encargado en la fecha vista (excluido del buscador de
// arriba). Usado para decidir si "Mis horas" debe crear, completar o solo
// mostrar — ya no es un booleano, ahora trae la jornada completa (o vacía).
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada.
export async function estadoJornadaPropiaEncargado(tokenTurno, encargadoId, fecha) {
  const { data, error } = await supabase
    .rpc('estado_jornada_propia_encargado', { p_token_turno: tokenTurno, p_encargado_id: encargadoId, p_fecha: fecha })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return r ?? { registrado: false, completo: false, jornada_id: null, horas_trabajadas: null, pago_destajo: null }
}

// Corrección retroactiva: completa horas_trabajadas o pago_destajo de una
// jornada ya registrada, SOLO si ese campo específico sigue en 0. Valida
// fue_liquidado del lado del servidor, y que la jornada pertenezca al
// encargado que llama (p_encargado_id) — nadie puede corregir el registro
// de un empleado que no es suyo.
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada.
export async function corregirJornadaEmpleado({ tokenTurno, jornadaId, encargadoId, horas, destajo }) {
  const { error } = await supabase.rpc('corregir_jornada_empleado', {
    p_token_turno:  tokenTurno,
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
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada.
export async function corregirJornadaEncargado({ tokenTurno, jornadaId, encargadoId, horas, destajo }) {
  const { error } = await supabase.rpc('corregir_jornada_encargado', {
    p_token_turno:  tokenTurno,
    p_jornada_id:   jornadaId,
    p_encargado_id: encargadoId,
    p_horas:        horas,
    p_destajo:      destajo,
  })
  if (error) throw new Error(error.message)
}

// Jornadas del empleado dentro de un período (para listas de pago/planilla).
// `fechaInicio` es opcional: si se omite (null/undefined), no hay límite
// inferior — trae TODO lo no liquidado hasta `fechaFin`. Lo usa el "arrastre"
// de ciclos cerrados sin pagar (ver getDatosCicloParaPago): el ciclo activo
// debe poder liquidar también días de un ciclo anterior que se quedó sin
// pagarle a este empleado, no solo los del ciclo oficial.
export async function getJornadasTrabajadorPorPeriodo(empleadoId, fechaInicio, fechaFin) {
  const rango = (q, campo) => {
    let qq = q.lte(campo, `${fechaFin}T23:59:59.999`)
    if (fechaInicio) qq = qq.gte(campo, `${fechaInicio}T00:00:00`)
    return qq
  }

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

// Reconstrucción histórica del desglose día-por-día de una lista de pago YA
// generada (para reimprimir). A diferencia de getJornadasTrabajadorPorPeriodo,
// NO filtra por `fue_liquidado` — al momento de reimprimir, esas jornadas ya
// están liquidadas (el pago se ejecuta al instante al generar la lista, no
// queda estado "pendiente"), así que filtrar fue_liquidado=false siempre
// traería vacío. No hay ningún FK que vincule una jornada al pago que la
// liquidó (confirmado contra el esquema real), así que la única forma de
// reconstruir "qué se pagó" es por rango de fechas — válido porque tanto las
// jornadas liquidadas como la lista purgan a los 60 días por igual, nunca
// hay una ventana donde la lista siga viva pero sus jornadas ya se hayan
// purgado.
export async function getJornadasTrabajadorHistorico(empleadoId, fechaInicio, fechaFin) {
  const rango = (q, campo) => q
    .gte(campo, `${fechaInicio}T00:00:00`)
    .lte(campo, `${fechaFin}T23:59:59.999`)

  const [emp, enc] = await Promise.all([
    rango(supabase.from('jornada_empleado')
      .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada, fue_liquidado')
      .eq('empleado_id', empleadoId), 'fecha_trabajo')
      .order('fecha_trabajo', { ascending: true }),
    rango(supabase.from('jornada_encargado')
      .select('id, fecha_trabajo, horas_trabajadas, pago_destajo, tarifa_aplicada, fue_liquidado')
      .eq('encargado_id', empleadoId)
      .not('fecha_trabajo', 'is', null), 'fecha_trabajo')
      .order('fecha_trabajo', { ascending: true }),
  ])
  if (emp.error) throw new Error(emp.error.message)
  if (enc.error) throw new Error(enc.error.message)
  return [...(emp.data ?? []), ...(enc.data ?? [])].map(mapJornada)
}

// Solo se filtra por `fecha_cierre_ciclo` (el fin de ciclo activo es
// siempre el mismo para todos). El inicio real de un pago ya no es fijo —
// con el arrastre de ciclos anteriores sin pagar, puede ser anterior al
// inicio "oficial" del ciclo — así que exigir un match exacto de
// fecha_inicio_ciclo aquí podía dar "no pagado" para un pago que sí ocurrió.
export async function getPagoPorPeriodo(empleadoId, fechaFin) {
  const { data, error } = await supabase
    .from('pago_empleado')
    .select('id, total_pagado, created_at')
    .eq('empleado_id', empleadoId)
    .eq('fecha_cierre_ciclo', fechaFin)
  if (error) throw new Error(error.message)
  return data?.[0] ?? null
}

/* ─── Buscador de empleados (Escanear · Central) ────────────────────────
 * Reemplaza el lookup uno-por-uno del campo "código manual": trae TODOS los
 * empleados y, en 4 consultas fijas (sin importar cuántos empleados haya —
 * nada de un loop por empleado), calcula quién ya está pagado en su ciclo
 * activo. Replica exactamente la misma regla que ya usa `cargarTrabajador`
 * en EscanearPage (pago registrado en el cierre del ciclo Y cero jornadas
 * pendientes Y cero adelantos pendientes) — solo que en bloque, y cubriendo
 * ambos tipos de ciclo (quincenal + mensual) a la vez, porque cualquier
 * empleado de cualquier tipo puede aparecer en esta búsqueda.
 *
 * Ya NO se excluye a los pagados de la lista — se devuelven todos con un
 * flag `pagado`, para que el buscador los siga mostrando (remarcados) y el
 * admin pueda seguir dándoles adelanto u otro pago sin depender del QR.
 *
 * Esta lista solo decide QUIÉN SE MUESTRA y con qué marca visual. Al
 * seleccionar a alguien, la pantalla sigue llamando a `cargarTrabajador(id)`
 * como ya hacía con el QR — esa sigue siendo la única fuente de verdad para
 * jornadas/adelantos/pago reales de ese empleado, así que una lista
 * momentáneamente desactualizada nunca puede mostrar un monto a pagar
 * incorrecto.
 */
export async function getEmpleadosPendientesDePago() {
  // Ciclo a pagar (candado global, ver getCicloActivoAPagar) — no "el ciclo
  // de hoy". null si no hay absolutamente nada pendiente de ese tipo_pago.
  const [periodoQ, periodoM] = await Promise.all([
    getCicloActivoAPagar('quincenal'),
    getCicloActivoAPagar('mensual'),
  ])
  const periodos = { quincenal: periodoQ, mensual: periodoM }
  const finesAPagar = [periodoQ?.fin, periodoM?.fin].filter(Boolean)

  const [empleados, jornEmp, jornEnc, adelantos, pagos] = await Promise.all([
    listarTrabajadores({ periodo: 'todos' }),
    supabase.from('jornada_empleado')
      .select('empleado_id')
      .eq('fue_liquidado', false),
    supabase.from('jornada_encargado')
      .select('encargado_id')
      .eq('fue_liquidado', false)
      .not('fecha_trabajo', 'is', null),
    supabase.from('adelanto_empleado')
      .select('empleado_id')
      .eq('fue_liquidado', false),
    finesAPagar.length
      ? supabase.from('pago_empleado').select('empleado_id, fecha_cierre_ciclo').in('fecha_cierre_ciclo', finesAPagar)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (jornEmp.error) throw new Error(jornEmp.error.message)
  if (jornEnc.error) throw new Error(jornEnc.error.message)
  if (adelantos.error) throw new Error(adelantos.error.message)
  if (pagos.error) throw new Error(pagos.error.message)

  // Cualquier jornada u adelanto sin liquidar (sin límite inferior — mismo
  // criterio de arrastre que ya usa cargarTrabajador) tumba el "ya pagado",
  // sin importar si además existe un pago con la fecha de cierre correcta.
  const conPendiente = new Set([
    ...(jornEmp.data ?? []).map((r) => r.empleado_id),
    ...(jornEnc.data ?? []).map((r) => r.encargado_id),
    ...(adelantos.data ?? []).map((r) => r.empleado_id),
  ])

  // empleado_id → fecha_cierre_ciclo pagada. Solo cuenta si coincide con el
  // fin del ciclo activo del tipo_pago de ESE empleado (mismo requisito que
  // getPagoPorPeriodo — evita que un pago de un ciclo distinto, con cierre
  // coincidente por casualidad, marque "pagado" el ciclo equivocado).
  const finPagadoPorEmpleado = new Map(
    (pagos.data ?? []).map((r) => [r.empleado_id, soloFecha(r.fecha_cierre_ciclo)])
  )

  return empleados.map((e) => {
    const periodo = periodos[e.payment_period]
    // Sin ciclo conocido, o sin nada pendiente de ningún ciclo de ese tipo:
    // no hay contra qué comparar, nunca se marca pagado.
    if (!periodo) return { ...e, pagado: false }
    const esPagado = finPagadoPorEmpleado.get(e.id) === periodo.fin && !conPendiente.has(e.id)
    return { ...e, pagado: esPagado }
  })
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
// `fechaInicio` opcional (ver getJornadasTrabajadorPorPeriodo): sin ella,
// no hay límite inferior — necesario para el arrastre de ciclos cerrados.
export async function getAdelantosPendientes(empleadoId, fechaInicio, fechaFin) {
  let query = supabase
    .from('adelanto_empleado')
    .select('id, monto, fecha_adelanto, fue_liquidado, created_at')
    .eq('empleado_id', empleadoId)
    .eq('fue_liquidado', false)
    .lte('fecha_adelanto', fechaFin)
  if (fechaInicio) query = query.gte('fecha_adelanto', fechaInicio)
  const { data, error } = await query.order('fecha_adelanto', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapAdelanto)
}

/* ─── Temporal: alta (registro, se paga en efectivo aparte) ───────── */

// v6.0: el temporal solo se registra (tarifa por hora copiada de
// configuracion_temporal). No genera jornada ni pago en el sistema.
// A2 (2026-07-30): exige tokenTurno — sin él, la RPC rechaza antes de
// tocar nada. Temporal no tiene FK a nadie, así que aquí el token solo
// prueba que hay una sesión válida, sin poder atarlo a un encargado
// específico (esta tabla no guarda encargado_id).
export async function registrarTemporal({ tokenTurno, nombre, horas = 0, destajo }) {
  const { data, error } = await supabase.rpc('registrar_temporal', {
    p_token_turno:     tokenTurno,
    p_nombre_completo: nombre,
    p_horas:           horas,
    p_destajo:         destajo,
  })
  if (error) throw new Error(error.message)
  return data   // uuid
}

/* ─── Panel "Registrados" del encargado: recarga desde el servidor ──
   Ambas RPC derivan la furgoneta del token_turno ya validado (no de un
   parámetro del cliente) y devuelven solo lo registrado por ESTA
   furgoneta — así el panel sobrevive a salir y volver a entrar, en vez
   de vivir solo en memoria del navegador. */
export async function buscarJornadasFurgonetaDia(tokenTurno, fecha) {
  const { data, error } = await supabase.rpc('buscar_jornadas_furgoneta_dia', {
    p_token_turno: tokenTurno,
    p_fecha:       fecha,
  })
  if (error) throw new Error(error.message)
  return data ?? []   // [{ empleado_id, nombre_completo }]
}

export async function buscarTemporalesFurgonetaDia(tokenTurno) {
  const { data, error } = await supabase.rpc('buscar_temporales_furgoneta_dia', {
    p_token_turno: tokenTurno,
  })
  if (error) throw new Error(error.message)
  return data ?? []   // [{ id, nombre_completo, horas_trabajadas, destajo }]
}

/* ─── Multi-furgoneta por día ─────────────────────────────
 * Un encargado puede operar varias furgonetas distintas el mismo día
 * (nunca la misma dos veces). Cada furgoneta cierra sola al llegar a su
 * cupo de plazas; "Termina mi día" (cerrarJornadaEncargado) cierra de un
 * jalón las que sigan abiertas. Esta función es puramente informativa —
 * no afecta ninguna regla de negocio.
 */
export async function misFurgonetasHoy(tokenTurno) {
  const { data, error } = await supabase.rpc('mis_furgonetas_hoy', {
    p_token_turno: tokenTurno,
  })
  if (error) throw new Error(error.message)
  return data ?? []   // [{ furgoneta_id, apodo, plazas_ocupadas, registrados_hoy, cerrada }]
}

/* ─── Rehacer registro de una furgoneta (Central, solo hoy) ─────────────
 * Borra las jornada_empleado y la jornada_furgoneta de ESA furgoneta+
 * encargado+día, y TAMBIÉN la jornada_encargado del día completo —
 * decisión explícita del cliente: el "rehacer" debe alcanzar incluso al
 * caso en que el encargado ya cerró su día ("Termina mi día"). No arrastra
 * otras furgonetas que el mismo encargado haya tocado ese día
 * (jornada_furgoneta no tiene FK hacia jornada_encargado, solo comparten
 * encargado_id), pero si tenía otra furgoneta abierta, tendrá que
 * re-declarar sus horas del día completo al volver a cerrarlo. La RPC
 * rechaza si algo ya fue liquidado o si la fecha no es hoy.
 */
export async function reabrirJornadaFurgonetaDia({ encargadoId, furgonetaId, fecha }) {
  const { data, error } = await supabase.rpc('reabrir_jornada_furgoneta_dia', {
    p_encargado_id: encargadoId,
    p_furgoneta_id: furgonetaId,
    p_fecha:        fecha,
  })
  if (error) throw new Error(error.message)
  return data   // { empleados_eliminados }
}
