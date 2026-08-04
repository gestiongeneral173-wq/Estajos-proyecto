# Análisis Comparativo — Cambios propuestos para el Panel Central

Compara el documento de cambios recibido (`cambios en la central.md`) contra el estado real del
código en `src/pages/central/` y `src/components/forms/central/` al día de hoy. Es solo análisis —
**ningún cambio fue implementado todavía**. Sirve de base para planificar el trabajo antes de tocar
código.

Por cada punto se indica: qué pide el documento de cambios, qué hay hoy en el código, y qué tan
grande es la brecha entre uno y otro.

---

## Escanear

**Pide:** eliminar el escaneo de QR y dejar solo el buscador por nombre/teléfono como forma de
llegar a un trabajador.

**Hoy:** el escáner de cámara (librería `html5-qrcode`) vive integrado en la misma pantalla, al lado
del buscador — ambos caminos llevan a la misma función de carga del trabajador.

**Brecha:** baja en código (quitar el bloque de cámara y el botón "ESCANEAR QR"), pero con un efecto
en cadena a confirmar — ver Pregunta abierta 1.

---

## Reporte Diario

**Pide:** marcar con la etiqueta "Chófer" a la fila del empleado que manejó la furgoneta ese día,
dentro de cada grupo de jornadas.

**Hoy:** `getJornadasDelDia` (en `records.js`) solo trae `jornada_empleado` con datos de empleado,
vehículo y encargado — no incluye quién fue el chofer. El dato sí existe en el sistema: al asignar
plazas del día, `asignarPlazasYChofer` (en `choferes.js`) ya guarda `empleado_chofer_id`.

**Brecha:** media — hay que extender la consulta para traer también el chofer de cada grupo y pintar
la etiqueta en la fila correspondiente. No es un dato nuevo, solo no está expuesto en esta pantalla
todavía.

---

## Resumen

**Pide:** que todo lo que hoy existe para el pago de empleados (generar lista de pago, historial de
listas, cancelar/ocultar una lista, planilla imprimible) exista también para furgonetas, en la misma
página pero identificado aparte visualmente. El selector Quincenal/Mensual no aplica al bloque de
furgonetas porque las furgonetas pasan a ser siempre quincenales.

**Hoy — lo que YA está cubierto:**
- El candado de "ciclo a pagar" para vehículos (`getCicloActivoAPagarVehiculo`).
- El resumen de totales por vehículo (`getResumenPagosVehiculos`), ya en su propia tarjeta separada
  de la de empleados.
- La alerta y confirmación de "ciclo completado" para vehículos (`getCicloPendienteDeConfirmarVehiculo`,
  `confirmarCicloPagadoVehiculo`) ya están implementadas y funcionando igual que para empleados.

**Hoy — lo que NO existe:**
- Todo el módulo `paymentLists.js` (generar lista, listar historial, ver ítems, cancelar, ocultar)
  está escrito exclusivamente para empleados. No hay ningún equivalente para furgonetas.

**Brecha:** alta — es el bloque de mayor esfuerzo de todo el pedido. Requiere una funcionalidad
nueva de punta a punta: selección de furgonetas con saldo pendiente → captura del nombre de quien
reparte el efectivo → generar y pagar de inmediato → historial reimprimible y cancelable — simétrica
a la que ya existe para empleados, pero operando sobre vehículos.

---

## Registros (antes "Trabajadores")

**Pide varias cosas:**

1. **Eliminar el PIN de autoregistro** (botón "AUTORIZAR NUEVOS REGISTROS" y su modal).
   **Hoy:** existe y depende de un flujo completo del lado del empleado (`FormRegistroConPin.jsx`,
   pantalla de "introducir PIN") para darse de alta solo.
   **Brecha:** el cambio en Central es simple (quitar botón y modal), pero **no es un cambio aislado
   de Central** — deja huérfano el flujo de autoregistro del empleado. Hay que decidir qué pasa con
   esa pantalla antes de tocar esto (ver Pregunta abierta 2).

2. **Campo "apellido" en el alta de trabajador.**
   **Hoy:** ya existe — `FormTrabajador.jsx` ya separa Nombre y Apellido en dos campos y los combina
   en un solo `nombre` para el resto del sistema.
   **Brecha:** ninguna, ya está implementado.

3. **Campo "cuenta" (cuenta bancaria en texto).**
   **Hoy:** no existe en ningún formulario ni en la ficha del trabajador.
   **Brecha:** baja-media — campo nuevo de texto libre, hay que sumarlo al formulario de alta, a la
   edición y a la cabecera del Detalle de Trabajador.

4. **Campo "número".**
   **Hoy:** no está claro si se refiere al teléfono (ya existente) renombrado, o a un campo distinto.
   **Brecha:** depende de la respuesta — ver Pregunta abierta 3.

