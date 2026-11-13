# S3-FE-06 — El servicio y el identificador de origen de cada mensaje

**Qué hace.** De cada `MensajeCorreo` que entregan los lectores (documentos 23
y 24) saca dos cosas, sin guardar nada:

- `identificador_origen`: quién es este mensaje, estable;
- `servicio`: de qué servicio habla, con el catálogo de FE-12, sin asignarlo a
  la fuerza.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Dos mensajes distintos conservan identidad distinta | `identificador_de`: Message-ID distinto → identidad distinta. Sin Message-ID, la identidad se arma con el buzón y no choca entre cuentas ni entre proveedores |
| Un proveedor desconocido no se asigna arbitrariamente | `servicio_de`: el asunto solo decide si el remitente no puede, y nunca contra el remitente |

## La identidad: el Message-ID

El contrato común de candidatos (S3-FE-01) dice que en correo el identificador
es el **Message-ID**. Es mejor que el `id` de cada proveedor:

- no cambia si el usuario mueve el correo de carpeta;
- es el mismo en Gmail y en Outlook;
- un recibo que llega con copia a dos cuentas de la **misma** organización es
  un solo correo y un solo cobro, y así queda.

Se guarda como `mid:` + sha256 del Message-ID. El hash no es para esconderlo
(va entero en la evidencia, S3-FE-09): es para que entre siempre en los 200
caracteres del campo, porque un Message-ID puede llegar a 998.

No se pasa a minúsculas: la parte izquierda distingue mayúsculas, y dos
correos distintos no pueden terminar con la misma identidad por normalizar de
más.

Si el correo no trae un Message-ID usable (vacío, sin `@`, con espacios), se
usa el del proveedor, que solo es único **dentro de un buzón**:
`gmail:` u `outlook:` + sha256(cuenta, id). Así el mismo `id` en dos buzones
son dos mensajes, y el respaldo nunca choca con un `mid:`.

### Lo que cambió en los lectores

- Los dos llenan `message_id` y `proveedor_correo` en `MensajeCorreo`.
- Gmail lo saca de la cabecera `Message-ID`.
- Outlook pide `internetMessageId` en el `$select`, y además
  `Prefer: IdType="ImmutableId"`. Sin eso, el `id` de un mensaje de Outlook
  **cambia si el usuario lo mueve de carpeta**, y el respaldo dejaría de ser
  estable.

## El servicio: no se asigna a la fuerza

Se mira el **nombre** del remitente, su **dominio** y el **asunto**, cada uno
con `normalizar` (FE-12). Los resultados de esta tabla salen de correr el
normalizador de verdad sobre estos textos:

| Remitente | Asunto | Resultado | Por qué |
|---|---|---|---|
| Netflix `<info@account.netflix.com>` | Tu recibo | **Netflix** | lo dice el remitente |
| Facturación `<billing@spotify.com>` | Tu recibo | **Spotify** | lo dice el dominio |
| PayPal `<service@paypal.com>` | Recibo de tu pago a Spotify AB | **Spotify** | intermediario de pago: el servicio está en el asunto |
| Microsoft `<billing@microsoft.com>` | Tu factura de Microsoft 365 | **Microsoft 365** | el remitente es ambiguo y el asunto lo resuelve |
| Apple `<no_reply@email.apple.com>` | Tu recibo de Apple | ambiguo: Apple Music, Apple TV+, iCloud | nadie lo resuelve |
| Apple | Recibo de Netflix | ambiguo: los tres de Apple + Netflix | Apple también cobra suscripciones ajenas |
| Netflix | Tu pago de Spotify | ambiguo: Netflix, Spotify | remitente y asunto no coinciden |
| Falabella `<ofertas@falabella.com>` | Gana Netflix gratis con tu tarjeta | ambiguo: Netflix (sugerencia) | **el asunto no decide** si el remitente no es del servicio ni un intermediario |
| Juan `<juan@empresa.cl>` | hola | desconocido | nada reconoce |

La fila de Falabella es la que obligó a la regla. La primera versión dejaba que
el asunto decidiera siempre que el remitente no reconociera nada, y una
promoción de una tienda quedaba asignada a Netflix. Ahora queda como
sugerencia (un ambiguo con un solo candidato) para que una persona lo vea.
Distinguir un recibo de una promoción es de S3-FE-08.

Los intermediarios de pago son los de `normalizacion.INTERMEDIARIOS` sin las
siglas cortas (`pp`, `dl`, `mp`), y se comparan como **palabra entera**: `flow`
es un intermediario, `overflow` no.

`fuente` dice de dónde salió el servicio (`nombre del remitente`,
`dominio del remitente`, `asunto`, o vacío si no se decidió), y
`servicio.regla` lo explica con palabras.

## Dónde está

| Pieza | Archivo |
|---|---|
| Identidad y servicio | `services/connectors/connectors/origen_correo.py` |
| `normalizar_message_id` y los campos nuevos de `MensajeCorreo` | `services/connectors/connectors/lectura_correo.py` |
| Las pruebas | `services/connectors/tests/test_origen_correo_s3_fe_06.py` (39) |

## Cómo se comprobaron las pruebas

Se rompió el código a propósito 22 veces y cada vez falló al menos una prueba:
usar siempre el id del proveedor, el respaldo sin la cuenta o sin el
proveedor o con el mismo prefijo que el Message-ID, guardar el Message-ID sin
hash, inventar una identidad sin datos, dejar que el asunto gane en un
desacuerdo o decida con un remitente desconocido, que un intermediario no
ceda, comparar intermediarios por subcadena o sin pasar a minúsculas, mirar el
dominio antes que el nombre o no mirarlo, pasar el Message-ID a minúsculas,
aceptarlo sin `@`, con espacios o de cualquier largo, que Gmail no lea la
cabecera, que Outlook no pida `internetMessageId` o no pida `ImmutableId`.

Al principio una no fallaba: «PayPal» también calzaba por el dominio. Se
agregó el caso de un intermediario que escribe desde un servicio de correo
masivo, donde solo el nombre lo delata.
