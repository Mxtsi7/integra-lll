

## Qué hace
La pantalla `AlertasScreen` deja de ser un placeholder. Muestra:
- Un badge "N sin leer".
- La lista de alertas (título, mensaje, tipo, fecha). Las pendientes llevan la etiqueta "Nueva".
- Filtros "Todas" / "Sin leer".
- Botón "Marcar como leída" por alerta y "Marcar todas como leídas".
- Botón "Ver más alertas" (10 por página).
- Estados de carga, error con reintento y vacío, con los componentes comunes de AN-28 (`ContenidoConEstado`).

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `screens/configuracion/AlertasScreen.tsx` | Solo coloca el título, el contenido y el botón Volver |
| `screens/components/alertas/CentroAlertas.tsx` | Dibuja el badge, la lista y los botones |
| `screens/components/alertas/AlertaItem.tsx` | Una tarjeta de alerta |
| `screens/components/alertas/estilos.ts` | Paleta (la misma de Perfil) |
| `screens/components/alertas/alertas.test.tsx` | 14 pruebas |

## Cómo se conecta
`AlertasScreen` → `CentroAlertas` → `useAlertas` (AN-24) → `@ojoalgasto/shared` (`getAlertas`, `getContadorAlertas`, …) → gateway → servicio de notificaciones.

## Props
`CentroAlertas({ api? })`: `api` solo se pasa en pruebas para reemplazar las llamadas al backend.

## Criterios de aceptación
- Lista larga y vacío: cubiertos por paginación y `EmptyState` ("No tienes alertas").
- Navegación y accesibilidad: el botón Volver y los botones tienen rol y texto; el error usa `accessibilityRole="alert"`.
- La pantalla no inventa alertas: sin backend muestra el error con reintento.

## Pendiente / límites
- Tests, tipos y lint no se ejecutaron en el entorno de desarrollo: se corren en el repo (ver el PR).
- Los filtros son por estado de lectura (todas / sin leer). No hay filtro por tipo de alerta: la tarjeta no lo pide.
- El badge de la barra de navegación (fuera de esta pantalla) no se tocó; usaría el mismo contador de `useAlertas`.
