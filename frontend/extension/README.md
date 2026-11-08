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
