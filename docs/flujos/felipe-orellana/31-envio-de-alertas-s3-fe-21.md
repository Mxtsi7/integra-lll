# S3-FE-21 — Mandar las alertas y anotar entrega o error

**Qué hace.** Cada alerta nueva deja una **entrega** por persona y canal
externo que la quiere, y `despachar_alertas` las manda por correo. Cada
entrega termina con la **evidencia del proveedor** o con un **error con
código**. Crear la fila, diferirla o reclamarla no la da por entregada.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Una entrega tiene evidencia del proveedor o error explícito | `aceptada` lleva `aceptada_en` y `evidencia` (Message-ID y backend). `fallida`, `agotada` y `reintento` llevan `codigo_error` y `detalle_error` |
| No se declara entregada solo por encolarla | nace `pendiente`; pasa a `aceptada` solo si el backend de correo devolvió 1 sin excepción, que con SMTP significa un 250 del servidor |
| Reintentos controlados | 5 intentos con espera de 1 min, 5 min, 30 min y 2 h; solo errores transitorios; después, `agotada` |
| Preferencias, cuota y descanso | se planifica con las preferencias de FE-21 y se vuelven a mirar al mandar; descanso de 22:00 a 08:00 y 2 por día para push (RN-08 y RN-09) |

## El canal acordado

Es el **correo**. Lo que lo respalda:

- **RF-09** (`docs/investigacion/requisitos-vigentes.md`): «El correo siempre
  está disponible como canal; el push es adicional en el móvil. Si no hay
  dispositivo con push, la alerta se envía igual por correo».
- **FE-21** dejó `CANALES_HABILITADOS` en `email` e `in_app` por omisión.
- **`.env.example`** ya tiene la sección «Correo (servicios auth y
  notifications)».
- **ADR-006** dice que notifications maneja dos canales de salida, correo y
  push, y que el push nunca es el único.

Se manda con el backend de correo de Django y **las mismas variables que usa
auth** para recuperar la contraseña: `EMAIL_BACKEND`, `EMAIL_HOST`,
`EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`,
`EMAIL_USE_SSL`, `EMAIL_TIMEOUT` y `DEFAULT_FROM_EMAIL`, con los mismos
valores por omisión. No hay variables nuevas.

**El push no tiene proveedor.** ADR-006 lo acordó con el servicio de
notificaciones de Expo, pero no hay credenciales ni registro de dispositivos.
Una entrega por push termina `fallida` con `canal_no_disponible`, aunque
`CANALES_HABILITADOS` incluya `push`. No se simula: un push "enviado" sin
proveedor sería declarar entregado algo que no salió.

## El recorrido

```
generar_alertas ── crea la alerta ──▶ planificar(): una EntregaAlerta por
                   (misma transacción)  persona y canal externo encendido
                                                   │ pendiente
despachar_alertas ─▶ elegibles ─▶ reclamar() ── transacción corta, bajo bloqueo ──┐
                                  1. bloquea la preferencia de la persona         │
                                  2. relee la entrega con el filtro de elegibles  │
                                  3. ¿sigue queriéndola? ¿canal disponible?       │
                                  4. ¿descanso? ¿cuota?          ──▶ diferida     │
                                  5. ¿dirección?                 ──▶ fallida      │
                                  6. enviando + reclamo_id + reclamada_hasta ◀────┘
                                                   │ commit
                                  canal.enviar() ── fuera de la transacción
                                                   │
                     aceptada ◀── anotar() si el reclamo sigue siendo el mismo ──▶ reintento · fallida · agotada
```

**A quién.** A cada persona con una `PreferenciaNotificacion` en la
organización que quiere ese tipo de aviso, una fila por canal externo
encendido (`por_email`, `por_push`). `en_la_app` no tiene fila: la alerta
misma es esa entrega (FE-19). Una organización que nunca guardó preferencias
ve la alerta en la aplicación (el generador usa las de omisión), pero no
tiene ninguna persona a quien escribirle.

**Las preferencias se miran dos veces**: al planificar y al mandar. Si la
persona apagó el canal o el tipo entre medio, la entrega queda `descartada`
con `motivo = preferencia_apagada` y no sale. Si apagó el correo, no se le
manda correo aunque el push no esté disponible: la preferencia manda (ver las
decisiones).

## Los estados

