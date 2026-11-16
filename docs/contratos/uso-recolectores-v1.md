# S3-VI-01 — Contrato canónico de uso y cobertura de recolectores (v1)

**Fecha:** 2026-11-11 · **Responsables:** Maximiliano Sáez (productor y
recepción) y Víctor Gonzales (consolidación, consumidores y Analytics).
**Estado:** contrato único acordado por Maxi y Víctor. **Sustituye la propuesta
previa de la PR #148**, que queda como antecedente histórico y no como fuente
de verdad. Tarjetas: **S3-MX-01** y **S3-VI-01**.

Este documento no implementa el endpoint: fija qué envía el recolector, qué
acepta el receptor y qué evidencia falta para cerrar cada tarjeta.

## 1. Sustitución de la PR #148

La PR #148 se cerró sin fusionar. Sus reglas de precisión, tramos, cobertura e
idempotencia se conservan aquí; su vocabulario anterior (`fecha`,
`estado: con_uso | cero_observado | sin_medicion`, `cobertura: {desde, hasta}`,
`detalle`) queda reemplazado por el contrato de este documento.

| Punto | PR #148 (sustituida) | Contrato canónico v1 |
|---|---|---|
| Ruta | `POST /api/suscripciones/{suscripcion_id}/uso/recolector/` (propuesta) | La misma ruta, confirmada. |
| Identidad | `usuario_id`/`organizacion_id` fuera del cuerpo | Igual: se resuelven desde la sesión. |
| Destino | `suscripcion_id` en la ruta | Igual: el cuerpo no repite la suscripción. |
| Ventana | `fecha` del día local | `inicio` y `fin` UTC de la ventana observada. |
| Actividad | `tramos_actividad` en UTC | Igual, con `duracion_ms` entero y tramos reales obligatorios. |
| Cobertura | `{desde, hasta}` o `null` | `completa` / `parcial` / `sin_medicion`. |
| Estado | `con_uso` / `cero_observado` / `sin_medicion` | `activo` / `pausado` / `sin_permiso` / `revocado`. |
| Acuse | `{event_id, suscripcion_id, estado, recibido_en}` | Igual: 201 `aceptado` y 200 `duplicado`. |
| Conflicto | `409 event_id_conflictivo` | Igual, con `ErrorUso.codigo = event_id_conflictivo`. |
| Simultaneidad | Unión temporal de tramos | Igual: la métrica es la unión, no la suma por recolector. |

Quedan resueltos en este único contrato: la **ruta** de ingesta con la
suscripción en la URL; los **campos** del cuerpo y la exclusión de identidad y
destino; el **acuse** 201/200 con `event_id`, `suscripcion_id`, `estado` y
`recibido_en`; la **idempotencia** por identidad + `recolector_id` + `event_id`
con 409 ante conflicto; y la **simultaneidad** resuelta por unión temporal de
tramos, no por suma de recolectores.

La base inspeccionada para esta consolidación es el commit
`c3efaa705d4721d3b7e0fedb7acf5a83465ae629`, archivo
`docs/contratos/uso-recolectores-v1.md`. Los esquemas y DTOs de este documento
son su formalización, no una promesa de que la integración ya esté desplegada.

## 2. Responsabilidades

| Responsable | Entrega |
|---|---|
| Maxi | Recolectores y S3-MX-26 a S3-MX-31: recepción autenticada, validaciones, pertenencia, idempotencia, persistencia y cobertura. |
| Víctor | Consolidación y validación receptora del contrato en S3-VI-01; publicación fiable, consumidores, agregados, puntajes e IA. |
| Ambos | Acordar campos, semántica, errores y compatibilidad; probar las mismas fixtures contra la recepción real. |

Subir este documento no completa las tareas de implementación. La recepción no
se atribuye exclusivamente a Víctor.

## 3. Una representación común

Se conserva el vocabulario español: `origen`, `inicio`, `fin`, `duracion_ms`,
`tramos_actividad`, `zona_horaria`, `cobertura` y `estado`. Los nombres
TypeScript `UsageEventPayload` y `CoverageIntervalPayload` son nombres de tipos;
no introducen otro formato de red.

Decisiones de este contrato:

