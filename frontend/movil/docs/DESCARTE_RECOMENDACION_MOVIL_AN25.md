# AN-25 · Descartar recomendaciones desde móvil

## Qué entrega
La acción **"No me interesa"** en cada recomendación: pide el descarte al backend y quita la tarjeta de la lista.

## Dónde está el código
El descarte vive junto al resto de la pantalla (no tiene archivos propios):
| Archivo (`frontend/movil/src/screens/components/recomendaciones/`) | Qué hace |
|---|---|
| `useRecomendaciones.ts` → función `descartar` | Llama al backend y actualiza la lista. |
| `TarjetaRecomendacion.tsx` | Botón "No me interesa" (con indicador de carga). |
| `RecomendacionesContenido.tsx` | Conecta el botón con `descartar` y muestra el aviso de error. |
| `recomendaciones.test.tsx` | Pruebas del descarte. |

## Por dónde viaja
```
botón "No me interesa" → useRecomendaciones.descartar → shared/api/recomendaciones.ts
   → POST /recomendaciones/<id>/dismiss/ → gateway → servicio de análisis
```

## Reglas (lo que pide la tarjeta de Trello)
- **Se quita solo después del éxito.** La tarjeta no desaparece hasta que el backend confirma; no hay actualización "optimista" que deba revertirse.
- **Un error no borra nada vigente.** Si falla, la recomendación se queda, se muestra el aviso "No pudimos descartar la recomendación" y el botón sigue disponible para reintentar.
- **Request idempotente:** un doble toque manda una sola petición (candado `descartesEnCurso`); el endpoint tolera repetir el descarte.
- **No vuelve al refrescar:** "Actualizar" pide la lista de nuevo y muestra lo que el backend responde. Que lo descartado no regrese depende del backend (VI-18).
- Una respuesta que llega después de recargar o salir de la pantalla se ignora.

## Pruebas (`recomendaciones.test.tsx`)
- "No me interesa" quita la tarjeta cuando el backend confirma.
- Si falla el descarte, la tarjeta sigue y se avisa.
- Un doble toque manda una sola petición.
- "Actualizar" vuelve a pedir la lista y una recomendación descartada ya no aparece.

## Límites
- No se probó en dispositivo ni contra el backend desplegado.
