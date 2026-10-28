# Catálogo de eventos

Contrato entre servicios. **Un cambio acá afecta a todo el equipo**: se avisa
antes, nunca se descubre en un merge.

Broker: RabbitMQ · Exchange: `suscripciones` (tipo `topic`)

---

## Formato común

Todo evento tiene la misma envoltura. Sin excepciones.

```json
{
  "evento": "suscripcion.creada",
  "version": 1,
  "id": "8f14e45f-ceea-467a-9f45-2b3c1d5e7a90",
  "ocurrido_en": "2026-08-21T14:32:10Z",
  "correlation_id": "4b8e77a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
  "organizacion_id": "9c214077-3b5a-4e2f-9d81-6a7b8c9d0e1f",
  "datos": { }
}
```

| Campo | Para qué |
|---|---|
| `evento` | Nombre en formato `entidad.accion`, siempre en pasado |
| `version` | Permite evolucionar el esquema sin romper a los consumidores |
| `id` | Identificador único. **Sirve para descartar duplicados** |
| `ocurrido_en` | Momento del hecho, en UTC |
| `correlation_id` | Une esta operación con la petición HTTP que la originó |
| `organizacion_id` | ⚠️ **Obligatorio.** El contexto multi-tenant viaja en el evento |
| `datos` | Carga útil propia de cada evento |

---

## Eventos

### Contrato de intercambio MX-21 (v2, para revisión de receptores)

La [decisión MX-21](../../docs/arquitectura/MX-21-contratos-rabbitmq.md) amplía este
catálogo con un [esquema verificable](mx21-v2.schema.json), ejemplos y prueba AMQP.
Conserva la envoltura; `id` equivale a event_id y `organizacion_id` al tenant.
Los nombres ingleses solo sirven de referencia, no son rutas alternativas.

| Referencia | Evento canónico v2 / routing key | Publica |
|---|---|---|
| `subscription.created` | `suscripcion.creada` / `suscripcion.creada.v2` | subscriptions |
| `subscription.updated` | `suscripcion.actualizada` / `suscripcion.actualizada.v2` | subscriptions |
| `subscription.state_changed` | `suscripcion.estado_cambiado` / `suscripcion.estado_cambiado.v2` | subscriptions |
| `alert.due` | `alerta.activada` / `alerta.activada.v2` | notifications |

Las tablas siguientes conservan los contratos v1; no se migran consumidores
automáticamente. Los productores/consumidores reales corresponden a VI-26 y FE-24.
En v2, `alerta.activada.datos.usuario_id` es entero positivo de Auth (no UUID),
`moneda` acepta códigos de tres letras mayúsculas del catálogo de BD y
`estado_cambiado` admite `evento_estado` opcional, tomado de `TransicionEstado.evento`.
Una cancelación en VI-26 publica solo `suscripcion.estado_cambiado.v2` por defecto;
`suscripcion.cancelada` v1 se conserva como definición, sin emisión doble automática.
Si hay receptores v1 activos, acordar el adaptador descrito en MX-21 antes de migrarlos.
El nombre histórico del exchange `suscripciones` también abarca alertas y los demás dominios de este catálogo.

### Publica `subscriptions`

| Evento | Cuándo | Datos | Escucha |
|---|---|---|---|
| `suscripcion.creada` | Se registra una suscripción | `suscripcion_id`, `proveedor_id`, `monto`, `ciclo`, `proximo_cobro` | analytics, notifications |
| `suscripcion.actualizada` | Cambia monto, ciclo o estado | `suscripcion_id`, `campos_modificados` | analytics |
| `suscripcion.cancelada` | El usuario la marca como cancelada | `suscripcion_id`, `motivo`, `ahorro_mensual` | analytics, notifications |
| `cobro.registrado` | Se detecta o registra un cobro | `suscripcion_id`, `monto`, `fecha` | analytics |
| `precio.aumentado` | Un cobro supera al anterior del mismo servicio | `suscripcion_id`, `monto_anterior`, `monto_nuevo` | notifications |

### Publica `connectors`

