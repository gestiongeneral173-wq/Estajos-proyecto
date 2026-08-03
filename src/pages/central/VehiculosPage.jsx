import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Plus, Truck, RefreshCw, Clock } from 'lucide-react'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Button        from '../../components/ui/Button.jsx'
import Input         from '../../components/ui/Input.jsx'
import Modal         from '../../components/ui/Modal.jsx'
import CircleIcon    from '../../components/ui/CircleIcon.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout } from '../../lib/api/auth.js'
import {
  listarVehiculos, crearVehiculo, rotarPinVehiculo,
  getTotalAdelantosVehiculoPendientes, getCicloActivoAPagarVehiculo
} from '../../lib/api/vehicles.js'

//IMPORTACIÓN IMPORTANTE:  Direccion de constants.js : Para el uso de direcciones
import { Direccion } from '../../utils/constants.js'


/* ─────────────────────────────────────────
   Hook: cuenta regresiva hasta próxima
   rotación de PIN (basada en pin_rotated_at)
───────────────────────────────────────── */
function usePinCountdown(pinRotatedAt) {
  const [timeLeft, setTimeLeft] = useState('')
  const [pct, setPct]           = useState(100)

  useEffect(() => {
    const WINDOW_MS = 24 * 60 * 60 * 1000   // 24 h en ms

    const tick = () => {
      if (!pinRotatedAt) { setTimeLeft('—'); setPct(0); return }
      const rotated = new Date(pinRotatedAt).getTime()
      const nextRot = rotated + WINDOW_MS
      const remaining = nextRot - Date.now()

      if (remaining <= 0) {
        setTimeLeft('Rotando…'); setPct(0); return
      }
      const h  = Math.floor(remaining / 3600000)
      const m  = Math.floor((remaining % 3600000) / 60000)
      const s  = Math.floor((remaining % 60000) / 1000)
      setTimeLeft(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
      setPct(Math.round((remaining / WINDOW_MS) * 100))
    }

    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [pinRotatedAt])

  return { timeLeft, pct }
}

/* ─────────────────────────────────────────
   Sub-componente: tarjeta del vehículo
───────────────────────────────────────── */
function VehicleCard({ vehiculo, onPinRotated, onViewDetails }) {
  const { timeLeft, pct } = usePinCountdown(vehiculo.pin_actualizado_en)
  const [rotating, setRotating] = useState(false)

  // Color del arco de cuenta regresiva
  const arcColor = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444'

  // Circunferencia del círculo SVG (r=16)
  const R   = 16
  const C   = 2 * Math.PI * R
  const dash = (pct / 100) * C

  const handleRotar = async () => {
    setRotating(true)
    try {
      await rotarPinVehiculo(vehiculo.id)
      onPinRotated()
    } catch (err) {
      console.error(err)
    } finally { setRotating(false) }
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <CircleIcon icon={Truck} size="md" />
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onViewDetails}>
          <p className="text-navy-dark font-bold text-sm hover:text-primary transition-colors">{vehiculo.nombre}</p>
          <p className="text-gray-500 text-[10px]">{vehiculo.matricula ?? '—'} · {vehiculo.plazas_totales ?? '—'} plazas</p>
        </div>

        {/* PIN + countdown circular */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative flex items-center justify-center w-10 h-10">
            <svg className="absolute inset-0 w-10 h-10 -rotate-90" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r={R} fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle
                cx="20" cy="20" r={R}
                fill="none"
                stroke={arcColor}
                strokeWidth="3"
                strokeDasharray={`${dash} ${C}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 1s linear' }}
              />
            </svg>
            <span className="relative text-[9px] font-bold text-gold tracking-widest z-10">
              {vehiculo.pin_actual}
            </span>
          </div>
          <span className="text-[8px] text-gray-400 font-mono">{timeLeft}</span>
        </div>
      </div>

      {/* Botón rotar PIN manual + gastos */}
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-100">
        <button
          onClick={handleRotar}
          disabled={rotating}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-navy-dark transition-colors disabled:opacity-50 mr-auto"
          title="Rotar PIN ahora"
        >
          <RefreshCw className={`w-3 h-3 ${rotating ? 'animate-spin' : ''}`} />
          {rotating ? 'Rotando…' : 'Rotar PIN'}
        </button>

        <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Tarifa/plaza</p>
          <p className="text-navy-dark font-bold text-xs">€{vehiculo.tarifa_plaza}</p>
        </div>
        <div className="bg-red-50 rounded-lg px-3 py-1.5 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Adelantos</p>
          <p className="text-danger font-bold text-xs">€{Number(vehiculo.totalAdelantos).toFixed(0)}</p>
        </div>
      </div>

      {/* "Gastos" y "Adelantos" se unificaron en un solo historial
          (Errores del sistema detectado, sección Furgoneta) — la gestión
          completa (alta/editar/eliminar con confirmación) vive en el
          detalle del vehículo, no hace falta un modal aparte acá. */}
      <Button variant="dark" className="mt-3" onClick={onViewDetails}>
        VER ADELANTOS Y DETALLE
      </Button>
    </Card>
  )
}

/* ─────────────────────────────────────────
   PÁGINA PRINCIPAL
───────────────────────────────────────── */
export default function VehiculosPage() {
  const navigate = useNavigate()
  const { rol, clear } = useAuthStore()

  const [vehiculos, setVehiculos] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [modalVeh, setModalVeh]   = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    //[Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login')
    if (rol !== 'admin') navigate( Direccion.centralLogin , { replace: true })
  }, [rol, navigate])

  const cargar = useCallback(async () => {
    setLoading(true); 
    setError(null);
    try {
      const data = await listarVehiculos()
      
      if (!data || data.length === 0) {
        if (mountedRef.current) setVehiculos([])
        return
      }

      // Ciclo A PAGAR (candado global) resuelto UNA sola vez por tipo_pago
      // — no por vehículo — y reusado en el loop de abajo.
      const [periodoQ, periodoM] = await Promise.all([
        getCicloActivoAPagarVehiculo('quincenal'),
        getCicloActivoAPagarVehiculo('mensual'),
      ])
      const finPorTipo = { quincenal: periodoQ?.fin, mensual: periodoM?.fin }

      const conAdelantos = await Promise.all(
        data.map(async (v) => {
          try {
            const totalAdelantos = await getTotalAdelantosVehiculoPendientes(v.id, finPorTipo[v.tipo_pago])
            return { ...v, totalAdelantos }
          } catch (adelantoErr) {
            console.error(`Error cargando adelantos para vehículo ${v.id}:`, adelantoErr)
            return { ...v, totalAdelantos: 0 }
          }
        })
      )
      if (mountedRef.current) setVehiculos(conAdelantos)
    } catch (err) {
      console.error("Error crítico en cargar():", err)
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Rotación automática de PINs vencidos (Corregido sin bucle) ──
  // Redundancia: desde 2026-07-30 el cron `rotar-pins-furgoneta` ya
  // garantiza la rotación diaria sin depender de que esta pantalla esté
  // abierta. Este mecanismo queda como respaldo inofensivo — cuando el
  // cron ya rotó, este chequeo no encuentra vencidos y no hace nada.
  useEffect(() => {
    const WINDOW_MS = 24 * 60 * 60 * 1000

    const check = async () => {
      setVehiculos(prevVehiculos => {
        if (!prevVehiculos.length) return prevVehiculos

        const vencidos = prevVehiculos.filter((v) => {
          if (!v.pin_actualizado_en) return true
          return Date.now() - new Date(v.pin_actualizado_en).getTime() >= WINDOW_MS
        })

        if (vencidos.length > 0) {
          Promise.all(vencidos.map((v) => rotarPinVehiculo(v.id).catch((err) => {
            console.error(`No se pudo rotar el PIN de la furgoneta ${v.id}:`, err)
          })))
            .then(() => {
              if (mountedRef.current) cargar()
            })
        }
        return prevVehiculos
      })
    }

    check() 
    const iv = setInterval(check, 60000) 
    return () => clearInterval(iv)
  }, [cargar])

  //[Vinculo Global] Se usa la ruta centralizada definida en constants.js  (Direccion.login = '/login')
  const handleSalir = async () => { await logout(); clear(); navigate( Direccion.login ) }

  return (
    <div className="min-h-screen bg-app-bg">
      <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
      <HorizontalNav />

      <div className="px-4 pt-4 pb-6 max-w-md mx-auto space-y-4">
        <Card>
          <SectionTitle color="gold">Vehículos</SectionTitle>
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl p-2 mb-3">
            <Clock className="w-3 h-3 text-gold flex-shrink-0" />
            <p className="text-[10px] text-gray-500">
              Los PIN rotan automáticamente cada 24 h. El círculo muestra el tiempo restante.
            </p>
          </div>
          <Button variant="primary" icon={<Plus className="w-4 h-4" />}
            onClick={() => setModalVeh(true)}>
            AÑADIR VEHÍCULO
          </Button>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-danger text-xs text-center">{error}</p>
          </div>
        )}

        {loading ? (
          <Card><p className="text-gray-400 text-xs text-center py-6">Cargando…</p></Card>
        ) : vehiculos.length === 0 ? (
          <Card><p className="text-gray-400 text-xs text-center py-6">No hay vehículos.</p></Card>
        ) : (
          <div className="space-y-2">
            {vehiculos.map((v) => (
              <VehicleCard
                key={v.id}
                vehiculo={v}
                onPinRotated={cargar}
                onViewDetails={() => navigate(`${Direccion.CentralVehiculos}/${v.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <ModalVehiculo open={modalVeh} onClose={() => setModalVeh(false)}
        onSaved={() => { setModalVeh(false); cargar() }} />
    </div>
  )
}

/* ─── Modal crear vehículo ─── */
function ModalVehiculo({ open, onClose, onSaved }) {
  const [form, setForm] = useState({
    nombre: '', matricula: '', tarifa_plaza: '', tipo_pago: 'quincenal'
  })
  const [error, setError]   = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const tarifaValida = parseFloat(form.tarifa_plaza) > 0

  const handleSave = async () => {
    setError(null); setSaving(true)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        tarifa_plaza: parseFloat(form.tarifa_plaza) || 0,
        tipo_pago: form.tipo_pago
      }
      if (form.matricula.trim()) payload.matricula = form.matricula.trim()
      await crearVehiculo(payload)
      setForm({ nombre: '', matricula: '', tarifa_plaza: '', tipo_pago: 'quincenal' })
      onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal open={open} title="Nuevo Vehículo" onClose={onClose}>
      <div className="space-y-4">
        {error && <p className="text-danger text-xs">{error}</p>}
        <Input label="Nombre *" value={form.nombre} onChange={set('nombre')} />
        <Input label="Matrícula (opcional)" value={form.matricula} onChange={set('matricula')} />
        <Input label="Tarifa por plaza (€) *" type="number" min="0.01" step="0.01"
          value={form.tarifa_plaza} onChange={set('tarifa_plaza')} />
        {form.tarifa_plaza !== '' && !tarifaValida && (
          <p className="text-danger text-[10px] -mt-2">La tarifa por plaza debe ser mayor a 0.</p>
        )}
        <div>
          <label className="label-base">Tipo de Pago *</label>
          <select value={form.tipo_pago} onChange={set('tipo_pago')} className="input-base">
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={saving || !form.nombre || !tarifaValida}>
          {saving ? 'GUARDANDO…' : 'GUARDAR'}
        </Button>
      </div>
    </Modal>
  )
}