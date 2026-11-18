# Contrato de Integración Móvil: SE-30 — Mostrar Historial Móvil de Uso por Fecha

**Tarjeta de Planificación:** Sprint 3 · Fila 140 (SE-30)  
**Responsable:** Sebastian Mena  
**Componentes Involucrados:**
- [`frontend/movil/src/screens/home/HistorialUsoMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUsoMovil.tsx)
- [`frontend/movil/src/screens/home/HistorialUsoMovil.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUsoMovil.styles.ts)
- [`frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)
- [`frontend/movil/src/screens/home/HistorialUso.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUso.test.tsx)
- Extensión en `@ojoalgasto/shared`:
  - [`frontend/shared/src/formato.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/formato.ts) (`formatearDuracionMinutos`)
  - [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) (`getHistorialUso` / `getUsos`, `RegistroUso`)
  - [`frontend/shared/src/index.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/index.ts)

---

## 1. Alcance y Criterios de Aceptación

1. **Criterio 1: Historial coincide con backend y se actualiza tras uso:**
   - Consume `GET /suscripciones/<id>/uso/` mediante `getHistorialUso(id)` o `getUsos(id)`.
   - El backend devuelve los registros ordenados cronológicamente del más reciente al más antiguo (descendente por fecha).
   - Cada registro expone su fecha formateada (`formatearFecha`) y duración legible (`formatearDuracionMinutos`).
   - Si no existen registros (`usos.length === 0`), se muestra el estado vacío: `"Todavía no registras uso de esta suscripción."`.
   - Al registrar un nuevo uso exitoso mediante `RegistrarUsoModal` (SE-28), el historial se recarga de inmediato y refleja el nuevo registro sin requerir recargar la pantalla.
   - Si la petición de historial falla, se muestra un estado de error local con botón "Reintentar", sin bloquear ni romper la vista principal de la suscripción.

2. **Criterio 2: No se mezcla información de otro id/tenant:**
   - La carga está acoplada al `id` de la suscripción objetivo.
   - Mediante control de generación (`generacionRef`) e identificación activa (`idActualRef`), se invalidan y descartan todas las respuestas lentas o fuera de orden al cambiar de suscripción.
   - Al navegar a una suscripción diferente, los registros o posibles errores de la anterior nunca se muestran en la nueva.

---

## 2. Tipos e Interfaces

```typescript
import { type RegistroUso } from '@ojoalgasto/shared';

export type EstadoHistorialUso =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje?: string }
  | { tipo: 'listo'; usos: RegistroUso[] };

export interface HistorialUsoMovilProps {
  estado: EstadoHistorialUso;
  onReintentar: () => void;
}
```

### Funciones Compartidas Reutilizadas:
- `getHistorialUso(id: string): Promise<RegistroUso[]>`
- `formatearDuracionMinutos(minutos: number): string` (`45 -> "45 min"`, `60 -> "1 h"`, `90 -> "1 h 30 min"`)
- `formatearFecha(fecha: string): string` (`"2026-10-18" -> "18 oct 2026"`)

---

## 3. Matriz de Validación de Pruebas

| Prueba | Archivo | Resultado |
|---|---|---|
| Indicador de carga accesible (`role="progressbar"`) | `HistorialUso.test.tsx` | APROBADO |
| Alerta de error accesible con botón reintentar | `HistorialUso.test.tsx` | APROBADO |
| Estado vacío accesible cuando no hay registros | `HistorialUso.test.tsx` | APROBADO |
| Renderizado en orden descendente con fecha y duración | `HistorialUso.test.tsx` | APROBADO |
| Carga inicial desde backend | `HistorialUso.test.tsx` | APROBADO |
| Actualización reactiva tras registrar uso en modal | `HistorialUso.test.tsx` | APROBADO |
| Reintento en estado de error preserva suscripción | `HistorialUso.test.tsx` | APROBADO |
| Descarte de respuesta tardía al cambiar de ID | `HistorialUso.test.tsx` | APROBADO |
| Aislamiento de errores entre IDs | `HistorialUso.test.tsx` | APROBADO |
| Pruebas unitarias de `formatearDuracionMinutos` | `formato.test.ts` | APROBADO |
| Suite completa `movil` (26 suites, 480 pruebas) | Workspace móvil | APROBADO |
| Verificación estricta de tipos TypeScript | `npm run typecheck` | APROBADO (0 errores) |
