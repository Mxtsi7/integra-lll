# Captura y sincronización de uso

Completa la integración de S3-MX-08 y S3-MX-16–21 sobre el receptor v1 existente. Depende de [PR #234](https://github.com/Mxtsi7/integra-lll/pull/234). No cambia el contrato de eventos ni vuelve a implementar recepción, proyección o outbox.

| Tarjeta | Implementación |
| --- | --- |
| MX-08 / MX-16 | Cursor y eventos se confirman en la misma escritura durable antes de cualquier envío. Android usa doble buffer segmentado de SecureStore; MV3 usa una entrada de storage.local por cuenta, servidor y suscripción. |
| MX-17 | Se reutilizan el cliente autenticado, la renovación de sesión y enviarUsoPendiente. El navegador incorpora login y selección de suscripciones reales; Android usa sus asociaciones existentes. |
| MX-18 | Reintento progresivo con el mismo UUID y cuerpo; sólo un acuse válido retira el pendiente. Un 4xx permanente pausa y conserva el evento para diagnóstico; red, 5xx, 408, 429 y renovación temporal son recuperables. |
| MX-19 | Los intervalos se unen y separan por día de la zona del servidor, conservando milisegundos. Sin medición no significa cero. Última sincronización procede exclusivamente del acuse servidor. |
| MX-20 | Pausar detiene lecturas nuevas. Los pendientes anteriores pueden enviarse. Reanudar establece un cursor nuevo y excluye el período pausado. |
| MX-21 | Retirar bloquea y cancela el trabajo local antes de esperar la red, descarta pendientes y guarda una revocación por confirmar. Requiere otra aceptación explícita y otro UUID para volver a capturar. |

## Android

En Configuración, asociar primero un paquete con una suscripción propia. En Acceso de uso conceder el permiso del sistema y aceptar captura/sincronización de ese paquete. En esta entrega se autoriza un paquete a la vez; para cambiarlo se retira el anterior. El controlador se mantiene mientras está montado el flujo privado, consulta cada 30 segundos en primer plano y vuelve a intentarlo al activar la app. No implementa un servicio Android permanente.

UsageEvents permite recuperar desde el cursor persistido en ventanas de hasta 24 horas. Si el sistema ya no conserva eventos antiguos, la consulta vacía se envía como sin medición; no se inventa uso ni cobertura completa. Al perder permiso o cambiar la asociación se pausa la captura. El usuario debe revisar el permiso/asociación y reanudar explícitamente.

Se agregó expo-crypto en la versión compatible con Expo 57 para UUID. Hace falta reconstruir la compilación de desarrollo que ya incluye el módulo UsoAndroid; un paquete viejo o Expo Go no demuestra el flujo nativo. Tokens y cola quedan en SecureStore. Las entradas segmentadas mantienen cada fragmento bajo 2 KiB, guardan el manifiesto al final y verifican la identidad durante toda la escritura. Cerrar sesión purga ambos buffers, incluyendo fragmentos interrumpidos.

## Navegador

Instalar dependencias del workspace y compilar como indica [frontend/extension/README.md](../frontend/extension/README.md). El worker distribuido es dist/background.js. El servidor debe usar HTTPS y terminar en /api. La autenticación queda en el worker y los mensajes de control sólo se aceptan desde el popup propio.

Los permisos del servidor y de los dominios se piden de forma opcional. Elegir dominio y suscripción y aceptar explícitamente antes de observar. No se envían dominios, rutas, títulos, paquetes ni contenidos en el evento. La cola usa storage.local restringido a contextos confiables y particionado por servidor+usuario+organización+suscripción; las credenciales sólo usan storage.session.

La medición conserva el último minuto sin consolidar porque el aviso idle puede recortarlo retroactivamente. Sólo se convierten a eventos intervalos anteriores a ese margen. Suspensiones del worker, falta de foco y períodos sin observación se conservan como cobertura parcial/desconocida. Tras persistir cursores se retiran los tramos antiguos del buffer. Cerrar Chrome pierde el buffer todavía corregible y la sesión de login, pero conserva eventos ya durables. Otra cuenta nunca envía esos pendientes; la cuenta original debe iniciar sesión y volver a autorizar.

## Retiro y fallos

Revocar no borra el historial ya aceptado. Los pendientes locales se descartan por decisión explícita del usuario; si falla la red, la captura sigue detenida y queda una revocación pendiente para reintentar con la misma cuenta. Una aceptación antigua no puede deshacer un retiro posterior. El servidor serializa recepción y cambios de consentimiento mediante el mismo bloqueo.

Si el destino responde 404 al revocar, se completa únicamente el retiro local y se registra que la suscripción dejó de estar disponible; no se afirma que el servidor confirmó una revocación. Esto evita bloquear la selección de otra suscripción después de eliminar la anterior. Ese UUID local sigue deshabilitado.

Un error permanente conserva el evento y detiene reintentos automáticos para evitar saturar el receptor. La pantalla indica el rechazo: corresponde corregir la configuración/código, retirar esa autorización y obtener otra. No se altera silenciosamente el cuerpo de un evento que pudo haberse recibido antes.

## Validación

Se ejecutaron pruebas de contrato HTTP, cursor/cola/reinicio, caída de almacenamiento, conservación de UUID, acuse, corte diario, pausas, revocación en vuelo, cambio de sesión durante fragmentos y renovación temporal. Las pruebas de adaptadores usan dobles de red, Chrome y APIs nativas; no equivalen a ejecutar en un dispositivo o navegador real.

Se corrieron suites shared/móvil/extensión, typecheck del workspace, build web/extensión y lint de los archivos móviles modificados. El lint móvil completo tiene fallos anteriores en archivos ajenos a este cambio. El intento inicial de la suite frontend completa agotó memoria al paralelizar los workers; las suites se ejecutaron después por separado con concurrencia limitada.

Backend: pruebas dirigidas con SQLite, Django check y control de migraciones. No se ejecutaron PostgreSQL real, RabbitMQ, despliegue, compilación Android ni recorrido en hardware. La migración 0021 debe aplicarse antes de habilitar clientes. No se modificó Trello ni se mergearon PR.
