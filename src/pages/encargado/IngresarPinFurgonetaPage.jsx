import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

import Header       from '../../components/layout/Header.jsx'
import Card         from '../../components/ui/Card.jsx'
import Button       from '../../components/ui/Button.jsx'
import PinInput     from '../../components/ui/PinInput.jsx'
import SectionTitle from '../../components/ui/SectionTitle.jsx'
import CircleIcon   from '../../components/ui/CircleIcon.jsx'

import { loginEncargado } from '../../lib/api/auth.js'
import { iniciarJornadaEncargado } from '../../lib/api/records.js'
import { useAuthStore }   from '../../store/authStore.js'
import { Direccion }      from '../../utils/constants.js'

/**
 * IngresarPinFurgonetaPage — Cambio #8 (Sexta llamada).
 *
 * Pantalla intermedia para el encargado: tras identificarse por teléfono
 * en el login unificado, aquí introduce el PIN de la furgoneta que va a
 * operar. Validado el PIN, entra al flujo de campo.
 */
export default function IngresarPinFurgonetaPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth  = useAuthStore((s) => s.setAuth)

  const telefono = location.state?.telefono
  const nombre   = location.state?.nombre

  const [pin,     setPin]     = useState('')
  const [error,   setError]   = useState(null)
  const [loading, setLoading] = useState(false)

  // Sin teléfono en el state no se puede continuar — volver al login.
  useEffect(() => {
    if (!telefono) navigate(Direccion.login, { replace: true })
  }, [telefono, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const r = await loginEncargado(telefono, pin)
      // v6.0: abre el turno (jornada de encargado + de furgoneta, en curso).
      // H-04: se reenvía el mismo PIN — el servidor lo vuelve a validar.
      // A2: se reenvía también el token_turno recién emitido por el login.
      const turno = await iniciarJornadaEncargado({ tokenTurno: r.token_turno, encargadoId: r.empleado_id, furgonetaId: r.vehiculo_id, pin })
      setAuth({
        rol:                  'encargado',
        userId:               r.empleado_id,
        nombre:               r.empleado_nombre,
        vehiculoActivoId:     r.vehiculo_id,
        vehiculoActivoNombre: r.vehiculo_nombre,
        tokenTurno:           r.token_turno
      })
      // Si el turno ya tenía plazas registradas (reingreso el mismo día),
      // no tiene caso volver a pedirlas — directo al panel.
      navigate(turno?.plazas_ocupadas > 0 ? Direccion.seccionEncargado : Direccion.encargadoPlaza)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-app-bg">
      <Header rightLabel="Salir" onRightClick={() => navigate(Direccion.login)} />

      <div className="px-4 pt-6 pb-6 max-w-md mx-auto space-y-4">
        <div className="flex flex-col items-center py-4 gap-3">
          <CircleIcon icon={ShieldCheck} size="xl" shape="square" />
          <div className="text-center">
            <h2 className="text-navy-dark font-bold text-lg">PIN de la furgoneta</h2>
            {nombre && <p className="text-gray-500 text-xs mt-1">Hola, {nombre}</p>}
          </div>
        </div>

        <Card>
          <SectionTitle color="gold">Acceso de Encargado</SectionTitle>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
              <p className="text-danger text-xs text-center font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <PinInput label="PIN del vehículo" value={pin} onChange={setPin} />
            <Button type="submit" variant="gold" disabled={pin.length !== 4 || loading}>
              {loading ? 'VALIDANDO…' : 'ENTRAR'}
            </Button>
            <p className="text-gray-400 text-xs text-center">
              El PIN del vehículo lo proporciona la Central.
            </p>
          </form>
        </Card>
      </div>
    </div>
  )
}
