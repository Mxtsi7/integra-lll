# S3-FE-09 — Candidatos de correo con la evidencia del mensaje

**Qué hace.** Junta las tres piezas que leen un correo sin guardar nada
(documentos 26, 27 y 28) y guarda lo que sale: un candidato `propuesto` por
cada correo que se puede leer sin dudas, y un error con su motivo por cada uno
que no. No crea suscripciones ni cobros, y no confirma nada.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| El candidato es trazable y queda pendiente | nace `propuesto`, ligado a su importación, con la identidad del mensaje (Message-ID) y el pedazo de texto alrededor de cada dato |
| No se almacena contenido innecesario ni se ejecuta confirmación automática | la evidencia guarda ventanas cortas alrededor de cada dato, nunca la línea entera ni el cuerpo; no se escribe en el outbox ni se mueve la importación de estado |

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
normal: si devolviera, el cursor avanzaría sobre mensajes que nadie guardó. Y
por lo mismo, lo que viene mal de un solo mensaje (un omitido sin `id`, por
ejemplo) **no** lanza: se anota y se sigue, porque lanzar dejaría el cursor
releyendo esa página para siempre.

Abrir la importación (`procesando`) y cerrarla (`completada`) es de quien
orqueste la lectura periódica, junto con S3-FE-18 (reintentos) y S3-FE-20
(desconexión). Esta tarjeta no agrega una tarea de Celery.

## Qué sale de cada correo

Todas las filas son casos de las pruebas. Los correos llegan el 2 de octubre
de 2026 (hora de Chile), salvo donde se dice otra cosa.

| El correo | Resultado |
|---|---|
| «Tu recibo de Netflix»: `Fecha de cobro: 1 de octubre de 2026`, `Total: CLP 9.990` | candidato `cobro_realizado`, 9990 CLP, 2026-10-01 |
| «Tu suscripción se renovará pronto»: `Te cobraremos USD 10.99 el 5 de noviembre de 2026.` | candidato `aviso_de_cobro`, 10.99 USD, **2026-11-05**: la del cobro anunciado |
| `Realizaremos el cobro de CLP 9.990 el 5 de noviembre de 2026.` | candidato `aviso_de_cobro`, 2026-11-05 |
| «Problema con tu pago»: `No pudimos procesar tu pago de CLP 9.990 del 1 de octubre de 2026.` | candidato `pago_fallido`, 2026-10-01 |
| «Tu recibo de Netflix»: `Total: CLP 9.990`, sin fecha | candidato con la fecha de **recepción**, declarada en la evidencia |
| el mismo, llegado a las 02:30 UTC del 1 de noviembre | fecha **2026-10-31**: el día en Chile, no en UTC |
| «Tu recibo de Netflix»: `Total: CLP 9.990` y solo «Tu próximo cobro será el 1 de noviembre» | candidato con la fecha de recepción, **no** la del próximo ciclo |
| recibo con `Fecha de cobro: 3 de octubre de 2026` | candidato: un día de holgura por la zona del servicio |
| Apple «Tu recibo de Apple»: `Total: USD 2.99` | candidato **sin proveedor**: `servicio = null`, `ambiguo` |
| `Juan Pérez Soto <juan.perez@gmail.com>`, «Tu recibo» | candidato sin proveedor, `servicio_texto = "Juan Pérez Soto"` |
| HTML de un párrafo: `Hola Juan Pérez, gracias por tu pago de CLP 9.990 del 1 de octubre de 2026 con la tarjeta terminada en 4242.` | candidato; `importe_fragmento` = `gracias por tu pago de CLP 9.990 del 1 de octubre de`, sin el nombre ni la tarjeta |
| `Total: $9.990` | error `moneda_ambigua` |
| `Total: CLP 9.990` y `Total: CLP 10.990` | error `importe_ambiguo` |
| `Total: -9.990 CLP` | error `importe_ambiguo`: puede ser una devolución |
| «Tu recibo»: `Gracias por tu pago.` | error `importe_no_encontrado` |
| `Fecha: 01/10/2026` | error `fecha_ambigua` |
| «Recordatorio de pago»: `Te cobraremos CLP 9.990 pronto.` | error `fecha_no_indicada` |
| «Recordatorio de pago»: `Fecha: 28 de octubre de 2026` y `Te cobraremos CLP 9.990 pronto.` | error `fecha_no_indicada`: la fecha del aviso no es la del cobro |
| «Problema con tu pago», sin fecha | error `fecha_no_indicada` |
| «Problema con tu pago»: `Lo intentaremos de nuevo el 5 de noviembre de 2026.` | error `fecha_no_indicada`: es la del reintento |
| «Problema con tu pago»: `Tu tarjeta será cargada el 5 de noviembre de 2026.` | error `fecha_no_indicada`: posterior a su llegada |
| «Tu recibo»: `Tu plan está activo hasta el 30 de noviembre de 2026.` | error `fecha_no_indicada`: posterior a su llegada |
| «Netflix»: `fue rechazado` y `Hemos recibido tu pago` | error `tipo_incierto` |
| «Ofertas de la semana»: `Notebook a solo CLP 299.990` | error `tipo_incierto` |
| «Ofertas de la semana»: `Descuentos en tecnología.` | **descartado**: ni candidato ni error |
| un `MensajeOmitido` del lector («el mensaje ya no existe») | error `mensaje_omitido` |
| un `MensajeOmitido` sin `id` | error `mensaje_omitido` sin `identificador_origen`; el resto de la página se guarda |

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
| aviso de cobro | **solo** la del cobro anunciado (`fecha_proximo_cobro` de S3-FE-07); si no la hay, `fecha_no_indicada` | `cobro_anunciado` |
| cobro realizado | la del texto, si no es posterior a su llegada; si no hay fecha, la de recepción | `texto` o `recepcion` |
| pago fallido | la del texto, si no es posterior a su llegada | `texto` |

