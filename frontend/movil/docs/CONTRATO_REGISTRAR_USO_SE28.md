# Contrato de Integración: Registrar Minutos de Uso desde Móvil (SE-28)

- **Tarjeta:** SE-28 (Registrar minutos de uso desde móvil)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Prioridad:** Should / P1
- **Dependencias satisfechas:**
  - `[SE-21] Construir Detalle móvil de suscripción` · Sebastian Mena (expone `seccion-historial-uso` y `btn-registrar-uso`).
  - `[VI-10] Completar uso, agregados mensuales y última actividad` · Victor Gonzales (backend `POST /suscripciones/<id>/uso/` y funciones en `@ojoalgasto/shared`).
- **Implementación de referencia:**
  - [`frontend/movil/src/screens/home/RegistrarUsoFormMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoFormMovil.tsx)
  - [`frontend/movil/src/screens/home/RegistrarUsoModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoModal.tsx)
  - [`frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)
  - [`frontend/movil/src/screens/home/RegistrarUso.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUso.test.tsx)

---

## 1. Resumen y Propósito

El contrato SE-28 implementa la funcionalidad móvil para que los usuarios registren minutos de uso en sus suscripciones. Permite registrar el tiempo de uso manual y opcionalmente especificar la fecha del registro (con valor predeterminado de la fecha de hoy), validando los datos con las reglas de negocio idénticas a las del backend (`RegistrarUsoSerializer`), evitando dobles envíos y actualizando inmediatamente las métricas reactivas de horas de uso y costo por hora estimado en la pantalla de detalle.

---

## 2. Componentes y Contratos de Interfaz

### 2.1. `RegistrarUsoFormMovil`

Componente de formulario reutilizable para la captura y validación de minutos y fecha:

```typescript
export interface RegistrarUsoFormMovilProps {
  idSuscripcion: string;
  nombreSuscripcion?: string;
  onRegistrar: (minutos: number, fecha?: string) => Promise<Suscripcion>;
  onExito?: (suscripcionActualizada: Suscripcion) => void;
  onCancelar?: () => void;
  bloqueado?: boolean;
  sigueVigente?: () => boolean;
}
```

### 2.2. `RegistrarUsoModal`

Modal accesible que encapsula el formulario dentro de un diálogo con overlay translúcido:

```typescript
export interface RegistrarUsoModalProps extends RegistrarUsoFormMovilProps {
  visible: boolean;
}
```

### 2.3. Integración en `SuscripcionDetalleScreen`

`SuscripcionDetalleScreen` añade los siguientes props de inyección:

```typescript
export interface SuscripcionDetalleContainerProps {
  // ...props existentes (SE-21, SE-26)
  onRegistrarUso?: (suscripcion: Suscripcion) => void;
  onRegistrarUsoApi?: (id: string, payload: { minutos: number; fecha?: string }) => Promise<Suscripcion>;
  onUsoRegistrado?: (suscripcionActualizada: Suscripcion) => void;
}
```

- Al pulsar `btn-registrar-uso`, se abre `RegistrarUsoModal` (y se notifica al listener externo si fue provisto).
- Al completar el registro, actualiza `estado`: `setEstado({ tipo: 'listo', suscripcion: actualizada })`, recalculando reactivamente `horas_uso_mes` y `costoPorHora` en el detalle.

---

## 3. Matriz de Validación y Comportamiento

