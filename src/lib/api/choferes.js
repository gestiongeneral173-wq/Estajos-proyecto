import { supabase } from '../supabase.js'

/**
 * ─── CHOFER ──────────────────────────────────────────────────────────────
 * Rol de "chofer del día" para una furgoneta: cualquier empleado (incluido
 * el propio encargado) puede asumirlo. Cuenta como una plaza ocupada y
 * queda excluido del buscador de empleados ese día (global, no solo en su
 * furgoneta).
 *
 * El pago del chofer es puramente informativo — nunca se suma a
 * getResumenPagos / getDatosCicloParaPago / generarListaPago ni a la
 * planilla de ResumenPage. Al pagarlo se BORRA (no se marca liquidado):
 * decisión explícita del cliente, no queda historial.
 */

// ── Configuración de tarifa (fila única, mismo patrón que configuracion_temporal) ──
export async function getConfiguracionChofer() {
  const { data, error } = await supabase
    .from('configuracion_chofer')
    .select('id, tarifa_hora_chofer, updated_at')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarTarifaChofer(tarifaHoraChofer) {
  const config = await getConfiguracionChofer()
  if (!config) throw new Error('No existe configuración de chofer.')
  const { data, error } = await supabase
    .from('configuracion_chofer')
    .update({ tarifa_hora_chofer: tarifaHoraChofer, updated_at: new Date().toISOString() })
    .eq('id', config.id)
    .select('id, tarifa_hora_chofer, updated_at')
    .single()
  if (error) throw new Error(error.message)
  return data
}

/* ─── Flujo del encargado ──────────────────────────────────────────────── */

// Empleados elegibles como chofer hoy — a diferencia de buscarEmpleadosEncargado,
// SÍ incluye a los encargados (puede ser el mismo encargado).
export async function listarEmpleadosParaChofer(tokenTurno) {
  const { data, error } = await supabase
    .rpc('listar_empleados_para_chofer', { p_token_turno: tokenTurno })
  if (error) throw new Error(error.message)
  return data ?? []   // [{ id, nombre }]
}

// Registra plazas + asigna chofer en una sola transacción (reemplaza a
// registrarPlazasVehiculo en el flujo del encargado).
export async function asignarPlazasYChofer({ tokenTurno, vehiculoId, plazas, empleadoChoferId }) {
  const { data, error } = await supabase.rpc('asignar_plazas_y_chofer', {
    p_token_turno:        tokenTurno,
    p_furgoneta_id:       vehiculoId,
    p_plazas:             plazas,
    p_empleado_chofer_id: empleadoChoferId,
  })
  if (error) throw new Error(error.message)
  return data   // uuid (jornada_furgoneta.id)
}

// Cierra las horas del chofer de la furgoneta activa del turno (sin destajo).
export async function cerrarHorasChofer({ tokenTurno, horas }) {
  const { error } = await supabase.rpc('cerrar_horas_chofer', {
    p_token_turno: tokenTurno,
    p_horas:       horas,
  })
  if (error) throw new Error(error.message)
}

/* ─── Pago (Central · ResumenPage) ──────────────────────────────────────
 * Puramente informativo: nunca toca jornada_empleado/jornada_encargado ni
 * ningún ciclo. "Pagar" borra las filas ya cerradas de ese empleado.
 */

export async function listarChoferesPendientesDePago() {
  const { data, error } = await supabase.rpc('listar_choferes_pendientes_de_pago')
  if (error) throw new Error(error.message)
  return data ?? []   // [{ empleado_id, nombre, veces, total }]
}

// Fase A: recalcula el total antes de pagar (evita pagar de más si cambió
// entre que se mostró la pantalla y se confirmó el pago).
export async function calcularPagoChofer(empleadoId) {
  const { data, error } = await supabase.rpc('calcular_pago_chofer', { p_empleado_id: empleadoId })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return { veces: Number(r?.veces ?? 0), total: Number(r?.total ?? 0) }
}

// Fase B: transaccional, compara contra el monto mostrado en pantalla y
// BORRA los registros pagados (no se guarda historial).
export async function pagarChofer({ empleadoId, totalEsperado }) {
  const { data, error } = await supabase.rpc('pagar_chofer', {
    p_empleado_id:    empleadoId,
    p_monto_esperado: totalEsperado,
  })
  if (error) throw new Error(error.message)
  const r = Array.isArray(data) ? data[0] : data
  return { veces: Number(r?.veces ?? 0), total_pagado: Number(r?.total_pagado ?? 0) }
}
