import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, FileSpreadsheet, Printer, Search, Download, Plus, X, Trash2, AlertTriangle } from 'lucide-react'
import * as XLSX from 'xlsx'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Button        from '../../components/ui/Button.jsx'
import Input         from '../../components/ui/Input.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'
import StatCard      from '../../components/domain/StatCard.jsx'
import Modal         from '../../components/ui/Modal.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout } from '../../lib/api/auth.js'
import {
  getResumenPagos, getCicloPendienteDeConfirmar, confirmarCicloPagado,
  esListaDeCicloConfirmado,
} from '../../lib/api/records.js'
import {
  getResumenPagosVehiculos, getCicloPendienteDeConfirmarVehiculo,
  confirmarCicloPagadoVehiculo,
} from '../../lib/api/vehicles.js'
import {
  getDatosCicloParaPago, generarListaPago, listarListasPago,
  getItemsListaPagoConJornadas, cancelarListaPago, ocultarListaPago
} from '../../lib/api/paymentLists.js'
import {
  listarChoferesPendientesDePago, calcularPagoChofer, pagarChofer,
} from '../../lib/api/choferes.js'

//IMPORTACIÓN IMPORTANTE:  Direccion de constants.js : Para el uso de direcciones
import { Direccion } from '../../utils/constants.js'

