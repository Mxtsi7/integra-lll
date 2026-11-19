# S3-FE-04 — Consultar los mensajes autorizados de Outlook

**Qué hace.** Lo mismo que S3-FE-02 para Gmail (documento 23), pero contra
Microsoft Graph: lee una página de mensajes de una cuenta de Outlook conectada,
en memoria, sin guardar nada ni cambiar la cuenta.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| La lectura usa la cuenta correcta | `cuenta_para_leer` con el proveedor Outlook: la de otra organización, una de Gmail con ese identificador, una desconectada o con el token vencido no se leen, y no se hace ni una petición |
| Maneja páginas adicionales y el rechazo de autorización de forma explícita | la página siguiente la arma el lector, por fecha, y una que no armó él se rechaza sin hablar con Graph; 401 y 403 son `AutorizacionRechazada` con su código |

Lo que tiene que decir lo mismo que Gmail —qué cuenta se puede leer, los
tipos que se devuelven, los errores, el filtro y el HTML a texto— vive en
`lectura_correo.py` y se separó en la PR de S3-FE-02. Aquí queda lo de
Microsoft.

## En qué se distingue de Gmail

| | Gmail | Outlook |
|---|---|---|
| Peticiones por página | 1 + una por mensaje | **1**: el cuerpo viene en la lista |
| Página siguiente | un token corto (`pageToken`) | **un cursor que arma el lector, por fecha** (`antes-de=…&vistos=…`) |
| Búsqueda | `q`, con fechas exactas | las fechas en `$filter`; palabras y remitentes, de este lado (sin `$search`) |
| Cuerpo | partes MIME | `body`, pedido en texto (`Prefer: outlook.body-content-type="text"`) |

## La página siguiente, por fecha y no por posición

En S3-FE-04 la página siguiente era la `@odata.nextLink` de Graph, pedida tal
cual. Esa URL avanza con `$skip`, «saltar los primeros N», y la revisión de
#189 (ronda 3) mostró lo que eso cuesta: si a mitad de una corrida de S3-FE-05
se borra **definitivamente** un correo ya leído, los que siguen se corren un
lugar y el del borde de la página no se entrega nunca. La corrida termina
igual y la marca avanza: perdido para siempre. Un borrado así no tiene que ser
a mano: Outlook.com vacía solo «Elementos eliminados», y en Exchange Online
lo hace la directiva de retención. La primera corrida cubre 90 días y dura
muchas llamadas.

Ahora **la página siguiente la arma el lector**. Cada página es una consulta
nueva: el mismo `$filter` y el mismo `$orderby`, con el tope cambiado por
`receivedDateTime lt <corte>`. El cursor que se devuelve
(`antes-de=20261116T110001Z&vistos=…`) guarda dos cosas y ninguna depende de
la posición:

- **El corte**: el último segundo que se vio, más uno. Graph muestra la fecha
  al segundo, pero el buzón la guarda con fracción. Cortar en
  `lt <último segundo>` dejaría fuera a los de ese mismo segundo que no
  alcanzaron a entrar en la página; con un segundo más vuelven todos.
- **Los vistos**: una huella de 16 hexadecimales del `id` (inmutable, por
  `IdType="ImmutableId"`) de cada correo de ese último segundo que ya se vio,
  sea cobro o no. Se reconocen y no se entregan dos veces. Para que quepan
  los nuevos, se piden `limite` más los vistos, con 100 como tope. Si una
  página entera cae en el mismo segundo que la anterior, sus vistos se suman.

Si se borra un correo, de cualquier lado, los demás siguen dentro de la
consulta: no se salta ninguno. De la `@odata.nextLink` solo se usa **que
venga**, que quiere decir que hay más. Nunca se pide.

Dos casos no avanzan. En los dos sale un error explícito, en vez de una página
vacía o un bucle:

| Caso | `codigo` |
|---|---|
| Graph dice que hay más y no entrega nada nuevo, o nada con fecha | `pagina_sin_avance` |
| Más de 99 correos recibidos en el mismo segundo: ya no caben en una página | `demasiados_en_un_segundo` |

