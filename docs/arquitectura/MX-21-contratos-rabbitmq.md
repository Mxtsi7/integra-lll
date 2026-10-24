# MX-21 — Contratos RabbitMQ y prueba de intercambio

**Fecha:** 2026-10-20 · **Responsable:** Maximiliano Sáez · **Tipo:** ESTUDIO, P0.
**Estado:** entrega para revisión; acuerdo de Victor/Felipe y revisión ajena pendientes.
[Tarjeta MX-21](https://trello.com/c/DgW1gqBf). Base inicial: `728d975495f22f6215789857958430bbd508876a`.
Revisión de correcciones: `main`, `a7d4950a92041466ac39fe2399b02fcc28b076ca`, integrado a la rama con merge.

## Contexto y alcance

Se extienden el [catálogo único](../../shared/events/catalogo.md) y [ADR-003](ADR-003-comunicacion.md).
En el `main` inspeccionado, `services/subscriptions/events/__init__.py` está vacío y Notifications no tiene modelos de dominio.
Ya existe `Subscription.EventoEstado` y la auditoría `TransicionEstado` de #66; se reutiliza su causa de transición.
Se entregan decisión, esquema, ejemplos y PoC aislada. No se conectan vistas, señales, jobs ni modelos reales.
[VI-26 / Victor](https://trello.com/c/7zMEZHt0) implementa productores/outbox;
[FE-24 / Felipe](https://trello.com/c/KVs2FHQq) implementa consumidores y emisión de alertas.
No se cierra ninguna de esas tarjetas ni se sustituye su integración por esta muestra.

## Decisión y alternativas

Se conservan nombres españoles y envoltura existente. Los nombres ingleses son equivalencias documentales;
no se publican ambas variantes. Renombrar todo al inglés rompe el catálogo; publicar ambos duplica hechos.
Se usa **versión 2** para los cuatro contratos de esta entrega: el snapshot requerido amplía de forma
incompatible los datos mínimos de created/updated v1. Reutilizar v1 ocultaría ese cambio.
Los contratos v1 del catálogo siguen vigentes; no se renombran ni eliminan. No se introduce otro exchange.
Routing explícito por versión evita entregar payloads v2 a consumidores que solo conocen v1.

| Referencia del adjunto | `evento` canónico | Publica | Consume |
|---|---|---|---|
| `subscription.created` | `suscripcion.creada` | subscriptions / VI-26 | analytics, notifications |
| `subscription.updated` | `suscripcion.actualizada` | subscriptions / VI-26 | analytics, notifications |
| `subscription.state_changed` | `suscripcion.estado_cambiado` | subscriptions / VI-26 | analytics, notifications |
| `alert.due` | `alerta.activada` | notifications / FE-24 | notifications, worker de entrega |

`alerta.activada` significa que llegó el instante programado de una alerta; no que un pago esté atrasado.
Tipos iniciales: `proximo_cobro`, `fin_prueba`. No fija anticipaciones nuevas ni envía correo por sí misma.
Cada transición emite `estado_cambiado`; `actualizada` comunica cambios de otros campos.
Si una operación cambia ambos, son dos hechos con IDs distintos y el mismo correlation_id;
el receptor asigna efectos distintos por tipo.

### Cancelaciones y compatibilidad v1

Para VI-26/FE-24, una cancelación publica **solo `suscripcion.estado_cambiado.v2`**, con `estado=cancelado`
y su `evento_estado` (por ejemplo, `cancelacion_usuario` o `sin_respuesta_30_dias`). No se publica además
`suscripcion.cancelada` v1 por defecto. Su definición permanece en el catálogo para consumidores históricos;
conservar el contrato no significa activar publicación doble. En esta base no hay publicador de dominio conectado.
Si se identifica un consumidor v1 activo, VI-26 deberá acordar un adaptador de compatibilidad antes de migrarlo:
conservar el mismo `id` del hecho y `correlation_id`, rutas/colas separadas por versión y un único efecto por consumidor.
El adaptador debe preservar `motivo` y `ahorro_mensual` del contrato v1; no se sustituye un payload v1 por uno v2.
Esta entrega no implementa ese adaptador ni afirma haber migrado consumidores. El snapshot v2 incluye monto y ciclo,
pero no promete el cálculo de ahorro de v1 ni un motivo libre escrito por el usuario.

## Contrato y ejemplos

La definición verificable es [mx21-v2.schema.json](../../shared/events/mx21-v2.schema.json).
Sobre JSON UTF-8: `evento`, `version` (entero 2), `id`, `ocurrido_en`, `correlation_id`, `organizacion_id`, `datos`.
`id` es el **event_id** solicitado, `organizacion_id` es el **tenant**: no se añaden alias paralelos.
Los IDs de evento, organización, suscripción, proveedor y alerta, y la correlación son UUID.
**`usuario_id` es un entero JSON positivo**, de 1 a 9223372036854775807, coherente con `auth.User.id`
(`BigAutoField`); no es UUID ni texto numérico. Timestamps RFC3339 UTC terminados en Z; fechas de cobro `YYYY-MM-DD`.
`id` nace una vez por hecho; reintentos y reentregas conservan el mismo. Se propaga `X-Correlation-ID`
de HTTP; un job sin petición genera su correlación al comenzar y la conserva durante sus reintentos.

Los tres eventos de suscripción incluyen snapshot posterior al commit: `suscripcion_id`, `proveedor_id`
(UUID o null cuando no hay asociación), `nombre`, `monto` decimal positivo como texto con dos decimales,
`moneda` como código de tres letras mayúsculas (`^[A-Z]{3}$`), `ciclo` mensual/anual, `proximo_cobro` y `estado` del modelo vigente.
El esquema valida el formato de moneda, no un enum fijo ni su existencia: el productor valida el catálogo de BD.
Así admite CLP/USD actuales y códigos como EUR o BRL del catálogo abierto propuesto en #77, todavía pendiente de merge.
Se mapean `frecuencia` → `ciclo` y `fecha_proximo_cobro` → `proximo_cobro`, sin renombrar el modelo.
Updated añade `campos_modificados` no vacío con nombres del contrato, nunca campos internos ni secretos.
State_changed añade `estado_anterior`, diferente de `estado`, y **`evento_estado` opcional** con un valor de
`Subscription.EventoEstado` (los once códigos actuales están en el esquema). VI-26 lo copia de `TransicionEstado.evento`
cuando la transición existe; el consumidor admite su ausencia para mensajes v2 anteriores y no inventa la causa.
Es un código de dominio, no texto libre ni datos del actor. Por ejemplo: `fin_prueba` o `cancelacion_usuario`.
El productor comprueba origen/destino con la máquina de estados de #66; este esquema no duplica sus reglas temporales.
Alert_due lleva `alerta_id`, `suscripcion_id`, `usuario_id`, `tipo`, `programada_para` ≤ `ocurrido_en`.
FE-24 valida la pertenencia de usuario y suscripción al tenant antes de generar/entregar la alerta.
Campos adicionales son compatibles y se ignoran si se desconocen; quitar campos, cambiar tipos o semántica exige nueva versión.

Los cuatro mensajes JSON completos se generan sin datos reales con `python scripts/mx21/intercambio.py --ejemplos`.
Incluyen los cuatro payloads y una correlación compartida; los UUID se regeneran en cada ejecución.
La alerta usa el usuario sintético entero `42`, updated usa EUR y state_changed incluye `evento_estado=fin_prueba`.

## Transporte y tratamiento de fallos

Exchange `suscripciones`, topic, durable; routing key exacta `<evento>.v2`.
El nombre del exchange es histórico: también transporta alertas y otros hechos del catálogo; no restringe el productor.
Se conserva para evitar un segundo exchange y una migración de bindings ajena a MX-21.
AMQP: `content_type=application/json`, `delivery_mode=2`, `message_id=id`, `correlation_id=correlation_id` del JSON.
Validar esquema con comprobación de formatos, coherencia de metadatos, tenant y versión antes de cualquier efecto.
Un UUID de organización válido no autoriza por sí mismo: ACL de broker por servicio y comprobación de pertenencia son necesarias.
No transportar tokens, contraseñas, correos ni cuerpos de mensajes. Logs de fallo conservan IDs/tipo/motivo, sin secretos.

VI-26 persiste hecho y outbox en la misma transacción; publica después del commit con confirms y `mandatory`.
Si falla o no hay ruta, mantiene el mismo ID pendiente. Un confirm del broker no confirma el efecto del consumidor.
Colas de servicio durables e independientes: `analytics.dominio.v2` y `notifications.dominio.v2` para las tres rutas de suscripción;
`notifications.entregas.v2` para `alerta.activada.v2`, separada del generador para evitar realimentación.
FE-24 guarda inbox con unicidad `(consumidor, organizacion_id, id)` y el efecto/outbox local en una transacción;
ack después del commit. Un duplicado se confirma sin efecto adicional. No expirar inbox sin acordar ventana de replay.
Para entregas externas, usar outbox e idempotencia del canal; esta PoC no demuestra exactamente una entrega de correo.
Mensajes inválidos/versiones desconocidas van a cola de fallos con `reject(requeue=False)` y trazabilidad.
Fallos transitorios: FE-24 debe implementar reintentos limitados con espera y DLQ al agotarlos; evitar requeue inmediato infinito.
La política y valores operativos de reintento quedan a esa implementación. Replay conserva identidad tras corregir la causa.

## Reproducción y evidencia

Desde la raíz, Python 3.12: `python -m pip install -r scripts/mx21/requirements.txt`.
Sin broker: `python scripts/mx21/intercambio.py --sin-broker` comprueba contrato e inbox SQLite; no valida AMQP.
Con el RabbitMQ 3.13 del compose: `docker compose up -d rabbitmq`; configurar `RABBITMQ_URL` hacia localhost:5672
(en PowerShell: `$env:RABBITMQ_URL='amqp://guest:guest@localhost:5672/'`) y ejecutar `python scripts/mx21/intercambio.py`.
Esa URL es solo el entorno local predeterminado del compose; no registrar URLs con credenciales reales en logs.
La muestra crea dos colas `mx21.<uuid>`/`.fallos`, las elimina al terminar y conserva el exchange compartido.
No usa colas de los servicios ni toca sus bases. Usar broker de desarrollo aislado.

Resultado esperado de la muestra corregida: **4 contratos, 5 efectos en 2 tenants, 1 duplicado y 13 rechazos**.
Rechazos: tenant ausente/vacío, correlación inválida, versión desconocida, alias inglés, payload incompleto, monto negativo,
usuario UUID/cero/texto, moneda minúscula, causa desconocida y transición sin cambio de estado.
Regresiones adicionales: `python -m unittest discover -s scripts/mx21 -p 'test_*.py' -v` comprueba límites del ID,
monedas abiertas/formato inválido, compatibilidad sin causa y ausencia de efectos ante una causa inválida.
La ejecución AMQP además comprueba confirms, routing, ack, DLQ y reentrega posterior al commit sin repetir efecto,
reabriendo SQLite entre entregas; es una simulación del ack perdido, no un apagado forzado del proceso.
El workflow [MX-21](../../.github/workflows/mx21.yml) ejecuta regresiones y la prueba completa con broker real en cada PR
de estos archivos y cuando cambian modelos de Auth/Subscriptions, configuración de Auth o eventos de Subscriptions.
**Seguimiento VI-26:** añadir una prueba que valide el payload real del productor contra este esquema. Los ejemplos
sintéticos y el filtro de paths no garantizan por sí solos que los modelos y el productor permanezcan alineados.
[Ejecución AMQP exitosa](https://github.com/Mxtsi7/integra-lll/actions/runs/39513555713/job/118940164463)
del commit inicial `013a076ff2099f40a7582e1b59f6e1dd392ae2a5` (evidencia anterior a las correcciones): 4 contratos, 5 efectos, 1 duplicado, 7 rechazos;
reentrega deduplicada, DLQ verificada y colas vacías al finalizar. Un fallo del broker hace fallar la prueba, sin fallback a mocks.

## Recepción y cierre

Victor y Felipe deben revisar nombres, snapshot, rutas/versiones y ejecutar la muestra antes de integrar sus tarjetas.
Registrar su aceptación o diferencias en la revisión del PR, sin atribuir un acuerdo todavía no recibido.
Pendientes para cerrar MX-21 según Trello/CONTRIBUTING: revisión por otra persona, validación del receptor y merge.
La trazabilidad de IDs funcionales del adjunto se conserva para MX-22; esta tarea no redefine requisitos.

Referencias técnicas: [confirms y ack](https://www.rabbitmq.com/docs/confirms),
[dead lettering](https://www.rabbitmq.com/docs/dlx), [validación de formatos](https://python-jsonschema.readthedocs.io/en/stable/validate/).