**El aviso usa solo la fecha anunciada.** Otra fecha del texto puede ser la del
propio aviso («Fecha: 28 de octubre de 2026»), y antes se usaba como si fuera
la del cobro, con la misma etiqueta `texto` que lleva un recibo con fecha
cierta. Para que esto no deje sin fecha un aviso bien escrito, las frases con
que S3-FE-08 reconoce un aviso («Realizaremos el cobro…», «Upcoming payment»,
«Your trial ends»…) marcan ahora su fecha como del próximo cobro en S3-FE-07;
una prueba de S3-FE-07 recorre esas frases una por una. Quedan fuera los
«recordatorio» y «reminder», que no dicen de qué es la fecha que traen.

**Un recibo o un fallo hablan de algo que ya pasó.** Su fecha nunca es la del
próximo ciclo, ni la del reintento que anuncia un fallo («Lo intentaremos de
nuevo el 5 de noviembre»: S3-FE-07 la marca como próxima), ni una posterior al
día en que llegó el correo. Para esto último hay **un día de holgura**
(`HOLGURA_FECHA_PASADA`, frontera inclusiva): el servicio fecha en su zona, que
puede ir adelantada respecto de Chile, y un cobro hecho en Europa a la 01:00
del 1 llega aquí el 31 a las 21:00. Dos días o más después de la llegada es
`fecha_no_indicada`, con el motivo «la fecha del correo (…) es posterior a su
llegada (…)».

**La fecha de recepción** solo vale para un **recibo**, que es lo que el
contrato permite, y queda declarada: `fecha_origen = "recepcion"` y
`fecha_motivo` con el motivo de S3-FE-07. Un aviso sin fecha anunciada no la
usa: el día en que llegó no es el día en que se va a cobrar. Un fallo sin fecha
tampoco, porque el contrato no lo prevé; si hiciera falta, se cambia ahí
primero. Es el día **en Chile** (`MensajeCorreo.dia_recibido`, con
`TIME_ZONE`), no en UTC, que es como la entregan los lectores: un recibo de las
23:30 del 31 de octubre no queda como del 1 de noviembre, otro mes.

### El servicio sí puede faltar

