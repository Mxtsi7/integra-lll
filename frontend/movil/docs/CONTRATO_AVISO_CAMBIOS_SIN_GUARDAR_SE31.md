# Contrato de Integración Móvil: SE-31 — Avisar Cambios Sin Guardar en Móvil

**Tarjeta de Planificación:** Sprint 3 · Fila 141 (SE-31)  
**Responsable:** Sebastian Mena  
**Componentes Involucrados:**
- [`frontend/movil/src/components/AvisoCambiosSinGuardarModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/components/AvisoCambiosSinGuardarModal.tsx)
- [`frontend/movil/src/components/AvisoCambiosSinGuardarModal.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/components/AvisoCambiosSinGuardarModal.styles.ts)
- [`frontend/movil/src/hooks/useAvisoCambiosSinGuardar.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/hooks/useAvisoCambiosSinGuardar.ts)
- [`frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx)
- [`frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx)
- [`frontend/movil/src/screens/home/AvisarCambiosSinGuardar.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/AvisarCambiosSinGuardar.test.tsx)

---

## 1. Alcance y Criterios de Aceptación

1. **Criterio 1: Formularios limpios no interrumpen navegación:**
   - Si no se han ingresado datos o el formulario se encuentra en su estado inicial, presionar "Cancelar y Volver", el botón atrás del header de navegación o el botón físico de Android navega de regreso inmediatamente sin desplegar ninguna advertencia.
   - El evento `beforeRemove` de React Navigation no invoca `e.preventDefault()` cuando `hayCambios === false`.

2. **Criterio 2: Guardar, cancelar y descartar limpian el estado sucio correcto:**
   - **Cancelar / Salida con cambios pendientes:** Si hay campos modificados, la salida se intercepta (`e.preventDefault()`) y se despliega el modal accesible `AvisoCambiosSinGuardarModal`.
   - **Coordinación nativa con `createNativeStackNavigator` (P1 SE-31):** En navegadores nativos (`@react-navigation/native-stack`), el hook registra la ruta en `PreventRemoveContext` (`useInsertionEffect` y `useEffect`), activando `preventNativeDismiss: true` en `react-native-screens`. Esto garantiza que los gestos de swipe nativos de iOS y los botones nativos del header no descarten la pantalla en la capa del sistema operativo antes de confirmar.
   - **"Seguir editando":** Oculta el modal y mantiene intactos todos los datos ingresados por el usuario en el formulario, conservando `preventRemove: true`.
   - **"Descartar cambios":** Limpia el estado sucio, desactiva `preventRemove` en `PreventRemoveContext`, activa el bypass y completa la acción de navegación retenida (retroceso a la pantalla previa).
   - **Restaurar al estado inicial:** Si el usuario borra los cambios manuales y devuelve el formulario al valor inicial, el estado sucio se desactiva reactivamente y se permite salir sin diálogo.
   - **Guardar:** Tras guardar exitosamente (`handleSubmit`), se invoca `limpiarAvisoTrasGuardar()`, desactivando `preventRemove` y permitiendo que la navegación hacia `SuscripcionDetalle` proceda de forma fluida y sin bloqueos.

3. **Criterio 3: Evidencia y pruebas automatizadas:**
   - Suite dedicada en `AvisarCambiosSinGuardar.test.tsx` con 13 pruebas cubriendo ambos formularios, Android BackHandler y la integración nativa con `PreventRemoveContext` en `createNativeStackNavigator`.

---

## 2. Tipos e Interfaces

```typescript
export interface AvisoCambiosSinGuardarModalProps {
  visible: boolean;
  onSeguirEditando: () => void;
  onDescartar: () => void;
  titulo?: string;
  mensaje?: string;
  testID?: string;
}

export interface UseAvisoCambiosSinGuardarOptions {
  hayCambios: boolean;
  navigation?: any;
}

export interface UseAvisoCambiosSinGuardarResult {
  mostrandoAviso: boolean;
  seguirEditando: () => void;
  descartarCambios: () => void;
  limpiarAvisoTrasGuardar: () => void;
  intentarSalir: () => void;
}
```

---

## 3. Matriz de Validación de Pruebas

| Caso de Prueba | Escenario | Resultado |
|---|---|---|
| `formulario limpio no interrumpe navegación al cancelar` | `SuscripcionNuevaScreen` sin cambios | ✅ Aprobado |
| `formulario limpio no intercepta beforeRemove` | `beforeRemove` sin cambios sucios | ✅ Aprobado |
| `con cambios pendientes intercepta la salida y muestra diálogo` | `SuscripcionNuevaScreen` con nombre modificado | ✅ Aprobado |
| `pulsar "Seguir editando" cierra el diálogo y conserva los datos` | Modal abierto -> presionar Seguir editando | ✅ Aprobado |
| `pulsar "Descartar cambios" cierra el diálogo y concreta la salida` | Modal abierto -> presionar Descartar cambios | ✅ Aprobado |
| `restaurar el valor inicial desactiva el aviso` | Modificar campo y vaciarlo nuevamente | ✅ Aprobado |
| `guardar exitosamente limpia el estado sucio` | POST exitoso -> redirección a detalle | ✅ Aprobado |
| `formulario limpio no interrumpe navegación en edición` | `SuscripcionEditarScreen` sin cambios | ✅ Aprobado |
| `con cambios modificados intercepta salida en edición` | `SuscripcionEditarScreen` con monto cambiado | ✅ Aprobado |
| `guardar exitosamente en edición actualiza y regresa sin avisos` | PATCH exitoso -> popTo detalle | ✅ Aprobado |
| `BackHandler de Android intercepta y alterna el aviso` | Hardware Back press en Android | ✅ Aprobado |
| `registra preventRemove en PreventRemoveContext al ensuciar` | `createNativeStackNavigator` + `SuscripcionNueva` | ✅ Aprobado |
| `guardar exitosamente limpia preventRemove y desapila con popTo` | `createNativeStackNavigator` + `SuscripcionEditar` | ✅ Aprobado |

