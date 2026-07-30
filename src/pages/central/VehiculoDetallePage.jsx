import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LogOut, ArrowLeft, Edit2, X, Check, Trash2, Plus, ChevronDown, ChevronUp, UserX } from 'lucide-react'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Button        from '../../components/ui/Button.jsx'
import Input         from '../../components/ui/Input.jsx'
import Modal         from '../../components/ui/Modal.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'
import FormVehiculo  from '../../components/forms/central/FormVehiculo.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout } from '../../lib/api/auth.js'
import {
  getVehiculoPorId, actualizarVehiculo, calcularBajaVehiculo, darDeBajaVehiculo,
  actualizarPlazasVehiculoDia, listarPlazasVehiculoPendientes,
  listarAdelantosVehiculoPendientes, registrarAdelantoVehiculo,
  actualizarMontoAdelantoVehiculo, eliminarAdelantoVehiculo,
} from '../../lib/api/vehicles.js'
import { getHistorialPagosVehiculo, ejecutarPagoVehiculo } from '../../lib/api/records.js'
import { calcularPeriodoCiclo } from '../../lib/api/paymentLists.js'
import { useRealtime } from '../../hooks/useRealtime.js'
import { Direccion, APP_CONFIG } from '../../utils/constants.js'

/* ─── Sección plegable (igual que en TrabajadorDetallePage) ─── */
function Collapsible({ title, color = 'green', children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <SectionTitle color={color} className="mb-0">{title}</SectionTitle>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  )
}

/* ─── Helpers Cambio 1.4.4 ───────────────────────────────────
   Deducen el tipo de ciclo a partir de la duración del período
   liquidado y formatean fechas cortas para la tabla. */
