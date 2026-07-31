import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'

const DISMISS_KEY = 'pwa-install-dismissed'

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

/**
 * InstallPWABanner — Aviso propio de instalación (no depende del ícono
 * discreto del navegador). Chrome/Edge/Android: captura `beforeinstallprompt`
 * y dispara el diálogo nativo al tocar "Instalar". iOS Safari no expone ese
 * evento, así que ahí se muestra la instrucción manual (Compartir → Agregar
 * a inicio). Se oculta solo si ya está instalada o si el usuario la cerró.
 */
export default function InstallPWABanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [iosHint, setIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  useEffect(() => {
    if (isStandalone() || dismissed) return

    function onBeforeInstallPrompt(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    function onAppInstalled() {
      localStorage.setItem(DISMISS_KEY, '1')
      setDismissed(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    if (isIos()) setIosHint(true)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [dismissed])

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    if (outcome === 'accepted') handleDismiss()
  }

  if (dismissed || isStandalone()) return null

  const mode = deferredPrompt ? 'android' : iosHint ? 'ios' : null
  if (!mode) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md bg-navy-dark text-white rounded-xl shadow-lg p-4 flex items-center gap-3 animate-fade-in">
      <div className="w-10 h-10 rounded-full bg-gold flex items-center justify-center shrink-0">
        {mode === 'ios'
          ? <Share className="w-5 h-5 text-navy-dark" />
          : <Download className="w-5 h-5 text-navy-dark" />}
      </div>

      <div className="flex-1 text-sm">
        {mode === 'ios'
          ? <p>Instala Estajos: toca <strong>Compartir</strong> y luego <strong>"Agregar a inicio"</strong>.</p>
          : <p>Instala Estajos en tu dispositivo para acceso rápido y uso sin conexión.</p>}
      </div>

      {mode === 'android' && (
        <button
          onClick={handleInstall}
          className="bg-gold text-navy-dark text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap active:scale-97 transition-transform duration-160"
        >
          Instalar
        </button>
      )}

      <button onClick={handleDismiss} className="text-white/70 hover:text-white shrink-0" aria-label="Cerrar aviso de instalación">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
