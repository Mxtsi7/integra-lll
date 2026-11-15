# Contrato de Interfaz: Formulario Móvil de Nueva Suscripción (SE-22)

- **Tarjeta:** SE-22 (Crear formulario móvil de nueva suscripción)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Depende de:** SE-06 (Navegación principal móvil)
- **Desbloquea a:**
  - **SE-23:** Conectar creación móvil y actualizar listado (Sebastian Mena)
  - **SE-31:** Avisar cambios sin guardar en móvil (Sebastian Mena)
- **Implementación de referencia:** `frontend/web/src/components/subscriptions/NuevaSuscripcionForm.tsx`

---

## 1. Resumen y Propósito

El componente `NuevaSuscripcionFormView` y su contenedor de pantalla `SuscripcionNuevaScreen` proveen la interfaz accesible y validada para que los usuarios puedan dar de alta una nueva suscripción en la aplicación móvil, cumpliendo con los contratos de validación compartidos de `@ojoalgasto/shared` y el comportamiento UX del formulario web.

---

## 2. Componentes Expuestos

### 2.1. `NuevaSuscripcionFormView`

Componente desacoplado de la API y de la navegación directa. Adecuado para pruebas unitarias, incrustación en modales o pantallas completas.

```tsx
import {
  NuevaSuscripcionFormView,
  type NuevaSuscripcionFormViewProps,
  type NuevaSuscripcionFormData,
} from './SuscripcionNuevaScreen';
```

#### Props

| Prop | Tipo | Obligatorio | Descripción |
| :--- | :--- | :---: | :--- |
| `catalogos` | `CatalogosSuscripciones \| null` | No | Opciones dinámicas y predeterminados provenientes del backend (`getCatalogosSuscripciones`). Si se omite, usa catálogo local seguro por defecto. |
| `opciones` | `OpcionesSuscripcion` | No | Opciones permitidas de monedas, frecuencias y categorías para validación. |
| `onSubmit` | `(datos: SuscripcionPayload) => Promise<boolean \| void> \| boolean \| void` | No | **Punto de integración para SE-23**. Se ejecuta tras superar todas las validaciones locales. Si resuelve `true` o `void`, el formulario se limpia; si rechaza o resuelve `false`, los datos se mantienen. |
| `onCancel` | `() => void` | No | Callback ejecutado al pulsar "Cancelar y Volver". |
| `isSaving` | `boolean` | No | Bloquea la interacción, deshabilita inputs y muestra spinner en el botón de guardado. |
| `errorGeneral` | `string \| null` | No | Mensaje general de error (problemas de red, error 500, etc.). Se anuncia con rol `alert`. |
| `erroresCampos` | `Record<string, string[]> \| null` | No | Errores por campo retornados por la API (Django REST Framework). Se mapean a sus respectivos campos con `erroresDesdeServidor`. |
| `onCambiosSinGuardar` | `(hayCambios: boolean) => void` | No | **Punto de integración para SE-31**. Notifica `true` cuando el formulario difiere de su estado inicial y `false` cuando está sin tocar o restaurado. |
| `testID` | `string` | No | Identificador para pruebas automatizadas (por defecto `'screen-suscripcion-nueva'`). |

---

### 2.2. `SuscripcionNuevaScreen`

Contenedor de pantalla registrado en el stack de navegación (`HomeStackParamList['SuscripcionNueva']`).

```tsx
import SuscripcionNuevaScreen from './SuscripcionNuevaScreen';
```

Conecta la acción `onCancel` con `navigation.goBack()` y expone `testID="screen-suscripcion-nueva"` y `testID="go-back"`.

---

## 3. Formato del Payload de Creación (`SuscripcionPayload`)

Generado por `NuevaSuscripcionFormView` al invocar `onSubmit`:

```typescript
export interface SuscripcionPayload {
  nombre: string;
  monto: number;
  moneda: string;
  frecuencia: 'mensual' | 'anual' | 'semanal' | 'trimestral' | 'semestral';
  fecha_proximo_cobro: string; // Formato YYYY-MM-DD
  categoria: string;
  estado: 'activo' | 'prueba';
  fin_prueba?: string; // Formato YYYY-MM-DD (solo presente si estado === 'prueba')
}
```

