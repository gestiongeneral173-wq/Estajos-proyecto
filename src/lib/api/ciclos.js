/**
 * ─── CICLOS DE PAGO ──────────────────────────────────────────────────
 * Única fuente de verdad para calcular el período activo de un ciclo
 * (quincenal / mensual) a partir de una fecha de referencia (hoy por
 * defecto). Vive en su propio módulo porque lo consume tanto la Lista de
 * Pago (paymentLists.js) como el Resumen General (records.js) — antes
 * "Resumen" sumaba todo lo pendiente sin fecha, sin coordinarse con este
 * cálculo, y podía arrastrar montos de ciclos ya cerrados que la Lista de
 * Pago (sí acotada al ciclo activo) nunca iba a poder pagar.
 */
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
