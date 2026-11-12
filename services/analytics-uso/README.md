# analytics-uso

Servicio Node.js/TypeScript que recibe los eventos de uso de recolectores y
mantiene los agregados diarios y mensuales de Analytics.

Implementa las tareas **S3-VI-07, S3-VI-09, S3-VI-10, S3-VI-11, S3-VI-12 y
S3-VI-14** sobre el contrato canónico
[`uso-recolectores-v1`](../../docs/contratos/uso-recolectores-v1.md).

El servicio es independiente del Analytics Python/Django existente: usa el
esquema PostgreSQL `analytics` con tablas propias `uso_*` y un exchange
dedicado `uso.eventos`. No modifica las tablas ni los consumidores históricos.

## Qué hace

| Tarea | Implementación |
|---|---|
| S3-VI-07 | `src/publicador/uso.publisher.ts`: publica eventos aceptados en `uso.eventos` con routing key `uso.registrado`, confirms y `mandatory`. La recepción de `subscriptions` usa el mismo contrato desde `services/subscriptions/events/uso.py` (outbox transaccional). |
| S3-VI-09 | `src/consumidor/uso.consumer.ts`: worker que escucha `analytics.uso.cola`. |
| S3-VI-10 | `src/infraestructura/topologia.ts`: exchange, cola quorum, DLX y cola de fallos. |
| S3-VI-11 | Inbox en `analytics.uso_evento` con clave `(organizacion_id, recolector_id, event_id)` y huella del contenido + destino. Duplicado → ACK sin efectos; conflicto → DLQ. |
| S3-VI-12 | Agregados `analytics.uso_diario` y `analytics.uso_mensual`. |
| S3-VI-14 | Unión temporal de `tramos_actividad` antes de sumar: dos fuentes simultáneas no duplican minutos. |

## Contrato

El cuerpo HTTP canónico no lleva identidad ni suscripción. El sobre interno de
RabbitMQ sí las añade porque la recepción ya autenticó al usuario y autorizó el
destino:

```json
{
  "evento": "uso.registrado",
  "version": 1,
  "id": "22222222-2222-4222-8222-222222222222",
  "ocurrido_en": "2026-11-09T12:02:01Z",
  "correlation_id": "4b8e77a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
  "organizacion_id": "11111111-1111-4111-8111-111111111111",
  "datos": {
    "version": 1,
    "event_id": "22222222-2222-4222-8222-222222222222",
    "recolector_id": "33333333-3333-4333-8333-333333333333",
    "origen": "android",
    "inicio": "2026-11-09T12:00:00Z",
    "fin": "2026-11-09T12:02:00Z",
    "duracion_ms": 30000,
    "tramos_actividad": [
      { "inicio": "2026-11-09T12:00:00Z", "fin": "2026-11-09T12:00:30Z" }
    ],
    "zona_horaria": "America/Santiago",
    "cobertura": "completa",
    "estado": "activo",
    "suscripcion_id": "11111111-1111-4111-8111-111111111111",
    "usuario_id": "5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d"
  }
}
```

Reglas semánticas validadas antes de tocar la base o publicar:

- `inicio < fin`; ventana semiabierta `[inicio, fin)`.
- `duracion_ms` es entero y coincide exactamente con la suma de los tramos.
- Tramos positivos, ordenados, sin solapamientos internos y contenidos en la
  ventana.
- Cada evento cabe en un único día local. `fin` puede coincidir con la
  medianoche local siguiente.
- `zona_horaria` debe existir en la base IANA.
- `pausado`, `sin_permiso`, `revocado` y `cobertura: sin_medicion` no pueden
  informar actividad positiva.
- El cuerpo canónico rechaza campos desconocidos, incluidos `usuario_id`,
  `organizacion_id` y `suscripcion_id`.

## Idempotencia y redelivery

Clave lógica:

```text
(organizacion_id, recolector_id, event_id)
```

La suscripción es destino inmutable, no parte de la clave.