| Evento | Cuándo | Datos | Escucha |
|---|---|---|---|
| `conector.vinculado` | El usuario autoriza una cuenta externa | `conector_id`, `tipo`, `usuario_id` | analytics |
| `conector.fallido` | La sincronización falla tras los reintentos | `conector_id`, `tipo`, `error` | notifications |
| `uso.registrado` | Llegan datos de uso desde una API externa | `suscripcion_id`, `minutos`, `fecha`, `fuente` | analytics |
| `cobro.detectado` | Se identifica un cobro en el correo | `proveedor`, `monto`, `fecha`, `correo_id` | subscriptions |

### Publica `analytics`

| Evento | Cuándo | Datos | Escucha |
|---|---|---|---|
| `recomendacion.generada` | El puntaje supera el umbral | `suscripcion_id`, `puntaje`, `motivo`, `ahorro_estimado` | notifications |
| `solapamiento.detectado` v1 | Dos servicios cubren lo mismo | `suscripcion_ids`, `categoria` | notifications |
| `recomendacion.consolidacion_generada` v1 | Un solapamiento explícito y evidencia reciente de uso/costo habilitan una revisión de consolidación | `tipo`, `categoria`, `suscripcion_candidata`, `suscripciones_relacionadas`, `motivo`, `ahorro_potencial`, `evidencia`, `evento_origen_id` | notifications |

Para `solapamiento.detectado` v2, el routing key es
`solapamiento.detectado.v2`; `suscripciones` contiene el snapshot completo del
grupo y cada registro lleva `id`, `organizacion_id`, `nombre`, `categoria`,
`estado`, `activa`, `moneda`, `monto`, `frecuencia`, `uso_observado_desde` y
`ultimo_uso`.

> **Nota de integración (VI-20/VI-17):** la emisión de `solapamiento.detectado` v2
> con evidencia real depende de una tarea productora con catálogo de evidencias.
> `analytics` (VI-20) implementa el consumidor (`consumir_solapamientos`) para
> procesar ese contrato y, desde VI-17, persiste cada
> `recomendacion.consolidacion_generada` antes de publicarla. El listado queda en
> `GET /api/recomendaciones/` (Analytics, expuesto por el gateway) y aplica
> RN-REC-001 por moneda; la cola `analytics.recomendaciones.emitidas` mantiene
> `x-max-length: 10000` como límite de seguridad para sus consumidores.

La versión 1 sigue disponible para sus consumidores existentes, pero no habilita
recomendaciones de consolidación. La salida se publica con el routing key
`recomendacion.consolidacion_generada.v1`.

### Publica `auth`

| Evento | Cuándo | Datos | Escucha |
|---|---|---|---|
| `organizacion.creada` | Se registra una organización | `organizacion_id`, `nombre`, `plan` | todos |
| `usuario.creado` | Se suma un miembro | `usuario_id`, `email`, `rol` | notifications |
| `usuario.eliminado` | Se retira un miembro | `usuario_id` | subscriptions, analytics |

---

## Reglas

**1. Los consumidores son idempotentes.** Un evento puede llegar dos veces —
RabbitMQ garantiza *al menos una* entrega, no *exactamente una*. Guarda el `id`
de los eventos procesados y descarta los repetidos.

**2. Los eventos se nombran en pasado.** `suscripcion.creada`, no
`crear.suscripcion`. Un evento describe un hecho consumado, no una orden. Si
necesitas ordenarle algo a otro servicio, eso es una llamada HTTP, no un evento.

**3. El evento lleva los datos que el consumidor necesita.** Si `notifications`
tiene que llamar de vuelta a `subscriptions` para poder actuar, el evento estaba
mal diseñado. Se prefiere duplicar un par de campos antes que acoplar servicios.

**4. `organizacion_id` es obligatorio.** Sin él, el consumidor no sabe de qué
cliente son los datos que está procesando. Un evento sin ese campo se rechaza.

**5. Los cambios de esquema suben la `version`.** Los consumidores deben poder
procesar la versión anterior durante la transición.

---

## Cómo probarlo

El panel de RabbitMQ está en http://localhost:15672 (usuario y clave: `guest`).
Desde ahí se ven las colas, los mensajes acumulados y se pueden publicar eventos
a mano para probar un consumidor de forma aislada.

Para la defensa: publicar un evento en vivo desde el panel y mostrar cómo el
servicio reacciona es una demostración muy convincente de que la arquitectura
funciona de verdad.