// Fechas simples ("2026-07-27", sin hora) se interpretan como medianoche
// UTC si se le pasan tal cual a `new Date()`, y en una zona horaria detrás
// de UTC (México) eso muestra el día ANTERIOR. Forzamos hora local
// agregando 'T00:00:00' cuando el string no la trae ya.
const fmtCorta = (s) =>
  new Date(/T/.test(s) ? s : `${s}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })

const CICLO_BADGE = {
  quincenal: 'bg-purple-50 text-purple-600',
  mensual:   'bg-blue-50 text-blue-600',
}

// Texto bajo cada StatCard de Resumen: qué ciclo se está pagando ahora
// mismo (candado global, ver getCicloActivoAPagar/getCicloActivoAPagarVehiculo).
// `periodo.label` ya viene armado desde ciclos.js ("01/07–14/07 · paga
// 15/07"). Se recalcula fresco en cada carga de la página, así que en
// cuanto ese ciclo llega a €0 (todos pagados), la siguiente carga ya
// muestra el ciclo siguiente solo — sin ningún interruptor manual.
function CicloAPagarBanner({ quincenal, mensual }) {
  const Item = ({ tipo, label, periodo }) => (
    <div className={`rounded-lg px-3 py-2 ${CICLO_BADGE[tipo]}`}>
      <p className="text-[9px] font-bold uppercase tracking-wide opacity-70">{label}</p>
      {periodo ? (
        <p className="text-xs font-semibold whitespace-nowrap">
          Del {fmtCorta(periodo.inicio)} al {fmtCorta(periodo.fin)}
        </p>
      ) : (
        <p className="text-xs font-medium opacity-60">Sin ciclo pendiente</p>
      )}
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <Item tipo="quincenal" label="Quincenal" periodo={quincenal} />
      <Item tipo="mensual" label="Mensual" periodo={mensual} />
    </div>
  )
}


// Eje de columnas día-por-día, compartido por la planilla del ciclo y la
// lista de pago imprimible (cada una con su propio rango inicio/fin).
function diasEntre(inicio, fin) {
  if (!inicio || !fin) return []
  const dias = []
  let d = new Date(inicio + 'T00:00:00')
  const f = new Date(fin + 'T00:00:00')
  while (d <= f) {
    dias.push({
      iso: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    })
    d = new Date(d.getTime() + 86400000)
  }
  return dias
}

// 'YYYY-MM-DD' menos N días — usado para topar cuánto puede ensancharse
// hacia atrás la grilla de columnas de la planilla (ver diasDelPeriodo).
function restarDias(iso, dias) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

// Cambio 1.4.3 / RF-018 (Octava llamada): "día/mes" numérico exacto para el
// encabezado de cada columna del Excel — a diferencia de la planilla
// imprimible (que usa el mes abreviado), el documento pide explícitamente
// el formato día/mes.
function fmtDiaMes(iso) {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

export default function ResumenPage() {
  const navigate = useNavigate()
  const { rol, clear } = useAuthStore()
  // { quincenal: { total, periodo }, mensual: { total, periodo } } — `periodo`
  // es el ciclo A PAGAR (candado global, ver getCicloActivoAPagar), null si
  // no hay nada pendiente de ningún ciclo de ese tipo.
  const statsVacio = { quincenal: { total: 0, periodo: null }, mensual: { total: 0, periodo: null } }
  const [stats, setStats] = useState(statsVacio)
  // Contador exclusivo de furgonetas — misma regla/ciclo que `stats`
  // (ver getResumenPagosVehiculos), pero sobre jornada_furgoneta /
  // adelanto_furgoneta en vez de jornada_empleado / adelanto_empleado.
  const [statsVehiculos, setStatsVehiculos] = useState(statsVacio)

  // Ciclos ya pagados por completo pero todavía sin confirmar/archivar.
  // null por tipo mientras no haya nada que confirmar.
  const confirmarVacio = { quincenal: null, mensual: null }
  const [confirmarEmpleado, setConfirmarEmpleado] = useState(confirmarVacio)
  const [confirmarVehiculo, setConfirmarVehiculo] = useState(confirmarVacio)
  const [confirmandoCiclo, setConfirmandoCiclo] = useState(false)

  // Alerta (Modal), no una tarjeta pasiva — el objetivo es avisar, no que
  // pase desapercibido. "NO" no confirma nada (el ciclo se queda tal cual
  // está); solo se descarta la ALERTA — vía `dismissedCiclos`, sin guardar
  // nada en la BD — para no insistir de inmediato con el mismo. El ciclo
  // descartado no desaparece: baja a un banner arriba de la página (ver
  // `pendientesDescartados`) que se puede tocar para volver a abrir la
  // misma alerta en cualquier momento, sin recargar la página. Si hay
  // varios pendientes (ej. quincenal Y mensual a la vez), la alerta
  // muestra de a uno.
  const [dismissedCiclos, setDismissedCiclos] = useState(new Set())

  const claveCiclo = (it) => `${it.tipoEntidad}-${it.tipo}-${it.periodo.fin}`

  const itemsAConfirmar = useMemo(() => [
    confirmarEmpleado.quincenal && { tipoEntidad: 'empleado', tipo: 'quincenal', periodo: confirmarEmpleado.quincenal },
    confirmarEmpleado.mensual   && { tipoEntidad: 'empleado', tipo: 'mensual',   periodo: confirmarEmpleado.mensual },
    confirmarVehiculo.quincenal && { tipoEntidad: 'furgoneta', tipo: 'quincenal', periodo: confirmarVehiculo.quincenal },
    confirmarVehiculo.mensual   && { tipoEntidad: 'furgoneta', tipo: 'mensual',   periodo: confirmarVehiculo.mensual },
  ].filter(Boolean), [confirmarEmpleado, confirmarVehiculo])

  const colaConfirmar = useMemo(
    () => itemsAConfirmar.filter((i) => !dismissedCiclos.has(claveCiclo(i))),
    [itemsAConfirmar, dismissedCiclos]
  )

  // Ciclos ya completados que el admin descartó con "NO" — siguen 100%
  // pendientes de confirmar, solo dejaron de mostrarse como alerta. Se
  // listan en el banner de arriba para poder reabrir la alerta cuando
  // quiera, en vez de tener que refrescar la página.
  const pendientesDescartados = useMemo(
    () => itemsAConfirmar.filter((i) => dismissedCiclos.has(claveCiclo(i))),
    [itemsAConfirmar, dismissedCiclos]
  )

  const cicloAConfirmar = colaConfirmar[0] ?? null

  const reabrirCicloDescartado = (item) => {
    setDismissedCiclos((prev) => {
      const next = new Set(prev)
      next.delete(claveCiclo(item))
      return next
    })
  }

  const cargarConfirmaciones = useCallback(async () => {
    try {
      const [eq, em, fq, fm] = await Promise.all([
        getCicloPendienteDeConfirmar('quincenal'),
        getCicloPendienteDeConfirmar('mensual'),
        getCicloPendienteDeConfirmarVehiculo('quincenal'),
        getCicloPendienteDeConfirmarVehiculo('mensual'),
      ])
      setConfirmarEmpleado({ quincenal: eq, mensual: em })
      setConfirmarVehiculo({ quincenal: fq, mensual: fm })
    } catch (err) { console.error(err) }
  }, [])

  // "NO" / cerrar la alerta: no toca la base de datos — el ciclo se queda
  // exactamente como estaba. Deja de aparecer como Modal y pasa al banner
  // de arriba (pendientesDescartados), desde donde se reabre con un toque.
  const descartarCicloAConfirmar = () => {
    if (!cicloAConfirmar) return
    setDismissedCiclos((prev) => new Set(prev).add(claveCiclo(cicloAConfirmar)))
  }

  const handleConfirmarCiclo = async () => {
    if (!cicloAConfirmar) return
    setConfirmandoCiclo(true)
    try {
      const { tipoEntidad, tipo, periodo } = cicloAConfirmar
      if (tipoEntidad === 'empleado') await confirmarCicloPagado(tipo, periodo.fin)
      else await confirmarCicloPagadoVehiculo(tipo, periodo.fin)
      // Confirmar avanza el candado global al siguiente ciclo — recarga
      // todo lo que depende de él (mismo trío que tras generar/cancelar una
      // lista) para que "Resumen General"/"Resumen Furgonetas" y la Lista
      // de Pago ya muestren el ciclo nuevo sin tener que refrescar la
      // página entera.
      await Promise.all([
        cargarConfirmaciones(),
        cargarCiclo(),
        cargarListas(),
        getResumenPagos().then(setStats),
        getResumenPagosVehiculos().then(setStatsVehiculos),
      ])
    } catch (err) { console.error(err) }
    finally { setConfirmandoCiclo(false) }
  }

  // Cambio 1.4.1 / 1.4.2 (Séptima llamada): datos del ciclo activo,
  // compartidos entre la Lista de Pago y la Planilla imprimible.
  const [ciclo, setCiclo]     = useState('quincenal')
  const [datos, setDatos]     = useState({ periodo: null, empleados: [] })
  const [cargandoCiclo, setCargandoCiclo] = useState(false)
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [generando, setGenerando] = useState(false)
  const [genError, setGenError]   = useState(null)

  // Cambio Décima: flujo de un solo punto de entrada "Generar lista".
  //  'idle'      → solo el botón "Generar lista" + historial.
  //  'seleccion' → buscador + checklist + sub-lista de seleccionados.
  //  'encargado' → captura del nombre de quien reparte el efectivo.
  const [modoLista, setModoLista]   = useState('idle')
  const [busqueda, setBusqueda]     = useState('')
  const [encargadoNombre, setEncargadoNombre] = useState('')

  const [listas, setListas]         = useState([])
  const [listaAbierta, setListaAbierta] = useState(null)
  const [itemsPorLista, setItemsPorLista] = useState({})

  // Bug fix: "EXPORTAR PLANILLA" e "IMPRIMIR" (de una lista) compartían el
  // mismo `window.print()`, y como solo la planilla completa tenía
  // `print:block`, imprimir una lista siempre sacaba la planilla entera.
  // Ahora cada botón marca qué bloque imprimir antes de llamar a print().
  const [listaAImprimir, setListaAImprimir] = useState(null)

  // Cancelar lista: revierte el pago (jornadas/adelantos vuelven a
  // fue_liquidado=false, se borra el pago) vía RPC `cancelar_lista_pago` y
  // borra la lista. Mismo patrón de confirmación que el resto de la app
  // (Modal + botón danger, nunca confirm() nativo).
  const [listaACancelar, setListaACancelar] = useState(null)
  const [cancelandoLista, setCancelandoLista] = useState(false)
  const [cancelarListaError, setCancelarListaError] = useState(null)
  // true si el ciclo de listaACancelar ya se confirmó/archivó — en ese caso
  // "CANCELAR" solo oculta la lista en vez de revertir el pago. null
  // mientras se resuelve (ver handleAbrirCancelarLista).
  const [listaACancelarEsConfirmada, setListaACancelarEsConfirmada] = useState(null)

  // ── Choferes: pago puramente informativo, sin ciclos ni jornadas — nunca
  // toca stats/datos/listas de arriba. "Pagar" recalcula en el momento
  // (evita pagar de más si cambió entre que se mostró la pantalla y se
  // confirmó) y BORRA el registro al confirmar; no queda historial, decisión
  // explícita del cliente.
  const [choferes, setChoferes]           = useState([])
  const [cargandoChoferes, setCargandoChoferes] = useState(true)
  const [choferAPagar, setChoferAPagar]   = useState(null) // { empleado_id, nombre, veces, total }
  const [pagandoChofer, setPagandoChofer] = useState(false)
  const [pagoChoferError, setPagoChoferError] = useState(null)

  const cargarChoferes = useCallback(() => {
    setCargandoChoferes(true)
    return listarChoferesPendientesDePago()
      .then(setChoferes)
      .catch(console.error)
      .finally(() => setCargandoChoferes(false))
  }, [])

  useEffect(() => { cargarChoferes() }, [cargarChoferes])

  const handleAbrirPagoChofer = async (c) => {
    setPagoChoferError(null)
    try {
      const fresco = await calcularPagoChofer(c.empleado_id)
      setChoferAPagar({ empleado_id: c.empleado_id, nombre: c.nombre, ...fresco })
    } catch (err) {
      setPagoChoferError(err.message)
    }
  }

  const handleConfirmarPagoChofer = async () => {
    if (!choferAPagar) return
    setPagandoChofer(true); setPagoChoferError(null)
    try {
      await pagarChofer({ empleadoId: choferAPagar.empleado_id, totalEsperado: choferAPagar.total })
      setChoferAPagar(null)
      await cargarChoferes()
    } catch (err) {
      setPagoChoferError(err.message)
    } finally {
      setPagandoChofer(false)
    }
  }

  useEffect(() => {
    //[Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login')
    if (rol !== 'admin') { navigate( Direccion.centralLogin , { replace: true }); return }
    getResumenPagos().then(setStats).catch(console.error)
    getResumenPagosVehiculos().then(setStatsVehiculos).catch(console.error)
    cargarConfirmaciones()
  }, [rol, navigate, cargarConfirmaciones])

  const cargarCiclo = useCallback(async () => {
    setCargandoCiclo(true); setGenError(null)
    try {
      const d = await getDatosCicloParaPago(ciclo)
      setDatos(d)
      setSeleccionados(new Set())
    } catch (err) { setGenError(err.message) }
    finally { setCargandoCiclo(false) }
  }, [ciclo])

  useEffect(() => { cargarCiclo() }, [cargarCiclo])

  const cargarListas = useCallback(async () => {
    try {
      setListas(await listarListasPago())
    } catch (err) { console.error(err) }
  }, [])

  useEffect(() => { cargarListas() }, [cargarListas])

  // Bug fix: la sección "Listas de pago" solo debe mostrar las del ciclo
  // activo (quincenal/mensual) — no mezclar con las del otro ciclo.
  const listasDelCiclo = listas.filter((l) => l.ciclo === ciclo)

  ////[Vinculo Global] Se usa la ruta centralizada definida en constants.js (Direccion.login = '/login')
  const handleSalir = async () => { await logout(); clear(); navigate( Direccion.login ) }

  // Cambio Décima: un empleado sin nada pendiente en el ciclo (recién
  // pagado, o adelantos que ya cubren su devengado) no aparece en el
  // selector — la lista "se limpia a sí misma". Ya no hay estado
  // "pendiente" que bloquear: al generar, el pago se ejecuta al instante y
  // el empleado deja de tener saldo, saliendo solo del listado.
  //
  // e.puedePagar (paymentLists.js): bloquea el pago anticipado — si TODO lo
  // pendiente es del bloque activo y ese bloque no ha llegado a su día de
  // pago, no se puede seleccionar todavía.
  const empleadoSeleccionable = (e) => e.totalPagar > 0 && e.puedePagar

  // Empleados disponibles para el listado: con saldo pendiente, filtrados
  // por el buscador (Cambio Décima 1.2) — se muestran también los
  // bloqueados por pago anticipado (checkbox deshabilitado, ver abajo), en
  // vez de ocultarlos, para que el admin sepa que existen y cuándo se
  // desbloquean.
  const empleadosDisponibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return datos.empleados
      .filter((e) => e.totalPagar > 0)
      .filter((e) => !q || e.nombre.toLowerCase().includes(q))
  }, [datos.empleados, busqueda])

  const toggleSeleccion = (e) => {
    if (!empleadoSeleccionable(e)) return
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(e.id)) next.delete(e.id); else next.add(e.id)
      return next
    })
  }

  const empleadosSeleccionados = datos.empleados.filter((e) => seleccionados.has(e.id))
  const totalSeleccionado = empleadosSeleccionados.reduce((s, e) => s + e.totalPagar, 0)

  // Cambiar de ciclo cierra cualquier flujo de generación en curso (evita
  // reabrir la selección a medias al volver a quincenal).
  const cambiarCiclo = (nuevo) => {
    setModoLista('idle'); setSeleccionados(new Set()); setBusqueda('')
    setEncargadoNombre(''); setGenError(null); setCiclo(nuevo)
  }

  // Cambio Décima: abre/cierra el flujo de generación de lista (solo
  // quincenal). Al cancelar se descarta la selección sin tocar la BD.
  const abrirFlujoLista = () => {
    setGenError(null); setBusqueda(''); setSeleccionados(new Set()); setModoLista('seleccion')
  }
  const cancelarFlujoLista = () => {
    setSeleccionados(new Set()); setEncargadoNombre(''); setModoLista('idle')
  }

  // Cambio Décima: al "Aceptar" la selección se pasa a capturar el nombre
  // del encargado que reparte el efectivo antes de ejecutar el pago.
  const irACapturarEncargado = () => {
    if (empleadosSeleccionados.length === 0) return
    setGenError(null); setEncargadoNombre(''); setModoLista('encargado')
  }

  // Cambio Décima: genera la lista y ejecuta el pago de inmediato (sin
  // estado intermedio), guardando el nombre del encargado responsable.
  const handleGenerarLista = async () => {
    if (!encargadoNombre.trim()) { setGenError('Ingresa el nombre del encargado.'); return }
    setGenError(null); setGenerando(true)
    try {
      await generarListaPago({
        ciclo,
        periodo: datos.periodo,
        encargado: encargadoNombre,
        items: empleadosSeleccionados.map((e) => ({
          empleadoId: e.id,
          totalDevengado: e.totalDevengado,
          totalAdelantos: e.totalAdelantos,
          totalPagar: e.totalPagar,
          periodoInicio: e.periodoInicioReal,
        })),
      })
      setSeleccionados(new Set())
      setEncargadoNombre('')
      setModoLista('idle')
      // Recargar ciclo (los pagados salen del selector), el historial, el
      // KPI de "Resumen General" y si el ciclo quedó listo para confirmar
      // — antes se quedaba con el monto viejo hasta refrescar la página
      // entera.
      await Promise.all([
        cargarListas(), cargarCiclo(), getResumenPagos().then(setStats), cargarConfirmaciones(),
      ])
    } catch (err) { setGenError(err.message) }
    finally { setGenerando(false) }
  }

  const handleVerItems = async (listaId) => {
    if (listaAbierta === listaId) { setListaAbierta(null); return }
    setListaAbierta(listaId)
    if (!itemsPorLista[listaId]) {
      try {
        const items = await getItemsListaPagoConJornadas(listaId)
        setItemsPorLista((prev) => ({ ...prev, [listaId]: items }))
      } catch (err) { console.error(err) }
    }
  }

  // `setListaAImprimir` cambia qué bloque queda marcado `print:block`;
  // el `setTimeout` espera a que ese render se aplique antes de abrir el
  // diálogo de impresión del navegador.
  const handleImprimirPlanilla = () => {
    setListaAImprimir(null)
    setTimeout(() => window.print(), 0)
  }

  const handleImprimirLista = (listaId) => {
    setListaAImprimir(listaId)
    setTimeout(() => window.print(), 0)
  }

  const handleAbrirCancelarLista = async (lista) => {
    setCancelarListaError(null)
    setListaACancelar(lista)
    // Se resuelve al abrir (no al confirmar) para poder mostrar el texto
    // correcto del modal — "revierte el pago" vs "solo se oculta".
    setListaACancelarEsConfirmada(null)
    try {
      setListaACancelarEsConfirmada(await esListaDeCicloConfirmado(lista.ciclo, lista.periodo_fin))
    } catch (err) { console.error(err) }
  }

  const handleConfirmarCancelarLista = async () => {
    if (!listaACancelar) return
    setCancelandoLista(true); setCancelarListaError(null)
    try {
      // Si el ciclo de esta lista ya se confirmó/archivó (alerta "Ciclo
      // completado"), "cancelar" solo la oculta — el pago queda intacto, para no hacer
      // que ese ciclo ya cerrado "resucite" como pendiente otra vez.
      if (listaACancelarEsConfirmada) {
        await ocultarListaPago(listaACancelar.id)
      } else {
        await cancelarListaPago(listaACancelar.id)
      }
      setItemsPorLista((prev) => {
        const next = { ...prev }
        delete next[listaACancelar.id]
        return next
      })
      if (listaAbierta === listaACancelar.id) setListaAbierta(null)
      setListaACancelar(null)
      setListaACancelarEsConfirmada(null)
      // Mismo trío que tras generar una lista: el dinero reaparece en
      // "Resumen General" y los empleados vuelven al selector (si de
      // verdad se revirtió — si solo se ocultó, estos números no cambian).
      await Promise.all([
        cargarListas(), cargarCiclo(), getResumenPagos().then(setStats), cargarConfirmaciones(),
      ])
    } catch (err) {
      setCancelarListaError(err.message)
    } finally {
      setCancelandoLista(false)
    }
  }

  /**
   * Cambio 1.4.3 (Octava llamada) / RF-018: exportación real a Excel del
   * ciclo activo, botón ubicado junto al selector Quincenal/Mensual.
   *
   * - Un solo ciclo por archivo: usa `datos.empleados`, que ya viene
   *   filtrado por el `ciclo` seleccionado arriba — nunca mezcla
   *   quincenales con mensuales.
   * - Formato exacto pedido: primera columna Nombre, columnas siguientes
   *   una por cada día del ciclo con las horas trabajadas ese día,
   *   encabezado en formato día/mes (`fmtDiaMes`).
   * - Solo informativo: no llama a ninguna función de pago, no marca a
   *   nadie como pagado ni descuenta nada — solo lee `datos.empleados`
   *   (ya cargado en pantalla) y arma el archivo en el navegador.
   * - Sin datos: el botón queda deshabilitado (ver `disabled` más abajo)
   *   y se muestra el texto "sin datos para exportar".
   */
  const handleExportarExcel = () => {
    if (datos.empleados.length === 0) return

    const encabezado = ['Nombre', ...diasDelPeriodo.map((d) => fmtDiaMes(d.iso))]
    const filas = datos.empleados.map((e) => {
      const porDia = {}
      e.jornadas.forEach((j) => { porDia[j.fecha] = j })
      return [
        e.nombre,
        // Igual que en la planilla (ver CeldaDia): horas y destajo no son
        // excluyentes, así que un día con ambos no puede reducirse a un
        // solo número — se combina en texto. Un día solo-horas se deja
        // como Number (formato original pedido) para no romper sumas que
        // el usuario arme en la hoja.
        ...diasDelPeriodo.map((d) => {
          const j = porDia[d.iso]
          if (!j) return ''
          const horas = Number(j.horas)
          const destajo = Number(j.destajo)
          if (destajo > 0) return horas > 0 ? `${horas}h + €${destajo.toFixed(0)}` : `€${destajo.toFixed(0)}`
          return horas > 0 ? horas : ''
        }),
      ]
    })

    const hoja = XLSX.utils.aoa_to_sheet([encabezado, ...filas])
    const libro = XLSX.utils.book_new()
    const nombreHoja = ciclo === 'quincenal' ? 'Quincenal' : 'Mensual'
    XLSX.utils.book_append_sheet(libro, hoja, nombreHoja)

    const sufijo = datos.periodo ? `${datos.periodo.inicio}_a_${datos.periodo.fin}` : new Date().toISOString().slice(0, 10)
    XLSX.writeFile(libro, `Ciclo_${nombreHoja}_${sufijo}.xlsx`)
  }

  // Días del período activo — eje de columnas de la planilla imprimible
  // y de la exportación a Excel. Arranca desde la jornada más antigua entre
  // los empleados del ciclo (no siempre el inicio oficial): si alguien
  // arrastra días de un ciclo anterior sin pagar, esas columnas también
  // deben existir aquí. A propósito solo mira fechas de JORNADAS, nunca de
  // adelantos — la grilla solo pinta `e.jornadas` por día (los adelantos
  // nunca se muestran por día, solo se suman en "Debe"), así que un
  // adelanto viejo suelto ensanchaba la tabla con columnas que iban a
  // quedar vacías para todos, sin mostrar nada útil.
  //
  // Tope: como máximo, un ciclo completo hacia atrás del inicio oficial (un
  // ciclo entero de "colchón" para el arrastre normal). Sin esto, un solo
  // empleado con una jornada arrastrada de hace mucho tiempo ensanchaba la
  // tabla completa para todos, rompiendo el diseño del documento impreso.
  // El dinero de esas jornadas más viejas sigue contando igual en el Total
  // de su fila (eso no cambia) — solo dejan de tener columna de día propia,
  // y esa fila lo marca con un aviso (ver `tieneArrastreFueraDeRango`).
  const diasDelPeriodo = useMemo(() => {
    if (!datos.periodo) return []
    const { inicio: inicioOficial, fin } = datos.periodo
    const duracionCiclo = diasEntre(inicioOficial, fin).length
    const topeInicio = restarDias(inicioOficial, duracionCiclo)

    const fechasJornadas = datos.empleados.flatMap((e) => e.jornadas.map((j) => j.fecha))
    const masAntigua = fechasJornadas.length
      ? fechasJornadas.reduce((a, b) => (b < a ? b : a))
      : inicioOficial
    const inicio = masAntigua < topeInicio ? topeInicio : masAntigua

    return diasEntre(inicio, fin)
  }, [datos.periodo, datos.empleados])

  const listaImpresa = listas.find((l) => l.id === listaAImprimir)
  const diasListaImpresa = useMemo(
    () => diasEntre(listaImpresa?.periodo_inicio, listaImpresa?.periodo_fin),
    [listaImpresa]
  )

  return (
    <>
      <div className="min-h-screen bg-app-bg print:hidden">
        <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
        <HorizontalNav />

        <div className="px-4 pt-4 pb-6 max-w-md mx-auto space-y-4">
          {/* ── Banner: ciclos completados que se descartaron con "NO" en la
              alerta — siguen sin confirmar, solo dejaron de interrumpir.
              Tocar uno reabre la misma alerta (Modal de abajo) al instante,
              sin recargar la página. ── */}
          {pendientesDescartados.length > 0 && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 divide-y divide-amber-200 overflow-hidden shadow-sm">
              {pendientesDescartados.map((it) => (
                <button
                  key={claveCiclo(it)}
                  onClick={() => reabrirCicloDescartado(it)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
                  <span className="flex-1 text-sm font-medium text-amber-900 leading-snug">
                    Ciclo{' '}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${CICLO_BADGE[it.tipo]}`}>
                      {it.tipo}
                    </span>{' '}
                    de {it.tipoEntidad === 'empleado' ? 'empleados' : 'furgonetas'} completado ({it.periodo.label})
                    <br /><span className="text-xs text-amber-700">Falta confirmar para pasar al siguiente ciclo</span>
                  </span>
                  <span className="text-xs font-bold text-amber-700 shrink-0">VER →</span>
                </button>
              ))}
            </div>
          )}

          <Card>
            <SectionTitle color="gold">Resumen General</SectionTitle>
            <CicloAPagarBanner quincenal={stats.quincenal.periodo} mensual={stats.mensual.periodo} />
            <div className="grid grid-cols-2 gap-3">
              <StatCard value={`€${stats.quincenal.total.toFixed(2)}`} label="Quincenales" color="gold" />
              <StatCard value={`€${stats.mensual.total.toFixed(2)}`} label="Mensuales" color="navy" />
            </div>
          </Card>

          {/* ── Resumen Furgonetas: contador exclusivo de vehículos, misma
              regla/ciclo que el de empleados (ver getResumenPagosVehiculos
              en vehicles.js), en card propia para no mezclar visualmente
              empleados con furgonetas. ── */}
          <Card>
            <SectionTitle color="gold">Resumen Furgonetas</SectionTitle>
            <CicloAPagarBanner quincenal={statsVehiculos.quincenal.periodo} mensual={statsVehiculos.mensual.periodo} />
            <div className="grid grid-cols-2 gap-3">
              <StatCard value={`€${statsVehiculos.quincenal.total.toFixed(2)}`} label="Quincenales" color="gold" />
              <StatCard value={`€${statsVehiculos.mensual.total.toFixed(2)}`} label="Mensuales" color="navy" />
            </div>
          </Card>

          {/* ── Choferes: pago informativo, fuera de ciclos. El cliente
              entrega esa diferencia por fuera del sistema — esta card
              nunca toca stats/datos/listas ni el formato de las de abajo.
              "Pagar" borra el registro al confirmar, no queda historial. ── */}
          <Card>
            <SectionTitle color="gold">Choferes</SectionTitle>
            {pagoChoferError && (
              <p className="text-danger text-xs text-center mb-2">{pagoChoferError}</p>
            )}
            {cargandoChoferes ? (
              <p className="text-gray-400 text-xs text-center py-4">Cargando…</p>
            ) : choferes.length === 0 ? (
              <p className="text-gray-400 text-xs text-center py-4">Sin pagos de chofer pendientes.</p>
            ) : (
              <div className="space-y-2">
                {choferes.map((c) => (
                  <div key={c.empleado_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-navy-dark truncate">{c.nombre}</p>
                      <p className="text-[10px] text-gray-400">
                        {c.veces} {c.veces === 1 ? 'vez' : 'veces'} como chofer · €{Number(c.total).toFixed(2)}
                      </p>
                    </div>
                    <Button variant="pill" active onClick={() => handleAbrirPagoChofer(c)}>
                      PAGAR
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ── Cambio 1.4.1 / 1.4.2: selector de ciclo activo ── */}
          <Card>
            <SectionTitle color="green">Ciclo de pago</SectionTitle>
            <div className="flex gap-2 mb-3">
              <Button variant="pill" active={ciclo === 'quincenal'} onClick={() => cambiarCiclo('quincenal')}>Quincenal</Button>
              <Button variant="pill" active={ciclo === 'mensual'} onClick={() => cambiarCiclo('mensual')}>Mensual</Button>
            </div>
            {datos.periodo && (
              <p className="text-[10px] text-gray-400 mb-3">Período activo: {datos.periodo.label}</p>
            )}

            {/* Cambio 1.4.3 (Octava) / RF-018 + planilla imprimible: ambos
                exportes de reporte, para cualquier ciclo. */}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" icon={<Download className="w-4 h-4" />}
                onClick={handleExportarExcel} disabled={datos.empleados.length === 0}>
                EXPORTAR A EXCEL
              </Button>
              <Button variant="dark" icon={<FileSpreadsheet className="w-4 h-4" />}
                onClick={handleImprimirPlanilla} disabled={datos.empleados.length === 0}>
                EXPORTAR PLANILLA
              </Button>
            </div>
            {datos.empleados.length === 0 && (
              <p className="mt-2 text-[10px] text-gray-400 text-center">sin datos para exportar</p>
            )}
          </Card>

          {genError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-danger text-xs text-center">{genError}</p>
            </div>
          )}

          {/* ── Cambio Décima: generación de lista de pago — SOLO quincenal.
              Un único punto de entrada ("Generar lista") que despliega la
              selección de empleados y luego el nombre del encargado. Los
              mensuales cobran por nómina presencial (fuera de este flujo). ── */}
          {ciclo === 'quincenal' && (
            <Card>
              <SectionTitle color="gold">Lista de pago quincenal</SectionTitle>

              {/* Estado inicial: solo el botón de entrada. */}
              {modoLista === 'idle' && (
                <>
                  <Button variant="primary" icon={<Plus className="w-4 h-4" />}
                    onClick={abrirFlujoLista} disabled={cargandoCiclo}>
                    GENERAR LISTA
                  </Button>
                  <p className="mt-2 text-[10px] text-gray-400 text-center">
                    Selecciona a los empleados quincenales pendientes y ejecuta el pago en efectivo.
                  </p>
                </>
              )}

              {/* Paso 1: buscador + checklist de solo pendientes. */}
              {modoLista === 'seleccion' && (
                <>
                  <div className="relative mb-3">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input type="text" placeholder="Buscar empleado…" value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)} className="!pl-9" />
                  </div>

                  {cargandoCiclo ? (
                    <p className="text-gray-400 text-xs text-center py-6">Cargando…</p>
                  ) : empleadosDisponibles.length === 0 ? (
                    <p className="text-gray-400 text-xs text-center py-6">
                      {busqueda ? 'Sin coincidencias.' : 'No hay empleados quincenales con pago pendiente.'}
                    </p>
                  ) : (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-[auto_1fr_auto] gap-2 bg-navy-dark p-2 text-[10px] font-semibold text-gray-300 uppercase">
                        <span></span><span>Nombre</span><span className="text-right">A pagar</span>
                      </div>
                      {empleadosDisponibles.map((e, i) => (
                        <label key={e.id}
                          className={`grid grid-cols-[auto_1fr_auto] gap-2 p-2 border-t border-gray-100 items-center text-xs
                            ${!e.puedePagar ? 'opacity-50' : seleccionados.has(e.id) ? 'bg-primary/10' : i % 2 ? 'bg-gray-50/60' : 'bg-white'}`}>
                          <input type="checkbox" checked={seleccionados.has(e.id)}
                            disabled={!e.puedePagar}
                            onChange={() => toggleSeleccion(e)} />
                          <span className="min-w-0">
                            <span className="text-navy-dark truncate block">{e.nombre}</span>
                            {!e.puedePagar ? (
                              // Pago anticipado bloqueado: todo lo pendiente es del
                              // bloque activo, que todavía no llega a su día de pago.
                              <span className="text-[9px] text-gray-400 font-semibold">
                                disponible el {datos.periodo.diaPago?.split('-').reverse().slice(0, 2).join('/')}
                              </span>
                            ) : e.periodoInicioReal < datos.periodo.inicio ? (
                              // Arrastre real: su fecha pendiente más antigua queda ANTES
                              // del inicio oficial del ciclo activo — sí tiene días/adelantos
                              // de un ciclo ya cerrado incluidos en este total. Si su fecha
                              // más antigua ya cae dentro del ciclo activo, no es arrastre —
                              // no se muestra ninguna etiqueta.
                              <span className="text-[9px] text-danger font-semibold">incluye ciclo anterior</span>
                            ) : null}
                          </span>
                          <span className="text-right font-semibold text-navy-dark">€{e.totalPagar.toFixed(2)}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Sub-lista de seleccionados: siempre visible como paso intermedio. */}
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 p-2 rounded-xl bg-primary/10 text-xs font-bold text-primary">
                    <span>Seleccionados ({empleadosSeleccionados.length})</span>
                    <span className="text-right">€{totalSeleccionado.toFixed(2)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <Button variant="outline" icon={<X className="w-4 h-4" />} onClick={cancelarFlujoLista}>
                      CANCELAR
                    </Button>
                    <Button variant="primary" icon={<Printer className="w-4 h-4" />}
                      onClick={irACapturarEncargado} disabled={empleadosSeleccionados.length === 0}>
                      ACEPTAR
                    </Button>
                  </div>
                </>
              )}

              {/* Paso 2: nombre del encargado que reparte el efectivo. */}
              {modoLista === 'encargado' && (
                <>
                  <div className="grid grid-cols-[1fr_auto] gap-2 p-2 mb-3 rounded-xl bg-primary/10 text-xs font-bold text-primary">
                    <span>A pagar ({empleadosSeleccionados.length})</span>
                    <span className="text-right">€{totalSeleccionado.toFixed(2)}</span>
                  </div>
                  <Input label="Nombre del encargado (quien reparte el efectivo)"
                    type="text" placeholder="Ej. José Martínez"
                    value={encargadoNombre} onChange={(e) => setEncargadoNombre(e.target.value)} />
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <Button variant="outline" icon={<X className="w-4 h-4" />}
                      onClick={() => setModoLista('seleccion')} disabled={generando}>
                      VOLVER
                    </Button>
                    <Button variant="primary" icon={<Printer className="w-4 h-4" />}
                      onClick={handleGenerarLista} disabled={generando || !encargadoNombre.trim()}>
                      {generando ? 'PAGANDO…' : 'GENERAR Y PAGAR'}
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* ── Historial de listas ya generadas (quincenal). Reimprimible
              siempre — Cambio Décima: sin estados, el pago ya se ejecutó. ── */}
          {ciclo === 'quincenal' && (
            <Card>
              <SectionTitle color="green">Listas generadas · Quincenal</SectionTitle>
              {listasDelCiclo.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-4">Sin listas generadas en este ciclo.</p>
              ) : (
                <div className="space-y-2">
                  {listasDelCiclo.map((l) => (
                    <div key={l.id} className="border border-gray-100 rounded-xl p-3 bg-gradient-to-r from-white to-gray-50">
                      <button className="w-full flex items-center justify-between" onClick={() => handleVerItems(l.id)}>
                        <div className="text-left flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${CICLO_BADGE[l.ciclo]}`}>
                            {l.ciclo}
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-navy-dark">
                              {fmtCorta(l.periodo_inicio)}–{fmtCorta(l.periodo_fin)}
                            </p>
                            {l.encargado && (
                              <p className="text-[10px] text-gray-400 mt-0.5">Encargado: {l.encargado}</p>
                            )}
                          </div>
                        </div>
                        <p className="text-xs font-bold text-primary">€{Number(l.total_monto).toFixed(2)}</p>
                      </button>

                      {listaAbierta === l.id && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                          {(itemsPorLista[l.id] ?? []).map((it) => (
                            <div key={it.id} className="flex justify-between text-[11px] text-navy-dark">
                              <span>{it.empleado?.nombre ?? 'Empleado dado de baja'}</span>
                              <span className="font-semibold">€{Number(it.total_pagado).toFixed(2)}</span>
                            </div>
                          ))}

                          {/* Cambio Décima: IMPRIMIR siempre disponible (permite
                              reimprimir un documento ya cerrado, cuantas veces haga falta).
                              CANCELAR revierte el pago — jornadas/adelantos vuelven a
                              pendientes y la lista desaparece del historial. */}
                          <div className="pt-2 grid grid-cols-2 gap-2">
                            <Button variant="outline" icon={<Printer className="w-4 h-4" />}
                              onClick={() => handleImprimirLista(l.id)}>
                              IMPRIMIR
                            </Button>
                            <Button variant="outline" icon={<Trash2 className="w-4 h-4" />}
                              className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                              onClick={() => handleAbrirCancelarLista(l)}>
                              CANCELAR
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* ── Confirmar pago de chofer: recalculado justo antes de mostrar
          (handleAbrirPagoChofer), y vuelto a comparar del lado del
          servidor al confirmar — evita pagar de más si cambió entretanto.
          Borra el/los registro(s) al confirmar, no genera historial. ── */}
      <Modal
        open={!!choferAPagar}
        title="Pagar chofer"
        onClose={() => { if (!pagandoChofer) setChoferAPagar(null) }}
      >
        {choferAPagar && (
          <>
            <p className="text-sm text-navy-dark mb-2">
              Vas a pagarle a <strong>{choferAPagar.nombre}</strong> por{' '}
              <strong>{choferAPagar.veces}</strong> {choferAPagar.veces === 1 ? 'vez' : 'veces'} como chofer.
            </p>
            <p className="text-lg font-bold text-primary mb-4">€{choferAPagar.total.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mb-4">
              Esto es informativo — el sistema no ejecuta ningún pago, solo borra este registro.
              Esta acción no se puede deshacer.
            </p>
            {pagoChoferError && <p className="text-danger text-xs mb-3">{pagoChoferError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setChoferAPagar(null)} disabled={pagandoChofer}>
                CANCELAR
              </Button>
              <Button variant="primary" onClick={handleConfirmarPagoChofer} disabled={pagandoChofer}>
                {pagandoChofer ? 'PAGANDO…' : 'PAGAR'}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Cancelar lista de pago ──
          Si el ciclo de esta lista NO se ha confirmado/archivado todavía:
          revierte jornadas/adelantos a fue_liquidado=false y borra el pago
          (RPC cancelar_lista_pago), luego borra la lista. Si el ciclo YA
          se confirmó: solo la oculta (ocultar_lista_pago), el pago queda
          intacto — ver handleAbrirCancelarLista/handleConfirmarCancelarLista.
          Mismo patrón de confirmación que "Eliminar adelanto"/"Cancelar
          PIN" en el resto de la app. ── */}
      <Modal
        open={!!listaACancelar}
        title="Cancelar lista de pago"
        onClose={() => { if (!cancelandoLista) { setListaACancelar(null); setListaACancelarEsConfirmada(null) } }}
      >
        {listaACancelar && (
          <>
            <p className="text-sm text-navy-dark mb-2">
              Vas a cancelar la lista del <strong>{fmtCorta(listaACancelar.periodo_inicio)}</strong> al{' '}
              <strong>{fmtCorta(listaACancelar.periodo_fin)}</strong> por{' '}
              <strong>€{Number(listaACancelar.total_monto).toFixed(2)}</strong>.
            </p>
            <p className="text-xs text-gray-500 mb-4">
              {listaACancelarEsConfirmada === null ? 'Verificando el ciclo…' : listaACancelarEsConfirmada ? (
                <>Este ciclo ya está confirmado/archivado — la lista solo se <strong>ocultará</strong>,
                  el pago queda intacto y no se revierte ningún dinero. Esta acción no se puede deshacer.</>
              ) : (
                <>Se borran los pagos de esta lista y las jornadas/adelantos vuelven a quedar
                  pendientes — el sistema los recalcula solo en el ciclo activo. Esta acción no se
                  puede deshacer.</>
              )}
            </p>
            {cancelarListaError && <p className="text-danger text-xs mb-3">{cancelarListaError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => { setListaACancelar(null); setListaACancelarEsConfirmada(null) }} disabled={cancelandoLista}>
                VOLVER
              </Button>
              <Button variant="outline" className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                onClick={handleConfirmarCancelarLista} disabled={cancelandoLista || listaACancelarEsConfirmada === null}>
                {cancelandoLista ? 'CANCELANDO…' : listaACancelarEsConfirmada ? 'SÍ, OCULTAR' : 'SÍ, CANCELAR'}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Alerta: ciclo completamente pagado, ¿pasar al siguiente? ──
          Aparece sola (no hay que ir a buscarla) en cuanto un ciclo llega
          a €0 y todavía no se confirmó. "NO" no cambia nada en la BD — el
          ciclo sigue sin confirmar y baja al banner de arriba
          (pendientesDescartados), desde donde se puede reabrir esta misma
          alerta cuando quiera. ── */}
      <Modal
        open={!!cicloAConfirmar}
        title="Ciclo completado"
        onClose={() => { if (!confirmandoCiclo) descartarCicloAConfirmar() }}
      >
        {cicloAConfirmar && (
          <div className="space-y-4">
            <p className="text-sm text-navy-dark">
              Ya hiciste todos los pagos del ciclo{' '}
              <strong className="capitalize">{cicloAConfirmar.tipo}</strong> de{' '}
              <strong>{cicloAConfirmar.tipoEntidad === 'empleado' ? 'empleados' : 'furgonetas'}</strong>{' '}
              ({cicloAConfirmar.periodo.label}). ¿Deseas pasar al siguiente ciclo?
            </p>
            <p className="text-xs text-gray-500">
              Al confirmar, si más adelante cancelas una lista de este ciclo, solo se ocultará
              (el pago no se revierte) — evita que este ciclo ya cerrado vuelva a aparecer como
              pendiente. Si dices que no, no cambia nada por ahora.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={descartarCicloAConfirmar} disabled={confirmandoCiclo}>
                NO
              </Button>
              <Button variant="primary" onClick={handleConfirmarCiclo} disabled={confirmandoCiclo}>
                {confirmandoCiclo ? 'CONFIRMANDO…' : 'SÍ, PASAR AL SIGUIENTE'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Cambio 1.4.2: planilla de horas — oculta en pantalla, visible
          solo al imprimir "EXPORTAR PLANILLA". Formato según
          base impresion.pdf: días en columnas, colores de identificación
          por columna. Sin librerías externas — impresión nativa. ── */}
      <PlanillaImprimible ciclo={ciclo} periodo={datos.periodo} empleados={datos.empleados} dias={diasDelPeriodo}
        printVisible={listaAImprimir === null} />

      {/* ── Lista de pago imprimible: mismo formato día-por-día que la
          planilla pero solo para los empleados de esta lista — visible al
          imprimir "IMPRIMIR" dentro de una lista. ── */}
      <ListaPagoImprimible lista={listaImpresa} items={itemsPorLista[listaAImprimir]}
        dias={diasListaImpresa} printVisible={listaAImprimir !== null} />
    </>
  )
}

function fmtHorasMin(h) {
  if (!h) return ''
  const horas = Math.floor(h)
  const min = Math.round((h - horas) * 60)
  return `${horas}:${String(min).padStart(2, '0')}`
}

// FIX URGENTE (temporal, versión de testeo): usa siempre la tarifa ACTUAL
// del trabajador (pago por hora en la ficha del empleado), ignorando la
// tarifa_aplicada histórica de cada jornada — el cliente cargó mal el pago
// por hora y necesita que la planilla recalculé con la tarifa ya corregida
// sin tener que tocar datos en Supabase.
function sumarHorasPorTarifa(jornadas, tarifaFallback) {
  return (jornadas ?? []).reduce((s, j) => s + Number(j.horas) * (tarifaFallback ?? 0), 0)
}

// Celda de un día en la planilla / lista imprimible. FormJornada no hace
// horas y destajo excluyentes entre sí (un jornalero puede tener ambos el
// mismo día) — antes esta celda mostraba solo uno de los dos y el otro se
// perdía sin avisar. Ahora se apilan en dos líneas cuando coexisten; el
// rosa del destajo es el mismo que ya usa el encabezado de esa columna,
// así no hace falta agregar una leyenda para distinguirlos.
function CeldaDia({ jornada }) {
  if (!jornada) return null
  const horas = Number(jornada.horas) > 0 ? fmtHorasMin(jornada.horas) : null
  const destajo = Number(jornada.destajo) > 0 ? `€${Number(jornada.destajo).toFixed(0)}` : null
  if (!horas && !destajo) return null
  return (
    <>
      {horas && <div>{horas}</div>}
      {destajo && <div style={{ color: '#ff1493' }}>{destajo}</div>}
    </>
  )
}

function PlanillaImprimible({ ciclo, periodo, empleados, dias, printVisible }) {
  if (!periodo) return null

  let totalGanado = 0
  let totalAdelantos = 0
  let hayFueraDeRango = false

  return (
    <div className={`hidden p-2 planilla-print ${printVisible ? 'print:block' : ''}`}>
      <h1 className="text-center font-bold text-lg mb-1">
        PLANILLA DE HORAS — {periodo.label.toUpperCase()} ({ciclo.toUpperCase()})
      </h1>
      <p className="text-center text-xs text-gray-500 mb-4">
        Generado: {new Date().toLocaleDateString('es-ES')}
      </p>
      <table className="w-full border-collapse text-[10px] leading-tight">
        <thead>
          <tr>
            <th className="border border-gray-400 p-0.5 text-left" style={{ background: '#ffff00' }}>Nombre</th>
            {dias.map((d) => (
              <th key={d.iso} className="border border-gray-400 p-0.5" style={{ background: '#ffff00' }}>{d.label}</th>
            ))}
            <th className="border border-gray-400 bg-gray-100 p-1">Total(H)</th>
            <th className="border border-gray-400 bg-gray-100 p-1">H×€</th>
            <th className="border border-gray-400 p-0.5" style={{ background: '#ff1493', color: '#fff' }}>Destajo</th>
            <th className="border border-gray-400 p-0.5" style={{ background: '#add8e6' }}>Total</th>
            <th className="border border-gray-400 bg-gray-100 p-1">Debe</th>
            <th className="border border-gray-400 p-0.5" style={{ background: '#1f4e78', color: '#fff' }}>Pagar</th>
          </tr>
        </thead>
        <tbody>
          {empleados.map((e) => {
            const porDia = {}
            e.jornadas.forEach((j) => { porDia[j.fecha] = j })
            const hPesos = sumarHorasPorTarifa(e.jornadas, e.tarifa_hora)
            totalGanado += e.totalDevengado
            totalAdelantos += e.totalAdelantos
            // El Total/Pagar de la fila sí incluye jornadas más viejas que
            // el tope de columnas (diasDelPeriodo) — se avisa en el nombre
            // para que no parezca que el número no cuadra con las columnas.
            const tieneFueraDeRango = dias.length > 0 && e.jornadas.some((j) => j.fecha < dias[0].iso)
            if (tieneFueraDeRango) hayFueraDeRango = true
            return (
              <tr key={e.id}>
                <td className="border border-gray-300 p-0.5">
                  {e.nombre}{tieneFueraDeRango && ' *'}
                </td>
                {dias.map((d) => {
                  const j = porDia[d.iso]
                  return (
                    <td key={d.iso} className="border border-gray-300 p-0.5 text-center leading-tight">
                      <CeldaDia jornada={j} />
                    </td>
                  )
                })}
                <td className="border border-gray-300 p-0.5 text-center">{fmtHorasMin(e.totalHoras)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{hPesos.toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{(e.totalDevengado - hPesos).toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{e.totalDevengado.toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{e.totalAdelantos.toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right font-bold">€{e.totalPagar.toFixed(2)}</td>
              </tr>
            )
          })}
          <tr className="font-bold" style={{ background: '#1f4e78', color: '#fff' }}>
            <td className="border border-gray-400 p-0.5">TOTAL</td>
            {dias.map((d) => <td key={d.iso} className="border border-gray-400 p-0.5"></td>)}
            <td className="border border-gray-400 p-0.5"></td>
            <td className="border border-gray-400 p-0.5"></td>
            <td className="border border-gray-400 p-0.5"></td>
            <td className="border border-gray-400 p-0.5 text-right">€{totalGanado.toFixed(2)}</td>
            <td className="border border-gray-400 p-0.5 text-right">€{totalAdelantos.toFixed(2)}</td>
            <td className="border border-gray-400 p-0.5 text-right">€{(totalGanado - totalAdelantos).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      {hayFueraDeRango && (
        <p className="mt-2 text-[9px] text-gray-500">
          * Su Total incluye jornadas de fecha anterior a las columnas mostradas (arrastre de un ciclo cerrado).
        </p>
      )}
    </div>
  )
}

// Bug fix (Séptima llamada): "IMPRIMIR" en una lista de pago imprimía la
// planilla completa (único bloque con `print:block`). Ahora imprime solo
// los empleados de esa lista, con el mismo formato día-por-día que la
// planilla (columnas de color).
function ListaPagoImprimible({ lista, items, dias, printVisible }) {
  if (!lista) return null

  let totalGanado = 0
  let totalAdelantos = 0

  return (
    <div className={`hidden p-2 planilla-print ${printVisible ? 'print:block' : ''}`}>
      <h1 className="text-center font-bold text-lg mb-1">
        LISTA DE PAGO — {fmtCorta(lista.periodo_inicio)} al {fmtCorta(lista.periodo_fin)} ({lista.ciclo.toUpperCase()})
      </h1>
      <p className="text-center text-xs text-gray-500 mb-1">
        Generado: {new Date().toLocaleDateString('es-ES')}
      </p>
      {lista.encargado && (
        <p className="text-center text-xs text-gray-600 mb-4">
          Encargado del reparto: <span className="font-semibold">{lista.encargado}</span>
        </p>
      )}
      <table className="w-full border-collapse text-[10px] leading-tight">
        <thead>
          <tr>
            <th className="border border-gray-400 p-0.5 text-left" style={{ background: '#ffff00' }}>Nombre</th>
            {dias.map((d) => (
              <th key={d.iso} className="border border-gray-400 p-0.5" style={{ background: '#ffff00' }}>{d.label}</th>
            ))}
            <th className="border border-gray-400 bg-gray-100 p-1">Total(H)</th>
            <th className="border border-gray-400 bg-gray-100 p-1">H×€</th>
            <th className="border border-gray-400 p-0.5" style={{ background: '#ff1493', color: '#fff' }}>Destajo</th>
            <th className="border border-gray-400 p-0.5" style={{ background: '#add8e6' }}>Total</th>
            <th className="border border-gray-400 bg-gray-100 p-1">Debe</th>
            <th className="border border-gray-400 p-0.5" style={{ background: '#1f4e78', color: '#fff' }}>Pagar</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((it) => {
            const porDia = {}
            ;(it.jornadas ?? []).forEach((j) => { porDia[j.fecha] = j })
            const totalHoras = (it.jornadas ?? []).reduce((s, j) => s + Number(j.horas), 0)
            const hPesos = sumarHorasPorTarifa(it.jornadas, it.empleado?.tarifa_hora)
            totalGanado += Number(it.total_devengado)
            totalAdelantos += Number(it.total_adelantos)
            return (
              <tr key={it.id}>
                <td className="border border-gray-300 p-0.5">{it.empleado?.nombre ?? 'Empleado dado de baja'}</td>
                {dias.map((d) => {
                  const j = porDia[d.iso]
                  return (
                    <td key={d.iso} className="border border-gray-300 p-0.5 text-center leading-tight">
                      <CeldaDia jornada={j} />
                    </td>
                  )
                })}
                <td className="border border-gray-300 p-0.5 text-center">{fmtHorasMin(totalHoras)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{hPesos.toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{(Number(it.total_devengado) - hPesos).toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{Number(it.total_devengado).toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right">€{Number(it.total_adelantos).toFixed(2)}</td>
                <td className="border border-gray-300 p-0.5 text-right font-bold">€{Number(it.total_pagado).toFixed(2)}</td>
              </tr>
            )
          })}
          <tr className="font-bold" style={{ background: '#1f4e78', color: '#fff' }}>
            <td className="border border-gray-400 p-0.5">TOTAL</td>
            {dias.map((d) => <td key={d.iso} className="border border-gray-400 p-0.5"></td>)}
            <td className="border border-gray-400 p-0.5"></td>
            <td className="border border-gray-400 p-0.5"></td>
            <td className="border border-gray-400 p-0.5"></td>
            <td className="border border-gray-400 p-0.5 text-right">€{totalGanado.toFixed(2)}</td>
            <td className="border border-gray-400 p-0.5 text-right">€{totalAdelantos.toFixed(2)}</td>
            <td className="border border-gray-400 p-0.5 text-right">€{(totalGanado - totalAdelantos).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
