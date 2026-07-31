/**
 * ─── CICLOS DE PAGO ──────────────────────────────────────────────────
 * Única fuente de verdad para calcular el período activo de un ciclo
 * (quincenal / mensual). Vive en su propio módulo porque lo consume tanto
 * la Lista de Pago (paymentLists.js) como Escanear (EscanearPage) y el
 * Resumen General (records.js) — un solo lugar para tocar si el negocio
 * cambia la regla de corte, en vez de copias sueltas por pantalla.
 *
 * Modelo: ciclo RODANTE, sin alinearse al mes calendario. Ancla fija:
 * arranque real de producción del sistema, 1 de agosto de 2026, hora de
 * Barcelona (Europe/Madrid). Desde ahí, bloques corridos de 15 días
 * (quincenal) o 30 días (mensual), sin parar y sin reiniciar cada mes.
 *
 * Dentro de cada bloque, el último día NO acumula — es exclusivamente el
 * día de pago, y el bloque siguiente arranca al día siguiente. Ej.
 * quincenal: bloque 1 acumula 01–14 ago, paga el 15; bloque 2 acumula
 * 16–29 ago, paga el 30; bloque 3 acumula 31 ago–13 sep, paga el 14 sep
 * — el corte se va recorriendo, nunca vuelve al día 1 de cada mes.
 *
 * `fin` (lo que consumen las consultas de jornadas/adelantos pendientes)
 * es el último día que SÍ acumula — nunca el día de pago. Gracias a eso,
 * el mecanismo de arrastre (ver getDatosCicloParaPago) desbloquea el pago
 * exactamente el día de pago sin necesitar ninguna comparación de fecha
 * aparte: en cuanto el bloque activo avanza, el dinero del bloque anterior
 * queda con fecha anterior al nuevo `inicio` y se vuelve arrastre, pagable
 * de inmediato.
 */

const ANCLA = '2026-08-01'
const ZONA_HORARIA = 'Europe/Madrid'

// 'YYYY-MM-DD' de una fecha en hora de Barcelona — la ancla del sistema se
// definió en esa zona horaria, así que "en qué bloque estamos hoy" debe
// calcularse desde ahí, sin importar la zona horaria del dispositivo.
function fechaISOenMadrid(fecha) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(fecha)
}

// Diferencia en días de calendario entre dos 'YYYY-MM-DD' — en UTC, para
// no arrastrar el huso horario del navegador ni horario de verano.
function diasEntreISO(desdeISO, hastaISO) {
  const [ay, am, ad] = desdeISO.split('-').map(Number)
  const [by, bm, bd] = hastaISO.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

function sumarDiasISO(iso, dias) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

const fmtCorta = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }

export function calcularPeriodoCiclo(ciclo, fechaRef = new Date()) {
  const duracion = ciclo === 'quincenal' ? 15 : 30
  const hoyISO = fechaISOenMadrid(fechaRef)

  // Antes de la ancla (no debería pasar en producción, solo en pruebas):
  // se fija en el primer bloque para no calcular con días negativos.
  const diasTranscurridos = Math.max(0, diasEntreISO(ANCLA, hoyISO))
  // El +1 hace que el día de pago mismo ya cuente como parte del bloque
  // SIGUIENTE (no del que está pagando) — si no, el día de pago quedaba
  // bloqueado hasta el día después, un día tarde respecto a "el día X es
  // día de pago".
  const numeroBloque = Math.floor((diasTranscurridos + 1) / duracion)

  const inicio  = sumarDiasISO(ANCLA, numeroBloque * duracion)
  const fin     = sumarDiasISO(inicio, duracion - 2) // último día que acumula
  const diaPago = sumarDiasISO(inicio, duracion - 1) // no acumula, solo paga

  return {
    inicio, fin, diaPago,
    label: `${fmtCorta(inicio)}–${fmtCorta(fin)} · paga ${fmtCorta(diaPago)}`,
  }
}