5. **"Configurar temporales" pasa a ser solo informativo** ("Ver temporales"): sin tarifa
   configurable, sin cálculo de "Pagado" — el encargado solo anota horas y destajo como dato, sin que
   el sistema calcule nada.
   **Hoy:** el modal calcula "Pagado" (horas × tarifa + destajo) y tiene una tarifa configurable
   (`getConfiguracionTemporal` / `actualizarTarifaTemporal`).
   **Brecha:** media — hay que quitar la tarifa y el cálculo, y confirmar que ningún otro lado del
   sistema (Resumen, listas de pago) llegue a sumar temporales en algún total antes de tocarlo (por
   lo revisado hasta ahora, Resumen no los mezcla, pero falta confirmarlo a fondo).

6. **Quitar el filtro "Encargados"** del listado (quedan Todos/Mensual/Quincenal).
   **Hoy:** el filtro existe como cuarta opción.
   **Brecha:** baja. El toggle de "Rol de Encargado" dentro del Detalle del trabajador no se menciona
   en el documento de cambios, así que se asume que sigue igual — solo desaparece el filtro de la
   lista.

---

## Detalle de Trabajador

**Pide:** agregar el campo "cuenta" (mismo campo nuevo del punto anterior) a la cabecera y a la
edición; renombrar "tipo de pago" a "tipo de ciclo".

**Hoy:** no existe el campo cuenta; el término usado en toda la pantalla es "tipo de pago".

**Brecha:** baja — es una extensión de formulario ya conocida (mismo patrón que otros campos
editables) más un cambio de etiqueta de texto.

---

## Vehículos

**Pide:** las furgonetas pasan a ser **siempre quincenales**, nunca mensuales — el tipo de pago deja
de ser una opción tanto al crear como al editar un vehículo.

**Hoy:** `tipo_pago` es un selector libre (quincenal/mensual) en alta y edición, con toda una lógica
de "cambio pendiente que se aplica recién en el próximo pago" (`tipo_pago_pendiente`,
`promoverTipoPagoPendienteVehiculo`).

**Brecha:** media — quitar el selector es simple, pero además simplifica (o vuelve innecesaria) la
lógica de "pendiente" para vehículos, que hoy existe solo para permitir ese cambio de tipo.

**Punto a confirmar:** en la descripción nueva de la tarjeta del vehículo (y también en su Detalle) ya
no se menciona el PIN actual ni el botón de rotarlo, cosas que hoy sí forman parte de la tarjeta. No
parece ser intención eliminar el sistema de PIN (es lo que usa el Encargado para entrar a operar una
furgoneta, un subsistema aparte de Central), pero como desaparece de la descripción en los dos
lugares donde antes aparecía, conviene confirmarlo antes de asumir que no cambia (ver Pregunta
abierta 4).

---

## Detalle de Vehículo

**Pide:** lo mismo que Vehículos respecto al tipo de pago — deja de ser editable (siempre quincenal);
terminología "tipo de ciclo"; cabecera más simple (sin mención al PIN actual).

**Hoy:** `tipo_pago` es editable con la misma lógica de "pendiente" mencionada arriba.

**Brecha:** baja-media, en línea con lo descrito para Vehículos — no hay cambios de fondo adicionales
más allá de eso.

---

## Configuración

Sin cambios respecto al documento original.

---

## Preguntas abiertas antes de implementar

1. **QR en Escanear** — ¿se elimina por completo el escaneo de cámara, o deja de ser la opción
   principal pero sigue disponible? Si se elimina del todo, ¿qué pasa con la pantalla del empleado que
   muestra su propio código QR (`TrabajadorQRPage`)? Hoy no tendría para qué existir si Central ya no
   lo lee.

2. **PIN de autoregistro** — si Central deja de generar códigos, ¿el flujo de autoregistro del lado
   del empleado (`FormRegistroConPin`) se elimina también, o los trabajadores nuevos de ahora en más
   solo se dan de alta manualmente desde Central?

3. **Campo "número"** — ¿es el teléfono ya existente renombrado, o un campo nuevo y distinto (por
   ejemplo, un número de empleado)?

4. **Temporales informativos** — ¿la tarifa de temporales desaparece del todo (se borra también la
   configuración guardada), o solo deja de mostrarse/usarse desde Central?

5. **PIN de furgoneta** — ¿sigue existiendo la rotación y visualización del PIN en Vehículos y en su
   Detalle, o el documento también está pidiendo quitarla de ahí?

## Resumen de esfuerzo

El bloque de mayor esfuerzo, con diferencia, es la **lista de pago para furgonetas** en Resumen — es
una funcionalidad nueva de punta a punta, sin ningún punto de partida hoy en el código, simétrica a
la que ya existe para empleados. El resto de los cambios son extensiones de formulario, cambios de
etiquetas/terminología, o simplificaciones de un selector ya existente — de esfuerzo bajo a medio.
