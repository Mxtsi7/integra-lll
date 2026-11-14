# ADR-009 — Exchange dedicado para el uso de recolectores

**Fecha:** 2026-11-12 · **Estado:** aceptada

## Contexto

El contrato canónico [`uso-recolectores-v1`](../contratos/uso-recolectores-v1.md)
introduce un hecho nuevo: la observación de actividad de un recolector
(Android o navegador) sobre una suscripción. El pipeline de S3-VI publica,
consume y agrega ese hecho.

La decisión [MX-21](MX-21-contratos-rabbitmq.md) dice que no se introduce otro
exchange y conserva `suscripciones` para los contratos de dominio v2. Esa regla
evita duplicar rutas para los mismos hechos de suscripción, pero no resuelve un
dominio distinto:

- El `uso.registrado` histórico del catálogo lleva `suscripcion_id`, `minutos`,
  `fecha` y `fuente`, y tiene consumidores/definiciones previas. Publicar el
  cuerpo canónico nuevo en la misma routing key rompería a esos receptores.
- El uso es telemetría de alto volumen, con su propia retención, DLQ y límite
  de entregas; mezclarlo con los eventos de suscripción obliga a compartir
  operación y diagnóstico.
- El productor natural es la recepción autenticada de S3-MX-26..31 y el
  consumidor es el worker de S3-VI-09. Ambos pueden desplegarse y escalarse por
  separado.

## Decisión

Se usa un exchange propio para el contrato de uso:

| Elemento | Valor |
|---|---|
| Exchange | `uso.eventos` (topic, durable) |
| Routing key | `uso.registrado` |
| Cola de consumo | `analytics.uso.cola` (quorum, durable) |
| Dead-letter exchange | `uso.eventos.dlx` (topic, durable) |
| Cola de fallos | `analytics.uso.fallos` (quorum, durable) |
| Límite de entregas | `x-delivery-limit` = `MAX_REINTENTOS` (5 por defecto) |

Los nombres son configurables por entorno (`EXCHANGE_USO`, `EXCHANGE_DLX`,
`COLA_USO`, `COLA_FALLOS`, `ROUTING_KEY_USO`) para que operaciones pueda
alinearlos con la ACL del broker sin recompilar.

El publicador (`services/subscriptions/events/uso.py`) declara exchange, colas
y enlace antes de publicar, igual que el publicador MX-21. Así un evento
publicado antes de que arranque el worker queda en la cola durable en vez de
fallar como `UnroutableError`. El consumidor declara la misma topología; ambas
declaraciones deben coincidir.

El sobre interno conserva la envoltura común del catálogo:

```json
{
  "evento": "uso.registrado",
  "version": 1,
  "id": "<datos.event_id>",
  "ocurrido_en": "...Z",
  "correlation_id": "...",
  "organizacion_id": "...",
  "datos": { "...cuerpo canónico...", "suscripcion_id": "...", "usuario_id": "..." }
}
```

`id` es el `event_id` del hecho, no el id de la fila del outbox: es la clave que
permite deduplicar en Analytics.

## Alternativas descartadas

1. **Reutilizar `suscripciones` con routing key `uso.registrado.v1`.**
   Mantiene un solo exchange, pero comparte espacio con consumidores y
   políticas de suscripción; además el catálogo ya define `uso.registrado` con
   otro cuerpo. La ambigüedad de nombres es peor que un exchange adicional.
2. **Publicar el cuerpo canónico en `uso.registrado` sin versión.**
   Rompe a cualquier receptor del contrato histórico y no permite convivir
   durante la transición.
3. **Publicar desde la recepción sin outbox.**
   Si RabbitMQ está caído, la aceptación HTTP quedaría huérfana o fallaría
   después de persistir. El outbox de `subscriptions` ya resuelve el después
   del commit.

## Consecuencias

- MX-21 sigue vigente para los contratos de suscripción v2; esta ADR registra
  una excepción explícita para el dominio de uso, no un cambio retroactivo.
- Operaciones debe crear la ACL del exchange `uso.eventos` y su DLX para el
  usuario de `subscriptions` (productor) y el de `analytics-uso` (consumidor).
- La clave de idempotencia del consumidor es
  `(organizacion_id, recolector_id, event_id)`, tal como fija la sección 7.3
  del contrato. El tenant forma parte de la identidad autenticada; dos
  organizaciones pueden reutilizar el mismo `event_id` sin colisionar.
- El catálogo (`shared/events/catalogo.md`) documenta el contrato nuevo y deja
  el payload histórico marcado como legado.
- Cambiar nombres o argumentos de una cola ya existente exige una ventana
  operativa: RabbitMQ falla con `PRECONDITION_FAILED` si los argumentos no
  coinciden.
