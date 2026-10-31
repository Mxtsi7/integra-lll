# Analytics: recomendaciones de consolidación

`analytics.jobs.procesar_evento_solapamiento()` consume la envoltura v2 de
`solapamiento.detectado` y devuelve cero o más eventos
`recomendacion.consolidacion_generada` v1. La entrada debe proceder del broker
interno; el handler comprueba el esquema y la pertenencia al tenant, no la
autenticidad criptográfica del publicador.

## Contrato de entrada

El evento v2 incluye los campos comunes del catálogo (`id`, `ocurrido_en`,
`correlation_id`, `organizacion_id`) y, dentro de `datos`:

- `suscripcion_ids` y `categoria`;
- `evidencia_id`, `evidencia_url` HTTPS y `evidencia_descripcion`;
- `suscripciones`: snapshot verificado que corresponde exactamente a los IDs
  declarados.

Cada suscripción del snapshot incluye `id`, `organizacion_id`, `nombre`,
`categoria`, `estado`, `activa`, `moneda`, `monto`, `frecuencia`
(`mensual` o `anual`), `uso_observado_desde` y `ultimo_uso` (fecha o `null`).
Un registro de otro tenant, un snapshot que no coincide con los IDs o evidencia
sin enlace produce un error explícito. La evaluación del uso se ancla a la fecha
de `ocurrido_en`, convertida a la zona horaria del servicio; reentregar el mismo
snapshot en otra fecha no amplía artificialmente su período de observación. Un
evento v1 no es suficiente para generar recomendaciones.

## Regla de recomendación

Se genera una recomendación solo cuando existe evidencia explícita enlazada de
solapamiento, la suscripción candidata está activa (`activo` o `fantasma`), su
categoría no es `otro`, su historial cubre más de 45 días sin uso registrado y
otra suscripción del grupo sí registra uso en los últimos 45 días.

El motivo identifica la candidata y las relacionadas por nombre e ID, describe
el uso observado y expresa el cálculo del ahorro. El importe es potencial: se
normaliza el costo recurrente de la candidata a un monto mensual (un costo anual
se divide por 12), pero no se convierten ni suman monedas distintas. No se
afirma equivalencia entre los proveedores.

La regla de bajo uso por horas pertenece a FE-29 y **no** está implementada acá.
Tampoco se recomienda por compartir categoría: sin solapamiento explícito el job
no produce salidas.

## Persistencia y listado (VI-17)

`analytics.event_consumer.procesar_mensaje()` persiste cada salida antes de
publicarla:

- tabla `recomendacion_consolidacion`, aislada por `organizacion_id`;
- `id` = identificador determinista del evento de salida, por lo que una
  reentrega actualiza la misma fila;