- Milisegundos enteros para conservar fracciones de minuto. Los segundos se
  calculan como `duracion_ms / 1000` para presentación o adaptación explícita.
- Tramos reales obligatorios para resolver solapamientos, en vez de intentar
  deducirlos de una duración total.
- `recolector_id` separa dispositivos del mismo origen.
- `usuario_id` y organización se resuelven desde la autenticación. No se aceptan
  del cuerpo del recolector.
- La suscripción va en la ruta. Cada pendiente local conserva juntos destino y
  cuerpo inmutables.
- La cobertura se transmite dentro del evento v1. `CoverageIntervalPayload` es
  una proyección interna derivada; **no** se propone una segunda API
  independiente de cobertura.

### Ruta canónica

```http
POST /api/suscripciones/{suscripcion_id}/uso/recolector/
```

Bearer de sesión. Un objeto por petición. El servidor valida pertenencia y
consentimiento antes de consultar duplicados. El `401` lo responde el gateway
antes de llegar al receptor y sigue el contrato de renovación existente.

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/suscripciones/{suscripcion_id}/uso/recolector/` | `UsageEventPayload` | 201 · 200 · 400 · 401 · 403 · 404 · 409 · 429 · 5xx |

No va bajo `/api/analitica/ingesta/uso/` ni bajo `/api/usos/`. El envío por lote
queda para v2.

## 4. Archivos del contrato

| Ruta | Contenido |
|---|---|
| `docs/contratos/uso-recolectores-v1.md` | Reglas de negocio, HTTP, decisiones y aceptación. |
| `docs/contratos/uso-recolectores-v1.schema.json` | JSON Schema draft 2020-12 de la sección 5. |
| `docs/contratos/uso-recolectores-v1.ejemplos.json` | Fixtures válidas, acuses y casos negativos. |
| `frontend/shared/src/contracts/uso-recolectores.dto.ts` | DTOs TypeScript de la sección 6. |
| `docs/contratos/tests/test_uso_recolectores_v1.py` | Regresión con `pytest` y `jsonschema`. |

Backend y frontend consumen el mismo contrato; no se mantienen reglas
divergentes copiadas en varios archivos.

## 5. JSON Schema

El archivo [uso-recolectores-v1.schema.json](uso-recolectores-v1.schema.json)
tiene la raíz apuntando a `#/$defs/UsageEventPayload`; la proyección interna se
valida con `#/$defs/CoverageIntervalPayload`. El validador elegido comprueba
`format` de forma efectiva.

Puntos fijados por el esquema:

- `version` es `1`.
- `event_id`, `recolector_id` y `coverage_id` son UUID v4.
- `inicio`, `fin` y los extremos de cada tramo son UTC con sufijo `Z` y hasta
  tres decimales de segundo.
- `origen` es `android` o `navegador`.
- `cobertura` es `completa`, `parcial` o `sin_medicion`.
- `estado` es `activo`, `pausado`, `sin_permiso` o `revocado`.
- `duracion_ms` es entero entre `0` y `9007199254740991`.
- El cuerpo no admite campos adicionales: `usuario_id`, `organizacion_id` y
  `suscripcion_id` se rechazan si aparecen.

JSON Schema **no** reemplaza las comparaciones temporales, pertenencia,
consentimiento, concurrencia ni las reglas de cobertura de la sección 7.

## 6. DTOs TypeScript

Los DTOs viven en
[frontend/shared/src/contracts/uso-recolectores.dto.ts](../../frontend/shared/src/contracts/uso-recolectores.dto.ts)
y se exportan desde `frontend/shared/src/index.ts`:

`UUID`, `UTCDateTime`, `OrigenRecolector`, `EstadoRecolector`,
`EstadoCobertura`, `TramoActividad`, `UsageEventPayload`, `PendienteUso`,
`CoverageIntervalPayload`, `AcuseUso`, `CodigoErrorUso` y `ErrorUso`.

Los alias documentan el significado; no validan cadenas en ejecución. El
servidor aplica el esquema y las validaciones semánticas. `PendienteUso`
conserva juntos el destino y el cuerpo inmutable. `CoverageIntervalPayload` es
solo backend/interno.

`ErrorUso` usa `codigo` y `mensaje`. Los códigos son:

