# Entrega Sprint 3 — Víctor (Lote E: S3-VI-23 / S3-VI-24)

**Fecha:** 2026-11-25 · **Rama:** `LoteE(VI-23-VI-24)` · **Responsable:** Víctor Gonzales
**Base integrada:** `main dba7019` · **Tarjetas:** [S3-VI-23](https://trello.com/c/HFIsOVuT), [S3-VI-24](https://trello.com/c/iLmmVlOg)

Cierre del Lote E luego del review contra `18217f34`. Se integró `main`,
se corrigieron los dos P2 y se acotó la documentación al alcance real de las
pruebas. El PR sigue abierto: no se ha fusionado ni desplegado.

## 1. Correcciones del review

### P2 — identidad de usuario

`persistencia.py` vuelve a conservar el `usuario_id` entero de Auth hasta
`registrar_uso`. El sobre se construye con `events.uso.uuid_usuario_auth`, que
usa `NAMESPACE_USUARIO_AUTH`, congelado en `main`. Se eliminaron
`NAMESPACE_URL`, `ESPACIO_USUARIO_USO` y `_usuario_para_sobre`, junto con sus
expectativas copiadas en `tests/test_persistencia_uso.py` y en la E2E.

- `uuid_usuario_auth(42)` → `9180eff3-4e75-5137-95fa-1879656f1c43` (canónico).
- El namespace alternativo producía `1b9d5b33-5cfd-5e00-a82c-9b73ca2fac90` y
  ya no existe en la recepción ni en las pruebas.
- `tests/test_uso_contrato_cruzado.py` cubre productor → validador/huella: el
  sobre con el entero convertido pasa el validador TypeScript y el reintento no
  cambia la identidad ni el `event_id`.

Se conservó la barrera `bloquear_organizacion` de `main` y un único
`registrar_uso` dentro del savepoint de primera aceptación. Un reenvío `200`,
un conflicto `409` o un fallo de proyección no dejan otra fila de outbox.

### P2 — integración de la E2E con CI

`tests/e2e/test_flujo_uso_recolectores.py` lee únicamente
`RABBITMQ_PRUEBA_URL`, la variable que publica el job `backend/subscriptions`.
No existe default local ni fallback a `test:test@localhost:55672`. La fixture
falla explícitamente si falta el broker, npm, node o `tsx`; no hay `skip` ni
marcador `opt-in`. La clase fija además `settings.RABBITMQ_URL` al mismo broker
del job para que `despachar_pendientes` use la infraestructura efímera.

`.github/workflows/ci.yml` instala, solo para `subscriptions`, las dependencias
Python de `gateway` y `services/analytics` junto a las de Node ya presentes.
Así la importación del validador real y el verificador de Analytics no dependen
del entorno del desarrollador.

## 2. Evidencia del comando exacto de CI

Ejecutado localmente desde `services/subscriptions` con el mismo comando del
job (`pytest -v`), PostgreSQL y RabbitMQ efímeros, y las variables de entorno
inyectadas por el runner. Las cadenas de conexión y secretos reales no se
transcriben.

| Comando | Resultado |
|---|---|
| `pytest -v` | **585 passed**, 7 warnings, **0 skipped**; incluye los **3 E2E** de `FlujoUsoRecolectoresE2E`. `EXIT=0`. |

Las tres pruebas E2E que aparecen en el log del SHA integrado son:

- `test_aislamiento_de_organizaciones_y_barrera_de_borrado` — PASSED
- `test_flujo_bearer_outbox_rabbit_consumidor_y_redelivery` — PASSED
- `test_precision_cobertura_y_gastos_por_moneda_en_analytics` — PASSED

Comprobación adicional del P2 de CI: sin `RABBITMQ_PRUEBA_URL`, `pytest -q
tests/e2e/test_flujo_uso_recolectores.py` termina con `EXIT=1`, **3 errors**,
ningún skip, y el mensaje `S3-VI-23 exige RABBITMQ_PRUEBA_URL`.

El resto de los jobs del workflow (contrato, Analytics, `analytics-uso`,
tipado y compilación TS) se valida con los checks del SHA integrado, no con
afirmaciones reejecutadas a mano en este documento.

## 3. Alcance real de la E2E y dobles

| Capa | Qué se ejercita de verdad | Doble o límite explícito |
|---|---|---|
| Identidad HTTP | `leer_token`/`validar` del gateway rechazan tokens inválidos y descartan identidad enviada por el cliente. | El salto de red gateway→servicio se sustituye por `BearerGatewayMiddleware`, que inyecta las cabeceras ya validadas. |
| Sesiones | Se comprueba el flujo con sesión vigente. | `CACHES` usa `LocMemCache`, no Redis. |
| Consentimiento | El receptor durable exige un callable de consentimiento. | `_consentimiento_prueba` devuelve `True` incondicionalmente: **no** ejerce la autoridad de consentimiento. |
| Eventos | El contrato v1 se valida y persiste con PostgreSQL real. | Los eventos son fixtures de `docs/contratos/uso-recolectores-v1.ejemplos.json`, no capturas desde dispositivo. |
| Outbox y broker | `registrar_uso` escribe en la misma transacción; `despachar_pendientes` publica en RabbitMQ real con exchange y routing key propios. | Sin dobles de broker. |
| Consumidor | El worker TypeScript corre como proceso separado, confirma, deduplica y aísla por organización en `analytics.uso_*`. | Sin dobles de base ni de worker. |
| Resumen y puntaje | El verificador invoca el código local de contexto/resumen sobre la misma base. | No interviene ningún proveedor de IA externo. |

Escenarios cubiertos: Bearer → outbox → Rabbit → consumidor → redelivery;
aislamiento entre organizaciones y barrera de borrado en `public`/`analytics`;
precisión en milisegundos, 30 s con 0 minutos enteros sin penalización,
cobertura insuficiente y gastos separados por moneda.

## 4. Checklist de cierre

- [x] Conflicto de `persistencia.py` resuelto contra `main dba7019`.
- [x] Identidad canónica `9180eff3-4e75-5137-95fa-1879656f1c43` desde recepción y publicación.
- [x] Prueba cruzada productor → validador/huella y reintento en la misma suite.
- [x] Outbox único en `201`; `200` y `409` no publican ni crean otra fila.
- [x] Barrera de borrado conservada en HTTP y en escrituras internas.
- [x] E2E conectada a `RABBITMQ_PRUEBA_URL`; sin defaults, skips ni fallbacks.
- [x] Dependencias Python de gateway/Analytics y Node instaladas en el job `backend/subscriptions`.
- [x] `pytest -v` del job con 585 passed y 3 E2E en el SHA integrado.
- [x] Alcance real, dobles y pendientes documentados.
- [x] Sin secretos, tokens ni cadenas de conexión del `.env` en documentos o evidencia.
- [ ] Validar autoridad real de consentimiento con el proveedor correspondiente.
- [ ] Ejercitar el salto HTTP gateway→servicio en un entorno desplegado.
- [ ] Ejercitar captura desde dispositivo y un proveedor de IA externo; hoy no están en la E2E.
- [ ] Confirmar los checks del SHA final del PR.

## 5. Retrospectiva

**Hallazgos corregidos.**

1. La derivación alternativa partía la identidad en `analytics.uso_evento`. Se
   eliminó y se reutilizó el helper canónico de `events.uso`.
2. La E2E apuntaba a un broker local distinto del que publica el job de CI. Se
   conectó a `RABBITMQ_PRUEBA_URL` y se hizo fallar en ausencia de infraestructura.
3. La documentación describía los dobles como si fueran eslabones reales. Ahora
   separa explícitamente middleware, `LocMemCache`, consentimiento `True`,
   fixtures y código local de resumen.

**Lección.** Una suite puede ser real en PostgreSQL/RabbitMQ y seguir teniendo
dobles importantes. La evidencia creíble nombra ambos.

## 6. Estado y cuerpo para el PR final

**Título:** `S3-VI-23 / S3-VI-24 — cierre de integración del pipeline de uso recolector v1`

**Tarjetas:** [S3-VI-23](https://trello.com/c/HFIsOVuT), [S3-VI-24](https://trello.com/c/iLmmVlOg)

```markdown
Cierra el Lote E tras integrar `main dba7019` y resolver los dos P2 del review.

### Cambios
- La identidad de Auth se convierte con `events.uso.uuid_usuario_auth`:
  `42` → `9180eff3-4e75-5137-95fa-1879656f1c43`, el mismo namespace canónico
  de `main`. Se eliminó el namespace alternativo.
- El outbox sigue escribiéndose una sola vez, dentro del savepoint de primera
  aceptación, y se conserva la barrera de borrado de `main`.
- La E2E usa solo `RABBITMQ_PRUEBA_URL`, falla explícitamente si falta el
  broker, npm, node o tsx, y no tiene skips ni defaults locales.
- El job `backend/subscriptions` instala las dependencias Python de gateway y
  Analytics que necesita el recorrido.

### Evidencia
- Comando exacto del job, `pytest -v`: 585 passed, 3 E2E, 0 skipped (EXIT=0).
- Sin `RABBITMQ_PRUEBA_URL`: 3 errores explícitos, 0 skips (EXIT=1).
- Checks del SHA integrado: pendientes de publicar en este cuerpo.

### Alcance real
- El gateway HTTP se sustituye por un middleware de prueba que reutiliza el
  validador de tokens; las sesiones usan `LocMemCache`.
- El consentimiento es un doble que siempre devuelve `True`.
- Los eventos son fixtures y el resumen se calcula con código local.
- No se ejercita captura desde dispositivo ni proveedores de IA externos;
  quedan como pendientes, no como evidencia de cierre.

Detalle: `docs/entregas/sprint-3-victor.md` y
`docs/contratos/uso-recolectores-v1.md`. Sin secretos ni cadenas de conexión.
```
