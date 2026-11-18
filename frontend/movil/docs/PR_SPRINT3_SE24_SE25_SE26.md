# PR: SE_24-25-26 — Edición, PATCH y retiro de suscripción móvil

**Rama:** `SE24-27`  
**Base:** `main`  
**Responsable:** Sebastian Mena  
**Tarjetas:** 
- `SE-24`: Crear formulario móvil de edición (P1 / Must)
- `SE-25`: Conectar PATCH móvil y actualizar detalle (P1 / Must)
- `SE-26`: Confirmar retiro y ejecutar DELETE móvil (P1 / Must)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen de Cambios

### SE-24: Crear formulario móvil de edición
- **Implementación desacoplada y tipada ([`SuscripcionEditarScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx)):**
  - Vista presentacional pura `EditarSuscripcionFormView` y pantalla contenedora `SuscripcionEditarScreen`.
  - Precarga de datos a partir de la entidad `Suscripcion` original mediante `aFormulario(suscripcion)`.
  - Protección de identidad (`id`, `organizacion_id`): no expuestos a mutaciones locales.
- **Criterio 1 — Cancelar conserva datos originales:**
  - El botón `"Cancelar y Volver"` (`testID="go-back"`) descarta modificaciones locales sin mutar el objeto original ni llamar a la API, retornando con `navigation.goBack()`.
- **Criterio 2 — Campos opcionales y fecha mantienen formato correcto:**
  - Validación de fecha real en `fechaDeCobro` (`YYYY-MM-DD`, `esFechaReal`).
  - Campo condicional `finPrueba`: omitido si `enPrueba === false`; obligatorio con fecha real si `enPrueba === true`.
  - Validación numérica con `parsearMonto`: valores positivos $> 0$, máximo 2 decimales.
- **Catálogo dinámico con opciones legadas:**
  - Carga opciones activas del catálogo (`getCatalogosSuscripciones`), permitiendo conservar opciones preexistentes legadas (inactivas) sin romper la selección del usuario.
- **Puntos de integración:**
  - Detección de cambios sin guardar para SE-31 (`onCambiosSinGuardar`).
  - Registro de ruta en [`HomeNavigator.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/navigation/HomeNavigator.tsx) y [`types.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/navigation/types.ts).

### SE-25: Conectar PATCH móvil y actualizar detalle
- **Cálculo diferencial estricto (`calcularPatch`):**
  - Compara `EditarSuscripcionFormData` con la suscripción original `Suscripcion`.
  - **Criterio 1:** El PATCH no borra campos omitidos; sólo empaqueta campos modificados (ej. si sólo cambia el monto, se despacha `{ monto: 7990 }`).
  - **Resolución P2 (Estado en PATCH):** `calcularPatch` nunca envía `estado` bajo ninguna circunstancia, evitando el error DRF 400 (`services/subscriptions/app/views.py:1081-1093`). Para suscripciones en prueba, se muestra un indicador informativo y solo se envía `fin_prueba` si cambió.
- **Conciliación de detalle y listado (Criterio 2) y resolución P2 (Navegación limpia):**
  - Al completar el guardado con éxito (HTTP 200), utiliza `navigation.popTo('SuscripcionDetalle', { id, suscripcion: actualizada })` (React Navigation 7), desapilando la pantalla de edición y evitando apilar detalles duplicados ni dejar pantallas "zombie" en el stack.
  - `SuscripcionDetalleScreen` actualiza su estado de inmediato y añade listener al evento de foco (`focus`) para recargar datos desde el backend.
  - Al volver a `HomeScreen`, su listener de foco recarga la lista de suscripciones (`getSuscripciones()`), reflejando el valor confirmado y recalculando los totales mensuales.
- **Antirrebote y manejo de errores:**
  - Candado sincrónico `guardandoRef` + `isSaving`: previene doble clic durante la petición.
  - Distribución de errores de validación DRF (HTTP 400) por campo mediante `erroresDesdeServidor`.
  - Alerta superior para errores 500 o fallos de red (`testID="error-general"`), **preservando íntegramente los datos tipeados**.

### SE-26: Confirmar retiro y ejecutar DELETE móvil
- **Modal accesible con distinción explícita ([`ConfirmarRetiroModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/ConfirmarRetiroModal.tsx)):**
  - Distingue claramente entre:
    1. **Retirar registro en la aplicación:** Remueve la suscripción del panel y seguimiento en Ojo al Gasto.
    2. **Cancelar servicio con el proveedor:** Aclara explícitamente (`testID="aviso-distincion-cancelar"`) que retirar la suscripción de la app **NO detiene los cobros bancarios del proveedor comercial** (Netflix, Spotify, etc.).
- **Criterio 1 — Cancelar diálogo no cambia datos:**
  - Al presionar `"Cancelar"` (`testID="btn-cancelar-retiro"`), el modal se cierra sin llamar a `eliminarSuscripcion`, sin navegar y conservando intactos los datos de la suscripción.
- **Criterio 2 — DELETE correcto retira del panel y conserva semántica histórica backend:**
  - Al presionar `"Retirar Suscripción"` (`testID="btn-confirmar-retiro"`), se ejecuta `eliminarSuscripcion(id)` (`DELETE /suscripciones/<id>/`).
  - Candado antirrebote (`isDeleting` + `eliminandoRef`) para evitar múltiples peticiones concurrentes.
  - Solo tras confirmación exitosa (HTTP 204), se cierra el modal y se ejecuta `(navigation as any).popTo('HomeScreen')` (P2), vaciando el stack de navegación para que ni el detalle ni un editor previo queden accesibles.
  - El listener de foco en `HomeScreen` recarga la lista (`getSuscripciones()`), removiendo la suscripción y recalculando los totales.
  - Ante error 500 o de red, muestra alerta accesible (`testID="error-retiro"`, `role="alert"`), rehabilita los botones y no navega ni altera datos.

