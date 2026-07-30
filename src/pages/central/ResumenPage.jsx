import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, FileSpreadsheet, Printer, Search, Download, Plus, X } from 'lucide-react'
import * as XLSX from 'xlsx'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Button        from '../../components/ui/Button.jsx'
import Input         from '../../components/ui/Input.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'
import StatCard      from '../../components/domain/StatCard.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout } from '../../lib/api/auth.js'
import { getResumenPagos } from '../../lib/api/records.js'
import {
  getDatosCicloParaPago, generarListaPago, listarListasPago,
  getItemsListaPagoConJornadas
} from '../../lib/api/paymentLists.js'

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
  const [stats, setStats] = useState({ quincenal: 0, mensual: 0 })

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

  useEffect(() => {
    //[Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login')
    if (rol !== 'admin') { navigate( Direccion.centralLogin , { replace: true }); return }
    getResumenPagos().then(setStats).catch(console.error)
  }, [rol, navigate])

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
  const empleadoSeleccionable = (e) => e.totalPagar > 0

  // Empleados disponibles para armar la lista: solo con saldo pendiente,
  // filtrados por el buscador (Cambio Décima 1.2).
  const empleadosDisponibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return datos.empleados
      .filter(empleadoSeleccionable)
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
        })),
      })
      setSeleccionados(new Set())
      setEncargadoNombre('')
      setModoLista('idle')
      // Recargar ciclo (los pagados salen del selector), el historial y el
      // KPI de "Resumen General" — antes se quedaba con el monto viejo
      // hasta refrescar la página entera.
      await Promise.all([cargarListas(), cargarCiclo(), getResumenPagos().then(setStats)])
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
        ...diasDelPeriodo.map((d) => {
          const j = porDia[d.iso]
          return j ? Number(j.horas) : ''
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
  // y de la exportación a Excel.
  const diasDelPeriodo = useMemo(
    () => diasEntre(datos.periodo?.inicio, datos.periodo?.fin),
    [datos.periodo]
  )

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
          <Card>
            <SectionTitle color="gold">Resumen General</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <StatCard value={`€${stats.quincenal.toFixed(2)}`} label="Quincenales" color="gold" />
              <StatCard value={`€${stats.mensual.toFixed(2)}`} label="Mensuales" color="navy" />
            </div>
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
                            ${seleccionados.has(e.id) ? 'bg-primary/10' : i % 2 ? 'bg-gray-50/60' : 'bg-white'}`}>
                          <input type="checkbox" checked={seleccionados.has(e.id)}
                            onChange={() => toggleSeleccion(e)} />
                          <span className="text-navy-dark truncate">{e.nombre}</span>
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
                              reimprimir un documento ya cerrado, cuantas veces haga falta). */}
                          <div className="pt-2">
                            <Button variant="outline" icon={<Printer className="w-4 h-4" />}
                              onClick={() => handleImprimirLista(l.id)}>
                              IMPRIMIR
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

      {/* ── Cambio 1.4.2: planilla de horas — oculta en pantalla, visible
          solo al imprimir "EXPORTAR PLANILLA". Formato según
          base impresion.pdf: días en columnas, colores de identificación
          por columna. Sin librerías externas — impresión nativa. ── */}
      <PlanillaImprimible ciclo={ciclo} periodo={datos.periodo} empleados={datos.empleados} dias={diasDelPeriodo}
        printVisible={listaAImprimir === null} />

      {/* ── Lista de pago imprimible: mismo formato día-por-día que la
          planilla pero solo para los empleados de esta lista, con columna
          de firma — visible al imprimir "IMPRIMIR" dentro de una lista. ── */}
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

function PlanillaImprimible({ ciclo, periodo, empleados, dias, printVisible }) {
  if (!periodo) return null

  let totalGanado = 0
  let totalAdelantos = 0

  return (
    <div className={`hidden p-4 ${printVisible ? 'print:block' : ''}`}>
      <h1 className="text-center font-bold text-lg mb-1">
        PLANILLA DE HORAS — {periodo.label.toUpperCase()} ({ciclo.toUpperCase()})
      </h1>
      <p className="text-center text-xs text-gray-500 mb-4">
        Generado: {new Date().toLocaleDateString('es-ES')}
      </p>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="border border-gray-400 p-1 text-left" style={{ background: '#ffff00' }}>Nombre</th>
            {dias.map((d) => (
              <th key={d.iso} className="border border-gray-400 p-1" style={{ background: '#ffff00' }}>{d.label}</th>
            ))}
            <th className="border border-gray-400 bg-gray-100 p-1">Total(H)</th>
            <th className="border border-gray-400 bg-gray-100 p-1">H×€</th>
            <th className="border border-gray-400 p-1" style={{ background: '#ff1493', color: '#fff' }}>Destajo</th>
            <th className="border border-gray-400 p-1" style={{ background: '#add8e6' }}>Total</th>
            <th className="border border-gray-400 bg-gray-100 p-1">Debe</th>
            <th className="border border-gray-400 p-1" style={{ background: '#1f4e78', color: '#fff' }}>Pagar</th>
          </tr>
        </thead>
        <tbody>
          {empleados.map((e) => {
            const porDia = {}
            e.jornadas.forEach((j) => { porDia[j.fecha] = j })
            const hPesos = e.totalHoras * (e.tarifa_hora || 0)
            totalGanado += e.totalDevengado
            totalAdelantos += e.totalAdelantos
            return (
              <tr key={e.id}>
                <td className="border border-gray-300 p-1">{e.nombre}</td>
                {dias.map((d) => {
                  const j = porDia[d.iso]
                  return (
                    <td key={d.iso} className="border border-gray-300 p-1 text-center">
                      {!j ? '' : j.destajo ? `€${Number(j.destajo).toFixed(0)}` : fmtHorasMin(j.horas)}
                    </td>
                  )
                })}
                <td className="border border-gray-300 p-1 text-center">{fmtHorasMin(e.totalHoras)}</td>
                <td className="border border-gray-300 p-1 text-right">€{hPesos.toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right">€{(e.totalDevengado - hPesos).toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right">€{e.totalDevengado.toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right">€{e.totalAdelantos.toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right font-bold">€{e.totalPagar.toFixed(2)}</td>
              </tr>
            )
          })}
          <tr className="font-bold" style={{ background: '#1f4e78', color: '#fff' }}>
            <td className="border border-gray-400 p-1">TOTAL</td>
            {dias.map((d) => <td key={d.iso} className="border border-gray-400 p-1"></td>)}
            <td className="border border-gray-400 p-1"></td>
            <td className="border border-gray-400 p-1"></td>
            <td className="border border-gray-400 p-1"></td>
            <td className="border border-gray-400 p-1 text-right">€{totalGanado.toFixed(2)}</td>
            <td className="border border-gray-400 p-1 text-right">€{totalAdelantos.toFixed(2)}</td>
            <td className="border border-gray-400 p-1 text-right">€{(totalGanado - totalAdelantos).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Bug fix (Séptima llamada): "IMPRIMIR" en una lista de pago imprimía la
// planilla completa (único bloque con `print:block`). Ahora imprime solo
// los empleados de esa lista, con el mismo formato día-por-día que la
// planilla (columnas de color) más una columna de firma al final.
function ListaPagoImprimible({ lista, items, dias, printVisible }) {
  if (!lista) return null

  let totalGanado = 0
  let totalAdelantos = 0

  return (
    <div className={`hidden p-4 ${printVisible ? 'print:block' : ''}`}>
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
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="border border-gray-400 p-1 text-left" style={{ background: '#ffff00' }}>Nombre</th>
            {dias.map((d) => (
              <th key={d.iso} className="border border-gray-400 p-1" style={{ background: '#ffff00' }}>{d.label}</th>
            ))}
            <th className="border border-gray-400 bg-gray-100 p-1">Total(H)</th>
            <th className="border border-gray-400 bg-gray-100 p-1">H×€</th>
            <th className="border border-gray-400 p-1" style={{ background: '#ff1493', color: '#fff' }}>Destajo</th>
            <th className="border border-gray-400 p-1" style={{ background: '#add8e6' }}>Total</th>
            <th className="border border-gray-400 bg-gray-100 p-1">Debe</th>
            <th className="border border-gray-400 p-1" style={{ background: '#1f4e78', color: '#fff' }}>Pagar</th>
            <th className="border border-gray-400 p-1" style={{ background: '#1f4e78', color: '#fff' }}>Firma</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((it) => {
            const porDia = {}
            ;(it.jornadas ?? []).forEach((j) => { porDia[j.fecha] = j })
            const totalHoras = (it.jornadas ?? []).reduce((s, j) => s + Number(j.horas), 0)
            const hPesos = totalHoras * (it.empleado?.tarifa_hora || 0)
            totalGanado += Number(it.total_devengado)
            totalAdelantos += Number(it.total_adelantos)
            return (
              <tr key={it.id}>
                <td className="border border-gray-300 p-1">{it.empleado?.nombre ?? 'Empleado dado de baja'}</td>
                {dias.map((d) => {
                  const j = porDia[d.iso]
                  return (
                    <td key={d.iso} className="border border-gray-300 p-1 text-center">
                      {!j ? '' : j.destajo ? `€${Number(j.destajo).toFixed(0)}` : fmtHorasMin(j.horas)}
                    </td>
                  )
                })}
                <td className="border border-gray-300 p-1 text-center">{fmtHorasMin(totalHoras)}</td>
                <td className="border border-gray-300 p-1 text-right">€{hPesos.toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right">€{(Number(it.total_devengado) - hPesos).toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right">€{Number(it.total_devengado).toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right">€{Number(it.total_adelantos).toFixed(2)}</td>
                <td className="border border-gray-300 p-1 text-right font-bold">€{Number(it.total_pagado).toFixed(2)}</td>
                <td className="border border-gray-300 p-1"></td>
              </tr>
            )
          })}
          <tr className="font-bold" style={{ background: '#1f4e78', color: '#fff' }}>
            <td className="border border-gray-400 p-1">TOTAL</td>
            {dias.map((d) => <td key={d.iso} className="border border-gray-400 p-1"></td>)}
            <td className="border border-gray-400 p-1"></td>
            <td className="border border-gray-400 p-1"></td>
            <td className="border border-gray-400 p-1"></td>
            <td className="border border-gray-400 p-1 text-right">€{totalGanado.toFixed(2)}</td>
            <td className="border border-gray-400 p-1 text-right">€{totalAdelantos.toFixed(2)}</td>
            <td className="border border-gray-400 p-1 text-right">€{(totalGanado - totalAdelantos).toFixed(2)}</td>
            <td className="border border-gray-400 p-1"></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
