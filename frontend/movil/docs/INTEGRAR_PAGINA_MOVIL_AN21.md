# AN-21 · Integrar la página móvil de Recomendaciones

## Qué entrega
La maqueta de AN-05 conectada a datos reales: lista, detalle, estados y actualización. Reemplaza el placeholder de `panel/RecomendacionesScreen.tsx`.

## Archivos (`frontend/movil/src/screens/`)
| Archivo | Qué hace |
|---|---|
| `panel/RecomendacionesScreen.tsx` | Coloca título, contenido y botón Volver. |
| `components/recomendaciones/RecomendacionesContenido.tsx` | Dibuja la lista y los estados; muestra la pantalla Premium si corresponde. |
| `components/recomendaciones/useRecomendaciones.ts` | Pide la lista y el detalle; guarda el estado. |
| `components/recomendaciones/reglasRecomendaciones.ts` | Valida la forma de la respuesta. |

## Por dónde viaja un dato
```
RecomendacionesScreen → RecomendacionesContenido → useRecomendaciones
   → frontend/shared/src/api/recomendaciones.ts → pedir() → gateway → servicio de análisis
```
| Acción | Endpoint |
|---|---|
| Listar | `GET /recomendaciones/` |
| Ver detalle | `GET /recomendaciones/<id>/explicar/` |

## Comportamiento
- **Respuesta vacía y fallo de API se distinguen.** Vacío muestra "No hay recomendaciones por ahora" con el motivo que escribe el backend; un fallo muestra error con "Reintentar".
- Una respuesta con forma desconocida cuenta como **error**, no como lista vacía.
- **Actualizar:** el botón vuelve a pedir la lista.
- **Plan Free:** el gateway responde 403 y la pantalla muestra "Las recomendaciones son Premium" con botón "Ver planes".
- **Respuesta tardía:** si se recarga o se sale de la pantalla, la respuesta vieja se descarta (`numeroDeCarga`).

## Pruebas
`recomendaciones.test.tsx`: lista con motivo y ahorro, vacío vs error, forma desconocida, 403 Premium, detalle (abrir, cerrar, datos insuficientes, reintento) y actualizar.

## Límites
- No se probó en dispositivo ni contra el backend desplegado.
- El descarte es la tarea AN-25 (`AN-25_DESCARTE_RECOMENDACIONES_MOVIL.md`).