Como en el CSV, un servicio ambiguo o desconocido **no** impide el candidato:
queda con `servicio = null`, `servicio_resultado` dice por qué, y
`servicio_texto` trae el texto del que se intentó sacar: el **nombre visible**
del remitente, su dominio o el asunto (las reglas de S3-FE-06). Si el
remitente es una persona («Juan Pérez Soto»), su nombre queda ahí, porque es lo
que la web muestra para que alguien resuelva el servicio; su dirección ya va en
`evidencia["remitente"]`. La confirmación (S3-FE-15) ya rechaza un candidato
sin proveedor con `servicio_sin_resolver`.

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
| encontrar el correo | `proveedor_correo`, `cuenta_id`, `id_mensaje`, `message_id` (entero: el identificador es su hash, ver documento 26), `recibido_en` (el instante exacto, con su zona), `remitente`, `asunto` |
| explicar el servicio | `servicio_fuente`, `servicio_regla` |
| explicar el tipo | `tipo_motivo`, `tipo_evidencia` (las frases de S3-FE-08) |
| explicar importe, moneda y fecha | `importe_fragmento` (la moneda sale del mismo monto), `fecha_fragmento`, `fecha_origen`, y `fecha_motivo` cuando es la de recepción |
| avisar | `texto_truncado`, si el lector cortó el texto en 20.000 caracteres |

### Los fragmentos son una ventana, no la línea

`importe_fragmento` y `fecha_fragmento` son el dato y un poco de lo que lo
rodea en su línea, armados por S3-FE-07 (`datos_del_cobro._ventana`):

- hasta **30 caracteres antes** y **20 después** del dato;
- sin cruzar el fin de su frase o inciso (`. `, `, `, `; `, `!`, `?`, `…`,
  `|`, ` - `): el punto y la coma solo cuentan si les sigue un espacio, para no
  cortar dentro de `9.990` ni de `1.234,50`;
- sin dejar una palabra cortada en el borde.

En un recibo con una línea por dato (`Total: CLP 9.990`) la ventana es la línea
entera, y el ejemplo del contrato sale igual. Cambia en un cuerpo de **una
sola línea**, que es lo que deja `html_a_texto` de un HTML de un párrafo:

| El cuerpo | Antes | Ahora |
|---|---|---|
| `Hola Juan Pérez, gracias por tu pago de CLP 9.990 del 1 de octubre de 2026 con la tarjeta terminada en 4242.` | el cuerpo entero, con el nombre y la tarjeta | `gracias por tu pago de CLP 9.990 del 1 de octubre de` |
| `Gracias por tu pago. Hola Juan Pérez, RUT 12.345.678-9, tarjeta terminada en 4242, dirección Los Aromos 123. Detalle del plan… Total: CLP 9.990` | los primeros 200 caracteres: el RUT, la tarjeta y la dirección, **sin** el monto | `Total: CLP 9.990` |

Las claves del ejemplo de correo del contrato (`asunto`, `remitente`,
`message_id`, `proveedor_correo`, `importe_fragmento`, `fecha_fragmento`) son
las mismas, y hay una prueba que arma ese ejemplo con un correo de verdad, por
las tres piezas de lectura, y lo compara campo por campo y contra el esquema.

**Lo que no se guarda:** el cuerpo, la línea entera de la que salió un dato, el
HTML, los adjuntos, el hilo ni nada de la autorización. El nombre visible del
remitente solo queda en `servicio_texto`, cuando de él se intentó sacar el
servicio (ver arriba). Cada valor pasa por `_acotado`: una sola línea, sin
caracteres de control y con tope (200 para asunto y fragmentos, 254 para la
dirección, 998 para el Message-ID). Una clave vacía no se guarda: un correo sin
Message-ID no lleva `message_id`. Los registros dicen solo números y el id de
la importación.

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
asunto, remitente y el día en que llegó (en Chile), que es lo que la persona
necesita para encontrarlo en su buzón.

**El motivo va siempre entero.** `Importacion.anotar_error` guarda
`LARGO_MENSAJE_DE_ERROR` (200) caracteres del mensaje, y antes lo que se perdía
era el final: con un asunto y un remitente largos quedaba «…y ninguno se
distin». Ahora el motivo se acota a 120 (`LARGO_MOTIVO_EN_ERROR`, con «…» si
pasa) y el asunto y el remitente se reparten lo que queda, hasta 60 cada uno y
nunca menos de 24.

`identificador_origen` es nuevo en la entrada y solo lo llevan los de correo.
Sin él no hay forma de saber que un error ya se anotó cuando la misma página
se vuelve a leer. Es una clave más, no un cambio de las tres que ya había: el
tipo `ErrorImportacion` de la web la ignora.