- `estado` (`vigente` o `descartada`) pertenece a la recomendación, no a la
  suscripción. Una reentrega nunca revive una recomendación descartada. El
  endpoint de descarte y su auditoría son parte de VI-18 (#109); acá solo se
  reserva el estado para que el listado no muestre descartadas.

`GET /api/recomendaciones/` (ruta que el gateway ya envía a Analytics) devuelve
una envoltura compatible con el cliente compartido de AN-20:

```json
{
  "results": [
    {
      "id": "uuid",
      "suscripcion_id": "uuid",
      "nombre": "Servicio A",
      "categoria": "streaming",
      "motivo": "…",
      "ahorro_estimado": 9990.0,
      "moneda": "CLP",
      "estado": "vigente",
      "evidencia": {"id": "…", "url": "https://…", "descripcion": "…"}
    }
  ],
  "total": 1,
  "moneda": null,
  "umbral_aplicado": null,
  "disponible": true,
  "motivo_sin_sugerencias": null,
  "umbrales_no_configurados": []
}
```

La petición debe traer `X-Organizacion-Id`; sin cabecera responde `403`. El
filtro opcional `?moneda=CLP` se normaliza a mayúsculas y un código inválido
responde `400`.

## RN-REC-001: umbral de ahorro por moneda (VI-21)

El umbral vive en la tabla global `umbral_ahorro` (`moneda`, `monto`, `activo`).
`analytics.reglas.umbral_minimo()` es la única regla de lectura. **No hay valor
por defecto**: una moneda sin fila activa no habilita recomendaciones. En ese
caso el listado excluye esas filas, responde `disponible: false`, las informa en
`umbrales_no_configurados` y explica el motivo en `motivo_sin_sugerencias`.

No se cargan valores semilla. La configuración es una decisión operativa
documentada en
[`docs/investigacion/VI-21-regla-umbral-ahorro.md`](../../docs/investigacion/VI-21-regla-umbral-ahorro.md).

## Ejemplo de evento (datos de prueba)

```python
from analytics.jobs import procesar_evento_solapamiento

evento = {
    "evento": "solapamiento.detectado",
    "version": 2,
    "id": "33333333-3333-4333-8333-333333333333",
    "ocurrido_en": "2026-10-17T12:00:00Z",
    "correlation_id": "44444444-4444-4444-8444-444444444444",
    "organizacion_id": "11111111-1111-4111-8111-111111111111",
    "datos": {
        "suscripcion_ids": [
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
        ],
        "categoria": "streaming",
        "evidencia_id": "catalogo:overlap:1",
        "evidencia_url": "https://catalogo.example/overlap/1",
        "evidencia_descripcion": "La fuente documenta funciones compartidas.",
        "suscripciones": [
            {
                "id": "55555555-5555-4555-8555-555555555555",
                "organizacion_id": "11111111-1111-4111-8111-111111111111",
                "nombre": "Servicio A",
                "categoria": "streaming",
                "estado": "activo",
                "activa": True,
                "monto": "9990.00",
                "moneda": "CLP",
                "frecuencia": "mensual",
                "uso_observado_desde": "2026-07-01",
                "ultimo_uso": "2026-08-01",
            },
            {
                "id": "66666666-6666-4666-8666-666666666666",
                "organizacion_id": "11111111-1111-4111-8111-111111111111",
                "nombre": "Servicio B",
                "categoria": "streaming",
                "estado": "activo",
                "activa": True,
                "monto": "12990.00",
                "moneda": "CLP",
                "frecuencia": "mensual",
                "uso_observado_desde": "2026-07-01",
                "ultimo_uso": "2026-10-01",
            },
        ],
    },
}

eventos_recomendacion = procesar_evento_solapamiento(evento)
```

El evento de salida conserva el `correlation_id` y `organizacion_id`, lleva un
`evento_origen_id` y genera un ID determinista por evento/candidata/evidencia,
para que los consumidores puedan deduplicar reentregas. El contrato de ambos
eventos está en [`shared/events/catalogo.md`](../../shared/events/catalogo.md).

El worker se ejecuta con `python manage.py consumir_solapamientos`; consume la
ruta `solapamiento.detectado.v2` del exchange `suscripciones`, persiste y publica
`recomendacion.consolidacion_generada.v1`. Los mensajes con contrato inválido se
rechazan hacia la cola durable de mensajes inválidos. `RABBITMQ_URL` debe estar
configurada.

> **Nota:** Si la cola `analytics.recomendaciones.emitidas` ya existía previamente
> en RabbitMQ sin el argumento `x-max-length`, hay que borrarla antes de levantar
> el consumidor; de lo contrario, RabbitMQ rechazará la declaración con un error
> `PRECONDITION_FAILED`.

El productor que obtiene el snapshot verificado y la evidencia enlazada no
existe aún en los servicios disponibles. El worker no inventa esos datos: hasta
que un productor confiable publique el evento v2, no habrá recomendaciones. Los
ejemplos y fixtures de prueba son mocks, no evidencia de servicios reales.

## Asistente financiero (VI-22, VI-24)

`POST /api/asistente/` es el único endpoint de IA que consumen los clientes y
scripts. Se llega por el gateway (`/api/asistente/`); **no** existe un segundo
proxy ni acceso directo del frontend al proveedor externo.

Autorización en dos capas:

1. El gateway valida el JWT y consulta el plan real en Auth. Si no es Premium,
   responde **403** y no reenvía la petición. Si es Premium, agrega
   `X-Plan: premium`.
2. Analytics revalida `X-Plan: premium`. Un acceso directo al contenedor, un job
   mal configurado o una cabecera ausente también reciben **403**.

El contexto que se envía al proveedor se arma en el servidor y sólo incluye
datos de la organización autenticada: usos mensuales y recomendaciones
saneados, sin UUID internos, sin JWT, sin cabeceras y sin el body crudo del
cliente. Los topes de contexto están en `analytics/asistente.py`.

La frontera de salida es `analytics/sanitizacion_ia.py`:

- los nombres de servicio viajan como alias (`servicio_1`…);
- los motivos libres **no salen**: se sustituyen por el código de regla
  controlado `regla`;
- la pregunta del usuario no se copia: se reduce a intenciones de un catálogo
  cerrado más los importes, monedas y periodos reconocidos;
- nombres propios, correos, RUT, tarjetas, credenciales y UUID se quedan en el
  servidor; sólo se descartan o redactan antes de construir el payload.

La prueba `test_messages_create_recibe_el_payload_saneado` intercepta la
llamada real a `messages.create` y verifica que el prompt no contiene ninguno
de esos datos personales, ni el `motivo` original.

```http
POST /api/asistente/
Authorization: Bearer <access>
Content-Type: application/json

{"mensaje": "¿Qué reviso primero este mes?"}
```

Respuesta `200`:

```json
{
  "estado": "ok",
  "motivo": null,
  "respuesta": "…",
  "datos": {"…": "contexto saneado"}
}
```

Si el proveedor no está configurado, tarda más de 3,5 s, se agota la cuota o
devuelve una respuesta inválida, el endpoint **no falla con 500**: responde
`200` con `estado: "degradado"`, un `motivo` legible y un resumen local
determinista calculado con los mismos datos. Un usuario Free nunca ve ese
resumen: recibe `403` antes de llegar a Analytics.

La concurrencia (`IA_MAX_LLAMADAS_SIMULTANEAS`) es un límite del **proceso**:
una única instancia de `PoliticaIA` atiende todas las peticiones del contenedor,
de modo que crear la política por request no multiplica el cupo. Si no hay
plaza, responde `estado: "degradado"` con `motivo: "capacidad"` antes de llamar
al proveedor y antes de consumir la cuota mensual; la plaza se libera siempre.
No se promete un límite distribuido entre réplicas.

Resultados de regresión verificados localmente:
`analytics/test_verificar_worker.py` cubre consumidor presente, ausente y
broker caído con un `pika.frame.Method` real, y comprueba que el comando lee
`.method.consumer_count`; `analytics/test_asistente_vi22.py` cubre la privacidad
del payload y la capacidad compartida con `simultaneas=1`.

El wrapper común es `shared/ia/cliente.py` (timeout máximo y reintentos sólo
para 429/503; nunca reintenta 401/403). El comando de Analytics lo usa sin
conocer la URL interna ni la API key:

```bash
cd services/analytics
python manage.py consultar_asistente \
  --token "$ACCESS" \
  --url http://localhost:8000/api \
  --mensaje "¿Qué reviso primero este mes?"
```

Sale con código distinto de cero y un `[timeout]`, `[sin_autorizacion]`,
`[sin_conexion]` o `[reintentar]` controlado si no puede completar la consulta.
La política compartida (timeout, cuota mensual, intentos por PDF y
concurrencia) vive en `shared/ia/politica.py`.

## Pruebas

Desde `services/analytics/`:

```bash
python -m pytest analytics
python manage.py consumir_solapamientos
```