### El token va siempre al mismo lugar

Como nunca se pide una URL armada por otro, el token va siempre a
`https://graph.microsoft.com/v1.0/me/messages`, con `allow_redirects=False`:
una redirección mandaría el token adonde diga la respuesta. Antes había que
validar parte por parte la `nextLink` que entraba y la que salía
(`es_pagina_de_graph`); ya no hace falta y se sacó. Una `pagina` que no tenga
la forma exacta del cursor es un `ValueError` sin hablar con Graph, y siguen
probadas las URL de antes (otro servidor, usuario en el `netloc`, puerto,
`http`, `//…`) junto con los cursores mal formados.

Si se pasa `pagina`, hay que pasar el filtro de la primera: un cursor cuyo
corte queda antes del `desde` es de otra ventana y se rechaza, y uno que queda
después del `hasta` no la amplía.

### Una página se procesa entera

Antes el tamaño de una página que se seguía lo fijaba el `$top` de la
`nextLink`, y se recortaba a `limite`: seguir una página de 25 con `limite=5`
devolvía 5, conservaba el cursor que ya avanzaba después de los 25 y los otros
20 se perdían sin aviso. Lo encontró la revisión de #177. Ahora el cursor no
trae tamaño: cada página pide `limite` más los vistos y se devuelve todo lo
que llega. Si Graph devuelve **más** de lo pedido, es un error explícito: no
se recorta, porque recortar es perder.

## Filtros

