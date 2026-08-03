import { supabase } from '../supabase.js'

/**
 * ─── TRABAJADORES (empleados) ──────────────────────────────────────────────
 *
 * FIX: getTrabajadorPorId ahora funciona para admin Y para encargado.
 *
 * El encargado se autentica como anónimo (login_encargado RPC, no Supabase Auth).
 * La query directa a `empleados` requiere JWT admin → permission denied para anónimos.
 * Solución: intentar query directa primero (admin); si falla por permisos,
 * usar la RPC get_empleado_por_id que corre con SECURITY DEFINER (bypasea RLS).
 *
 * El encargado recibe solo: id, nombre, teléfono — sin tarifas ni saldos.
 * Los campos de salario no se muestran en SeccionEncargadoPage por diseño.
 */


// ── Mapeo v6.0 ⇄ app ────────────────────────────────────────────────────
// La tabla v6.0 usa nombre_completo / pago_x_hora / tipo_pago; la app usa
// nombre / tarifa_hora / payment_period. Se traduce en esta capa para no
// tocar formularios ni páginas. Ya no hay `activo` (borrado físico): se
// expone `activo: true` sintético para el código que aún lo lee.
const SELECT_EMPLEADO =
  'id, nombre:nombre_completo, telefono, codigo_corto, payment_period:tipo_pago, payment_period_pendiente:tipo_pago_pendiente, tarifa_hora:pago_x_hora, es_encargado'

const conActivo = (e) => e && { ...e, activo: true }

// Traduce un payload {nombre, tarifa_hora, payment_period, ...} de la app a
// las columnas v6.0. Solo incluye las claves presentes (para updates).
function aColumnasV6(datos) {
  const out = {}
  if ('nombre' in datos)                   out.nombre_completo     = datos.nombre
  if ('telefono' in datos)                 out.telefono            = datos.telefono
  if ('tarifa_hora' in datos)              out.pago_x_hora         = datos.tarifa_hora
  if ('payment_period' in datos)           out.tipo_pago           = datos.payment_period
  if ('payment_period_pendiente' in datos) out.tipo_pago_pendiente = datos.payment_period_pendiente
  if ('es_encargado' in datos)             out.es_encargado        = datos.es_encargado
  return out
}

// ── Admin: acceso completo ─────────────────────────────────────────────────

/**
 * `periodo = 'encargados'` filtra por `es_encargado`; otro valor filtra por
 * ciclo (`tipo_pago`). v6.0 ya no tiene empleados temporales en esta tabla
 * (viven en `temporal`), así que no hay filtro de `es_temporal`.
 */
export async function listarTrabajadores({ periodo = 'todos', busqueda = '' } = {}) {
  let query = supabase
    .from('empleados')
    .select(SELECT_EMPLEADO)
    .order('nombre_completo')

  if (periodo === 'encargados') {
    query = query.eq('es_encargado', true)
  } else if (periodo !== 'todos') {
    query = query.eq('tipo_pago', periodo)
  }

  if (busqueda) query = query.or(`nombre_completo.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%`)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map(conActivo)
}

/**
 * Obtiene un empleado por UUID o por su código corto numérico
 * (codigo_corto, mostrado bajo el QR para entrada manual).
 * Funciona tanto para admin (query directa, todos los campos)
 * como para encargado (RPC SECURITY DEFINER, solo campos básicos).
 */
