# Pull Request: [SE-29] Ordenar listado móvil y mostrar criterio

## Resumen de Cambios

Se implementa el ordenamiento por servidor en la vista principal móvil de Suscripciones (`HomeScreen`) y en el componente de filtros (`FiltrosSuscripcionesMovil`), cumpliendo todos los requerimientos de la tarjeta **SE-29** (Sprint 3 · Fila 139).

### Aspectos Clave Implementados:
1. **Selector de Orden en Móvil (`FiltrosSuscripcionesMovil.tsx`):**
   - Agregada barra horizontal con chips de orden para los 3 campos clave en ambas direcciones (6 opciones):
     - Próximo cobro: ascendente (más cercano) y descendente (más lejano).
     - Nombre: ascendente (A-Z) y descendente (Z-A).
     - Monto: ascendente (menor a mayor) y descendente (mayor a menor).
   - Accesibilidad completa con `accessibilityRole="radiogroup"`, `accessibilityRole="button"`, `aria-pressed={seleccionada}`, y etiquetas claras.
   - Indicador superior en tiempo real (`indicador-orden-activo`) que muestra el criterio activo o el valor predeterminado si no se ha seleccionado ninguno.

2. **Integración con Consulta por Servidor y Paginación (`HomeScreen.tsx`):**
   - El orden se envía al servidor mediante `consulta.orden` antes de paginar.
   - Si existen filtros activos (`estado`, `fecha_cobro`), se combinan en la consulta.
   - Al paginar ("Cargar más"), las páginas subsecuentes preservan el mismo criterio de orden.
   - Cambiar de orden reinicia a página 1 y cancela respuestas lentas previas mediante control de generación (`generacionRef.current += 1`).
   - "Limpiar filtros" restablece tanto el estado como la fecha y el orden seleccionado, consultando la página 1 con valores por defecto.

3. **Criterio Activo en Accesibilidad y Estado Vacío:**
   - La función `describirCriterioActivo` incorpora el orden para lectores de pantalla y para la descripción del estado vacío (`EmptyState`) cuando ningún resultado coincide.

---

## Criterios de Aceptación Verificados

- [x] **Criterio 1: El orden cruza páginas correctamente y mantiene filtros:**
  - El orden se incluye en las solicitudes de página 1 y página 2.
  - Se combinan filtros activos con el orden.
  - Deduplicación y preservación del orden devuelto por el backend.
- [x] **Criterio 2: Criterio activo es visible y accesible:**
  - Chips con `aria-pressed="true"` y etiqueta de estado activo.
  - Indicador visible del criterio en `indicador-orden-activo`.
  - Descripción en pantalla vacía refleja el orden activo.
- [x] **Evidencia enlazada y pruebas automatizadas:**
  - 10 pruebas unitarias y de integración dedicadas en `OrdenarListado.test.tsx`.
  - 49 pruebas de `HomeScreen.test.tsx` aprobadas sin regresiones.
  - 471 pruebas en 25 archivos del workspace móvil aprobadas al 100%.
  - `npm run typecheck` completado con 0 errores de tipos.

---

## Archivos Afectados

- [`frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx) (chips de orden, indicador activo, accesibilidad, `describirCriterioActivo`).
- [`frontend/movil/src/screens/home/HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx) (estado de orden, integración con consulta paginada, reseteo al cambiar orden y usuario).
- [`frontend/movil/src/screens/home/OrdenarListado.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/OrdenarListado.test.tsx) (suite completa de pruebas para SE-29).
- [`frontend/movil/docs/CONTRATO_ORDEN_LISTADO_SE29.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_ORDEN_LISTADO_SE29.md) (documentación del contrato de integración).

---

## Evidencia de Pruebas

```bash
$ npm test --workspace=movil -- src/screens/home/OrdenarListado.test.tsx
 ✓ src/screens/home/OrdenarListado.test.tsx (10)
   ✓ SE-29 — Ordenar listado móvil y mostrar criterio (10)
     ✓ FiltrosSuscripcionesMovil y describirCriterioActivo (3)
       ✓ describirCriterioActivo genera texto conciso para accesibilidad con orden activo
       ✓ renderiza selector de orden con los 6 chips requeridos y dispara callbacks al seleccionarlos
       ✓ marca accesibilidad aria-pressed=true y texto de criterio en el chip y banner activo
     ✓ Criterio 1: El orden cruza páginas correctamente y mantiene filtros (3)
       ✓ solicita la primera página con orden y mantiene filtros activos
       ✓ al pulsar "Cargar más" la página 2 incluye el mismo orden y filtros por servidor
       ✓ cambiar de orden en página 2 reinicia a página 1 y cancela la anterior
     ✓ Criterio 2: Criterio activo es visible y accesible (3)
       ✓ muestra el criterio activo en el banner accesible de FiltrosSuscripcionesMovil
       ✓ en estado vacío por filtros/orden muestra el criterio activo en la descripción
       ✓ el botón "Limpiar filtros" restablece tanto el estado como el orden seleccionado
     ✓ Protección contra respuestas asíncronas y carreras de orden (1)
       ✓ ignora respuesta tardía de orden A si orden B resolvió primero

Test Files  1 passed (1)
     Tests  10 passed (10)

$ npm test --workspace=movil
 Test Files  25 passed (25)
      Tests  471 passed (471)

$ npm run typecheck
 > @ojoalgasto/shared@0.1.0 typecheck (tsc --noEmit)
 > web@0.1.0 typecheck (tsc --noEmit)
 > movil@1.0.0 typecheck (tsc --noEmit)
 > desktop@0.1.0 typecheck
 > extension typecheck
 (0 errores)
```
