import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, ScanLine, UserCircle, X, Wallet, ArrowLeft } from 'lucide-react'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Button        from '../../components/ui/Button.jsx'
import Input         from '../../components/ui/Input.jsx'
import CircleIcon    from '../../components/ui/CircleIcon.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'
import Badge         from '../../components/ui/Badge.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout }       from '../../lib/api/auth.js'
import { getTrabajadorPorId } from '../../lib/api/workers.js'
import {
  registrarAdelanto, getJornadasTrabajadorPorPeriodo,
  getPagoPorPeriodo, getAdelantosPendientes, ejecutarPago
} from '../../lib/api/records.js'
import { PAYMENT_PERIOD_LABELS, Direccion } from '../../utils/constants.js'

/**
 * EscanearPage — Cambio #1 (Sexta llamada).
 *
 * Al escanear ya NO se va directo al pago. Aparece un MENÚ INTERMEDIO:
 *   · Cuadro de info del empleado (nombre, teléfono, tipo de pago) — siempre visible.
 *   · "Dar Adelanto"  → historial de adelantos del ciclo + alta de adelanto.
 *   · "Pagar Empleado" → liquidación del ciclo activo (días, adelantos, total).
 * Cada sub-vista tiene botón para volver al menú o salir a Escanear.
 */
export default function EscanearPage() {
  const navigate = useNavigate()
  const { rol, clear } = useAuthStore()

  const [escaneando, setEscaneando] = useState(false)
  const [trabajador, setTrabajador] = useState(null)
  const [vista,      setVista]      = useState('menu')   // 'menu' | 'adelanto' | 'pagar'
  const [error,      setError]      = useState(null)
  const [idManual,   setIdManual]   = useState('')

  const [jornadas,  setJornadas]  = useState([])
  const [adelantos, setAdelantos] = useState([])
  const [esPagado,  setEsPagado]  = useState(false)

  useEffect(() => {
    if (rol !== 'admin') navigate(Direccion.centralLogin, { replace: true })
  }, [rol, navigate])

  const calcularPeriodo = (t) => {
    const hoy = new Date()
    const year = hoy.getFullYear()
    const month = hoy.getMonth()
    const day = hoy.getDate()

    if (t.payment_period === 'quincenal') {
      const inicio = day <= 15
        ? new Date(year, month, 1).toISOString().slice(0, 10)
        : new Date(year, month, 16).toISOString().slice(0, 10)
      const fin = day <= 15
        ? new Date(year, month, 15).toISOString().slice(0, 10)
        : new Date(year, month + 1, 0).toISOString().slice(0, 10)
      return { inicio, fin, label: `${day <= 15 ? '1-15' : '16-fin'} ${hoy.toLocaleString('es-ES', { month: 'short', year: '2-digit' })}` }
    }
    // mensual (default)
    return {
      inicio: new Date(year, month, 1).toISOString().slice(0, 10),
      fin:    new Date(year, month + 1, 0).toISOString().slice(0, 10),
      label:  hoy.toLocaleString('es-ES', { month: 'long', year: 'numeric' })
    }
  }

  const cargarTrabajador = useCallback(async (id) => {
    setError(null)
    try {
      const t = await getTrabajadorPorId(id.trim())
      const periodo = calcularPeriodo(t)
      const [jorn, adel, pago] = await Promise.all([
        getJornadasTrabajadorPorPeriodo(t.id, periodo.inicio, periodo.fin),
        getAdelantosPendientes(t.id),
        getPagoPorPeriodo(t.id, periodo.inicio, periodo.fin),
      ])
      setTrabajador(t)
      setJornadas(jorn)
      setAdelantos(adel)
      setEsPagado(pago !== null)
      setVista('menu')
      setEscaneando(false)
    } catch {
      setError('Trabajador no encontrado.')
      setEscaneando(false)
    }
  }, [])

  // ── Scanner inline ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!escaneando) return

    let cancelado  = false
    let timeoutId  = null
    let scannerRef = null
    let isStarted  = false

    timeoutId = setTimeout(async () => {
      if (cancelado) return
      const { Html5Qrcode } = await import('html5-qrcode')
      if (cancelado) return

      const container = document.getElementById('qr-reader-central')
      if (!container) { setError('Contenedor de cámara no encontrado.'); setEscaneando(false); return }
      container.innerHTML = ''
      if (cancelado) return

      scannerRef = new Html5Qrcode('qr-reader-central')
      try {
        await scannerRef.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (txt) => {
            if (isStarted) { isStarted = false; scannerRef.stop().catch(() => {}) }
            cargarTrabajador(txt)
          },
          () => {}
        )
        if (!cancelado) isStarted = true
      } catch (err) {
        if (!cancelado) { setError('No se pudo abrir la cámara: ' + err.message); setEscaneando(false) }
      }
    }, 150)

    return () => {
      cancelado = true
      clearTimeout(timeoutId)
      const stopAndClean = async () => {
        if (scannerRef && isStarted) {
          isStarted = false
          try { await scannerRef.stop() } catch (_) {}
          try { scannerRef.clear?.() }   catch (_) {}
        }
        const container = document.getElementById('qr-reader-central')
        if (container) container.innerHTML = ''
      }
      stopAndClean()
    }
  }, [escaneando, cargarTrabajador])

  const handleSalir = async () => { await logout(); clear(); navigate(Direccion.login) }
  const volverAEscanear = () => { setTrabajador(null); setError(null); setVista('menu') }

  const periodo = trabajador ? calcularPeriodo(trabajador) : null
  const totalDias = jornadas.reduce((s, j) => s + (j.horas * (trabajador?.tarifa_hora || 0) + Number(j.destajo)), 0)
  const totalAdelantos = adelantos.reduce((s, a) => s + Number(a.monto), 0)

  return (
    <div className="min-h-screen bg-app-bg">
      <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
      <HorizontalNav />

      <div className="px-4 pt-4 pb-6 max-w-md mx-auto space-y-4">

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-danger text-xs text-center">{error}</p>
          </div>
        )}

        {/* ── Sin trabajador: escáner / manual ── */}
        {!trabajador && (
          <Card>
            <SectionTitle color="green">Escanear QR</SectionTitle>

            <div
              id="qr-reader-central"
              className={escaneando ? 'w-full rounded-xl overflow-hidden min-h-[240px] bg-gray-100' : 'hidden'}
            />

            {escaneando ? (
              <Button variant="outline" icon={<X className="w-4 h-4" />} className="mt-3"
                onClick={() => { setEscaneando(false); setError(null) }}>
                CANCELAR
              </Button>
            ) : (
              <>
                <div className="flex flex-col items-center py-6">
                  <CircleIcon icon={ScanLine} size="xl" shape="square" />
                  <p className="text-gray-500 text-xs text-center mt-4">
                    Escanea el QR del trabajador para ver sus opciones.
                  </p>
                </div>
                <Button variant="primary" icon={<ScanLine className="w-4 h-4" />}
                  onClick={() => { setError(null); setEscaneando(true) }}>
                  ESCANEAR QR
                </Button>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-gray-400 text-[10px] uppercase text-center mb-2">o código manual</p>
                  <div className="flex gap-2">
                    <input
                      value={idManual}
                      onChange={(e) => setIdManual(e.target.value)}
                      placeholder="Código del trabajador"
                      className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      onClick={() => idManual && cargarTrabajador(idManual)}
                      className="px-4 py-2 bg-navy-dark text-white rounded-lg text-xs font-semibold"
                    >
                      OK
                    </button>
                  </div>
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── Con trabajador: cuadro de info SIEMPRE visible ── */}
        {trabajador && (
          <>
            <Card>
              <div className="flex items-center gap-3">
                <CircleIcon icon={UserCircle} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-navy-dark font-bold text-sm truncate">{trabajador.nombre}</p>
                    <Badge variant={trabajador.payment_period} />
                  </div>
                  <p className="text-gray-500 text-[10px]">{trabajador.telefono}</p>
                  <p className="text-gray-400 text-[10px]">
                    Pago: {PAYMENT_PERIOD_LABELS[trabajador.payment_period] ?? trabajador.payment_period}
                  </p>
                </div>
              </div>
              {esPagado && (
                <div className="mt-3 p-2 bg-green-100 border border-green-300 rounded-lg text-center text-green-700 font-semibold text-xs">
                  ✅ PAGADO EN ESTE CICLO
                </div>
              )}
            </Card>

            {/* ── MENÚ ── */}
            {vista === 'menu' && (
              <Card>
                <SectionTitle color="green">¿Qué deseas hacer?</SectionTitle>
                <div className="space-y-3">
                  <Button variant="primary" onClick={() => { setError(null); setVista('adelanto') }}>
                    DAR ADELANTO
                  </Button>
                  <Button variant="dark" icon={<Wallet className="w-4 h-4" />}
                    onClick={() => { setError(null); setVista('pagar') }}>
                    PAGAR EMPLEADO
                  </Button>
                  <Button variant="outline" onClick={volverAEscanear}>
                    CANCELAR
                  </Button>
                </div>
              </Card>
            )}

            {/* ── DAR ADELANTO ── */}
            {vista === 'adelanto' && (
              <SeccionAdelanto
                trabajador={trabajador}
                adelantos={adelantos}
                onSaved={() => cargarTrabajador(trabajador.id)}
                onBack={() => setVista('menu')}
              />
            )}

            {/* ── PAGAR EMPLEADO ── */}
            {vista === 'pagar' && (
              <SeccionPagar
                trabajador={trabajador}
                periodo={periodo}
                jornadas={jornadas}
                totalDias={totalDias}
                totalAdelantos={totalAdelantos}
                esPagado={esPagado}
                onPaid={() => cargarTrabajador(trabajador.id)}
                onBack={() => setVista('menu')}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ─── Sub-vista: Dar adelanto ─── */
// Cambio 1.1.1 (Séptima llamada): se elimina el calendario. El adelanto se
// registra SIEMPRE con la fecha del día actual (automática, no editable)
// para garantizar la auditoría del proceso.
function SeccionAdelanto({ trabajador, adelantos, onSaved, onBack }) {
  const [monto, setMonto] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setError(null); setSaving(true)
    try {
      await registrarAdelanto({ empleadoId: trabajador.id, monto: parseFloat(monto) || 0 })
      setMonto('')
      onSaved()
      onBack()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const total = adelantos.reduce((s, a) => s + Number(a.monto), 0)

  return (
    <Card>
      <SectionTitle color="gold">Dar adelanto</SectionTitle>

      {/* Historial del ciclo activo (no pagados) */}
      <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="grid grid-cols-2 bg-gray-50 p-2 text-[10px] font-semibold text-gray-500 uppercase">
          <span>Fecha</span><span className="text-right">Monto</span>
        </div>
        {adelantos.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-3">Sin adelantos en este ciclo.</p>
        ) : (
          adelantos.map((a) => (
            <div key={a.id} className="grid grid-cols-2 p-2 border-t border-gray-100 text-xs text-navy-dark">
              <span>{new Date(/T/.test(a.fecha) ? a.fecha : `${a.fecha}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</span>
              <span className="text-right font-semibold">€{Number(a.monto).toFixed(2)}</span>
            </div>
          ))
        )}
        {adelantos.length > 0 && (
          <div className="grid grid-cols-2 p-2 bg-gray-50 border-t border-gray-200 text-xs font-bold text-navy-dark">
            <span>Total</span><span className="text-right">€{total.toFixed(2)}</span>
          </div>
        )}
      </div>

      {error && <p className="text-danger text-xs mb-2">{error}</p>}
      <div className="space-y-3">
        <Input label="Monto del adelanto (€)" type="number" value={monto}
          onChange={(e) => setMonto(e.target.value)} />
        <p className="text-[10px] text-gray-400 text-center">
          El adelanto se registrará automáticamente con la fecha de hoy
          ({new Date().toLocaleDateString('es-ES')}).
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
            VOLVER
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !monto}>
            {saving ? 'GUARDANDO…' : 'REGISTRAR'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ─── Sub-vista: Pagar empleado (liquidación del ciclo) ─── */
function SeccionPagar({ trabajador, periodo, jornadas, totalDias, totalAdelantos, esPagado, onPaid, onBack }) {
  const [error, setError] = useState(null)
  const [paying, setPaying] = useState(false)

  const totalAPagar = totalDias - totalAdelantos

  const handlePagar = async () => {
    if (!confirm(`¿Confirmar pago de €${totalAPagar.toFixed(2)} a ${trabajador.nombre}?`)) return
    setError(null); setPaying(true)
    try {
      await ejecutarPago({ empleadoId: trabajador.id, periodoInicio: periodo.inicio, periodoFin: periodo.fin })
      onPaid()
      onBack()
    } catch (err) { setError(err.message) } finally { setPaying(false) }
  }

  return (
    <Card>
      <SectionTitle color="green">Liquidación · {periodo.label}</SectionTitle>

      {/* Tabla de días trabajados */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-4 gap-2 bg-gray-50 p-2 text-[10px] font-semibold text-gray-500 uppercase">
          <span>Fecha</span><span>Horas</span><span>Destajo</span><span className="text-right">Total</span>
        </div>
        {jornadas.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-3">Sin días pendientes en este ciclo.</p>
        ) : jornadas.map((j) => (
          <div key={j.id} className="grid grid-cols-4 gap-2 p-2 border-t border-gray-100 text-xs text-navy-dark">
            <span>{new Date(/T/.test(j.fecha) ? j.fecha : `${j.fecha}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</span>
            <span>{j.horas}</span>
            <span>€{j.destajo}</span>
            <span className="text-right font-semibold">€{(j.horas * trabajador.tarifa_hora + Number(j.destajo)).toFixed(2)}</span>
          </div>
        ))}
        <div className="grid grid-cols-4 gap-2 p-2 bg-gray-50 border-t border-gray-200 text-xs font-bold text-navy-dark">
          <span className="col-span-3 text-right">Días trabajados:</span>
          <span className="text-right">€{totalDias.toFixed(2)}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 p-2 border-t border-gray-100 text-xs text-danger">
          <span className="col-span-3 text-right">Adelantos del ciclo:</span>
          <span className="text-right">−€{totalAdelantos.toFixed(2)}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 p-2 bg-primary/10 border-t border-gray-200 text-xs font-bold text-primary">
          <span className="col-span-3 text-right">Total a pagar:</span>
          <span className="text-right">€{totalAPagar.toFixed(2)}</span>
        </div>
      </div>

      {error && <p className="text-danger text-xs mt-3">{error}</p>}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Button variant="outline" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
          VOLVER
        </Button>
        <Button variant="primary" onClick={handlePagar}
          disabled={paying || esPagado || jornadas.length === 0}>
          {esPagado ? 'YA PAGADO' : paying ? 'PAGANDO…' : 'CONFIRMAR PAGO'}
        </Button>
      </div>
    </Card>
  )
}
