# AN-01 — Resumen de gasto del Panel móvil

**Responsable:** Andrea Travola · **Pantalla:** pestaña Panel (`PanelScreen`)

## Qué hace
Muestra el resumen de un mes con datos del backend (VI-06), no con la lista de Inicio:
- **Gastado** y **por cobrar** del mes, una tarjeta por moneda (CLP, USD…). Nunca se suman monedas distintas.
- **Cantidad de suscripciones** en total y por estado (activas, en prueba, por confirmar, canceladas, fantasma).
- **Selector de periodo** (‹ mes ›). No se avanza más allá del mes actual.
- Estados de carga, error con reintento y vacío (los comunes de AN-28).
- Al volver a la pantalla (por ejemplo después de crear una suscripción) se refresca sin vaciar las cifras.

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `shared/src/api/resumenPanel.ts` | `getResumenDelPeriodo(mes)`: pide una vez por moneda activa del catálogo y valida cada respuesta |
| `screens/panel/PanelScreen.tsx` | Solo coloca el contenido y los botones a Informes y Recomendaciones |
| `screens/components/resumen/ResumenPeriodoContenido.tsx` | Dibuja el selector, las tarjetas y el conteo (`variante="panel"`) |
| `screens/components/resumen/useResumenPeriodo.ts` | Carga, mes elegido y respuestas tardías |
| `screens/components/resumen/resumen.test.tsx` | Pruebas del Panel y del Informe |

## Cómo se conecta
`PanelScreen` → `ResumenPeriodoContenido` → `useResumenPeriodo` → `getResumenDelPeriodo` (shared) → `GET /api/suscripciones/resumen/?mes=YYYY-MM&moneda=XXX` (una vez por moneda) y `GET /api/catalogos/suscripciones/` (para saber las monedas).

## Contrato con el backend (VI-06)
Respuesta por moneda: `periodo`, `moneda`, `gasto_real`, `gasto_proyectado`, `total_estimado` (textos decimales) y `conteo_estados`.
La app rechaza (muestra error con reintento) una respuesta con un importe que no es número, de otro periodo o de otra moneda, o con un conteo incompleto. Nunca muestra NaN.

## Reglas
- Si falla la consulta de cualquier moneda, falla todo el resumen: mostrar solo una parte dejaría cifras incompletas sin avisar.
- Una respuesta de un mes que ya se dejó se descarta; al cambiar de mes no quedan las cifras del anterior.
- Una moneda sin gasto ni proyección se omite; sin ninguna, dice "Sin gastos registrados ni proyectados".

## Pendiente / límites
- La tarjeta de Trello coordina con "S3-VI-18 — gastos por período y moneda". Si ese endpoint se publica con otra ruta, solo cambia `getResumenDelPeriodo`.
- Se hace una consulta por moneda; con muchas monedas activas convendría un endpoint que las traiga juntas.
- No se ejecutaron tests, tipos ni lint donde se escribió el código; se corren en el repo (ver el PR).
- Falta que otra persona valide el contrato (criterio de la tarjeta).
