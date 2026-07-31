# Auditoría de Caja Blanca — Sistema Completo de Estajos (DECIMA)

Fecha: 2026-07-30. Extiende `AUDITORIA-PAGOS-DECIMA.md` (2026-07-29, enfocada solo en el módulo
de pagos) a **todo el árbol `src/`**: capa de datos (`lib/`), páginas (`pages/`), componentes
(`components/`), store, hooks y utils. No repite los hallazgos ya documentados ahí salvo donde se
indique explícitamente "hallazgo nuevo" o "agrava lo ya conocido".

**Nota de contexto**: el código cambió entre ambas auditorías (Fase A2, cerrada hoy mismo,
2026-07-30): se introdujo `tokenTurno` como requisito casi universal para escrituras de campo, y
`eliminarTrabajador`/`eliminarVehiculo` dejaron de ser `DELETE` físico simple — ahora son
`darDeBajaTrabajador`/`darDeBajaVehiculo`, un flujo de dos fases (cálculo de solo lectura +
RPC transaccional). Esto **no invalida** el hallazgo crítico #1 de la auditoría anterior, pero
cambia su superficie de riesgo — ver detalle en la sección de `vehicles.js`/`workers.js`.

**Método**: cada archivo real de `src/` se leyó completo (no solo grep). Los hallazgos se anclan a
`archivo:línea`, describen el mecanismo exacto de la falla y el escenario concreto que la dispara.

---

## PARTE A — Resumen ejecutivo de riesgos (todo el sistema, ordenado por severidad)

