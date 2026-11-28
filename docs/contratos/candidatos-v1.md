# S3-MX-25 — Formato común de candidatos v1

Estado: formalización de la implementación de Felipe en PR #147; aceptación
entre productores y consumidores pendiente. La PR #179 tiene como base `main`,
que ya incluye #147.

## Representación interna

La fuente ejecutable es `services/connectors/connectors/candidatos.py`:
`Candidato.como_json()`. El esquema `candidatos-v1.schema.json` describe esa
salida, no una entrada pública de escritura. Es cerrado: cambiar campos o
literales requiere revisar compatibilidad y versionar cambios incompatibles.
El constructor no ejecuta el esquema; las pruebas detectan divergencias.

| Campo | Semántica |
|---|---|
| `origen` | `csv` o `correo` |
| `identificador_origen` | Texto opaco, estable dentro del origen y organización |
| `organizacion_id` | Organización resuelta por el productor autorizado |
| `servicio` | Nombre canónico o `null` si no se resuelve |
| `servicio_texto`, `servicio_resultado` | Texto original y `reconocido`, `ambiguo` o `desconocido` |
| `importe`, `moneda` | Decimal estrictamente positivo en texto de formato fijo y código ISO en mayúsculas |
| `fecha` | Fecha del cobro o intento en `YYYY-MM-DD`. Para avisos, fecha del cobro anunciado |
| `tipo_mensaje` | `cobro_realizado`, `aviso_de_cobro` o `pago_fallido` |
| `estado` | `propuesto`, `confirmado` o `rechazado`; el productor nace propuesto |
| `evidencia` | Mapa de texto a texto con procedencia verificable |

`identificador_origen` es opaco para los consumidores. Para correo, S3-FE-06
usa `mid:` seguido del SHA-256 del `Message-ID` (RFC 5322), quitando los
corchetes angulares y conservando las mayúsculas. Así la misma organización
puede deduplicar copias de un mensaje entre buzones y proveedores. Si falta un
`Message-ID` usable, usa `gmail:` u `outlook:` seguido del SHA-256 del par
(cuenta, ID del proveedor). Outlook solicita `ImmutableId` para conservar el
ID al mover el mensaje. La regla completa está en
[el flujo S3-FE-06](../flujos/felipe-orellana/26-origen-del-mensaje-s3-fe-06.md).

En avisos de cobro, `fecha` representa la fecha del cobro futuro que entrega
S3-FE-07 como `fecha_proximo_cobro`. Si un recibo carece de fecha y la extracción
usa la de recepción como supuesto, FE-09 puede proponer el candidato para
revisión declarando `evidencia["fecha_origen"] = "recepcion"` y conservando el
motivo del supuesto. Los importes cero o negativos quedan fuera del contrato de
candidatos. El CSV normaliza el signo de cartola y descarta cero. La extracción
de correo marca los negativos para revisión antes de producir un candidato.

La evidencia CSV contiene `fila` (texto), `archivo_sha256` y
`descripcion_original`, como en #171. El ejemplo de correo incluye un
`message_id`, un `proveedor_correo`, asunto, remitente y fragmentos de importe y
fecha sintéticos. El mapa admite claves de procedencia por origen. Se excluyen
tokens, adjuntos y el cuerpo entero.
El esquema valida forma, no monedas admitidas, exactitud de una extracción,
pertenencia ni transiciones. Esas reglas siguen en productores y servicios.

## Correspondencia con HTTP y eventos

| Frontera existente | Correspondencia |
|---|---|
| `CobroCandidato.desde_candidato()` | Copia los datos; toma organización de `Importacion` y recorta `servicio_texto` a 300 caracteres |
| `GET /api/candidatos/` | `CobroCandidatoSerializer` conserva origen e identificador, excluye `organizacion_id`; el tenant lo determina la sesión/gateway |
| Respuesta HTTP | Añade `id`, `importacion`, etiquetas legibles, decisión, `creado_en` y `aplicacion`; importe texto, normalmente dos decimales por la columna |
| `aplicacion` | `null` sin confirmar; confirmado: `por_enviar` (en el outbox), `enviada` (salió, sin respuesta), `aplicada` o `fallida` (lo contestó subscriptions con `candidato.aplicado` v1). Ver doc 37 de RF-14 |
| `candidato.confirmado` v1 | `confirmacion.py` genera datos con `candidato_id`, `importacion_id`, origen/identificador, servicio/texto, importe/moneda/fecha/tipo, `crear_cobro`, `decidido_por`, evidencia |
| Organización del evento | Vive en `OutboxEvento.organizacion_id`, no repetida en sus datos |

La API no permite editar el candidato; confirmar/rechazar tienen acciones
propias. Aviso y fallo no se convierten en pago realizado. El consumidor de
subscriptions aplica la orden con su propia idempotencia por candidato y
contesta `candidato.aplicado` v1 (RF-14, `docs/flujos/felipe-orellana/37-ordenes-de-cobro-rf-14.md`).
Estos tres formatos no son intercambiables.

## Ejemplos y verificación

`fixtures/candidatos-v1.csv` es una cartola sintética mínima que atraviesa
el parser CSV existente. `candidatos-v1.ejemplos.json` contiene su resultado
esperado con identificador ilustrativo y un correo construido con `Candidato`;
no es evidencia de lectura real de Gmail. Las pruebas validan ambos contra
el mismo esquema y ejercitan el serializer HTTP sin guardar en base.

Desde `services/connectors`, con dependencias de `requirements.txt`:

```sh
python -m pytest tests/test_contrato_candidatos_v1.py tests/test_csv_candidatos.py -q
```

Pruebas puras: Django inicializado, sin acceso a BD ni red. El esquema se
valida con Draft 2020-12 y `FormatChecker`, incluida fecha imposible. Se rechazan
importes numéricos, literales incompatibles y campos desconocidos.

Pendientes de aceptación: Felipe/Seba (productores y procedencia), Chris
(respuesta HTTP), Víctor (consumidor/evento) y Andrea (cuenta autorizada para
validación real de correo). No se registran esas aceptaciones como obtenidas.

### Representación decimal al serializar

`Candidato.como_json()` convierte el Decimal a texto en formato fijo sin
redondearlo: `Decimal("1E+3")` produce `"1000"` y `Decimal("1E-7")` produce
`"0.0000001"`. Así mantiene precisión y cumple el patrón del esquema común.
