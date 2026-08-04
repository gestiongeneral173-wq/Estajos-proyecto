import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Trash2, Edit2, Check, X } from 'lucide-react'

import Header        from '../../components/layout/Header.jsx'
import HorizontalNav from '../../components/layout/HorizontalNav.jsx'
import Card          from '../../components/ui/Card.jsx'
import Input         from '../../components/ui/Input.jsx'
import SectionTitle  from '../../components/ui/SectionTitle.jsx'
import Button        from '../../components/ui/Button.jsx'
import Modal         from '../../components/ui/Modal.jsx'

import { useAuthStore } from '../../store/authStore.js'
import { logout } from '../../lib/api/auth.js'
import { getJornadasDelDia, reabrirJornadaFurgonetaDia, eliminarJornadasCentralDia, actualizarJornadaTrabajador } from '../../lib/api/records.js'
import { useRealtime } from '../../hooks/useRealtime.js'

//IMPORTACIÓN IMPORTANTE:  Direccion de constants.js : Para el uso de direcciones
import { Direccion } from '../../utils/constants.js'

export default function ReporteDiarioPage() {
  const navigate = useNavigate()
  const { rol, clear } = useAuthStore()

  const hoy = () => new Date().toISOString().slice(0, 10)

  const [fecha, setFecha]       = useState(hoy)
  const [jornadas, setJornadas] = useState([])
  const [loading, setLoading]   = useState(true)

  // "Rehacer furgoneta": borra la jornada_furgoneta + jornada_empleado de
  // ese encargado/furgoneta/hoy Y TAMBIÉN la jornada_encargado del día
  // completo, para que el encargado pueda reingresar incluso si ya cerró
  // su día ("Termina mi día"). No afecta a otras furgonetas que haya
  // tocado ese mismo día, pero sí lo obliga a re-declarar sus horas del
  // día completo al volver a cerrarlo. Solo disponible para el día de
  // hoy — la RPC también lo exige del lado del servidor.
  //
  // El mismo modal también cubre "eliminar fila de Central" (esCentral):
  // ahí no hay furgoneta ni encargado que reabrir, así que es un borrado
  // directo de esas jornada_empleado — disponible para cualquier fecha,
  // ya que "Agregar Horas" permite altas retroactivas.
  const [grupoABorrar, setGrupoABorrar] = useState(null) // { encargado, vehiculo, empleados, esCentral }
  const [borrando, setBorrando]         = useState(false)
  const [borrarError, setBorrarError]   = useState(null)

  // Edición de horas/destajo por jornada — mismo mecanismo que
  // TrabajadorDetallePage (actualizarJornadaTrabajador ya exige
  // fue_liquidado=false del lado del servidor). Siempre tabla
  // 'jornada_empleado' — esta pantalla nunca lee jornada_encargado.
  const [editandoJornadaId, setEditandoJornadaId] = useState(null)
  const [jornadaEdit, setJornadaEdit]             = useState({ horas: '', destajo: '' })
  const [savingJornada, setSavingJornada]         = useState(false)
  const [jornadaError, setJornadaError]           = useState(null)

  useEffect(() => {
    //[Vinculo Global] Se usa la ruta centralizada definida en constants.js ('/central/login')
    if (rol !== 'admin') navigate( Direccion.centralLogin , { replace: true })
  }, [rol, navigate])

  const agruparJornadas = (jornadas) => {
    const grupos = {}
    jornadas.forEach(j => {
      // Las jornadas creadas por Central ("Agregar horas") nunca tienen
      // encargado ni furgoneta — misma combinación (null, null) que podría
      // darse por coincidencia si un encargado Y una furgoneta fueron dados
      // de baja el mismo día. Se distinguen con `origen` para no mezclar
      // ambos casos bajo el mismo grupo visual.
      const key = j.origen === 'central'
        ? 'central'
        : `${j.encargado?.id || 'sin-encargado'}-${j.vehiculo?.id || 'sin-vehiculo'}`
      if (!grupos[key]) {
        grupos[key] = j.origen === 'central'
          ? {
              encargado: { id: null, nombre: 'Registrado por Central' },
              vehiculo: null,
              empleados: [],
              esCentral: true,
            }
          : {
              encargado: j.encargado ?? { id: null, nombre: 'Encargado despedido' },
              vehiculo: j.vehiculo ?? { id: null, nombre: 'Vehículo dado de baja' },
              empleados: [],
              esCentral: false,
            }
      }
      grupos[key].empleados.push({
        id: j.id, empleado: j.empleado, horas: j.horas, destajo: j.destajo,
        fue_liquidado: j.fue_liquidado,
      })
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

  // Realtime: recargar ante cualquier cambio (alta, edición de horas/
  // destajo, o el borrado del "rehacer furgoneta") — antes solo escuchaba
  // INSERT, así que una edición hecha desde otra pestaña no se reflejaba.
  const onRT = useCallback(() => cargar(), [cargar])
  useRealtime('jornada_empleado', onRT, { event: '*' })

  //[Vinculo Global] Se usa la ruta centralizada definida en constants.js  (Direccion.login = '/login')
  const handleSalir = async () => { await logout(); clear(); navigate( Direccion.login ) }

  // Misma validación que TrabajadorDetallePage.jsx (horas/destajo >= 0) —
  // replicada tal cual, incluido que no bloquea horas=0 y destajo=0 a la
  // vez (eso lo rechaza el CHECK de la base, con su mensaje sin traducir).
  const handleGuardarJornada = async (jornadaId) => {
    const horas   = parseFloat(jornadaEdit.horas)
    const destajo = parseFloat(jornadaEdit.destajo)
    if (Number.isNaN(horas) || horas < 0 || Number.isNaN(destajo) || destajo < 0) {
      setJornadaError('Horas y destajo deben ser números válidos (≥ 0).')
      return
    }
    setSavingJornada(true); setJornadaError(null)
    try {
      await actualizarJornadaTrabajador(jornadaId, { horas, destajo, tabla: 'jornada_empleado' })
      setEditandoJornadaId(null)
      await cargar()
    } catch (err) {
      setJornadaError(err.message)
    } finally {
      setSavingJornada(false)
    }
  }

  const handleConfirmarBorrado = async () => {
    if (!grupoABorrar) return
    setBorrando(true); setBorrarError(null)
    try {
      if (grupoABorrar.esCentral) {
        await eliminarJornadasCentralDia(fecha)
      } else {
        await reabrirJornadaFurgonetaDia({
          encargadoId: grupoABorrar.encargado.id,
          furgonetaId: grupoABorrar.vehiculo.id,
          fecha,
        })
      }
      setGrupoABorrar(null)
      await cargar()
    } catch (err) {
      setBorrarError(err.message)
    } finally {
      setBorrando(false)
    }
  }

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
          {jornadaError && (
            <Card><p className="text-danger text-xs text-center">{jornadaError}</p></Card>
          )}
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
                <div className="bg-navy-dark p-3 text-white flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">Encargado: {grupo.encargado?.nombre ?? '—'}</p>
                    <p className="text-xs text-gray-300">Vehículo: {grupo.vehiculo?.nombre ?? '—'}</p>
                  </div>
                  {/* Furgonetas: solo si el encargado y el vehículo siguen
                      activos (no dados de baja) y la fecha vista es hoy —
                      mismo requisito que valida la RPC del lado del
                      servidor. Central: cualquier fecha, ya que "Agregar
                      Horas" permite altas retroactivas y esta es la única
                      forma de corregir una fila mal creada en el pasado. */}
                  {(grupo.esCentral || (grupo.encargado?.id && grupo.vehiculo?.id && fecha === hoy())) && (
                    <button
                      onClick={() => { setBorrarError(null); setGrupoABorrar(grupo) }}
                      className="text-gray-300 hover:text-danger active:scale-90 transition-transform duration-160 shrink-0"
                      title={grupo.esCentral ? 'Eliminar registros de Central de este día' : 'Rehacer registro de esta furgoneta'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  {/* Columnas fijas y alineadas: Empleado | Horas | Destajo | Acción.
                      Mismo template en el encabezado y en cada fila, para que
                      horas/destajo/lápiz siempre caigan en la misma línea vertical. */}
                  <div className="grid grid-cols-[1fr_3rem_4rem_2rem] gap-3 items-center pb-1 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase">
                    <span>Empleados</span>
                    <span className="text-right">Horas</span>
                    <span className="text-right border-l border-gray-300 pl-2">Destajo</span>
                    <span />
                  </div>
                  {grupo.empleados.map((emp) => {
                    const editing = editandoJornadaId === emp.id
                    return (
                      <div key={emp.id} className="grid grid-cols-[1fr_3rem_4rem_2rem] gap-3 items-center border-b border-gray-100 py-1.5 text-sm">
                        <span className="min-w-0">
                          <span className={`truncate block ${emp.fue_liquidado ? 'text-gray-400' : 'text-navy-dark'}`}>
                            {emp.empleado?.nombre ?? '—'}
                          </span>
                          {emp.fue_liquidado && (
                            <span className="text-[9px] font-semibold text-primary uppercase block">
                              Pagado
                            </span>
                          )}
                          
                        </span>

                        {editing ? (
                          <input
                            type="number" autoFocus value={jornadaEdit.horas}
                            onChange={(e) => setJornadaEdit({ ...jornadaEdit, horas: e.target.value })}
                            className="w-full px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs text-center"
                          />
                        ) : (
                          <span className={`text-right text-xs ${emp.fue_liquidado ? 'text-gray-400' : 'text-gray-600'}`}>{emp.horas ?? 0}h</span>
                        )}

                        {editing ? (
                          <input
                            type="number" value={jornadaEdit.destajo}
                            onChange={(e) => setJornadaEdit({ ...jornadaEdit, destajo: e.target.value })}
                            className="w-full px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs text-center"
                          />
                        ) : (
                          <span className={`text-right text-xs border-l border-gray-300 pl-2 ${emp.fue_liquidado ? 'text-gray-400' : 'text-gray-600'}`}>€{emp.destajo ?? 0}</span>
                        )}

                        {emp.fue_liquidado ? (
                          <span className="flex justify-end text-primary" title="Jornada ya liquidada">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        ) : editing ? (
                          <div className="flex items-center justify-end -mr-1.5">
                            <button disabled={savingJornada} onClick={() => handleGuardarJornada(emp.id)} className="p-1.5 text-primary active:scale-90 transition-transform duration-160">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => { setEditandoJornadaId(null); setJornadaError(null) }} className="p-1.5 text-gray-400 active:scale-90 transition-transform duration-160">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditandoJornadaId(emp.id)
                              setJornadaEdit({ horas: String(emp.horas ?? 0), destajo: String(emp.destajo ?? 0) })
                              setJornadaError(null)
                            }}
                            className="flex justify-end p-1.5 -mr-1.5 text-gray-300 hover:text-navy-dark active:scale-90 transition-transform duration-160"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Confirmar "rehacer" una furgoneta (borra jornada_empleado +
          jornada_furgoneta de hoy, sin tocar temporales) o "eliminar fila
          de Central" (borrado directo de jornada_empleado origen='central'
          de la fecha vista, cualquier día). ── */}
      <Modal
        open={!!grupoABorrar}
        title={grupoABorrar?.esCentral ? 'Eliminar registros de Central' : 'Rehacer registro de furgoneta'}
        onClose={() => { if (!borrando) setGrupoABorrar(null) }}
      >
        {grupoABorrar && (
          <>
            {grupoABorrar.esCentral ? (
              <p className="text-sm text-navy-dark mb-2">
                Se eliminarán <strong>{grupoABorrar.empleados.length}</strong> registro(s)
                creados desde Central ("Agregar Horas") para el{' '}
                <strong>{fecha}</strong>.
              </p>
            ) : (
              <p className="text-sm text-navy-dark mb-2">
                Se eliminarán <strong>{grupoABorrar.empleados.length}</strong> registro(s) de
                empleado y el registro de la furgoneta{' '}
                <strong>{grupoABorrar.vehiculo?.nombre ?? '—'}</strong> para{' '}
                <strong>{grupoABorrar.encargado?.nombre ?? '—'}</strong> hoy.
              </p>
            )}
            <p className="text-xs text-gray-500 mb-4">
              {grupoABorrar.esCentral ? (
                <>Se rechaza si alguno de estos registros ya fue liquidado (pagado). Esta acción no se puede deshacer.</>
              ) : (
                <>
                  El encargado podrá volver a entrar con el PIN de esta furgoneta y rehacer el
                  registro desde cero. <strong>También se reinicia su jornada del día completo</strong> —
                  si ya tiene horas/destajo propios registrados hoy, tendrá que volver a declararlos.
                  Esta acción no se puede deshacer.
                </>
              )}
            </p>
            {borrarError && <p className="text-danger text-xs mb-3">{borrarError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setGrupoABorrar(null)} disabled={borrando}>
                CANCELAR
              </Button>
              <Button
                variant="outline"
                className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                onClick={handleConfirmarBorrado}
                disabled={borrando}
              >
                {borrando ? 'ELIMINANDO…' : 'ELIMINAR'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
