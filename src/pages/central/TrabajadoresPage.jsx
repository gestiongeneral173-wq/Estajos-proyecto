import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Plus, Search, KeyRound, Copy, Settings, Trash2 } from 'lucide-react'

import Header         from '../../components/layout/Header.jsx'
import HorizontalNav  from '../../components/layout/HorizontalNav.jsx'
import Card           from '../../components/ui/Card.jsx'
import Button         from '../../components/ui/Button.jsx'
import Input          from '../../components/ui/Input.jsx'
import Modal          from '../../components/ui/Modal.jsx'
import SectionTitle   from '../../components/ui/SectionTitle.jsx'
import WorkerListItem from '../../components/domain/WorkerListItem.jsx'
import FormTrabajador from '../../components/forms/central/FormTrabajador.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout }       from '../../lib/api/auth.js'
import {
  listarTrabajadores, crearTrabajador, getBalanceTrabajador,
  getConfiguracionEmpleado, actualizarTarifaInicial,
} from '../../lib/api/workers.js'
import { generarPinRegistro, listarPinesRegistro, cancelarPinRegistro } from '../../lib/api/auth.js'
import {
  getConfiguracionTemporal, actualizarTarifaTemporal,
  listarTemporales, eliminarTemporal, eliminarTodosLosTemporales,
} from '../../lib/api/temporales.js'
import { getConfiguracionChofer, actualizarTarifaChofer } from '../../lib/api/choferes.js'

// IMPORTACIÓN IMPORTANTE: Direccion de constants.js : Para el uso de direcciones
import { Direccion } from '../../utils/constants.js'

// Cambio 1.3.2 (Octava llamada): se elimina por completo el filtro
// "Empleados diarios" (esta lista solo muestra empleados fijos con
// persistencia — `es_temporal = false` ya los excluía siempre, así que el
// filtro no mostraba nada útil). En su lugar, "Encargados" filtra a todo
// el personal con `es_encargado = true`, facilitando su identificación y
// control en un solo clic.
const FILTROS = [
  { key: 'todos',      label: 'Todos' },
  { key: 'mensual',    label: 'Mensual' },
  { key: 'quincenal',  label: 'Quincenal' },
  { key: 'encargados', label: 'Encargados' }
]

