# S3-FE-02 — Consultar los mensajes autorizados de Gmail

**Qué hace.** Lee una página de mensajes de una cuenta de Gmail que la
organización conectó, con filtros, paginación y límites. Devuelve los
mensajes **en memoria**: no guarda nada y no cambia la cuenta.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Se leen mensajes permitidos de una cuenta de prueba | `leer_mensajes` y el comando `leer_gmail`. Las pruebas usan respuestas de Google; **la corrida contra una cuenta real está pendiente** (ver abajo) |
| Una cuenta ajena o desconectada queda excluida | `cuenta_para_leer`: se busca por organización y se exige `conectada` antes de hablar con Google |

## Lo que viene después, y por qué no está aquí

Este módulo lee y nada más. Lo demás tiene su propia tarjeta, y los errores
salen como excepciones con un `codigo` estable para que esas tarjetas decidan:

| Tarjeta | Qué hace | Qué recibe de aquí |
|---|---|---|
| S3-FE-03 | guarda hasta dónde se leyó, por cuenta | `siguiente_pagina` |
| S3-FE-06 / 07 / 08 | saca servicio, importe, fecha y tipo de aviso | `MensajeCorreo` |
| S3-FE-18 | reintenta con espera progresiva | `ErrorTransitorio` |
| S3-FE-19 | renueva el token o pide reconexión | `AutorizacionRechazada` y `credencial_vencida` |
| S3-FE-20 | deja de leer una cuenta que se desconecta a mitad de camino | `cuenta_para_leer`, que se puede volver a llamar antes de guardar |

Por eso un 401 **no marca la cuenta**: decidir si se renueva el token o se le
pide al usuario que reconecte es de S3-FE-19, y hacerlo aquí sería decidirlo
dos veces.

## El recorrido

```
leer_mensajes(organizacion_id, cuenta_id, filtro, pagina, limite)
  │
  ├─ 1. valida límite, página y filtro ............. ValueError, sin tocar la base
  ├─ 2. cuenta_para_leer ........................... CuentaNoDisponible, sin hablar con Google
  ├─ 3. GET /gmail/v1/users/me/messages?q=…&maxResults=…&pageToken=…
  │        fields=messages(id,threadId),nextPageToken
  ├─ 4. por cada id: GET /messages/{id}?format=full
  │        fields=id,threadId,internalDate,payload
  └─ 5. PaginaDeMensajes(mensajes, siguiente_pagina, omitidos)
```

## Solo cuentas autorizadas

`cuenta_para_leer` busca la cuenta **con la organización en el filtro**.
Rechaza antes de llamar a Google:

| Caso | `codigo` |
|---|---|
| de otra organización, de otro proveedor, inexistente o con un identificador que no es UUID | `cuenta_no_encontrada` (la misma respuesta para todos: no confirma que existe) |
| desconectada, **aunque conserve el token cifrado** para reintentar la revocación (FE-05) | `cuenta_desconectada` |
| `requiere_reautorizacion`, `error`, o un token que ya no descifra con las claves vigentes | `requiere_reautorizacion` |
| un estado que no se conoce | `estado_no_legible` |
| sin token de acceso | `sin_credenciales` |
| token vencido o que vence en menos de 30 segundos | `credencial_vencida` |

Desconectada se revisa antes que "vuelva a autorizar": pedirle al usuario que
reautorice una cuenta que él mismo desconectó sería un error.

## Acceso mínimo

- El permiso que se pide al conectar ya es `gmail.readonly` (sprint 2).
- **La búsqueda filtra.** Por omisión, `q` lleva palabras de cobro en español
  y en inglés (`recibo`, `factura`, `boleta`, `receipt`, `invoice`, …). Es
  amplia a propósito: un recibo que no entra no se ve nunca; uno que sobra lo
  descarta S3-FE-08.
- **Se piden solo los campos que se usan** (`fields`, la respuesta parcial de
  Google).
- **Del mensaje se conserva el texto**: las partes `text/plain`, o el HTML
  pasado a texto si no hay ninguna. Los adjuntos no se leen, el texto se corta
  en 20.000 caracteres (con `texto_truncado` avisándolo) y el cuerpo **no sale
  en el `repr`**, para que un log o una traza no se lleven el correo.

## Filtros

`FiltroCorreos(desde, hasta, remitentes, solo_cobros)`:

- `desde` y `hasta` van a Gmail como `after:` / `before:` **en segundos
  epoch**, que es la forma en que Gmail no depende de la zona horaria de la
  cuenta. Una fecha sin zona horaria se rechaza.
