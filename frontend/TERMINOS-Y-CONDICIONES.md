# Términos y condiciones (S3-AN-08)

## Qué hay
- Ruta pública `/terminos` (`TerminosPage`), fuera de las guardas de sesión: el Registro la enlaza antes de que exista la cuenta.
- El enlace del Registro abre en **pestaña nueva** (`target="_blank"`, `rel="noopener noreferrer"`): quien se registra lee los términos y vuelve a la pestaña del formulario con lo escrito intacto. La página también ofrece "Volver a Ojo al Gasto".
- El texto está en `web/src/contenido/terminos.ts`, con `VERSION_TERMINOS` y `FECHA_TERMINOS`. Para cambiarlo solo se edita ese archivo.

## Aprobación (obligatoria antes de fusionar)
El texto lo redactó el equipo a partir de lo que hace la aplicación; **no es asesoría legal** y no se debe fusionar sin aprobación explícita de alguien del equipo en el PR.

- Aprobado por: _(pendiente)_
- Enlace a la aprobación: _(pendiente)_
- Versión aprobada: 1.0 (26 de noviembre de 2026)

## Para revisar o completar
- Datos de contacto del responsable (no hay uno definido en el repo).
- Ley y jurisdicción aplicables, y plazos concretos de conservación (el texto dice "plazo limitado", igual que el diálogo de Eliminar cuenta).
- Condiciones y precios del plan Premium.
- Si el equipo quiere una política de privacidad aparte.

## Pruebas
- `TerminosPage.test.tsx`: título y versión, todas las secciones, eliminación de cuenta y Outlook, enlace de vuelta.
- `register.test.tsx`: el enlace abre /terminos en pestaña nueva y no toca el formulario.
