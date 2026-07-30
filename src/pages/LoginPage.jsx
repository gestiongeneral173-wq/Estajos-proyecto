import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import Header               from '../components/layout/Header.jsx'
import FormAccesoUnificado  from '../components/forms/login/FormAccesoUnificado.jsx'
import FormRegistroConPin   from '../components/forms/login/FormRegistroConPin.jsx'

import { useAuthStore } from '../store/authStore.js'

//IMPORTACIÓN IMPORTANTE:  Direccion de constants.js : Para el uso de direcciones
import { Direccion } from '../utils/constants.js'

/**
 * LoginPage — Pantalla de acceso unificada (Cambio #8, Sexta llamada).
 *
 * Una sola pantalla para todos:
 *   · Acceso: teléfono → el sistema decide (trabajador → QR, encargado → PIN).
 *   · Registro nuevo: PIN de autorización → alta del trabajador.
 *
 * El antiguo selector Trabajador/Encargado desaparece: el rol se detecta solo.
 */
export default function LoginPage() {
  const navigate = useNavigate()
  const rol   = useAuthStore((s) => s.rol)
  const clear = useAuthStore((s) => s.clear)

  // Esta pantalla es pública (acceso de trabajadores + registro con PIN).
  // Si queda un rol 'admin' persistido de una sesión de central que se
  // cerró sin pulsar "Salir" (cerrar la app, recargar, etc.), el Header
  // seguía mostrando el botón de bloqueo de emergencia acá, donde no
  // corresponde. Se limpia al entrar a esta pantalla.
  useEffect(() => {
    if (rol === 'admin') clear()
  }, [rol, clear])

  return (
    <div className="min-h-screen bg-app-bg">
      {/*[Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login') */ }
      <Header rightLabel="CENTRAL" onRightClick={() => navigate(Direccion.centralLogin)} />

      <div className="px-4 pt-6 pb-6 space-y-4 max-w-md mx-auto">
        <FormAccesoUnificado />
        <FormRegistroConPin />
      </div>
    </div>
  )
}
