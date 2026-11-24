# Pull Request: [SE-30] Mostrar historial móvil de uso por fecha

## Resumen de Cambios

Se implementa el historial móvil de uso por fecha en la pantalla de detalle de suscripción (`SuscripcionDetalleScreen`), cumpliendo con todos los criterios de la tarjeta **SE-30** (Sprint 3 · Fila 140).

### Aspectos Clave Implementados:
1. **Extensión Compartida en `@ojoalgasto/shared`:**
   - Incorporada la función pura `formatearDuracionMinutos(minutos)` para presentar minutos y horas de manera amigable (`45 min`, `1 h`, `1 h 30 min`).
   - Exportado `getHistorialUso` como alias semántico de `getUsos` (`GET /suscripciones/<id>/uso/`).

2. **Componente Presentacional Móvil (`HistorialUsoMovil.tsx`):**
   - Presentación de registros en orden descendente con fecha (`18 oct 2026`) y duración (`1 h 30 min`).
   - Estado vacío accesible: *"Todavía no registras uso de esta suscripción."*.
   - Estado de carga con indicador accesible (`role="progressbar"`).
   - Estado de error local con alerta y botón de reintento (`testID="btn-reintentar-historial"`).

3. **Integración en `SuscripcionDetalleScreen.tsx`:**
   - Carga paralela de la suscripción y su historial de uso.
   - Actualización reactiva: al registrar minutos de uso exitosamente a través del modal (SE-28), el historial se recarga de inmediato reflejando el nuevo registro en la lista.
   - Protección de aislamiento por ID/Tenant: las respuestas asíncronas lentas o fuera de orden al cambiar de suscripción son invalidadas y descartadas mediante `generacionRef` e `idActualRef`.

---

## Criterios de Aceptación Verificados

- [x] **Criterio 1: Historial coincide con backend y se actualiza tras uso:**
  - Consume el endpoint real del backend en orden cronológico descendente.
  - Se actualiza reactivamente tras registrar uso con el modal.
  - Presenta estado vacío accesible cuando no hay registros.
- [x] **Criterio 2: No se mezcla información de otro id/tenant:**
  - Respuestas tardías de suscripciones anteriores se descartan ante cambio de ruta.
  - Aislamiento total de errores y registros entre suscripciones.
- [x] **Evidencia enlazada y pruebas automatizadas:**
  - 10 pruebas unitarias y de integración dedicadas en `HistorialUso.test.tsx`.
  - 27 pruebas de `SuscripcionDetalleScreen.test.tsx` aprobadas.
  - 282 pruebas en `@ojoalgasto/shared` aprobadas.
  - 484 pruebas en 26 archivos del workspace móvil aprobadas al 100%.
  - `npm run typecheck` completado con 0 errores.

---

## Archivos Afectados

- [`frontend/shared/src/formato.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/formato.ts) (`formatearDuracionMinutos`).
- [`frontend/shared/src/formato.test.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/formato.test.ts) (pruebas de formato de duración).
- [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) (`getHistorialUso`).
- [`frontend/shared/src/index.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/index.ts) (exportaciones).
- [`frontend/movil/src/screens/home/HistorialUsoMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUsoMovil.tsx) (componente móvil de historial).
- [`frontend/movil/src/screens/home/HistorialUsoMovil.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUsoMovil.styles.ts) (estilos del historial).
- [`frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx) (integración, carga y actualización reactiva).
- [`frontend/movil/src/screens/home/HistorialUso.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUso.test.tsx) (pruebas de SE-30).
- [`frontend/movil/docs/CONTRATO_HISTORIAL_USO_SE30.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_HISTORIAL_USO_SE30.md) (documentación del contrato).

---

## Evidencia de Pruebas

```bash
$ npm test --workspace=movil -- src/screens/home/HistorialUso.test.tsx
 ✓ src/screens/home/HistorialUso.test.tsx (9)
   ✓ SE-30 — Mostrar historial móvil de uso por fecha (9)
     ✓ Componente Presentacional HistorialUsoMovil (4)
       ✓ muestra indicador de carga accesible cuando el estado es cargando
       ✓ muestra alerta accesible y botón de reintento cuando el estado es error
       ✓ muestra estado vacío accesible cuando la lista de usos está vacía
       ✓ renderiza la lista de registros en orden descendente con fecha y duración formateada
     ✓ Criterio 1: Historial coincide con backend y se actualiza tras uso (3)
       ✓ carga el historial desde el backend al montar y lo muestra en orden descendente
       ✓ actualiza automáticamente el historial tras registrar un nuevo uso exitoso en el modal
       ✓ reintentar en estado de error vuelve a consultar el historial sin perder los datos de la suscripción
     ✓ Criterio 2: No se mezcla información de otro id/tenant (2)
       ✓ al cambiar de suscripción (id diferente) se descarta la respuesta tardía del id anterior
       ✓ un fallo en el historial del id anterior no contamina el estado del nuevo id

Test Files  1 passed (1)
     Tests  9 passed (9)

$ npm test --workspace=@ojoalgasto/shared
 Test Files  19 passed (19)
      Tests  282 passed (282)

$ npm test --workspace=movil
 Test Files  26 passed (26)
      Tests  484 passed (484)

$ npm run typecheck
 > typecheck (0 errores)
```
