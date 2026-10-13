# ADR-003 — Comunicación síncrona y asíncrona

**Fecha:** 2026-08-21 · **Estado:** aceptada

## Contexto

Los servicios necesitan intercambiar información. Usar siempre HTTP produce
acoplamiento temporal: si un servicio está caído, el que lo llama falla. Usar
siempre eventos hace imposible responder consultas inmediatas.

## Decisión

Una regla única, fácil de aplicar sin tener que deliberar cada vez:

> Si necesito un dato **ahora** para responderle al usuario → **HTTP**
>
> Si algo **ocurrió** y otros deben reaccionar → **evento**

| Tipo | Mecanismo | Ejemplo |
|---|---|---|
| Síncrona | HTTP/REST a través del gateway | El frontend solicita el panel de gastos |
| Asíncrona | Eventos publicados en RabbitMQ | Se registró uso, entonces analytics recalcula el puntaje |

## Justificación

Todo lo que ocurre después de una acción del usuario — recalcular
recomendaciones, enviar alertas, sincronizar conectores — es asíncrono por
naturaleza. No existe razón para que el usuario espere a que termine.

Las consultas que alimentan una pantalla sí deben ser síncronas: el usuario está
esperando la respuesta en ese momento.

## Consecuencias

- Los eventos desacoplan: `analytics` puede estar caído y los eventos quedan
  encolados hasta que vuelva a estar disponible
- Consistencia eventual entre servicios, aceptable en este dominio
- Los consumidores deben ser **idempotentes**: un evento puede llegar dos veces
  y el resultado debe ser el mismo
- Cada petición y cada evento lleva un `X-Correlation-ID`, que permite seguir una
  operación completa a través de los registros de varios servicios

El catálogo de eventos está en `shared/events/catalogo.md`.
