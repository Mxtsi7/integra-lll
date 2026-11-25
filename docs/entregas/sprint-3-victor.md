# Entrega Sprint 3 — Víctor (Lote E: S3-VI-23 / S3-VI-24)

**Fecha:** 2026-11-24 · **Rama:** `LoteE(VI-23-VI-24)` · **Responsable:** Víctor Gonzales

Cierre del Lote E: conexión de punta a punta del pipeline de uso de recolectores
v1 y documentación final. La entrega cubre
`HTTP Bearer → outbox → RabbitMQ → consumidor TypeScript → PostgreSQL → Analytics`.

Este documento separa deliberadamente la evidencia unitaria de la integración
real. Ninguna prueba de integración sustituye PostgreSQL por SQLite ni RabbitMQ
por un doble en memoria.

## 1. Alcance entregado

| Tarjeta | Cierre |
|---|---|
| **S3-VI-23** | Suite E2E con infra real: validación Bearer del gateway, outbox transaccional, despacho al exchange dedicado, worker TypeScript como proceso separado, agregados `analytics.uso_*`, redelivery, aislamiento por organización y barrera de borrado. |
| **S3-VI-24** | Documentación de cierre: contrato v1 actualizado, checklist de calidad v1.0, retrospectiva y cuerpo listo para el PR final. |

### Cambios de código y pruebas

- `services/subscriptions/app/uso_recolectores/persistencia.py`: `registrar_uso`
  se llama dentro del savepoint de **primera aceptación**. Un reenvío `200`, un
  conflicto `409` o un fallo de proyección no dejan una segunda fila de outbox.
  El `usuario_id` entero de Auth se convierte de forma determinista a UUID v5
  (`NAMESPACE_URL`, `https://integra.example/usuarios/{usuario_id}`) para cumplir
  el sobre v1 sin aceptar identidad del cuerpo.
- `services/subscriptions/tests/test_persistencia_uso.py`: regresiones de
  outbox único en `201`, ausencia de outbox en `200`/`409` y forma del sobre.
- `services/subscriptions/tests/e2e/test_flujo_uso_recolectores.py`: tres
  escenarios E2E contra PostgreSQL y RabbitMQ reales. Falla explícitamente si la
  configuración Django no usa PostgreSQL.
- `services/subscriptions/tests/e2e/verificar_analytics_uso.py`: proceso Python
  separado que ejecuta el código real de Analytics sobre la misma base de la
  E2E. Sólo imprime agregados; no imprime tokens ni configuración.
- `docs/contratos/uso-recolectores-v1.md`: sección 13 con el cierre de
  integración v1.0.

## 2. Evidencia unitaria

Se ejecutó con el entorno de pruebas efímero; los valores de `DATABASE_URL` y
`RABBITMQ_URL` se inyectaron por variable de entorno y **no se transcriben aquí**.

| Suite | Comando (sin valores sensibles) | Resultado |
|---|---|---|
| Contrato canónico | `python -m pytest docs/contratos/tests -q` | **57 passed** |
| Regresión enfocada de outbox/publicador | `python -m pytest tests/test_persistencia_uso.py tests/test_uso_publicador.py -q` | **17 passed**, 1 aviso de deprecación |
| `subscriptions` (sin E2E) | `python -m pytest tests --ignore=tests/e2e -q` | **557 passed**, 11 skipped, 3 avisos de deprecación |
| `analytics` | `python -m pytest -q` | **282 passed**, 3 avisos de deprecación |
| `analytics-uso` unitaria | `npm test` | **58 passed**, 8 skipped (integración omitida a propósito) |
| Tipado y compilación TS | `npm run typecheck` y `npm run build` | sin errores |

Los avisos son de `asyncio.iscoroutinefunction` en Django y no afectan el
comportamiento bajo prueba.

## 3. Evidencia de integración real

Infraestructura efímera levantada con
`docker compose -f docker-compose.analytics-uso-test.yml up -d --wait`
(PostgreSQL y RabbitMQ en puertos aislados del entorno de desarrollo).

| Suite | Condición | Resultado |
|---|---|---|
| `analytics-uso` integración | `INTEGRACION_USO=1`, `EXIGIR_INTEGRACION_USO=1`, PostgreSQL/RabbitMQ reales | **8 passed** |
| E2E `S3-VI-23` | `DATABASE_URL` PostgreSQL, `RABBITMQ_URL`, worker Node separado y verificador de Analytics separado | **3 passed** |

### Escenarios E2E verificados

1. **Bearer → outbox → Rabbit → consumidor → redelivery.** Sin token hay `401`
   y ningún outbox; con token el par `201`/`200` conserva `recibido_en` y un solo
   `EventoUsoRecibido`. El despacho publica, el consumidor escribe
   `analytics.uso_evento`/`uso_tramo`/`uso_diario`/`uso_mensual_recolector`, y un
   redelivery del mismo sobre no duplica efectos ni envía a la cola de fallos.
   Se comprueba `duracion_ms = 30000`, `minutos_netos = 0` y `ms_residuo = 30000`.
2. **Aislamiento y barrera de borrado.** Dos organizaciones publican el mismo
   evento y cada una queda con su fila. Al marcar una organización como
   eliminada en `public` y en `analytics`, la HTTP responde `410
   organizacion_eliminada`, el outbox no crece, un mensaje tardío se confirma sin
   reinsertar y la otra organización sigue procesando normalmente.
3. **Precisión, cobertura y gastos en Analytics.** 30 s positivos con 0 minutos
   enteros se clasifican como `uso_positivo_confirmado` sin recomendación
   automática; la pausa conocida queda como `sin_medicion` / `pausado`,
   `datos_insuficientes` y sin penalización. Los gastos salen separados por
   moneda (`1000.00 CLP`, `25.50 USD`) y el resumen conserva la incertidumbre.