| Campo / Caso | Entrada del Usuario | Validación / Comportamiento | Criterio de Aceptación |
| :--- | :--- | :--- | :--- |
| **Minutos vacíos** | `""` | Error: `"Ingresa los minutos de uso."` | No se envía a la API ni se confirma guardado. |
| **Minutos cero o negativos** | `"0"`, `"-15"` | Error: `"Los minutos de uso no pueden ser negativos ni cero."` | No se envía a la API ni se confirma guardado. |
| **Minutos no enteros** | `"12.5"`, `"abc"` | Error: `"Los minutos deben ser un número entero válido."` | No se envía a la API ni se confirma guardado. |
| **Exceso de límite** | `> 44640` | Error: `"Los minutos de uso no pueden superar el máximo mensual (44.640 minutos)."` | No se envía a la API ni se confirma guardado. |
| **Fecha inexistente** | `"2026-02-30"` | Error: `"Esa fecha no existe."` | No se envía a la API ni se confirma guardado. |
| **Fecha futura** | `> hoy` | Error: `"No se puede registrar uso de una fecha futura."` | No se envía a la API ni se confirma guardado. |
| **Fecha en blanco** | `""` o espacios | Omite la propiedad `fecha` (`undefined`) en el payload para que el backend use hoy. | **Criterio 1:** Registro exitoso. |
| **Registro positivo (mes actual)** | `minutos > 0`, fecha del mes | Llama a `onRegistrar(minutos, fecha)`. Al resolver: limpia minutos, muestra `"Registraste X minutos."` y actualiza métricas. | **Criterio 1:** Registro positivo actualiza métricas. |
| **Registro positivo (mes anterior)** | `minutos > 0`, fecha mes previo | Muestra `"Registraste X minutos el DD mes AAAA. No suma a las horas de este mes."` (VI-10). | **Criterio 1:** Historial actualizado, sin alterar horas del mes actual. |
| **Doble click / tap rápido** | Múltiples pulsaciones | `enviandoRef.current = true`, botón deshabilitado (`aria-disabled="true"`), previene duplicación. | Bloqueo de doble envío verificado. |
| **Error 400 por campo API** | Rechazo DRF | `erroresDesdeServidor` ubica el mensaje bajo el campo correspondiente y preserva el valor escrito. | **Criterio 2:** Error no se presenta como guardado. |
| **Error general / de red** | 500 o fallo de conexión | Muestra alerta accesible en `error-general` y no confirma guardado. | **Criterio 2:** Error no se presenta como guardado. |

---

## 4. TestIDs y Roles de Accesibilidad

| Elemento | TestID | Rol | Función |
| :--- | :--- | :--- | :--- |
| **Modal Contenedor** | `modal-registrar-uso` | `none` (Modal) | Diálogo emergente con fondo translúcido. |
| **Tarjeta del Modal** | N/A | `alert` | Contenedor accesible del modal. |
| **Título del Modal** | `titulo-modal-registrar-uso` | `header` | Encabezado descriptivo con el nombre del servicio. |
| **Formulario de Uso** | `form-registrar-uso` | `none` (View) | Contenedor del formulario. |
| **Input Minutos** | `input-minutos` | `none` (TextInput) | Input numérico para minutos de uso (`aria-invalid`). |
| **Error Minutos** | `error-minutos` | `alert` | Mensaje de validación local o del servidor para minutos. |
| **Input Fecha** | `input-fecha` | `none` (TextInput) | Input de texto para fecha `AAAA-MM-DD` (`aria-invalid`). |
| **Error Fecha** | `error-fecha` | `alert` | Mensaje de validación local o del servidor para fecha. |
| **Error General** | `error-general` | `alert` | Caja de error para fallos de red o 500 del servidor. |
| **Confirmación de Uso** | `confirmacion-uso` | `status` | Mensaje accesible de confirmación tras guardado exitoso. |
| **Botón Enviar** | `btn-submit-uso` | `button` | Dispara el envío con bloqueo concurrente (`aria-disabled`). |
| **Botón Cancelar** | `btn-cancelar-uso` | `button` | Cierra el diálogo sin guardar. |

---

## 5. Evidencia de Pruebas

Comandos ejecutados y verificados:

```bash
# Pruebas unitarias y de integración de Registrar Uso (12/12)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/RegistrarUso.test.tsx

# Pruebas de Detalle de Suscripción (27/27)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/SuscripcionDetalleScreen.test.tsx

# Suite completa del workspace móvil (24 archivos, 461/461)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil

# Typecheck TypeScript (0 errores)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm run typecheck
```
