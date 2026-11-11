# S3-VI-01 — Contrato de eventos de uso y cobertura de recolectores (v1)

**Fecha:** 2026-11-11 · **Responsables:** Victor Gonzales (receptor, Analytics)
y Maximiliano Sáez (productor, recolectores).
**Estado:** acuerdo aceptado por ambas partes; este documento lo formaliza en
el repo y es la fuente de verdad escrita.
Tarjetas: **S3-VI-01** y **S3-MX-01** (tablero Sprint 3). Este contrato no
implementa nada: fija lo que el recolector de Maxi envía y lo que el receptor
de Victor acepta, para que las dos tarjetas se integren sin sorpresas.

## Contexto y alcance

Los recolectores observan el uso REAL de las suscripciones desde los
dispositivos del usuario: el cliente Windows ([ADR-008](../arquitectura/ADR-008-cliente-windows.md)),
la extensión del navegador y las APIs externas que resuelva Connectors.
Analytics proyecta ese uso (FE-28) y puntúa el bajo uso (FE-29), y ya dejó
escrito que **la antigüedad de una suscripción no es cobertura**: sin un rango
acreditado la respuesta es `sin_datos`, no un cero inventado
(`CoberturaUso` y `registrar_cobertura` en
[analytics/uso.py](../../services/analytics/analytics/uso.py)).

Este contrato define cómo llega ese dato por HTTP: qué envía el recolector,
cuándo acredita cobertura y qué responde el receptor. Convive con el
[catálogo de eventos](../../shared/events/catalogo.md): el evento
`uso.registrado` de Connectors (vía RabbitMQ) queda para las APIs externas;
el push HTTP es la vía de los recolectores de dispositivo. Un mismo hecho no
viaja por las dos vías, y su `event_id` es único sin importar cuál se usó.

## Vocabulario oficial

| Campo | Qué significa |
|---|---|
| `event_id` | UUID del hecho. Nace una vez y sobrevive a los reintentos: es la llave de idempotencia. |
| `version` | Versión del contrato. Hoy, siempre `1`. |
| `recolector_id` | Identifica la instancia que mide (ej. `recolector-windows-8f14`). Minúsculas, dígitos, `-` y `_`. |
| `origen` | Código del origen que mide: `cliente_windows`, `extension_navegador`, `api_externa`. No es texto libre: código registrado; uno nuevo exige bump de versión. |
| `organizacion_id` | El tenant. Obligatorio, como en todo el sistema. |
| `suscripcion_id` | UUID de la suscripción observada. Debe existir en la organización: el recolector no inventa suscripciones. |
| `fecha` | El día local del usuario (`YYYY-MM-DD`, America/Santiago) al que pertenece el uso. |
| `estado` | Resultado de la medición de ese día: `con_uso`, `cero_observado` o `sin_medicion`. |
| `duracion_ms` | Uso total del día, en milisegundos enteros. Es la suma de los tramos. |
| `tramos_actividad` | Segmentos `{inicio, fin}` en UTC con `Z`: cuándo hubo actividad. Un array por día. |
| `cobertura` | `{desde, hasta}` de días (inclusive) que el recolector midió COMPLETO, o `null`. |
| `ocurrido_en` | Instante UTC en que el recolector generó el evento (cierre del día local). |
| `desde` / `hasta` | Rango inclusivo de días del `CoverageIntervalPayload`. |

El `estado` manda sobre el resto:

| `estado` | Cuándo | `duracion_ms` | `tramos_actividad` | `cobertura` |
|---|---|---|---|---|
| `con_uso` | Hubo uso medible | `> 0` | uno o más | rango acreditado o `null` |
| `cero_observado` | Se midió y no hubo nada | `0` | vacío | rango acreditado o `null` |
| `sin_medicion` | Pausa, permiso revocado, offline | `0` | vacío | siempre `null` |

## Endpoints HTTP

