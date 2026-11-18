# Pull Request: Sprint 3 — SE-28, SE-29 y SE-30 (Móvil)

**Rama:** `SE-28-30`  
**Base:** `main`  
**Responsable:** Sebastian Mena  
**Tarjetas cubiertas:**  
- `SE-28`: Registrar minutos de uso desde móvil (P1 / Should)  
- `SE-29`: Ordenar listado móvil y mostrar criterio (P1 / Should)  
- `SE-30`: Mostrar historial móvil de uso por fecha (P1 / Should)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen Ejecutivo y Alcance

Este Pull Request unifica las tres entregas del Sprint 3 para la aplicación móvil, implementando el ciclo completo de captura de uso, ordenamiento por servidor e historial cronológico, y resolviendo de forma rigurosa las 3 observaciones P2 identificadas durante la revisión de código sobre `HEAD a94d25d7764dbb28157f614b61c85ab6f47c23d8`.

---

## 2. Funcionalidades Entregadas

### 2.1. SE-28: Registrar Minutos de Uso desde Móvil
- **Componente Accesible de Formulario ([`RegistrarUsoFormMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoFormMovil.tsx)):**
  - Inputs numéricos y fecha (`input-minutos`, `input-fecha`), con valor por defecto de fecha local hoy.
  - Validación local rigurosa mediante [`validarUso`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/validacionesSuscripcion.ts) (rechaza minutos <= 0, no enteros, fechas futuras o inexistentes).
  - Bloqueo de doble envío mediante `useRef` y estados de carga (`guardando`, `bloqueado`, `aria-disabled="true"`).
  - Feedback accesible con `role="status"` diferenciando uso del mes actual vs. meses previos (VI-10).
- **Modal Accesible ([`RegistrarUsoModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoModal.tsx)):**
  - Diálogo con `role="dialog"`, overlay accesible y bloqueo de cierre nativo durante operaciones en curso.
- **Integración en Detalle ([`SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)):**
  - Conexión del botón `btn-registrar-uso`, recálculo automático de `horas_uso_mes` y costo por hora estimado tras confirmación.

### 2.2. SE-29: Ordenar Listado Móvil y Mostrar Criterio
- **Selector de Criterios Accesible ([`FiltrosSuscripcionesMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx)):**
  - Chips interactivos para 6 ordenamientos (próximo cobro asc/desc, nombre asc/desc, monto asc/desc).
  - Indicador visible accesible en tiempo real (`testID="indicador-orden-activo"`).
  - Función pura [`describirCriterioActivo`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/FiltrosSuscripcionesMovil.tsx) que describe de forma compacta el estado, fecha y orden activos.
- **Integración en Servidor y Paginación ([`HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx)):**
  - Peticiones paginadas preservando el orden (`orden: 'fecha_proximo_cobro'` predeterminado) tanto en montaje como al pulsar "Cargar más" y tras "Limpiar filtros".
  - Control de carreras mediante `generacionRef` descartando respuestas lentas anteriores.

### 2.3. SE-30: Mostrar Historial Móvil de Uso por Fecha
- **Extensión en `@ojoalgasto/shared`:**
  - Función pura [`formatearDuracionMinutos`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/formato.ts) (`45 min`, `1 h`, `1 h 30 min`).
  - Alias semántico `getHistorialUso` exportado en cliente API e index.
- **Componente Presentacional ([`HistorialUsoMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUsoMovil.tsx)):**
  - Lista accesible con orden cronológico descendente, fecha formateada y minutos.
  - Indicador de progreso (`role="progressbar"`), estado vacío claro y alerta accesible con reintento.
- **Integración Reactiva en Detalle ([`SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)):**
  - Carga paralela de historial y recarga reactiva inmediata tras confirmar nuevo uso desde el modal.

---

## 3. Resolución de Observaciones P2 de Revisión

### P2.1 · Historial sobrescrito por lectura anterior (Reglas 4/5)
- **Causa:** `cargarHistorial` reutilizaba la generación global de la pantalla sin un secuenciador propio, permitiendo que una petición inicial lenta A resolviera con `[]` o error tras la recarga exitosa B de un registro de uso recién confirmado.
- **Corrección:**
  - Incorporación de `generacionHistorialRef = useRef(0)`.
  - Incremento `generacionHistorialRef.current += 1` en cada llamada a `cargarHistorial`.
  - Guarda estricta: `generacionHistorialRef.current === generacionHistorialActual` descarta inmediatamente la respuesta de la petición A.
  - Regresión automatizada verificada en [`HistorialUso.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HistorialUso.test.tsx).

### P2.2 · El indicador predeterminado anuncia el orden inverso al aplicado (Regla 8)
- **Causa:** `HomeScreen` enviaba `{}` omitiendo `consulta.orden`. Django mantenía `Subscription.Meta.ordering = ['-fecha_proximo_cobro', 'id']` (más lejanos primero) mientras la UI anunciaba "más cercano primero".
- **Corrección:**
  - Exportación de `ORDEN_PREDETERMINADO: OrdenSuscripciones = 'fecha_proximo_cobro'`.
  - Envío explícito de `orden: 'fecha_proximo_cobro'` en montaje, paginación ("Cargar más"), limpieza y cambio de usuario.
  - Regresión automatizada verificada en [`OrdenarListado.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/OrdenarListado.test.tsx) validando primera fila más cercana, etiqueta y criterio enviado coincidente.

### P2.3 · Cerrar con Atrás y reabrir modal elude el bloqueo de doble envío (Reglas 4/5/9)
- **Causa:** `onRequestClose` en `Modal` invocaba `onCancelar` sin validar si un POST estaba en vuelo, desmontando el formulario y destruyendo `enviandoRef`. Al reabrir y reenviar se duplicaban registros en el backend.
- **Corrección:**
  - Bloqueo en contenedor: `registrandoUsoRef = useRef(false)` y `[registrandoUso, setRegistrandoUso] = useState(false)`.
  - Guarda reentrante en `ejecutarRegistrarUso`: lanza error si hay una petición en vuelo y protege el ciclo completo mediante `try ... finally`.
  - Bloqueo de cierre: `cerrarModalUso` y `onRequestClose` no ejecutan cierre mientras `registrandoUso` esté activo.
  - `RegistrarUsoFormMovil`: botón Cancelar deshabilitado mientras `estaDeshabilitado` (`guardando || bloqueado`).
  - Shim `react-native-shim.tsx`: soporte para simular `onRequestClose` en pruebas unitarias.
  - Regresiones automatizadas de éxito y fallo verificadas en [`RegistrarUso.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUso.test.tsx).

---

## 4. Resultados de Verificación Automatizada

```bash
# 1. Pruebas de Registrar Uso móvil (14/14 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/RegistrarUso.test.tsx

# 2. Pruebas de Ordenamiento móvil (11/11 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/OrdenarListado.test.tsx

# 3. Pruebas de Historial de Uso móvil (10/10 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/HistorialUso.test.tsx

# 4. Pruebas de HomeScreen (49/49 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/HomeScreen.test.tsx

# 5. Suite completa móvil (26 archivos, 484/484 pruebas aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil

# 6. Suite completa shared (19 archivos, 281/281 pruebas aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=@ojoalgasto/shared

# 7. Typecheck estricto en todos los workspaces (0 errores)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm run typecheck
```