// A2 (2026-07-30): tokenTurno opcional — el fallback a la RPC solo lo
// exige un rol sin sesión (encargado); el admin siempre resuelve por la
// query directa de arriba y nunca llega a este branch.
export async function getTrabajadorPorId(id, tokenTurno = null) {
  const valor = String(id).trim()
  // Si es solo dígitos, se trata del codigo_corto; si no, es el UUID
  const esCodigoCorto = /^\d+$/.test(valor)
  const columna       = esCodigoCorto ? 'codigo_corto' : 'id'
  const valorConsulta = esCodigoCorto ? Number(valor) : valor

  // Intento 1: query directa — funciona si el usuario tiene JWT admin
  const { data, error } = await supabase
    .from('empleados')
    .select(SELECT_EMPLEADO)
    .eq(columna, valorConsulta)
    .single()

  if (!error) return conActivo(data)   // admin → OK

  // Si el error es de permisos (encargado anónimo → permission denied / no rows)
  // caer a la RPC que bypasea RLS
  const isPermissionError =
    error.code === 'PGRST116' ||          // 0 rows (RLS filtró el resultado)
    error.message?.includes('permission') ||
    error.message?.includes('denied') ||
    error.message?.includes('policy')

  if (!isPermissionError) throw new Error(error.message) // error real, propagar

  // Intento 2: RPC con SECURITY DEFINER — funciona para anónimos (encargado)
  const rpcName   = esCodigoCorto ? 'get_empleado_por_codigo' : 'get_empleado_por_id'
  const rpcParams = esCodigoCorto
    ? { p_token_turno: tokenTurno, p_codigo: valorConsulta }
    : { p_token_turno: tokenTurno, p_empleado_id: valorConsulta }

  const { data: rpcData, error: rpcError } = await supabase.rpc(rpcName, rpcParams)

  if (rpcError) throw new Error(rpcError.message)

  const empleado = Array.isArray(rpcData) ? rpcData[0] : rpcData
  if (!empleado) throw new Error('Trabajador no encontrado.')

  // La RPC devuelve nombre_completo → mapear a la forma que usa la app.
  return conActivo({
    id: empleado.id,
    nombre: empleado.nombre_completo,
    telefono: empleado.telefono,
    codigo_corto: empleado.codigo_corto,
  })
}

// Traduce errores crudos de Postgres a mensajes legibles. Defensa en
// profundidad: los formularios ya bloquean esto del lado del cliente, esto
// cubre cualquier otra vía que llegue directo a la tabla.
function traducirErrorEmpleado(error) {
  if (error.code === '23505' || error.message?.includes('empleados_telefono_key')) {
    return new Error('Ya existe un trabajador registrado con este número de teléfono.')
  }
  if (error.message?.includes('empleados_telefono_formato')) {
    return new Error('El teléfono debe tener entre 9 y 15 dígitos.')
  }
  if (error.message?.includes('pago_x_hora')) {
    return new Error('La tarifa por hora debe ser mayor a 0.')
  }
  return new Error(error.message)
}

export async function crearTrabajador(payload) {
  const { data, error } = await supabase
    .from('empleados').insert(aColumnasV6(payload)).select(SELECT_EMPLEADO).single()
  if (error) throw traducirErrorEmpleado(error)
  return conActivo(data)
}

export async function actualizarTrabajador(id, datos) {
  const { data, error } = await supabase
    .from('empleados')
    .update(aColumnasV6(datos))
    .eq('id', id)
    .select(SELECT_EMPLEADO)
    .single()
  if (error) throw traducirErrorEmpleado(error)
  return conActivo(data)
}

/**
 * Decide qué guardar en payment_period_pendiente dado el valor vigente, lo
 * que ya estaba esperando, y lo que el admin acaba de elegir en el
 * formulario. Nunca toca payment_period — eso solo lo hace
 * promoverTipoPagoPendiente, y solo tras un pago exitoso.
 */
export function resolverPendientePeriodo(actual, pendiente, elegido) {
  if (elegido === actual) return null   // revirtió al valor vigente → limpiar
  return elegido                        // cualquier otro caso: guardar tal cual
}

/**
 * Si el empleado tiene un cambio de periodicidad pendiente, lo aplica:
 * payment_period pasa a valer lo que estaba en payment_period_pendiente, y
 * el pendiente se limpia. Se llama únicamente justo después de que un pago
 * a ese empleado se ejecutó con éxito — nunca antes, y nunca desde el flujo
 * de baja (dar_de_baja_empleado borra la fila entera, no hay nada que
 * promover).
 *
 * Best-effort a propósito: en este punto el pago ya ocurrió y es
 * irreversible (dinero movido, jornadas liquidadas). Un fallo acá — el
 * empleado se dio de baja en el ínterin, un hipo de red, lo que sea — nunca
 * debe aparentar que el pago falló ni cortar el resto de un lote de pagos
 * (generarListaPago no es atómico entre items). Si falla, el pendiente
 * simplemente se queda esperando y se reintenta solo en el próximo pago.
 *
 * Devuelve el `payment_period` ANTERIOR a la promoción (o null si no había
 * nada pendiente que promover) — `generarListaPago` lo guarda en
 * `lista_pago_detalle.tipo_pago_anterior` para que `cancelar_lista_pago`
 * (RPC) pueda reconstruir el estado exacto si esta lista se cancela: sin
 * este dato, cancelar una lista revierte el dinero pero deja al empleado
 * atrapado en el ciclo nuevo para siempre, con el cambio de periodicidad ya
 * "gastado" aunque el pago que lo disparó se haya deshecho.
 */
