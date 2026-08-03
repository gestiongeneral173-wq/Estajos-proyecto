/**
 * ─── CICLOS DE PAGO ──────────────────────────────────────────────────
 * Única fuente de verdad para calcular, dado un tipo de ciclo (quincenal /
 * mensual) Y UNA FECHA DE REFERENCIA, a qué bloque de días pertenece esa
 * fecha (`inicio`, `fin`, `diaPago`). Vive en su propio módulo porque es
 * pura matemática de fechas, sin acceso a base de datos.
 *
 * Modelo (2026-08-02, corregido): ciclo RODANTE, bloques CONTIGUOS de 14
 * días (quincenal) o 30 días (mensual) — sin alinearse al mes calendario,
 * sin parar y sin reiniciar cada mes. Solo esos días acumulan trabajo; el
 * día de pago de un bloque es exactamente el primer día del bloque
 * SIGUIENTE — no existe ningún día "puente" suelto que no pertenezca a
 * ningún bloque. Ej. quincenal con ancla 01/07: bloque 1 acumula 01–14
 * jul, paga (= arranca el bloque 2) el 15 jul; bloque 2 acumula 15–28 jul,
 * paga el 29 jul; y así sin parar.
 *
 * Por qué importa que sean contiguos: antes había un día de pago "hueco"
 * entre bloques que no pertenecía a ninguno — si alguien registraba
 * trabajo real justo ese día (nada lo impide en campo), esa jornada
 * quedaba huérfana y aparecía mal repartida entre ciclos. Con bloques
 * contiguos, cualquier fecha pertenece a EXACTAMENTE un bloque, sin
 * ambigüedad ni casos especiales.
 *
 * "Qué ciclo hay que pagar AHORA" no se calcula pasando `fechaRef = hoy`
 * a esta función directamente en las pantallas de pago. El pago es un
 * candado GLOBAL de un ciclo a la vez (decisión de negocio del cliente):
 * no se puede cobrar el ciclo N+1 mientras quede alguien sin cobrar del
 * ciclo N, sin importar cuántos ciclos más recientes ya hayan pasado, y
 * tampoco se avanza hasta que el admin confirma explícitamente que el
 * ciclo N ya se liquidó por completo. Ese mecanismo vive en
 * `getCicloActivoAPagar` (records.js, empleados) y
 * `getCicloActivoAPagarVehiculo` (vehicles.js, furgonetas): encuentran la
 * fecha pendiente más antigua de TODA la nómina de ese tipo_pago y le
 * pasan ESA fecha (no `new Date()`) a `calcularPeriodoCiclo` de aquí — el
 * bloque que devuelve es "el ciclo a pagar". Esta función solo sabe "qué
 * bloque contiene esta fecha", nunca "cuál es el ciclo actual del
 * negocio" — esa decisión vive un nivel arriba, con acceso a la BD.
 */

// ⚠️ TEMPORAL — SOLO PARA TESTEO: ancla movida al 1 de julio a pedido
// explícito, para que el ciclo de prueba arranque justo donde arranca la
// data de prueba (jornadas del 1 jul en adelante).
// VALOR ORIGINAL DE PRODUCCIÓN: '2026-08-01' — revertir a ese valor al
// terminar la prueba, antes de que esto se use de verdad.
const ANCLA = '2026-08-03'
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
  // `duracion` = días que de verdad acumulan trabajo (14 para quincenal,
  // no 15 — el día de pago no cuenta como uno de los días del bloque,
  // es el primer día del bloque siguiente).
  const duracion = ciclo === 'quincenal' ? 14 : 30
  const hoyISO = fechaISOenMadrid(fechaRef)

  // Antes de la ancla (no debería pasar en producción, solo en pruebas):
  // se fija en el primer bloque para no calcular con días negativos.
  const diasTranscurridos = Math.max(0, diasEntreISO(ANCLA, hoyISO))
  // Bloques contiguos: no hace falta ningún ajuste "+1" — cada fecha
  // pertenece a exactamente un bloque por división entera simple, incluida
  // una fecha que sea justo el día de pago de OTRO bloque (ese día ya ES
  // el `inicio` del bloque siguiente, por construcción).
  const numeroBloque = Math.floor(diasTranscurridos / duracion)

  const inicio  = sumarDiasISO(ANCLA, numeroBloque * duracion)
  const fin     = sumarDiasISO(inicio, duracion - 1)  // último día que acumula
  const diaPago = sumarDiasISO(fin, 1)                 // = inicio del bloque siguiente

  return {
    inicio, fin, diaPago,
    label: `${fmtCorta(inicio)}–${fmtCorta(fin)} · paga ${fmtCorta(diaPago)}`,
  }
}
