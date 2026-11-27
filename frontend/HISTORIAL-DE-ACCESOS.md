# Historial de accesos (S3-AN-06)

## Qué hay
- Ruta `/configuracion/historial-accesos` (privada); el botón **Ver** de Ajustes lleva a ella.
- `obtenerHistorialAccesos()` (`shared/src/api/historialAccesos.ts`) llama `GET /api/usuarios/me/historial-accesos/?limit=20&offset=N` (servicio auth) y devuelve `{ accesos: [{ iniciadaEn, metodo }], siguienteOffset }`. `metodo` es `local` (contraseña) o `google`.
- Una respuesta con otra forma se trata como error, no como "sin accesos".
- La página muestra fecha y método, pide de 20 en 20 con **Cargar más** (usa `siguiente_offset`) y no acumula más de 100 en pantalla.
- Estados: cargando, error con **Reintentar**, vacío y lista. Si falla **Cargar más**, se conserva lo ya mostrado y se avisa.
- Una respuesta (inicial o de "Cargar más") que llega cuando ya cambió la sesión, o de una carga reemplazada, no se pinta.

## Límites (lo que el backend entrega)
- Solo `iniciada_en` y `metodo`: **no hay dispositivo ni ubicación**, por eso no se muestran.
- Las sesiones se conservan según la retención del backend (`limpiar_sesiones`, 7 días por defecto) y las anteriores a la migración no aparecen. La página lo dice con "Solo se muestran los inicios de sesión que conservamos".
- Pendiente: verificar contra el backend desplegado (no se ejecutó de punta a punta).

## Pruebas
- `historialAccesos.test.ts`: URL y paginación, conversión de nombres, respuestas con formato inesperado, errores.
- `HistorialAccesosPage.test.tsx`: lista, vacío, error y reintento, Cargar más (agrega, falla, doble clic), tope de 100, respuestas de otra sesión.