El `organizacion_id` forma parte de la clave porque el contrato
(`uso-recolectores-v1`, sección 7.3) define la identidad como la sesión
autenticada —incluido el tenant— más `recolector_id` y `event_id`. Dos
organizaciones pueden reutilizar el mismo `event_id` sin colisionar; el
aislamiento multi-tenant no depende de que los UUID sean globalmente únicos.
La comparación de duplicados usa la huella SHA-256 del contenido tipado y el
destino, no el texto JSON.

1. `INSERT ... ON CONFLICT DO NOTHING` sobre la clave.
2. Si no insertó, se lee la fila existente y se compara la huella SHA-256 del
   contenido tipado + destino.
3. Misma huella y mismo destino → `duplicado`: ACK sin recalcular agregados.
4. Huella o destino distinto → `ErrorConflictoEvento`: `reject(requeue=false)`
   y el mensaje queda en la DLQ.

Los fallos transitorios de base o broker se reencolan. La cola quorum usa
`x-delivery-limit` (por defecto 5) para terminar en la DLQ en vez de girar para
siempre.

## Agregados

Por cada evento aceptado, en la misma transacción:

1. Se guardan los tramos exactos en `analytics.uso_tramo`.
2. Se bloquea la fila del día (`analytics.uso_diario ... FOR UPDATE`).
3. Se leen todos los tramos de la suscripción en ese día local y se calcula su
   **unión** temporal.
4. Se proyecta:

   ```text
   minutos_netos = ms_netos // 60000
   ms_residuo    = ms_netos % 60000
   ```

5. Se bloquea la fila mensual y se recalcula sumando los `minutos_netos` de
   cada día del mes. No se vuelve a dividir la suma mensual de milisegundos:
   un residuo diario no se convierte en un minuto mensual artificial.

La unión es la operación de S3-VI-14: Android y navegador observando los mismos
dos minutos acreditan dos minutos, no cuatro. La deduplicación por `event_id` y
la unión de intervalos son operaciones distintas.

## Integración con la recepción (S3-MX)

La recepción HTTP canónica es
`POST /api/suscripciones/{suscripcion_id}/uso/recolector/` y pertenece a
S3-MX-26..31. Este servicio no la implementa. El punto de publicación acordado
está en `services/subscriptions/events/uso.py`:

```python
from events.uso import registrar_uso

# Dentro de la misma transacción que persiste el hecho aceptado.
registrar_uso(
    organizacion_id=request.organizacion_id,
    suscripcion_id=suscripcion.id,
    usuario_id=request.usuario_id,
    evento=payload_canonico,  # UsageEventPayload, sin identidad ni destino
    correlation_id=request.correlation_id,
)
```

`registrar_uso` solo escribe el outbox. `events/despacho.py` publica después
del commit en `uso.eventos`; si RabbitMQ está caído, el evento queda pendiente
y se reintenta. La recepción nunca debe publicar directo ni aceptar
`usuario_id`, `organizacion_id` o `suscripcion_id` desde el recolector.

La decisión del exchange dedicado está en
[ADR-009](../../docs/arquitectura/ADR-009-exchange-uso.md).

## Puesta en marcha

### Local

```bash
cd services/analytics-uso
cp .env.example .env      # completar DATABASE_URL y RABBITMQ_URL
npm install
npm run migrar
npm run worker
```

En otra terminal, publicar la fixture Android:

```bash
npm run publicar:ejemplo
```

### Con el stack del repositorio

El servicio se añade con un override para no alterar el inventario del
`docker-compose.yml` principal:

```bash
docker compose -f docker-compose.yml -f docker-compose.analytics-uso.yml up \
  analytics-uso-migrar analytics-uso-worker
```

El contenedor `analytics-uso-migrar` aplica el DDL una sola vez; el worker
arranca después. El healthcheck del worker comprueba PostgreSQL y RabbitMQ.

## Variables