| Estado | Qué significa | ¿Se vuelve a intentar? |
|---|---|---|
| `pendiente` | Planificada, nunca intentada | sí, desde `proximo_intento_en` |
| `enviando` | Un worker la reclamó y está hablando con el proveedor | solo si el reclamo vence |
| `aceptada` | El proveedor la aceptó: hay evidencia | no |
| `diferida` | Descanso o cuota; `motivo` dice cuál | sí, en `proximo_intento_en` |
| `reintento` | Error transitorio; espera progresiva | sí, en `proximo_intento_en` |
| `fallida` | Error permanente | no |
| `agotada` | Se acabaron los 5 intentos | no |
| `descartada` | Ya no corresponde (preferencia apagada o borrada) | no |

`intentos` cuenta solo las veces que se habló con el proveedor: diferir no
gasta un intento, y fallar por falta de dirección tampoco.

## Errores

| Qué pasó | Código | Clase |
|---|---|---|
| 250 al mensaje | — | `aceptada` |
| Destinatario rechazado con 5xx (`550 5.1.1`) | `smtp_550` | permanente |
| Mensaje rechazado con 5xx (`554 5.6.0`) | `smtp_554` | permanente |
| Destinatario o mensaje con 4xx (`451`, `452`) | `smtp_451`, `smtp_452` | transitorio |
| Remitente rechazado, autenticación, saludo | `smtp_553`, `smtp_535`… | transitorio |
| Conexión rechazada, corte, sin respuesta | `conexion` | transitorio |
| Tiempo agotado al conectar | `tiempo_agotado` | transitorio |
| El backend no confirmó (devolvió 0) | `sin_confirmacion` | transitorio |
| Un error que el canal no supo clasificar | `inesperado` (con el tipo) | transitorio |
| Sin dirección conocida | `sin_direccion` | permanente, sin intento |
| Dirección guardada que no es un correo | `direccion_invalida` | permanente, sin intento |
| Canal sin proveedor o deshabilitado | `canal_no_disponible` | permanente, sin intento |

Permanente es solo lo que dice algo **del destinatario o del mensaje** con un
5xx: mandarlo igual otra vez da lo mismo. Remitente y autenticación también
pueden venir con 5xx, pero son de nuestra configuración y se arreglan sin
tocar el mensaje, así que se reintentan.

Un corte o un silencio **después** de mandar el mensaje no se da por
entregado ni por perdido: el servidor pudo haberlo procesado. Va a
`reintento`, y el reintento lleva **el mismo Message-ID**, que es la clave de
idempotencia del canal que pide MX-21 para las entregas externas. `smtplib`
convierte el tiempo agotado esperando una respuesta en
`SMTPServerDisconnected`, así que ese caso sale como `conexion` con
`timed out` en el detalle.

`detalle_error` guarda la respuesta del servidor, recortada a 300
caracteres. En los logs y en la salida del comando va solo el id de la
entrega, el canal y el código: ni la dirección ni el contenido.

## Reintentos

Después de cada fallo transitorio se espera 1 min, 5 min, 30 min y 2 h
(`ESPERAS_REINTENTO`). El quinto fallo deja la entrega `agotada`. Son unas
2 h 36 min, más lo que tarde en pasar el despachador.

**Un worker que muere** deja la entrega en `enviando`. El reclamo dura 5
minutos (`DURACION_RECLAMO`, mucho más que `EMAIL_TIMEOUT`); al vencer, otro
worker la retoma con el mismo Message-ID y suma un intento. Si ya iba en el
quinto, queda `agotada` con `sin_resultado`. El resultado de un reclamo
vencido no pisa el del que lo retomó: `anotar()` es un UPDATE condicionado a
`reclamo_id`, y si no coincide devuelve `tardia` sin tocar nada.

**Lo que no se garantiza** es exactamente una entrega. Si el worker muere
después del 250 y antes de anotarlo, el correo sale dos veces con el mismo
Message-ID. Muchos buzones descartan el repetido, pero no todos.

## Descanso y cuota

Salen de RN-08 y RN-09 (`docs/historico/REGLAS-DE-NEGOCIO.md`), que hablan
**solo de push**:

- RN-09: no se mandan push entre las **22:00 y las 08:00**; lo que cae en esa
  franja sale a las **09:00**.
- RN-08: máximo **2 push por persona y día**. La tercera se difiere al día
  siguiente a las 09:00. No se pierde.

El correo no tiene franja ni cuota: ninguna regla se la fija. Están en
`politica_envio.POR_CANAL`, y cambiarlas es cambiar esa tabla.

- La franja cruza la medianoche: 22:00 entra, 08:00 ya no.
- El día de la cuota es el **día local**. A las 21:30 en Santiago ya es el día
  siguiente en UTC; contar por día UTC dejaría salir una tercera ese mismo
  día. Es el criterio de FE-22: «cambio de día no reinicia incorrectamente el
  contador».
