# Pull Request: Sprint 3 — SE-28, SE-29, SE-30 y SE-31 (Móvil)

**Rama:** `SE-28-30`  
**Base:** `main`  
**Responsable:** Sebastian Mena  
**Tarjetas cubiertas:**  
- `SE-28`: Registrar minutos de uso desde móvil (P1 / Should)  
- `SE-29`: Ordenar listado móvil y mostrar criterio (P1 / Should)  
- `SE-30`: Mostrar historial móvil de uso por fecha (P1 / Should)  
- `SE-31`: Avisar cambios sin guardar en móvil (P1 / Could)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen Ejecutivo y Alcance

Este Pull Request entrega de forma integral las 4 tarjetas del Sprint 3 para la aplicación móvil (`frontend/movil`) y la capa compartida (`@ojoalgasto/shared`):
1. **Captura y Registro de Uso (SE-28):** Modal accesible y validado para ingresar minutos de uso por fecha en suscripciones activas.
2. **Ordenamiento Dinámico (SE-29):** Selector accesible con 6 criterios de ordenación, preservados en paginación y sincronizados con el servidor.
3. **Historial Cronológico de Uso (SE-30):** Lista descendente con fechas y duraciones formateadas, estado vacío accesible y actualización reactiva inmediata.
4. **Protección contra Pérdida de Datos (SE-31):** Interceptación de gestos y navegación (`beforeRemove`, `BackHandler` y "Cancelar y Volver") en formularios de alta y edición con diálogo modal accesible.
5. **Resolución de Observaciones P2:** Corrección rigurosa de condiciones de carrera en historial, sincronización del orden predeterminado y prevención de doble envío.
6. **Eliminación de Hardcoding:** Eliminación de opciones estáticas ficticias, extracción de constantes de dominio y desacoplamiento de hojas de estilo.

---

## 2. Detalle de Funcionalidades por Tarjeta

### 2.1. SE-28: Registrar Minutos de Uso desde Móvil
- **Componente Formulario (`RegistrarUsoFormMovil.tsx`):**
  - Entradas para minutos y fecha con valor por defecto de fecha de hoy.
  - Validación compartida vía `validarUso` (rechaza minutos $\le 0$, decimales, fechas futuras o inválidas).
  - Bloqueo de doble envío mediante `useRef`, `disabled` y feedback accesible (`role="status"`).
- **Modal Accesible (`RegistrarUsoModal.tsx`):** Diálogo accesible con `role="dialog"`, overlay oscuro y bloqueo de cierre nativo durante envíos en vuelo.
- **Integración (`SuscripcionDetalleScreen.tsx`):** Actualización automática de `horas_uso_mes` y recálculo reactivo del costo por hora.

### 2.2. SE-29: Ordenar Listado Móvil y Mostrar Criterio
- **Selector de Filtros (`FiltrosSuscripcionesMovil.tsx`):**
  - Chips para 6 ordenamientos (próximo cobro asc/desc, nombre asc/desc, monto asc/desc).
  - Indicador visible del criterio activo (`testID="indicador-orden-activo"`).
- **Integración con Servidor (`HomeScreen.tsx`):**
  - `ORDEN_PREDETERMINADO: 'fecha_proximo_cobro'` exportado en `@ojoalgasto/shared`.
  - Peticiones paginadas que envían y preservan el orden al paginar ("Cargar más"), limpiar filtros o cambiar de usuario.

### 2.3. SE-30: Mostrar Historial Móvil de Uso por Fecha
- **Formato Compartido en `@ojoalgasto/shared`:** Función pura `formatearDuracionMinutos` (`45 min`, `1 h`, `1 h 30 min`).
- **Componente Presentacional (`HistorialUsoMovil.tsx`):**
  - Lista accesible con orden cronológico descendente, fecha formateada y minutos/horas.
  - Indicador de progreso (`role="progressbar"`), estado vacío claro y alerta accesible con botón "Reintentar".
- **Integración Reactiva (`SuscripcionDetalleScreen.tsx`):** Carga paralela y refresco automático al confirmar un nuevo registro de uso desde el modal.

### 2.4. SE-31: Avisar Cambios Sin Guardar en Móvil
- **Diálogo Modal Accesible (`AvisoCambiosSinGuardarModal.tsx`):**
  - Tarjeta accesible con `role="alert"` (`testID="aviso-cambios-sin-guardar"`).
  - Botones `"Seguir editando"` (`testID="btn-seguir-editando"`) y `"Descartar cambios"` (`testID="btn-descartar-cambios"`).