---

## 4. Reglas de Validación Locales (Criterio 1)

Basadas estrictamente en `@ojoalgasto/shared`:

| Campo | Regla | Mensaje Accesible de Error |
| :--- | :--- | :--- |
| **`nombre`** | Requerido | `"Ingresa el nombre del servicio."` |
| **`nombre`** | Longitud $\le 100$ | `"El nombre puede tener hasta 100 caracteres."` |
| **`monto`** | Requerido | `"Ingresa el monto."` |
| **`monto`** | Positivo ($> 0$) | `"El monto debe ser mayor a 0."` |
| **`monto`** | Máximo 2 decimales | `"Usa como máximo 2 decimales."` |
| **`monto`** | Solo números y coma/punto | `"Ingresa un monto válido, solo con números."` |
| **`monto`** | $\le 99.999.999,99$ | `"El monto no puede superar 99.999.999,99."` |
| **`moneda`** | Pertenecer a opciones | `"Elige una moneda de la lista."` |
| **`frecuencia`** | Pertenecer a opciones | `"Elige cada cuánto se cobra."` |
| **`categoria`** | Pertenecer a opciones | `"Elige una categoría de la lista."` |
| **`fechaDeCobro`** | Requerido | `"Ingresa la fecha del próximo cobro."` |
| **`fechaDeCobro`** | Fecha real (YYYY-MM-DD) | `"Esa fecha no existe."` |
| **`finPrueba`** | Requerido si `enPrueba === true` | `"Ingresa cuándo termina la prueba."` |
| **`finPrueba`** | Fecha real si `enPrueba === true` | `"Esa fecha no existe."` |

### Limpieza de Errores
Al modificar o corregir cualquier campo, su error asociado se elimina de forma inmediata sin necesidad de reintentar el guardado.

---

## 5. Conservación de Valores (Criterio 2)

El formulario conserva todos los datos escritos en las siguientes circunstancias:
1. **Ocultamiento de teclado:** Al tocar fuera o arrastrar el scroll (`keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`).
2. **Re-renderizado / cambio de orientación:** El estado local de React mantiene todos los campos intactos.
3. **Fallo en el guardado:** Si `onSubmit` rechaza la promesa o retorna `false`, los campos **no** se limpian para evitar que el usuario deba reescribir la información.
4. **Reseteo controlado:** El formulario únicamente se restablece a los valores por defecto tras un guardado confirmado exitoso o una cancelación explícita.

---

## 6. Identificadores de Accesibilidad y Testing

| Elemento | `testID` | Rol Accesible |
| :--- | :--- | :--- |
| Contenedor raíz | `screen-suscripcion-nueva` | - |
| Input de Servicio | `input-nombre` | - |
| Error de Servicio | `error-nombre` | `alert` |
| Input de Monto | `input-monto` | - |
| Error de Monto | `error-monto` | `alert` |
| Selector de Moneda | `selector-moneda` | - |
| Opción de Moneda | `opcion-moneda-${codigo}` | `button` (`selected`) |
| Error de Moneda | `error-moneda` | `alert` |
| Selector de Frecuencia | `selector-frecuencia` | - |
| Opción de Frecuencia | `opcion-frecuencia-${codigo}` | `button` (`selected`) |
| Error de Frecuencia | `error-frecuencia` | `alert` |
| Selector de Categoría | `selector-categoria` | - |
| Opción de Categoría | `opcion-categoria-${codigo}` | `button` (`selected`) |
| Error de Categoría | `error-categoria` | `alert` |
| Input de Próximo Cobro | `input-fecha-cobro` | - |
| Error de Próximo Cobro | `error-fecha-cobro` | `alert` |
| Checkbox Prueba Gratis | `checkbox-en-prueba` | `checkbox` (`checked`) |
| Input Fin de Prueba | `input-fin-prueba` | - |
| Error Fin de Prueba | `error-fin-prueba` | `alert` |
| Mensaje General / Servidor | `error-general` | `alert` |
| Botón Guardar | `btn-guardar-suscripcion` | `button` (`disabled`, `busy`) |
| Botón Cancelar y Volver | `go-back` | `button` |