export default function TrabajadoresPage() {
  const navigate = useNavigate()
  const { rol, clear } = useAuthStore()

  const [filtro, setFiltro]             = useState('todos')
  const [busqueda, setBusqueda]         = useState('')
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [modalOpen, setModalOpen]       = useState(false)
  const [modalPin, setModalPin]         = useState(false)
  const [modalTemporales, setModalTemporales] = useState(false)
  const [modalChofer, setModalChofer]   = useState(false)

  useEffect(() => {
    // [Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login')
    if (rol !== 'admin') navigate(Direccion.centralLogin, { replace: true })
  }, [rol, navigate])

  const cargar = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await listarTrabajadores({ periodo: filtro, busqueda })
      const conBalance = await Promise.all(
        data.map(async (w) => ({
          ...w,
          paymentPeriod: w.payment_period,
          balance: await getBalanceTrabajador(w.id).catch(() => 0)
        }))
      )
      setTrabajadores(conBalance)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }, [filtro, busqueda])

  useEffect(() => { cargar() }, [cargar])

  // [Vinculo Global] Se usa la ruta centralizada definida en constants.js (Direccion.login = '/login')
  const handleSalir = async () => { await logout(); clear(); navigate(Direccion.login) }

  return (
    <div className="min-h-screen bg-app-bg">
      <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
      <HorizontalNav />

      <div className="px-4 pt-4 pb-6 max-w-md mx-auto space-y-4">
        <Card>
          {/* Cambio 1.3.1 (Séptima llamada): "Trabajadores" → "Registros" */}
          <SectionTitle color="green">Registros</SectionTitle>
          <Button variant="primary" icon={<Plus className="w-4 h-4" />}
            onClick={() => setModalOpen(true)}>
            AÑADIR TRABAJADOR
          </Button>
          {/* Cambio 1.3.1.1 (Octava llamada): explicación optimizada del PIN de registro */}
          <Button variant="dark" icon={<KeyRound className="w-4 h-4" />}
            className="mt-2" onClick={() => setModalPin(true)}>
            AUTORIZAR NUEVOS REGISTROS
          </Button>
          <Button variant="dark" icon={<Settings className="w-4 h-4" />}
            className="mt-2" onClick={() => setModalTemporales(true)}>
            CONFIGURAR TEMPORALES
          </Button>
          <Button variant="dark" icon={<Settings className="w-4 h-4" />}
            className="mt-2" onClick={() => setModalChofer(true)}>
            CONFIGURAR CHOFER
          </Button>
        </Card>

        <Card>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {FILTROS.map((f) => (
              <Button key={f.key} variant="pill" active={filtro === f.key}
                onClick={() => setFiltro(f.key)}>
                {f.label}
              </Button>
            ))}
          </div>
          <div className="mt-4 relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input placeholder="Buscar..." value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)} className="pl-9" />
          </div>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-danger text-xs text-center">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          {loading ? (
            <Card><p className="text-gray-400 text-xs text-center py-6">Cargando…</p></Card>
          ) : trabajadores.length === 0 ? (
            <Card><p className="text-gray-400 text-xs text-center py-6">No hay registros.</p></Card>
          ) : (
            trabajadores.map((w) => (
              <WorkerListItem
                key={w.id}
                worker={w}
                // FIX: corregido typo "avigate" → "navigate"
                // [Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/trabajadores')
                onClick={() => navigate(`${Direccion.CentralTrabajadores}/${w.id}`)}
              />
            ))
          )}
        </div>
      </div>

      <ModalTrabajador
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); cargar() }}
      />

      <ModalPinRegistro open={modalPin} onClose={() => setModalPin(false)} />

      <ModalConfiguracionTemporal open={modalTemporales} onClose={() => setModalTemporales(false)} />

      <ModalConfiguracionChofer open={modalChofer} onClose={() => setModalChofer(false)} />
    </div>
  )
}

/* ─── Modal generar PIN de registro (Cambio #7 / optimizado en 1.3.1.1) ───
   Incluye la tarifa inicial de autoregistro arriba del todo — vive aquí
   porque es la misma configuración que usa este flujo (registrar_trabajador
   _con_pin la lee al crear al empleado), así el admin la ve/ajusta justo
   antes de generar el código, sin tener que acordarse de otra pantalla. */
