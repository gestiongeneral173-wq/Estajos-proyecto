# Análisis del Sistema — Panel Central

Documento descriptivo del panel **Central** (rol Administrador): qué páginas existen, qué secciones
tiene cada una y qué permite o no permite hacer cada sección. Es un mapa funcional para apoyar la
implementación de cambios — no describe código ni la forma en que las pantallas se conectan a la
base de datos.

El Central es el único rol que entra con email + contraseña. Una vez dentro, navega por **6
pestañas** fijas en la parte superior: Escanear, Reporte Diario, Resumen, Registros, Vehículos y
Configuración. Además hay dos páginas de detalle a las que solo se llega tocando un elemento de una
lista (Detalle de Trabajador, Detalle de Vehículo), y una página de login previa a todo esto.

---

## Página: Login Central

*(fuera de las pestañas — es la puerta de entrada al panel)*

**Sección Acceso de Administrador**
Te permite: iniciar sesión con email y contraseña; ver un mensaje de error si las credenciales
fallan.
No te permite: registrarte desde aquí, recuperar la contraseña desde esta pantalla, ni entrar con
PIN (eso es exclusivo de Encargados/Empleados).

---

## Página: Escanear

Es la pantalla de inicio del panel. Sirve para localizar a un trabajador y decidir qué hacer con él.

**Sección Escanear QR / Buscar** *(cuando todavía no hay trabajador seleccionado)*
Te permite: activar la cámara y escanear el código QR de un trabajador; o buscarlo escribiendo su
nombre o teléfono en una lista que se filtra al escribir. Esa lista muestra primero a los que tienen
algo pendiente de cobro en su ciclo activo, y marca con una etiqueta "Pagado" a los que ya cobraron
este ciclo (siguen visibles, por ejemplo para darles un adelanto).
No te permite: ver ahí a alguien que no tenga nada pendiente ni esté ya pagado en el ciclo — para
llegar a esos trabajadores hace falta el QR.

**Sección Información del trabajador** *(siempre visible en cuanto se selecciona a alguien)*
Te permite: ver de un vistazo su nombre, teléfono, tipo de pago (badge) y, si corresponde, un aviso
de "PAGADO EN ESTE CICLO".
No te permite: editar ningún dato desde aquí (para eso está el Detalle de Trabajador).

**Sección "¿Qué deseas hacer?" (menú de acciones)**
Te permite: elegir entre Dar Adelanto, Pagar Empleado, Agregar Horas, o cancelar y volver a
Escanear.
No te permite: pagar o dar un adelanto directamente sin pasar por este menú primero.

**Sub-sección Dar Adelanto**
Te permite: ver el historial de adelantos ya dados en el ciclo activo (fecha y monto, con total);
registrar un adelanto nuevo indicando solo el monto — la fecha siempre es la de hoy.
No te permite: elegir otra fecha para el adelanto, ni editar o eliminar un adelanto ya dado desde
aquí (eso se hace en el Detalle de Trabajador).

**Sub-sección Pagar Empleado**
Te permite: ver la liquidación completa del ciclo a pagar — tabla de días trabajados (fecha, horas,
destajo, total por día), el total de días, el total de adelantos del ciclo y el total neto a pagar;
confirmar el pago con un diálogo de verificación.
No te permite: pagar si el trabajador ya está pagado en este ciclo, si no hay ningún día pendiente,
o si el pago es anticipado (el ciclo todavía no llega a su día de pago oficial) — en ese caso el
botón queda bloqueado y se indica la fecha en que se habilita. Si el monto incluye días o adelantos
arrastrados de un ciclo anterior sin cerrar, se avisa expresamente.

**Sub-sección Agregar Horas**
Te permite: registrar la jornada de HOY de este trabajador directamente desde Central, sin que medie
un encargado ni una furgoneta; si esa jornada de hoy ya existe y no fue liquidada, permite editarla
libremente (horas y destajo).
No te permite: crear ni editar la jornada de hoy si esa jornada ya fue liquidada (queda solo de
lectura); no permite elegir otra fecha distinta de hoy.

---

## Página: Reporte Diario

Vista de auditoría del día: quién trabajó, con qué furgoneta y bajo qué encargado.

