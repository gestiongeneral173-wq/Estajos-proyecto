import { useState } from 'react'
import { Truck, Siren } from 'lucide-react'

import Modal  from '../ui/Modal.jsx'
import Input  from '../ui/Input.jsx'
import Button from '../ui/Button.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { activarBotonPanico } from '../../lib/api/panico.js'

/**
 * Header — Cabecera fija oscura, idéntica en todas las páginas.
 *
 *  ┌────────────────────────────────────────────────┐
 *  │ [🚚] CONTROL TOTAL              [botón‑right]  │  bg-navy-dark
 *  └────────────────────────────────────────────────┘
 *
 * Props
 * ─────
 *  · rightLabel  string   Texto del botón derecho (ej. 'CENTRAL', 'Salir')
 *  · rightIcon   ?Node    Icono opcional dentro del botón
 *  · onRightClick ?fn     Callback al pulsar el botón derecho
 *  · variant     'default' | 'active'
 *                  - 'default' → fondo navy-medium + texto gris
 *                  - 'active'  → fondo verde + texto blanco (botón seleccionado)
 *
 * Spec de la guía  (sección 3):
 *   <header className="bg-[#1a2332] px-4 py-3 flex items-center justify-between">
 */
export default function Header({
  rightLabel     = null,
  rightIcon      = null,
  onRightClick   = () => {},
  variant        = 'default',
  mostrarPanico  = true
}) {
  const rol = useAuthStore((s) => s.rol)
  const clear = useAuthStore((s) => s.clear)

  const [modalAbierto, setModalAbierto] = useState(false)
  const [password, setPassword]         = useState('')
  const [enviando, setEnviando]         = useState(false)
  const [error, setError]               = useState(null)

  const btnClass =
    variant === 'active'
      ? 'bg-primary text-white'
      : 'bg-navy-medium text-gray-300'

  const cerrarModal = () => {
    setModalAbierto(false); setPassword(''); setError(null)
  }

  // Bloqueo de emergencia (Séptima llamada): corta el acceso a toda la
  // base de datos (ver activarBotonPanico / migración 007). No hay forma
  // de deshacerlo desde acá a propósito — la reactivación requiere entrar
  // a Supabase directamente (ver documentación privada).
  const handleActivarPanico = async () => {
    setEnviando(true); setError(null)
    try {
      const ok = await activarBotonPanico(password)
      if (!ok) { setError('Contraseña incorrecta.'); return }
      clear()
      window.location.reload()
    } catch (err) { setError(err.message) }
    finally { setEnviando(false) }
  }

  return (
    <header
      className="bg-navy-dark px-4 pb-4 flex items-center justify-between sticky top-0 z-40"
      // Más grueso (antes py-3) para que el logo/botones no queden pegados
      // al borde superior. El padding-top suma env(safe-area-inset-top): en
      // desktop/navegador normal esa variable vale 0 (queda igual que
      // pb-4), pero en un PWA instalado en celular con notch/status bar
      // (viewport-fit=cover, ver index.html) evita que el header quede
      // debajo de la barra de notificaciones del sistema.
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2">
        <Truck className="w-6 h-6 text-gold" />
        <h1 className="text-white font-bold text-lg tracking-wide">
          ESTAJOS
        </h1>
      </div>

      {/* Bloqueo de emergencia — separado a propósito del botón derecho
          (ej. "Salir"), para que un clic apresurado sobre ese botón no
          termine activando por error el botón de pánico. */}
      {mostrarPanico && rol === 'admin' && (
        <button
          onClick={() => setModalAbierto(true)}
          title="Bloqueo de emergencia"
          className="p-1.5 rounded-full bg-danger/20 text-danger active:scale-90 transition-transform duration-160"
        >
          <Siren className="w-4 h-4" />
        </button>
      )}

      {/* Botón derecho contextual */}
      {rightLabel && (
        <button
          onClick={onRightClick}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${btnClass}`}
        >
          {rightIcon}
          {rightLabel}
        </button>
      )}

      <Modal open={modalAbierto} title="Bloqueo de emergencia" onClose={cerrarModal}>
        <p className="text-xs text-gray-500 mb-3">
          Corta el acceso a toda la base de datos desde la app. No se borra
          ningún dato. Solo se puede reactivar entrando directamente a
          Supabase — no hay vuelta atrás desde acá.
        </p>
        <Input
          type="password"
          placeholder="Contraseña de emergencia"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-2"
        />
        {error && <p className="text-danger text-xs mb-2">{error}</p>}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button variant="outline" onClick={cerrarModal}>Cancelar</Button>
          <Button
            variant="dark"
            className="!bg-danger hover:!bg-danger"
            disabled={enviando || !password}
            onClick={handleActivarPanico}
          >
            {enviando ? '…' : 'ACTIVAR'}
          </Button>
        </div>
      </Modal>
    </header>
  )
}