### Los mensajes omitidos

Un `MensajeOmitido` es un correo que la lista nombró pero el lector no pudo
leer. Su identidad es el `id` del proveedor **entero**, con la misma regla que
un mensaje sin Message-ID (`identificador_del_proveedor`, documento 26). Los
dos lectores lo entregan entero (`MensajeOmitido.desde_la_lista`): antes lo
cortaban a 64, y los `id` de Graph de un buzón comparten los primeros ~100
caracteres (el buzón y la carpeta), así que tres omitidos distintos de Outlook
eran uno solo, y en las páginas siguientes ya no se anotaba ninguno.

Si la lista no trajo un `id` que sirva (vacío, que no es texto, con caracteres
que no se imprimen o de más de 512), el omitido llega con `id_mensaje = ""` y se anota **sin**
`identificador_origen`. Antes eso lanzaba `ValueError` y, dentro de la lectura
por cursor, la página se releía para siempre.

## Idempotente

| Pasa | Queda |
|---|---|
| la misma página se guarda dos veces (el cursor se reinició, S3-FE-05) | un candidato y un error |
| el mismo recibo llega a Gmail y a Outlook de la misma organización | un candidato, en la importación que lo leyó primero; la otra lo cuenta como ya guardado |
| el mismo Message-ID dos veces en una página (dos carpetas) | uno, el primero |
| se vuelve a leer un correo cuyo candidato se rechazó | sigue rechazado: no se vuelve a proponer |
| el mismo Message-ID en otra organización | otro candidato: la unicidad lleva la organización |
| tres omitidos de Outlook con el mismo prefijo, y otro en la página siguiente | cuatro errores |
| dos omitidos sin `id` en una página | dos errores, y el resto de la página guardado |

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

- **La ventana acota, no reconoce datos personales.** Lo que esté en la misma
  frase y pegado al monto (hasta 30 caracteres antes o 20 después) puede
  quedar en el fragmento: en «tarjeta 4242 Total: CLP 9.990» queda la tarjeta.
  Lo que separa una coma, un punto o un punto y coma no queda.
- **Contadores en una relectura.** Pasado el tope de 20 errores
  (`Importacion.MAXIMO_ERRORES`), la identidad de los que no entraron a la
  lista no queda guardada, así que un mensaje con error releído suma otra vez
  en `errores_totales`. `filas_procesadas` también cuenta la relectura. Los
  candidatos, que son lo que mueve plata, no se duplican nunca. Hacer exactos
  los contadores pediría guardar cada mensaje procesado: una tabla y una
  migración, que esta tarjeta no necesitó.
- **Un omitido sin `id` se anota otra vez si la página se relee**: no hay con
  qué reconocerlo. Repetirlo es mejor que perderlo o que detener el buzón.
- **El solape entre corridas.** Si la orquestación abre una importación por
  corrida, el correo que cae en el solape de 10 minutos (S3-FE-03) puede
  aparecer como error en las dos. Cada importación lo informa una vez.
- **La web no muestra la evidencia todavía.** `fecha_origen = "recepcion"`
  está guardado y viaja en `GET /api/candidatos/`, pero la lista de la web no
  lo enseña. Conviene que lo haga antes de que se confirmen candidatos de
  correo.

## Lo que cambió al revisarlo de nuevo

Al revisar de nuevo `6384e9d`, antes de abrir la PR, aparecieron ocho cosas. Las siete de
código se reprodujeron con una prueba que fallaba antes de corregirlas; la
octava era de este documento, y su prueba fija lo que el código ya hacía.

