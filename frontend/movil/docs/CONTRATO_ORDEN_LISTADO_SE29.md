# Contrato de Integración Móvil: SE-29 — Ordenar Listado Móvil y Mostrar Criterio

**Tarjeta de Planificación:** Sprint 3 · Fila 139 (SE-29)  
**Responsable:** Sebastian Mena  
**Componentes Involucrados:**
- [`frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx)
- [`frontend/movil/src/screens/home/HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx)
- [`frontend/movil/src/screens/home/OrdenarListado.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/OrdenarListado.test.tsx)
- Insumo de backend/shared: [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) (`ORDENES_SUSCRIPCIONES`, `OrdenSuscripciones`, `esOrdenSuscripciones`, `ConsultaSuscripciones`).

---

## 1. Alcance y Criterios de Aceptación

1. **Criterio 1: El orden cruza páginas correctamente y mantiene filtros:**
   - La selección de orden (`fecha_proximo_cobro`, `-fecha_proximo_cobro`, `nombre`, `-nombre`, `monto`, `-monto`) se envía al servidor mediante `consulta.orden` antes de paginar.
   - Si existen filtros activos (`estado`, `fecha_cobro`), la consulta los combina: `{ estado: 'activo', fecha_cobro: '2026-10-05', orden: '-monto' }`.
   - Al pulsar "Cargar más" para solicitar la página subsecuente (`page: 2`), la petición mantiene el mismo criterio de orden y filtros.
   - Las suscripciones devueltas se concatenan y deduplican preservando el orden provisto por el servidor.
   - Cambiar de criterio de orden reinicia inmediatamente la paginación a la página 1 (`paginaActual: 1`), pasa el estado a cargando y cancela respuestas asíncronas anteriores para prevenir carreras.

2. **Criterio 2: Criterio activo visible y accesible:**
   - El selector de orden se renderiza horizontalmente con chips accesibles (`accessibilityRole="button"`, `aria-pressed="true"`, `testID="orden-chip-<valor>"`).
   - El contenedor horizontal posee `accessibilityRole="radiogroup"` y `testID="orden-chips-scroll"`.
   - El banner superior muestra el criterio de orden activo en tiempo real (`testID="indicador-orden-activo"` con `accessibilityRole="text"`):
     - Si no hay orden explícito: `"Predeterminado: Próximo cobro (más cercano)"`.
     - Si hay orden activo: `"Activo: <etiqueta>"`, ej: `"Activo: Monto: de mayor a menor"`.
   - La función pura `describirCriterioActivo(filtroEstado, filtroFecha, orden)` incluye el orden de forma legible para lectores de pantalla y para el estado vacío (`EmptyState` cuando 0 suscripciones coinciden con los filtros/orden).
   - El botón "Limpiar filtros" restablece tanto el estado a `"todas"`, borra la fecha y restablece `orden` a `undefined`, recargando la página 1 con orden por defecto.

---

## 2. Tipos y Opciones de Orden Disponibles

```typescript
import {
  type OrdenSuscripciones,
  ORDENES_SUSCRIPCIONES,
  esOrdenSuscripciones,
} from '@ojoalgasto/shared';

export interface OpcionOrden {
  valor: OrdenSuscripciones;
  campo: 'fecha_proximo_cobro' | 'nombre' | 'monto';
  direccion: 'asc' | 'desc';
  etiqueta: string;
  etiquetaCorta: string;
}

export const OPCIONES_ORDEN: readonly OpcionOrden[] = [
  {
    valor: 'fecha_proximo_cobro',
    campo: 'fecha_proximo_cobro',
    direccion: 'asc',
    etiqueta: 'Próximo cobro: más cercano primero',
    etiquetaCorta: 'Cobro ↑ (más cercano)',
  },
  {
    valor: '-fecha_proximo_cobro',
    campo: 'fecha_proximo_cobro',
    direccion: 'desc',
    etiqueta: 'Próximo cobro: más lejano primero',
    etiquetaCorta: 'Cobro ↓ (más lejano)',
  },
  {
    valor: 'nombre',
    campo: 'nombre',
    direccion: 'asc',
    etiqueta: 'Nombre: de la A a la Z',
    etiquetaCorta: 'Nombre (A-Z)',
  },
  {
    valor: '-nombre',
    campo: 'nombre',
    direccion: 'desc',
    etiqueta: 'Nombre: de la Z a la A',
    etiquetaCorta: 'Nombre (Z-A)',
  },
  {
    valor: 'monto',
    campo: 'monto',
    direccion: 'asc',
    etiqueta: 'Monto: de menor a mayor',
    etiquetaCorta: 'Monto (menor a mayor)',
  },
  {
    valor: '-monto',
    campo: 'monto',
    direccion: 'desc',
    etiqueta: 'Monto: de mayor a menor',
    etiquetaCorta: 'Monto (mayor a menor)',
  },
];
```

---

## 3. Propiedades del Componente y Contenedor

### `FiltrosSuscripcionesMovilProps`
```typescript
export interface FiltrosSuscripcionesMovilProps {
  filtroEstado: FiltroEstado;
  filtroFecha: string;
  onCambiarEstado: (estado: FiltroEstado) => void;
  onCambiarFecha: (fecha: string) => void;
  onLimpiarFiltros: () => void;
  hayFiltrosActivos: boolean;
  totalResultados?: number;
  orden?: OrdenSuscripciones;
  onCambiarOrden?: (orden: OrdenSuscripciones) => void;
}
```

### `HomeViewProps` & `HomeScreen`
- Se incorpora `orden?: OrdenSuscripciones` y `onCambiarOrden?: (orden: OrdenSuscripciones) => void`.
- `HomeScreen` almacena el estado reactivo `const [orden, setOrden] = useState<OrdenSuscripciones | undefined>(propOrden)`.
- `construirConsulta()` inyecta `if (orden !== undefined) consulta.orden = orden;`.
- Al cambiar de orden o pulsar limpiar filtros se reinicia la paginación y la generación asíncrona de recarga (`generacionRef.current += 1`).

---

## 4. Matriz de Validación de Pruebas

| Prueba | Archivo | Resultado |
|---|---|---|
| Selector de 6 chips y callback `onCambiarOrden` | `OrdenarListado.test.tsx` | APROBADO |
| Accesibilidad `aria-pressed="true"`, etiquetas legibles e indicador activo | `OrdenarListado.test.tsx` | APROBADO |
| Criterio activo visible en estado vacío | `OrdenarListado.test.tsx` | APROBADO |
| Orden en servidor cruza páginas (`page 1` y `page 2` con `orden`) | `OrdenarListado.test.tsx` | APROBADO |
| Preservación de filtros activos al ordenar | `OrdenarListado.test.tsx` | APROBADO |
| Reinicio a página 1 al cambiar orden | `OrdenarListado.test.tsx` | APROBADO |
| Protección contra respuestas asíncronas lentas o carreras | `OrdenarListado.test.tsx` | APROBADO |
| Botón "Limpiar filtros" restablece el orden a `undefined` | `OrdenarListado.test.tsx` | APROBADO |
| 49 pruebas de regresión en `HomeScreen.test.tsx` | `HomeScreen.test.tsx` | APROBADO |
| Suite completa workspace móvil (25 suites, 471 pruebas) | Todos los tests de `movil` | APROBADO |
| Verificación estricta de tipos TypeScript | `npm run typecheck` | APROBADO (0 errores) |
