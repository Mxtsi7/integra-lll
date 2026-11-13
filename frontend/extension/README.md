# Extensión de seguimiento — S3-MX-09 y S3-MX-10

Chrome/Edge de escritorio, Manifest V3, sin build ni dependencias. Carga esta carpeta
desde «Extensiones → Modo desarrollador → Cargar descomprimida». No es la app web.
Abre su botón, escribe dominios exactos (por ejemplo `netflix.com`), lee y marca el
consentimiento, pulsa Autorizar y acepta el permiso del navegador. El estado de
captura se actualiza automáticamente mientras el panel permanece abierto.

Estado vigente de la revisión del 13 de noviembre: #150 y #151 ya están
integradas en #149. La corrección y la recepción actuales se detallan al final;
las cifras y pendientes de las secciones fechadas anteriores son históricos.

Permisos: `storage` conserva configuración/observación en **storage.session**, no
historial duradero. Los hosts son opcionales y se solicitan individualmente desde
el botón; `https://*/*` es el conjunto solicitabile, no un permiso concedido al instalar.
No se pide `tabs`, historial, cookies, scripting ni se inyecta contenido.
Solo se acepta HTTPS con host exacto; subdominios se autorizan por separado.
No se observa incógnito, rutas, parámetros, títulos ni sitios no autorizados.

Retirar consentimiento elimina la sesión y los permisos de host. Reiniciar navegador
o recargar/deshabilitar la extensión elimina también storage.session: volver a aceptar.
No hay login, envío HTTP, cola offline ni historial productivo. No demuestra instalación
en un navegador real hasta que otra persona ejecute la comprobación siguiente.

## Comprobación reproducible

1. Instalar sin aceptar: estado sin consentimiento y sin dominio observado.
2. Autorizar `example.com`; abrir `https://example.com/?dato=privado`.
   Panel: `activo example.com`; storage.session no contiene URL ni `dato`.
3. Cambiar a un host distinto o `www.example.com`: sin dominio autorizado.
4. Retirar permiso en configuración del navegador: no debe observar el dominio.
5. Retirar consentimiento, recargar extensión y reiniciar navegador: exigir nueva aceptación.
6. Con dos ventanas ya abiertas y una pestaña fija en cada una: A=`example.com`,
   B=un host no autorizado. Cambiar A → B → A sin cambiar pestañas: el panel debe
   mostrar `example.com` → ningún dominio → `example.com`.
   Abrir el panel inmediatamente en B y mantenerlo abierto mientras termina la
   consulta: su estado de captura debe actualizarse sin cerrar/reabrir el panel.
7. Iniciar autorización y retirar mientras el permiso está pendiente; concederlo
   después: consentimiento retirado y sin permisos sobrantes. Solo una aceptación
   nueva puede reactivar. Repetir con una aceptación posterior del mismo host y
   de otro host: la limpieza antigua no debe quitar sus permisos.