- `remitentes` acepta direcciones o dominios. Cualquier otra cosa se rechaza
  antes de armar la búsqueda: `a) OR in:anywhere` o un `-` adelante (que en
  Gmail niega) cambiarían lo que se lee.

## Límites

- Una llamada lee **una página** de 1 a 100 mensajes (25 por omisión). No
  recorre el buzón entero: eso dejaría un worker tomado por minutos y, si se
  cae, sin saber hasta dónde llegó. Recorrer y recordar es S3-FE-03.
- Un `pagina` vacío o de más de 512 caracteres no viene de Gmail y no se
  reenvía.
- Cada petición lleva el mismo tiempo límite que el OAuth (10 s).
- Un correo con miles de partes MIME no se recorre entero (tope de 100).

## Lo que responde Google

| Respuesta | Excepción | `codigo` |
|---|---|---|
| 401 | `AutorizacionRechazada` | `autorizacion_rechazada` |
| 403 sin permiso suficiente | `AutorizacionRechazada` | `permiso_insuficiente` |
| 403 `accessNotConfigured` | `ErrorDelProveedor` | `api_deshabilitada` |
| 403 de cuota, o 429 | `ErrorTransitorio` | `cuota_excedida` |
| 5xx | `ErrorTransitorio` | `falla_del_proveedor` |
| sin red / tiempo agotado | `ErrorTransitorio` | `sin_conexion` / `tiempo_agotado` |
| 400 (página inválida) u otra cosa | `ErrorDelProveedor` | `error_del_proveedor` |
| 404 **de un mensaje** (se borró entre la lista y la lectura) | ninguna: va a `omitidos` y se sigue | — |

Ninguna excepción lleva el token. Las de red se lanzan `from None`, porque el
mensaje original de `requests` puede traer la URL o las cabeceras.

Un mensaje que no se puede usar (sin fecha, con un identificador raro, o si
Gmail devuelve otro mensaje del que se pidió) **se informa en `omitidos`**.
Callarlo sería perder un cobro sin que nadie lo sepa.

## Probarlo contra una cuenta real

```
python manage.py leer_gmail --organizacion <uuid> --cuenta <uuid> --limite 5
python manage.py leer_gmail --organizacion <uuid> --cuenta <uuid> --desde 2026-10-01 --todos
python manage.py leer_gmail ... --pagina <siguiente página de la corrida anterior>
```

Muestra identificador, fecha, remitente, asunto y el **largo** del texto; el
texto no, porque esta salida termina en una PR o en una captura.

**Está pendiente.** Hace falta una cuenta conectada de verdad, y para eso:

1. En el proyecto de Google Cloud del cliente OAuth: habilitar la API de
   Gmail, agregar el permiso `gmail.readonly` a la pantalla de consentimiento,
   agregar la cuenta de prueba como usuario de prueba y registrar el
   `OAUTH_REDIRECT_URI`.
2. Poner `OAUTH_GMAIL_CLIENT_ID` y `OAUTH_GMAIL_CLIENT_SECRET` en el entorno
   de connectors.
3. Conectar la cuenta desde la app (`conectores/autorizaciones/`) y correr el
   comando. El lector no renueva el token, pero el comando sí: usa la
   renovación de S3-FE-19 (documento 25).

## Dónde está

| Pieza | Archivo |
|---|---|
| El lector, lo propio de Google | `services/connectors/connectors/lector_gmail.py` |
| Lo común con Outlook: la cuenta, los errores, el filtro, el HTML | `services/connectors/connectors/lectura_correo.py` |
| El comando | `services/connectors/connectors/management/commands/leer_gmail.py` |
| Las pruebas | `services/connectors/tests/test_lector_gmail.py` (82) |

## Cómo se comprobaron las pruebas

Los dos 401 de las pruebas son **copia literal** de lo que respondió
`gmail.googleapis.com` a un token inventado y a una petición sin token. Las
respuestas 200 siguen la referencia publicada de la API, y se van a
contrastar en la corrida real.

Además se rompió el código a propósito 30 veces y cada vez falló al menos una
prueba. Algunos ejemplos: sacar la organización o el proveedor del filtro,
leer una cuenta desconectada o en un estado desconocido, quitar el margen de
vencimiento, aceptar un límite sin tope o un `True`, no validar el remitente,
tomar un 401 por transitorio o un 404 de la lista por un mensaje borrado,
preferir el HTML, leer adjuntos, ignorar el juego de caracteres, dejar el
cuerpo en el `repr` o aceptar otro mensaje del pedido.

Al principio tres mutaciones no fallaban: dos revisiones de estado se tapaban
entre sí y el HTML de la prueba decía lo mismo que el texto plano. Se
corrigieron las pruebas antes de abrir la PR.
