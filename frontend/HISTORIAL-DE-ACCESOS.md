# Historial de accesos (S3-AN-06)

## Qué hay
- Ruta `/configuracion/historial-accesos` (privada) y el botón **Ver** de Ajustes, que antes estaba deshabilitado, ahora lleva a ella.
- `HistorialAccesosPage` recibe `cargarAccesos?: () => Promise<AccesoRegistrado[]>`.
  - **Sin `cargarAccesos`** (hoy): dice "Esta función todavía no está disponible". No muestra accesos de ejemplo.
  - **Con él**: estados cargando / error con "Reintentar" / vacío / lista (máximo 50 y avisa si hay más).
  - Una respuesta que llega cuando ya cambió la sesión, o de un intento reemplazado, no se pinta.

## Pendiente
- **No existe el endpoint** de historial de accesos en el backend; nadie lo tiene asignado. `AccesoRegistrado` (`id`, `fecha`, `dispositivo`, `ubicacion?`, `actual?`) es un contrato **provisional**: quien cree el endpoint debe ajustarlo.
- Para conectarlo: crear la función en `shared` (con `pedir`), y pasarla como `cargarAccesos` en la ruta de `App.tsx`. No hay que tocar la página.

## Pruebas
`HistorialAccesosPage.test.tsx`: sin endpoint, lista y sesión actual, vacío, error y reintento, tope de 50, respuesta de otra sesión.
