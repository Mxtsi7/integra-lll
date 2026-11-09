# Extensión de seguimiento — S3-MX-09 y S3-MX-10

Chrome/Edge de escritorio, Manifest V3, sin build ni dependencias. Carga esta carpeta
desde «Extensiones → Modo desarrollador → Cargar descomprimida». No es la app web.
Abre su botón, escribe dominios exactos (por ejemplo `netflix.com`), lee y marca el
consentimiento, pulsa Autorizar y acepta el permiso del navegador. El estado de
captura se actualiza automáticamente mientras el panel permanece abierto.

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

Verificación ampliada: 27 pruebas de extensión, incluidas pausas explícitas sin consultar pestañas ni ventanas. La base #149 corregida se incorpora antes de esta entrega.

