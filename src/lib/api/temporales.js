import { supabase } from '../supabase.js'

/**
 * ─── TEMPORALES ─────────────────────────────────────────────────────────
 * `temporal` vive deliberadamente aislado del resto de la nómina (sin FK a
 * nada) — se purga solo, vía cron diario a la 1 AM. El CRUD completo
 * (incluido eliminar) es exclusivo del admin (RLS: `admin_temporal FOR
 * ALL`); el encargado solo tiene Insert, vía la RPC `registrar_temporal`.
 */

// ── Configuración de tarifa (fila única, mismo patrón que configuracion_empleado) ──
export async function getConfiguracionTemporal() {
  const { data, error } = await supabase
    .from('configuracion_temporal')
    .select('id, tarifa_hora_temporal, updated_at')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarTarifaTemporal(tarifaHoraTemporal) {
  const config = await getConfiguracionTemporal()
  if (!config) throw new Error('No existe configuración de temporales.')
  const { data, error } = await supabase
    .from('configuracion_temporal')
    .update({ tarifa_hora_temporal: tarifaHoraTemporal, updated_at: new Date().toISOString() })
    .eq('id', config.id)
    .select('id, tarifa_hora_temporal, updated_at')
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ── Listado y borrado de temporales ──
export async function listarTemporales() {
  const { data, error } = await supabase
    .from('temporal')
    .select('id, nombre_completo, trabajo_x_hora, horas_trabajadas, destajo, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function eliminarTemporal(id) {
  const { error } = await supabase.from('temporal').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Borra todos los registros de temporal — la misma purga que ya hace el
// cron diario a la 1 AM, pero manual. El filtro `.gte()` es solo una
// salvaguarda explícita (algunos clientes rechazan un DELETE sin ninguna
// condición); no cambia qué se borra, ya que RLS de todos modos limita
// esto al admin.
export async function eliminarTodosLosTemporales() {
  const { error } = await supabase.from('temporal').delete().gte('created_at', '1900-01-01')
  if (error) throw new Error(error.message)
}
