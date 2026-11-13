# AN-05 · Maqueta de Recomendaciones móviles y detalle

## Qué entrega
La parte visual de la pantalla **Panel → Recomendaciones**: tarjetas, detalle desplegable y estados (varios resultados, vacío, error). Las props están definidas para que la integración con la API (AN-21) y el descarte (AN-25) se conecten sin tocar el diseño.

## Archivos (`frontend/movil/src/screens/`)
| Archivo | Qué hace |
|---|---|
| `components/recomendaciones/TarjetaRecomendacion.tsx` | Una tarjeta: nombre, categoría, motivo, ahorro estimado, botones "Ver detalle" y "No me interesa", y el detalle desplegable. |
| `components/recomendaciones/reglasRecomendaciones.ts` | `formatearAhorro` (muestra el ahorro en su moneda; sin ahorro no muestra nada) y `leerListaRecomendaciones`. |
| `components/recomendaciones/estilos.ts` | Paleta; reutiliza la de Perfil. |
| `components/estados/` (AN-28) | Cargando, error con reintento y vacío. |

## Props de la tarjeta (el contrato)
| Prop | Para qué |
|---|---|
| `recomendacion` | Los datos que llegan del backend (`id`, `nombre`, `categoria`, `motivo`, `ahorro_estimado`, `moneda`). |
| `detalle` | Estado del detalle (cargando / error / listo). Sin valor, está cerrado. |
| `estaDescartando` | Muestra el botón "No me interesa" en carga. |
| `onVerDetalle`, `onOcultarDetalle`, `onDescartar` | Acciones; la tarjeta no llama al backend. |

## Decisiones
- La tarjeta **no inventa datos**: si falta el ahorro o el motivo, no muestra nada en ese lugar.
- Con datos insuficientes, el detalle muestra el motivo que da el backend, nunca una cifra inventada.
- Una moneda desconocida no rompe la pantalla: se muestra el número con su código.
- Las pruebas de la parte visual están en `recomendaciones.test.tsx` (tarjetas, ahorro, detalle, datos insuficientes).

## Relación con otras tareas
AN-21 conecta esta maqueta con la API. AN-25 usa el botón "No me interesa". Documentos: `AN-21_INTEGRACION_RECOMENDACIONES_MOVIL.md`, `AN-25_DESCARTE_RECOMENDACIONES_MOVIL.md`.