- **Hook Reutilizable (`useAvisoCambiosSinGuardar.ts`):**
  - **Coordinación nativa con `createNativeStackNavigator` (P1 SE-31):** Registra reactivamente `preventRemove` en `PreventRemoveContext` (`useInsertionEffect` / `useEffect`), activando `preventNativeDismiss: true` en `react-native-screens`. Esto evita que gestos nativos de swipe atrás en iOS o botones nativos del header descarten la pantalla en el hilo nativo antes de la confirmación del usuario.
  - Subscripción a `beforeRemove` (React Navigation) y `hardwareBackPress` (`BackHandler`).
  - Formularios limpios navegan libremente sin interrupción.
  - Guardar exitosamente (`handleSubmit`) desactiva el aviso y redirige sin bloqueos.
  - Compatible tanto en navegadores nativos como en pruebas unitarias aisladas.
- **Integración en Pantallas:** Activo en `SuscripcionNuevaScreen.tsx` (alta) y `SuscripcionEditarScreen.tsx` (edición).

---

## 3. Resolución de Observaciones P2 de Revisión

1. **P2.1 · Historial sobrescrito por lectura anterior:**
   - Incorporación de `generacionHistorialRef` en `SuscripcionDetalleScreen`. Invalida lecturas lentas previas tras un registro confirmado.
2. **P2.2 · Desalineación del orden predeterminado:**
   - Exportación de `ORDEN_PREDETERMINADO = 'fecha_proximo_cobro'` en `@ojoalgasto/shared`. Se envía explícitamente en montaje, paginación y limpieza de filtros.
3. **P2.3 · Doble envío con botón Atrás nativo:**
   - `registrandoUsoRef` en contenedor y protección con `try ... finally`. `onRequestClose` bloquea el cierre nativo mientras exista una petición POST en vuelo.

---

## 4. Limpieza de Elementos Hardcodeados

- **Catálogos Dinámicos:** Eliminadas opciones estáticas ficticias en `SuscripcionNuevaScreen` y `SuscripcionEditarScreen`. Las opciones provienen 100% de la API (`GET /catalogos/suscripciones/`).
- **Constantes de Dominio:** Extraído `FLATLIST_CONFIG_MOVIL`, `DIAS_UMBRAL_FANTASMA = 45`, `MAPA_SUFIJOS_FRECUENCIA` e `INFO_ESTADO_FALLBACK`.
- **Desacoplamiento de Estilos:** Hojas de estilos extraídas a `RegistrarUsoFormMovil.styles.ts` y `AvisoCambiosSinGuardarModal.styles.ts`.

---

## 5. Criterios de Aceptación Verificados

- [x] **SE-28:** Registro de minutos persistente, validado, con fecha y bloqueo de doble envío.
- [x] **SE-29:** Listado ordenable por próximo cobro, nombre y monto, con criterio visible y preservado al paginar.
- [x] **SE-30:** Historial descendente por fecha, estado vacío accesible, aislamiento por ID/tenant y refresco reactivo tras registrar uso.
- [x] **SE-31:** Interceptación de gestos y navegación cuando hay cambios sucios; formularios limpios no interrumpen; guardar y descartar limpian el estado correctamente; coordinación nativa con `createNativeStackNavigator` (P1).
- [x] **Calidad y Tipos:** 0 errores en `npm run typecheck`, 100% pruebas pasando.

---

## 6. Evidencia de Pruebas Automatizadas

```bash
# 1. Pruebas dedicadas de Cambios Sin Guardar (SE-31 con coordinación nativa)
npm test --workspace=movil -- src/screens/home/AvisarCambiosSinGuardar.test.tsx
  ✓ 13 passed (13)

# 2. Pruebas dedicadas de Historial de Uso (SE-30)
npm test --workspace=movil -- src/screens/home/HistorialUso.test.tsx
  ✓ 10 passed (10)

# 3. Pruebas dedicadas de Ordenamiento (SE-29)
npm test --workspace=movil -- src/screens/home/OrdenarListado.test.tsx
  ✓ 11 passed (11)

# 4. Pruebas dedicadas de Registro de Uso (SE-28)
npm test --workspace=movil -- src/screens/home/RegistrarUso.test.tsx
  ✓ 14 passed (14)

# 5. Suite completa workspace móvil (31 archivos)
npm test --workspace=movil
  ✓ 515 passed (515)

# 6. Suite completa workspace shared (22 archivos)
npm test --workspace=@ojoalgasto/shared
  ✓ 308 passed (308)

# 7. Verificación de tipos estricta
npm run typecheck
  > 0 errores en todos los workspaces
```