| Variable | Obligatoria | Defecto |
|---|---|---|
| `DATABASE_URL` | sí | — |
| `RABBITMQ_URL` | sí (worker/publicador) | — |
| `EXCHANGE_USO` | no | `uso.eventos` |
| `EXCHANGE_DLX` | no | `uso.eventos.dlx` |
| `COLA_USO` | no | `analytics.uso.cola` |
| `COLA_FALLOS` | no | `analytics.uso.fallos` |
| `ROUTING_KEY_USO` | no | `uso.registrado` |
| `PREFETCH` | no | `20` |
| `MAX_REINTENTOS` | no | `5` |
| `LOG_LEVEL` | no | `info` |
| `SQL_MIGRACION` | no | `sql/001_uso_recolectores.sql` |

## Comandos

```bash
npm run typecheck        # tsc sin emitir, incluye tests
npm run build            # compila a dist/
npm test                 # Vitest
npm run migrar           # aplica sql/001_uso_recolectores.sql
npm run worker           # worker de consumo
npm run salud            # healthcheck de base y broker
npm run publicar:ejemplo # publica una fixture del contrato
```

## Tablas

| Tabla | Contenido |
|---|---|
| `analytics.uso_evento` | Hecho aceptado, cuerpo normalizado, `fecha_local`, `huella`, `recibido_en`. |
| `analytics.uso_tramo` | Tramos exactos por evento para la unión temporal. |
| `analytics.uso_diario` | `ms_netos`, `minutos_netos` y `ms_residuo` por suscripción y día local. |
| `analytics.uso_mensual` | Suma de minutos diarios por suscripción y mes. |
| `analytics.uso_cobertura` | Vista derivada con la proyección interna de cobertura. |

## Estructura

```text
src/
  dominio/          contrato, fechas, intervalos, huella, validación, errores
  aplicacion/       procesador y puerto del repositorio
  infraestructura/  config, PostgreSQL, topología, repositorio, logger
  publicador/       publicador fiable y ejemplo
  consumidor/       worker de RabbitMQ
  worker.ts         entrada del consumidor
  migrar.ts         DDL idempotente
  verificar-salud.ts
sql/
  001_uso_recolectores.sql
tests/
```

## Pruebas

### Unitarias y de contrato

Las pruebas cubren, sin broker ni base reales:

- unión de 120 s / 180 s / 50 s, 30 s + 30 s y huecos de cobertura;
- medianoche local, día de 25 h por cambio de horario y cruce de día;
- fechas UTC imposibles, zonas IANA inválidas y UUID v4;
- duración inconsistente, tramos fuera de ventana, solapados o desordenados;
- estados no activos y `sin_medicion` sin actividad positiva;
- idempotencia: duplicado, conflicto y validación antes del repositorio;
- proyección de residuos: 30 s + 30 s del mismo día = 1 minuto; 30 s de dos
  días distintos = 0 minutos mensuales;
- huella canónica independiente del orden de claves.

### Integración real (PostgreSQL + RabbitMQ)

`tests/integracion/` ejercita el pipeline completo con un broker y una base
reales: publica eventos con solapamiento entre Android y navegador, arranca el
worker, verifica la unión y los agregados, republica para comprobar el ACK de
duplicados, fuerza un conflicto y comprueba que el mismo `event_id` en otro
tenant se acepta.

Requisitos: Docker y los puertos `55432` (PostgreSQL) y `55672` (RabbitMQ)
libres.

```bash
docker compose -f docker-compose.analytics-uso-test.yml up -d --wait
export INTEGRACION_USO=1
export DATABASE_URL='postgres://postgres:test@localhost:55432/suscripciones_test'
export RABBITMQ_URL='amqp://test:test@localhost:55672/'
npm run test:integracion
docker compose -f docker-compose.analytics-uso-test.yml down -v
```

En PowerShell, usar `$env:INTEGRACION_USO='1'`, etc. Sin
`INTEGRACION_USO=1` la suite se omite y `npm test` sigue sin necesitar
infraestructura.
