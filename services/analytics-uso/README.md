# analytics-uso

Servicio Node.js/TypeScript que recibe los eventos de uso de recolectores y
mantiene los agregados diarios y mensuales de Analytics.

Implementa las tareas **S3-VI-07, S3-VI-09, S3-VI-11, S3-VI-12 y S3-VI-14**
sobre el contrato canónico
[`uso-recolectores-v1`](../../docs/contratos/uso-recolectores-v1.md). La
topología de eventos del pipeline de uso también forma parte de este
entregable; el **consumidor de suscripciones de S3-VI-10 pertenece a su propia
tarjeta** y no se implementa acá.

El servicio es independiente del Analytics Python/Django existente: usa el
esquema PostgreSQL `analytics` con tablas propias `uso_*` y un exchange
dedicado `uso.eventos`. No modifica las tablas ni los consumidores históricos.

## Qué hace

| Tarea | Implementación |
|---|---|
| S3-VI-07 | `src/publicador/uso.publisher.ts`: publica eventos aceptados en `uso.eventos` con routing key `uso.registrado`, confirms y `mandatory`. La recepción de `subscriptions` usa el mismo contrato desde `services/subscriptions/events/uso.py` (outbox transaccional). |
| S3-VI-09 | `src/consumidor/uso.consumer.ts`: worker que escucha `analytics.uso.cola`. |
| S3-VI-10 (topología) | `src/infraestructura/topologia.ts`: exchange, cola quorum, DLX y cola de fallos del pipeline de uso. El consumidor de suscripciones de la misma tarjeta vive en su propio entregable. |
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

`ocurrido_en` se emite siempre en UTC con **tres decimales** (por ejemplo
`2026-11-09T12:02:01.123Z`). El validador acepta 1–3 decimales; el publicador
Python recorta los microsegundos antes de serializar para que ambos lados
hablen exactamente el mismo formato.

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

## Borrado de tenant

La limpieza de `LimpiezaAnalyticsView` (Python) y este consumidor comparten la
barrera `analytics.estado_eliminacion_organizacion`:

- la limpieza toma la fila con `FOR UPDATE`, marca `eliminada = true` y borra
  `analytics.uso_tramo`, `analytics.uso_evento`, `analytics.uso_diario` y
  `analytics.uso_mensual` dentro de la misma transacción;
- `registrar()` toma la fila con `FOR SHARE` **antes de cualquier INSERT** en
  `uso_*` y vuelve a leer `eliminada` bajo el lock.

Un evento que llega mientras la limpieza está en curso espera a que confirme.
Si el tenant ya fue eliminado, `registrar()` devuelve `ignorado`: no reinserta
nada, el consumidor hace ACK y el mensaje **no** termina en la DLQ. Así una
redelivery tardía no puede resucitar filas de un tenant borrado.

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
| `analytics.estado_eliminacion_organizacion` | Barrera de borrado por tenant, compartida con `shared/borrado`. |

> **Limitación conocida:** el modelo Django `UsoMensual` de Analytics (FE-28)
> usa `db_table = "uso_mensual"` y, en producción, `search_path=analytics`. En
> una base ya migrada por ese servicio, el `CREATE TABLE IF NOT EXISTS` de este
> DDL no cambia la forma existente y el consumidor no puede escribir
> `anio`/`mes`/`ms_netos`. El DDL de este servicio es seguro en una base sin esa
> tabla; antes de desplegarlo sobre la base de Analytics hay que resolver el
> nombre (tabla propia, p. ej. `uso_mensual_recolector`, o una migración
> coordinada). La limpieza por `organizacion_id` funciona con cualquiera de las
> dos formas.

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

### Contrato cruzado Python → TypeScript

`services/subscriptions/tests/test_uso_contrato_cruzado.py` construye el sobre
real con `crear_sobre_uso` desde un `datetime` con microsegundos y lo pasa por
el mismo `ProcesadorUso` que usa el worker. Requiere `node` en `PATH` y las
dependencias de este servicio (`npm ci`). Si Python emitiera 6 decimales, el
validador TypeScript rechazaría el sobre y la prueba fallaría.

```bash
cd services/analytics-uso && npm ci
cd ../subscriptions && pytest tests/test_uso_contrato_cruzado.py -v
```

### Integración real (PostgreSQL + RabbitMQ)

`tests/integracion/` ejercita el pipeline completo con un broker y una base
reales: publica eventos con solapamiento entre Android y navegador, arranca el
worker, verifica la unión y los agregados, republica para comprobar el ACK de
duplicados, fuerza un conflicto, comprueba que el mismo `event_id` en otro
tenant se acepta y reproduce la carrera con el borrado del tenant (un evento
tardío espera la barrera y no reinserta filas).

Requisitos: Docker y los puertos `55432` (PostgreSQL) y `55672` (RabbitMQ)
libres.

```bash
# Desde la raíz del repositorio.
docker compose -f docker-compose.analytics-uso-test.yml up -d --wait
cd services/analytics-uso
export INTEGRACION_USO=1
export DATABASE_URL='postgres://postgres:test@localhost:55432/suscripciones_test'
export RABBITMQ_URL='amqp://test:test@localhost:55672/'
npm run typecheck
npm test
npm run test:integracion
cd ../..
docker compose -f docker-compose.analytics-uso-test.yml down -v
```

En PowerShell:

```powershell
# Desde la raíz del repositorio.
docker compose -f docker-compose.analytics-uso-test.yml up -d --wait
Set-Location services/analytics-uso
$env:INTEGRACION_USO='1'
$env:DATABASE_URL='postgres://postgres:test@localhost:55432/suscripciones_test'
$env:RABBITMQ_URL='amqp://test:test@localhost:55672/'
npm run typecheck
npm test
npm run test:integracion
Set-Location ../..
docker compose -f docker-compose.analytics-uso-test.yml down -v
```

Sin `INTEGRACION_USO=1` la suite de integración se omite y `npm test` sigue sin
necesitar infraestructura. En CI el job de analytics-uso la ejecuta con
`INTEGRACION_USO=1` y `EXIGIR_INTEGRACION_USO=1`: si faltara la primera, el job
falla en vez de mostrar una suite verde que no tocó la base ni el broker.

### Suites Python con PostgreSQL

Las pruebas de limpieza de tenant y de contrato cruzado necesitan PostgreSQL
real. Con el mismo contenedor de la suite anterior:

```bash
# Desde la raíz del repositorio.
export PYTHONPATH="$PWD"
export DATABASE_URL='postgres://postgres:test@localhost:55432/suscripciones_test'
export SECRET_KEY='solo-prueba'
export DEBUG='True'
export ALLOWED_HOSTS='localhost,127.0.0.1,testserver'

cd services/analytics && ESQUEMA_BD=analytics pytest -v
cd ../subscriptions && ESQUEMA_BD=subscriptions pytest -v
```

`test_eliminacion.py` aplica el DDL de `analytics-uso` y comprueba, con dos
tenants, que las cuatro tablas `uso_*` del tenant A quedan vacías y las del
tenant B intactas. En SQLite esa prueba se omite porque las tablas del
consumidor no existen ahí; en PostgreSQL se ejecuta siempre.
