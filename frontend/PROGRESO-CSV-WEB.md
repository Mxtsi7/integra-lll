# Progreso y fallos del procesamiento del CSV en la web

**Responsable:** Sebastian Mena · **Tarjeta:** S3-SE-04 (anteriormente S3-CH-03) · **Sprint:** 3

| # | Tarea | Estado |
|---|---|---|
| S3-SE-04 | Mostrar el avance real y los fallos del procesamiento del CSV | ✅ |

**Dependencias:**
- **S3-SE-02:** Conectar la selección y carga de CSV con el servicio de importación (Sebastian Mena).
- **FE-08:** Modelar importaciones y exponer su progreso (Felipe Orellana) en `GET /api/importaciones/<id>/`.

**Desbloquea:**
- **S3-CH-06:** Mostrar las filas inválidas y el motivo de rechazo del CSV (Christopher Solís).

---

## Qué hace

1. **Distinción veraz entre aceptación y procesamiento:**
   - `pendiente`: "En cola: empieza en unos momentos." El archivo fue recibido y validado por el backend (FE-07), pero el worker de procesamiento aún no comienza.
   - `procesando`: "Leyendo el archivo…" Muestra el avance real de filas procesadas versus filas totales reportadas por el backend.
   - `completada`: "El análisis terminó." Muestra cuántos cobros posibles se detectaron y aclara explícitamente: **"Todavía no se creó ni cambió ninguna suscripción"**.
   - `fallida`: "La importación no se pudo terminar. No se creó ni cambió ninguna suscripción." Muestra el conteo y detalle de errores (`ErroresPorFila`), indicando el número de fila o error global.

2. **No se inventan porcentajes:**
   - Cuando el backend reporta `progreso: null`, la barra de progreso se muestra como indeterminada (`aria-valuetext="Todavía no sabemos cuántas filas son."`), sin atributo `aria-valuenow` ni porcentaje ficticio (`null` no es `0`).
   - Con total conocido, reporta exactamente el avance: `"X de Y filas (Z %)"`.

3. **Detención definitiva del seguimiento (sin consultas indefinidas):**
   - **Estados terminales:** Tanto `completada` como `fallida` tienen `terminada: true`; al recibir cualquiera de estos estados, el polling se detiene inmediatamente.
   - **Abandono de la vista:** Al navegar a otra ruta o desmontar el componente, se cancela el temporizador y se descartan peticiones en vuelo.
   - **Pestaña en segundo plano:** Con `document.visibilityState === 'hidden'`, las consultas se pausan y se reanudan al regresar.
   - **Tolerancia a fallos:** Tras 3 fallos de red seguidos, el polling se detiene, advierte que la información puede estar desactualizada y ofrece reintento manual.
   - **Recurso inexistente (404):** Muestra el estado `"no-encontrada"` y no vuelve a consultar.

---

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [web/src/hooks/useProgresoImportacion.ts](web/src/hooks/useProgresoImportacion.ts) | Hook de polling adaptativo (backoff 1 s a 10 s), pausa en segundo plano, cancelación por desmontaje y detención terminal. |
| [web/src/hooks/useProgresoImportacion.test.tsx](web/src/hooks/useProgresoImportacion.test.tsx) | Pruebas de detención ante `completada`, `fallida`, backoff, desmontaje, 404 y fallos de red. |
| [web/src/pages/ImportacionPage.tsx](web/src/pages/ImportacionPage.tsx) | Vista `/importaciones/:id` con insignias de estado, barra de progreso veraz, cobros candidatos y errores por fila. |
| [web/src/pages/ImportacionPage.test.tsx](web/src/pages/ImportacionPage.test.tsx) | Pruebas de integración de la visualización para CSV: en cola, avance, sin porcentajes inventados y fallida. |

---

## Cómo se comprobó

1. **Pruebas en `web/src/hooks/useProgresoImportacion.test.tsx` (10 pruebas):**
   - Detención inmediata al llegar a `fallida` (0 consultas adicionales tras 60 s).
   - Transición directa de `pendiente` a `fallida`.
   - Detención ante `completada`.
   - Backoff exponencial 1 s → 10 s y reajuste al avanzar.
   - Cancelación al desmontar.
   - Pausa con pestaña oculta y reanudación inmediata.
   - Detención tras 3 fallos de red seguidos y recuperación con `reintentar()`.
   - Detención inmediata ante 404.
   - Cambio de ID descartando la respuesta previa.

2. **Pruebas en `web/src/pages/ImportacionPage.test.tsx` (31 pruebas):**
   - Distinción de aceptación en cola vs lectura de archivo vs análisis completado.
   - Manejo de `progreso: null` como barra indeterminada sin porcentaje numérico inventado.
   - Estado `fallida` de CSV con reporte de problemas por fila y mensaje claro de no alteración de suscripciones.

3. **Typecheck general:**
   - `npm run typecheck`: 0 errores en todos los paquetes del monorepo.
