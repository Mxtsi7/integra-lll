# PR: Implementación Móvil Sprint 3 — SE-22 y SE-23

**Rama:** `SE_22&23`  
**Base:** `main`  
**Responsable:** Sebastian Mena  
**Tarjetas:** 
- `SE-22`: Crear formulario móvil de nueva suscripción (P1 / Must)
- `SE-23`: Conectar creación móvil y actualizar listado (P1 / Must)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen de Cambios

### SE-22: Crear formulario móvil de nueva suscripción
- **Alineación con el contrato de Web (`NuevaSuscripcionForm.tsx`) y `@ojoalgasto/shared`:**
  - Implementación desacoplada en [`NuevaSuscripcionFormView`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx#L107) (presentacional/aislado) y [`SuscripcionNuevaScreen`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx#L604) (contenedor de navegación).
  - **Campos tipados y validados:**
    - `nombre`: obligatorio, hasta 100 caracteres (`LARGO_MAXIMO_NOMBRE_SUSCRIPCION`).
    - `monto`: entrada de texto con teclado decimal (`inputMode="decimal"`), acepta punto y coma, valor positivo $> 0$, máximo 2 decimales y hasta $99.999.999,99$ vía `parsearMonto`.
    - `moneda`: selección interactiva (chips accesibles) con opciones activas de catálogo y valor predeterminado (CLP).
    - `frecuencia`: selección interactiva (mensual, anual, etc.) con opciones y valor predeterminado (mensual).
    - `categoria`: selección interactiva (streaming, software, salud, etc.) con opciones y valor predeterminado (streaming).
    - `fechaDeCobro`: fecha en formato `YYYY-MM-DD` validada con `esFechaReal`.
    - `enPrueba`: casilla de verificación accesible (`role="checkbox"`) para suscripciones en período de prueba gratis.
    - `finPrueba`: campo condicional obligatorio únicamente si `enPrueba === true`, validado con `esFechaReal`.
- **Identificación accesible de errores por campo (Criterio 1):**
  - Cada campo cuenta con su propio mensaje de error accesible (`testID="error-${campo}"`, `accessibilityRole="alert"`, `accessibilityLiveRegion="polite"`).
  - Limpieza individual inmediata del error (`CAMPO_DEL_ERROR`) al modificar o corregir el campo correspondiente.
- **Conservación de valores (Criterio 2):**
  - Los datos escritos se mantienen íntegros en el estado local de React ante eventos de cierre de teclado (`keyboardDismissMode="on-drag"`, `keyboardShouldPersistTaps="handled"`), desenfoque (`blur`), re-renderizados del componente padre o fallos en el envío.
  - El formulario únicamente se reinicia tras un guardado confirmado exitoso o al pulsar "Cancelar y Volver".
- **Puntos de integración expuestos:**
  - `onSubmit?: (datos: SuscripcionPayload) => Promise<boolean | void> | boolean | void` para **SE-23**.
  - `onCambiosSinGuardar?: (hayCambios: boolean) => void` para **SE-31** (detecta diferencias con el estado inicial).
  - Botón `"Cancelar y Volver"` (`testID="go-back"`) conectado a `navigation.goBack()`.
- **Hoja de estilos modular ([`SuscripcionNuevaScreen.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.styles.ts)):**
  - Estilos oscuros consistentes con el diseño móvil (`#0f172a`, `#1e293b`, `#334155`), inputs con touch target $\ge 44\text{px}$, estados de foco/error y chips seleccionables.

### SE-23: Conectar creación móvil y actualizar listado
- **Conexión con endpoint real `crearSuscripcion`:**
  - El contenedor `SuscripcionNuevaScreen` conecta `NuevaSuscripcionFormView` con `crearSuscripcion` de `@ojoalgasto/shared`.
  - Construye y despacha el payload tipado `SuscripcionPayload` (`nombre`, `monto` numérico, `moneda`, `frecuencia`, `fecha_proximo_cobro`, `categoria`, `estado`, `fin_prueba`).
- **Bloqueo estricto de doble envío (Antirrebote concurrente):**
  - Doble barrera: referencia sincrónica (`guardandoRef.current`) y estado reactivo (`isSaving`).
  - Previene que toques repetidos o rápidos envíen múltiples peticiones mientras una está en vuelo: exactamente una petición POST es enviada.
- **Reflejo de respuestas y errores del servidor:**
  - **Errores de validación DRF (HTTP 400):** Mapeo de `err.campos` vía `erroresDesdeServidor`, ubicando cada error junto a su respectivo campo en la interfaz.
  - **Errores de red o servidor (HTTP 500 / `TypeError`):** Notificación en contenedor de alerta superior (`testID="error-general"`).
  - **Conservación garantizada:** Si la petición falla, el formulario mantiene todos los campos intactos para permitir reintentar y **nunca inserta un registro ficticio ni en el estado ni en la lista**.
- **Invalidación de listado en `HomeScreen` y navegación al resultado:**
  - Al completar la creación con éxito (HTTP 201), navega inmediatamente al detalle de la suscripción creada: `navigation.replace('SuscripcionDetalle', { id: creada.id })` (o `navigate`).
  - En `HomeScreen.tsx`, se implementó suscripción al listener `'focus'` de navegación (`navigation?.addListener?.('focus', () => { void cargarDatos(); })`).
  - Al regresar a `HomeScreen`, la lista se recarga automáticamente desde el backend incorporando la nueva suscripción y actualizando el resumen de gastos mensuales.

### Cambios de Revisión (P2 Resueltos)
- **[P2] Protección contra respuestas desfasadas en `HomeScreen` (`HomeScreen.tsx`):**
  - Implementación de contador de generaciones (`generacionRef`). Si una carga inicial lenta (A) resuelve después de una recarga por foco (B) disparada tras crear una suscripción, la respuesta desfasada de A se descarta de forma segura y no sobrescribe el listado actualizado.
  - Invalida la generación al desmontar el componente o al cambiar la sesión activa del usuario.
- **[P2] Catálogo dinámico y opciones activas en `SuscripcionNuevaScreen` (`SuscripcionNuevaScreen.tsx`):**
  - Consumo directo de `getCatalogosSuscripciones()` en el contenedor montado por la ruta de navegación.
  - Filtrado estricto de opciones activas (`activo === true`) para monedas, frecuencias y categorías.
  - Banner accesible de carga (`testID="estado-carga-catalogos"`, rol `progressbar`) y alerta de error con botón de reintento (`testID="error-catalogo"`, `testID="btn-reintentar-catalogos"`).
  - Bloqueo del botón de guardado mientras el catálogo no esté listo (`isSaving || !listo`).
  - Preservación íntegra de los datos ya tipeados por el usuario si el catálogo responde asíncronamente mientras el usuario escribe.

---

## 2. Criterios de Aceptación Verificados

### SE-22
- [x] **Datos inválidos se identifican por campo:**  
  Cada campo identifica de forma aislada valores requeridos, longitud máxima de nombre, montos no válidos/negativos/decimales excesivos, opciones fuera de catálogo y fechas imposibles (`2026-02-30`). Cada error se limpia al editar.
- [x] **No se pierde lo escrito al cerrar teclado o cambiar orientación:**  
  Se verificó que toques externos, eventos de blur, desmontaje de teclado virtual y re-renderizados por orientación preservan los valores en todos los inputs.
- [x] **Consumo de catálogo dinámico y opciones activas:**  
  Carga opciones desde `/catalogos/suscripciones/`, filtra sólo activas, no inventa opciones ficticias y mantiene los datos del usuario si el catálogo llega de manera asíncrona.
- [x] **Evidencia enlazada y contrato validado:**  
  Documentado en [`frontend/movil/docs/CONTRATO_FORMULARIO_CREAR_SUSCRIPCION_SE22.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_FORMULARIO_CREAR_SUSCRIPCION_SE22.md).

### SE-23
- [x] **Éxito agrega exactamente una suscripción:**  
  Se envía un único POST, la respuesta creada redirige a `SuscripcionDetalle`, y el listado de `HomeScreen` ante foco recarga los datos sumando exactamente la suscripción creada.
- [x] **Fallo conserva formulario y no inserta registro ficticio:**  
  Ante errores 400 de API o fallos de red, el formulario retiene los datos tipeados, desbloquea los controles y no inserta registros ficticios ni altera listas locales.
- [x] **Protección contra respuestas asíncronas desfasadas:**  
  Una carga previa lenta no destruye la lista actualizada por foco tras una creación exitosa.
- [x] **Evidencia enlazada y contrato validado:**  
  Documentado en [`frontend/movil/docs/CONTRATO_CREACION_SUSCRIPCION_SE23.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_CREACION_SUSCRIPCION_SE23.md).

---

## 3. Pruebas y Evidencia de Verificación

Comandos de validación ejecutados:
```bash
npm run typecheck
npm test --workspace=movil
```

- **Cobertura de suites involucradas:**
  - `SuscripcionNuevaScreen.test.tsx`: 25 pruebas aprobadas (25/25).
  - `HomeScreen.test.tsx`: 23 pruebas aprobadas (23/23).
  - `navigation.test.tsx`: 17 pruebas de integración aprobadas (17/17).
  - `SuscripcionDetalleScreen.test.tsx`: 20 pruebas aprobadas (20/20).
- **Resultado global en móvil:** 21 suites pasadas, **343/343 pruebas aprobadas**.
- **Chequeo de tipos:** 0 errores de TypeScript en todo el monorepo (`shared`, `web`, `movil`, `desktop`, `extension`).

---

## 4. Archivos Modificados y Creados

```
frontend/movil/
├── docs/
│   ├── CONTRATO_FORMULARIO_CREAR_SUSCRIPCION_SE22.md
│   ├── CONTRATO_CREACION_SUSCRIPCION_SE23.md
│   └── PR_SPRINT3_SE22_SE23.md
└── src/
    ├── navigation/
    │   └── navigation.test.tsx
    └── screens/
        └── home/
            ├── HomeScreen.test.tsx
            ├── HomeScreen.tsx
            ├── SuscripcionNuevaScreen.styles.ts
            ├── SuscripcionNuevaScreen.test.tsx
            └── SuscripcionNuevaScreen.tsx
```
