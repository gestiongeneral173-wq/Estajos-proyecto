import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import Card   from '../../ui/Card.jsx'
import Input  from '../../ui/Input.jsx'
import Button from '../../ui/Button.jsx'

import { buscarRolPorTelefono } from '../../../lib/api/auth.js'
import { useAuthStore }         from '../../../store/authStore.js'
import { Direccion }            from '../../../utils/constants.js'

/**
 * FormAccesoUnificado — Cambio #8 (Sexta llamada).
 *
 * Una sola entrada por teléfono. El sistema consulta el rol en Supabase:
 *   · empleado normal → directo a su QR.
 *   · encargado       → pantalla intermedia que pide el PIN de la furgoneta.
 *
 * Reemplaza a FormLoginTrabajador + FormLoginEncargado.
 */
export default function FormAccesoUnificado() {
  const navigate = useNavigate()
  const setAuth  = useAuthStore((s) => s.setAuth)

  const [telefono, setTelefono] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  const telefonoValido = telefono.length >= 9 && telefono.length <= 15

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const u = await buscarRolPorTelefono(telefono.trim())

      if (u.es_encargado) {
        // El PIN de la furgoneta se valida en la pantalla intermedia.
        navigate(Direccion.encargadoPin, {
          state: { telefono: telefono.trim(), nombre: u.nombre, empleadoId: u.id }
        })
        return
      }

      setAuth({ rol: 'trabajador', userId: u.id, nombre: u.nombre, codigoCorto: u.codigo_corto })
      navigate(Direccion.trabajadorQr)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <Card>
      <h2 className="text-navy-dark font-bold text-sm uppercase mb-4">Ya tengo cuenta</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
          <p className="text-danger text-xs text-center font-medium">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Teléfono"
          type="tel"
          inputMode="numeric"
          placeholder="Ej: 612345678"
          maxLength={15}
          value={telefono}
          onChange={(e) => setTelefono(e.target.value.replace(/\D/g, '').slice(0, 15))}
          required
        />
        {telefono && !telefonoValido && (
          <p className="text-danger text-[11px] -mt-2">Debe tener entre 9 y 15 dígitos.</p>
        )}
        <Button type="submit" variant="primary" disabled={loading || !telefonoValido}
          icon={<ArrowRight className="w-4 h-4" />}>
          {loading ? 'CARGANDO…' : 'ENTRAR'}
        </Button>
        <p className="text-gray-400 text-xs text-center">
          El sistema te llevará a tu QR o, si eres encargado, te pedirá el PIN de la furgoneta.
        </p>
      </form>
    </Card>
  )
}
