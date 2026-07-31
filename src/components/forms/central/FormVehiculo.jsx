import Input  from '../../ui/Input.jsx'
import Button from '../../ui/Button.jsx'

/**
 * Props:
 *  - values: objeto con los campos
 *  - onChange: (campo) => (e) => void
 *  - onSubmit: () => void
 *  - saving: bool
 *  - error: string | null
 *  - periodoPendiente: 'quincenal' | 'mensual' | null   (solo modo editar;
 *      cambio de periodicidad ya guardado que se aplicará en el próximo
 *      pago exitoso de esta furgoneta — ver promoverTipoPagoPendienteVehiculo)
 */
export default function FormVehiculo({
  values,
  onChange,
  onSubmit,
  saving,
  error,
  periodoPendiente,
}) {
  const tarifaValida = parseFloat(values.tarifa_plaza) > 0
  const plazasValidas = values.plazas_totales !== '' && parseInt(values.plazas_totales, 10) >= 0
  const canSubmit = values.nombre?.trim() && values.matricula?.trim() && tarifaValida && plazasValidas

  return (
    <div className="space-y-4">
      {error && <p className="text-danger text-xs">{error}</p>}

      <Input
        label="Nombre"
        value={values.nombre}
        onChange={onChange('nombre')}
      />
      <Input
        label="Matrícula"
        value={values.matricula}
        onChange={onChange('matricula')}
      />
      <Input
        label="Plazas totales"
        type="number"
        min="0"
        step="1"
        value={values.plazas_totales}
        onChange={onChange('plazas_totales')}
      />
      {values.plazas_totales !== '' && !plazasValidas && (
        <p className="text-danger text-[10px] -mt-2">Las plazas totales no pueden ser negativas.</p>
      )}
      <Input
        label="Tarifa por plaza (€) *"
        type="number"
        min="0.01"
        step="0.01"
        value={values.tarifa_plaza}
        onChange={onChange('tarifa_plaza')}
      />
      {values.tarifa_plaza !== '' && !tarifaValida && (
        <p className="text-danger text-[10px] -mt-2">La tarifa por plaza debe ser mayor a 0.</p>
      )}
      <div>
        <label className="label-base">Tipo de Pago</label>
        <select
          value={values.tipo_pago}
          onChange={onChange('tipo_pago')}
          className="input-base"
        >
          <option value="quincenal">Quincenal</option>
          <option value="mensual">Mensual</option>
        </select>
        {periodoPendiente && periodoPendiente !== values.tipo_pago && (
          <p className="text-[11px] text-amber-600 mt-1">
            Cambiará a {periodoPendiente === 'mensual' ? 'Mensual' : 'Quincenal'} en su próximo pago.
          </p>
        )}
      </div>
      <Input
        label="Propietario"
        value={values.propietario}
        onChange={onChange('propietario')}
      />

      <Button
        variant="primary"
        onClick={onSubmit}
        disabled={saving || !canSubmit}
      >
        {saving ? 'GUARDANDO…' : 'GUARDAR'}
      </Button>
    </div>
  )
}