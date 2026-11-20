# Pull Request: [SE-31] Avisar cambios sin guardar en móvil

## Resumen de Cambios

Se implementa el aviso y la interceptación de navegación para cambios sin guardar en la aplicación móvil, cumpliendo con todos los criterios de la tarjeta **SE-31** (Sprint 3 · Fila 141).

### Aspectos Clave Implementados:
1. **Componente Diálogo Accesible ([`AvisoCambiosSinGuardarModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/components/AvisoCambiosSinGuardarModal.tsx)):**
   - Modal con `role="dialog"` y tarjeta con rol accesible `alert` (`testID="aviso-cambios-sin-guardar"`).
   - Acciones explícitas y accesibles: `"Seguir editando"` (`testID="btn-seguir-editando"`) y `"Descartar cambios"` (`testID="btn-descartar-cambios"`).
   - Estilos modulares desacoplados en [`AvisoCambiosSinGuardarModal.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/components/AvisoCambiosSinGuardarModal.styles.ts).

2. **Hook Reutilizable de Navegación ([`useAvisoCambiosSinGuardar.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/hooks/useAvisoCambiosSinGuardar.ts)):**
   - Subscripción al evento `beforeRemove` de React Navigation para capturar gestos de swipe, botones del header y llamadas programáticas a `navigation.goBack()`.
   - Subscripción al evento `hardwareBackPress` de `BackHandler` de Android.
   - Manejo de bypass automático y limpieza de advertencia al guardar exitosamente o descartar.

3. **Integración en Pantallas:**
   - [`SuscripcionNuevaScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx) (SE-22): integra el modal y hook; al crear la suscripción limpia el aviso y redirige sin interrupciones.
   - [`SuscripcionEditarScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx) (SE-24): integra el modal y hook; al actualizar mediante PATCH limpia el aviso y vuelve al detalle sin interrupciones.

---

## Criterios de Aceptación Verificados

- [x] **Criterio 1: Formularios limpios no interrumpen navegación:**
  - Si el usuario no modifica campos, o si los devuelve a su valor inicial, la salida ocurre de forma instantánea sin mostrar avisos.
- [x] **Criterio 2: Guardar, cancelar y descartar limpian el estado sucio correcto:**
  - Cancelar con cambios pendientes retiene la pantalla y abre el modal de aviso.
  - "Seguir editando" cierra el diálogo y conserva intactos todos los inputs del formulario.
  - "Descartar cambios" cierra el diálogo y completa la navegación hacia atrás.
  - Guardar exitosamente limpia el estado sucio y permite avanzar al detalle.
- [x] **Evidencia y pruebas automatizadas:**
  - 11 pruebas dedicadas en [`AvisarCambiosSinGuardar.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/AvisarCambiosSinGuardar.test.tsx).
  - 495 pruebas en 27 archivos del workspace móvil aprobadas al 100%.
  - 282 pruebas en 19 archivos del workspace shared aprobadas al 100%.
  - `npm run typecheck` completado con 0 errores en todos los workspaces.

---

## Archivos Afectados

- [`frontend/movil/src/components/AvisoCambiosSinGuardarModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/components/AvisoCambiosSinGuardarModal.tsx)
- [`frontend/movil/src/components/AvisoCambiosSinGuardarModal.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/components/AvisoCambiosSinGuardarModal.styles.ts)
- [`frontend/movil/src/hooks/useAvisoCambiosSinGuardar.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/hooks/useAvisoCambiosSinGuardar.ts)
- [`frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx)
- [`frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx)
- [`frontend/movil/src/screens/home/AvisarCambiosSinGuardar.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/AvisarCambiosSinGuardar.test.tsx)
- [`frontend/movil/test/react-native-shim.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/test/react-native-shim.tsx)
- [`frontend/movil/docs/CONTRATO_AVISO_CAMBIOS_SIN_GUARDAR_SE31.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_AVISO_CAMBIOS_SIN_GUARDAR_SE31.md)
- [`frontend/movil/docs/PR_SPRINT3_SE31.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/PR_SPRINT3_SE31.md)

---

## Evidencia de Pruebas

```bash
$ npm test --workspace=movil -- src/screens/home/AvisarCambiosSinGuardar.test.tsx
 ✓ src/screens/home/AvisarCambiosSinGuardar.test.tsx (11)
   ✓ SE-31: Avisar cambios sin guardar en móvil (11)
     ✓ Formulario de Nueva Suscripción (SuscripcionNuevaScreen) (7)
       ✓ formulario limpio no interrumpe navegación al cancelar
       ✓ formulario limpio no intercepta beforeRemove de React Navigation
       ✓ con cambios pendientes intercepta la salida y muestra el diálogo accesible
       ✓ pulsar "Seguir editando" cierra el diálogo y conserva los datos ingresados
       ✓ pulsar "Descartar cambios" cierra el diálogo y concreta la salida
       ✓ restaurar el valor inicial desactiva el aviso y permite salir directamente
       ✓ guardar exitosamente limpia el estado sucio y navega a detalle sin advertencias
     ✓ Formulario de Edición (SuscripcionEditarScreen) (3)
       ✓ formulario limpio no interrumpe navegación al cancelar
       ✓ con cambios modificados intercepta la salida en edición y permite seguir o descartar
       ✓ guardar exitosamente en edición actualiza y regresa sin mostrar advertencias
     ✓ Integración con Android Hardware BackHandler (1)
       ✓ BackHandler abre el aviso si hay cambios pendientes y lo cierra con un segundo toque

Test Files  1 passed (1)
     Tests  11 passed (11)

$ npm test --workspace=movil
Test Files  27 passed (27)
     Tests  495 passed (495)

$ npm test --workspace=@ojoalgasto/shared
Test Files  19 passed (19)
     Tests  282 passed (282)

$ npm run typecheck
> typecheck (0 errores en todos los workspaces)
```