- Cuentan las aceptadas del día y las que están `enviando` con reclamo
  vigente, porque todavía no se sabe si salen. Un reclamo vencido no cuenta.
- La zona es la del servicio, `America/Santiago`: ningún modelo guarda la de
  cada persona. Va en `entregas.zona_de()` para que FE-22 la cambie en un
  solo lugar.

Como el push no tiene proveedor, esta parte se prueba con `DobleDePush`, un
doble declarado como tal en las pruebas.

## Dos workers a la vez

`reclamar()` bloquea primero la **fila de preferencias de la persona** y
después la **entrega**, releída con el filtro de elegibles. Así:

- dos workers con la misma entrega: el segundo espera al primero y, cuando
  entra, la entrega ya está `enviando` y no es elegible. Sale un correo;
- dos workers con dos entregas de la misma persona: el segundo espera y
  cuenta para la cuota también la que está `enviando`;
- un resultado tardío de un reclamo vencido espera al worker que la está
  retomando y, cuando entra, el reclamo ya no es el suyo: no se anota;
- el envío va **después** del commit: un servidor lento no deja filas
  bloqueadas.

Las dos limpiezas (la de la organización y la de la persona) borran
preferencias antes que entregas, el mismo orden que el despachador. Con el
orden contrario, una limpieza y un reclamo de la misma persona se esperan el
uno al otro y PostgreSQL corta uno por interbloqueo: lo comprobaron dos de
las mutaciones.

## Qué es doble y qué sería entrega real

| En las pruebas | Qué es | Qué acredita |
|---|---|---|
| backend `locmem` | buzón de Django en memoria; no entrega nada | qué se manda y qué se anota. La evidencia lo dice: `backend = …locmem.EmailBackend` |
| `ServidorSMTP` (`tests/smtp_de_prueba.py`) | servidor SMTP local que responde lo que se le pida | el backend SMTP real y `smtplib` frente a 250, 550, 451, 554, 452, 553, un corte, un silencio y un puerto cerrado |
| `DobleDePush` | doble de push declarado como tal | la política de descanso y cuota |

**Entrega real** es el backend SMTP con las credenciales del Gmail
provisorio que usa auth en producción. **No se mandó ningún correo real** en
esta tarea. Para hacerlo hace falta una dirección en `DireccionCorreo`, que
hoy nadie llena (ver lo que falta).

## Lo que se guarda

| Tabla | Qué | Se borra con |
|---|---|---|
| `entrega_alerta` | una fila por (alerta, persona, canal): estado, intentos, espera, reclamo, `destino`, `message_id`, evidencia y último error | la organización, la persona y la alerta |
| `direccion_correo` | (organización, persona) → correo | la organización y la persona |

`destino` guarda la dirección del último intento. Es dato personal, y por eso
la limpieza de la persona se lleva sus entregas además de sus preferencias.
Migración `0008_entregas_de_alertas`. No agrega índices: la selección del
despachador filtra por `estado` y `proximo_intento_en`, y un índice se
justifica con un plan sobre datos reales, que todavía no hay.

## El comando

```bash
python manage.py despachar_alertas                 # con el reloj real, hasta 200
python manage.py despachar_alertas --limite 50
python manage.py despachar_alertas --ahora 2026-11-21T23:00:00-03:00
```

```
2026-11-21 10:00 -03: 1 aceptada(s) por el proveedor, 1 fallida(s).
  · entrega 5b1c…  [email] fallida: sin_direccion (intento 0)
```

Las agotadas también van a stderr. `--ahora` se entiende igual que en
`generar_alertas`: la lectura quedó en `notifications/reloj.py` para los dos.
Hoy no lo programa nadie, ni en el compose ni en el clúster (ver lo que
falta).

## Dónde está

| Pieza | Archivo |
|---|---|
| Modelos y migración | `services/notifications/notifications/models.py` → `EntregaAlerta`, `DireccionCorreo`; `migrations/0008_entregas_de_alertas.py` |
| Planificar, reclamar, anotar y despachar | `notifications/entregas.py` |
| El canal de correo y la clasificación SMTP | `notifications/canales.py` |
| Descanso y cuota, sin base ni reloj | `notifications/politica_envio.py` |
| Las entregas nacen con la alerta | `notifications/generador.py` → `_crear_una_vez` |
| Las limpiezas | `notifications/eliminacion.py` |
| El comando | `notifications/management/commands/despachar_alertas.py` |
| Las variables de correo | `notifications_config/settings.py` |
| Las pruebas | `tests/test_entregas_s3_fe_21.py` (84) y `tests/test_carrera_entregas_postgres.py` (6, con dos conexiones a PostgreSQL) |