Autenticación JWT del usuario dueño del dispositivo ([ADR-004](../arquitectura/ADR-004-autenticacion.md)),
por el gateway. El gateway valida e inyecta `X-Usuario-Id` / `X-Organizacion-Id`;
el receptor los cruza con el payload (RF-26): el `organizacion_id` del cuerpo
debe coincidir con la identidad de la sesión, o es `403 tenant_invalido`.
Un recolector nunca manda cabeceras de identidad propias. El gateway asigna
`X-Correlation-ID` a cada petición y el receptor lo devuelve en la respuesta.

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/analitica/ingesta/uso/` | `UsageEventPayload` | 201 · 200 · 400 · 403 · 404 · 409 |
| `POST /api/analitica/ingesta/cobertura/` | `CoverageIntervalPayload` | 201 · 200 · 400 · 403 · 404 · 409 |

No va bajo `/api/usos/` (eso es de subscriptions: los registros que el usuario
escribe a mano). Esta ingesta vive en Analytics, dueño del agregado y de la
cobertura, y usa el prefijo `/api/analitica/` que el gateway ya enruta. El
`401` (token ausente o vencido) lo responde el gateway antes de llegar al
receptor; no forma parte de este contrato.

## Idempotencia y respuestas

`event_id` nace una vez por hecho y se conserva en cada reintento. El
receptor deduplica por `(organizacion_id, event_id)` y responde:

| HTTP | Cuerpo | Cuándo |
|---|---|---|
| `201` | `AcuseUso` `estado=aceptado` | Primera vez que el evento se procesa. |
| `200` | `AcuseUso` `estado=duplicado` | Mismo `event_id` ya procesado: se confirma sin repetir el efecto. |
| `409` | `ErrorUso` `codigo=conflicto_idempotencia` | Mismo `event_id` con un payload DISTINTO. No se sobrescribe. |
| `400` | `ErrorUso` `codigo=payload_invalido` | No pasa el esquema o las reglas cruzadas (ver abajo). |
| `403` | `ErrorUso` `codigo=tenant_invalido` | El `organizacion_id` no coincide con la sesión. |
| `404` | `ErrorUso` `codigo=suscripcion_desconocida` | Analytics no tiene esa suscripción en ese tenant. |

`ErrorUso.event_id` va solo cuando el receptor alcanzó a leerlo del cuerpo;
un JSON que no parsea responde sin él.

## Reglas de negocio

1. **La cobertura se acredita, no se deduce.** Que lleguen tres eventos de
   octubre no prueba que octubre esté completo. Solo acredita quien midió:
   `cobertura` no nula en `con_uso`/`cero_observado` acredita los días
   `desde…hasta` (inclusive) como completos, y el endpoint de cobertura
   existe para rangos mayores (backfills, re-sincronizaciones). Analytics
   funde tramos que se tocan y nunca encoge lo acreditado
   (`registrar_cobertura`).
2. **Cero observado ≠ sin medición.** `cero_observado` con cobertura es un
   cero REAL: FE-29 puede afirmar bajo uso sobre él (`uso_cero_real`).
   `sin_medicion` es ausencia de dato y jamás se lee como cero: mantiene la
   clasificación en `sin_datos`.
3. **`duracion_ms` es la suma de los tramos.** Cada tramo cumple
   `inicio < fin` y cae dentro del día local `fecha`. El esquema valida la
   forma; la suma y la pertenencia al día las valida el receptor
   (`400 payload_invalido` si difieren). No se aceptan floats ni negativos.
4. **`fecha` es el día local del usuario.** Los tramos van en UTC con `Z`.
   Un día de cambio de horario puede durar 23 o 25 horas: por eso
   `duracion_ms` admite hasta 90 000 000 (25 h) y el array hasta 1500 tramos.
5. **Un evento por (recolector, suscripción, día).** Se emite al cierre del
   día local. Se aceptan fechas pasadas (backfill) en cualquier orden: el
   receptor recalcula desde los registros, no suma sobre lo que había.
6. **El receptor no crea suscripciones.** `404 suscripcion_desconocida`: el
   recolector solo reporta suscripciones existentes en la organización.
7. **Campos adicionales se ignoran** si no se conocen. Quitar un campo,
   cambiar su tipo o su semántica exige `version: 2` y aviso previo: es un
   contrato entre dos servicios, un cambio acá rompe al otro lado.
8. **Sin secretos ni contenido.** IDs y tiempos de uso, nada más: ni títulos
   de ventanas, ni URLs, ni contenido de sesiones. Los logs de fallo
   conservan IDs y motivo, sin cuerpos.

## Casos borde

- **Reintento tras 5xx:** reenviar el mismo `event_id` con el mismo payload.
  Da `200 duplicado` (o `201` si el primero nunca llegó a procesarse). Nunca
  genera un segundo efecto.
- **Reloj del recolector desviado:** tramos fuera del día `fecha` →
  `400 payload_invalido`. El receptor no "corrige" horas a ciegas.
- **Día partido por cambio de mes:** el evento pertenece entero a su
  `fecha`; el agregado mensual lo resuelve el receptor con la semántica de
  VI-10 (un día de otro mes se registra y avisa que no suma a las horas del
  mes en curso). El payload no se parte.
- **Pausa y reanudación:** los días sin medición van como `sin_medicion`
  (si el recolector alcanzó a emitirlos). Al reanudar, la cobertura parte
  de la reanudación: no se acredita hacia atrás lo que no se midió.
- **Backfill tras reconexión:** llegan los eventos de los días recuperados
  y un `CoverageIntervalPayload` que acredita el rango completo entregado.
- **Dos recolectores sobre la misma suscripción:** v1 asume un recolector
  activo por (organización, suscripción). Si en la práctica conviven dos
  orígenes, la fusión de sus mediciones queda para v2; hoy cada hecho es un
  evento distinto y la deduplicación es por `event_id`.
- **Lotes:** v1 envía un evento por petición. El envío por lote queda para
  v2 si el volumen lo justifica.

## Definición verificable y ejemplos

- Esquema JSON (draft 2020-12): [uso-recolectores-v1.schema.json](uso-recolectores-v1.schema.json).
  La raíz valida un `UsageEventPayload`; `CoverageIntervalPayload`, `AcuseUso`
  y `ErrorUso` viven en `$defs`.
- Fixtures con los casos válidos (uso positivo, cero observado,
  pausado/sin medición, backfill y los tres acuses):
  [uso-recolectores-v1.ejemplos.json](uso-recolectores-v1.ejemplos.json).
- DTOs de TypeScript compartidos con web, móvil y el cliente Windows:
  [frontend/shared/src/contracts/uso-recolectores.dto.ts](../../frontend/shared/src/contracts/uso-recolectores.dto.ts).

Regresión desde la raíz del repo (el workflow de CI la corre en cada PR):

```sh
python -m pip install "jsonschema[format]==4.26.0" "pytest==8.3.4"
python -m pytest docs/contratos/tests -v
```

La prueba valida cada fixture contra el esquema con chequeo de formatos y
además las reglas que el esquema no puede expresar: la suma de los tramos,
`inicio < fin`, `desde ≤ hasta` y que `sin_medicion` no acredite cobertura.
Comprueba también el límite de 25 horas (90 000 000 ms) y muta fixtures
válidas para comprobar que el esquema rechaza estados desconocidos,
duraciones negativas, no enteras o sobre el límite, tramos en un cero
observado, cobertura en un día sin medición y versiones futuras.

## Recepción y cierre

Lo acordado con Maxi: vocabulario (`duracion_ms`, `tramos_actividad`,
`cobertura`, `estado`, `origen`, `recolector_id`, `event_id`), estados y su
efecto sobre la cobertura, los dos endpoints y la semántica 201/200/409.
Este documento es la versión escrita de ese acuerdo; la revisión del PR es
la instancia para confirmar que no se coló ninguna diferencia.

Pendiente para cerrar la integración (no de esta tarjeta): la implementación
del productor en el recolector (S3-MX-01), el receptor en Analytics con su
prueba del payload real contra este esquema —el mismo seguimiento que MX-21
dejó para VI-26— y el registro de `extension_navegador` como origen si se
agrega en el Sprint.
