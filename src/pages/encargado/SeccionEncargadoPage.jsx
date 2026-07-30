import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Check, UserCircle, Clock, UserPlus, Calendar, Search, ChevronDown, ChevronUp, Users, Lock } from 'lucide-react'

import Header          from '../../components/layout/Header.jsx'
import Card            from '../../components/ui/Card.jsx'
import Button          from '../../components/ui/Button.jsx'
import Input           from '../../components/ui/Input.jsx'
import CircleIcon      from '../../components/ui/CircleIcon.jsx'
import SectionTitle    from '../../components/ui/SectionTitle.jsx'
import FormJornada     from '../../components/forms/encargado/FormJornada.jsx'
import FormTemporal    from '../../components/forms/encargado/FormTemporal.jsx'
import BuscadorEmpleado from '../../components/forms/encargado/BuscadorEmpleado.jsx'

import { useAuthStore } from '../../store/authStore.js'
import {
  registrarJornadaEmpleado, cerrarJornadaEncargado, registrarTemporal,
  buscarEmpleadosEncargado, estadoJornadaPropiaEncargado,
  corregirJornadaEmpleado, corregirJornadaEncargado,
  buscarJornadasFurgonetaDia, buscarTemporalesFurgonetaDia,
} from '../../lib/api/records.js'

import { Direccion } from '../../utils/constants.js'

/**
 * SeccionEncargadoPage — Flujo de campo del encargado.
 *
 * CAMBIOS SEXTA LLAMADA (20/06/2026):
 *   #4 El escáner QR se reemplaza por un buscador de empleados por nombre.
 *      Solo 1 registro por empleado por día; los completos salen opacos.
 *   #5 El calendario se mueve al inicio: primero se elige la fecha, luego
 *      el empleado. La verificación de registro depende de empleado + fecha.
 *   #6 Las horas propias del encargado cierran su jornada solo si la fecha
 *      registrada es HOY; registrar una fecha pasada no cierra la sesión.
 *
 * Corrección retroactiva (2026-07-29): al elegir fecha + persona (empleado
 * o el propio encargado), si ya existe jornada ese día se decide entre tres
 * modos según el diseño (Explicacion_del_diseño, Jornada_Empleado /
 * Jornada_Encargado): sin jornada → crear (como ya funcionaba); con un
 * campo en 0 → corregir (solo completa lo que falta, vía
 * corregir_jornada_empleado/_encargado); con ambos campos llenos → solo
 * lectura. Completar un día PASADO ya cerrado nunca cierra la sesión — eso
 * sigue siendo exclusivo de cerrar_jornada_encargado con la fecha de HOY.
 *
 * Dos calendarios independientes (cambio posterior): el buscador de
 * empleados y "Mis horas" antes compartían una sola fecha — cambiar de día
 * para completar tu propio turno también recargaba (y podía confundir) el
 * buscador del equipo, y viceversa. Ahora cada uno tiene su propia fecha,
 * ambas con default en hoy.
 */

/* ─── Sección plegable (mismo patrón que TrabajadorDetallePage/VehiculoDetallePage) ─── */
function Collapsible({ title, color = 'green', children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <SectionTitle color={color} className="mb-0">{title}</SectionTitle>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  )
}

