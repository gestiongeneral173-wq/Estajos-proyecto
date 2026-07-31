import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ArrowRight } from 'lucide-react'

import Card   from '../../ui/Card.jsx'
import Input  from '../../ui/Input.jsx'
import Button from '../../ui/Button.jsx'

import { validarPinRegistro, registrarTrabajadorConPin } from '../../../lib/api/auth.js'
import { useAuthStore } from '../../../store/authStore.js'
import { Direccion }    from '../../../utils/constants.js'

/**
 * FormRegistroConPin — Cambios #7 y #8 (Sexta llamada).
 *
 * Solo los empleados autorizados por la Central pueden registrarse:
 *   1. Introducen el PIN de registro que les dio el administrador.
 *   2. Si es válido (y quedan cupos), se abre el formulario nombre+teléfono.
 *   3. Al registrarse se consume 1 cupo del PIN.
 */
export default function FormRegistroConPin() {
  const navigate = useNavigate()
  const setAuth  = useAuthStore((s) => s.setAuth)

  const NOMBRE_RE   = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*(?:\s[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*)*$/

  const [pin,       setPin]      = useState('')
  const [validado,  setValidado] = useState(false)
  const [cupo,      setCupo]     = useState(null)
  const [nombre,    setNombre]   = useState('')
  const [apellido,  setApellido] = useState('')
  const [telefono,  setTelefono] = useState('')
  const [error,     setError]    = useState(null)
  const [loading,   setLoading]  = useState(false)

  const nombreValido   = NOMBRE_RE.test(nombre.trim())   && nombre.trim().length >= 4
  const apellidoValido = NOMBRE_RE.test(apellido.trim()) && apellido.trim().length >= 4
  const telefonoValido = telefono.length >= 9 && telefono.length <= 15

  const handleValidar = async (e) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const r = await validarPinRegistro(pin.trim())
      if (!r.valido) { setError(r.mensaje); return }
      setCupo(r.cupo_restante)
      setValidado(true)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  const handleCancelar = () => {
    setPin(''); setValidado(false); setCupo(null)
    setNombre(''); setApellido(''); setTelefono(''); setError(null)
  }

  const handleRegistrar = async (e) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const t = await registrarTrabajadorConPin({
        pin: pin.trim(), nombre: `${nombre.trim()} ${apellido.trim()}`, telefono: telefono.trim()
      })
      setAuth({ rol: 'trabajador', userId: t.id, nombre: t.nombre, codigoCorto: t.codigo_corto })
      navigate(Direccion.trabajadorQr)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <Card>
      <h2 className="text-navy-dark font-bold text-sm uppercase mb-4">Registro nuevo</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
          <p className="text-danger text-xs text-center font-medium">{error}</p>
        </div>
      )}

      {!validado ? (
        <form onSubmit={handleValidar} className="space-y-4">
          <Input
            label="PIN de registro"
            type="text"
            inputMode="numeric"
            placeholder="6 dígitos"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Button type="submit" variant="dark" disabled={loading || pin.length !== 6}
            icon={<KeyRound className="w-4 h-4" />}>
            {loading ? 'VALIDANDO…' : 'VALIDAR PIN'}
          </Button>
          <p className="text-gray-400 text-xs text-center">
            La Central te proporciona este PIN para darte de alta.
          </p>
        </form>
      ) : (
        <form onSubmit={handleRegistrar} className="space-y-4">
          {cupo != null && (
            <p className="text-primary text-xs text-center font-medium">
              PIN válido · {cupo} {cupo === 1 ? 'cupo disponible' : 'cupos disponibles'}
            </p>
          )}
          <Input
            label="Nombre"
            placeholder="Ej: Juan"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
          />
          {nombre && !nombreValido && (
            <p className="text-danger text-[11px] -mt-2">Solo letras, mínimo 4.</p>
          )}
          <Input
            label="Apellido"
            placeholder="Ej: Pérez"
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            required
          />
          {apellido && !apellidoValido && (
            <p className="text-danger text-[11px] -mt-2">Solo letras, mínimo 4.</p>
          )}
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
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" onClick={handleCancelar} disabled={loading}>
              CANCELAR
            </Button>
            <Button type="submit" variant="primary"
              disabled={loading || !nombreValido || !apellidoValido || !telefonoValido}
              icon={<ArrowRight className="w-4 h-4" />}>
              {loading ? 'CARGANDO…' : 'REGISTRARME'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