La integración TS cubre además unión de tramos con solapamiento, convivencia con
`analytics.uso_mensual` de Django, duplicados, `event_id` reutilizado con otro
contenido (cola de fallos), misma clave en otra organización y eventos tardíos
de tenants eliminados.

## 4. Checklist de calidad v1.0

- [x] Contrato canónico, esquema y fixtures ejecutados con las mismas reglas.
- [x] Bearer validado con el código real del gateway; identidad resuelta desde la sesión.
- [x] Cuerpo sin `usuario_id`, `organizacion_id` ni `suscripcion_id`.
- [x] Outbox escrito en la misma transacción que el hecho durable.
- [x] `201` crea efectos una sola vez; `200` y `409` no crean otra fila ni otra publicación.
- [x] Publicación real en RabbitMQ con exchange/routing propios del contrato.
- [x] Consumidor TypeScript real, con ACK/NACK, deduplicación y cola de fallos.
- [x] Redelivery verificado sin duplicar eventos, tramos ni agregados.
- [x] PostgreSQL real con esquema `analytics.uso_*`; sin SQLite en integración.
- [x] Aislamiento por organización verificado en HTTP, outbox y consumidor.
- [x] Barrera de borrado verificada en `public` y en `analytics`.
- [x] Milisegundos exactos y proyección entera con residuo conservado.
- [x] 30 s positivos con 0 minutos enteros no se presentan como uso cero.
- [x] Cobertura incompleta, pausa o sin medición no habilitan penalización automática.
- [x] Gastos agregados por moneda sin mezclar divisas.
- [x] Evidencia unitaria separada de evidencia de integración real.
- [x] Sin secretos, tokens ni cadenas de conexión del `.env` en documentos o evidencia.
- [x] Documentación de cierre y cuerpo de PR listos.

## 5. Retrospectiva

**Qué funcionó.** Mantener el contrato como única fuente de verdad permitió que
las mismas fixtures alimentaran la regresión unitaria y la E2E. Levantar la
infra efímera antes de integrar evitó sorpresas de esquema y hizo visibles los
dos contextos Django distintos (`subscriptions` y `analytics`).

**Hallazgos corregidos.**

1. El outbox se preparaba fuera de la rama de primera aceptación; un reenvío
   podía dejar una segunda publicación. Se movió `registrar_uso` al savepoint
   que ya distingue `201`, `200` y `409`.
2. Auth entrega `usuario_id` como entero y el sobre v1 exige UUID. Se derivó con
   `uuid5(NAMESPACE_URL, ...)`, estable y no falsificable desde el cuerpo.
3. El verificador de Analytics consultaba los gastos dentro de
   `uso_recolectores`, pero el agregado vive en la raíz del contexto. Al
   ejecutarlo como proceso separado contra la BD real quedó claro el origen del
   array vacío; se corrigió la lectura y se eliminaron los campos de depuración.
4. El worker hijo dejaba la BD ocupada al cerrar la sesión. Se lanza directo con
   Node sobre `node_modules/tsx`, sin procesos intermedios.
5. La E2E necesita forzar `DJANGO_SETTINGS_MODULE=analytics_config.settings`,
   cargar catálogos y crear la vista `subscriptions.subscription` sobre `public`.
   Todo quedó explícito en la fixture; nada depende del entorno del desarrollador.

**Lecciones.** La idempotencia HTTP y la idempotencia del consumidor deben
probarse por separado: una no implica la otra. El silencio del recolector no es
medición; cualquier agregado que lo convierta en cero debe fallar la prueba. Y
la evidencia creíble es la que puede repetirse con infra real y sin secretos.

**Seguimiento.** No quedan pendientes de Lote E. La operación futura debe
monitorear la cola de fallos y la tasa de redelivery como señales de salud del
pipeline, sin cambiar el contrato v1.

## 6. Cuerpo listo para el PR final

**Título:** `S3-VI-23 / S3-VI-24 — cierre de integración del pipeline de uso recolector v1`

**Tarjetas:** S3-VI-23, S3-VI-24

```markdown
Cierra el Lote E: el pipeline de uso de recolectores v1 queda conectado de
punta a punta y documentado.

### Cambios
- El outbox se escribe dentro del savepoint de primera aceptación: `201`
  publica una vez; `200` y `409` no generan otra fila ni otra publicación.
- `usuario_id` entero de Auth se deriva a UUID v5 estable para el sobre v1.
- Suite E2E con PostgreSQL y RabbitMQ reales: Bearer del gateway, despacho,
  consumidor TypeScript separado, agregados `analytics.uso_*`, redelivery,
  aislamiento de tenants y barrera de borrado en `public` y `analytics`.
- Verificación real de Analytics: precisión en ms, 30 s con 0 minutos enteros
  sin penalización y gastos agrupados por moneda sin mezclar divisas.
- Documentación de cierre, checklist v1.0 y retrospectiva.

### Evidencia
- Contrato: 57 passed.
- Regresión enfocada: 17 passed.
- `subscriptions`: 557 passed, 11 skipped (E2E se ejecuta por separado).
- `analytics`: 282 passed.
- `analytics-uso` unitaria: 58 passed, 8 skipped; typecheck y build sin errores.
- `analytics-uso` integración real: 8 passed.
- E2E real: 3 passed.

Sin SQLite en integración y sin secretos ni cadenas de conexión en la
documentación o en la evidencia. Detalle en
`docs/entregas/sprint-3-victor.md` y contrato actualizado en
`docs/contratos/uso-recolectores-v1.md`.
```
