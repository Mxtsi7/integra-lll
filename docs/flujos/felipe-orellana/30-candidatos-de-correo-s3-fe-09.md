# S3-FE-09 — Candidatos de correo con la evidencia del mensaje

**Qué hace.** Junta las tres piezas que leen un correo sin guardar nada
(documentos 26, 27 y 28) y guarda lo que sale: un candidato `propuesto` por
cada correo que se puede leer sin dudas, y un error con su motivo por cada uno
que no. No crea suscripciones ni cobros, y no confirma nada.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| El candidato es trazable y queda pendiente | nace `propuesto`, ligado a su importación, con la identidad del mensaje (Message-ID) y la línea de la que salió cada dato |
| No se almacena contenido innecesario ni se ejecuta confirmación automática | la evidencia guarda líneas acotadas, nunca el cuerpo; no se escribe en el outbox ni se mueve la importación de estado |

## Las dos funciones

```
leer(pagina, organizacion_id=…, cuenta_id=…, proveedor_correo=…)   candidatos y errores; no toca la base
guardar_pagina(importacion, pagina)                                 los guarda en su importación, sin duplicar
```

Es el mismo reparto que en el CSV: `csv_candidatos.leer` es puro y la tarea de
S3-FE-10 guarda. `guardar_pagina` está pensada para ser el `procesar` de la
lectura por cursor (S3-FE-03/05, documento 29, que llega con #189):

```python
leer_siguiente_lote(lector_gmail, organizacion_id=…, cuenta_id=…,
                    procesar=functools.partial(guardar_pagina, importacion))
```

Corre dentro de la transacción que mueve el cursor. Si lanza, el cursor no se
mueve y la página se vuelve a leer. Por eso, cuando la importación ya no
admite mensajes (no está `procesando`, no es de correo, o su cuenta no es de
su organización), **lanza** `ImportacionNoDisponible` en vez de devolver algo
normal: si devolviera, el cursor avanzaría sobre mensajes que nadie guardó.

Abrir la importación (`procesando`) y cerrarla (`completada`) es de quien
orqueste la lectura periódica, junto con S3-FE-18 (reintentos) y S3-FE-20
(desconexión). Esta tarjeta no agrega una tarea de Celery.

## Qué sale de cada correo

Todas las filas son casos de las pruebas.

| El correo | Resultado |
|---|---|
| «Tu recibo de Netflix»: `Fecha de cobro: 1 de octubre de 2026`, `Total: CLP 9.990` | candidato `cobro_realizado`, 9990 CLP, 2026-10-01 |
| «Tu suscripción se renovará pronto»: `Te cobraremos USD 10.99 el 5 de noviembre de 2026.` | candidato `aviso_de_cobro`, 10.99 USD, **2026-11-05**: la del cobro anunciado |
| «Problema con tu pago»: `No pudimos procesar tu pago de CLP 9.990 del 1 de octubre de 2026.` | candidato `pago_fallido`, 2026-10-01 |
| «Tu recibo de Netflix»: `Total: CLP 9.990`, sin fecha | candidato con la fecha de **recepción**, declarada en la evidencia |
| «Tu recibo de Netflix»: `Total: CLP 9.990` y solo «Tu próximo cobro será el 1 de noviembre» | candidato con la fecha de recepción, **no** la del próximo ciclo |
| Apple «Tu recibo de Apple»: `Total: USD 2.99` | candidato **sin proveedor**: `servicio = null`, `ambiguo` |
| `Total: $9.990` | error `moneda_ambigua` |
| `Total: CLP 9.990` y `Total: CLP 10.990` | error `importe_ambiguo` |
| `Total: -9.990 CLP` | error `importe_ambiguo`: puede ser una devolución |
| «Tu recibo»: `Gracias por tu pago.` | error `importe_no_encontrado` |
| `Fecha: 01/10/2026` | error `fecha_ambigua` |
| «Recordatorio de pago»: `Te cobraremos CLP 9.990 pronto.` | error `fecha_no_indicada` |
| «Problema con tu pago», sin fecha | error `fecha_no_indicada` |
| «Netflix»: `fue rechazado` y `Hemos recibido tu pago` | error `tipo_incierto` |
| «Ofertas de la semana»: `Notebook a solo CLP 299.990` | error `tipo_incierto` |
| «Ofertas de la semana»: `Descuentos en tecnología.` | **descartado**: ni candidato ni error |
| un `MensajeOmitido` del lector («el mensaje ya no existe») | error `mensaje_omitido` |

### Lo que no está confirmado no se inventa

Es la regla de S3-FE-07 y S3-FE-08, y la del lector de CSV: lo ambiguo se
señala, no se adivina. Un correo da candidato solo si se sabe **qué clase de
mensaje es** y si **el importe y la moneda** se leyeron sin dudas. Si no, queda
como error de la importación, que es la forma que ya tiene "para revisión" en
la vista previa: S3-FE-14 los muestra en `GET /api/importaciones/<id>/`.

Los códigos que significan lo mismo que en el CSV son los del CSV
(`moneda_ambigua`, `moneda_no_indicada`, `fecha_ambigua`), para que la web no
tenga dos códigos para una regla. Los nuevos son `tipo_incierto`,
`importe_ambiguo`, `importe_no_encontrado`, `fecha_no_indicada` y
`mensaje_omitido`. Un correo con varios problemas lleva el primero, en ese
orden: tipo, importe, moneda, fecha. Igual que una fila de CSV.

### La fecha depende del tipo

Lo dice el contrato común (S3-MX-25, `docs/contratos/candidatos-v1.md`):

| Tipo | Fecha del candidato | `fecha_origen` |
|---|---|---|
| aviso de cobro | la del cobro **anunciado** (`fecha_proximo_cobro` de S3-FE-07); si no la hay, la del texto | `cobro_anunciado` o `texto` |
| cobro realizado | la del texto; si no la hay, la de recepción | `texto` o `recepcion` |
| pago fallido | la del texto | `texto` |

La fecha de recepción solo vale para un **recibo**, que es lo que el contrato
permite, y queda declarada: `fecha_origen = "recepcion"` y `fecha_motivo` con
el motivo de S3-FE-07. Un aviso sin fecha no la usa: el día en que llegó no es
el día en que se va a cobrar. Un fallo sin fecha tampoco, porque el contrato no
lo prevé; si hiciera falta, se cambia ahí primero.

### El servicio sí puede faltar

Como en el CSV, un servicio ambiguo o desconocido **no** impide el candidato:
queda con `servicio = null`, `servicio_resultado` dice por qué, y
`servicio_texto` trae el texto del que se intentó sacar (el nombre del
remitente, su dominio o el asunto). La confirmación (S3-FE-15) ya rechaza un
candidato sin proveedor con `servicio_sin_resolver`.

### Lo que no habla de cobros se descarta

El filtro de los lectores es amplio a propósito («uno que sobra lo descarta
S3-FE-08»). Un correo **sin una sola frase** de S3-FE-08 **y sin un monto** no
es un candidato ni un problema: se descarta y se cuenta en `filas_procesadas`.
Si trae un monto, queda como `tipo_incierto`, porque puede ser un cobro escrito
de otra forma: ante la duda se informa de más.

## La evidencia

La del recibo de Netflix de la primera fila, tal como queda guardada:

```json
{
  "proveedor_correo": "gmail",
  "cuenta_id": "…",
  "id_mensaje": "18c2f0a1",
  "message_id": "18c2f0a1@correo.example.test",
  "recibido_en": "2026-10-02T13:30:00+00:00",
  "remitente": "info@account.netflix.com",
  "asunto": "Tu recibo de Netflix",
  "servicio_fuente": "nombre del remitente",
  "servicio_regla": "alias 'netflix'",
  "tipo_motivo": "lo dice el asunto",
  "tipo_evidencia": "asunto: cobro_realizado: recibo; cuerpo: proximo_ciclo: proximo cobro; cuerpo: cobro_realizado: gracias por tu pago",
  "importe_fragmento": "Total: CLP 9.990",
  "fecha_fragmento": "Fecha de cobro: 1 de octubre de 2026",
  "fecha_origen": "texto"
}
```

| Para qué | Claves |
|---|---|
| encontrar el correo | `proveedor_correo`, `cuenta_id`, `id_mensaje`, `message_id` (entero: el identificador es su hash, ver documento 26), `recibido_en`, `remitente`, `asunto` |
| explicar el servicio | `servicio_fuente`, `servicio_regla` |
| explicar el tipo | `tipo_motivo`, `tipo_evidencia` (las frases de S3-FE-08) |
| explicar importe, moneda y fecha | `importe_fragmento` (la moneda sale del mismo monto), `fecha_fragmento`, `fecha_origen`, y `fecha_motivo` cuando es la de recepción |
| avisar | `texto_truncado`, si el lector cortó el texto en 20.000 caracteres |

Las claves del ejemplo de correo del contrato (`asunto`, `remitente`,
`message_id`, `proveedor_correo`, `importe_fragmento`, `fecha_fragmento`) son
las mismas, y hay una prueba que arma ese ejemplo con un correo de verdad, por
las tres piezas de lectura, y lo compara campo por campo y contra el esquema.

**Lo que no se guarda:** el cuerpo, el HTML, los adjuntos, el hilo, el nombre
visible del remitente ni nada de la autorización. Cada valor pasa por
`_acotado`: una sola línea, sin caracteres de control y con tope (200 para
asunto y fragmentos, 254 para la dirección, 998 para el Message-ID). Una clave
vacía no se guarda: un correo sin Message-ID no lleva `message_id`. Los
registros dicen solo números y el id de la importación.

## Los errores, con la forma de los del CSV

```json
{
  "codigo": "moneda_ambigua",
  "mensaje": "«Tu recibo» de info@account.netflix.com, recibido el 2026-10-02: el monto viene con `$` solo: pueden ser pesos o dólares",
  "fila": null,
  "identificador_origen": "mid:…"
}
```

`fila` es `null` porque un correo no tiene fila, y la web ya lo muestra así
(`ImportacionPage` pone «Fila N» solo cuando es un número). El mensaje dice
asunto, remitente y fecha, que es lo que la persona necesita para encontrarlo
en su buzón.

`identificador_origen` es nuevo en la entrada y solo lo llevan los de correo.
Sin él no hay forma de saber que un error ya se anotó cuando la misma página
se vuelve a leer. Es una clave más, no un cambio de las tres que ya había: el
tipo `ErrorImportacion` de la web la ignora.

## Idempotente

| Pasa | Queda |
|---|---|
| la misma página se guarda dos veces (el cursor se reinició, S3-FE-05) | un candidato y un error |
| el mismo recibo llega a Gmail y a Outlook de la misma organización | un candidato, en la importación que lo leyó primero; la otra lo cuenta como ya guardado |
| el mismo Message-ID dos veces en una página (dos carpetas) | uno, el primero |
| se vuelve a leer un correo cuyo candidato se rechazó | sigue rechazado: no se vuelve a proponer |
| el mismo Message-ID en otra organización | otro candidato: la unicidad lleva la organización |

Los candidatos los cuida la unicidad de S3-FE-17, (organización, origen,
identificador). La inserción es la misma del CSV, que quedó en un solo lugar,
`CobroCandidato.guardar_sin_duplicar`: ignora los que ya existen e inserta en
el orden de la llave, para que dos lecturas que comparten correos en orden
contrario no se bloqueen entre sí (revisión de #171).

## Concurrencia

`guardar_pagina` toma la fila de la importación (`select_for_update`) antes de
contar y de escribir. Los contadores y la lista de errores son leer, modificar
y escribir: sin tomarla, dos páginas guardadas a la vez leerían los mismos
valores y la segunda borraría lo de la primera. El cálculo (`leer`) va antes y
fuera del bloqueo.

Las dos carreras están probadas con dos conexiones a PostgreSQL, en
`test_carrera_candidatos_correo_postgres.py`. El hilo A se detiene después de
insertar, con su transacción abierta; mientras tanto, B tiene que aparecer en
`pg_locks` con `granted = false` y no haber terminado:

- **el mismo correo en dos importaciones**: B espera el `INSERT` de A; al
  confirmar A, B no inserta nada y cuenta uno ya guardado;
- **dos páginas de la misma importación**: B espera la fila de la importación;
  al final están los 4 mensajes, los 2 candidatos y los 2 errores.

## Los límites, dichos

- **Contadores en una relectura.** Pasado el tope de 20 errores
  (`Importacion.MAXIMO_ERRORES`), la identidad de los que no entraron a la
  lista no queda guardada, así que un mensaje con error releído suma otra vez
  en `errores_totales`. `filas_procesadas` también cuenta la relectura. Los
  candidatos, que son lo que mueve plata, no se duplican nunca. Hacer exactos
  los contadores pediría guardar cada mensaje procesado: una tabla y una
  migración, que esta tarjeta no necesitó.
- **El solape entre corridas.** Si la orquestación abre una importación por
  corrida, el correo que cae en el solape de 10 minutos (S3-FE-03) puede
  aparecer como error en las dos. Cada importación lo informa una vez.
- **La web no muestra la evidencia todavía.** `fecha_origen = "recepcion"`
  está guardado y viaja en `GET /api/candidatos/`, pero la lista de la web no
  lo enseña. Conviene que lo haga antes de que se confirmen candidatos de
  correo.

## Dónde está

| Pieza | Archivo |
|---|---|
| Leer y guardar | `services/connectors/connectors/candidatos_correo.py` |
| La inserción compartida con el CSV | `services/connectors/connectors/models.py` → `CobroCandidato.guardar_sin_duplicar` |
| El error con la identidad del mensaje | `services/connectors/connectors/models.py` → `Importacion.anotar_error` |
| La identidad de un mensaje omitido | `services/connectors/connectors/origen_correo.py` → `identificador_del_proveedor` |
| Las pruebas | `services/connectors/tests/test_candidatos_correo_s3_fe_09.py` (46) y `test_carrera_candidatos_correo_postgres.py` (2) |

Sin migración: no hay tablas ni campos nuevos.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_candidatos_correo_s3_fe_09.py tests/test_carrera_candidatos_correo_postgres.py -q
```

Las dos de carrera se saltan si la base no es PostgreSQL.

## Cómo se comprobaron las pruebas

Se rompió el código a propósito 32 veces y cada vez falló al menos una
prueba. Entre otras:

- descartar en silencio un correo incierto, o descartar uno que trae monto;
- aceptar un importe negativo, tomar `$` como CLP, o cambiar el código de una
  fecha ambigua;
- que el aviso no use la fecha anunciada, que el recibo tome la del próximo
  ciclo, o usar la de recepción para cualquier tipo;
- asignar el primer candidato de un servicio ambiguo, o dejar todo como cobro
  realizado;
- guardar el cuerpo en la evidencia, quitar el tope o dejar caracteres de
  control;
- anotar dos veces el mismo error, o el error sin la identidad del mensaje o
  sin decir cuál es el correo;
- no tomar la importación (falla la prueba de dos conexiones), escribir
  aunque no esté `procesando`, aceptar mensajes de otra cuenta o buscar la
  cuenta sin la organización;
- insertar sin `ignore_conflicts` o sin ordenar por la llave (falla la prueba
  de orden inverso de S3-FE-17, que ahora pasa por la inserción compartida);
- ignorar los omitidos o no contarlos;
- armar el respaldo sin la cuenta (falla S3-FE-06).

Al principio dos no fallaban: no deduplicar dentro de la página y contar los
nuevos como ya guardados. Los candidatos quedaban bien igual (la unicidad los
protege), pero el resultado mentía. Se agregó la comprobación de `leer` con
una copia en la página y la de `ya_guardados` en el primer guardado.