| # | Hallazgo | Dónde | Severidad |
|---|---|---|---|
| 1 | "Dar de baja" — verificar en Postgres si `pago_empleado`/`adelanto_empleado`/`jornada_empleado` tienen `ON DELETE CASCADE`/`RESTRICT` correctos ahora que el flujo pasa por `dar_de_baja_*` (2 fases) | `workers.js`/`vehicles.js` | 🔴 Crítico (heredado, superficie cambiada — repetir verificación) |
| 2 | `eliminarAdelantoEmpleado` **no** bloquea borrar un adelanto ya liquidado (`fue_liquidado`) — rompe el rastro de auditoría de un pago histórico real. Contraparte para vehículos (`eliminarAdelantoVehiculo`) sí lo bloquea | `records.js:195-198` | 🔴 Crítico |
| 3 | `generarListaPago`: si el INSERT de `lista_pago_detalle` falla tras el de `lista_pago_quincenal`, el dinero ya se movió (loop de pagos ya corrió) pero el desglose por empleado se pierde para siempre | `paymentLists.js:133-154` | 🔴 Crítico |
| 4 | En `ResumenPage`, si el refresco posterior a un `generarListaPago` exitoso falla (p.ej. `cargarCiclo`), el admin ve un error, cree que el pago falló, y puede reintentarlo — generando un **segundo pago real** a gente ya pagada | `ResumenPage.jsx:196-221` | 🔴 Crítico |
| 5 | Guard global del botón de pánico en `App.jsx`: sin `.catch()`, deja la app en pantalla blanca para siempre si la petición rechaza (no solo si responde con error); y solo corre una vez al montar — una sesión ya abierta nunca ve `EmergencyScreen` tras una activación real | `App.jsx:44-51` | 🔴 Crítico |
| 6 | Fuga de cámara (`getUserMedia`) si se cancela el escaneo QR exactamente mientras `scanner.start()` está en vuelo — la cámara queda encendida indefinidamente | `EscanearPage.jsx:139-169` | 🔴 Alto |
| 7 | `VehiculoDetallePage`/`TrabajadorDetallePage`: el formulario de edición se resetea con datos del servidor por eventos Realtime **mientras el admin está escribiendo**, borrando el texto sin aviso (más fácil de disparar en Vehículo, porque `jornada_furgoneta` cambia todo el día) | `VehiculoDetallePage.jsx:119-175`, `TrabajadorDetallePage.jsx:152-172` | 🔴 Alto |
| 8 | `CircleIcon` crashea (`TypeError`) si `size` recibe cualquier valor no soportado — sin fallback, a diferencia de `Badge` | `CircleIcon.jsx:33` | 🔴 Alto |
| 9 | `WorkerListItem` crashea si `worker` llega `undefined`/`null` — sin valor por defecto en la destructuración | `WorkerListItem.jsx:24` | 🔴 Alto |
| 10 | `formatFecha` desplaza un día las fechas en zonas horarias de offset negativo (parseo UTC de `YYYY-MM-DD` + `toLocaleDateString` sin `timeZone`) — afecta fechas de nómina en toda la app | `formatters.js:35-43` | 🟠 Alto |
| 11 | `FormTemporal`: validación OR asimétrica deja pasar un `destajo` u `horas` **negativo** si el otro campo es positivo | `FormTemporal.jsx:17,23-24` | 🟠 Alto |
| 12 | `FormAdelanto`: sin `min`, sin validación de signo — se puede registrar un adelanto **negativo**, que en el cálculo de pago **suma** en vez de restar | `FormAdelanto.jsx:36,57` | 🟠 Alto |
| 13 | `IngresarPlazaFurgonetaPage` es la única pantalla protegida de todo el sistema **sin ningún guard de ruta** — accesible sin sesión de encargado válida | `IngresarPlazaFurgonetaPage.jsx` (completo) | 🟠 Alto |
| 14 | Cola offline (`offline.js`) construida pero no conectada a ninguna función de escritura — agravado porque ahora casi toda escritura exige `tokenTurno`, que **nunca se persiste** por diseño; si algún día se conecta la cola, cualquier operación encolada offline queda con un token que ya no existe tras un refresh | `offline.js` + `authStore.js:39-48` | 🟠 Alto |
| 15 | `workers.js`: `nombre`/`telefono` no se recortan (`.trim()`) al guardar — un teléfono con espacio final sortea el constraint único, permitiendo duplicados lógicos | `workers.js:30-39` | 🟠 Alto |
| 16 | `SeccionEncargadoPage`: el guard de acceso corre *después* de que 5 llamadas RPC ya se dispararon con `tokenTurno`/`userId` nulos (deep-link o refresh sin sesión) | `SeccionEncargadoPage.jsx:118-175` | 🟠 Alto |
| 17 | `ResumenPage`: se puede imprimir una lista de pago con la tabla vacía y "TOTAL €0.00" si se pulsa "IMPRIMIR" antes de que carguen sus ítems — documento de nómina impreso incorrecto | `ResumenPage.jsx:497,514-529,552-553` | 🟠 Alto |
| 18 | `panico.js`: `return data === true` — un cambio de contrato del servidor (valor truthy no idéntico a `true`) produce un falso negativo en el kill-switch más destructivo del sistema | `panico.js:12` | 🟠 Alto |
| 19 | `ciclos.js`: `calcularPeriodoCiclo()` se llama en 5+ sitios **sin `fechaRef`**, usando siempre el reloj del navegador — un reloj desincronizado cambia qué período se liquida realmente en el servidor (no solo el dashboard) | `ciclos.js` + `records.js:250-252,501-503` + `paymentLists.js:37` | 🟠 Alto |
| 20 | `offline.js`: `syncPendingOperations` sin protección contra ejecución concurrente — dos disparos casi simultáneos pueden procesar la misma operación dos veces | `offline.js:64-77` | 🟡 Medio-alto |
| 21 | `InstallPWABanner`: no detecta iPadOS 13+ (User-Agent de escritorio) — el banner nunca aparece en iPads modernos | `InstallPWABanner.jsx:6-7` | 🟡 Medio |
| 22 | `authStore.setAuth` sin validación de shape/rol — un typo en `rol` (p. ej. `'Admin'`) rompe silenciosamente todos los guards de ruta de la app | `authStore.js:21` | 🟡 Medio |
| 23 | `VehiculosPage`: actualizador de `setState` impuro que llama `rotarPinVehiculo` (efecto de red real) desde dentro del updater — bajo `StrictMode` se duplica la rotación de PIN en desarrollo | `VehiculosPage.jsx:211-238` | 🟡 Medio |
| 24 | `TrabajadoresPage`: buscador sin debounce dispara "1 query + N queries de balance" en cada tecla, sin cancelar rondas anteriores — respuestas pueden llegar desordenadas y mostrar resultados obsoletos | `TrabajadoresPage.jsx:61-78,118` | 🟡 Medio |
| 25 | `IngresarPlazaFurgonetaPage.handleCancelar` navega a `/login` **sin** `clear()` — sesión de encargado queda viva; `LoginPage` solo limpia si `rol==='admin'` | `IngresarPlazaFurgonetaPage.jsx:46-49`, `LoginPage.jsx:32-34` | 🟡 Medio |
| 26 | `records.js`: 4 lugares distintos recalculan independientemente "horas×tarifa+destajo−adelantos" (incluye `getResumenPagos`, no contado en la auditoría previa) — mismo patrón que ya causó un bug real documentado | `records.js:232-298` | 🟡 Medio |
| 27 | Documentación (`README.md` de `lib/`, `lib/api/`, `pages/`, `pages/central/`, `pages/encargado/`, `components/*`, `store/`, `hooks/`, `utils/`) sistemáticamente desactualizada: nombres de tabla incorrectos, "Edge Functions" que no existen, ~10 componentes/archivos fantasma documentados que no existen en el repo, y ~8 componentes reales activos sin documentar | ver PARTE D | 🟡 Medio (riesgo de confusión para el equipo, no de datos) |

El resto de hallazgos (🟡 bajo, 🟢 cosméticos) está en el detalle por archivo, PARTE C.

---

## PARTE B — Plan de corrección urgente (orden sugerido)

