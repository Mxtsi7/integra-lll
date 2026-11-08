# Extensión de seguimiento — S3-MX-09 y S3-MX-10

Chrome/Edge de escritorio, Manifest V3, sin build ni dependencias. Carga esta carpeta
desde «Extensiones → Modo desarrollador → Cargar descomprimida». No es la app web.
Abre su botón, escribe dominios exactos (por ejemplo `netflix.com`), lee y marca el
consentimiento, pulsa Autorizar y acepta el permiso del navegador. Cambia de pestaña
y vuelve a abrir el panel para consultar el dominio autorizado.

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
volver → `activo`; esperar 60 s sin entrada o bloquear pantalla → `inactivo`;
volver a interactuar → se reevalúa dominio. Estos estados no significan uso cero.
API: [idle](https://developer.chrome.com/docs/extensions/reference/api/idle).

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
