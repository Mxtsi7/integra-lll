# Contrato de Integración: Conectar PATCH Móvil y Actualizar Detalle (SE-25)

- **Tarjeta:** SE-25 (Conectar PATCH móvil y actualizar detalle)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Depende de:**
  - [SE-07] Configurar cliente HTTP móvil por entorno
  - [SE-24] Crear formulario móvil de edición
- **Desbloquea a:** Aceptación de su funcionalidad y revisión del conjunto del flujo de suscripciones móviles.
- **Implementación de referencia:** [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) y [`SuscripcionEditarScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx)

---

## 1. Resumen y Propósito

Esta tarjeta conecta la pantalla de edición móvil ([`SuscripcionEditarScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx)) con la función de API compartida `actualizarSuscripcion(id, datos)` (`PATCH /suscripciones/<id>/`). 

Garantiza que:
1. **El PATCH no borre campos omitidos (Criterio 1):** Solo los campos efectivamente alterados por el usuario se empaquetan en el cuerpo del PATCH; cualquier campo no modificado se omite de forma estricta.
2. **El detalle y el listado muestren el mismo valor confirmado (Criterio 2):** Tras el guardado exitoso (HTTP 200), se navega al detalle con la entidad actualizada retornada por el servidor, y al regresar al listado ([`HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx)), el evento de foco recarga la lista mostrando idéntico valor.
3. **Distribución de errores por campo y de red:** Ante errores DRF 400 (`err.campos`), se mapean a sus respectivos campos con rol `alert`; ante desconexión o 500, se muestra alerta general sin perder los datos tipeados.

---

## 2. Cálculo Diferencial del Payload (`calcularPatch`)

Para evitar sobrescribir o limpiar propiedades que no fueron tocadas, se computa la diferencia estricta entre `EditarSuscripcionFormData` y la entidad original `Suscripcion`:

```typescript
export function calcularPatch(
  datos: EditarSuscripcionFormData,
  original: Suscripcion,
): SuscripcionPayloadParcial {
  const patch: SuscripcionPayloadParcial = {};

  if (datos.nombre.trim() !== original.nombre) {
    patch.nombre = datos.nombre.trim();
  }

  const parseado = parsearMonto(datos.monto);
  if ('valor' in parseado && parseado.valor !== Number(original.monto)) {
    patch.monto = parseado.valor;
  }

  if (datos.moneda !== original.moneda) {
    patch.moneda = datos.moneda;
  }

  if (datos.frecuencia !== original.frecuencia) {
    patch.frecuencia = datos.frecuencia;
  }

  if (datos.categoria !== original.categoria) {
    patch.categoria = datos.categoria;
  }

  if (datos.fechaDeCobro !== (original.fecha_proximo_cobro ?? '')) {
    patch.fecha_proximo_cobro = datos.fechaDeCobro;
  }

  // Solo si la suscripción original está en prueba, permite actualizar la fecha fin_prueba.
  // IMPORTANTE: Nunca se envía estado en el PATCH porque services/subscriptions/app/views.py:1081-1093
  // prohíbe modificaciones directas de estado vía PATCH y responde 400.
  if (
    original.estado === 'prueba' &&
    datos.finPrueba &&
    datos.finPrueba !== (original.fin_prueba ?? '')
  ) {
    patch.fin_prueba = datos.finPrueba;
  }

  return patch;
}
```

### Garantía Contractual:
- Si el usuario modifica exclusivamente el monto (ej. $5.990 \to \$7.990$), el body del PATCH es `{ monto: 7990 }`.
- No viajan `nombre`, `moneda`, `categoria` ni ningún otro campo inalterado. El backend conserva sus valores previos intactos.
- **Resolución P2:** Bajo ninguna circunstancia se envía el campo `estado` en el PATCH. El backend rechaza modificaciones directas de estado vía PATCH (HTTP 400). Si la suscripción ya estaba en prueba, se permite ajustar `fin_prueba` sin mutar `estado`.

---

## 3. Conciliación entre Pantalla de Detalle y Listado

### 3.1. Retorno y Navegación tras Éxito (React Navigation 7 `popTo`)
Al resolver `actualizarSuscripcion` con éxito:
```typescript
const actualizada = await onActualizarSuscripcion(suscripcionActual.id, patch);
onExito?.(actualizada);

// Conciliar y volver al detalle existente con la suscripción confirmada (React Navigation 7 popTo)
if (typeof (navigation as any)?.popTo === 'function') {
  (navigation as any).popTo('SuscripcionDetalle', {
    id: actualizada.id,
    suscripcion: actualizada,
  });
} else if (navigation?.navigate) {
  navigation.navigate('SuscripcionDetalle', {
    id: actualizada.id,
    suscripcion: actualizada,
  });
} else if (navigation?.goBack) {
  navigation.goBack();
}
```

**Resolución P2 (Stack Navigation):** `navigation.popTo('SuscripcionDetalle', ...)` desapila la pantalla de edición (`SuscripcionEditarScreen`) y transfiere la entidad actualizada directamente a la pantalla de detalle preexistente. Al presionar "Volver" desde el detalle, se regresa directo a `HomeScreen`, sin pantallas "zombie" de edición en la pila.

### 3.2. Sincronización en `SuscripcionDetalleScreen`
1. **Inmediata:** Si recibe `route.params.suscripcion`, conmuta su estado a `listo` con la nueva entidad.
2. **Garantía por foco:** El listener `navigation?.addListener?.('focus', ...)` reejecuta `cargarDatos(id)` asegurando consistencia con el servidor.

### 3.3. Sincronización en `HomeScreen`
`HomeScreen` cuenta con suscripción a foco (`navigation?.addListener?.('focus', ...)`), por lo que al volver al listado, se invoca `getSuscripciones()` y se recalculan los totales del mes incorporando exactamente el valor confirmado.

---

## 4. Matriz de Errores y Conservación

| Tipo de Fallo | Origen | Manejo en UI | Formulario |
| :--- | :--- | :--- | :--- |
| **Error DRF por campo** | HTTP 400 (`err.campos`) | Se reparten mediante `erroresDesdeServidor`. Se muestran bajo su campo con rol `alert` (`error-monto`, `error-nombre`, etc.). | **Totalmente preservado.** |
| **Error General DRF** | HTTP 403 / 500 (`err.message`) | Caja de alerta superior (`testID="error-general"`). | **Totalmente preservado.** |
| **Desconexión / Red** | `TypeError` (offline) | Mensaje accesible de conexión en alerta superior. | **Totalmente preservado.** |

---

## 5. Mensaje de Commit Propuesto

### Formato Convencional Detallado (Recomendado)

```text
feat(movil): conectar PATCH móvil y conciliar detalle y listado (SE-25)

- Implementar función calcularPatch para emitir únicamente campos modificados en PATCH.
- Criterio 1: Asegurar que el PATCH no borre campos omitidos en el backend.
- Criterio 2: Conciliar SuscripcionDetalle y HomeScreen con el valor confirmado tras éxito mediante navegación y eventos de foco.
- Conectar actualizarSuscripcion en SuscripcionEditarScreen con protección antirrebote concurrente.
- Distribuir errores DRF por campo o generales preservando todos los datos del formulario.
- SuscripcionDetalleScreen: sincronizar suscripcion por route params y recargar ante foco.
- Cobertura de pruebas unitarias e integración en SuscripcionEditarScreen y SuscripcionDetalleScreen.
```

### Formato Corto

```text
SE-25: conectar PATCH móvil, cálculo diferencial de campos y conciliación de detalle
```