**Antes de tocar nada**, dado el principio del propio proyecto ("las funciones son la fuente de
verdad", no lo que dice el frontend): correr en el SQL Editor de Supabase las queries de
introspección para confirmar el estado real de FKs (`ON DELETE CASCADE`/`RESTRICT`) entre
`empleados`/`furgoneta` y sus tablas de historial — esto decide si el hallazgo #1 sigue siendo un
riesgo real hoy o si el flujo de dos fases ya lo neutraliza del todo.

### Bloque 1 — Integridad de dinero (esta semana)
1. **`eliminarAdelantoEmpleado`** (`records.js:195-198`): agregar el mismo guard que ya existe en
   `eliminarAdelantoVehiculo` — bloquear si `fue_liquidado = true`, con mensaje explícito.
2. **`generarListaPago`** (`paymentLists.js:133-154`): si el INSERT de `lista_pago_detalle` falla
   tras crear `lista_pago_quincenal`, al menos registrar el fallo de forma recuperable (guardar los
   `items` ya calculados en la propia fila de la lista, o reintentar el INSERT antes de abandonar) en
   vez de perder el desglose en silencio. Idealmente, mover ambos INSERTs a una única RPC
   transaccional del lado del servidor.
3. **`ResumenPage`** (`ResumenPage.jsx:196-221`): separar el `try/catch` del pago (`generarListaPago`)
   del `try/catch` del refresco posterior. Un fallo en `cargarCiclo`/`cargarListas` después de un pago
   exitoso debe mostrarse como "el pago se ejecutó, pero no se pudo refrescar la pantalla — recargue
   manualmente", nunca como el mismo banner de error que un fallo real de pago.
4. **`panico.js`** (`panico.js:12`): cambiar `data === true` por `Boolean(data)` o, mejor, exigir que
   la RPC devuelva un contrato explícito y loguear cualquier valor inesperado en vez de tratarlo como
   falso silenciosamente.

### Bloque 2 — Disponibilidad de la app (esta semana)
5. **`App.jsx:44-51`**: agregar `.catch()` al chequeo de pánico con un mensaje de error visible y un
   botón de reintento, en vez de dejar `listo=false` para siempre. Convertir el chequeo en un
   listener periódico o en una suscripción Realtime en vez de un fetch único al montar, para que una
   sesión ya abierta también transicione a `EmergencyScreen` si el pánico se activa mientras está
   abierta.
6. **`EscanearPage.jsx:139-169`**: guardar una referencia estable al scanner fuera del closure del
   efecto y llamar `.stop()` incondicionalmente en la limpieza si el objeto existe, sin depender de la
   bandera `isStarted` que puede quedar desincronizada por la carrera descrita.
7. **`CircleIcon.jsx:33`** y **`WorkerListItem.jsx:24`**: agregar fallback (`SIZES[size] ?? SIZES.md`,
   `worker ?? {}`) para que un valor inesperado degrade visualmente en vez de tirar la pantalla entera.

### Bloque 3 — Corrección de datos mostrados (próxima sesión)
8. **`formatters.js:35-43`** (`formatFecha`): parsear el string `YYYY-MM-DD` manualmente
   (`new Date(y, m-1, d)`, hora local) en vez de dejar que `new Date(string)` lo interprete como UTC,
   o forzar `timeZone: 'Europe/Madrid'` en el `toLocaleDateString` de forma consistente con
   `ciclos.js`.
9. **`FormTemporal.jsx:17`** y **`FormAdelanto.jsx:36,57`**: agregar `min="0"` a los inputs y validar
   explícitamente que cada campo con contenido sea `>= 0` antes de habilitar el submit, no solo "al
   menos uno positivo".
10. **`IngresarPlazaFurgonetaPage.jsx`**: agregar el mismo guard (`useEffect` + redirect si falta
    `vehiculoActivoId`/`tokenTurno`) que ya usan todas las demás pantallas protegidas; hacer que
    `handleCancelar` llame `clear()` antes de navegar.

### Bloque 4 — Deuda técnica de documentación (cuando haya ventana)
11. Reescribir los README de `lib/`, `lib/api/`, `pages/`, `pages/central/`, `pages/encargado/`,
    `components/*`, `store/`, `hooks/`, `utils/` contra el código real (ver PARTE D) — hoy inducen a
    error a cualquiera que confíe en ellos para entender dónde vive la seguridad o qué componentes
    existen.

---

## PARTE C — Detalle exhaustivo por archivo

### C.1 — Capa de datos (`src/lib/`)

#### `src/lib/supabase.js`
- **:27** — `createClient(url ?? '', anonKey ?? '', ...)`: si faltan las env vars, el cliente se crea
  igual con strings vacíos en vez de fallar rápido. La app arranca "normal" (solo un
  `console.warn`), y cada llamada posterior falla con un error de red/parseo confuso en vez de un
  error claro de configuración.
- Sin timeout/`AbortController` en ninguna llamada de `api/*`. Una red degradada (no caída del todo)
  puede dejar cualquier `await` colgado sin feedback más allá de lo que decida cada pantalla.

#### `src/lib/offline.js`
- Confirmado: ninguna función de `lib/api/*` importa `queueOperation` ni consulta `navigator.onLine`
  — solo se usa a sí mismo; sigue siendo aspiracional, tal como ya señaló la auditoría de pagos.
- **Agravado por `tokenTurno` (cambio A2)**: `authStore.js:39-48` excluye `tokenTurno` de
  `localStorage` para `rol==='encargado'`, pero `queueOperation` guardaría el payload completo
  (token incluido) en IndexedDB, que sí sobrevive recargas. Si la cola se conecta algún día, una
  operación encolada offline y luego recargada quedaría con un token que ya no existe en memoria —
  la RPC la rechazaría sin remedio. El diseño de la cola es anterior a la exigencia de `tokenTurno`
  y nunca se adaptó.
- **:64-77** (`syncPendingOperations`) — sin protección contra ejecución concurrente: dos disparos
  casi simultáneos (dos listeners `'online'`, o un remount + un evento de red) pueden leer el mismo
  `getAll(STORE)` antes de que el primero borre nada, procesando la misma operación dos veces.
- **:65-69** — si `handlers[op.type]` no existe, solo `console.warn` + `continue`: la operación queda
  **zombi para siempre** en la cola, sin tope ni forma de que el usuario se entere.
- **:70-76** — sin backoff ni límite de reintentos: un payload permanentemente inválido se reintenta
  indefinidamente en cada `syncPendingOperations`, generando tráfico repetido sin resolverse nunca.

#### `src/lib/api/auth.js`
- **:6-8** — el propio comentario dice *"NO se usan Edge Functions"*, contradiciendo directamente a
  `lib/api/README.md` (ver PARTE D).
- **:63** (`validarPinRegistro`) — si `data` viene vacío, fabrica un mensaje genérico client-side en
  vez de propagar la razón real (expirado/agotado/inexistente), ocultando información de diagnóstico.
- **:112-121** (`loginEncargado`) — si `data.length > 1` (mismo teléfono en más de una fila por
  error), usa silenciosamente `data[0]` sin aviso de ambigüedad.
- Sin throttling ni límite de intentos en el cliente para PIN/teléfono en los tres flujos de login
  (trabajador, encargado, admin).
- **:22-27** (`mapEmpleado`) se usa en varios sitios, pero `loginEncargado` construye su objeto de
  retorno a mano en vez de reusar el mapeo — dos formas distintas de traducir la misma fila en el
  mismo archivo; renombrar un campo en una es fácil de olvidar en la otra.
- **:147-150** (`cambiarPasswordAdmin`) — ninguna validación de longitud/fortaleza antes de llamar a
  `updateUser`, delega 100% en los defaults de Supabase Auth.

#### `src/lib/api/ciclos.js`
- **:57** — `ciclo === 'quincenal' ? 15 : 30`: cualquier valor que no sea exactamente ese string
  (typo, `null`, futuro tercer tipo) cae silenciosamente en "mensual", sin error.
- **:62** — `Math.max(0, diasEntreISO(ANCLA, hoyISO))`: si el reloj está antes de la ancla
  (`2026-08-01`), colapsa silenciosamente al bloque 0.
- **Riesgo sistémico de reloj de cliente**: se llama sin `fechaRef` en `records.js:250-252,501-503` y
  `paymentLists.js:37`, usando siempre `new Date()` del navegador. El `periodo.fin` resultante se pasa
  **directo** como parámetro a `ejecutarPago`/`ejecutarPagoVehiculo` — un reloj desincronizado cambia
  qué período se liquida realmente en el servidor, no solo lo que se ve en pantalla.
- **:35-39** (`fechaISOenMadrid`) usa `Intl.DateTimeFormat` sin try/catch; en un entorno con soporte
  ICU incompleto puede lanzar `RangeError` no capturado.
- El ancla (`2026-08-01`) es un magic string: si se cambia algún día, recalcula retroactivamente
  **todos** los bloques históricos, sin versionado de calendario.

#### `src/lib/api/panico.js`
- **:12** — `return data === true`: un valor truthy no idéntico a `true` (cambio de contrato del
  servidor) produce falso negativo — el kill-switch se activó de verdad pero la UI dice que falló.
- Sin protección contra doble-clic/reintento — es la acción más destructiva del sistema y no tiene
  ninguna salvaguarda propia más allá de lo que decida la UI.

#### `src/lib/api/temporales.js`
- **:22-33** (`actualizarTarifaTemporal`) — patrón leer-luego-actualizar sin transacción (TOCTOU si
  dos admins editan casi simultáneo). Mismo patrón en `workers.js`.
- No traduce errores de constraint (a diferencia de `vehicles.js`/`workers.js`) — el usuario ve el
  mensaje crudo de Postgres.
- **:45-48** (`eliminarTemporal`) — `.delete().eq('id', id)` **sin `.select()`**: si el `id` no existe,
  no reporta error y retorna éxito silencioso sin haber borrado nada. Contrasta con
  `eliminarAdelantoVehiculo`, que sí verifica `data.length === 0`.
- **:55-58** (`eliminarTodosLosTemporales`) — el filtro `.gte('created_at', '1900-01-01')` no
  matchea filas con `created_at NULL` en Postgres — "eliminar todos" puede dejar sobrevivientes.
- **:36-43** (`listarTemporales`) — sin `.limit()`, a diferencia de `getJornadasTrabajador`.

#### `src/lib/api/vehicles.js`
- **:34-43** — `matricula`/`propietario` se recortan con `.trim()`, pero `nombre`/`apodo` **no** —
  inconsistente.
- **:64-69** — `traducirErrorFurgoneta` solo traduce el CHECK de `costo_plaza`; otros constraints
  quedan sin traducir.
- **:124-133** (`actualizarPlazasVehiculoDia`) — sin validación `plazas >= 0`/entero.
- **:182-189** (`registrarAdelantoVehiculo`) — sin validación `monto > 0`.
- **:172-180** — suma de montos con `+=` de punto flotante, mismo riesgo de redondeo ya señalado
  para pagos.
- **Positivo, para contraste**: `:201-212` (`eliminarAdelantoVehiculo`) sí bloquea borrar un adelanto
  liquidado — es la función que `records.js:195-198` (equivalente de empleados) **no** replica (ver
  hallazgo crítico #2 en PARTE A).
- **:105-119** (`darDeBajaVehiculo`) — buen patrón de dos fases, pero sin ventana de caducidad para
  `montoEsperado`: el cliente puede calcular hoy y ejecutar días después con el mismo número.

#### `src/lib/api/workers.js`
- **:60** — `busqueda` se interpola sin escapar en un filtro `.or()` de PostgREST — inyección de
  filtro (no SQL injection clásica, pero estructura de query alterable con `,`/`)` en el input).
- **:94-98** (`getTrabajadorPorId`) — distinción "error de permisos vs. real" por matching de texto
  frágil (`error.code === 'PGRST116' || message.includes('permission')...`) — un cambio de redacción
  del error rompería silenciosamente el fallback a la RPC segura para encargados.
- **:13-14 vs. 84-90** — el comentario promete que el encargado recibe solo id/nombre/teléfono, pero
  esa garantía **no está codificada aquí**: depende 100% de que RLS bloquee la query completa — el
  mismo tipo de configuración que ya falló una vez en producción (JWT en ruta incorrecta, según
  `CAMBIOS-DECIMA.md`).
- **:161-164** (`resolverPendientePeriodo`) — el parámetro `pendiente` **nunca se usa** en el cuerpo,
  contradiciendo su propio docstring.
- **:181-199** (`promoverTipoPagoPendiente`) — SELECT+UPDATE sin transacción, con manejo
  "best-effort" que mitiga que tumbe el pago pero no la carrera de datos en sí; falla silenciosamente
  (solo `console.error`).
- **:30-39** (`aColumnasV6`) — ni `nombre` ni `telefono` se recortan con `.trim()` (a diferencia de
  `vehicles.js`) — un teléfono con espacio final sortea el constraint único de duplicados.
- **:245** (`getBalanceTrabajador`) — `Number(data) || 0` enmascara un `NaN` del servidor como
  "balance = 0", ocultando un posible error de cálculo real.

#### `src/lib/api/records.js` (fuera de `ejecutarPago`/`ejecutarPagoVehiculo`, ya cubiertos)
- **:34-41** (`mapAdelanto`) — `pagado_en` usa `created_at` (fecha de creación, no de liquidación) —
  nombre de campo engañoso para auditoría de "cuándo se saldó esto".
- **:61-72** (`registrarJornadaEmpleado`) — cero validación de `horas`/`destajo` negativos también en
  la capa de datos (no solo en el formulario, ya señalado antes).
- Patrón sistémico en **6 funciones** (`iniciarJornadaEncargado`, `cerrarJornadaEncargado`,
  `registrarPlazasVehiculo`, `corregirJornadaEmpleado`, `corregirJornadaEncargado`,
  `registrarTemporal`): ninguna valida que `tokenTurno` venga presente antes de llamar a la RPC —
  todas dependen 100% del rechazo del servidor.
- **:109-123** (`getJornadasDelDia`) — `fecha` se concatena directo en strings sin validar formato;
  un `fecha` `undefined` genera literalmente `"undefinedT00:00:00"`.
- **:148-161** (`actualizarJornadaTrabajador`) — el parámetro `tabla` se usa directo como
  `supabase.from(tabla)` sin allow-list explícito.
- **:165-172** (`registrarAdelanto`) — sin validación `monto > 0` y sin traductor de error de
  constraint.
- **:195-198** (`eliminarAdelantoEmpleado`) — **crítico**, ver PARTE A #2.
- **:232-298** (`getResumenPagos`) — cuarto lugar que recalcula independientemente
  `horas×tarifa+destajo−adelantos`; además invoca `calcularPeriodoCiclo()` sin `fechaRef`,
  heredando el riesgo de reloj de cliente directo en el KPI del dashboard.
- **:325-343** (`getJornadasTrabajador(empleadoId, limit=60)`) — `limit` se aplica por separado a
  `jornada_empleado` y `jornada_encargado`, luego se concatenan — para un trabajador que también es
  encargado, el resultado puede llegar a 2×limit filas.
- **:473-481** vs. **:499-549** — dos implementaciones independientes de "¿ya se le pagó su ciclo?",
  una individual y otra en lote — mismo riesgo de divergencia que ya causó un bug real documentado.
- **:551-562** (`getHistorialPagosVehiculo`) — el corte de retención usa hora del navegador en UTC,
  sin usar `fechaISOenMadrid` como el resto del sistema — inconsistencia de zona horaria.
- **:436-446** — sin FK entre jornada y pago que la liquidó; la reconstrucción histórica es por
  coincidencia de rango de fechas — rangos solapados podrían mostrar jornadas de otro pago al
  reimprimir.
- **:591** (`registrarTemporal`) — `destajo` sin valor por defecto (a diferencia de `horas`); si se
  omite, `JSON.stringify` lo elimina y la RPC puede fallar por parámetro ausente en vez de recibir 0.

#### `src/lib/api/paymentLists.js` (no cubierto por la auditoría previa)
- **:116** — tras cada `ejecutarPago` ahora también llama `promoverTipoPagoPendiente` — una tercera
  ida-y-vuelta secuencial por empleado en un loop ya lento y no atómico (≈3 llamadas × N empleados).
- **:133-154** — **crítico**, ver PARTE A #3.
- **:66** (`puedePagar`) — se calcula en `getDatosCicloParaPago` pero `generarListaPago` **nunca lo
  verifica** — la única barrera contra pagar antes de tiempo vive en la UI, no en la función que
  mueve el dinero.
- **:40-45** — `Promise.all` sobre todos los empleados del ciclo (N×2 requests simultáneos) mientras
  el loop de escritura se fuerza secuencial — asimetría de diseño no documentada.

### C.2 — Páginas (`src/pages/`)

#### `src/App.jsx` / `src/main.jsx`
- **App.jsx:44-49** — **crítico**, ver PARTE A #5.
- **App.jsx:85** — el comodín `*` redirige siempre a `/login`, sin distinguir rol; un encargado que
  cae ahí no limpia su sesión (`LoginPage` solo limpia si `rol==='admin'`) — sesión de campo viva en
  un dispositivo compartido.
- **main.jsx:11-16** — falta `onNeedRefresh` en el registro del Service Worker: una nueva versión
  desplegada nunca avisa al usuario para recargar; un operario puede quedarse indefinidamente en una
  versión vieja.

#### `src/pages/LoginPage.jsx`
- **:32-34** — limpieza de sesión asimétrica: solo limpia si `rol==='admin'`, dejando sesiones de
  encargado/trabajador colgando en el store al aterrizar aquí.

#### `src/pages/central/EscanearPage.jsx`
- **:139-169** — **fuga de cámara**, ver PARTE A #6.
- `getEmpleadosPendientesDePago()` sin backoff/retry, error mostrado en banner genérico.

#### `src/pages/central/ConfiguracionPage.jsx`
- **:51-52** — `setTimeout(..., 2500)` sin `clearTimeout` en desmontaje — intento de `setState` sobre
  componente ya desmontado si el admin navega justo tras el éxito.
- `handleCambiarPassword` no cierra sesión ni fuerza re-login tras cambiar contraseña — un JWT viejo
  en otro dispositivo sigue funcionando.

#### `src/pages/central/ReporteDiarioPage.jsx`
- **`getJornadasDelDia` solo consulta `jornada_empleado`** — las horas propias del encargado (guardadas
  en `jornada_encargado`) **nunca aparecen** en el Reporte Diario, ni siquiera en tiempo real (el
  `useRealtime` de la línea 59 tampoco escucha esa tabla).
- **:48-55** — `cargar()` sin `AbortController`; dos cambios rápidos de fecha pueden hacer que la
  respuesta más lenta (fecha vieja) sobrescriba a la más rápida (fecha nueva) — el admin ve jornadas
  de un día distinto al que el selector muestra.
- **:32-46** (`agruparJornadas`) sin memoización — trabajo repetido en cada render.

#### `src/pages/central/TrabajadorDetallePage.jsx`
- **:152-172** — **pérdida de texto tecleado por refetch en tiempo real**, ver PARTE A #7. Confirmado
  contra `FormTrabajador.jsx`: en modo editar, Teléfono/Periodicidad/Tarifa están directamente
  controlados por `values`, sin buffer local.
- **:290-309** (`handleConfirmarBaja`) — manejo de error asimétrico: si el recálculo tras un fallo
  también falla, el `catch` vacío deja el mensaje de error original visible "por accidente" (funciona
  hoy, pero es frágil ante cambios futuros).
- **:496-497** — input de edición de adelanto sin `min`/tope; el filtro solo existe al confirmar, y
  un valor inválido se descarta sin feedback (parece un botón roto).

#### `src/pages/central/TrabajadoresPage.jsx`
- **:61-78,118** — **buscador sin debounce**, ver PARTE A #24.
- **:196,349** — `setTimeout` de confirmación sin `clearTimeout` en desmontaje, mismo patrón que
  `ConfiguracionPage`.
- **:500-535** (`ModalTrabajador`) — `reset()` solo se llama vía `onClose`/tras guardar; cualquier
  otra vía de cierre futura dejaría datos viejos la próxima apertura.

#### `src/pages/central/VehiculoDetallePage.jsx`
- **:119-175** — **mismo bug de pérdida de texto que TrabajadorDetallePage, pero más grave**: los
  6 campos del formulario están todos controlados directamente (sin buffer), y se dispara por 3
  suscripciones Realtime distintas, una de las cuales (`jornada_furgoneta`) cambia constantemente
  durante la jornada operativa — condición de carrera mucho más fácil de disparar en producción.
- **:201-212** — `handleGuardarPlazas` sigue usando `confirm()` nativo, mientras el resto de la
  página migró deliberadamente a modales propios (según su propio comentario de changelog).
- **:514/349** — fallback `d.tarifa_plaza_aplicada ?? vehiculo.tarifa_plaza` usa la tarifa **vigente**
  si el snapshot es `NULL` — mismo patrón de riesgo ya señalado como crítico para `tarifa_aplicada`
  de empleados.

#### `src/pages/central/VehiculosPage.jsx`
- **:211-238** — **actualizador de `setState` impuro**, ver PARTE A #23. Bajo `StrictMode` duplica
  la rotación de PIN en desarrollo; en producción (sin StrictMode) el riesgo real es menor pero el
  patrón sigue siendo incorrecto.
- **:173-202** — si la carga inicial falla, `vehiculos` queda `[]` y el texto "No hay vehículos"
  es engañoso (no distingue "vacío" de "error de carga").

#### `src/pages/empleado/TrabajadorQRPage.jsx`
- **:45** — `logout()` llama `supabase.auth.signOut()` aunque el rol `'trabajador'` nunca tuvo sesión
  de Supabase Auth — petición de red inútil en cada logout, sin efecto real.

#### `src/pages/encargado/IngresarPinFurgonetaPage.jsx`
- Sin hallazgos nuevos relevantes — guard correcto, sin condiciones de carrera de estado parcial.

#### `src/pages/encargado/IngresarPlazaFurgonetaPage.jsx`
- **Sin ningún guard de ruta**, ver PARTE A #13.
- **:46-49** (`handleCancelar`) — navega a `/login` sin `clear()`, ver PARTE A #25.
- **:16** — exporta `IngresarPinFurgonetaPage` (nombre copiado del archivo homónimo) — no rompe
  runtime, pero confunde stack traces/DevTools.

#### `src/pages/encargado/SeccionEncargadoPage.jsx`
- **:118-175** — guard corre después de que 5 llamadas RPC ya se dispararon con parámetros nulos, ver
  PARTE A #16. Efecto secundario de navegación fuera de un `useEffect` (dentro del cuerpo del render,
  diferido con `setTimeout(0)`).
- **:259-263** — `setTimeout` de cierre de sesión (1.5s) sin mecanismo de cancelación si el usuario
  navega antes.
- **:137-150** — fusión manual de `registradosSesion` puede duplicar entradas visualmente si el
  usuario cambia de fecha y vuelve muy rápido (solo cosmético, no financiero).

#### `src/pages/central/ResumenPage.jsx` — solo hallazgos nuevos
- **:196-221** — **riesgo de pago duplicado**, ver PARTE A #4.
- **:497,514-529,552-553** — **impresión de planilla vacía**, ver PARTE A #17.
- **:558-563** (`fmtHorasMin`) — `if (!h) return ''` no distingue "0 horas trabajadas" de "sin
  jornada ese día" en el documento impreso — ambigüedad de reporte financiero.

### C.3 — Componentes, store, hooks, utils

#### Formularios
- **`FormAdelanto.jsx:36,57`** — sin `min`, sin validación de signo, ver PARTE A #12.
- **`FormTrabajador.jsx`** — nombre con espacio colgante propagado en cada `onChange`; sin `<form>`
  real (botones `onClick`, Enter no envía, `min` HTML5 decorativo); `tarifaValida` sin techo.
- **`FormVehiculo.jsx`** — `plazasValidas` usa `parseInt` para validar pero envía el string crudo sin
  normalizar (`"5.9"` pasa validación truncada pero se envía tal cual); sin `<form>` real; sin techo
  de tarifa.
- **`BuscadorEmpleado.jsx:24`** — búsqueda sin normalización de acentos (Unicode) — "jose" no
  encuentra "José".
- **`FormJornada.jsx:40-44`** — `useState(valoresIniciales)` no resincroniza si el componente se
  reutiliza sin desmontar (mitigado hoy por disciplina de `SeccionEncargadoPage`, no por el
  componente mismo); sin `min="0"` en horas/destajo.
- **`FormPlazas.jsx:40`** — sin `min`, sin mensaje de validación (a diferencia de `FormVehiculo` para
  el mismo dato "plazas") — permite plazas negativas.
- **`FormTemporal.jsx:17,23-24`** — **validación OR asimétrica permite negativos**, ver PARTE A #11.
- **`FormAccesoUnificado.jsx:30,75`** — mensaje de error dice "como máximo 10 dígitos" pero la
  condición real exige exactamente 10 — mensaje engañoso.
- **`FormRegistroConPin.jsx:27,44`** — PIN de registro (secreto de un solo uso) queda en estado de
  React sin limpiarse tras validado; sin límite de intentos en cliente para el PIN de 6 dígitos.

#### Dominio y layout
- **`BalanceCard.jsx:24,34`** — `isPositive = amount > 0` no distingue negativo de cero (ambos
  grises); `Number(amount).toFixed(2)` sin guarda de `NaN` (`"€NaN"` posible).
- **`InstallPWABanner.jsx:6-7`** — no detecta iPadOS 13+, ver PARTE A #21.
- **`StatCard.jsx:26`** — `COLORS[color]` sin fallback — color no soportado pierde estilo
  silenciosamente.
- **`WorkerListItem.jsx:24`** — **crash si `worker` es `undefined`**, ver PARTE A #9.
- **`Header.jsx:60-66`** — no distingue "contraseña incorrecta" de "error de red" con mensajes
  claros; el campo de contraseña de emergencia no se limpia tras un intento fallido.

#### UI base
- **`Badge.jsx`** — 🟢 único átomo con fallback defensivo correcto (`PRESETS[variant] || {...}`).
- **`Button.jsx:48`**, **`Card.jsx:26`**, **`SectionTitle.jsx:32`** — `variants[variant]`/`COLORS[color]`
  sin fallback: un valor no soportado pierde el estilo (clase `undefined`) sin crashear.
- **`CircleIcon.jsx:33`** — **crash por destructuring directo sin fallback**, ver PARTE A #8. Es el
  más severo del set porque, a diferencia de los anteriores, sí tira el componente completo.
- **`CircleIcon.jsx:29`** — `icon` sin default: si se omite, `<Icon .../>` con `undefined` lanza
  "Invalid element type".
- **`Input.jsx:23-24`** — `value` sin default puede volver un input de no-controlado a controlado si
  un consumidor futuro no inicializa el estado con `''`.
- **`Modal.jsx:12-13`** — sin cierre por `Escape`, sin bloqueo de scroll del fondo, sin
  `aria-modal`/focus trap — carencia de accesibilidad, no bug de datos.
- **`PinInput.jsx:37-38`** — sin `autoComplete="off"` explícito en el input tipo password.

#### Store, hooks, utils
- **`authStore.js:21`** — `setAuth` sin validación de shape/rol, ver PARTE A #22.
- **`useOnlineStatus.js`** — sin debounce; en redes inestables de campo, `online`/`offline` puede
  parpadear en ráfagas.
- **`useRealtime.js:19`** — depende enteramente de que el caller memoice `onChange`
  (`useCallback`); si no lo hace, se desuscribe/resuscribe en cada render (churn de WebSocket). Hoy
  los 3 usos reales lo hacen bien, pero el hook no tiene salvaguarda propia.
- **`constants.js`** — sin bugs de lógica (objeto puro).
- **`formatters.js:35-43`** — **`formatFecha` desplaza un día en zonas horarias negativas**, ver
  PARTE A #10. Es el hallazgo más grave de esta sección por afectar directamente fechas de nómina
  mostradas en toda la app.
- **`formatters.js:9-16,22-29`** — `formatEUR`/`formatEURShort`: validación de entrada inconsistente
  ante arrays (`[5]` se formatea, `[5,6]` se rechaza) — caso extremo, no crítico.

---

## PARTE D — Documentación (README) vs. código real

La brecha entre documentación y código es sistemática en **todo** el árbol, no solo en `lib/`
(ya señalado en la auditoría previa). Resumen consolidado:

| Carpeta | README afirma | Realidad | Impacto |
|---|---|---|---|
| `lib/`, `lib/api/` | Edge Functions `verificar-pin`/`ejecutar-pago`; nombres de tabla en plural/incorrectos; faltan 4 módulos completos (`ciclos.js`, `panico.js`, `temporales.js`, `paymentLists.js`); patrón de error `if (error) throw error` (crudo) | Todo RPC normal (`auth.js:8` lo desmiente explícitamente); nombres reales singulares (`jornada_empleado`, `adelanto_empleado`, `pago_empleado`, `furgoneta`); todo el código real usa `throw new Error(error.message)` | Alto riesgo de que un desarrollador nuevo entienda mal dónde vive la seguridad real |
| `pages/`, `pages/central/`, `pages/encargado/` | Formularios/componentes de una arquitectura de login vieja (`FormLoginTrabajador`, `FormLoginEncargado`, `EntradaManual`, `SeccionVehiculoPage`, PIN "validado por Edge Function", horas del encargado "automáticas"); 5 tabs; falta `ConfiguracionPage`/`VehiculoDetallePage` en el mapa | Arquitectura real usa `FormAccesoUnificado`/`FormRegistroConPin`; PIN identifica la furgoneta en un solo paso; horas del encargado se registran **manualmente** vía "Mis horas"; 6 tabs incluyendo Configuración | Confusión real para cualquiera que use el README como mapa de navegación del código |
| `components/*` (`forms`, `domain`, `layout`, `ui`) | Documenta `FormGastoVehiculo.jsx`, `ToggleAuth.jsx`, `EntradaManual.jsx` (no existen); omite `EmergencyScreen`, `InstallPWABanner`, `FormTemporal`, `BuscadorEmpleado` (sí existen y están en uso) | — | Inventario desactualizado en ambas direcciones |
| `hooks/` | Documenta `useQRScanner` (no existe); omite `useRealtime` (sí existe, usado en 3 páginas) | — | El hook más complejo del sistema no tiene documentación |
| `store/` | `partialize` excluye "solo `vehiculoActivoId`" | Excluye **las 8 claves** de la sesión de encargado | Subestima cuánta sesión se pierde al refrescar |
| `utils/` | Tabla de `Direccion` con clave `seccionEncargador` (typo) y 3 rutas reales faltantes | Clave real es `seccionEncargado` (sin "r") | Copiar la clave del README rompe cualquier `navigate()` que la use |

**Recomendación**: no es prioritario frente a los bloques 1-3 de la PARTE B, pero conviene resolverlo
antes de sumar a alguien nuevo al proyecto — cada README leído como fuente de verdad hoy desinforma
en al menos un punto concreto y verificable.

---

## Pendiente para la siguiente sesión

1. Confirmar en el SQL Editor de Supabase el estado real de FKs `ON DELETE CASCADE`/`RESTRICT` desde
   `pago_empleado`/`adelanto_empleado`/`jornada_empleado` (y equivalentes de furgoneta) — resuelve si
   el hallazgo #1 de la PARTE A sigue vigente tras el flujo de baja de dos fases.
2. Decidir si el Bloque 1 de la PARTE B se implementa en esta sesión o se prioriza contra el resto del
   backlog de Fase A2/E.
3. Revisar si vale la pena mover el INSERT doble de `generarListaPago` (`lista_pago_quincenal` +
   `lista_pago_detalle`) a una única RPC transaccional del lado del servidor, en vez de parchear el
   cliente — sería la solución de raíz, no solo un curita.