**No se usa `$search`.** Graph la limita a 1000 resultados y los ordena por
fecha de envío ([documentación](https://learn.microsoft.com/en-us/graph/search-query-parameter)):
que no venga `@odata.nextLink` no quiere decir que se leyó todo. S3-FE-05
avanza su marca justo con eso, y con más de 1000 cobros en la ventana se
perdían los que quedaban fuera, para siempre. Lo encontró la revisión de
#189. Ahora hay un solo camino:

- **Las fechas van en `$filter`** (`receivedDateTime ge … and
  receivedDateTime lt …`, en UTC) y el orden en `$orderby receivedDateTime
  desc`. Graph pagina eso **sin tope**. Lo que va en `$orderby` aparece antes
  en `$filter`, como exige Graph; si no, responde `InefficientFilter`.
- **Las palabras de cobro y los remitentes se aplican de este lado**, con
  `FiltroCorreos.coincide`, sobre lo mismo que mira `$search` cuando no se le
  dice qué propiedad buscar: según la
  [documentación](https://learn.microsoft.com/en-us/graph/search-query-parameter),
  remitente, asunto y cuerpo. Ni destinatarios ni nombres de adjuntos: la
  búsqueda de antes eran palabras sueltas, sin `to:` ni `attachment:`, así que
  tampoco los miraba. Si una cuenta real mostrara otra cosa, ahí el filtro
  sería más estrecho.
- En eso que mira, el filtro es más permisivo que `$search`: la palabra vale
  como fragmento, sin mayúsculas, y un acento compuesto vale lo mismo que uno
  escrito aparte (NFKC). Un **cuerpo HTML se mira dos veces**: crudo, por lo
  que no se ve (un enlace, un `alt`), y pasado a texto, porque un acento puede
  venir como entidad (`suscripci&oacute;n`, `Renovaci&#243;n`) y en el crudo
  la palabra no está. Antes se miraba solo el crudo y ese cobro se perdía sin
  quedar entre los omitidos (revisión de #189, ronda 3).
- Un remitente vale por dirección exacta o por dominio, también un subdominio
  (`info@account.netflix.com` es de `netflix.com`).
- Las fechas se vuelven a mirar aquí, a la hora exacta: Graph filtra al
  segundo.

El costo: se traen también los correos de la ventana que no son cobros. Una
página puede venir **sin mensajes y con página siguiente**: en ese tramo no
había cobros.

Un mensaje que no es cobro, o que queda fuera del rango, **no** va a
`omitidos`: no es un problema, es el filtro. Uno que menciona un cobro y no
se puede armar (sin fecha, sin identificador) sí. Si se pasa `pagina`, hay
que pasar el mismo filtro, porque es el que se aplica a lo que llega.

## Lo que responde Graph

| Respuesta | Excepción | `codigo` |
|---|---|---|
| 401 | `AutorizacionRechazada` | `autorizacion_rechazada` |
| 403 | `AutorizacionRechazada` | `permiso_insuficiente` |
| 404 `MailboxNotEnabledForRESTAPI` / `ResourceNotFound` | `ErrorDelProveedor` | `buzon_no_disponible` (una cuenta sin buzón de Outlook) |
| 429 | `ErrorTransitorio` | `cuota_excedida`, con `reintentar_en` si vino `Retry-After` |
| 5xx | `ErrorTransitorio` | `falla_del_proveedor` |
| sin red / tiempo agotado | `ErrorTransitorio` | `sin_conexion` / `tiempo_agotado` |
| 400, 410 u otra cosa | `ErrorDelProveedor` | `error_del_proveedor` |
| hay más y no avanza | `ErrorDelProveedor` | `pagina_sin_avance` |
| más de 99 en el mismo segundo | `ErrorDelProveedor` | `demasiados_en_un_segundo` |

Un 400 o un 410 con una `pagina` tampoco es un `CursorRechazado`, que es lo
que reinicia una corrida de S3-FE-05: el cursor lo arma este lector y Graph no
lo conoce, así que no tiene cómo vencer.

`reintentar_en` es nuevo en `ErrorTransitorio` y sirve también para Gmail.
Solo se usa si es un número entre 0 y 3.600; un valor raro queda en `None` y
lo decide S3-FE-18. Del error de Graph solo se copia `error.code`, y solo si
son letras, números o `_`; el `message` no se propaga.

## Probarlo contra una cuenta real

```
python manage.py leer_outlook --organizacion <uuid> --cuenta <uuid> --limite 5
python manage.py leer_outlook ... --pagina "<siguiente página de la corrida anterior>"
```

Es `leer_gmail` con el lector de Outlook: misma salida, sin el texto de los
mensajes. La página siguiente lleva un `&` y va entre comillas, con las mismas
`--desde` y `--hasta` de la primera.

**Está pendiente**, por lo mismo que en Gmail: hace falta registrar la
aplicación en Microsoft Entra con el permiso `Mail.Read`, cargar
`OAUTH_OUTLOOK_CLIENT_ID` y `OAUTH_OUTLOOK_CLIENT_SECRET` y conectar la
cuenta. El lector tampoco renueva el token; el comando sí (S3-FE-19, documento 25).

## Dónde está

| Pieza | Archivo |
|---|---|
| El lector | `services/connectors/connectors/lector_outlook.py` |
| Lo común con Gmail | `services/connectors/connectors/lectura_correo.py` |
| El comando | `services/connectors/connectors/management/commands/leer_outlook.py` |
| Las pruebas | `services/connectors/tests/test_lector_outlook.py` (95) |

## Cómo se comprobaron las pruebas

Los dos 401 son **copia literal** de lo que respondió `graph.microsoft.com` a
un token ilegible y a una petición sin token. La forma de la lista y de cada
mensaje sigue la referencia publicada de "List messages"; se va a contrastar
en la corrida real.

Se rompió el código a propósito 43 veces y cada vez falló al menos una prueba:
pedir la cuenta de Gmail, no validar la página que entra o la que sale,
comparar la página por prefijo o solo por nombre de servidor, aceptar `http`,
fragmento, espacios o cualquier largo, reenviar parámetros en la página,
seguir redirecciones, tomar un 401 por transitorio, tratar cualquier 404 como
cuenta sin buzón, ignorar `Retry-After` o aceptarlo sin tope, copiar el
`error.code` sin mirarlo, mandar `$orderby` junto con `$search`, no aplicar
las fechas con `$search`, `hasta` inclusivo, fechas en hora local, no pasar el
HTML a texto, aceptar una fecha sin zona, entre otras.

Al principio dos no fallaban: un chequeo de puerto que el del `netloc` ya
cubría (se sacó) y una validación del filtro que la otra traducción tapaba (se
agregó la prueba que llama a cada una por separado).
