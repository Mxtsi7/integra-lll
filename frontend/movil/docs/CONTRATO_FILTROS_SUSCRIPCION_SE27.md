# Contrato de Integración: Aplicar Filtros Móviles por Estado y Fecha (SE-27)

- **Tarjeta:** SE-27 (Aplicar filtros móviles por estado y fecha)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Prioridad:** Should / P1
- **Depende de:** [SE-19] Conectar listado móvil paginado
- **Desbloquea a:** Revisión de filtros e informes móviles del Sprint 3.
- **Implementación de referencia:**
  - [`frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx)
  - [`frontend/movil/src/screens/home/HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx)
  - [`frontend/movil/src/screens/home/HomeScreen.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.styles.ts)
  - [`frontend/movil/src/screens/home/HomeScreen.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.test.tsx)

---

## 1. Resumen y Propósito

Esta tarjeta proporciona controles móviles accesibles para filtrar suscripciones en el servidor por **estado** (`activo`, `fantasma`, `prueba`, `por_confirmar`, `cancelado`) y por **fecha exacta de próximo cobro** (`fecha_cobro` en formato `AAAA-MM-DD`). 

Garantiza que:
1. **Criterio 1 — Combinación filtra en servidor:**
   - La selección de un estado o el ingreso de una fecha válida despacha `GET /suscripciones/?page=1&estado=...&fecha_cobro=...` consumiendo los parámetros soportados por el backend.
   - Las fechas que no cumplen con una fecha de calendario real (validadas mediante [`esFechaReal`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/validaciones.ts)) no se envían al servidor, evitando peticiones erróneas o estados 400.
2. **Criterio 2 — No deja resultados de la consulta anterior:**
   - Al pulsar un chip de estado o modificar la fecha, la pantalla transiciona inmediatamente al estado de carga (`progressbar`) ocultando de la vista los datos del filtro previo.
   - Si una petición anterior A resuelve de forma tardía después de que una petición más reciente B ya resolvió, la respuesta A se descarta mediante el control de generación (`generacionRef`), asegurando que jamás se mezclen datos obsoletos.
3. **Reinicio de paginación:**
   - Si el usuario se encuentra en una página posterior (ej. página 2) y aplica o modifica cualquier filtro, la paginación se reinicia automáticamente a la página 1 (`paginaActual = 1`).
4. **Acción de limpiar y descripción accesible:**
   - Muestra el criterio activo de filtrado de forma legible mediante [`describirCriterioActivo`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx) (`criterio-filtro-activo`).
   - Muestra el botón accesible `btn-limpiar-filtros` únicamente cuando existen filtros activos. Al pulsarlo, restablece el estado a `'todas'`, limpia la fecha y consulta la página 1 sin parámetros.
5. **Diferenciación de estados vacíos:**
   - **Cuenta vacía:** Muestra `empty-state-home` con instrucción de bienvenida y CTA para agregar la primera suscripción.
   - **Búsqueda filtrada sin resultados:** Muestra `empty-state-filtros` con el mensaje `"Ninguna suscripción coincide"` y el botón `btn-limpiar-filtros-vacio`.

---

## 2. Controles de Filtrado Móvil (`FiltrosSuscripcionesMovil`)

### 2.1. Propiedades (Props)

```typescript
export interface FiltrosSuscripcionesMovilProps {
  filtroEstado: FiltroEstado;
  filtroFecha: string;
  onCambiarEstado: (estado: FiltroEstado) => void;
  onCambiarFecha: (fecha: string) => void;
  onLimpiarFiltros: () => void;
  hayFiltrosActivos: boolean;
  totalResultados?: number;
}
```

### 2.2. Roles y TestIDs

| Elemento | TestID | Rol de Accesibilidad | Función |
| :--- | :--- | :--- | :--- |
| **Barra de Filtros** | `filtros-suscripciones` | `region` / contenedor | Contenedor principal de controles de filtrado. |
| **Chip Todas** | `filtro-estado-todas` | `button` | Selecciona todas las suscripciones sin filtro de estado. |
| **Chip Activas** | `filtro-estado-activo` | `button` | Filtra por suscripciones activas. |
| **Chip Sin uso** | `filtro-estado-fantasma` | `button` | Filtra por suscripciones sin uso / fantasma. |
| **Chip Pruebas** | `filtro-estado-prueba` | `button` | Filtra por suscripciones en período de prueba. |
| **Chip Por confirmar** | `filtro-estado-por_confirmar`| `button` | Filtra por suscripciones pendientes de confirmación. |
| **Chip Canceladas** | `filtro-estado-cancelado` | `button` | Filtra por suscripciones canceladas. |
| **Input Fecha** | `input-filtro-fecha` | `textbox` | Campo de texto para fecha `AAAA-MM-DD` con validación real. |
| **Botón Limpiar Barra** | `btn-limpiar-filtros` | `button` | Restablece filtros a valores predeterminados (visible si activos). |
| **Criterio Activo** | `criterio-filtro-activo` | `text` | Texto legible con el criterio activo y total de coincidencias. |
| **Estado Vacío Filtros**| `empty-state-filtros` | `region` | Indicador de cero coincidencias con botón para limpiar. |
| **Botón Limpiar Vacío** | `btn-limpiar-filtros-vacio`| `button` | Limpia filtros desde la vista vacía y recarga el listado. |

---

## 3. Matriz de Errores y Comportamiento Asíncrono

| Escenario | Condición | Comportamiento en UI | Estado de Datos |
| :--- | :--- | :--- | :--- |
| **Cambio de Filtro** | Clic en chip de estado o cambio de fecha | Pasa de inmediato a `cargando` (`progressbar`). Se oculta la lista previa. | Cancela vigencia de peticiones previas vía `generacionRef`. Pide página 1 con nuevos parámetros. |
| **Respuesta Lenta A vs Rápida B** | B resuelve antes que A | Muestra los datos de B. Al llegar A, se descarta silenciosamente. | Previene mezcla de datos viejos con el filtro vigente. |
| **Página Posterior con Filtro** | Usuario en página 2 cambia filtro | Se reinicia `paginaActual = 1`. | Envía `page=1` junto con el nuevo filtro. |
| **Limpiar Filtros** | Clic en `btn-limpiar-filtros` | Se marcan 'todas' y fecha vacía. | Envía `GET /suscripciones/?page=1` sin parámetros adicionales. |
| **Filtro sin Coincidencias** | Servidor responde `results: []` | Renderiza `empty-state-filtros` con botón `btn-limpiar-filtros-vacio`. | Diferenciado de la bienvenida de cuenta vacía. |

---

## 4. Mensaje de Commit Propuesto

```text
feat(movil): aplicar filtros moviles por estado y fecha en servidor (SE-27)

- Crear componente accesible FiltrosSuscripcionesMovil con selector horizontal de chips de estado, input de fecha con validacion real y descripcion de criterio activo.
- Criterio 1: Despachar consulta combinada al servidor (GET /suscripciones/?page=1&estado=...&fecha_cobro=...).
- Criterio 2: Ocultar inmediatamente resultados previos al cambiar filtros y descartar respuestas lentas desordenadas con generacionRef.
- Reiniciar automaticamente la paginacion a pagina 1 ante cualquier modificacion de filtros.
- Conectar accion de limpiar filtros tanto en la barra como en el estado vacio diferenciado de filtros.
- Agregar cobertura completa de pruebas en HomeScreen.test.tsx.
```
