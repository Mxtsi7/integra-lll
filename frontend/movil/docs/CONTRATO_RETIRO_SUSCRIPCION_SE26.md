# Contrato de Integración: Confirmar Retiro y Ejecutar DELETE Móvil (SE-26)

- **Tarjeta:** SE-26 (Confirmar retiro y ejecutar DELETE móvil)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Depende de:**
  - [SE-21] Construir Detalle móvil de suscripción
- **Desbloquea a:** Aceptación de su funcionalidad y revisión del conjunto del flujo de suscripciones móviles.
- **Implementación de referencia:**
  - [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts)
  - [`frontend/movil/src/screens/home/ConfirmarRetiroModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/ConfirmarRetiroModal.tsx)
  - [`frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)

---

## 1. Resumen y Propósito

Esta tarjeta conecta la acción `"Retirar Suscripción"` en la pantalla de detalle móvil con un diálogo de confirmación accesible ([`ConfirmarRetiroModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/ConfirmarRetiroModal.tsx)) y con la función compartida `eliminarSuscripcion(id)` (`DELETE /suscripciones/<id>/`).

Garantiza que:
1. **Distingue explícitamente entre retirar el registro y cancelar el servicio:**
   - **Retirar registro en la aplicación:** Elimina la suscripción del panel de seguimiento y ya no se contabiliza en los gastos de Ojo al Gasto.
   - **Cancelar servicio con el proveedor externo:** La advertencia aclara expresamente que retirar la suscripción de la app **NO detiene los cobros bancarios del proveedor** (ej. Netflix, Spotify). Para ello, el usuario debe cancelar el servicio directamente con la empresa proveedora.
2. **Criterio 1 — Cancelar diálogo no cambia datos:**
   - Si el usuario pulsa `"Cancelar"`, el modal se cierra sin invocar `DELETE`, sin alterar el estado y sin navegar fuera del detalle.
3. **Criterio 2 — DELETE correcto retira del panel y conserva semántica histórica backend:**
   - Al confirmar, se despacha `DELETE /suscripciones/<id>/`.
   - Protección antirrebote (`isDeleting`): bloquea doble pulsación concurrente.
   - Solo tras respuesta HTTP exitosa (204 No Content), se cierra el diálogo y se ejecuta `navigation.goBack()` (o retorno a `HomeScreen`).
   - Al regresar a `HomeScreen`, su listener del evento de foco (`focus`) recarga la lista de suscripciones (`getSuscripciones()`), reflejando la salida de la entidad retirada y recalculando los totales mensuales.

---

## 2. Componente `ConfirmarRetiroModal` y Accesibilidad

### 2.1. Propiedades (Props)

```typescript
export interface ConfirmarRetiroModalProps {
  visible: boolean;
  nombreSuscripcion: string;
  onConfirmar: () => void;
  onCancelar: () => void;
  isDeleting?: boolean;
  error?: string | null;
}
```

### 2.2. Roles y TestIDs

| Elemento | TestID | Rol de Accesibilidad | Función |
| :--- | :--- | :--- | :--- |
| **Modal Contenedor** | `modal-confirmar-retiro` | `dialog` / `alertdialog` | Modal accesible con fondo translúcido. |
| **Título** | `titulo-confirmar-retiro` | `header` | "¿Retirar {nombreSuscripcion}?". |
| **Mensaje de retiro** | `mensaje-retiro-registro` | `text` | Explica que se retira del panel de seguimiento sin deshacer. |
| **Aviso de distinción** | `aviso-distincion-cancelar` | `text` | Aclara que no cancela el cobro con el proveedor externo. |
| **Alerta de fallo** | `error-retiro` | `alert` | Mensaje claro de error ante fallo de red o backend. |
| **Botón Cancelar** | `btn-cancelar-retiro` | `button` | Cierra el diálogo sin cambios (`disabled={isDeleting}`). |
| **Botón Confirmar** | `btn-confirmar-retiro` | `button` | Ejecuta DELETE (`loading={isDeleting}`, `disabled={isDeleting}`). |

---

## 3. Matriz de Errores y Conservación

| Escenario | Condición | Comportamiento en UI | Estado de Datos |
| :--- | :--- | :--- | :--- |
| **Cancelar en Diálogo** | Clic en `btn-cancelar-retiro` | Modal se cierra inmediatamente. | Sin llamadas HTTP. Suscripción conservada en detalle y listado. |
| **Éxito DELETE (204)** | Petición completada | Modal se cierra y desapila con `popTo('HomeScreen')`. Foco recarga listado. | Suscripción retirada del panel y recalculados los totales. |
| **Fallo API (403/404/500)** | Error retornado por servidor | Modal permanece visible mostrando `error-retiro` con rol `alert`. Botones se rehabilitan. | No navega. Pantalla de detalle se conserva íntegra. |
| **Fallo de Red / Desconexión**| Excepción de red / timeout | Muestra alerta accesible de conexión en `error-retiro`. Botones se rehabilitan. | No navega. Permite reintentar o cancelar. |
| **Doble Clic Rápido** | Pulsación concurrente | Candado `eliminandoRef` y `isDeleting` bloquea el segundo clic. | Exactamente un único `DELETE` enviado al backend. |

---

## 4. Puntos de Integración

- **Conexión con Pantalla de Detalle:**
  `SuscripcionDetalleScreen` expone:
  - `onEliminarSuscripcion?: (id: string) => Promise<void>` (por defecto `eliminarSuscripcion` de `@ojoalgasto/shared`).
  - `onRetiroExitoso?: (id: string) => void`.
- **Navegación limpia con `popTo` (P2):**
  Al completar el retiro, se utiliza `(navigation as any).popTo('HomeScreen')` para vaciar las pantallas intermedias del stack (`SuscripcionDetalle` y cualquier `SuscripcionEditar` anterior), impidiendo que al volver atrás reaparezca la entidad eliminada.
- **Conciliación con `HomeScreen`:**
  El listener `navigation.addListener('focus', ...)` en `HomeScreen` garantiza que al volver tras el retiro, la lista se actualice directamente contra la fuente de verdad del backend.

---

## 5. Mensajes de Commit Propuestos

### Formato Convencional Detallado (Recomendado)

```text
feat(movil): confirmar retiro y ejecutar DELETE de suscripción móvil (SE-26)

- Crear ConfirmarRetiroModal distinguiendo entre retiro de seguimiento y cancelación con el proveedor.
- Criterio 1: Cancelar en el diálogo no muta datos, no invoca la API ni navega.
- Criterio 2: Confirmar retiro ejecuta eliminarSuscripcion (DELETE), protegiendo contra doble envío y navegando al listado solo tras confirmación 204.
- SuscripcionDetalleScreen: integrar modal de retiro, manejo de errores accesibles y sincronización con foco en HomeScreen.
- Cobertura de pruebas unitarias e integración en SuscripcionDetalleScreen.test.tsx y soporte de Modal en test shim.
```

### Formato Corto

```text
SE-26: modal de confirmación de retiro y ejecución de DELETE móvil
```
