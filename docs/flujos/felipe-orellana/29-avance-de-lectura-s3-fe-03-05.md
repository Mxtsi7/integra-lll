# S3-FE-03 y S3-FE-05 — Guardar hasta dónde se leyó cada cuenta de correo

**Qué hace.** Lee una cuenta de correo **una página a la vez**, le entrega
cada página a quien la procesa y, solo si eso terminó bien, guarda hasta
dónde llegó. Es lo mismo para Gmail (FE-03) y Outlook (FE-05): lo que cambia
entre los dos (un `pageToken` o una `@odata.nextLink`) lo resuelve cada
lector (documentos 23 y 24).

| Criterio | Dónde se cumple |
|---|---|
| FE-03: reanudar no relee indefinidamente ni pierde mensajes tras un fallo | corridas con tope fijo, y el cursor se mueve en la misma transacción que procesa |
| FE-03: cuentas distintas conservan cursores separados | un `AvanceDeLectura` por cuenta (uno a uno) |
| FE-05: reiniciar retoma el avance correcto | se retoma desde la última página guardada |
| FE-05: un cursor inválido no elimina evidencia ni provoca duplicados | si el proveedor lo rechaza explícitamente, la corrida vuelve a su primera página sin borrar nada y lo releído trae la misma identidad (Message-ID); cualquier otro error sale con el avance intacto |

```
leer_siguiente_lote(lector_gmail | lector_outlook, organizacion_id, cuenta_id, procesar)
```

## Corridas y marca de agua

Los proveedores listan **del más nuevo al más viejo**. Si la marca avanzara
con cada página, un fallo a mitad de camino dejaría sin leer lo que quedaba
más atrás. Por eso la lectura va en **corridas**:

1. Una corrida nueva fija su tope: `corrida_hasta` = ahora. Cubre lo recibido
   entre `leido_hasta` (menos 10 minutos de solape) y ese tope. La primera
   corrida de una cuenta mira 90 días hacia atrás, no el buzón entero.
2. Cada página procesada guarda la siguiente en `pagina`.
3. Cuando no hay más páginas, la corrida termina: `leido_hasta` pasa a ser
   **el tope** (no el momento en que terminó, que dejaría un hueco), y
   `pagina` se limpia.

Reanudar después de un fallo retoma desde la última página guardada: no se
pierde nada. Y como el tope no se mueve durante la corrida, no se relee para
siempre: lo que llegue mientras tanto es de la próxima.

El solape existe porque Gmail filtra por segundos. Releer unos pocos correos
del borde es mejor que perder uno; la llave única de candidatos no los
duplica.

## Sin página siguiente tiene que querer decir «se leyó todo»

La marca avanza cuando el lector dice que no hay más páginas. Eso vale solo
si ningún lector puede terminar antes **sin avisar**. La revisión de #189
(P1) encontró que Outlook sí podía: buscaba las palabras de cobro con
`$search`, que Graph corta en 1000 resultados ordenados por fecha de
**envío**. Con 1001 cobros en los 90 días de la primera corrida, la lista
terminaba sin `@odata.nextLink`, la marca avanzaba al tope y lo que faltaba
quedaba atrás, fuera del solape de 10 minutos: perdido para siempre.

Ahora:

- **Outlook enumera la ventana por fecha**: `$filter` por
  `receivedDateTime` y `$orderby`, que Graph pagina sin tope, y las palabras
  y los remitentes se aplican de este lado (`FiltroCorreos.coincide`). El
  detalle está en el documento 24.
- **Gmail no recorta**: si devuelve más mensajes de los pedidos es un error,
  no un recorte callado (el `nextPageToken` ya apuntaba después de los que
  sobraban). Su búsqueda `q` filtra del lado de Google y pagina sin tope
  documentado.
- **Un corte a mitad de camino** (un error, un 503) deja la marca donde
  estaba y la página guardada: se retoma desde ahí.

La prueba de aceptación es la que pidió la revisión: más de 1000 cobros en
la ventana, fechas de envío desordenadas respecto de las de recepción,
correos fuera de la ventana y que no son cobros, contra un Graph falso que
respeta el tope de `$search`. Todos los elegibles se entregan antes de que la
marca avance, y ninguno dos veces. Con el lector anterior faltaban 192.

