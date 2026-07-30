import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Plus, Search, KeyRound, Copy, Settings } from 'lucide-react'

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
import { generarPinRegistro } from '../../lib/api/auth.js'

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

  useEffect(() => {
    if (!open) return
    setCargandoTarifa(true); setTarifaError(null)
    getConfiguracionEmpleado()
      .then((c) => setTarifa(c ? String(c.tarifa_hora_inicial) : ''))
      .catch((err) => setTarifaError(err.message))
      .finally(() => setCargandoTarifa(false))
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
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const reset = () => { setCupo(''); setPin(null); setError(null); setEditandoTarifa(false) }

  return (
    // Cambio 1.3.1.1 (Octava llamada): título y explicación optimizados —
    // se deja explícito y directo cómo se genera y consume el código, para
    // que quede claro que cada uso descuenta un cupo y que el código se
    // desactiva solo al agotarse, sin intervención manual del admin.
    <Modal open={open} title="Generar código de registro para nuevos empleados" onClose={() => { reset(); onClose() }}>
      <div className="space-y-4">
        {/* Tarifa inicial — recordatorio + edición rápida antes de generar
            el código, para que no ocurra el error de generarlo sin revisar
            a cuánto quedará pagado el que se autoregistre. */}
        <div className="bg-gray-50 rounded-xl p-3">
          {tarifaError && <p className="text-danger text-[10px] mb-2">{tarifaError}</p>}
          {tarifaGuardada && <p className="text-primary text-[10px] mb-2">Tarifa actualizada.</p>}
          {cargandoTarifa ? (
            <p className="text-gray-400 text-xs">Cargando tarifa inicial…</p>
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
                <p className="text-[9px] text-gray-400 uppercase">Tarifa inicial de autoregistro</p>
                <p className="text-sm font-bold text-navy-dark">€{Number(tarifa || 0).toFixed(2)}/h</p>
              </div>
              <button onClick={() => setEditandoTarifa(true)} className="text-gray-400 hover:text-navy-dark">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-danger text-xs">{error}</p>}

        {!pin ? (
          <>
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
          </>
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
