# Contrato de Interfaz: Formulario Móvil de Edición de Suscripción (SE-24)

- **Tarjeta:** SE-24 (Crear formulario móvil de edición)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Depende de:**
  - [SE-21] Construir Detalle móvil de suscripción
- **Desbloquea a:**
  - [SE-25] Conectar PATCH móvil y actualizar detalle (Sebastian Mena)
  - [SE-31] Avisar cambios sin guardar en móvil (Sebastian Mena)
- **Implementación de referencia:** `frontend/web/src/components/subscriptions/EditarSuscripcionForm.tsx` y [`SuscripcionNuevaScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx)

---

## 1. Resumen y Propósito

El componente [`EditarSuscripcionFormView`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx) y su pantalla contenedora [`SuscripcionEditarScreen`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionEditarScreen.tsx) proveen la interfaz móvil accesible para modificar campos autorizados de una suscripción propia existente (RF-08).

### Garantías Contractuales Clave:
1. **Precarga fiel de datos:** Recibe la entidad del dominio `Suscripcion` e inicializa el formulario con sus valores vigentes mediante `aFormulario(suscripcion)`.
2. **Protección de identidad y multi-tenancy:** Los identificadores `id` y `organizacion_id` (tenant) **nunca** son editables ni alterados por el formulario. El payload emitido hacia `onSubmit` conserva el `id` original de la suscripción.
3. **Cancelar conserva datos originales (Criterio 1):** La acción de cancelar (`onCancel` / `"Cancelar y Volver"`) no dispara guardados, no muta la entidad original y devuelve al usuario sin aplicar modificaciones.
4. **Campos opcionales y fechas en formato correcto (Criterio 2):**
   - `fechaDeCobro` (próximo cobro) es obligatoria y valida fecha real en formato `YYYY-MM-DD` con `esFechaReal`.
   - `finPrueba` es un campo opcional/condicional: si `enPrueba === false`, es opcional; si `enPrueba === true`, valida formato `YYYY-MM-DD` y fecha real.
   - `monto` se valida con `parsearMonto` (número positivo $> 0$ y máximo 2 decimales).
5. **Catálogo dinámico y opciones legadas:** Consume las opciones activas de `getCatalogosSuscripciones()`, pero permite preservar la moneda o categoría actual de la suscripción aunque figure inactiva en el catálogo (evita invalidar suscripciones preexistentes).

---

## 2. Definición de Tipos y Datos

### 2.1. Estructura de Datos del Formulario (`EditarSuscripcionFormData`)

```typescript
export interface EditarSuscripcionFormData {
  id: string; // Inmutable, extraído de la suscripción original
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: string;
  fechaDeCobro: string; // YYYY-MM-DD
  enPrueba: boolean;
  finPrueba: string; // YYYY-MM-DD (vacío si no está en prueba)
}
```

### 2.2. Conversión desde el Dominio (`aFormulario`)

```typescript
export function aFormulario(suscripcion: Suscripcion): EditarSuscripcionFormData {
  return {
    id: suscripcion.id,
    nombre: suscripcion.nombre ?? '',
    monto: String(suscripcion.monto),
    moneda: suscripcion.moneda,
    frecuencia: suscripcion.frecuencia,
    categoria: suscripcion.categoria,
    fechaDeCobro: suscripcion.fecha_proximo_cobro ?? '',
    enPrueba: suscripcion.estado === 'prueba',
    finPrueba: suscripcion.fin_prueba ?? '',
  };
}
```

---

## 3. Componentes Expuestos

### 3.1. `EditarSuscripcionFormView`

Componente presentacional desacoplado para pruebas y ensamblado de interfaz.

```tsx
import {
  EditarSuscripcionFormView,
  type EditarSuscripcionFormViewProps,
} from './SuscripcionEditarScreen';
```

#### Props

| Prop | Tipo | Obligatorio | Descripción |
| :--- | :--- | :---: | :--- |
| `suscripcion` | `Suscripcion` | Sí | Entidad original del dominio cuyas propiedades se precargan en el formulario. |
| `catalogos` | `CatalogosSuscripciones \| null` | No | Opciones dinámicas de la API (`getCatalogosSuscripciones`). |
| `cargandoCatalogos` | `boolean` | No | Indicador de descarga del catálogo (`testID="estado-carga-catalogos"`). |
| `errorCatalogo` | `string \| null` | No | Error de red o descarga del catálogo (`testID="error-catalogo"`). |
| `onReintentarCatalogos` | `() => void` | No | Callback para reintentar la descarga del catálogo. |
| `opciones` | `OpcionesSuscripcion` | No | Catálogo de opciones alternativo (para testing). |
| `onSubmit` | `(datos: EditarSuscripcionFormData) => Promise<boolean \| void> \| boolean \| void` | No | **Punto de integración para SE-25**. Se dispara tras superar validaciones locales. |
| `onCancel` | `() => void` | No | Callback ejecutado al presionar "Cancelar y Volver". |
| `isSaving` | `boolean` | No | Bloquea controles y muestra spinner mientras el PATCH está en vuelo. |
| `errorGeneral` | `string \| null` | No | Error general (500, conexión, etc.). |
| `erroresCampos` | `Record<string, string[]> \| null` | No | Errores por campo de la API (DRF 400). |
| `onCambiosSinGuardar` | `(hayCambios: boolean) => void` | No | **Punto de integración para SE-31**. Notifica `true` cuando `formData` difiere de su estado inicial. |
| `testID` | `string` | No | TestID del contenedor raíz (default: `'screen-suscripcion-editar'`). |

---

### 3.2. `SuscripcionEditarScreen`

Contenedor de pantalla registrado en navegación (`HomeStackParamList['SuscripcionEditar']`).

- Permite navegación desde `SuscripcionDetalleScreen` al pulsar `"Editar Suscripción"` (`testID="btn-editar-suscripcion"`).
- Recibe `route.params.suscripcion` o carga la suscripción por `id` vía `onCargarSuscripcion(id)`.
- Maneja la carga de catálogos y reintentos.
- Conecta `onCancel` con `navigation.goBack()`.

---

## 4. Matriz de Selectores y Accesibilidad

| Elemento | `testID` | Rol Accesible |
| :--- | :--- | :--- |
| Contenedor raíz | `screen-suscripcion-editar` | - |
| Input Servicio | `input-nombre` | - |
| Error Servicio | `error-nombre` | `alert` |
| Input Monto | `input-monto` | - |
| Error Monto | `error-monto` | `alert` |
| Selector Moneda | `selector-moneda` | `radiogroup` |
| Opción Moneda | `opcion-moneda-${codigo}` | `button` (`selected`) |
| Error Moneda | `error-moneda` | `alert` |
| Selector Frecuencia | `selector-frecuencia` | `radiogroup` |
| Opción Frecuencia | `opcion-frecuencia-${codigo}` | `button` (`selected`) |
| Error Frecuencia | `error-frecuencia` | `alert` |
| Selector Categoría | `selector-categoria` | `radiogroup` |
| Opción Categoría | `opcion-categoria-${codigo}` | `button` (`selected`) |
| Error Categoría | `error-categoria` | `alert` |
| Input Próximo Cobro | `input-fecha-cobro` | - |
| Error Próximo Cobro | `error-fecha-cobro` | `alert` |
| Checkbox Prueba Gratis | `checkbox-en-prueba` | `checkbox` (`checked`) |
| Input Fin de Prueba | `input-fin-prueba` | - |
| Error Fin de Prueba | `error-fin-prueba` | `alert` |
| Estado Carga Catálogos | `estado-carga-catalogos` | `progressbar` |
| Error Carga Catálogos | `error-catalogo` | `alert` |
| Botón Reintentar Catálogos | `btn-reintentar-catalogos` | `button` |
| Error General | `error-general` | `alert` |
| Botón Guardar Cambios | `btn-guardar-edicion` | `button` (`disabled`, `busy`) |
| Botón Cancelar y Volver | `go-back` | `button` |

---

## 5. Mensaje de Commit Propuesto

### Formato Convencional Detallado (Recomendado)

```text
feat(movil): crear formulario móvil de edición de suscripción (SE-24)

- Implementar EditarSuscripcionFormView y SuscripcionEditarScreen con precarga fiel de datos vía aFormulario.
- Proteger id y organizacion_id para asegurar inmutabilidad e impedir sobrescrituras.
- Criterio 1: Cancelar descarta modificaciones locales y conserva los datos originales sin mutar la entidad.
- Criterio 2: Validar formato YYYY-MM-DD y fecha real en fechaDeCobro y finPrueba (opcional/condicional).
- Soportar catálogo dinámico de opciones activas y permitir mantener opciones legadas inactivas preexistentes.
- Exponer puntos de integración para SE-25 (onSubmit) y SE-31 (onCambiosSinGuardar).
- Registrar ruta SuscripcionEditar en HomeNavigator y types.ts.
- Cobertura de pruebas unitarias (17/17) y 0 errores en typecheck.
```

### Formato Corto

```text
SE-24: formulario móvil de edición de suscripción, precarga y validación de fechas
```