## Cómo se comprobaron las pruebas

```bash
cd services/notifications
python -m pytest -q tests/test_entregas_s3_fe_21.py tests/test_carrera_entregas_postgres.py
```

Las de carrera se saltan solas si la base no es PostgreSQL. Detienen al hilo
A con un `monkeypatch` en el punto exacto (dentro del reclamo, hablando con el
proveedor, contando la cuota, entre los dos bloqueos) y exigen que B aparezca
en `pg_locks` con `granted = false`, o que termine sin mandar nada.

Se rompió el código a propósito **31 veces** y al final cada vez falló al
menos una prueba. Entre otras:

- quitar el bloqueo de la persona, o el de la entrega releída;
- dejar que una entrega `enviando` con reclamo vigente sea elegible;
- anotar el resultado sin mirar el reclamo;
- no contar para la cuota las que están saliendo, o contar los reclamos vencidos;
- reintentar un error permanente, esperar siempre lo mismo o agotar un intento tarde;
- dar por aceptado un backend que devolvió 0, o mandar sin dirección, con una
  dirección inválida o por un canal sin proveedor;
- un Message-ID nuevo en cada intento;
- 5xx del destinatario o del mensaje como transitorio, o remitente como permanente;
- la franja que cruza la medianoche con «y», su fin inclusivo, el día de la
  cuota en UTC, la cuota con `>` o lo diferido saliendo a las 08:00;
- borrar entregas antes que preferencias en las limpiezas (interbloqueo), o
  que la limpieza de la persona no se lleve sus entregas o su dirección;
- que el generador no planifique, o que planifique sin mirar el canal.

Al principio dos no fallaban: quitar el bloqueo de la entrega releída, y no
contar las que están saliendo (eso último solo lo veía la prueba de carrera
en PostgreSQL). Agregué la carrera del resultado tardío y dos pruebas de
cuota con una conexión.

## Decisiones para revisar

- **El canal acordado es el correo**, por RF-09, FE-21, `.env.example` y
  ADR-006. No hay un acuerdo escrito de S3-FE-21 aparte de eso.
- **De dónde sale la dirección.** El catálogo dice que auth publica
  `usuario.creado` con `email` y que notifications lo escucha;
  `DireccionCorreo` es lo que guardaría ese consumidor. Pero MX-21 dice «no
  transportar […] correos» en los mensajes. Hay que elegir entre ese evento,
  una consulta interna a auth firmada como las de eliminación, u otra cosa.
- **Remitente y autenticación se reintentan** aunque vengan con 5xx.
- **Si la persona apagó el correo, no hay respaldo por correo** aunque el push
  no esté disponible. RF-09 dice «se envía igual por correo»; se leyó como
  "si tiene el correo encendido".
- **Descanso y cuota solo para push**, con los valores de RN-08 y RN-09 fijos
  en código. Falta el orden de prioridad de RN-08 (fin de prueba antes que
  cobro): dentro de una corrida salen por antigüedad.
- **Las entregas nacen en el generador.** Cuando FE-24 emita
  `alerta.activada`, el consumidor de `notifications.entregas.v2` llama a
  `planificar()` en lugar del generador; la restricción única lo hace
  idempotente ante reentregas.

## Lo que falta para cerrar

- **Quién llena `DireccionCorreo`.** Sin eso, en cualquier entorno, cada
  correo termina `fallida` con `sin_direccion`. Depende de auth (publicar
  `usuario.creado` o exponer la consulta) y de resolver el choque con MX-21.
- **Una corrida real** contra el Gmail provisorio, con la captura del correo
  recibido y su Message-ID. No se hizo.
- **Programar el despachador.** En el compose no corre, igual que
  `generar_alertas`. En el clúster haría falta un CronJob junto a
  `k8s/tandas/alertas-notifications.yaml` y, en los pods de notifications de
  la tanda, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`
  y los secretos `EMAIL_HOST_USER` y `EMAIL_HOST_PASSWORD`, como en
  `k8s/10-auth.yaml`. No se tocaron los manifiestos.
- **FE-22**: cuota, franja y zona horaria por persona, y el orden de
  prioridad de RN-08.
- **El push**: proveedor (Expo) y registro de dispositivos.
- **S3-FE-22**: anular las entregas pendientes de una alerta que quedó
  obsoleta (suscripción cancelada o con otra fecha).
