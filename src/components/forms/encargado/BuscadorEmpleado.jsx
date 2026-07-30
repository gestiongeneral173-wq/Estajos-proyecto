import { useState, useMemo } from 'react'
import { Search, Check } from 'lucide-react'

import Input from '../../ui/Input.jsx'

/**
 * BuscadorEmpleado — Cambio #4 (Sexta llamada).
 *
 * Reemplaza al escáner QR del encargado. Filtra en tiempo real la lista de
 * empleados activos. Todos son siempre seleccionables — la corrección
 * retroactiva (2026-07-29) exige poder volver a un empleado ya registrado
 * para completar un campo que sigue en 0. Solo cambia la etiqueta de estado.
 *
 * @param {Array}    empleados - [{ id, nombre, telefono, registrado, completo }]
 * @param {Function} onSelect  - recibe el empleado seleccionado
 * @param {boolean}  loading
 */
export default function BuscadorEmpleado({ empleados = [], onSelect, loading = false }) {
  const [q, setQ] = useState('')

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return empleados
    return empleados.filter((e) => e.nombre?.toLowerCase().includes(t))
  }, [q, empleados])

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          placeholder="Buscar empleado por nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-xs text-center py-4">Cargando empleados…</p>
      ) : filtrados.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-4">Sin coincidencias.</p>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {filtrados.map((e) => {
            // Tres estados: sin ningún campo (Pendiente), con uno de los dos
            // en 0 (Incompleto — se puede completar), o ambos con valor
            // (Completo — solo lectura). Siempre seleccionable.
            const estado = e.completo ? 'Completo' : e.registrado ? 'Incompleto' : 'Pendiente'
            // Las completas se ven visualmente distintas (tinte verde,
            // texto atenuado) para que no se confundan con las que sí
            // admiten edición — evita que el encargado piense que está
            // por modificar una jornada que en realidad es de solo lectura.
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelect(e)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors active:scale-97 ${
                  e.completo ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-primary/10'
                }`}
              >
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${e.completo ? 'text-gray-400' : 'text-navy-dark'}`}>
                    {e.nombre}
                  </p>
                  <p className={`text-[10px] ${e.completo ? 'text-primary font-semibold' : 'text-gray-400'}`}>
                    {estado}
                  </p>
                </div>
                {e.completo && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
