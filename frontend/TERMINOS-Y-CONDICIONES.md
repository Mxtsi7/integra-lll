# Términos y condiciones

## Qué hay
- Ruta pública `/terminos` (`TerminosPage`), fuera de las guardas de sesión: el registro la enlaza antes de que exista la cuenta. El enlace del registro ahora abre en pestaña nueva para no perder lo escrito en el formulario.
- El texto está en `web/src/contenido/terminos.ts` (separado de la página), con `VERSION_TERMINOS` y `FECHA_TERMINOS`. Para cambiarlo solo se edita ese archivo.

## Es un borrador, no asesoría legal
Lo redactó el equipo a partir de lo que hace la aplicación (cuentas, suscripciones, correo conectado, planes, eliminación de cuenta; esto último coincide con el diálogo de Eliminar cuenta). Antes de considerarlo definitivo hay que revisar y completar:
- Datos de contacto del responsable (no hay uno definido en el repo).
- Ley y jurisdicción aplicables, y plazos concretos de conservación (el texto dice "plazo limitado", igual que el diálogo de eliminar).
- Condiciones y precios del plan Premium.
- Si el equipo quiere una política de privacidad aparte.

## Pruebas
`TerminosPage.test.tsx`: título y versión, todas las secciones, eliminación de cuenta y Outlook, enlace de vuelta.