- `evento_invalido`
- `version_no_soportada`
- `detalle_actividad_invalido`
- `intervalo_cruza_dia_local`
- `event_id_conflictivo`
- `consentimiento_requerido`

La envoltura propuesta debe adaptarse al formato común de errores vigente antes
de fijarla. Los códigos HTTP de autenticación, recurso ausente y limitación
pueden conservar la respuesta común del proyecto.

## 7. Reglas de validación y negocio

### 7.1 Identidad, consentimiento y privacidad

1. Autenticar y resolver usuario y organización desde la sesión. Verificar
   pertenencia de la suscripción y consentimiento vigente.
2. Rechazar campos desconocidos. No aceptar `user_id` ni `usuario_id` enviados
   por el cliente como identidad.
3. No enviar URLs, dominios, títulos de ventana, paquetes, correos, tokens en el
   cuerpo ni listas de apps. Resolver la asociación con la suscripción antes del
   envío.
4. UUID v4 para eventos e instalación. La instalación es un identificador
   aleatorio, no un identificador físico.
5. Un destino ajeno responde `404` sin revelar si el identificador del evento
   existe.

### 7.2 Tiempo y duración

1. Instantes válidos UTC con `Z`; ventana semiabierta `[inicio, fin)` y
   `inicio < fin`.
2. Zona IANA válida y común para el informe de esa suscripción. Validarla en
   backend: una cadena no vacía no demuestra que exista.
3. Cada evento cabe en un día local; `fin` puede coincidir con la medianoche
   siguiente. Dividir usando límites locales y cambios de horario, no sumando
   siempre 24 horas.
4. Tramos positivos, ordenados, sin solapamientos internos y contenidos en la
   ventana.
5. `duracion_ms` coincide exactamente con la suma de los tramos y no supera la
   ventana. Lista vacía implica duración cero. Rechazar inconsistencias; no
   inventar distribución.
6. Cuerpo máximo propuesto: 4 KiB de JSON UTF-8, medidos en recepción antes de
   persistir. Dividir ventanas grandes antes de encolarlas y asignar IDs propios;
   no truncar tramos.
7. `pausado`, `sin_permiso` y `revocado` no informan actividad positiva. Una
   revocación se comunica mediante control de consentimiento; no se exige seguir
   enviando telemetría tras revocar.

### 7.3 Idempotencia y concurrencia

Clave lógica: identidad autenticada —incluyendo el ámbito de tenant aplicable—
+ `recolector_id` + `event_id`. La suscripción **no** forma parte de la clave:
se conserva como destino vinculado e inmutable.

| Caso | Respuesta | Efecto |
|---|---|---|
| Primera aceptación | `201`, acuse `aceptado` | Un registro y efectos aplicados una vez. |
| Misma clave, destino y todos los campos normalizados iguales | `200`, acuse `duplicado` | Sin nuevos efectos; conservar `recibido_en` original. |
| Misma clave con otro cuerpo o destino también autorizado | `409 event_id_conflictivo` | Sin efectos nuevos; requiere resolución. |
| Destino ajeno | `404` | No revelar si el identificador del evento existe. |

Comparar todos los campos tipados del cuerpo y el destino; no comparar texto
JSON por orden o espacios. Autenticar y autorizar antes de consultar duplicados.
Resolver carreras con restricción única y transacción/bloqueo pertinentes. No
clasificar cualquier `IntegrityError` como duplicado: comprobar qué restricción
falló y volver a comparar el registro autorizado.

Persistir fuente exacta, cobertura y el trabajo durable necesario para
proyección/publicación sin dejar una aceptación huérfana. Usar el mecanismo
fiable existente o acordar su extensión con Víctor; no prometer entrega
exactamente una vez por RabbitMQ. Consumidores y proyecciones también deben
soportar redelivery sin repetir efectos.

El cliente retira solo el pendiente cuyo ID y destino coinciden con el acuse.
Timeout, red caída, `429` o `5xx` conservan ID y cuerpo con espera acotada y
`Retry-After` cuando corresponda. Los errores de validación o conflicto no se
reintentan automáticamente.

### 7.4 Cero observado, datos faltantes y fuentes simultáneas

