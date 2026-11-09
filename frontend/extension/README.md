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
6. Con dos ventanas ya abiertas y una pestaña fija en cada una: A=`example.com`,
   B=un host no autorizado. Cambiar A → B → A sin cambiar pestañas: el panel debe
   mostrar `example.com` → ningún dominio → `example.com`.
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
| Suite de extensión con módulos reales y dobles de API/DOM | 14/14 aprobadas; incluye aceptación nueva pendiente, limpieza antigua detenida dentro de `permissions.getAll()` y retirada lenta sin borrar una selección posterior |
| Sintaxis de los módulos | Aprobada con el comando indicado arriba |
| Recorrido interactivo en Chrome/Edge de esta corrección | Pendiente: no hay navegador local instalado; descarga de Chromium falló con ZIP truncado (`End of central directory record signature not found`) |
| Validación de consentimiento S3-MX-02 | Pendiente en [PR #148](https://github.com/Mxtsi7/integra-lll/pull/148), por Victor y Chris; no se sustituye por estas pruebas |
| Evidencia integrada de cierre temporal del tramo anterior | Pendiente de ejecutar con el motor de S3-MX-13, tras incorporar las correcciones de esta base |

No cerrar S3-MX-09/10 por estas pruebas automatizadas. Adjuntar navegador/versión,
commit probado, pasos, resultado real y evidencia visual o registro del recorrido
1–7, además de las validaciones anteriores. Una carga descomprimida informada para
un HEAD anterior no demuestra el recorrido interactivo de esta corrección.
