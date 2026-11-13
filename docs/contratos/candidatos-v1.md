# S3-MX-25 — Formato común de candidatos v1

Estado: formalización de la implementación de Felipe en PR #147; aceptación
entre productores y consumidores pendiente. Esta entrega está apilada sobre
`felipe/s3-fe-csv-candidatos`; no implementa otro parser ni cambia sus modelos.

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
| `importe`, `moneda` | Decimal como texto; código ISO en mayúsculas |
| `fecha` | Fecha del hecho en `YYYY-MM-DD`; no fecha de recepción del correo |
| `tipo_mensaje` | `cobro_realizado`, `aviso_de_cobro` o `pago_fallido` |
| `estado` | `propuesto`, `confirmado` o `rechazado`; el productor nace propuesto |
| `evidencia` | Mapa de texto a texto con procedencia verificable |

No interpretar el identificador ni derivar fecha/servicio de él. PR #171
cambia la huella CSV y conserva procedencia en evidencia; este contrato no
fija su algoritmo. Sigue pendiente acordar con extracción de correo la
identidad entre proveedor, cuenta y mensaje: el ID de Gmail no equivale
automáticamente al encabezado RFC Message-ID. Esta entrega no decide esa regla.

La evidencia CSV existente contiene `fila` (texto) y `descripcion_original`.
El ejemplo de correo usa asunto y remitente sintéticos. El mapa permite nuevas
claves sin cambiar campos comunes; no incluir tokens, adjuntos ni cuerpo entero.
El esquema valida forma, no monedas admitidas, exactitud de una extracción,
pertenencia ni transiciones. Esas reglas siguen en productores y servicios.

## Correspondencia con HTTP y eventos

| Frontera existente | Correspondencia |
|---|---|
| `CobroCandidato.desde_candidato()` | Copia los datos; toma organización de `Importacion` y recorta `servicio_texto` a 300 caracteres |
| `GET /api/candidatos/` | `CobroCandidatoSerializer` conserva origen e identificador, excluye `organizacion_id`; el tenant lo determina la sesión/gateway |
| Respuesta HTTP | Añade `id`, `importacion`, etiquetas legibles, decisión, `creado_en` y `aplicacion`; importe texto, normalmente dos decimales por la columna |
| `aplicacion` | `null` sin confirmar y `pendiente` confirmado; confirmar no acredita una suscripción creada |
| `candidato.confirmado` v1 | `confirmacion.py` genera datos con `candidato_id`, `importacion_id`, origen/identificador, servicio/texto, importe/moneda/fecha/tipo, `crear_cobro`, `decidido_por`, evidencia |
| Organización del evento | Vive en `OutboxEvento.organizacion_id`, no repetida en sus datos |

La API no permite editar el candidato; confirmar/rechazar tienen acciones
propias. Aviso y fallo no se convierten en pago realizado. El consumidor de
Víctor debe aplicar su propia idempotencia por candidato; publicar y consumir
la orden no se implementan aquí. Estos tres formatos no son intercambiables.

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
