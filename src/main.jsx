import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import App from './App.jsx'
import './index.css'

/* ─── Purga de versión (2026-08-02) ─────────────────────────
 * `__BUILD_ID__` (inyectado por vite.config.js, único por build) se
 * compara contra el guardado en localStorage del dispositivo. Si no
 * coincide y ya había uno guardado (no es la primera visita), hay una
 * actualización nueva: se borra el service worker viejo y TODA la Cache
 * Storage antes de seguir, y se recarga una sola vez para que el
 * navegador pida todo de cero. Así cada actualización se autolimpia
 * sola, sin que el usuario tenga que borrar datos a mano.
 */
async function purgarSiHayActualizacion() {
  const CLAVE = 'estajos_build_id'
  const anterior = localStorage.getItem(CLAVE)
  if (anterior === __BUILD_ID__) return false

  if (anterior) {
    try {
      const registros = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
      await Promise.all(registros.map((r) => r.unregister()))
      const nombres = 'caches' in window ? await caches.keys() : []
      await Promise.all(nombres.map((n) => caches.delete(n)))
    } catch (err) {
      console.error('[cache] No se pudo limpiar la caché de la versión anterior:', err)
    }
  }

  localStorage.setItem(CLAVE, __BUILD_ID__)
  return !!anterior   // true = había una versión previa, hay que recargar
}

async function iniciar() {
  const necesitaRecargar = await purgarSiHayActualizacion()
  if (necesitaRecargar) {
    window.location.reload()
    return   // no montar nada — la recarga va a volver a ejecutar este archivo
  }

  /* ─── Registro del Service Worker (PWA) ─────────────────── */
  registerSW({
    onOfflineReady() {
      console.info('[PWA] App lista para usar sin conexión')
    },
    onRegisterError(err) {
      console.error('[PWA] Error al registrar SW:', err)
    }
  })

  /* ─── Render ────────────────────────────────────────────── */
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
}

iniciar()