**Sección Selector de fecha**
Te permite: elegir cualquier fecha (pasada o presente) para ver todas las jornadas registradas ese
día.

**Sección Jornadas registradas** (agrupadas por encargado + vehículo; las jornadas dadas de alta
desde Central aparecen agrupadas aparte, bajo "Registrado por Central")
Te permite: ver, por grupo, la lista de empleados con sus horas y destajo; editar horas y destajo de
cualquier jornada que no esté liquidada (ícono de lápiz); identificar de un vistazo las jornadas ya
liquidadas (aparecen marcadas como "Pagado", sin opción de editar).
No te permite: editar una jornada ya liquidada, ni eliminar una fila individual desde aquí.

**Sección Rehacer registro de furgoneta** (ícono de papelera en la cabecera de cada grupo — solo
visible si el encargado y el vehículo de ese grupo siguen activos y la fecha mostrada es la de hoy)
Te permite: borrar de una sola vez todo el registro de esa furgoneta ese día — las jornadas de los
empleados que viajaron en ella y el registro de la propia furgoneta — y además reinicia el día
completo del encargado (aunque ya lo haya cerrado), para que pueda volver a entrar con el PIN de esa
furgoneta y rehacer todo desde cero.
No te permite: hacerlo sobre un día distinto de hoy, sobre un grupo cuyo encargado o vehículo fue
dado de baja, ni deshacer la acción una vez confirmada (pide confirmación explícita antes de
ejecutarse, y advierte que el encargado deberá volver a declarar las horas de su día completo).

---

## Página: Resumen

Es el centro de control de pagos: totales globales, generación de listas de pago y cierre de ciclos.

**Banner de ciclos descartados** (solo aparece si antes se dijo "NO" a una alerta de ciclo
completado)
Te permite: tocar el aviso para reabrir esa alerta en cualquier momento.
No te permite: confirmar el ciclo desde el banner mismo (solo reabre la alerta correspondiente).

**Sección Resumen General**
Te permite: ver, de un vistazo, qué ciclo (quincenal y mensual) está actualmente activo para pago y
cuánto dinero total está pendiente en cada uno.
No te permite: ninguna acción — es solo informativo.

**Sección Resumen Furgonetas**
Te permite: lo mismo que Resumen General, pero exclusivo de vehículos (contador separado del de
empleados).
No te permite: ninguna acción — es solo informativo.

**Sección Choferes**
Te permite: ver la lista de empleados que hicieron de chofer, cuántas veces y el monto acumulado; y
"pagarles" — un pago meramente informativo (el dinero real lo entrega el cliente por fuera del
sistema) que, al confirmarse, borra el registro.
No te permite: ver un historial de estos pagos después de confirmados (no queda registro alguno), ni
deshacer el pago una vez hecho.

**Sección Ciclo de pago** (selector Quincenal / Mensual)
Te permite: cambiar entre el ciclo quincenal y el mensual activos; ver el período vigente; exportar
los datos del ciclo elegido a un archivo Excel (una fila por trabajador, una columna por día); o
exportar/imprimir una planilla con el mismo detalle en formato de documento impreso.
No te permite: exportar nada si el ciclo elegido no tiene datos (los botones quedan deshabilitados y
se indica "sin datos para exportar").

**Sección Lista de pago quincenal** (solo visible con el ciclo quincenal activo — el mensual se cobra
por nómina presencial, fuera de este flujo)
Te permite: iniciar el proceso tocando "Generar lista", lo que abre un buscador y una lista de
empleados quincenales con saldo pendiente para marcar quiénes se van a pagar; al aceptar la
selección, pide el nombre del encargado que va a repartir el efectivo; al confirmar, genera la lista
y ejecuta el pago de inmediato para todos los seleccionados.
No te permite: seleccionar a un empleado sin saldo pendiente (ni siquiera aparece en la lista); ni a
uno bloqueado por pago anticipado (aparece atenuado, con la fecha en que se desbloquea, pero su
casilla no se puede marcar); tampoco permite generar la lista sin escribir el nombre del encargado.

