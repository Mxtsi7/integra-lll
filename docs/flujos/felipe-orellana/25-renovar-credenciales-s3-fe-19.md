# S3-FE-19 — Renovar credenciales vencidas y pedir reconexión

**Qué hace.** Renueva el token de acceso de una cuenta de correo cuando vence
o cuando el proveedor lo rechaza. Si la autorización ya no sirve, deja la
cuenta en `requiere_reautorizacion` con un motivo para la persona y **deja de
pedirle cosas al proveedor** hasta que el usuario reconecte.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Una credencial revocada no entra en bucle | después de marcada, ni el refresco ni el lector hablan con el proveedor: 5 lecturas seguidas hacen **1** refresco y **0** lecturas |
| La API informa a la interfaz y no revela tokens | el listado `GET /api/conectores/` ya trae `estado`, `necesita_reautorizacion` y `detalle_del_estado`; la prueba revisa que no salga ningún token en la respuesta |

## El recorrido

```
leer_con_renovacion(lector_gmail | lector_outlook, organizacion_id, cuenta_id, …)
  │
  ├─ 1. token_vigente: si le quedan menos de 5 minutos, se refresca
  ├─ 2. se lee
  ├─ 3. 401 → se refresca UNA vez y se lee UNA vez más
  └─ 4. otro 401, invalid_grant al refrescar, o 403 de permisos
        → requiere_reautorizacion + CuentaNoDisponible(requiere_reautorizacion)
```

Los lectores (documentos 23 y 24) siguen sin renovar nada: con el token
vencido responden `credencial_vencida` y con un 401, `AutorizacionRechazada`.
Este módulo es el que decide.

## Qué marca la cuenta y qué no

| Lo que pasó | Qué se hace |
|---|---|
| `invalid_grant` al refrescar (el usuario revocó, venció, cambió la contraseña) | se marca: «Gmail ya no acepta la autorización de esta cuenta: hay que volver a conectar la cuenta.» |
| 401 aun con el token recién renovado | se marca |
| 403 de permisos (el usuario no dio el permiso de lectura) | se marca **sin refrescar**: un token nuevo trae los mismos permisos |
| el token venció y no hay token de refresco | se marca, sin pedir nada |
| red, 429 o 5xx al refrescar | **no** se marca: `ErrorTransitorio` (`refresco_no_disponible`) para S3-FE-18 |
| `invalid_client` (Google) o `unauthorized_client` (Microsoft) | **no** se marca: `ErrorDelProveedor` (`refresco_rechazado_por_configuracion`) |

La última fila importa. Es lo que responden Google y Microsoft cuando lo que
está mal es **nuestro** cliente OAuth (copiado de lo que contestaron a un
cliente inventado). Si se tratara como `invalid_grant`, un error de
configuración dejaría a todos los usuarios pidiendo reconexión, y ellos no lo
pueden arreglar.

La marca es condicional: solo si la cuenta sigue `conectada`, es de la misma
organización y tiene las **mismas credenciales** (`credenciales_version`). Si
el usuario reconectó mientras tanto, esas credenciales nuevas no se marcan.

## Por qué el refresco no sube `credenciales_version`

La versión dice «llegó una autorización nueva» y la sube el callback de OAuth.
Un refresco no es una autorización nueva: el token de refresco de Google sigue
siendo el mismo, y revocarlo sigue revocando la concesión.

Si el refresco la subiera, pasaría esto: el usuario pide desconectar, la
revocación lee la versión y habla con Google, mientras tanto un worker
refresca y sube la versión, y la escritura condicional de la revocación no
encuentra la fila. La cuenta quedaría **conectada**, que es lo contrario de lo
que el usuario pidió.

## Dos workers a la vez

El refresco toma la fila con `select_for_update` y vuelve a mirar el
vencimiento con el candado ya tomado. Si otro worker refrescó mientras tanto,
el segundo ve el token nuevo y no refresca.

Importa con Microsoft, que **rota** el token de refresco: refrescar dos veces
con el mismo puede terminar en `invalid_grant` y en una reconexión que nadie
necesitaba. Está probado con dos conexiones a PostgreSQL
(`test_carrera_renovacion_postgres.py`): sin el `select_for_update`, la prueba
falla porque el segundo refresca sin esperar.

El candado se mantiene mientras se habla con el proveedor (10 segundos como
mucho). Es una fila por cuenta y solo cuando hay que refrescar.

## Lo que se guarda

- `access_token` y `token_expira_en` = ahora + `expires_in`. Si el proveedor
  no dice cuánto dura, se supone una hora: suponer «para siempre» dejaría de
  refrescar.
- `refresh_token` solo si vino uno nuevo (Microsoft rota; Google no). Si no
  viene, se conserva el que había.
- `detalle_del_estado` vacío.

## Los comandos

`leer_gmail` y `leer_outlook` ahora leen con renovación, así que la prueba con
una cuenta real ya no tiene que hacerse antes de que pase una hora desde que
se conectó.

## Dónde está

| Pieza | Archivo |
|---|---|
| Renovar y marcar | `services/connectors/connectors/renovacion.py` |
| El refresco contra el proveedor | `proveedores.refrescar_token` |
| Las pruebas | `tests/test_renovacion_s3_fe_19.py` (34) y `tests/test_carrera_renovacion_postgres.py` (1) |

## Cómo se comprobaron las pruebas

`invalid_client` de Google, `unauthorized_client` de Microsoft y el 401 de
Gmail son **copia literal** de las respuestas reales. `invalid_grant` y el 200
del refresco siguen el RFC 6749 y la documentación de cada proveedor: para
provocarlos hace falta un cliente y una cuenta reales.

Se rompió el código a propósito 23 veces y cada vez falló al menos una prueba.
Entre otras:

- refrescar siempre o nunca, o sin margen;
- refrescar una cuenta no conectada o de otra organización;
- no marcar con `invalid_grant`;
- marcar sin mirar la versión o la organización;
- pisar el token de refresco con vacío o no guardar el rotado;
- subir la versión al refrescar;
- tratar un fallo transitorio como de configuración;
- refrescar ante un 403;
- no reintentar tras el 401;
- tratar `invalid_client` como `invalid_grant`;
- no mandar los scopes a Microsoft, o mandarlos a Google.

Al principio una no fallaba: el filtro por organización de la marca, que el
lector ya cubría antes. Se dejó como defensa y se agregó una prueba que lo
llama directo.
