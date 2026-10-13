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
| `solapamiento.detectado` | Dos servicios cubren lo mismo | `suscripcion_ids`, `categoria` | notifications |

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
