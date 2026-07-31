import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

//IMPORTACIÓN IMPORTANTE:  Direccion de constants.js : Para el uso de direcciones
import { Direccion } from './utils/constants.js'
import { supabase } from './lib/supabase.js'
import EmergencyScreen from './components/domain/EmergencyScreen.jsx'
import InstallPWABanner from './components/domain/InstallPWABanner.jsx'

import LoginPage         from './pages/LoginPage.jsx'
import TrabajadorQRPage  from './pages/empleado/TrabajadorQRPage.jsx'

import IngresarPinFurgonetaPage  from './pages/encargado/IngresarPinFurgonetaPage.jsx'
import IngresarPlazaFurgonetaPage from './pages/encargado/IngresarPlazaFurgonetaPage.jsx'
import SeccionEncargadoPage from './pages/encargado/SeccionEncargadoPage.jsx'
import TrabajadorDetallePage from './pages/central/TrabajadorDetallePage.jsx'

import CentralLoginPage  from './pages/central/CentralLoginPage.jsx'
import EscanearPage      from './pages/central/EscanearPage.jsx'
import ReporteDiarioPage from './pages/central/ReporteDiarioPage.jsx'
import ResumenPage       from './pages/central/ResumenPage.jsx'
import TrabajadoresPage  from './pages/central/TrabajadoresPage.jsx'
import VehiculosPage     from './pages/central/VehiculosPage.jsx'
import VehiculoDetallePage from './pages/central/VehiculoDetallePage.jsx'
import ConfiguracionPage  from './pages/central/ConfiguracionPage.jsx'



/**
 * App — Enrutado raíz.
 *
 * El orden en este archivo no define qué pantalla va primero en la experiencia del usuario;
 * eso se controla mediante programación (funciones 'navigate') dentro de cada página. 
 * Sin embargo, por seguridad y arquitectura, las rutas están agrupadas por roles.
 */
export default function App() {
  // Bloqueo de emergencia (Séptima llamada): una sola query liviana para
  // detectar si el botón de pánico está activo (REVOKE USAGE ON SCHEMA
  // public → error 42501 en cualquier consulta). Si es así, se muestra
  // solo el logo en vez de la app — ver activarBotonPanico().
  const [bloqueado, setBloqueado] = useState(false)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    supabase.from('empleados').select('id').limit(1).then(({ error }) => {
      setBloqueado(error?.code === '42501' || !!error?.message?.includes('permission denied'))
      setListo(true)
    })
  }, [])

  if (!listo) return null
  if (bloqueado) return <EmergencyScreen />

  return (
    <>
    <Routes>
      {/* Redirección raíz usando tu variable */}
      <Route path="/" element={<Navigate to={Direccion.login} replace />} />

      {/* Flujo de Login */}
      <Route path={Direccion.login}        element={<LoginPage />} />
      <Route path={Direccion.centralLogin} element={<CentralLoginPage />} />

      {/* Flujo de Trabajador */}
      <Route path={Direccion.trabajadorQr} element={<TrabajadorQRPage />} />

      {/* Flujo de Encargado (Corregido <Route> con mayúscula) */}
      <Route path={Direccion.encargadoPin}        element={<IngresarPinFurgonetaPage />} />
      <Route path={Direccion.encargadoPlaza}      element={<IngresarPlazaFurgonetaPage />} />
      <Route path={Direccion.seccionEncargado} element={<SeccionEncargadoPage />} />
      
      {/* Flujo de Central */}
      <Route path="/central" element={<Navigate to={Direccion.centralEscanear} replace />} />
      
      <Route path={Direccion.centralEscanear}     element={<EscanearPage />} />
      <Route path={Direccion.centralReporte}      element={<ReporteDiarioPage />} />
      <Route path={Direccion.CentralResumen}      element={<ResumenPage />} /> {/* Se queda fija temporalmente */}
      <Route path={Direccion.CentralTrabajadores} element={<TrabajadoresPage />} />
      <Route path={Direccion.CentralVehiculos}    element={<VehiculosPage />} />
      <Route path={Direccion.CentralVehiculosID}  element={<VehiculoDetallePage />} />
      <Route path={Direccion.CentralTrabajadoresID} element={<TrabajadorDetallePage />} />
      <Route path={Direccion.CentralConfiguracion} element={<ConfiguracionPage />} />

      {/* Comodín de seguridad en caso de enlaces rotos */}
      <Route path="*" element={<Navigate to={Direccion.login} replace />} />
    </Routes>
    <InstallPWABanner />
    </>
  )
}