**Lo que esto no cubre** (riesgo inferido de cómo pagina Graph, no
reproducido): la `@odata.nextLink` de la lista de mensajes avanza con
`$skip`. Si durante una corrida se borra **definitivamente** un correo de la
ventana que ya se leyó (vaciar «Elementos eliminados»), los que siguen se
corren un lugar y el del borde de la página puede quedar sin leer. Moverlo de
carpeta no lo corre: la lista es de todo el buzón. Cerrarlo pide paginar por
fecha en vez de por posición, o la consulta delta de Graph; queda anotado
como pendiente.

## Procesar y mover el cursor, juntos

`procesar(pagina)` corre **dentro** de la transacción que mueve el cursor. Si
falla, la transacción se revierte, el cursor no se mueve y la próxima vez se
lee la misma página. El cursor nunca queda por delante de lo procesado.

## Una página que el proveedor ya no acepta (FE-05)

Un `pageToken` o una `@odata.nextLink` pueden vencer. Si el proveedor la
**rechaza explícitamente**, el lector levanta `CursorRechazado` (código
`cursor_rechazado`, en `lectura_correo.py`, hija de `ErrorDelProveedor`) y la
corrida vuelve a su **primera página, con el mismo tope**:

- no se borra nada: el avance solo sube `reinicios_por_pagina_invalida`;
- se releen mensajes ya vistos, pero con la **misma identidad** (el
  Message-ID, S3-FE-06), que es la llave única de los candidatos: no se
  duplican;
- si no había página guardada, el error no es del cursor y sale tal cual.

Qué cuenta como rechazo explícito: la petición llevaba el cursor y el
proveedor la rechazó como mal hecha. Lo único que cambia entre esa petición
y la primera página, que el proveedor sí aceptó, es el cursor.

| Proveedor | Rechazo del cursor |
|---|---|
| Gmail | 400 a `messages.list` con `pageToken` |
| Outlook | 400 o 410 al seguir una `@odata.nextLink` |

**Todo lo demás sale tal cual, con el avance intacto y sin contar un
reinicio**: un JSON ilegible, una lista mal formada, el detalle de un mensaje
que no se pudo leer, la API sin habilitar, una página que el propio lector no
reconoce (`ValueError`). Antes se reiniciaba con cualquier
`ErrorDelProveedor` o `ValueError`. La revisión de #189 (P2) mostró el
problema: con una página B válida que fallaba por otra cosa, se procesaba de
nuevo la primera, se volvía a guardar B y la llamada respondía éxito; la
siguiente hacía lo mismo, para siempre, sin que nadie viera el error.

Y si al reiniciar el proveedor entrega como página siguiente **la misma que
acaba de rechazar**, reiniciar no lleva a ninguna parte: no se procesa ni se
guarda nada y sale `ErrorDelProveedor` con código `reinicio_sin_avance`.

## Dos workers con la misma cuenta

El cursor se lee al empezar y se vuelve a mirar, con la fila tomada, antes
de procesar. Si otro worker lo movió mientras tanto, esta página ya no es la
que toca: no se procesa nada y el resultado dice `descartado`.

## Lo que no hace todavía

- **Reintentar con espera** un error transitorio: es S3-FE-18. Hoy el error
  sale con el cursor intacto.
- **Dejar de leer una cuenta que se desconecta a mitad de camino**: es
  S3-FE-20. Hoy el lector la rechaza en la siguiente página.
- **Guardar los candidatos**: `procesar` es de S3-FE-09.

## Dónde está

| Pieza | Archivo |
|---|---|
| El avance | `services/connectors/connectors/avance_lectura.py` |
| El modelo | `AvanceDeLectura` en `models.py`, migración `0010_avance_de_lectura` |
| Borrarlo con la organización | `eliminacion.py`, antes que la cuenta |
| Las pruebas | `services/connectors/tests/test_avance_lectura_s3_fe_03_05.py` (19) |

## Cómo se comprobaron las pruebas

Las pruebas usan un lector de prueba con páginas programadas para el cursor,
y los lectores **reales** de Gmail y Outlook (con `requests` reemplazado)
para ver que el `pageToken` y la `@odata.nextLink` se guardan y se mandan, y
que una `nextLink` vencida (400 de Graph) reinicia la corrida.

Se rompió el código a propósito 15 veces y cada vez falló al menos una
prueba:

- mover la marca con cada página, o ponerle el momento en que terminó;
- quitar el solape o la ventana inicial;
- mover el tope dentro de la corrida;
- procesar fuera de la transacción, o guardar antes de procesar;
- no comparar el cursor;
- no reiniciar, o reiniciar sin página guardada;
- no contar el reinicio;
- no limpiar la página al terminar;
- no contar la corrida;
- buscar la cuenta sin la organización;
- no pasar el límite.
