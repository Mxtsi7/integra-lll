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
| FE-05: un cursor inválido no elimina evidencia ni provoca duplicados | la corrida vuelve a su primera página sin borrar nada; lo releído trae la misma identidad (Message-ID) |

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

## Procesar y mover el cursor, juntos

`procesar(pagina)` corre **dentro** de la transacción que mueve el cursor. Si
falla, la transacción se revierte, el cursor no se mueve y la próxima vez se
lee la misma página. El cursor nunca queda por delante de lo procesado.

## Una página que el proveedor ya no acepta (FE-05)

Un `pageToken` o una `@odata.nextLink` pueden vencer. Si el proveedor la
rechaza (`ErrorDelProveedor`), o si ya no tiene forma de página de ese
proveedor (`ValueError` del lector), la corrida vuelve a su **primera
página, con el mismo tope**:

- no se borra nada: el avance solo sube `reinicios_por_pagina_invalida`;
- se releen mensajes ya vistos, pero con la **misma identidad** (el
  Message-ID, S3-FE-06), que es la llave única de los candidatos: no se
  duplican;
- si no había página guardada, el error no es del cursor y sale tal cual.

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
