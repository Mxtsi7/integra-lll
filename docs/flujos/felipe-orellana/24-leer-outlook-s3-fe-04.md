# S3-FE-04 — Consultar los mensajes autorizados de Outlook

**Qué hace.** Lo mismo que S3-FE-02 para Gmail (documento 23), pero contra
Microsoft Graph: lee una página de mensajes de una cuenta de Outlook conectada,
en memoria, sin guardar nada ni cambiar la cuenta.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| La lectura usa la cuenta correcta | `cuenta_para_leer` con el proveedor Outlook: la de otra organización, una de Gmail con ese identificador, una desconectada o con el token vencido no se leen, y no se hace ni una petición |
| Maneja páginas adicionales y el rechazo de autorización de forma explícita | la `@odata.nextLink` se devuelve y se acepta solo si es de Graph; 401 y 403 son `AutorizacionRechazada` con su código |

Lo que tiene que decir lo mismo que Gmail —qué cuenta se puede leer, los
tipos que se devuelven, los errores, el filtro y el HTML a texto— vive en
`lectura_correo.py` y se separó en la PR de S3-FE-02. Aquí queda lo de
Microsoft.

## En qué se distingue de Gmail

| | Gmail | Outlook |
|---|---|---|
| Peticiones por página | 1 + una por mensaje | **1**: el cuerpo viene en la lista |
| Página siguiente | un token corto (`pageToken`) | **una URL completa** (`@odata.nextLink`) |
| Búsqueda | `q`, con fechas exactas | `$search` para palabras y remitentes; las fechas, aparte |
| Cuerpo | partes MIME | `body`, pedido en texto (`Prefer: outlook.body-content-type="text"`) |

## La página siguiente es una URL, y lleva el token

Microsoft pide usar la `@odata.nextLink` **tal cual**, sin sacarle el `$skip`.
Esa URL se pide con el token de la cuenta, así que si una `pagina` pudiera
apuntar a cualquier lado, quien la ponga se llevaría el token a su servidor.

Por eso `es_pagina_de_graph` exige, parte por parte:

- esquema `https`;
- `netloc` **exactamente** `graph.microsoft.com`: sin usuario
  (`algo@graph.microsoft.com`), sin puerto, y sin trucos como
  `graph.microsoft.com.otro.sitio`, que pasarían una comparación por prefijo;
- ruta **exactamente** `/v1.0/me/messages`, sin `..` ni otra versión;
- sin fragmento, sin espacios y de 4.096 caracteres como mucho.

Se valida la que entra **y la que devuelve Graph**: no se entrega una página
que la llamada siguiente rechazaría. Además, `allow_redirects=False`: una
redirección mandaría el token adonde diga la respuesta.

## Filtros

Graph no acepta `$search` junto con `$orderby`, y la búsqueda por palabras
ordena por fecha de envío y no entiende de horas. Por eso hay dos caminos:

- **Con palabras de cobro o remitentes** (lo normal): van en `$search`, como
  `"(recibo OR factura OR …) AND (from:netflix.com)"`. Las fechas se aplican
  **de este lado** con `FiltroCorreos.admite`, a la hora exacta.
- **Sin palabras ni remitentes**: las fechas van en `$filter`
  (`receivedDateTime ge … and receivedDateTime lt …`, en UTC) y el orden en
  `$orderby`, que Graph resuelve exacto. Lo que va en `$orderby` aparece antes
  en `$filter`, como exige Graph; si no, responde `InefficientFilter`.

Un mensaje que queda fuera del rango de fechas **no** va a `omitidos`: no es
un problema, es el filtro. Si se pasa `pagina`, hay que pasar el mismo filtro,
porque es el que se usa para descartar fechas.

## Lo que responde Graph

| Respuesta | Excepción | `codigo` |
|---|---|---|
| 401 | `AutorizacionRechazada` | `autorizacion_rechazada` |
| 403 | `AutorizacionRechazada` | `permiso_insuficiente` |
| 404 `MailboxNotEnabledForRESTAPI` / `ResourceNotFound` | `ErrorDelProveedor` | `buzon_no_disponible` (una cuenta sin buzón de Outlook) |
| 429 | `ErrorTransitorio` | `cuota_excedida`, con `reintentar_en` si vino `Retry-After` |
| 5xx | `ErrorTransitorio` | `falla_del_proveedor` |
| sin red / tiempo agotado | `ErrorTransitorio` | `sin_conexion` / `tiempo_agotado` |
| 400 u otra cosa | `ErrorDelProveedor` | `error_del_proveedor` |

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
mensajes. La página siguiente es una URL y va entre comillas.

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
| Las pruebas | `services/connectors/tests/test_lector_outlook.py` (85) |

## Cómo se comprobaron las pruebas

Los dos 401 son **copia literal** de lo que respondió `graph.microsoft.com` a
un token ilegible y a una petición sin token. La forma de la lista y de cada
mensaje sigue la referencia publicada de "List messages"; se va a contrastar
en la corrida real.

Se rompió el código a propósito 37 veces y cada vez falló al menos una prueba:
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
