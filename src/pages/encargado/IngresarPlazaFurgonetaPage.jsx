import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Truck, Users, Search, Check } from 'lucide-react'

import Header       from '../../components/layout/Header.jsx'
import Card         from '../../components/ui/Card.jsx'
import Button       from '../../components/ui/Button.jsx'
import Input        from '../../components/ui/Input.jsx'
import SectionTitle from '../../components/ui/SectionTitle.jsx'
import CircleIcon   from '../../components/ui/CircleIcon.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { Direccion } from '../../utils/constants.js'
import { asignarPlazasYChofer, listarEmpleadosParaChofer } from '../../lib/api/choferes.js'

export default function IngresarPinFurgonetaPage() {
  const navigate = useNavigate()

  // FIX 1: Leer el vehículo activo del authStore para mostrarlo como confirmación
  const { userId, vehiculoActivoId, vehiculoActivoNombre, nombre: nombreEncargado, tokenTurno } = useAuthStore()

  const [plazas, setPlazas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Selector de chofer — cualquier empleado, puede ser el propio encargado.
  // Se registra en la MISMA pantalla que las plazas (2 acciones, no 2
  // páginas): el cliente pidió explícitamente no agregar una pantalla extra.
  const [empleados, setEmpleados]     = useState([])
  const [cargandoEmp, setCargandoEmp] = useState(true)
  const [q, setQ]                     = useState('')
  const [choferId, setChoferId]       = useState(null)

  useEffect(() => {
    listarEmpleadosParaChofer(tokenTurno)
      .then(setEmpleados)
      .catch((err) => setError(err.message))
      .finally(() => setCargandoEmp(false))
  }, [tokenTurno])

  const empleadosFiltrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return empleados
    return empleados.filter((e) => e.nombre?.toLowerCase().includes(t))
  }, [q, empleados])

  const plazasValidas = parseInt(plazas) > 0
  const listoParaConfirmar = plazasValidas && !!choferId

  const handleConfirmar = async () => {
    if (!listoParaConfirmar) return
    setError(null); setGuardando(true)
    try {
      await asignarPlazasYChofer({
        tokenTurno,
        vehiculoId: vehiculoActivoId,
        plazas: parseInt(plazas, 10),
        empleadoChoferId: choferId,
      })
      // [Vinculo Global] Se usa la ruta centralizada definida en constants.js
      navigate(Direccion.seccionEncargado)
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  const handleCancelar = () => {
    // [Vinculo Global] Se usa la ruta centralizada definida en constants.js
    navigate(Direccion.login)
  }

  return (
    <div className="min-h-screen bg-app-bg">
      <Header />

      <div className="px-4 pt-6 pb-6 max-w-md mx-auto space-y-4">

        {/* FIX 1: Banner de confirmación del vehículo activo —
            Aparece igual que en SeccionEncargadoPage para confirmar
            al encargado qué furgoneta está usando antes de continuar. */}
        {vehiculoActivoNombre && (
          <div className="p-4 bg-gradient-to-r from-navy-dark to-navy-medium rounded-xl">
            <p className="text-xs text-gray-400">Vehículo activo</p>
            <p className="text-lg font-bold text-white">{vehiculoActivoNombre}</p>
            <p className="mt-1 text-xs text-gold">Encargado: {nombreEncargado}</p>
          </div>
        )}

        {/* Encabezado visual */}
        <div className="flex flex-col items-center py-4 gap-3">
          <CircleIcon icon={Truck} size="xl" shape="square" />
          <div className="text-center">
            <h2 className="text-navy-dark font-bold text-lg">Plazas de la Furgoneta</h2>
            <p className="text-gray-500 text-xs mt-1">
              Indica cuántas personas viajan hoy
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 border border-red-200 bg-red-50 rounded-xl">
            <p className="text-xs font-medium text-center text-danger">{error}</p>
          </div>
        )}

        {/* Sección Plazas */}
        <Card>
          <SectionTitle color="green">Plazas Ocupadas</SectionTitle>
          <div className="flex items-start gap-3 mb-4">
            <CircleIcon icon={Users} size="md" />
            {/* Cambio 2.1 (Séptima llamada): texto directo y formal */}
            <p className="text-gray-500 text-xs leading-relaxed pt-2">
              Ingrese la cantidad de pasajeros
            </p>
          </div>
          <Input
            label="Número de pasajeros"
            type="number"
            placeholder="0"
            value={plazas}
            onChange={(e) => setPlazas(e.target.value)}
          />
        </Card>

        {/* Sección Chofer — el chofer cuenta como una de las plazas de arriba */}
        <Card>
          <SectionTitle color="gold">Chofer del día</SectionTitle>
          <p className="text-gray-500 text-xs leading-relaxed mb-3">
            Elige quién maneja hoy — puede ser cualquier empleado, incluido tú mismo. Cuenta como una plaza.
          </p>

          <div className="relative mb-3">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              placeholder="Buscar empleado por nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>

          {cargandoEmp ? (
            <p className="text-gray-400 text-xs text-center py-4">Cargando empleados…</p>
          ) : empleadosFiltrados.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-4">Sin coincidencias.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {empleadosFiltrados.map((e) => {
                const seleccionado = choferId === e.id
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setChoferId(e.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors active:scale-97 ${
                      seleccionado ? 'bg-gold/10' : 'bg-gray-50 hover:bg-primary/10'
                    }`}
                  >
                    <p className={`text-sm font-semibold truncate ${seleccionado ? 'text-navy-dark' : 'text-navy-dark'}`}>
                      {e.nombre}{e.id === userId ? ' (tú)' : ''}
                    </p>
                    {seleccionado && <Check className="w-4 h-4 text-gold flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        {/* Acciones */}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={handleCancelar} disabled={guardando}>
            CANCELAR
          </Button>
          <Button
            variant="primary"
            disabled={!listoParaConfirmar || guardando}
            onClick={handleConfirmar}
          >
            {guardando ? 'GUARDANDO…' : 'CONFIRMAR'}
          </Button>
        </div>

      </div>
    </div>
  )
}