function tipoCiclo(inicio, fin) {
  const dias = Math.round((new Date(fin) - new Date(inicio)) / 86400000) + 1
  if (dias <= 1)  return 'Diario'
  if (dias <= 16) return 'Quincenal'
  return 'Mensual'
}
const fmtCorta = (s) =>
  new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function VehiculoDetallePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { rol, clear } = useAuthStore()

  const [vehiculo, setVehiculo] = useState(null)
  const [diasVehiculo, setDiasVehiculo] = useState([])
  const [pagos, setPagos]       = useState([])   // Cambio 1.4.4: historial liquidado
  const [adelantos, setAdelantos] = useState([]) // Cambio 1.5.3
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Cambio 1.5.1: edición de datos del vehículo
  const [editando, setEditando]     = useState(false)
  const [formEdit, setFormEdit]     = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError]   = useState(null)

  // Migración 009: edición de plazas de un día puntual del vehículo
  const [editandoDiaId, setEditandoDiaId] = useState(null)
  const [plazasEdit, setPlazasEdit] = useState('')
  const [savingPlazas, setSavingPlazas] = useState(false)

  // Cambio 1.5.3: alta de adelanto de vehículo
  const [formAdelanto, setFormAdelanto] = useState({ concepto: '', monto: '' })
  const [savingAdelanto, setSavingAdelanto] = useState(false)
  const [adelantoError, setAdelantoError] = useState(null)
  const [editandoAdelantoId, setEditandoAdelantoId] = useState(null)
  const [montoAdelantoEdit, setMontoAdelantoEdit] = useState('')

  // Cambio 1.5.3 (Octava llamada): editar/eliminar adelantos de vehículo
  // ahora piden confirmación con el Modal de la app (antes usaban
  // `confirm()` nativo) — así cumplimos literal el "mensaje emergente
  // (modal)" que pide el documento para ambas acciones.
  const [confirmAccion, setConfirmAccion] = useState(null) // { tipo: 'editar'|'eliminar', adelantoId, monto? }
  const [savingConfirmAccion, setSavingConfirmAccion] = useState(false)

  // Baja con liquidación forzada (C.5): Fase A calcula lo que se le debe a
  // la furgoneta, Fase B liquida y borra tras confirmar el monto real.
  const [bajaModalOpen, setBajaModalOpen]   = useState(false)
  const [bajaCalculo, setBajaCalculo]       = useState(null)
  const [calculandoBaja, setCalculandoBaja] = useState(false)
  const [savingBaja, setSavingBaja]         = useState(false)
  const [bajaError, setBajaError]           = useState(null)

  // Pendiente #4: liquidar el ciclo activo del vehículo (RPC
  // ejecutar_pago_vehiculo, migración 008), con modal de confirmación
  // igual que el resto de acciones irreversibles de esta página.
  const [pagarModalOpen, setPagarModalOpen] = useState(false)
  const [savingPagar, setSavingPagar]       = useState(false)
  const [pagarError, setPagarError]         = useState(null)

  useEffect(() => {
    if (rol !== 'admin') navigate(Direccion.centralLogin, { replace: true })
  }, [rol, navigate])

  const cargar = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const veh = await getVehiculoPorId(id)
      setVehiculo(veh)
      setFormEdit({
        nombre: veh.nombre,
        matricula: veh.matricula ?? '',
        plazas_totales: veh.plazas_totales,
        tarifa_plaza: veh.tarifa_plaza,
        tipo_pago: veh.tipo_pago ?? 'quincenal',
        propietario: veh.propietario ?? '',
        pin_actual: veh.pin_actual ?? '',
      })

      // Cambio 1.5.4 (Octava llamada) + Migración 009: "Historial de Días"
      // muestra los días de plazas_vehiculo pendientes de pago del ciclo
      // activo (un total por vehículo+día) — al liquidarse pasan a
      // "Historial de Pagos" y se ocultan de aquí. `tarifa_plaza_aplicada`
      // es la tarifa congelada al registrar el día, no retroactiva.
      setDiasVehiculo(await listarPlazasVehiculoPendientes(id))

      // Cambio 1.4.4 (Séptima llamada): pagos ya liquidados al dueño de la
      // furgoneta, dentro de la ventana de retención de datos.
      const pagos_data = await getHistorialPagosVehiculo(id, APP_CONFIG.RETENTION_DAYS)
      setPagos(pagos_data)

      // Cambio 1.5.3 (Séptima llamada): adelantos pendientes del vehículo.
      setAdelantos(await listarAdelantosVehiculoPendientes(id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { if (id) cargar() }, [id, cargar])

  // Cambio 1.5.4 (Octava llamada): "Sincronización en tiempo real" de la
  // regla de los 3 historiales — cualquier cambio en plazas_vehiculo o
  // adelantos de ESTE vehículo (desde otro dispositivo/pestaña, p. ej. el
  // encargado registrando las plazas del día) recarga la página al
  // instante vía Supabase Realtime, sin necesidad de recargar manualmente.
  const onDiaRT = useCallback((payload) => {
    if (payload.new?.vehiculo_id === id || payload.old?.vehiculo_id === id) cargar()
  }, [id, cargar])
  useRealtime('jornada_furgoneta', onDiaRT, { event: '*' })

  const onAdelantoRT = useCallback((payload) => {
    if (payload.new?.vehiculo_id === id || payload.old?.vehiculo_id === id) cargar()
  }, [id, cargar])
  useRealtime('adelanto_furgoneta', onAdelantoRT, { event: '*' })

  // Cambio (octava.4): el documento dice "TODOS los historiales" de esta
  // regla — faltaba suscribir también historial_pagos (el tercero de los
  // 3). Hoy no hay ningún flujo que escriba ahí para vehículos (el pago
  // de vehículo sigue pendiente, ver changelog), pero la suscripción
  // queda lista para cuando se implemente, sin que haya que acordarse de
  // agregarla después.
  const onPagoRT = useCallback((payload) => {
    if (payload.new?.vehiculo_id === id) cargar()
  }, [id, cargar])
  useRealtime('pago_furgoneta', onPagoRT, { event: 'INSERT' })

  const handleSalir = async () => { await logout(); clear(); navigate(Direccion.login) }

  /* ── Cambio 1.5.1: guardar edición de datos del vehículo ──
     Solo afecta al registro del vehículo (nombre, matrícula, tarifa,
     etc.) — las jornadas ya guardadas mantienen la tarifa con la que se
     calculó su subtotal en su momento, así que el cambio no es retroactivo. */
  const handleGuardarEdit = async () => {
    setSavingEdit(true); setEditError(null)
    try {
      await actualizarVehiculo(id, {
        nombre: formEdit.nombre.trim(),
        matricula: formEdit.matricula?.trim() || null,
        plazas_totales: parseInt(formEdit.plazas_totales, 10) || 0,
        tarifa_plaza: parseFloat(formEdit.tarifa_plaza) || 0,
        tipo_pago: formEdit.tipo_pago,
        propietario: formEdit.propietario?.trim() || null,
        pin_actual: formEdit.pin_actual?.trim() || vehiculo.pin_actual,
      })
      await cargar()
      setEditando(false)
    } catch (err) { setEditError(err.message) }
    finally { setSavingEdit(false) }
  }

  /* ── Migración 009: guardar plazas editadas de un día del vehículo ── */
  const handleGuardarPlazas = async (diaId) => {
    const nuevo = parseInt(plazasEdit, 10)
    if (Number.isNaN(nuevo) || nuevo < 0) return
    if (!confirm(`¿Actualizar a ${nuevo} plazas ocupadas?`)) return
    setSavingPlazas(true)
    try {
      await actualizarPlazasVehiculoDia(diaId, nuevo)
      setEditandoDiaId(null)
      await cargar()
    } catch (err) { setError(err.message) }
    finally { setSavingPlazas(false) }
  }

  /* ── Cambio 1.5.3: alta de adelanto de vehículo ── */
  const handleAgregarAdelanto = async () => {
    setAdelantoError(null); setSavingAdelanto(true)
    try {
      await registrarAdelantoVehiculo({
        vehiculoId: id,
        concepto: formAdelanto.concepto,
        monto: parseFloat(formAdelanto.monto) || 0,
      })
      setFormAdelanto({ concepto: '', monto: '' })
      await cargar()
    } catch (err) { setAdelantoError(err.message) }
    finally { setSavingAdelanto(false) }
  }

  /* ── Cambio 1.5.3 (Octava llamada): confirmar edición/eliminación de un
       adelanto mediante el Modal de la app, no con `confirm()` nativo ── */
  const handleConfirmarAccionAdelanto = async () => {
    if (!confirmAccion) return
    setSavingConfirmAccion(true); setAdelantoError(null)
    try {
      if (confirmAccion.tipo === 'editar') {
        await actualizarMontoAdelantoVehiculo(confirmAccion.adelantoId, confirmAccion.monto)
        setEditandoAdelantoId(null)
      } else {
        await eliminarAdelantoVehiculo(confirmAccion.adelantoId)
      }
      setConfirmAccion(null)
      await cargar()
    } catch (err) {
      setAdelantoError(err.message)
    } finally {
      setSavingConfirmAccion(false)
    }
  }

  /* ── Baja con liquidación forzada — Fase A: calcular y abrir el modal ── */
  const handleAbrirBaja = async () => {
    setBajaError(null); setCalculandoBaja(true)
    try {
      const calculo = await calcularBajaVehiculo(id)
      setBajaCalculo(calculo)
      setBajaModalOpen(true)
    } catch (err) {
      setBajaError(err.message)
    } finally {
      setCalculandoBaja(false)
    }
  }

  /* ── Baja con liquidación forzada — Fase B: confirmar y ejecutar ──
     Si el monto cambió desde el cálculo, la RPC aborta con la cifra nueva —
     se refresca el cálculo para que el próximo intento compare correcto. */
  const handleConfirmarBaja = async () => {
    if (!bajaCalculo) return
    setSavingBaja(true); setBajaError(null)
    try {
      const periodo = calcularPeriodoCiclo(vehiculo.tipo_pago)
      await darDeBajaVehiculo({
        id,
        montoEsperado: bajaCalculo.monto_neto,
        periodoInicio: periodo.inicio,
        periodoFin: new Date().toISOString().slice(0, 10),
      })
      navigate(Direccion.CentralVehiculos)
    } catch (err) {
      setBajaError(err.message)
      try {
        setBajaCalculo(await calcularBajaVehiculo(id))
      } catch { /* deja visible el error original si el recálculo también falla */ }
      setSavingBaja(false)
    }
  }

  /* ── Pendiente #4: liquidar el ciclo activo del vehículo ──
     Cierra jornadas y adelantos pendientes del período (RPC
     ejecutar_pago_vehiculo, migración 008) y deja el registro fijo en
     Historial de Pagos. El período se calcula igual que en Resumen/Escanear,
     según el tipo_pago (Quincenal/Mensual) del vehículo. */
  const periodoActivo = useMemo(
    () => calcularPeriodoCiclo(vehiculo?.tipo_pago ?? 'quincenal'),
    [vehiculo?.tipo_pago]
  )

  const handlePagarVehiculo = async () => {
    setSavingPagar(true); setPagarError(null)
    try {
      await ejecutarPagoVehiculo({
        vehiculoId: id,
        periodoInicio: periodoActivo.inicio,
        periodoFin: periodoActivo.fin,
      })
      setPagarModalOpen(false)
      await cargar()
    } catch (err) {
      setPagarError(err.message)
    } finally {
      setSavingPagar(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-app-bg">
        <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
        <HorizontalNav />
        <div className="px-4 pt-4 pb-6 max-w-md mx-auto">
          <Card><p className="text-gray-400 text-xs text-center py-8">Cargando…</p></Card>
        </div>
      </div>
    )
  }

  if (error || !vehiculo) {
    return (
      <div className="min-h-screen bg-app-bg">
        <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
        <HorizontalNav />
        <div className="px-4 pt-4 pb-6 max-w-md mx-auto">
          <Card>
            <p className="text-danger text-xs text-center mb-4">{error || 'Vehículo no encontrado'}</p>
            <Button variant="outline" icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate(Direccion.CentralVehiculos)}>
              VOLVER A VEHÍCULOS
            </Button>
          </Card>
        </div>
      </div>
    )
  }

  // Usa la tarifa congelada por día (`tarifa_plaza_aplicada`, migración
  // 009); cae a la tarifa actual del vehículo como fallback solo para
  // filas anteriores a esa migración (quedaron con NULL).
  const totalAPagar = diasVehiculo.reduce(
    (acc, d) => acc + d.plazas * (d.tarifa_plaza_aplicada ?? (vehiculo.tarifa_plaza || 0)),
    0
  )

  return (
    <div className="min-h-screen bg-app-bg">
      <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
      <HorizontalNav />

      <div className="px-4 pt-4 pb-6 max-w-md mx-auto space-y-4">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => navigate(Direccion.CentralVehiculos)}
              className="text-gray-500 hover:text-navy-dark active:scale-90 transition-transform duration-160"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1">
              <h1 className="text-navy-dark font-bold text-sm">{vehiculo.nombre}</h1>
              <p className="text-gray-500 text-[10px]">{vehiculo.matricula ?? '—'}</p>
            </div>
            {/* Cambio 1.5.1 (Séptima llamada): edición de datos del vehículo */}
            <button
              onClick={() => { setEditando((e) => !e); setEditError(null) }}
              className="ml-3 p-2 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors"
            >
              {editando ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-gray-500 text-[10px] uppercase">PIN Actual</p>
              <p className="text-gold font-bold text-sm">{vehiculo.pin_actual}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-gray-500 text-[10px] uppercase">Tarifa/Plaza</p>
              <p className="text-navy-dark font-bold">€{vehiculo.tarifa_plaza}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-gray-500 text-[10px] uppercase">Tipo de Pago</p>
              <p className="text-navy-dark font-bold text-xs capitalize">{vehiculo.tipo_pago}</p>
            </div>
          </div>
        </Card>

        {editando && (
          <Card>
            <SectionTitle color="gold">Editar datos</SectionTitle>
            <p className="text-[10px] text-gray-400 mb-3 -mt-2">
              Los cambios aplican a futuras jornadas; el histórico ya registrado no se altera.
            </p>
            <FormVehiculo
              values={formEdit}
              onChange={(k) => (e) => setFormEdit({ ...formEdit, [k]: e.target.value })}
              onSubmit={handleGuardarEdit}
              saving={savingEdit}
              error={editError}
            />
          </Card>
        )}

        {/* ── Cambio 1.5.3 (Séptima llamada): Adelantos de Vehículo ──
            Adelantos/gastos entregados al dueño de la furgoneta. Solo se
            listan los pendientes de pago; editar/eliminar requieren
            confirmación explícita mediante un modal (Cambio 1.5.3
            actualizado en la Octava llamada). */}
        <Collapsible title={`Adelantos (${adelantos.length})`} color="gold" defaultOpen={adelantos.length > 0}>
          {adelantoError && <p className="text-danger text-xs mb-2">{adelantoError}</p>}

          <div className="bg-gray-50 rounded-xl p-3 space-y-3 mb-4">
            <Input label="Concepto (opcional)" placeholder="Ej: reparación"
              value={formAdelanto.concepto}
              onChange={(e) => setFormAdelanto({ ...formAdelanto, concepto: e.target.value })} />
            <Input label="Monto (€)" type="number" value={formAdelanto.monto}
              onChange={(e) => setFormAdelanto({ ...formAdelanto, monto: e.target.value })} />
            <Button variant="primary" icon={<Plus className="w-4 h-4" />}
              onClick={handleAgregarAdelanto} disabled={savingAdelanto || !formAdelanto.monto}>
              {savingAdelanto ? 'AÑADIENDO…' : 'AÑADIR ADELANTO'}
            </Button>
          </div>

          {adelantos.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-4">Sin adelantos pendientes.</p>
          ) : (
            <div className="space-y-2">
              {adelantos.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <p className="text-xs text-navy-dark truncate flex-1">{a.concepto || '—'}</p>
                  {editandoAdelantoId === a.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" autoFocus value={montoAdelantoEdit}
                        onChange={(e) => setMontoAdelantoEdit(e.target.value)}
                        className="w-16 px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs text-right"
                      />
                      <button
                        onClick={() => {
                          const monto = parseFloat(montoAdelantoEdit)
                          if (Number.isNaN(monto) || monto <= 0) return
                          setConfirmAccion({ tipo: 'editar', adelantoId: a.id, monto })
                        }}
                        className="text-primary"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditandoAdelantoId(null)} className="text-gray-400">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-danger">€{Number(a.monto).toFixed(2)}</p>
                      <button
                        onClick={() => { setEditandoAdelantoId(a.id); setMontoAdelantoEdit(String(a.monto)) }}
                        className="text-gray-400 hover:text-navy-dark"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmAccion({ tipo: 'eliminar', adelantoId: a.id })}
                        className="text-gray-400 hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-2 flex justify-between">
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Total adelantado</p>
                <p className="text-xs font-bold text-danger">
                  €{adelantos.reduce((s, a) => s + Number(a.monto), 0).toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </Collapsible>

        {/* ── Cambio 1.5.4 (Octava llamada) + Migración 009: Historial de
            Días [Nomina actual] — un total de plazas por vehículo+día, pendiente de pago
            (ver `cargar()` arriba); el texto de "sin datos" queda literal
            como lo pide el documento. */}
        <Collapsible title={`Nómina Actual (${diasVehiculo.length})`} color="green" defaultOpen={diasVehiculo.length > 0}>
          {diasVehiculo.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-8">Sin registros para el período actual</p>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-5 gap-2 bg-gray-50 p-2 text-[10px] font-semibold text-gray-500 uppercase">
                <span>Fecha</span> <span>Encargado</span> <span>Plazas</span> <span className="text-right">Total</span> <span></span>
              </div>
              {diasVehiculo.map(d => (
                <div key={d.id} className="grid grid-cols-5 gap-2 p-2 border-t border-gray-100 text-xs text-navy-dark items-center">
                  <span>{new Date(d.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</span>
                  <span className="truncate">{d.encargado?.nombre ?? '—'}</span>
                  {editandoDiaId === d.id ? (
                    <input
                      type="number" autoFocus value={plazasEdit}
                      onChange={(e) => setPlazasEdit(e.target.value)}
                      className="w-14 px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs"
                    />
                  ) : (
                    <span>{d.plazas}</span>
                  )}
                  <span className="text-right font-semibold">€{(d.plazas * (d.tarifa_plaza_aplicada ?? vehiculo.tarifa_plaza)).toFixed(2)}</span>
                  {editandoDiaId === d.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <button disabled={savingPlazas} onClick={() => handleGuardarPlazas(d.id)} className="text-primary">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditandoDiaId(null)} className="text-gray-400">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditandoDiaId(d.id); setPlazasEdit(String(d.plazas)) }}
                      className="flex justify-end text-gray-400 hover:text-navy-dark"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="grid grid-cols-5 gap-2 p-2 bg-primary/10 border-t border-gray-200 text-xs font-bold text-primary">
                <span className="col-span-3 text-right">TOTAL A PAGAR:</span>
                <span className="text-right">€{totalAPagar.toFixed(2)}</span>
                <span></span>
              </div>
            </div>
          )}
        </Collapsible>

        {/* ── Cambio 1.4.4 (Séptima llamada): Historial de Pagos [Nóminas Anteriores]──
            Tabla de SOLO LECTURA con los períodos consolidados ya liquidados
            al dueño de la furgoneta. Sin acciones de edición ni eliminación:
            funciona como comprobante y evidencia digital fija (los datos son
            transacciones financieras definitivas e inmutables). Opera dentro
            de la ventana de retención de datos (APP_CONFIG.RETENTION_DAYS). */}
        <Collapsible title={`Nóminas Anteriores (${pagos.length})`} color="gold" defaultOpen={pagos.length > 0}>
          {pagos.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-4">
              Sin pagos liquidados en los últimos {APP_CONFIG.RETENTION_DAYS} días.
            </p>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-5 gap-1 bg-gray-50 p-2 text-[9px] font-semibold text-gray-500 uppercase">
                <span>Ciclo</span>
                <span>Inicio/Cierre</span>
                <span className="text-right">Ganado</span>
                <span className="text-right">Adelantos</span>
                <span className="text-right">Pagado</span>
              </div>
              {pagos.map((p) => (
                <div key={p.id} className="grid grid-cols-5 gap-1 p-2 border-t border-gray-100 text-[10px] text-navy-dark items-center">
                  <span className="font-semibold">{tipoCiclo(p.periodo_inicio, p.periodo_fin)}</span>
                  <span className="leading-tight">
                    {fmtCorta(p.periodo_inicio)}<br />{fmtCorta(p.periodo_fin)}
                  </span>
                  <span className="text-right">€{Number(p.total_devengado).toFixed(2)}</span>
                  <span className="text-right text-danger">−€{Number(p.total_adelantos).toFixed(2)}</span>
                  <span className="text-right font-bold text-primary">€{Number(p.total_pagado).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[9px] text-gray-400 text-center">
            Registro de solo lectura · comprobante de pagos cerrados
          </p>
        </Collapsible>

        {/* ── Dar de baja — liquidación forzada (C.5) ──
            Ya no es un DELETE directo: calcular_baja_furgoneta calcula lo
            que se le debe (tarifa_aplicada × plazas_ocupadas − adelantos,
            sin filtro de fecha) y lo muestra antes de confirmar; solo
            entonces dar_de_baja_furgoneta liquida y borra, en una transacción. */}
        <Card>
          <SectionTitle color="gold">Dar de baja</SectionTitle>
          <p className="text-gray-400 text-[10px] mb-3">
            Calcula lo que se le debe, liquida ese monto y retira la furgoneta de forma permanente.
          </p>
          {bajaError && !bajaModalOpen && <p className="text-danger text-xs mb-2">{bajaError}</p>}
          <Button
            variant="outline"
            icon={<UserX className="w-4 h-4" />}
            className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
            onClick={handleAbrirBaja}
            disabled={calculandoBaja}
          >
            {calculandoBaja ? 'CALCULANDO…' : 'DAR DE BAJA'}
          </Button>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => navigate(Direccion.CentralVehiculos)}>VOLVER</Button>
          <Button
            variant="primary"
            disabled={diasVehiculo.length === 0 && adelantos.length === 0}
            onClick={() => { setPagarError(null); setPagarModalOpen(true) }}
          >
            PAGAR
          </Button>
        </div>
      </div>

      {/* ── Modal de confirmación — editar/eliminar adelanto (Cambio 1.5.3) ── */}
      <Modal
        open={!!confirmAccion}
        title={confirmAccion?.tipo === 'editar' ? 'Confirmar edición' : 'Confirmar eliminación'}
        onClose={() => { if (!savingConfirmAccion) setConfirmAccion(null) }}
      >
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            {confirmAccion?.tipo === 'editar'
              ? `¿Actualizar el monto de este adelanto a €${Number(confirmAccion?.monto ?? 0).toFixed(2)}?`
              : '¿Eliminar este adelanto? Esta acción no se puede deshacer.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setConfirmAccion(null)} disabled={savingConfirmAccion}>
              CANCELAR
            </Button>
            <Button variant="primary" onClick={handleConfirmarAccionAdelanto} disabled={savingConfirmAccion}>
              {savingConfirmAccion ? 'PROCESANDO…' : 'CONFIRMAR'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal de confirmación — baja con liquidación forzada ── */}
      <Modal
        open={bajaModalOpen}
        title="Confirmar baja"
        onClose={() => { if (!savingBaja) setBajaModalOpen(false) }}
      >
        <div className="space-y-4">
          {bajaError && <p className="text-danger text-xs">{bajaError}</p>}
          {bajaCalculo && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Generado</span>
                <span className="font-semibold text-navy-dark">€{bajaCalculo.total_devengado.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Adelantos</span>
                <span className="font-semibold text-danger">−€{bajaCalculo.total_adelantos.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-gray-200">
                <span className="text-gray-700 font-semibold">Neto a liquidar</span>
                <span className={`font-bold ${bajaCalculo.monto_neto < 0 ? 'text-danger' : 'text-primary'}`}>
                  €{bajaCalculo.monto_neto.toFixed(2)}
                </span>
              </div>
            </div>
          )}
          <p className="text-gray-600 text-sm">
            ¿Seguro que deseas dar de baja a <strong>{vehiculo.nombre}</strong>? Se liquidará el
            monto de arriba (jornadas y adelantos pendientes) y luego se borrará de forma <strong>permanente</strong>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setBajaModalOpen(false)} disabled={savingBaja}>
              CANCELAR
            </Button>
            <Button
              variant="outline"
              className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
              onClick={handleConfirmarBaja}
              disabled={savingBaja}
            >
              {savingBaja ? 'PROCESANDO…' : 'SÍ, DAR DE BAJA'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal de confirmación — Pagar ciclo de vehículo (Pendiente #4) ── */}
      <Modal
        open={pagarModalOpen}
        title="Confirmar pago"
        onClose={() => { if (!savingPagar) setPagarModalOpen(false) }}
      >
        <div className="space-y-4">
          {pagarError && <p className="text-danger text-xs">{pagarError}</p>}
          <p className="text-gray-600 text-sm">
            ¿Liquidar el ciclo <strong className="capitalize">{vehiculo.tipo_pago}</strong> ({periodoActivo.label}) de{' '}
            <strong>{vehiculo.nombre}</strong> por un total de <strong>€{totalAPagar.toFixed(2)}</strong>?
            Las jornadas y adelantos pendientes de este período pasarán al Historial de Pagos.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setPagarModalOpen(false)} disabled={savingPagar}>
              CANCELAR
            </Button>
            <Button variant="primary" onClick={handlePagarVehiculo} disabled={savingPagar}>
              {savingPagar ? 'PROCESANDO…' : 'CONFIRMAR PAGO'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
