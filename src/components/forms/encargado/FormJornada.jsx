import { useState } from 'react'
import Button from '../../ui/Button.jsx'
import Input  from '../../ui/Input.jsx'

/**
 * FormJornada — Formulario de registro de horas, destajo, plazas y fecha.
 * Maneja su propio estado interno y entrega un objeto { horas, destajo, plazas, fecha }
 * al onSubmit de la página.
 *
 * Usado tanto para trabajadores escaneados como para el auto-registro
 * del encargado (modo 'self').
 *
 * FIX (Cambios 2 y 3 — Quinta Reunión 09/06/2026):
 *   El selector de fecha vive aquí, en la pantalla individual de cada
 *   registro (tras escanear / antes de guardar), en vez de aplicarse
 *   globalmente antes de escanear. Así cada persona registrada puede
 *   tener su propia fecha sin afectar a las demás. Por defecto es hoy
 *   y no permite seleccionar fechas futuras.
 *
 * @param {boolean}  guardando        - Estado de carga
 * @param {Function} onSubmit         - Recibe { horas, destajo, plazas, fecha }
 * @param {Function} onCancel         - Handler del cancelar
 * @param {string}   submitLabel      - Texto del botón submit
 * @param {?{horas:number, destajo:number}} valoresIniciales
 *   Modo corrección (2026-07-29): si viene, precarga horas/destajo y
 *   bloquea el campo que ya tenga valor > 0 — corregir_jornada_empleado /
 *   corregir_jornada_encargado solo rellenan el campo que sigue en 0, así
 *   que no tiene sentido dejar editable el que ya está lleno.
 */
export default function FormJornada({
  guardando,
  onSubmit,
  onCancel,
  submitLabel = 'REGISTRAR',
  hideFecha = false,
  valoresIniciales = null,
}) {
  const hoy = new Date().toISOString().slice(0, 10)

  const horasBloqueadas  = valoresIniciales != null && Number(valoresIniciales.horas)   > 0
  const destajoBloqueado = valoresIniciales != null && Number(valoresIniciales.destajo) > 0

  const [horas,   setHoras]   = useState(valoresIniciales ? String(valoresIniciales.horas   ?? '') : '')
  const [destajo, setDestajo] = useState(valoresIniciales ? String(valoresIniciales.destajo ?? '') : '')
  const [fecha,   setFecha]   = useState(hoy)

  const handleSubmit = (e) => {
    e.preventDefault()
    // Cuando la fecha la fija el calendario superior (encargado), no se envía aquí.
    onSubmit(hideFecha ? { horas, destajo } : { horas, destajo, fecha })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!hideFecha && (
        <Input
          label="Fecha del registro"
          type="date"
          max={hoy}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
      )}
      <Input
        label="Horas trabajadas"
        type="number"
        placeholder="8"
        value={horas}
        disabled={horasBloqueadas}
        onChange={(e) => setHoras(e.target.value)}
      />
      <Input
        label="Destajo (€)"
        type="number"
        placeholder="0"
        value={destajo}
        disabled={destajoBloqueado}
        onChange={(e) => setDestajo(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" type="button" onClick={onCancel}>
          CANCELAR
        </Button>
        <Button type="submit" variant="primary" disabled={guardando || (!horas && !destajo)}>
          {guardando ? 'GUARDANDO…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}