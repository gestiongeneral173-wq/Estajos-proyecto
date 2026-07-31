import { supabase } from '../supabase.js'

/**
 * ─── AUTENTICACIÓN ─────────────────────────────────────────
 *
 * Toda la validación segura ocurre en FUNCIONES RPC de Postgres
 * (ver supabase/migrations/002_full_functional_schema.sql).
 * NO se usan Edge Functions → no requiere Docker ni despliegues.
 *
 * Tres flujos:
 *   1. Trabajador — login/registro por teléfono (RPC)
 *   2. Encargado  — teléfono + PIN del VEHÍCULO (RPC)
 *   3. Admin      — email + password (Supabase Auth nativo)
 */

/* ────────────────────────────────────────────────────────────
 *  1. TRABAJADOR
 * ──────────────────────────────────────────────────────────── */

// v6.0: la columna se llama `nombre_completo`; la app usa `nombre`. Se
// remapea aquí para no tocar las pantallas.
const mapEmpleado = (e) => e && ({
  id: e.id,
  nombre: e.nombre_completo,
  codigo_corto: e.codigo_corto,
  es_encargado: e.es_encargado,
})

/**
 * Login de Trabajador por teléfono.
 * @returns {Promise<{id, nombre, codigo_corto, es_encargado}>}
 */
export async function loginTrabajador(telefono) {
  const { data, error } = await supabase
    .rpc('login_trabajador', { p_telefono: telefono })

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Teléfono no registrado')
  return mapEmpleado(data[0])
}

/**
 * Lookup de rol por teléfono (login unificado — Cambio #8).
 * Devuelve { id, nombre, codigo_corto, es_encargado } o lanza si no existe.
 */
export async function buscarRolPorTelefono(telefono) {
  const { data, error } = await supabase
    .rpc('buscar_rol_por_telefono', { p_telefono: telefono })
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Teléfono no registrado')
  return mapEmpleado(data[0])
}

/* ────────────────────────────────────────────────────────────
 *  1b. PIN DE REGISTRO  (Cambio #7)
 * ──────────────────────────────────────────────────────────── */

/** Valida un PIN de registro. @returns {valido, cupo_restante, mensaje} */
export async function validarPinRegistro(pin) {
  const { data, error } = await supabase
    .rpc('validar_pin_registro', { p_pin: pin })
  if (error) throw new Error(error.message)
  return data?.[0] ?? { valido: false, cupo_restante: 0, mensaje: 'PIN no válido' }
}

/** Registra un trabajador consumiendo un cupo del PIN. @returns {id, nombre, codigo_corto} */
export async function registrarTrabajadorConPin({ pin, nombre, telefono }) {
  const { data, error } = await supabase
    .rpc('registrar_trabajador_con_pin', { p_pin: pin, p_nombre_completo: nombre, p_telefono: telefono })
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('No se pudo registrar')
  return mapEmpleado(data[0])
}

/**
 * Genera un PIN de registro (solo admin). En v6.0 el parámetro es
 * `maximo_uso`; se devuelve `cupo_total` (alias de `maximo_uso`) para no
 * tocar la pantalla que lo muestra.
 * @returns {pin, cupo_total, expires_at}
 */
export async function generarPinRegistro(maximoUso) {
  const { data, error } = await supabase
    .rpc('generar_pin_registro', { p_maximo_uso: maximoUso })
  if (error) throw new Error(error.message)
  const r = data?.[0]
  return r ? { pin: r.pin, cupo_total: r.maximo_uso, expires_at: r.expires_at } : null
}

/**
 * Lista los PINs de registro todavía vigentes (no vencidos). Un PIN agotado
 * o cancelado se borra al instante por trigger/RPC en el servidor, así que
 * lo único que puede aparecer aquí es lo que sigue activo dentro de su
 * ventana de 24h. Se filtra `expires_at` en el cliente porque la purga de
 * vencidos no corre en el servidor — sin este filtro, un PIN ya caducado
 * pero aún no borrado se listaría como si todavía sirviera.
 */
export async function listarPinesRegistro() {
  const { data, error } = await supabase
    .from('pin_registro_inicial')
    .select('id, pin, maximo_uso, cantidad_uso, activo, created_at, expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Cancela (elimina) un PIN de registro antes de que se agote su cupo. */
export async function cancelarPinRegistro(id) {
  const { error } = await supabase.rpc('cancelar_pin_registro', { p_id: id })
  if (error) throw new Error(error.message)
}

/* ────────────────────────────────────────────────────────────
 *  2. ENCARGADO  (teléfono + PIN del vehículo)
 * ──────────────────────────────────────────────────────────── */

/**
 * Login de Encargado. El "encargado" es cualquier empleado que conoce
 * el PIN de un vehículo. Devuelve sus datos + el vehículo asociado.
 *
 * A2 (2026-07-30): la RPC ahora también emite un token de turno
 * (`turno_token`) — la prueba de que este login sí ocurrió, que las RPC
 * de campo van a exigir de aquí en adelante. Vive solo en memoria
 * (authStore), nunca en localStorage.
 *
 * @returns {Promise<{empleado_id, empleado_nombre, vehiculo_id, vehiculo_nombre, token_turno}>}
 */
export async function loginEncargado(telefono, pinVehiculo) {
  const { data, error } = await supabase
    .rpc('login_encargado', {
      p_telefono: telefono,
      p_pin:      pinVehiculo
    })

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Datos incorrectos')
  // v6.0 devuelve furgoneta_id/furgoneta_apodo; la app usa vehiculo_*.
  const r = data[0]
  return {
    empleado_id:     r.empleado_id,
    empleado_nombre: r.empleado_nombre,
    vehiculo_id:     r.furgoneta_id,
    vehiculo_nombre: r.furgoneta_apodo,
    token_turno:     r.token_turno,
  }
}

/* ────────────────────────────────────────────────────────────
 *  3. ADMIN (Central) — Supabase Auth
 * ──────────────────────────────────────────────────────────── */

export async function loginAdmin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return data
}

export async function logout() {
  await supabase.auth.signOut()
}

/**
 * Devuelve la sesión actual de admin (o null).
 */
export async function getSesionAdmin() {
  const { data } = await supabase.auth.getSession()
  return data?.session ?? null
}

/** Cambia la contraseña del admin actualmente logueado (Supabase Auth). */
export async function cambiarPasswordAdmin(nuevaPassword) {
  const { error } = await supabase.auth.updateUser({ password: nuevaPassword })
  if (error) throw new Error(error.message)
}