**Sección Listas generadas · Quincenal** (historial)
Te permite: ver cada lista ya generada (fecha del período, encargado responsable, total); abrir una
para ver el detalle por empleado; reimprimirla cuantas veces haga falta; cancelarla — si el ciclo de
esa lista todavía no fue confirmado, cancelar revierte el pago y los días/adelantos vuelven a quedar
pendientes; si el ciclo ya fue confirmado/archivado, "cancelar" solo la oculta sin tocar el dinero ya
pagado.
No te permite: cancelar sin pasar por el diálogo de confirmación, ni modificar los montos de una
lista ya generada.

**Alerta "Ciclo completado"** (aparece sola, sin que el admin tenga que buscarla, en cuanto un ciclo
llega a cero pendiente y todavía no se confirmó)
Te permite: confirmar que el ciclo terminó (esto avanza el sistema al siguiente ciclo); o responder
"NO", lo que no cambia nada en ese ciclo pero baja la alerta al banner de arriba para poder retomarla
después.
No te permite: ignorarla sin registrar una respuesta explícita — siempre hay que confirmar o
descartar.

**Planilla imprimible / Lista de pago imprimible**
Te permite: verlas únicamente al usar las opciones de exportar/imprimir — no ocupan espacio en la
pantalla normal.

---

## Página: Registros (antes "Trabajadores")

Listado general de empleados con accesos a configuración relacionada.

**Sección de cabecera (acciones)**
Te permite: añadir un trabajador nuevo mediante un formulario en modal; abrir el generador de código
de registro para autoregistro de nuevos empleados; abrir la configuración de temporales; abrir la
configuración de chofer.

**Sub-pantalla "Generar código de registro"**
Te permite: revisar y editar la tarifa por hora con la que se autoregistrará un nuevo empleado; generar
un código con un número de usos definido (válido 24 horas, se desactiva solo al agotar los usos);
copiar el código; ver la lista de códigos activos con cuántos usos llevan cada uno; cancelar un
código activo.
No te permite: cambiar el cupo de un código ya generado, ni reactivar uno cancelado.

**Sub-pantalla "Configurar temporales"**
Te permite: editar la tarifa por hora que se aplica a los trabajadores temporales; ver la lista de
temporales registrados el día de hoy (nombre, horas, destajo, monto pagado); eliminar uno en
particular o todos a la vez.
No te permite: editar las horas o el destajo de un temporal desde aquí; los registros de temporales
se eliminan solos automáticamente cada día a la 1:00 AM, sin intervención del admin.

**Sub-pantalla "Configurar chofer"**
Te permite: editar únicamente la tarifa por hora del chofer — ese valor se copia a cada chofer que se
asigne ese día, sin afectar a los ya registrados.
No te permite: ver o pagar a los choferes desde aquí (esa operación vive en la página Resumen).

**Sección Filtros y búsqueda**
Te permite: filtrar el listado por Todos, Mensual, Quincenal o Encargados; buscar por texto libre.

**Sección Listado de trabajadores**
Te permite: ver cada trabajador con su tipo de pago y su saldo (balance) actual; entrar a su ficha
completa tocándolo.
No te permite: editar sus datos o darlo de baja desde este listado — ambas cosas viven en su Detalle.

---

## Página: Detalle de Trabajador

Ficha completa de un trabajador, a la que se llega desde Registros o desde Escanear.

**Cabecera**
Te permite: ver nombre, teléfono, tipo de pago, saldo neto y tarifa por hora; editar nombre,
teléfono, tipo de pago y tarifa mediante un formulario que se despliega al tocar el ícono de edición.
No te permite: editar el destajo como si fuera una tarifa fija (ya no existe como configuración —
el destajo siempre se registra jornada por jornada, con un monto propio cada vez).

**Sección Rol de Encargado**
Te permite: activar o desactivar que este trabajador también actúe como encargado (el cambio aplica
recién en su próximo inicio de sesión).

**Sección Dar adelanto**
Te permite: registrar un adelanto rápido indicando solo el monto (la fecha es siempre la de hoy).

**Sección Adelantos** (desplegable)
Te permite: ver el historial de adelantos del ciclo activo; editar el monto de un adelanto existente
(la fecha nunca se puede tocar); eliminarlo por completo. Ambas acciones piden confirmación explícita
antes de ejecutarse.
No te permite: cambiar la fecha de un adelanto, ni editar/eliminar sin confirmar.

