import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // ID único de esta build (fijado una sola vez, al arrancar `vite build` o
  // `vite dev` — no en cada request). `main.jsx` lo compara contra el que
  // quedó guardado en localStorage del dispositivo: si no coincide, es una
  // actualización nueva y borra el service worker + toda la Cache Storage
  // antes de montar la app — así ningún usuario se queda pegado a una
  // versión vieja sin darse cuenta, cada actualización se autolimpia sola.
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'Estajos',
        short_name: 'Estajos',
        description: 'Gestión integral de personal y vehículos',
        theme_color: '#1a2332',
        background_color: '#f5f6fa',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 3000,
    host: true
  }
})