export default function SeccionEncargadoPage() {
  const navigate = useNavigate()
  const { userId, nombre, vehiculoActivoId, vehiculoActivoNombre, rol, clear, tokenTurno } = useAuthStore()

  const hoy = new Date().toISOString().slice(0, 10)

  // Calendario del buscador de empleados (equipo del día) — independiente
  // del de "Mis horas".
  const [fechaBuscador, setFechaBuscador] = useState(hoy)
  const [empleados,  setEmpleados]  = useState([])
  const [cargando,   setCargando]   = useState(false)
  // 'idle' | 'form' | 'corregir' | 'ver' | 'self' | 'self-corregir' | 'self-ver' | 'temporal'
  const [modo,       setModo]       = useState('idle')
  const [trabajador, setTrabajador] = useState(null)
  const [error,      setError]      = useState(null)
  const [exito,      setExito]      = useState(false)
  const [guardando,  setGuardando]  = useState(false)
  const [totalPagado, setTotalPagado] = useState(null)
  // Cambio 2.3 (Séptima llamada): panel de personas registradas.
  // `buscar_empleados_encargado` devuelve el flag `registrado` GLOBAL (de
  // cualquier furgoneta), que se usa para poner en gris a los ya
  // registrados en el buscador. Pero el panel de abajo debe mostrar solo
  // lo registrado por ESTE encargado/furgoneta — se lleva aparte una lista
  // local de {id, fecha} de esta sesión (igual que ya se hacía con los
  // temporales).
  const [registradosSesion, setRegistradosSesion] = useState([])
  const [temporalesSesion, setTemporalesSesion] = useState([])
  const [listaAbierta,     setListaAbierta]     = useState(true)
  // Calendario propio de "Mis horas" — separado del buscador.
  const [fechaMisHoras, setFechaMisHoras] = useState(hoy)
  // Reemplaza al booleano selfRegistrado — ahora trae la jornada completa
  // (o vacía) para decidir entre crear / corregir / ver.
  const [estadoPropio, setEstadoPropio] = useState({
    registrado: false, completo: false, jornada_id: null, horas_trabajadas: null, pago_destajo: null,
  })

  // Buscador de empleados — depende solo de fechaBuscador.
  const cargarEmpleados = useCallback(async (f) => {
    setCargando(true); setError(null)
    try {
      setEmpleados(await buscarEmpleadosEncargado(tokenTurno, f))
    } catch (err) {
      setError(err.message)
    } finally { setCargando(false) }
  }, [tokenTurno])

  useEffect(() => { cargarEmpleados(fechaBuscador) }, [fechaBuscador, cargarEmpleados])

  // "Mis horas" — depende solo de fechaMisHoras, sin recargar el buscador.
  const cargarEstadoPropio = useCallback(async (f) => {
    try {
      setEstadoPropio(await estadoJornadaPropiaEncargado(tokenTurno, userId, f))
    } catch (err) {
      setError(err.message)
    }
  }, [tokenTurno, userId])

  useEffect(() => { cargarEstadoPropio(fechaMisHoras) }, [fechaMisHoras, cargarEstadoPropio])

  // Repuebla "Registrados" (empleados normales) desde el servidor al entrar
  // o al cambiar de fecha en el buscador — antes vivía solo en memoria y se
  // perdía al salir y volver a entrar (la sesión del encargado nunca
  // persiste entre recargas, por diseño de authStore). Se fusiona con lo
  // que ya haya en memoria en vez de reemplazarlo, para no perder un alta
  // recién hecha en esta misma sesión mientras la respuesta va y viene.
  useEffect(() => {
    if (!tokenTurno) return
    buscarJornadasFurgonetaDia(tokenTurno, fechaBuscador)
      .then((rows) => {
        setRegistradosSesion((prev) => {
          const yaTiene = new Set(prev.filter((r) => r.fecha === fechaBuscador).map((r) => r.id))
          const nuevos = rows
            .filter((r) => !yaTiene.has(r.empleado_id))
            .map((r) => ({ id: r.empleado_id, fecha: fechaBuscador }))
          return nuevos.length ? [...prev, ...nuevos] : prev
        })
      })
      .catch(() => { /* no bloquear la pantalla si falla; el panel solo no se repuebla */ })
  }, [tokenTurno, fechaBuscador])

  // Repuebla los temporales de HOY registrados por esta furgoneta. Solo
  // depende de tokenTurno (una vez por sesión) — temporalesSesion nunca
  // dependió de fechaBuscador, solo se muestra cuando fechaBuscador === hoy.
  useEffect(() => {
    if (!tokenTurno) return
    buscarTemporalesFurgonetaDia(tokenTurno)
      .then((rows) => setTemporalesSesion(rows.map((r) => ({ nombre: r.nombre_completo }))))
      .catch(() => {})
  }, [tokenTurno])

  // Guard de acceso (tras declarar todos los hooks)
  if (!userId || rol !== 'encargado') {
    setTimeout(() => navigate(Direccion.login, { replace: true }), 0)
    return null
  }

  // Cambio 2.3: lista de personas registradas por ESTA furgoneta en la
  // fecha activa (no todas las registradas por otros encargados).
  const idsRegistradosSesion = new Set(
    registradosSesion.filter((r) => r.fecha === fechaBuscador).map((r) => r.id)
  )
  const registradosFecha = empleados.filter((e) => e.registrado && idsRegistradosSesion.has(e.id))
  const totalRegistrados = registradosFecha.length + (fechaBuscador === hoy ? temporalesSesion.length : 0)

  // Corrección retroactiva — estado de "Mis horas" para la fecha elegida:
  //  'crear'    → sin jornada hoy, turno abierto esperando el primer cierre
  //  'na'       → sin jornada en un día PASADO — nunca se trabajó ese día
  //  'corregir' → jornada cerrada con un campo todavía en 0
  //  'ver'      → jornada cerrada y completa, solo lectura
  const estadoSelf = !estadoPropio.registrado
    ? (fechaMisHoras === hoy ? 'crear' : 'na')
    : (estadoPropio.completo ? 'ver' : 'corregir')

  const mostrarExito = () => {
    setExito(true)
    setTimeout(() => setExito(false), 1500)
  }

  const handleSeleccionar = (emp) => {
    setError(null)
    setTrabajador(emp)
    setModo(emp.completo ? 'ver' : emp.registrado ? 'corregir' : 'form')
  }

  const handleSeleccionarSelf = () => {
    setError(null)
    setModo(estadoSelf === 'crear' ? 'self' : estadoSelf === 'corregir' ? 'self-corregir' : 'self-ver')
  }

  const handleGuardarJornada = async (formData) => {
    setError(null); setGuardando(true)
    const esSelf = modo === 'self' || modo === 'self-corregir'
    const empleadoId = esSelf ? userId : trabajador?.id
    const horas   = parseFloat(formData.horas)   || 0
    const destajo = parseFloat(formData.destajo) || 0
    try {
      if (modo === 'self') {
        // Primer cierre del turno de HOY — sin cambios, siempre "ahora".
        await cerrarJornadaEncargado({ tokenTurno, encargadoId: userId, horas, destajo })
      } else if (modo === 'self-corregir') {
        // Corrección de un día PASADO ya cerrado — pura, no cierra sesión.
        await corregirJornadaEncargado({ tokenTurno, jornadaId: estadoPropio.jornada_id, encargadoId: userId, horas, destajo })
      } else if (modo === 'corregir') {
        // Completa el campo en 0 de la jornada del empleado seleccionado.
        await corregirJornadaEmpleado({ tokenTurno, jornadaId: trabajador.jornada_id, encargadoId: userId, horas, destajo })
      } else {
        // v6.0: el empleado normal usa registrar_jornada_empleado con la
        // fecha elegida en el calendario (permite registrar un día pasado
        // con su fecha real, no la de hoy).
        await registrarJornadaEmpleado({ tokenTurno, empleadoId, encargadoId: userId, horas, destajo, fecha: fechaBuscador })
      }
      if (!esSelf) {
        setRegistradosSesion((prev) => [...prev, { id: empleadoId, fecha: fechaBuscador }])
      }
      mostrarExito()

      // Cada calendario recarga solo su propia data — completar tu turno
      // no debe refrescar (ni parpadear) el buscador del equipo, y viceversa.
      if (esSelf) {
        await cargarEstadoPropio(fechaMisHoras)
      } else {
        await cargarEmpleados(fechaBuscador)
      }

      // #6: registrar las horas propias cierra la jornada SOLO si es el
      // primer cierre de HOY (modo 'self'). Completar un día pasado ya
      // cerrado (modo 'self-corregir') nunca cierra la sesión.
      if (modo === 'self' && fechaMisHoras === hoy) {
        setTimeout(() => {
          clear()
          navigate(Direccion.login, { replace: true })
        }, 1500)
        return
      }
      setTimeout(() => { setTrabajador(null); setModo('idle') }, 1500)
    } catch (err) {
      setError(err.message)
    } finally { setGuardando(false) }
  }

  const handleGuardarTemporal = async (formData) => {
    setError(null); setGuardando(true)
    try {
      // v6.0: el temporal solo se registra (se paga en efectivo aparte).
      await registrarTemporal({
        tokenTurno,
        nombre:  formData.nombre,
        horas:   formData.horas,
        destajo: formData.destajo,
      })
      setTotalPagado(formData.destajo)
      // Cambio 2.3: los temporales no vienen del servidor; se agregan a la
      // lista local para que aparezcan en el panel de registrados.
      setTemporalesSesion((prev) => [...prev, { nombre: formData.nombre, hora: new Date() }])
      mostrarExito()
      setTimeout(() => {
        setExito(false); setTotalPagado(null); setModo('idle')
      }, 2000)
    } catch (err) {
      setError(err.message)
    } finally { setGuardando(false) }
  }

  return (
    <div className="min-h-screen bg-app-bg">
      <Header
        rightLabel="Salir"
        rightIcon={<LogOut className="w-3 h-3" />}
        onRightClick={() => { clear(); navigate(Direccion.login) }}
      />

      <div className="max-w-md px-4 pt-4 pb-6 mx-auto space-y-4">

        {/* Vehículo activo */}
        <div className="p-4 bg-gradient-to-r from-navy-dark to-navy-medium rounded-xl">
          <p className="text-xs text-gray-400">Vehículo activo</p>
          <p className="text-lg font-bold text-white">{vehiculoActivoNombre || '—'}</p>
          <p className="mt-1 text-xs text-gold">Encargado: {nombre}</p>
        </div>

        {/* Aviso privacidad */}
        <div className="p-3 bg-gray-50 rounded-xl">
          <p className="text-xs text-center text-gray-400">
            El salario acumulado no se muestra al encargado.
          </p>
        </div>

        {error && (
          <div className="p-3 border border-red-200 bg-red-50 rounded-xl">
            <p className="text-xs font-medium text-center text-danger">{error}</p>
          </div>
        )}

        {/* Banner de éxito */}
        {exito && (
          <div className="flex flex-col items-center gap-1 p-4 border border-green-200 bg-green-50 rounded-xl">
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-primary" />
              <p className="text-sm font-semibold text-primary">
                {totalPagado != null
                  ? `Pagado €${Number(totalPagado).toFixed(2)}`
                  : 'Jornada registrada'}
              </p>
            </div>
          </div>
        )}

        {/* ── Búsqueda de jornada — calendario + buscador, plegable ──
            Plegado por default para que la pantalla no abrume: el
            encargado la abre solo cuando necesita buscar a alguien de su
            equipo. Calendario propio (fechaBuscador), independiente del de
            "Mis horas". */}
        <Collapsible title="Búsqueda de jornada" color="green" defaultOpen={false}>
          {/* Criterio 1: fecha de trabajo */}
          <div className="flex items-center gap-3">
            <CircleIcon icon={Calendar} size="md" />
            <div className="flex-1">
              <Input
                label="Fecha de trabajo"
                type="date"
                max={hoy}
                value={fechaBuscador}
                onChange={(e) => { setFechaBuscador(e.target.value); setModo('idle'); setTrabajador(null) }}
              />
            </div>
          </div>

          {/* Criterio 2: buscador de empleado (mismo bloque, bajo la fecha) */}
          {modo === 'idle' && !exito && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-3.5 h-3.5 text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-400 uppercase">
                  Buscar empleado en esta fecha
                </p>
              </div>
              <BuscadorEmpleado
                empleados={empleados}
                loading={cargando}
                onSelect={handleSeleccionar}
              />
            </div>
          )}
        </Collapsible>

        {/* ── Cambio 2.3 (Séptima llamada): panel desplegable con la lista de
            personas ya registradas en la jornada activa. Crece dinámicamente
            y evita duplicados u omisiones, sin datos económicos. ── */}
        <Card>
          <button
            type="button"
            onClick={() => setListaAbierta((o) => !o)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <SectionTitle color="green" className="mb-0">
                Registrados ({totalRegistrados})
              </SectionTitle>
            </div>
            {listaAbierta
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {listaAbierta && (
            <div className="mt-3">
              {totalRegistrados === 0 ? (
                <p className="text-gray-400 text-xs text-center py-3">
                  Aún no hay personas registradas en esta fecha.
                </p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {registradosFecha.map((e, i) => (
                    <div key={e.id}
                      className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold text-gray-400 w-5 flex-shrink-0">
                          {i + 1}.
                        </span>
                        <p className="text-xs font-semibold text-navy-dark truncate">
                          {e.nombre}{e.id === userId ? ' (tú)' : ''}
                        </p>
                      </div>
                      <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    </div>
                  ))}
                  {fechaBuscador === hoy && temporalesSesion.map((t, i) => (
                    <div key={`tmp-${i}`}
                      className="flex items-center justify-between px-3 py-2 bg-gold/5 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold text-gray-400 w-5 flex-shrink-0">
                          {registradosFecha.length + i + 1}.
                        </span>
                        <p className="text-xs font-semibold text-navy-dark truncate">{t.nombre}</p>
                      </div>
                      <span className="text-[9px] font-semibold text-gold uppercase flex-shrink-0">
                        Temporal
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ── IDLE: horas propias + temporal ── */}
        {modo === 'idle' && !exito && (
          <>
            <Card>
              <SectionTitle color="gold">Mis horas</SectionTitle>
              <div className="flex items-center gap-3 mb-4">
                <CircleIcon icon={UserCircle} size="md" />
                <div>
                  <p className="text-sm font-bold text-navy-dark">{nombre}</p>
                  <p className="text-gray-500 text-[10px]">Encargado</p>
                </div>
              </div>

              {/* Calendario propio de "Mis horas" — separado del buscador
                  de empleados, no afecta ni se ve afectado por él. */}
              <Input
                label="Fecha de tu turno"
                type="date"
                max={hoy}
                value={fechaMisHoras}
                onChange={(e) => {
                  setFechaMisHoras(e.target.value)
                  if (modo === 'self' || modo === 'self-corregir' || modo === 'self-ver') setModo('idle')
                }}
              />
              {fechaMisHoras !== hoy && (
                <p className="mt-2 text-[10px] text-center text-gold">
                  Viendo una fecha pasada — completar tus horas de ese día no cierra tu sesión.
                </p>
              )}

              <div className="mt-4">
                {estadoSelf === 'na' ? (
                  <p className="text-gray-400 text-xs text-center py-2">
                    No hay turno registrado en esta fecha.
                  </p>
                ) : (
                  <>
                    <Button
                      variant="dark"
                      icon={<Clock className="w-4 h-4" />}
                      onClick={handleSeleccionarSelf}
                    >
                      {estadoSelf === 'crear' ? 'REGISTRAR MIS HORAS'
                        : estadoSelf === 'corregir' ? 'COMPLETAR MIS HORAS'
                        : 'VER MIS HORAS'}
                    </Button>
                    {estadoSelf === 'ver' && (
                      <p className="mt-2 text-[10px] text-center text-gray-400">
                        Tus horas de esta fecha ya fueron registradas.
                      </p>
                    )}
                  </>
                )}
              </div>
            </Card>

            <Card>
              <Button
                variant="primary"
                icon={<UserPlus className="w-4 h-4" />}
                onClick={() => { setError(null); setModo('temporal') }}
              >
                Agregar temporal
              </Button>
            </Card>
          </>
        )}

        {/* ── FORM (empleado seleccionado, crear) ── */}
        {modo === 'form' && trabajador && !exito && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserCircle} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">{trabajador.nombre}</p>
                <p className="text-gray-500 text-[10px]">{trabajador.telefono}</p>
              </div>
            </div>
            {fechaBuscador !== hoy && (
              <p className="text-[10px] text-gold mb-3">
                Esta jornada no tiene un campo registrado — completa solo lo que falta en esta fecha pasada.
              </p>
            )}
            <FormJornada
              guardando={guardando}
              hideFecha
              onSubmit={handleGuardarJornada}
              onCancel={() => { setTrabajador(null); setModo('idle'); setError(null) }}
            />
          </Card>
        )}

        {/* ── CORREGIR (empleado con un campo en 0) ── */}
        {modo === 'corregir' && trabajador && !exito && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserCircle} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">{trabajador.nombre}</p>
                <p className="text-gray-500 text-[10px]">{trabajador.telefono}</p>
              </div>
            </div>
            <p className="text-[10px] text-gold mb-3">
              Esta jornada ya tiene un campo registrado — completa solo lo que falta.
            </p>
            <FormJornada
              guardando={guardando}
              hideFecha
              valoresIniciales={{ horas: trabajador.horas_trabajadas, destajo: trabajador.pago_destajo }}
              onSubmit={handleGuardarJornada}
              onCancel={() => { setTrabajador(null); setModo('idle'); setError(null) }}
              submitLabel="COMPLETAR"
            />
          </Card>
        )}

        {/* ── VER (empleado con ambos campos ya llenos, solo lectura) ──
            Tarjeta con tinte verde + etiqueta "solo lectura", para que se
            note a simple vista que aquí no hay nada que modificar. */}
        {modo === 'ver' && trabajador && !exito && (
          <Card className="!bg-green-50">
            <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1 bg-white/70 rounded-full w-fit">
              <Lock className="w-3 h-3 text-primary" />
              <span className="text-[9px] font-semibold text-primary uppercase">Solo lectura — jornada completa</span>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserCircle} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">{trabajador.nombre}</p>
                <p className="text-gray-500 text-[10px]">{trabajador.telefono}</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <p className="text-sm text-navy-dark">
                Horas trabajadas: <strong>{trabajador.horas_trabajadas}</strong>
              </p>
              <p className="text-sm text-navy-dark">
                Destajo: <strong>€{Number(trabajador.pago_destajo).toFixed(2)}</strong>
              </p>
            </div>
            <Button variant="outline" onClick={() => { setTrabajador(null); setModo('idle') }}>
              VOLVER
            </Button>
          </Card>
        )}

        {/* ── SELF (autoregistro encargado, primer cierre de HOY) ── */}
        {modo === 'self' && !exito && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserCircle} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">{nombre}</p>
                <p className="text-[10px] text-gold font-semibold uppercase">Encargado</p>
              </div>
            </div>
            <FormJornada
              guardando={guardando}
              hideFecha
              onSubmit={handleGuardarJornada}
              onCancel={() => { setModo('idle'); setError(null) }}
              submitLabel="REGISTRAR MIS HORAS"
            />
          </Card>
        )}

        {/* ── SELF-CORREGIR (día pasado ya cerrado, un campo en 0) ── */}
        {modo === 'self-corregir' && !exito && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserCircle} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">{nombre}</p>
                <p className="text-[10px] text-gold font-semibold uppercase">Encargado</p>
              </div>
            </div>
            <p className="text-[10px] text-gold mb-3">
              Esta jornada ya está cerrada — completa solo lo que falta. No cierra tu sesión.
            </p>
            <FormJornada
              guardando={guardando}
              hideFecha
              valoresIniciales={{ horas: estadoPropio.horas_trabajadas, destajo: estadoPropio.pago_destajo }}
              onSubmit={handleGuardarJornada}
              onCancel={() => { setModo('idle'); setError(null) }}
              submitLabel="COMPLETAR"
            />
          </Card>
        )}

        {/* ── SELF-VER (día pasado, ambos campos ya llenos) ── */}
        {modo === 'self-ver' && !exito && (
          <Card className="!bg-green-50">
            <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1 bg-white/70 rounded-full w-fit">
              <Lock className="w-3 h-3 text-primary" />
              <span className="text-[9px] font-semibold text-primary uppercase">Solo lectura — jornada completa</span>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserCircle} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">{nombre}</p>
                <p className="text-[10px] text-gold font-semibold uppercase">Encargado</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <p className="text-sm text-navy-dark">
                Horas trabajadas: <strong>{estadoPropio.horas_trabajadas}</strong>
              </p>
              <p className="text-sm text-navy-dark">
                Destajo: <strong>€{Number(estadoPropio.pago_destajo).toFixed(2)}</strong>
              </p>
            </div>
            <Button variant="outline" onClick={() => setModo('idle')}>
              VOLVER
            </Button>
          </Card>
        )}

        {/* ── TEMPORAL (alta + pago inmediato) ── */}
        {modo === 'temporal' && !exito && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <CircleIcon icon={UserPlus} size="md" />
              <div>
                <p className="text-sm font-bold text-navy-dark">Nuevo temporal</p>
                <p className="text-[10px] text-gold font-semibold uppercase">Pago inmediato</p>
              </div>
            </div>
            <FormTemporal
              guardando={guardando}
              onSubmit={handleGuardarTemporal}
              onCancel={() => { setModo('idle'); setError(null) }}
            />
          </Card>
        )}

      </div>
    </div>
  )
}
