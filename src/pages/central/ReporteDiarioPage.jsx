import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Input         from '../../components/ui/Input.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout } from '../../lib/api/auth.js'
import { getJornadasDelDia } from '../../lib/api/records.js'
import { useRealtime } from '../../hooks/useRealtime.js'

//IMPORTACIÓN IMPORTANTE:  Direccion de constants.js : Para el uso de direcciones
import { Direccion } from '../../utils/constants.js'

export default function ReporteDiarioPage() {
  const navigate = useNavigate()
  const { rol, clear } = useAuthStore()

  const [fecha, setFecha]       = useState(() => new Date().toISOString().slice(0, 10))
  const [jornadas, setJornadas] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    //[Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login')
    if (rol !== 'admin') navigate( Direccion.centralLogin , { replace: true })
  }, [rol, navigate])

  const agruparJornadas = (jornadas) => {
    const grupos = {}
    jornadas.forEach(j => {
      const key = `${j.encargado_id || 'sin-encargado'}-${j.vehiculo_id || 'sin-vehiculo'}`
      if (!grupos[key]) {
        grupos[key] = {
          encargado: j.encargado ?? { id: null, nombre: 'Encargado despedido' },
          vehiculo: j.vehiculo ?? { id: null, nombre: 'Vehículo dado de baja' },
          empleados: []
        }
      }
      grupos[key].empleados.push(j.empleado)
    })
    return Object.values(grupos)
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    try { setJornadas(await getJornadasDelDia(fecha)) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [fecha])

  useEffect(() => { cargar() }, [cargar])

  // Realtime: recargar al entrar una jornada nueva
  const onRT = useCallback(() => cargar(), [cargar])
  useRealtime('jornada_empleado', onRT, { event: 'INSERT' })

  //[Vinculo Global] Se usa la ruta centralizada definida en constants.js  (Direccion.login = '/login')
  const handleSalir = async () => { await logout(); clear(); navigate( Direccion.login ) }

  return (
    <div className="min-h-screen bg-app-bg">
      <Header rightLabel="Salir" rightIcon={<LogOut className="w-3 h-3" />} onRightClick={handleSalir} />
      <HorizontalNav />

      <div className="px-4 pt-4 pb-6 max-w-md mx-auto space-y-4">
        <Card>
          <SectionTitle color="gold">Reporte Diario</SectionTitle>
          <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Card>

        <div className="space-y-3">
          {loading ? (
            <Card>
              <p className="text-gray-400 text-xs text-center py-8">Cargando…</p>
            </Card>
          ) : jornadas.length === 0 ? (
            <Card>
              <SectionTitle color="green">Jornadas registradas</SectionTitle>
              <p className="text-gray-400 text-xs text-center py-8">Sin datos para esta fecha.</p>
            </Card>
          ) : (
            agruparJornadas(jornadas).map((grupo, index) => (
              <div key={index} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-navy-dark p-3 text-white">
                  <p className="font-semibold text-sm">Encargado: {grupo.encargado?.nombre ?? '—'}</p>
                  <p className="text-xs text-gray-300">Vehículo: {grupo.vehiculo?.nombre ?? '—'}</p>
                </div>
                <div className="p-3 space-y-2">
                  {grupo.empleados.map((emp, idx) => (
                    <div key={idx} className="flex justify-between items-center border-b border-gray-100 pb-1 text-sm">
                      <span className="text-navy-dark">{emp?.nombre ?? '—'}</span>
                      <div className="flex gap-6 text-gray-600 text-xs">
                        <span>{jornadas.find(j => j.empleado?.id === emp?.id)?.horas ?? 0}h</span>
                        <span>€{jornadas.find(j => j.empleado?.id === emp?.id)?.destajo ?? 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
