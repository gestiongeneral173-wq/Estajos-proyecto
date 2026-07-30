import { useState } from 'react'
import Input   from '../../ui/Input.jsx'
import Button  from '../../ui/Button.jsx'

const NOMBRE_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*(?:\s[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*)*$/

/**
 * Props:
 *  - modo: 'crear' | 'editar'
 *  - values: objeto con los campos del form
 *  - onChange: (campo) => (e) => void
 *  - onSubmit: () => void
 *  - saving: bool
 *  - error: string | null
 *  - onCancel: () => void   (solo se usa en modo editar)
 */
export default function FormTrabajador({
  modo = 'crear',
  values,
  onChange,
  onSubmit,
  saving,
  error,
  onCancel,
}) {
  // Nombre y apellido se piden por separado (para que no se pueda saltar o
  // meter cualquier cosa en un solo campo libre) pero se juntan en
  // `values.nombre`, que es lo único que conoce el resto del sistema.
  const [nombre,   setNombre]   = useState('')
  const [apellido, setApellido] = useState('')
  const nombreValido   = NOMBRE_RE.test(nombre.trim())   && nombre.trim().length >= 4
  const apellidoValido = NOMBRE_RE.test(apellido.trim()) && apellido.trim().length >= 4
  const telefonoValido = values.telefono?.length === 10
  const tarifaValida   = parseFloat(values.tarifa_hora) > 0

  const actualizarNombreCompleto = (n, a) => {
    onChange('nombre')({ target: { value: `${n.trim()} ${a.trim()}` } })
  }

  const canSubmit = modo === 'crear'
    ? nombreValido && apellidoValido && telefonoValido && tarifaValida
    : telefonoValido && tarifaValida

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-danger text-xs text-center">{error}</p>
        </div>
      )}

      {modo === 'crear' && (
        <>
          <Input
            label="Nombre"
            placeholder="Ej: Juan"
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); actualizarNombreCompleto(e.target.value, apellido) }}
          />
          {nombre && !nombreValido && (
            <p className="text-danger text-[11px] -mt-2">Solo letras, mínimo 4.</p>
          )}
          <Input
            label="Apellido"
            placeholder="Ej: Pérez"
            value={apellido}
            onChange={(e) => { setApellido(e.target.value); actualizarNombreCompleto(nombre, e.target.value) }}
          />
          {apellido && !apellidoValido && (
            <p className="text-danger text-[11px] -mt-2">Solo letras, mínimo 4.</p>
          )}
        </>
      )}

      <Input
        label="Teléfono"
        type="tel"
        inputMode="numeric"
        placeholder="Ej: 612345678"
        maxLength={10}
        value={values.telefono}
        onChange={(e) => onChange('telefono')({ target: { value: e.target.value.replace(/\D/g, '').slice(0, 10) } })}
      />
      {values.telefono && !telefonoValido && (
        <p className="text-danger text-[11px]">Debe tener 10 dígitos.</p>
      )}

      <div>
        <label className="label-base">Periodicidad</label>
        <select
          value={values.payment_period}
          onChange={onChange('payment_period')}
          className="input-base"
        >
          <option value="mensual">Mensual</option>
          <option value="quincenal">Quincenal</option>
        </select>
      </div>

      <Input
        label="Tarifa por hora (€)"
        type="number"
        min="0.01"
        step="0.01"
        value={values.tarifa_hora}
        onChange={onChange('tarifa_hora')}
      />
      {values.tarifa_hora !== '' && !tarifaValida && (
        <p className="text-danger text-[11px] -mt-2">La tarifa por hora debe ser mayor a 0.</p>
      )}

      {/* Cambio 1.3.1.2 / 1.3.5 (Octava llamada): campo "Tarifa destajo"
          eliminado por completo, tanto al añadir como al editar un
          trabajador. El destajo no se calcula con una tarifa fija: su
          monto depende exclusivamente del volumen de trabajo de cada día
          (varía jornada a jornada), por lo que no corresponde a la
          configuración inicial del trabajador. El monto real del destajo
          se sigue registrando por jornada individual (ver Cambio 1.3.7). */}

      {modo === 'editar' ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={onCancel}>
            CANCELAR
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={saving || !canSubmit}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR'}
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={saving || !canSubmit}
        >
          {saving ? 'GUARDANDO…' : 'GUARDAR'}
        </Button>
      )}
    </div>
  )
}