Automatizadas: `npm test --prefix frontend/extension`.
Sintaxis: `npm run typecheck --prefix frontend/extension`.
Los dobles de API prueban lógica, no instalación ni compatibilidad real de Chrome/Edge.
Referencias: [permisos](https://developer.chrome.com/docs/extensions/reference/api/permissions),
[pestañas](https://developer.chrome.com/docs/extensions/reference/api/tabs),
[ciclo de vida](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Foco e inactividad — S3-MX-11 y S3-MX-12

El permiso `idle` detecta inactividad o pantalla bloqueada. Umbral de esta entrega:
60 segundos sin entrada; es una decisión técnica local, no un plazo de retención.
`windows.onFocusChanged` suspende la observación si ninguna ventana tiene foco.
Al recuperar foco o actividad se consulta de nuevo la pestaña activa; el tramo
anterior no se considera actividad durante el hueco. No se usa `setInterval`
para mantener vivo el worker. El cómputo de minutos corresponde a S3-MX-13.
Prueba manual pendiente: autorizar dominio, cambiar a otra aplicación → `sin_foco`;
volver → `activo`; esperar 60 s sin entrada → `inactivo`; bloquear pantalla → `bloqueado`;
volver a interactuar → se reevalúa dominio. Estos estados no significan uso cero.
API: [idle](https://developer.chrome.com/docs/extensions/reference/api/idle).

## Correcciones de la revisión #149

La autorización usa un ID de intento guardado por el worker en `storage.session`.
Retirar borra ese intento junto con el consentimiento. Una concesión tardía no
puede guardar configuración sin un intento vigente; sus permisos sobrantes se
retiran, preservando los hosts de una aceptación nueva o todavía en curso.
El intento se prepara al editar dominios o marcar consentimiento. Autorizar se
habilita solo después del acuse del worker, cuando cualquier limpieza previa ya
terminó. Su clic solicita permisos de inmediato, sin esperar mensajes dentro del
gesto. Así una limpieza antigua no puede quitar una concesión nueva cuyo registro
todavía estaba encolado. La generación del popup impide también que una operación
antigua reemplace el mensaje de estado de una aceptación posterior.

El estado de captura del panel recibe cambios de `storage.session.observacion`
mientras está abierto. Se presenta separado de los mensajes de autorización y
error, y actualizarlo no reescribe los dominios que el usuario está editando.
La suscripción se registra antes de leer el estado inicial; una lectura inicial
demorada no puede reemplazar un cambio más reciente que ya se mostró.

`windows.onFocusChanged` reconsulta la pestaña de la última ventana enfocada
por su ID. El test integrado de popup/worker comprueba A → B → A y que A deja
de figurar activo al pasar a B. Estos cambios no añaden el motor temporal de
S3-MX-13: el cierre de intervalos y minutos corresponde a la [PR #151](https://github.com/Mxtsi7/integra-lll/pull/151).
Las PR sucesoras deben incorporar estas correcciones y comprobar el recorrido
integrado antes de dar por cerrado ese comportamiento; no basta su código histórico.

### Evidencia de esta corrección — 9 de noviembre de 2026

| Comprobación | Resultado |
| --- | --- |
| Tres regresiones principales contra la implementación anterior | Fallaron: reactivación tardía, reemplazo de sesión nueva y dominio A retenido en B |
| Suite de extensión con módulos reales y dobles de API/DOM | 16/16 aprobadas; incluye las regresiones de autorización anteriores y panel abierto durante consulta/lectura inicial demoradas, sin sobrescribir la edición |
| Sintaxis de los módulos | Aprobada con el comando indicado arriba |
| Recorrido interactivo en Chrome/Edge de esta corrección | Pendiente: no hay navegador local instalado; descarga de Chromium falló con ZIP truncado (`End of central directory record signature not found`) |
| Validación de consentimiento S3-MX-02 | Pendiente en [PR #148](https://github.com/Mxtsi7/integra-lll/pull/148), por Victor y Chris; no se sustituye por estas pruebas |
| Evidencia integrada de cierre temporal del tramo anterior | Pendiente de ejecutar con el motor de S3-MX-13, tras incorporar las correcciones de esta base |

No cerrar S3-MX-09/10 por estas pruebas automatizadas. Adjuntar navegador/versión,
commit probado, pasos, resultado real y evidencia visual o registro del recorrido
1–7, además de las validaciones anteriores. Una carga descomprimida informada para
un HEAD anterior no demuestra el recorrido interactivo de esta corrección.

## Retirada — corrección de revisión del 9 de noviembre de 2026

Al confirmar la retirada, el panel sustituye el mensaje anterior por
«Consentimiento retirado. Sesión borrada.». Se conserva la comprobación de
generación para no sobrescribir una selección posterior. Regresión de preparación
y autorización activas: fallaba antes y pasa tras el cambio; suite 17/17.
El recorrido interactivo completo y las validaciones de consentimiento siguen pendientes.

## Pausas pendientes — corrección de revisión

Foco e idle conservan la pausa y su instante al recibir el evento, antes de esperar
la cola. Recuperar actividad reconsulta la pestaña. Una consulta iniciada antes de
la pausa no desplaza su instante al finalizar. Precedencia: bloqueo, ausencia de
foco, inactividad, dominio. Los eventos de bloqueo conservan su estado aunque no
haya foco. Regresiones de consulta pendiente, pausa de 7 s e idle/bloqueo: 23/23.
Pruebas con módulos reales y dobles de API; recorrido interactivo pendiente.

## Sesiones y asociación — S3-MX-13 y S3-MX-14

El panel muestra minutos de esta sesión, calculados en milisegundos y sin redondear
cada tramo. Cada cambio de dominio, foco o actividad cierra el tramo previo.
Una alarma de 30 s confirma el avance y permite recuperar el estado al reiniciar
el worker. Un hueco mayor a 45 s o reloj hacia atrás corta en la última observación:
no se cuentan sueño del equipo ni huecos desconocidos como uso. Al detectar `idle`,
se descuenta su umbral de 60 s del tramo abierto. La resolución depende de eventos
del navegador, no demuestra atención humana ni reproduce estadísticas de Android.

Intervalos UTC con origen y fin; el total se muestra por dominio para toda la sesión,
sin agrupar por día local. Conservar intervalos evita perder cruces de medianoche;
la agrupación local corresponde al contrato de Analytics. Máximo 500 tramos cerrados:
al alcanzar el límite se detiene el cómputo y se muestra `limite_de_sesion`, sin truncar
datos silenciosamente. Retirar y luego aceptar borra esta medición temporal;
editar dominios conserva la sesión y cierra el tramo si cambia su asociación.
Los permisos de hosts eliminados se retiran al actualizar la selección.
No es la cola durable de S3-MX-16 ni un acuse de sincronización de S3-MX-19.

Asociaciones opcionales, una por línea: `example.com=UUID-de-suscripcion`.
Hostname en minúsculas, sin punto final; **no** se eliminan `www` ni subdominios.
Cada subdominio necesita su autorización y asociación explícita. Se rechazan UUID
inválidos, hosts no autorizados y duplicados. No se infiere proveedor por semejanza.
Sin asociación puede verse actividad local, pero no debe convertirse en evento de
una suscripción. El futuro envío autenticado debe validar pertenencia en servidor;
este editor local no prueba que el UUID sea propio. S3-MX-15 añadirá selección real.

Prueba manual pendiente: autorizar dos dominios, permanecer 35 s en uno, cambiar al
otro, perder foco y regresar; contrastar tiempos con reloj, excluir el hueco. Dejar
60 s sin interacción y comprobar descuento, reiniciar worker, recargar extensión,
verificar que solo este último borra la sesión. Revisar asociaciones en storage.session.


## Integración de la base y revisión de sesiones

Se conservan los intentos de autorización, la retirada segura, el panel vivo y las
pausas con instante de la base corregida. Las asociaciones se validan y quedan
vinculadas al intento antes de habilitar Autorizar; editar conserva la sesión.
El panel actualiza los minutos sin reabrirse. Un error de consulta también corta
el motor en la última confirmación, sin contar el hueco al recuperar.
El descuento idle recorta tanto el tramo abierto como las sesiones cerradas que
se superponen a su umbral: cambiar automáticamente de dominio no conserva uso
inactivo. Suite integrada: 34/34; incluye 12 s de recorrido menos 7 s sin foco
= 5 s, cambio de asociación sin mezclar destinos y los errores reales del worker.
Son dobles de API/DOM. Chrome 156 headless no permitió abrir el panel de la
extensión (ERR_BLOCKED_BY_CLIENT); no se acredita recorrido interactivo real.
Persisten los acuerdos de Victor/Chris y las tareas posteriores de selección real,
cola durable y sincronización. No se añade envío HTTP ni historial persistente.

## Navegación y pausas — revisión del plan del 9 de noviembre de 2026

Reevaluar la pestaña activa no depende de que Chrome incluya la URL en el evento.
Durante status=loading se publica navegando sin dominio: Tab.url puede seguir
siendo la última URL confirmada. Se vuelve a evaluar cualquier actualización de
la pestaña activa y se consulta exclusivamente la ventana enfocada. Volver a un
host autorizado tras completar la navegación recupera activo. No cambian permisos.
Las regresiones cubren A autorizado → B sin URL/permiso con carga pendiente,
la URL anterior durante loading, commit sin URL y regreso; otra ventana cargando
no debe pausar la enfocada. Las pruebas usan módulos reales y dobles de Chrome/DOM.

Recorrido real: se cargó la extensión de trabajo y abrió su panel en Chrome
156.0.8078.75, perfil aislado, sin sembrar consentimiento. El usuario confirmó
aceptar el permiso solicitado para example.com. Antes de verificar navegación,
foco e inactividad, Computer Use se detuvo porque no pudo identificar la URL de
la ventana con suficiente certeza. No se acredita el recorrido completo, ni la
versión final corregida en Chrome, ni ejecución en Edge. Estas comprobaciones
siguen pendientes, al igual que los acuerdos de consentimiento de Victor/Chris.

Verificación ampliada: 39 pruebas de extensión. La integración alterna ventanas y pausas y obtiene tramos [0,2000), [9000,12000), [16000,19000), total 8000 ms, sin solapamiento ni tiempo suspendido. Las pausas explícitas no consultan pestañas. Mantener secuencia #149 → #150 → #151.


Suite completa final: 1038/1038 (268 shared, 581 web, 146 móvil, 4 desktop, 39 extensión), tipos y build web aprobados. En el primer intento fallaron dos casos existentes de PerfilPage.test.tsx: guarda con PATCH (timeout 5000 ms) y Cancelar (no encontró Editar nombre). El segundo intento de la suite completa pasó sin cambios en web; se registra la incidencia y no se modifica ese alcance.


## Observaciones pendientes — corrección del 10 de noviembre de 2026

Una pausa explícita conserva el estado y el instante recibidos. Una reconsulta
solo publica si ninguna actualización posterior la superó; se fecha al completar
las lecturas, no al evento que la encoló. Esto se comprueba otra vez tras leer la
medición al registrar un error. Descartar una lectura no reconstruye actividad
histórica ni rellena intervalos que no se pudieron observar.

Regresiones: A → pausa → reanudación A → B con cola ocupada asigna B a [11000,13000),
solo 2000 ms; idle en 62000 conserva corte en 2000, sin retroceder al evento de
reconsulta de 61000; lectura vigente iniciada en 1000 y completada en 5000 se fecha
en 5000. Errores superados se descartan, también si esperan la medición: se conserva
el tramo válido [0,2000). La regresión original de 12 s menos 7 s de pausa sigue
produciendo 5 s. No se cambian permisos, contratos HTTP ni política de retención.
Las cinco regresiones fallaban contra el código anterior y pasan tras corregirlo.

popup.test.js termina en un único salto de línea. Comprobación de espacios con
Git y EOF sin errores. La extensión tiene 31 pruebas en #150 y 44 en #151.

Verificación final: frontend completo 1043/1043 con VITEST_MAX_THREADS=1, VITEST_MIN_THREADS=1, VITEST_MAX_FORKS=1 y VITEST_MIN_FORKS=1; sin modificar configuración del repositorio. Dos intentos paralelos anteriores tuvieron fallos en RutaPrivada, AlertasPage, SuscripcionDetallePage, CalendarioPage e ImportacionPage.sesion, timeouts y un worker terminado; se registran junto a errores de memoria del entorno. Tipos y build web aprobados. Recorrido real final Chrome/Edge pendiente: se verificaron cargas de copias de trabajo y permisos, pero Chrome desactivó la extensión al recargar y la sesión posterior perdió su permiso temporal. No cerrar tarjetas ni declarar validación interactiva completa.

## Corte de navegación conservado — 13 de noviembre de 2026

Corrección sobre `5ab954b` en la rama `Maxi-extension-y-dominios` de #149.
Los eventos de activación, inicio de carga, cambio de URL o cierre llevan solo
el tipo y los IDs de pestaña/ventana. El controlador conserva su instante antes
de esperar la cola y aplica el corte aunque una reconsulta posterior sustituya
la lectura. El corte se filtra contra la identidad de la observación guardada
en `storage.session`; una pestaña ajena o una actualización de metadatos no
fragmenta el tramo enfocado. No se guardan URLs ni se amplían permisos.

El corte publica `navegando` sin dominio antes de consultar el destino. La
reanudación usa el instante de comprobación del dominio, conservando
`esVigente`: ninguna lectura superada puede reconstruir actividad histórica.
El motor de #151 recibe así una pausa antes de la siguiente observación activa.

Regresión integrada: `node --test test/navegacion.test.js` desde esta carpeta.
Usa el worker, controlador, observador y medición reales, con APIs de navegador
y reloj simulados. Cubre navegación sin URL y cambio de pestaña, sin demora,
con lectura de ventana pendiente desde la transición y con otra lectura ya
pendiente antes de recibirla. Expectativa fija en las seis variantes:
`example.com=[0,2000)` y `[7000,9000)`, total **4000 ms**, dos tramos.
También comprueba el tramo cerrado antes de esperar el destino, eventos ajenos
y reanudación demorada a 8000: `[0,2000)` y `[8000,9000)`, sin rellenar el hueco.

Contra el código de `5ab954b`, las cuatro variantes demoradas fallan; los dos
controles sin demora pasan. El archivo externo
`repro-pr149-5ab954b-navegacion.mjs` citado en la revisión no está disponible
en este checkout: la prueba integrada reproduce su secuencia y expectativas,
sin afirmar que se ejecutó aquel archivo original.

Validación local: **52/52** pruebas de extensión, sintaxis de los seis módulos
y `git diff --check` aprobados. Se conservan las 44 regresiones anteriores,
incluidas URL anterior durante loading, URL oculta, autorización/retirada,
panel, pausas, B=[11000,13000), idle y errores superados. La revisión técnica
adicional no encontró defectos; no sustituye la recepción humana de las tarjetas.

### Recepción y dependencias vigentes

- #150 y #151 ya están integradas en #149; no requieren otra integración previa.
- #148 está cerrada sin merge. Su propuesta contractual fue sustituida en
  [#165](https://github.com/Mxtsi7/integra-lll/pull/165), de Víctor. Se verificó
  la [aprobación de Mxtsi7 del 11 de noviembre](https://github.com/Mxtsi7/integra-lll/pull/165#pullrequestreview-5866593924).
  El 13 de noviembre Maxi confirmó que ambos acordaron esa entrega y está lista
  para merge. #165 sigue abierta, sin merge, HEAD `383406c`; esta corrección
  no la fusiona ni presenta su contrato como integrado en main.
- Ese acuerdo de contrato no acredita por sí solo la validación específica de
  consentimiento, datos recolectados y conservación de **MX-02**. La tarjeta
  [enlazada por MX-09](https://trello.com/c/QfDxfiwZ) debe aclararse al recibir
  esa entrega; no se asume aceptada por el cierre de #148. No hay evidencia
  adicional de validación de consentimiento de Chris en esta sesión.
- El recorrido completo del README en Chrome/Edge y la recepción de
  consentimiento siguen siendo condiciones de cierre. La instalación y
  solicitud de permiso comprobadas con navegador headless se registran aparte
  de las regresiones con dobles; una solicitud pendiente no demuestra concesión,
  navegación consentida ni tiempos reales. No cerrar MX-09/MX-10 por la suite.