| Evidencia | Interpretación |
|---|---|
| Cobertura completa de una ventana, estado activo, tramos vacíos | Cero observado solamente en esa ventana. |
| Cobertura parcial y ninguna actividad recibida | Cero en lo efectivamente observado; no inferir cero en los huecos. |
| Sin medición, pausa, pérdida de permiso o desaparición del recolector | Ausencia de medición; uso real desconocido. |
| Actividad positiva de 30 segundos y proyección entera de 0 minutos | Hay uso positivo; no es uso cero. |
| Última sincronización reciente sin intervalos acreditados | No demuestra cobertura. |

La desinstalación puede no enviar un último evento. No extender cobertura
después del último intervalo confirmado ni confundir silencio con una pausa
conocida. IA y puntajes deben conservar incertidumbre; los umbrales y políticas
de recomendaciones quedan a cargo de sus tareas, sin inventar valores aquí.

Para uso de una suscripción, unir los tramos reales entre fuentes antes de
sumar. Android y navegador observando simultáneamente dos minutos acreditan dos
minutos, no cuatro. La deduplicación por ID y la unión de intervalos son
operaciones diferentes.

Para acreditar un día completo, la unión de ventanas de cobertura completa debe
cubrirlo sin huecos. El mínimo inicio y máximo fin no rellenan huecos. Mantener
cobertura por instalación; una fuente pausada no borra la observación válida de
otra. Agregar por usuario/tenant y suscripción conforme a fuentes que realmente
pueden observar ese servicio.

Conservar milisegundos exactos. Si los modelos vigentes usan minutos enteros:
proyectar el incremento del total unido con `total_ms // 60000` y mantener
`total_ms % 60000` por día local, sin tocar uso manual ni trasladar residuos a
otro día. Puntajes, última actividad y consultas deben usar evidencia exacta de
actividad positiva.

## 8. Ejemplos

Fixture de actividad Android: destino persistido
`11111111-1111-4111-8111-111111111111`. Solo el objeto `evento` va como cuerpo
HTTP.

```json
{
  "version": 1,
  "event_id": "22222222-2222-4222-8222-222222222222",
  "recolector_id": "33333333-3333-4333-8333-333333333333",
  "origen": "android",
  "inicio": "2026-11-09T12:00:00Z",
  "fin": "2026-11-09T12:02:00Z",
  "duracion_ms": 30000,
  "tramos_actividad": [
    {"inicio": "2026-11-09T12:00:00Z", "fin": "2026-11-09T12:00:30Z"}
  ],
  "zona_horaria": "America/Santiago",
  "cobertura": "completa",
  "estado": "activo"
}
```

Fixture de cero observado durante dos minutos desde navegador:

```json
{
  "version": 1,
  "event_id": "44444444-4444-4444-8444-444444444444",
  "recolector_id": "55555555-5555-4555-8555-555555555555",
  "origen": "navegador",
  "inicio": "2026-11-09T12:00:00Z",
  "fin": "2026-11-09T12:02:00Z",
  "duracion_ms": 0,
  "tramos_actividad": [],
  "zona_horaria": "America/Santiago",
  "cobertura": "completa",
  "estado": "activo"
}
```

Para representar una pausa conocida en esa ventana: usar otro `event_id`,
`cobertura: "sin_medicion"`, `estado: "pausado"`, duración 0 y tramos vacíos.
No reutilizar el identificador del ejemplo anterior ni fabricar una pausa a
partir de falta de conexión.

Acuse inicial (201):

```json
{
  "event_id": "22222222-2222-4222-8222-222222222222",
  "suscripcion_id": "11111111-1111-4111-8111-111111111111",
  "estado": "aceptado",
  "recibido_en": "2026-11-09T12:02:01Z"
}
```

Al repetir exactamente el pendiente: 200, mismos identificadores y
`recibido_en`, con `estado: "duplicado"`. Cambiar duración, tramos o destino
autorizado usando esa misma clave: 409.

```json
{
  "codigo": "event_id_conflictivo",
  "mensaje": "El identificador ya fue aceptado con otro contenido o destino."
}
```

