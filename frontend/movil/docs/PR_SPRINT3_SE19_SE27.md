# PR: SE_19-27 — Paginación real DRF, filtros móviles por servidor y resolución de observaciones P2

**Rama:** `SE-2X`  
**Base:** `main`  
**Responsable:** Sebastian Mena  
**Tarjetas cubiertas:**  
- `SE-19`: Conectar listado móvil paginado (P1 / Must)  
- `SE-27`: Aplicar filtros móviles por estado y fecha (P1 / Should)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen de Cambios

### SE-19: Conectar listado móvil paginado
- **Consumo página a página de DRF en `@ojoalgasto/shared`:**
  - Se sustituyó el bucle de descarga masiva en cliente por [`getSuscripcionesPaginadas`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) e interfaz `SuscripcionesPaginadas` (`count`, `next`, `previous`, `results`, `totales`). Consume `/suscripciones/?page=N` respetando la configuración `PageNumberPagination` (`page_size=10`) del backend.
  - Se conservó [`getSuscripciones()`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) intacta para preservar compatibilidad con código preexistente.
- **Deduplicación estricta entre páginas (Criterio 1):**
  - Implementación de la función pura [`deduplicarSuscripciones`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx) para descartar duplicados por `id` al concatenar nuevas páginas, garantizando que cada suscripción se muestre exactamente una sola vez en el listado móvil.
- **Controles de paginación y refresco en `HomeScreen` y `HomeView`:**
  - Botón accesible `btn-cargar-mas` que solicita `paginaActual + 1` y desaparece automáticamente al alcanzar la última página (`next === null`).
  - Contador accesible `contador-paginacion` (`Mostrando X de Y`).
  - Pull-to-refresh (`onRefresh`) que reinicia a la página 1, descarta la lista previa y carga los datos actualizados.
  - Tolerancia a fallos: un fallo de red en la carga de una página subsecuente no corrompe ni borra la lista de elementos ya cargados.

