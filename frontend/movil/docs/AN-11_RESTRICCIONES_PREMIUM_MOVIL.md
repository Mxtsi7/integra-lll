# AN-11 · Restricciones Premium móviles

## Qué entrega
- La pantalla **Configuración → Restricciones Premium**: lista cada función Premium y si el plan de la persona la incluye, con el botón «Ver planes».
- El componente reutilizable **`BloqueoPremium`**: se pone alrededor de cualquier botón o sección Premium y la reemplaza por un aviso cuando el plan no la incluye.

## Archivos (`frontend/movil/src/screens/`)
| Archivo | Qué hace |
|---|---|
| `configuracion/RestriccionesPremiumScreen.tsx` | Solo coloca el contenido; «Ver planes» navega a Planes. |
| `components/planes/RestriccionesPremiumContenido.tsx` | La lista de funciones y su estado. |
| `components/planes/BloqueoPremium.tsx` | El componente reutilizable de bloqueo. |
| `components/planes/usePermisosPlan.ts` | Lee los permisos del servidor y expone `estaPermitida`. |
| `components/planes/reglasPlanes.ts` | `leerPermisos`, `incluyeFeature` y los nombres de las funciones. |
| `components/planes/planes.test.tsx` | Pruebas (compartidas con AN-08). |

## Por dónde viaja un dato
```
RestriccionesPremiumScreen → RestriccionesPremiumContenido → usePermisosPlan → shared/api/planes.ts → GET /usuarios/me/permisos/
```
El servidor responde `{ plan, features: { asistente_financiero, recomendaciones_automaticas } }`.

## Cómo se usa `BloqueoPremium`
```tsx
const { estado, cargar } = usePermisosPlan();

<BloqueoPremium
  permisos={estado}
  feature="asistente_financiero"
  onVerPlanes={() => navigation.navigate('Planes')}
  onReintentar={() => void cargar()}
>
  <BotonDelAsistente />
</BloqueoPremium>
```
Este es el contrato que se entrega al compañero que lo integre en otras pantallas.

## Reglas (criterios de la tarjeta)
- **Estado desconocido = no autorizado.** Mientras se confirma el plan, si falla la consulta, o si la respuesta tiene una forma rara, la función se muestra bloqueada. Solo un `true` explícito del servidor la habilita.
- **Free y Premium ven lo que dice la API:** se usa la misma respuesta que usa el gateway para decidir (`/usuarios/me/permisos/`). Se vuelve a leer cada vez que se abre la pantalla.
- **El bloqueo visual no reemplaza el del backend.** Quitar el bloqueo en la app no daría acceso a nada: el gateway responde 403 a un plan gratuito en las rutas Premium (por ejemplo, Recomendaciones).
- El estado no depende solo del color: cada función dice "Disponible" o "Requiere Premium" con texto y símbolo.

## Límites
- Por ahora `BloqueoPremium` se entrega listo y probado, y lo usa la pantalla de Restricciones. Envolver con él los botones de otras pantallas (por ejemplo, el asistente cuando exista) se hace en la tarjeta de cada pantalla.
- Solo existen dos funciones Premium: `asistente_financiero` y `recomendaciones_automaticas`. Si el backend agrega otra, hay que sumarla a `NOMBRES_FEATURES` y `FEATURES` en `reglasPlanes.ts` (el compilador avisa porque `NOMBRES_FEATURES` es un `Record` completo).
- No se probó en dispositivo.