---

## 2. Criterios de Aceptación Verificados

### SE-24
- [x] **Cancelar conserva datos originales:** El botón Cancelar descarta cambios y no muta la entidad.
- [x] **Campos opcionales y fecha mantienen formato correcto:** Validación estricta de fechas reales `YYYY-MM-DD`, montos positivos y períodos condicionales.
- [x] **Evidencia y contrato validado:** [`CONTRATO_FORMULARIO_EDITAR_SUSCRIPCION_SE24.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_FORMULARIO_EDITAR_SUSCRIPCION_SE24.md).

### SE-25
- [x] **PATCH no borra campos omitidos:** `calcularPatch` envía únicamente los campos alterados.
- [x] **Sin mutación directa de estado:** Nunca se despacha `estado` en el PATCH, cumpliendo con la API de transiciones backend (P2).
- [x] **Navegación limpia sin apilamiento redundante:** `popTo('SuscripcionDetalle')` desapila el editor hacia el detalle existente (P2).
- [x] **Detalle y listado muestran el mismo valor confirmado:** Sincronización instantánea por route params y recarga por foco en `SuscripcionDetalleScreen` y `HomeScreen`.
- [x] **Manejo de errores DRF y de red:** Distribución por campo accesible y conservación del formulario ante fallos.
- [x] **Evidencia y contrato validado:** [`CONTRATO_PATCH_SUSCRIPCION_SE25.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_PATCH_SUSCRIPCION_SE25.md).

### SE-26
- [x] **Distinción explícita de cancelación de servicio:** Modal aclara impacto en seguimiento vs cobro del proveedor externo.
- [x] **Cancelar diálogo no cambia datos:** Cierra el modal sin llamadas a la API ni navegación.
- [x] **DELETE correcto retira del panel:** Ejecuta `DELETE /suscripciones/<id>/`, vacía el stack con `popTo('HomeScreen')` (P2) y actualiza listado por foco.
- [x] **Evidencia y contrato validado:** [`CONTRATO_RETIRO_SUSCRIPCION_SE26.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_RETIRO_SUSCRIPCION_SE26.md).

---

## 3. Pruebas y Evidencia de Verificación

Comandos de validación ejecutados:
```bash
# 1. Pruebas de edición de suscripción (28/28 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/SuscripcionEditarScreen.test.tsx

# 2. Pruebas de detalle, conciliación y confirmación de retiro (27/27 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/SuscripcionDetalleScreen.test.tsx

# 3. Pruebas de navegación e integración de stack popTo (19/19 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/navigation/navigation.test.tsx

# 4. Suite completa del workspace móvil (22 archivos, 380/380 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil

# 5. Chequeo estricto de tipos TypeScript en todo el monorepo (0 errores)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm run typecheck
```

- **Cobertura en las suites involucradas:**
  - `SuscripcionEditarScreen.test.tsx`: 28 pruebas aprobadas (SE-24 y SE-25, incluyendo P2 de no mutación de estado).
  - `SuscripcionDetalleScreen.test.tsx`: 27 pruebas aprobadas (SE-21, SE-25 y SE-26).
  - `navigation.test.tsx`: 19 pruebas aprobadas (incluyendo pruebas de stack limpio con `popTo` para edición y retiro).
  - `SuscripcionNuevaScreen.test.tsx`: 25 pruebas aprobadas.
  - `HomeScreen.test.tsx`: 23 pruebas aprobadas.
- **Resultado global móvil:** 22 suites pasadas, **380/380 pruebas aprobadas**.
- **Chequeo de tipos:** 0 errores en todos los paquetes (`shared`, `web`, `movil`, `desktop` y `extension`).

---

## 4. Archivos Modificados y Creados

```
frontend/movil/
├── docs/
│   ├── CONTRATO_FORMULARIO_EDITAR_SUSCRIPCION_SE24.md
│   ├── CONTRATO_PATCH_SUSCRIPCION_SE25.md
│   ├── CONTRATO_RETIRO_SUSCRIPCION_SE26.md
│   └── PR_SPRINT3_SE24_SE25_SE26.md
├── src/
│   ├── navigation/
│   │   ├── HomeNavigator.tsx
│   │   ├── navigation.test.tsx
│   │   └── types.ts
│   └── screens/
│       └── home/
│           ├── ConfirmarRetiroModal.tsx
│           ├── SuscripcionDetalleScreen.styles.ts
│           ├── SuscripcionDetalleScreen.test.tsx
│           ├── SuscripcionDetalleScreen.tsx
│           ├── SuscripcionEditarScreen.test.tsx
│           ├── SuscripcionEditarScreen.tsx
│           └── SuscripcionNuevaScreen.test.tsx
└── test/
    └── react-native-shim.tsx
```

---

## 5. Mensajes de Commit Asociados en la Rama

- `0c4d4e7`: `SE_24` (Crear formulario móvil de edición, precarga, validación de fechas reales y catálogo)
- `c1cca97`: `SE-25` (Conectar PATCH móvil, cálculo diferencial `calcularPatch`, antirrebote y conciliación con detalle y listado)
- `f4d7c4d`: `SE-26` (Confirmar retiro, modal con distinción de proveedor, ejecución de DELETE móvil y conciliación)
- `[Pendiente]`: `fix(movil): resolver P2 en PATCH sin estado y navegación limpia con popTo (SE-25, SE-26)`