**Sección Nómina Actual** (desplegable)
Te permite: ver las jornadas pendientes de pago del ciclo activo, con fecha, horas, destajo, tarifa
aplicada y el subtotal calculado de cada una; editar las horas y el destajo de cualquiera de ellas.
No te permite: editar la fecha de una jornada, ni eliminarla desde aquí.

**Sección Nóminas Anteriores** (desplegable)
Te permite: consultar el historial de pagos ya liquidados (fecha, período cubierto, total pagado).
No te permite: ninguna edición — es un registro de solo lectura.

**Sección Dar de baja**
Te permite: calcular primero cuánto se le debe al trabajador (jornadas y adelantos pendientes,
sin límite de fecha) y, tras revisar y confirmar ese monto exacto, liquidarlo y eliminar al
trabajador de forma permanente en un solo paso.
No te permite: dar de baja sin ver antes el cálculo, ni deshacer la baja una vez confirmada.

---

## Página: Vehículos

Listado general de furgonetas con su estado de PIN y adelantos.

**Sección de cabecera**
Te permite: añadir un vehículo nuevo (nombre, matrícula opcional, tarifa por plaza, tipo de pago);
consultar el aviso de que los PIN rotan automáticamente cada 24 horas.

**Tarjeta de cada vehículo**
Te permite: ver su nombre, matrícula, número de plazas, el PIN actual junto con una cuenta regresiva
circular hasta la próxima rotación automática, la tarifa por plaza y el total de adelantos
pendientes; rotar el PIN manualmente antes de que le toque; entrar al detalle completo del vehículo.
No te permite: editar sus demás datos (nombre, tarifa, tipo de pago, etc.) desde esta tarjeta — para
eso hay que entrar al detalle.

---

## Página: Detalle de Vehículo

Ficha completa de una furgoneta, a la que se llega desde Vehículos.

**Cabecera**
Te permite: ver el PIN actual, la tarifa por plaza y el tipo de pago; editar nombre, matrícula,
número de plazas, tarifa, propietario y tipo de pago mediante un formulario. Un cambio de tipo de
pago queda "pendiente" y solo se aplica de verdad después del próximo pago exitoso de ese vehículo.
No te permite: que los cambios afecten jornadas ya registradas — nunca son retroactivos.

**Sección Adelantos** (desplegable)
Te permite: añadir un adelanto o gasto entregado al dueño de la furgoneta (con un concepto opcional y
un monto); editar el monto de uno existente o eliminarlo, ambas acciones con confirmación explícita.
No te permite: añadir un adelanto sin indicar el monto.

**Sección Nómina Actual** (desplegable)
Te permite: ver los días del ciclo activo pendientes de pago (fecha, encargado que lo usó ese día,
plazas ocupadas, total); editar el número de plazas de un día puntual (con confirmación).
No te permite: editar la fecha o el encargado asociado a un día, ni añadir un día manualmente desde
aquí.

**Sección Nóminas Anteriores** (desplegable)
Te permite: consultar los pagos ya liquidados a esta furgoneta (tipo de ciclo, fechas, monto
generado, adelantos descontados, monto pagado), dentro de la ventana de retención de datos
configurada en el sistema.
No te permite: ninguna edición — es un comprobante de solo lectura.

**Sección Dar de baja**
Te permite: calcular lo que se le debe a la furgoneta (jornadas y adelantos pendientes) y, tras
confirmar el monto exacto, liquidarla y eliminarla de forma permanente.
No te permite: darla de baja sin revisar antes el cálculo, ni deshacerlo después.

**Acción Pagar**
Te permite: liquidar el ciclo activo de la furgoneta de un solo golpe — los días y adelantos
pendientes de ese período pasan a Nóminas Anteriores — previa confirmación en un diálogo que muestra
lo devengado, los adelantos y el neto a pagar.
No te permite: pagar si no hay absolutamente nada pendiente (el botón queda deshabilitado).

---

## Página: Configuración

Punto de entrada para ajustes generales del panel.

**Sección Cambiar contraseña**
Te permite: cambiar la contraseña del propio administrador, indicando la nueva contraseña dos veces
(mínimo 6 caracteres); ver confirmación de éxito o el motivo del error.
No te permite: ninguna otra configuración por ahora — la página está pensada como el lugar donde
sumar más ajustes generales en el futuro, pero hoy solo contiene esto.