export async function promoverTipoPagoPendiente(empleadoId) {
  try {
    const { data, error } = await supabase
      .from('empleados')
      .select('payment_period:tipo_pago, payment_period_pendiente:tipo_pago_pendiente')
      .eq('id', empleadoId)
      .single()
    if (error) throw error
    if (!data.payment_period_pendiente) return null

    const anterior = data.payment_period
    await actualizarTrabajador(empleadoId, {
      payment_period:            data.payment_period_pendiente,
      payment_period_pendiente:  null,
    })
    return anterior
  } catch (err) {
    console.error(`No se pudo promover tipo_pago_pendiente de ${empleadoId}:`, err.message)
    return null
  }
}

// Baja con liquidación forzada — Fase A (solo lectura, se puede repetir).
// Calcula, sin escribir nada, cuánto se le debe al trabajador barriendo
// jornada_empleado + jornada_encargado (sin importar su rol actual) menos
// adelanto_empleado, todo con fue_liquidado = false y sin filtro de fecha.
export async function calcularBajaTrabajador(id) {
  const { data, error } = await supabase.rpc('calcular_baja_empleado', { p_empleado_id: id })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return {
    total_devengado: Number(r?.total_devengado ?? 0),
    total_adelantos: Number(r?.total_adelantos ?? 0),
    monto_neto: Number(r?.monto_neto ?? 0),
  }
}

// Baja con liquidación forzada — Fase B (transaccional). Recalcula el mismo
// monto en el servidor y lo compara contra `montoEsperado` (el que vio el
// admin en el modal); si difiere, aborta con la cifra nueva. Si coincide,
// genera el recibo, marca todo como liquidado y borra al trabajador — las
// tres cosas en la misma transacción de la RPC.
export async function darDeBajaTrabajador({ id, montoEsperado, periodoInicio, periodoFin }) {
  const { data, error } = await supabase.rpc('dar_de_baja_empleado', {
    p_empleado_id: id,
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

/**
 * Balance pendiente del trabajador (RPC). Solo el admin lo usa — el
 * encargado no ve salarios por diseño.
 *
 * `fechaFin` es obligatorio: la RPC ya NO calcula fechas por su cuenta
 * (tenía su propio corte de calendario fijo, 1-15/16-fin de mes, que se
 * desincronizó del modelo rodante — bug real encontrado en testeo
 * 2026-08-02). El caller debe resolverlo con `getCicloActivoAPagar`
 * (`records.js`) — el ciclo específico a pagar (candado global), no
 * cualquier fecha suelta. `null`/vacío → sin nada pendiente, saldo 0.
 */
export async function getBalanceTrabajador(id, fechaFin) {
  if (!fechaFin) return 0
  const { data, error } = await supabase
    .rpc('calcular_balance_trabajador', { p_empleado_id: id, p_fin_arrastre: fechaFin })
  if (error) throw new Error(error.message)
  return Number(data) || 0
}

/**
 * Tarifa inicial de autoregistro (configuracion_empleado, fila única).
 * La usa `registrar_trabajador_con_pin` del lado del servidor — esto solo
 * la lee/edita para la pantalla de configuración en Central.
 */
export async function getConfiguracionEmpleado() {
  const { data, error } = await supabase
    .from('configuracion_empleado')
    .select('id, tarifa_hora_inicial, updated_at')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarTarifaInicial(tarifaHoraInicial) {
  const config = await getConfiguracionEmpleado()
  if (!config) throw new Error('No existe configuración inicial de empleados.')
  const { data, error } = await supabase
    .from('configuracion_empleado')
    .update({ tarifa_hora_inicial: tarifaHoraInicial, updated_at: new Date().toISOString() })
    .eq('id', config.id)
    .select('id, tarifa_hora_inicial, updated_at')
    .single()
  if (error) throw new Error(error.message)
  return data
}