| Hallazgo | Qué se hizo | Dónde |
|---|---|---|
| P1: con el cuerpo en una línea, el fragmento era el cuerpo entero o traía RUT, tarjeta y dirección sin el monto | el fragmento es una ventana alrededor del dato | `datos_del_cobro._ventana` (S3-FE-07) |
| P2: la fecha de recepción y el «recibido el» salían en UTC | el día en Chile | `MensajeCorreo.dia_recibido` |
| P2: un aviso sin fecha anunciada tomaba cualquier fecha del texto | solo la anunciada; las frases de aviso de S3-FE-08 la marcan en S3-FE-07 | `candidatos_correo._fecha`, `datos_del_cobro._ETIQUETAS_DE_PROXIMO` |
| P2: los omitidos de Outlook se juntaban en uno | el lector entrega el `id` entero | `MensajeOmitido.desde_la_lista` |
| P3: un omitido sin `id` tumbaba la página | se anota sin identidad | `candidatos_correo.leer` y `guardar_pagina` |
| P3: un pago fallido tomaba la fecha del reintento | el reintento es fecha próxima, y una fecha posterior a la llegada queda para revisión | `datos_del_cobro`, `candidatos_correo._fecha` |
| P3: con asunto y remitente largos se cortaba el motivo | el motivo va entero y el resto se reparte | `candidatos_correo._mensaje_de_error` |
| P3: este documento decía que no se guarda el nombre visible del remitente | se corrigió: queda en `servicio_texto` cuando de él se intentó sacar el servicio | este documento |

Además, una de las pruebas nuevas fallaba de vez en cuando: buscaba «4242» en
todo lo guardado, y ese número sale por azar en un UUID o en los microsegundos
de una fecha (2 de cada 300 guardados, medido). Ahora busca frases enteras.

## Dónde está

| Pieza | Archivo |
|---|---|
| Leer y guardar | `services/connectors/connectors/candidatos_correo.py` |
| La ventana de los fragmentos y las etiquetas de fecha próxima | `services/connectors/connectors/datos_del_cobro.py` (S3-FE-07) |
| El día de recepción en Chile y el `id` entero de un omitido | `services/connectors/connectors/lectura_correo.py` → `MensajeCorreo.dia_recibido`, `MensajeOmitido.desde_la_lista`, `es_id_de_mensaje` |
| Los omitidos de cada lector | `services/connectors/connectors/lector_gmail.py`, `lector_outlook.py` |
| La inserción compartida con el CSV | `services/connectors/connectors/models.py` → `CobroCandidato.guardar_sin_duplicar` |
| El error con la identidad del mensaje | `services/connectors/connectors/models.py` → `Importacion.anotar_error`, `LARGO_MENSAJE_DE_ERROR` |
| La identidad de un mensaje omitido | `services/connectors/connectors/origen_correo.py` → `identificador_del_proveedor` |
| Las pruebas | `services/connectors/tests/test_candidatos_correo_s3_fe_09.py` (63) y `test_carrera_candidatos_correo_postgres.py` (2); por la revisión, 35 más en `test_datos_del_cobro_s3_fe_07.py` y 1 en `test_lector_outlook.py` |

Sin migración: no hay tablas ni campos nuevos.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_candidatos_correo_s3_fe_09.py tests/test_carrera_candidatos_correo_postgres.py tests/test_datos_del_cobro_s3_fe_07.py tests/test_lector_outlook.py tests/test_lector_gmail.py -q
```

Las dos de carrera se saltan si la base no es PostgreSQL.

## Cómo se comprobaron las pruebas

Se rompió el código a propósito 32 veces en la entrega y 19 más en las
correcciones de la revisión, y cada vez falló al menos una prueba. Entre otras:

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

Y en las correcciones: devolver la línea entera, no cortar el inciso antes o
después del dato, dejar palabras cortadas, cortar en el punto de `9.990`;
tomar el día en UTC; que el aviso vuelva a la fecha del texto; quitar de
S3-FE-07 las frases de aviso o las de reintento; quitar el control de fecha
posterior, dejarlo sin holgura o con la frontera exclusiva; volver a recortar
el `id` a 64, aceptar solo `id` de 64 en Outlook, volver a lanzar con un
omitido sin `id` o deduplicar los que no tienen identidad; no repartir el
espacio del mensaje o no acotar el motivo.

Al principio dos no fallaban en la entrega (no deduplicar dentro de la página
y contar los nuevos como ya guardados) y dos en la revisión (no cortar el
inciso después del dato, y que el aviso volviera a la fecha del texto, que la
tapaba el control de fecha posterior porque el ejemplo usaba una fecha
futura). Se agregaron las pruebas que faltaban: una línea con datos después de
una coma, y un aviso fechado el mismo día en que llegó, que es lo normal.