function ModalPinRegistro({ open, onClose }) {
  const [cupo, setCupo]     = useState('')
  const [pin, setPin]       = useState(null)
  const [error, setError]   = useState(null)
  const [saving, setSaving] = useState(false)

  const [tarifa, setTarifa]                 = useState('')
  const [cargandoTarifa, setCargandoTarifa] = useState(false)
  const [editandoTarifa, setEditandoTarifa] = useState(false)
  const [savingTarifa, setSavingTarifa]     = useState(false)
  const [tarifaError, setTarifaError]       = useState(null)
  const [tarifaGuardada, setTarifaGuardada] = useState(false)

  // Lista de PINs activos (todavía dentro de su ventana de 24h) — se recarga
  // al abrir el modal, al generar un PIN nuevo y al cancelar uno.
  const [pines, setPines]               = useState([])
  const [cargandoPines, setCargandoPines] = useState(false)
  const [pinesError, setPinesError]     = useState(null)

  const [confirmandoCancelar, setConfirmandoCancelar] = useState(null) // id
  const [cancelando, setCancelando]                   = useState(false)
  const [cancelarError, setCancelarError]             = useState(null)

  const cargarPines = () => {
    setCargandoPines(true); setPinesError(null)
    return listarPinesRegistro()
      .then(setPines)
      .catch((err) => setPinesError(err.message))
      .finally(() => setCargandoPines(false))
  }

  useEffect(() => {
    if (!open) return
    setCargandoTarifa(true); setTarifaError(null)
    getConfiguracionEmpleado()
      .then((c) => setTarifa(c ? String(c.tarifa_hora_inicial) : ''))
      .catch((err) => setTarifaError(err.message))
      .finally(() => setCargandoTarifa(false))
    cargarPines()
  }, [open])

  const tarifaValida = parseFloat(tarifa) > 0

  const handleGuardarTarifa = async () => {
    setTarifaError(null); setSavingTarifa(true)
    try {
      await actualizarTarifaInicial(parseFloat(tarifa))
      setEditandoTarifa(false)
      setTarifaGuardada(true)
      setTimeout(() => setTarifaGuardada(false), 1500)
    } catch (err) { setTarifaError(err.message) } finally { setSavingTarifa(false) }
  }

  const handleGenerar = async () => {
    setError(null); setSaving(true)
    try {
      const r = await generarPinRegistro(parseInt(cupo, 10))
      setPin(r)
      await cargarPines()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const handleCancelarPin = async () => {
    if (!confirmandoCancelar) return
    setCancelarError(null); setCancelando(true)
    try {
      await cancelarPinRegistro(confirmandoCancelar)
      setConfirmandoCancelar(null)
      await cargarPines()
    } catch (err) {
      setCancelarError(err.message)
    } finally {
      setCancelando(false)
    }
  }

  const reset = () => { setCupo(''); setPin(null); setError(null); setEditandoTarifa(false); setConfirmandoCancelar(null) }

  return (
    <>
    {/* Cambio 1.3.1.1 (Octava llamada): título y explicación optimizados —
        se deja explícito y directo cómo se genera y consume el código, para
        que quede claro que cada uso descuenta un cupo y que el código se
        desactiva solo al agotarse, sin intervención manual del admin. */}
    <Modal open={open} title="Generar código de registro para nuevos empleados" onClose={() => { reset(); onClose() }}>
      <div className="space-y-4">
        {/* Tarifa inicial — recordatorio + edición rápida antes de generar
            el código, para que no ocurra el error de generarlo sin revisar
            a cuánto quedará pagado el que se autoregistre. */}
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[9px] text-gray-400 uppercase mb-2">Tarifa inicial de autoregistro</p>
          {tarifaError && <p className="text-danger text-[10px] mb-2">{tarifaError}</p>}
          {tarifaGuardada && <p className="text-primary text-[10px] mb-2">Tarifa actualizada.</p>}
          {cargandoTarifa ? (
            <p className="text-gray-400 text-xs">Cargando…</p>
          ) : editandoTarifa ? (
            <div className="space-y-2">
              <Input
                label="Tarifa por hora (€)"
                type="number"
                min="0.01"
                step="0.01"
                value={tarifa}
                onChange={(e) => setTarifa(e.target.value)}
              />
              {tarifa !== '' && !tarifaValida && (
                <p className="text-danger text-[10px]">Debe ser mayor a 0.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setEditandoTarifa(false)} disabled={savingTarifa}>
                  CANCELAR
                </Button>
                <Button variant="primary" onClick={handleGuardarTarifa} disabled={savingTarifa || !tarifaValida}>
                  {savingTarifa ? 'GUARDANDO…' : 'GUARDAR'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-navy-dark">€{Number(tarifa || 0).toFixed(2)}/h</p>
              <button onClick={() => setEditandoTarifa(true)} className="text-gray-400 hover:text-navy-dark">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[9px] text-gray-400 uppercase mb-2">Generar código</p>
          {error && <p className="text-danger text-xs mb-2">{error}</p>}
          {!pin ? (
            <div className="space-y-3">
              <p className="text-gray-500 text-xs">
                Cada uso del PIN descontará un cupo disponible. Al agotarse los
                cupos, el código se desactivará de forma automática.
              </p>
              <Input
                label="¿Cuántos empleados se registrarán?"
                type="number"
                value={cupo}
                onChange={(e) => setCupo(e.target.value)}
              />
              <Button variant="primary" onClick={handleGenerar}
                disabled={saving || !cupo || parseInt(cupo, 10) <= 0}>
                {saving ? 'GENERANDO…' : 'GENERAR CÓDIGO'}
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <p className="text-gray-500 text-xs">Comparte este código con los nuevos empleados:</p>
              <div className="bg-gold/10 border border-gold/30 rounded-xl py-4">
                <p className="text-3xl font-bold tracking-widest text-navy-dark">{pin.pin}</p>
              </div>
              <p className="text-[10px] text-gray-400">
                {pin.cupo_total} cupos · válido 24 h · se desactiva solo al agotarse
              </p>
              <Button variant="dark" icon={<Copy className="w-4 h-4" />}
                onClick={() => navigator.clipboard?.writeText(pin.pin)}>
                COPIAR CÓDIGO
              </Button>
              <button onClick={reset} className="w-full text-gray-500 text-xs">
                Generar otro
              </button>
            </div>
          )}
        </div>

        {/* Lista de PINs activos — sigue mostrando el código en texto (por
            si no se copió a tiempo) y cuántos ya se registraron con él. */}
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[9px] text-gray-400 uppercase mb-2">PINs activos</p>
          {pinesError && <p className="text-danger text-xs mb-2">{pinesError}</p>}
          {cargandoPines ? (
            <p className="text-gray-400 text-xs text-center py-3">Cargando…</p>
          ) : pines.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-3">No hay PINs activos.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1 pb-2 border-b border-gray-100">
                {['PIN', 'Usos', ''].map((h, i) => (
                  <p key={i} className="text-[9px] font-semibold text-gray-400 uppercase text-center first:text-left">{h}</p>
                ))}
              </div>
              {pines.map((p) => (
                <div key={p.id} className="grid grid-cols-3 gap-1 py-1.5 border-b border-gray-50 last:border-0 items-center">
                  <p className="text-[11px] font-bold tracking-widest text-navy-dark">{p.pin}</p>
                  <p className="text-[10px] text-center text-navy-dark">{p.cantidad_uso}/{p.maximo_uso}</p>
                  <button onClick={() => setConfirmandoCancelar(p.id)} className="flex justify-end text-gray-400 hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>

    {/* Confirmación de cancelación — nunca un confirm() nativo, mismo
        patrón que "Eliminar temporal" en ModalConfiguracionTemporal. */}
    <Modal
      open={!!confirmandoCancelar}
      title="Confirmar cancelación"
      onClose={() => { if (!cancelando) setConfirmandoCancelar(null) }}
    >
      <div className="space-y-4">
        <p className="text-gray-600 text-sm">
          ¿Cancelar este PIN de registro? Esta acción no se puede deshacer.
        </p>
        {cancelarError && <p className="text-danger text-xs">{cancelarError}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setConfirmandoCancelar(null)} disabled={cancelando}>
            VOLVER
          </Button>
          <Button
            variant="outline"
            className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
            onClick={handleCancelarPin}
            disabled={cancelando}
          >
            {cancelando ? 'CANCELANDO…' : 'SÍ, CANCELAR'}
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}

/* ─── Modal configuración de temporales ───
   Tarifa de temporales (mismo bloque que la tarifa inicial de autoregistro,
   otro origen de datos) + lista de temporales del día con purga automática
   a la 1 AM y borrado manual (individual o "todos"), exclusivo del admin
   por diseño (RLS: admin_temporal FOR ALL). */
function ModalConfiguracionTemporal({ open, onClose }) {
  const [tarifa, setTarifa]                 = useState('')
  const [cargandoTarifa, setCargandoTarifa] = useState(false)
  const [editandoTarifa, setEditandoTarifa] = useState(false)
  const [savingTarifa, setSavingTarifa]     = useState(false)
  const [tarifaError, setTarifaError]       = useState(null)
  const [tarifaGuardada, setTarifaGuardada] = useState(false)

  const [temporales, setTemporales]           = useState([])
  const [cargandoTemporales, setCargandoTemporales] = useState(false)
  const [temporalesError, setTemporalesError] = useState(null)

  const [confirmando, setConfirmando]       = useState(null) // id | 'todos'
  const [eliminando, setEliminando]         = useState(false)
  const [eliminarError, setEliminarError]   = useState(null)

  const cargarTemporales = () => {
    setCargandoTemporales(true); setTemporalesError(null)
    return listarTemporales()
      .then(setTemporales)
      .catch((err) => setTemporalesError(err.message))
      .finally(() => setCargandoTemporales(false))
  }

  useEffect(() => {
    if (!open) return
    setCargandoTarifa(true); setTarifaError(null)
    getConfiguracionTemporal()
      .then((c) => setTarifa(c ? String(c.tarifa_hora_temporal) : ''))
      .catch((err) => setTarifaError(err.message))
      .finally(() => setCargandoTarifa(false))
    cargarTemporales()
  }, [open])

  const tarifaValida = parseFloat(tarifa) > 0

  const handleGuardarTarifa = async () => {
    setTarifaError(null); setSavingTarifa(true)
    try {
      await actualizarTarifaTemporal(parseFloat(tarifa))
      setEditandoTarifa(false)
      setTarifaGuardada(true)
      setTimeout(() => setTarifaGuardada(false), 1500)
    } catch (err) { setTarifaError(err.message) } finally { setSavingTarifa(false) }
  }

  const handleConfirmarEliminar = async () => {
    if (!confirmando) return
    setEliminarError(null); setEliminando(true)
    try {
      if (confirmando === 'todos') {
        await eliminarTodosLosTemporales()
      } else {
        await eliminarTemporal(confirmando)
      }
      setConfirmando(null)
      await cargarTemporales()
    } catch (err) {
      setEliminarError(err.message)
    } finally {
      setEliminando(false)
    }
  }

  const reset = () => { setEditandoTarifa(false); setConfirmando(null) }

  return (
    <>
      <Modal open={open} title="Configurar temporales" onClose={() => { reset(); onClose() }}>
        <div className="space-y-4">
          {/* Tarifa de temporales — mismo bloque que la tarifa inicial de
              autoregistro (ModalPinRegistro), otro origen de datos. */}
          <div className="bg-gray-50 rounded-xl p-3">
            {tarifaError && <p className="text-danger text-[10px] mb-2">{tarifaError}</p>}
            {tarifaGuardada && <p className="text-primary text-[10px] mb-2">Tarifa actualizada.</p>}
            {cargandoTarifa ? (
              <p className="text-gray-400 text-xs">Cargando tarifa de temporales…</p>
            ) : editandoTarifa ? (
              <div className="space-y-2">
                <Input
                  label="Tarifa por hora (€)"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={tarifa}
                  onChange={(e) => setTarifa(e.target.value)}
                />
                {tarifa !== '' && !tarifaValida && (
                  <p className="text-danger text-[10px]">Debe ser mayor a 0.</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setEditandoTarifa(false)} disabled={savingTarifa}>
                    CANCELAR
                  </Button>
                  <Button variant="primary" onClick={handleGuardarTarifa} disabled={savingTarifa || !tarifaValida}>
                    {savingTarifa ? 'GUARDANDO…' : 'GUARDAR'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[9px] text-gray-400 uppercase">Tarifa de temporales</p>
                  <p className="text-sm font-bold text-navy-dark">€{Number(tarifa || 0).toFixed(2)}/h</p>
                </div>
                <button onClick={() => setEditandoTarifa(true)} className="text-gray-400 hover:text-navy-dark">
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Lista de temporales registrados hoy */}
          {temporalesError && <p className="text-danger text-xs">{temporalesError}</p>}
          {eliminarError && <p className="text-danger text-xs">{eliminarError}</p>}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[10px] text-gray-400 mb-2">
              Se eliminan automáticamente todos los días a la 1:00 AM. Puedes eliminarlos
              antes si lo necesitas.
            </p>
            {cargandoTemporales ? (
              <p className="text-gray-400 text-xs text-center py-3">Cargando…</p>
            ) : temporales.length === 0 ? (
              <p className="text-gray-400 text-xs text-center py-3">Sin temporales registrados hoy.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-1 pb-2 border-b border-gray-100">
                  {['Nombre', 'Hora', 'Destajo', 'Pagado', ''].map((h, i) => (
                    <p key={i} className="text-[9px] font-semibold text-gray-400 uppercase text-center first:text-left">{h}</p>
                  ))}
                </div>
                {temporales.map((t) => {
                  // Mismo cálculo que el Subtotal de "Nómina Actual" (TrabajadorDetallePage):
                  // horas × tarifa + destajo. Para un temporal la tarifa suele ser 0
                  // ("solo cobra por destajo"), así que en la práctica Pagado ≈ destajo.
                  const pagado = Number(t.horas_trabajadas) * Number(t.trabajo_x_hora) + Number(t.destajo)
                  return (
                    <div key={t.id} className="grid grid-cols-5 gap-1 py-1.5 border-b border-gray-50 last:border-0 items-center">
                      <p className="text-[10px] font-semibold text-navy-dark truncate">{t.nombre_completo}</p>
                      <p className="text-[10px] text-center text-navy-dark">{t.horas_trabajadas}h</p>
                      <p className="text-[10px] text-center text-navy-dark">€{Number(t.destajo).toFixed(2)}</p>
                      <p className="text-[10px] text-center font-semibold text-primary">€{pagado.toFixed(2)}</p>
                      <button onClick={() => setConfirmando(t.id)} className="flex justify-end text-gray-400 hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {temporales.length > 0 && (
              <Button variant="outline" className="mt-3 !border-danger !text-danger hover:!bg-danger hover:!text-white"
                onClick={() => setConfirmando('todos')}>
                ELIMINAR TODOS
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmación de borrado — mismo patrón que "Dar de baja" /
          adelantos: nunca un confirm() nativo. */}
      <Modal
        open={!!confirmando}
        title="Confirmar eliminación"
        onClose={() => { if (!eliminando) setConfirmando(null) }}
      >
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            {confirmando === 'todos'
              ? '¿Eliminar todos los temporales registrados hoy? Esta acción no se puede deshacer.'
              : '¿Eliminar este temporal? Esta acción no se puede deshacer.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setConfirmando(null)} disabled={eliminando}>
              CANCELAR
            </Button>
            <Button
              variant="outline"
              className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
              onClick={handleConfirmarEliminar}
              disabled={eliminando}
            >
              {eliminando ? 'ELIMINANDO…' : 'SÍ, ELIMINAR'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

/* ─── Modal configuración de chofer ───
   Solo la tarifa por hora (fila única, mismo patrón que
   ModalConfiguracionTemporal) — la lista operativa de choferes pendientes
   de pago vive en ResumenPage, no aquí. */
function ModalConfiguracionChofer({ open, onClose }) {
  const [tarifa, setTarifa]                 = useState('')
  const [cargandoTarifa, setCargandoTarifa] = useState(false)
  const [editandoTarifa, setEditandoTarifa] = useState(false)
  const [savingTarifa, setSavingTarifa]     = useState(false)
  const [tarifaError, setTarifaError]       = useState(null)
  const [tarifaGuardada, setTarifaGuardada] = useState(false)

  useEffect(() => {
    if (!open) return
    setCargandoTarifa(true); setTarifaError(null)
    getConfiguracionChofer()
      .then((c) => setTarifa(c ? String(c.tarifa_hora_chofer) : ''))
      .catch((err) => setTarifaError(err.message))
      .finally(() => setCargandoTarifa(false))
  }, [open])

  const tarifaValida = parseFloat(tarifa) >= 0

  const handleGuardarTarifa = async () => {
    setTarifaError(null); setSavingTarifa(true)
    try {
      await actualizarTarifaChofer(parseFloat(tarifa))
      setEditandoTarifa(false)
      setTarifaGuardada(true)
      setTimeout(() => setTarifaGuardada(false), 1500)
    } catch (err) { setTarifaError(err.message) } finally { setSavingTarifa(false) }
  }

  return (
    <Modal open={open} title="Configurar chofer" onClose={() => { setEditandoTarifa(false); onClose() }}>
      <div className="bg-gray-50 rounded-xl p-3">
        {tarifaError && <p className="text-danger text-[10px] mb-2">{tarifaError}</p>}
        {tarifaGuardada && <p className="text-primary text-[10px] mb-2">Tarifa actualizada.</p>}
        {cargandoTarifa ? (
          <p className="text-gray-400 text-xs">Cargando tarifa de chofer…</p>
        ) : editandoTarifa ? (
          <div className="space-y-2">
            <Input
              label="Tarifa por hora de chofer (€)"
              type="number"
              min="0"
              step="0.01"
              value={tarifa}
              onChange={(e) => setTarifa(e.target.value)}
            />
            {tarifa !== '' && !tarifaValida && (
              <p className="text-danger text-[10px]">No puede ser negativa.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setEditandoTarifa(false)} disabled={savingTarifa}>
                CANCELAR
              </Button>
              <Button variant="primary" onClick={handleGuardarTarifa} disabled={savingTarifa || !tarifaValida}>
                {savingTarifa ? 'GUARDANDO…' : 'GUARDAR'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] text-gray-400 uppercase">Tarifa de chofer</p>
              <p className="text-sm font-bold text-navy-dark">€{Number(tarifa || 0).toFixed(2)}/h</p>
            </div>
            <button onClick={() => setEditandoTarifa(true)} className="text-gray-400 hover:text-navy-dark">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <p className="mt-3 text-[10px] text-gray-400 text-center">
        Esta tarifa se copia a cada chofer del día al asignarlo — cambiarla no afecta
        a los ya registrados. El pago del chofer es informativo (Resumen · Choferes),
        el cliente entrega esa diferencia por fuera del sistema.
      </p>
    </Modal>
  )
}

/* ─── Modal de creación ─── */
function ModalTrabajador({ open, onClose, onSaved }) {
  // Cambio 1.3.1.2 (Octava llamada): "tarifa_destajo" eliminado del alta —
  // el destajo se registra por jornada (monto variable), nunca como una
  // tarifa fija de configuración inicial.
  const [form, setForm] = useState({
    nombre: '', telefono: '', payment_period: 'mensual',
    tarifa_hora: ''
  })
  const [error, setError]   = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // `ModalTrabajador` nunca se desmonta (Modal solo oculta su contenido con
  // `open`), así que `form` y `error` sobreviven a cerrar el modal si no se
  // limpian a propósito — mismo patrón que ya usa `reset()` en ModalPinRegistro.
  const reset = () => {
    setForm({ nombre: '', telefono: '', payment_period: 'mensual', tarifa_hora: '' })
    setError(null)
  }

  const handleSave = async () => {
    setError(null); setSaving(true)
    try {
      await crearTrabajador({
        nombre:         form.nombre.trim(),
        telefono:       form.telefono.trim(),
        payment_period: form.payment_period,
        tarifa_hora:    parseFloat(form.tarifa_hora) || 0
      })
      reset()
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} title="Nuevo Trabajador" onClose={() => { reset(); onClose() }}>
      <FormTrabajador
        modo="crear"
        values={form}
        onChange={set}
        onSubmit={handleSave}
        saving={saving}
        error={error}
      />
    </Modal>
  )
}