El archivo [uso-recolectores-v1.ejemplos.json](uso-recolectores-v1.ejemplos.json)
contiene además los casos de medianoche, 30 s + 30 s, simultaneidad 120 s /
180 s / 50 s, cobertura con huecos y los ejemplos negativos.

## 9. Integración paso a paso

1. **Recolector de Maxi:** captura tramos, divide por día local, crea IDs, guarda
   destino y cuerpo antes de enviar. Conserva la cola asociada a la cuenta
   original.
2. **Recepción de Maxi:** autentica, valida permiso y consentimiento, estructura
   y semántica; resuelve idempotencia y persiste hechos exactos y cobertura de
   forma consistente.
3. **Entrega a Víctor:** acordar punto de publicación y propietario del
   outbox/mecanismo fiable para evitar que ambos publiquen el mismo hecho.
   Registrar el mapeo a los eventos de dominio existentes.
4. **RabbitMQ/Analytics de Víctor:** consumir con deduplicación de efectos, unir
   tramos, proyectar incrementos y consultar cobertura. No publicar directamente
   estos DTOs en `uso.registrado` sin revisar contrato y consumidores existentes.
5. **Puntajes e IA de Víctor:** distinguir uso positivo, cero observado y datos
   insuficientes; no penalizar automáticamente períodos desconocidos.
6. **Web/móvil:** presentar esos estados y conservar precisión para las
   decisiones; redondear solamente al mostrar.

## 10. Decisiones que deben quedar registradas antes de integrar

| Decisión | Propuesta o condición |
|---|---|
| Ruta y cuerpo por petición | Confirmar la ruta propuesta; un evento por petición. |
| UUID y precisión temporal | Confirmar UUID de modelos y máximo de tres decimales UTC. |
| Zona de informe | El receptor proporciona la zona común; definir cómo se cambia sin recontar historia. |
| Límites | Confirmar 4 KiB y un día local; definir política de antigüedad y desajuste de reloj sin inventar umbrales. |
| Identidad interna de cobertura | Confirmar tipo de IDs, persistencia de `coverage_id` y aislamiento organizacional del almacenamiento. |
| Publicación | Acordar contrato de dominio/versionado y responsable del mecanismo fiable. |
| Conservación | Acordar retención de claves, eventos y purga con política del proyecto; no fijar plazos sin base. |
| Cobertura | Confirmar que cada asociación y recolector acredita solo lo que realmente observa. |
| Errores | Alinear la envoltura propuesta con la API existente. |

## 11. Evidencia para la PR

- [ ] Enlazar S3-MX-01 y S3-VI-01 y describir qué se conserva/cambia respecto a #148.
- [ ] Documentar aceptación explícita de Maxi y Víctor sobre el commit consolidado.
- [ ] Validar fixtures de Android y navegador con el mismo esquema y las mismas reglas semánticas.
- [ ] Incluir ejemplos negativos: usuario en cuerpo, destino ajeno, duración inconsistente, tramo fuera de ventana, zona inválida y cruce de día.
- [ ] Conservar casos de medianoche, 30 s + 30 s, simultaneidad 120 s / 180 s / 50 s y cobertura con huecos del borrador previo.
- [ ] Probar idempotencia concurrente en PostgreSQL y redelivery en consumidores cuando esas implementaciones estén disponibles.
- [ ] Separar resultados de fixtures de evidencia HTTP/base de datos/RabbitMQ: este documento no certifica esas integraciones.
- [ ] Vincular evidencia a las tarjetas, manteniendo pendientes las implementaciones que todavía falten.

## 12. Regresión local

Desde la raíz del repo (el workflow de CI la ejecuta en cada PR):

```sh
python -m pip install "jsonschema[format]==4.26.0" "pytest==8.3.4"
python -m pytest docs/contratos/tests -v
```

La prueba valida cada fixture contra el esquema con chequeo de formatos y las
reglas que el esquema no puede expresar: ventana semiabierta, pertenencia al
día local, tramos ordenados y contenidos, `duracion_ms` igual a la suma, zona
IANA existente, cobertura sin huecos y unión temporal entre fuentes. También
comprueba el rechazo de identidad en el cuerpo y de los casos negativos de
destino ajeno, duración inconsistente, tramo fuera de ventana, zona inválida y
cruce de día.