### SE-27: Aplicar filtros móviles por estado y fecha
- **Componente de Controles Accesibles ([`FiltrosSuscripcionesMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx)):**
  - Selector horizontal de chips accesibles (`filtro-estado-*`) para estados: `todas`, `activo`, `fantasma`, `prueba`, `por_confirmar` y `cancelado`.
  - Campo de entrada `input-filtro-fecha` para filtrar por fecha exacta de cobro (`AAAA-MM-DD`).
  - Validación de fecha real mediante [`esFechaReal`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/validaciones.ts) antes de enviar la consulta al servidor.
  - Función pura [`describirCriterioActivo`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx) que describe de forma concisa el criterio activo (`criterio-filtro-activo`).
  - Botón `btn-limpiar-filtros` visible únicamente cuando hay filtros activos.
- **Filtrado en Servidor (Criterio 1):**
  - Despacha `GET /suscripciones/?page=1&estado=...&fecha_cobro=...` consumiendo los parámetros soportados por el backend.
- **Aislamiento de Respuestas y Control de Concurrencia (Criterio 2):**
  - Al cambiar de filtro, la pantalla pasa de inmediato al estado de carga (`progressbar`) ocultando de la vista los datos de la consulta anterior.
  - Candado de concurrencia `generacionRef`: descarta respuestas lentas previas si una consulta posterior resolvió primero, evitando mezclar datos viejos.
- **Reinicio Automático de Paginación:**
  - Modificar cualquier filtro estando en página 2 o posterior reinicia automáticamente la consulta a la página 1 (`paginaActual = 1`).
- **Diferenciación de Estados Vacíos:**
  - `empty-state-home`: vista de bienvenida para cuentas nuevas sin suscripciones con botón para agregar la primera.
  - `empty-state-filtros`: vista específica cuando los filtros aplicados no arrojaron coincidencias, incluyendo el botón `btn-limpiar-filtros-vacio` que restablece filtros y recarga.

### Resolución de Observaciones P2 (Revisión de Código)

1. **P2.1 — Subtotal mostrado inequívocamente etiquetado como parcial cuando el listado está paginado:**
   - **Problema previo:** Al cargar solo una página (e.g. 10 de 11 suscripciones), la tarjeta de resumen sumaba los $100.000 cargados pero los rotulaba como "Gasto mensual proyectado" junto a "11 suscripciones en total", haciendo que el total pareciera aumentar arbitrariamente al pulsar "Cargar más".
   - **Solución implementada:**
     - En [`HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx), cuando el listado cargado en memoria es un subconjunto parcial (`hayMas === true` o `totalGeneral > suscripciones.length`) y no se dispone de un resumen global del servidor:
       - La tarjeta de resumen se etiqueta explícitamente como `'Subtotal mensual proyectado (parcial)'` (`testID="resumen-etiqueta"`).
       - El estilo visual de advertencia suave destaca que es un valor parcial ([`resumenEtiquetaParcial`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.styles.ts)).
       - El subtítulo aclara: `'Subtotal de X de Y suscripciones (parcial)'` (`testID="resumen-subtitulo"`).
       - La accesibilidad anuncia claramente el subtotal y la cantidad de suscripciones consideradas.
       - Soporta múltiples monedas formateadas individualmente.
     - Cuando el conjunto está completo (o cuando el servidor/consumidor inyecta `resumenGlobal` o `totales`), se presenta el gasto global proyectado (`'Gasto mensual proyectado'`) sin fluctuar al paginar.

2. **P2.2 — Invalidar una página pendiente no deja «Cargar más» bloqueado:**
   - **Problema previo:** Al pulsar "Cargar más", `cargandoMas` pasaba a `true`. Si el usuario cambiaba un filtro, realizaba pull-to-refresh o la pantalla recuperaba el foco mientras la página 2 estaba en vuelo, `cargarPaginaInicial` incrementaba `generacionRef` pero no reseteaba `cargandoMas=false`. La resolución tardía de la página vieja evaluaba `if (sigueVigente()) setCargandoMas(false)` en `false`, dejando el botón del nuevo listado permanentemente en `"Cargando más..."` y `disabled=true`.
   - **Solución implementada:**
     - `cargarPaginaInicial`, `manejarRefresh`, el listener de `focus` y el cambio de sesión resetean de inmediato `setCargandoMas(false)` al iniciar una nueva generación.
     - Las respuestas asíncronas tardías de páginas obsoletas quedan completamente descartadas por `sigueVigente()` y no pueden ni mutar el listado ni bloquear el botón en el nuevo listado.

---

## 2. Criterios de Aceptación Verificados

### SE-19
- [x] **Consumo página a página:** Peticiones individuales al endpoint paginado de DRF sin bucles en cliente.
- [x] **Criterio 1 — Sin duplicados entre páginas:** `deduplicarSuscripciones` garantiza que cada entidad se muestre una sola vez al navegar entre páginas.
- [x] **Criterio 2 — Aislamiento en refresco:** Pull-to-refresh reinicia a la página 1 y reemplaza los datos sin mezclar respuestas anteriores.
- [x] **P2.1 — Subtotal parcial vs global:** Etiquetado claro y visualmente diferenciado como subtotal parcial cuando hay más páginas pendientes.
- [x] **P2.2 — Desbloqueo concurrente de Cargar más:** Cambios de filtro, refrescos o foco resetean `cargandoMas` y descartan respuestas tardías sin bloquear el botón.
- [x] **Contrato validado:** [`CONTRATO_LISTADO_PAGINADO_SE19.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_LISTADO_PAGINADO_SE19.md).

### SE-27
- [x] **Criterio 1 — Combinación filtra en servidor:** Parámetros `estado` y `fecha_cobro` enviados correctamente en `GET /suscripciones/`.
- [x] **Criterio 2 — No deja resultados de la consulta previa:** Transición inmediata a estado de carga y descarte de respuestas desordenadas con `generacionRef`.
- [x] **Reinicio de paginación:** Cambiar cualquier filtro reinicia la consulta a la página 1.
- [x] **Acción de limpiar y accesibilidad:** Botón para limpiar filtros en la barra y en el estado vacío con roles accesibles.
- [x] **Contrato validado:** [`CONTRATO_FILTROS_SUSCRIPCION_SE27.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_FILTROS_SUSCRIPCION_SE27.md).

---

## 3. Pruebas y Evidencia de Verificación

Comandos ejecutados con éxito:

```bash
# 1. Pruebas de HomeScreen (49/49 aprobadas, incluye regresiones de P2.1 y P2.2)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/HomeScreen.test.tsx

# 2. Pruebas de navegación móvil (19/19 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/navigation/navigation.test.tsx

# 3. Pruebas en @ojoalgasto/shared (19 archivos, 278/278 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=@ojoalgasto/shared

# 4. Suite completa del workspace móvil (23 archivos, 449/449 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil

# 5. Typecheck TypeScript estricto en todos los workspaces (0 errores)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm run typecheck
```

---

## 4. Archivos Modificados y Creados

- [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts)
- [`frontend/shared/src/index.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/index.ts)
- [`frontend/shared/src/api/suscripciones.test.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.test.ts)
- [`frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx)
- [`frontend/movil/src/screens/home/HomeScreen.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.styles.ts)
- [`frontend/movil/src/screens/home/HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx)
- [`frontend/movil/src/screens/home/HomeScreen.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.test.tsx)
- [`frontend/movil/test/react-native-shim.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/test/react-native-shim.tsx)
- [`frontend/movil/docs/CONTRATO_LISTADO_PAGINADO_SE19.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_LISTADO_PAGINADO_SE19.md)
- [`frontend/movil/docs/CONTRATO_FILTROS_SUSCRIPCION_SE27.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_FILTROS_SUSCRIPCION_SE27.md)
- [`frontend/movil/docs/PR_SPRINT3_SE19_SE27.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/PR_SPRINT3_SE19_SE27.md)

---

## 5. Mensaje de Commit Propuesto

```text
fix(movil): resolver observaciones P2 de subtotal parcial e invalidacion de paginacion (SE-19, SE-27)

- Etiquetar explicitamente como subtotal parcial ('Subtotal mensual proyectado (parcial)') cuando el listado cargado no representa la totalidad y no existe resumen global de backend (P2.1).
- Diferenciar visualmente la etiqueta parcial mediante estilo dedicado de advertencia y accesibilidad descriptiva multimoneda (P2.1).
- Restablecer cargandoMas=false inmediatamente al iniciar una nueva generacion de consulta (filtro, refresh o foco) para evitar bloqueo de 'Cargar mas' tras invalidar solicitudes previas en vuelo (P2.2).
- Ignorar de forma segura respuestas y rechazos tardios de paginas obsoletas asociadas a generaciones previas (P2.2).
- Actualizar contratos SE-19 y SE-27 con la matriz de estados y controles de concurrencia.
- Incorporar pruebas unitarias y de regresion en HomeScreen.test.tsx pasando 49/49 en suite de Home.
```
