# S3-FE-21 — Mandar las alertas y anotar entrega o error

**Qué hace.** Cada alerta nueva deja una **entrega** por persona y canal
externo que la quiere, y `despachar_alertas` las manda por correo. Cada
entrega termina con la **evidencia del proveedor** o con un **error con
código**. Crear la fila, diferirla o reclamarla no la da por entregada.

> **No cierra la tarjeta.** Es la parte independiente de una tarjeta [DEP].
> Hoy no puede salir ningún correo en ningún entorno: **no hay de dónde sacar
> la dirección de correo de las personas** (ver «De dónde sale la dirección»)
> y **nadie programa el despachador**, a propósito, hasta que eso se resuelva.
> Tampoco se mandó ningún correo real.

| Criterio de la tarjeta | Dónde se cumple | ¿Demostrado? |
|---|---|---|
| Una entrega tiene evidencia del proveedor o error explícito | `aceptada` lleva `aceptada_en` y `evidencia` (Message-ID y backend). `fallida`, `agotada` y `reintento` llevan `codigo_error` y `detalle_error` | En pruebas, con `locmem` y con un servidor SMTP local. Falta la corrida con un proveedor real |
| No se declara entregada solo por encolarla | nace `pendiente`; pasa a `aceptada` solo si el backend SMTP devolvió 1 sin excepción, o sea, con un 250. Con un backend que no entrega, no se despacha | Sí, en pruebas |
| Evidencia enlazada; revisión y validación del receptor | — | **No**: falta la PR, la corrida real y que Maxi y auth validen canal y fuente de direcciones |

Del alcance: **reintentos acotados** (5 intentos con espera de 1 min, 5 min,
30 min y 2 h; después `agotada`) y **respeto de preferencias** (las de cada
persona, incluida su anticipación, o las de omisión si nunca guardó; se miran
al planificar y al mandar). **Descanso y cuota** existen para push (RN-08 y
RN-09), pero solo se prueban con un doble porque el push no tiene proveedor.

## El canal

Es el **correo**. No hay un acuerdo escrito propio de S3-FE-21; lo que lo
respalda, y que tiene que validar quien recibe la entrega:

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
valores por omisión. No hay variables de entorno nuevas.

**Solo el SMTP cuenta como proveedor.** `EMAIL_BACKENDS_CON_PROVEEDOR`
(settings, no variable de entorno) trae solo el backend SMTP. Con dummy,
console o filebased, `send()` devuelve 1 sin que salga nada, y con console el
correo completo queda en el log; `locmem` es un buzón en memoria. Con
cualquiera de ellos `despachar_alertas` **se niega a correr** y no toca
ninguna entrega: quedan como estaban y salen cuando se corrija el backend.
Las pruebas agregan `locmem` a esa lista en `conftest.py`.

**El push no tiene proveedor.** ADR-006 lo acordó con el servicio de
notificaciones de Expo, pero no hay credenciales ni registro de dispositivos.
Una entrega por push termina `fallida` con `canal_no_disponible`, aunque
`CANALES_HABILITADOS` incluya `push`. No se simula: un push "enviado" sin
proveedor sería declarar entregado algo que no salió.

## De dónde sale la dirección

**No hay contrato acordado: hay un conflicto abierto.** El correo de una
persona vive en el esquema de auth, y ningún servicio consulta el de otro
(ADR-002). Las dos opciones:

| Opción | A favor | En contra |
|---|---|---|
| `usuario.creado` con `email`, como lo describe el catálogo (`shared/events/catalogo.md`, «Publica auth»). `DireccionCorreo` es la forma de lo que guardaría ese consumidor | ya está en el catálogo | MX-21 dice «No transportar tokens, contraseñas, correos ni cuerpos de mensajes». Guarda una copia de los correos en notifications |
| Una consulta interna firmada a auth al momento de reclamar, como la de la limpieza (MX-07) | no guarda correos acá ni choca con MX-21; la dirección es siempre la vigente | auth no la expone; un auth caído deja el correo en reintento |

Lo deciden Maxi y quien lleve auth. Mi propuesta es la consulta firmada. Si
se elige, cambian solo `CanalCorreo.destino` (a dónde) y
`PreferenciaNotificacion.de_la_organizacion` (quiénes son las personas), y
`DireccionCorreo` se retira.

Mientras tanto **nadie llena `DireccionCorreo`** fuera de las pruebas, y una
entrega por correo sin dirección termina `fallida` con `sin_direccion`.

## El recorrido

```
generar_alertas ── crea la alerta ──▶ planificar(): una EntregaAlerta por
                   (misma transacción)  persona y canal externo que la quiere
                                                   │ pendiente
despachar_alertas ─▶ ¿backend con proveedor? ── no ──▶ se niega, no toca nada
                   │ sí
                   ▼
                   elegibles ─▶ reclamar() ── transacción corta, bajo bloqueo ──┐
                                1. bloquea la preferencia de la persona (si hay) │
                                2. relee la entrega con el filtro de elegibles   │
                                3. ¿la sigue queriendo? ¿en su anticipación?     │
                                   ¿canal disponible?          ──▶ descartada   │
                                4. ¿descanso? ¿cuota?          ──▶ diferida     │
                                5. ¿dirección? ¿mensaje válido? ──▶ fallida     │
                                6. enviando + reclamo_id + reclamada_hasta ◀────┘
                                                   │ commit
                                canal.enviar() ── fuera de la transacción
                                                   │
                   aceptada ◀── anotar() si el reclamo sigue siendo el mismo ──▶ reintento · fallida · agotada
```

## A quién

A cada **persona conocida** de la organización que quiere ese tipo de aviso,
una fila por canal externo encendido (`por_email`, `por_push`). `en_la_app`
no tiene fila: la alerta misma es esa entrega (FE-19).

- **Conocida** es tener fila de preferencias o dirección de correo
  (`PreferenciaNotificacion.de_la_organizacion`).
- **Quien nunca guardó preferencias** recibe con las de omisión: la fila nace
  con el primer GET de Ajustes, pero las de omisión (correo encendido, push
  apagado, 3 días) son las que la pantalla le muestra como suyas. Se usan sin
  guardarse. El generador mira a las mismas personas: su ventana de 3 días
  entra en las ventanas de aviso de la organización.
- **La anticipación es de cada persona.** La alerta de cobro es de la
  organización y lleva la ventana más cercana que pidió alguien. Con A en 3
  días y B en 7, la alerta de 7 días es la de B: a A no se le escribe hasta
  que falten 3. Y **cada persona recibe un aviso por cobro y canal**: cuando
  falten 3 días, B ya recibió el suyo y no se le manda otro. Si la ventana de
  B no alcanzó a generarse (una suscripción creada a 2 días del cobro), la de
  3 es su primer aviso y le llega.
- Una organización sin ninguna persona conocida ve la alerta en la aplicación,
  pero no tiene a quién escribirle.

**Las preferencias se miran dos veces**: al planificar y al mandar. Si la
persona apagó el canal o el tipo entre medio, la entrega queda `descartada`
con `motivo = preferencia_apagada`. Si no tiene fila, valen las de omisión, y
si esas no piden el canal el motivo es `preferencia_por_omision`. Si achicó
la anticipación (de 7 a 3 días) queda `fuera_de_anticipacion`, y la alerta de
su nueva ventana sí le llega: una descartada no cuenta como aviso recibido.

Si la persona apagó el correo y pidió solo push, **no se le manda correo**
aunque el push no esté disponible. HU-03 dice que «sin dispositivo push la
recibo igualmente por correo»; queda como pregunta para Maxi (ver las
decisiones).

## Los estados

| Estado | Grupo | Qué significa | ¿Se vuelve a intentar? |
|---|---|---|---|
| `pendiente` | en espera | Planificada, nunca intentada | sí, desde `proximo_intento_en` |
| `diferida` | en espera | Descanso o cuota; `motivo` dice cuál | sí, en `proximo_intento_en` |
| `reintento` | en espera | Error transitorio; espera progresiva | sí, en `proximo_intento_en` |
| `enviando` | en vuelo | Un worker la reclamó y está hablando con el proveedor | solo si el reclamo vence |
| `aceptada` | terminal | El proveedor la aceptó: hay evidencia | no |
| `fallida` | terminal | Error permanente | no |
| `agotada` | terminal | Se acabaron los 5 intentos | no |
| `descartada` | terminal | Ya no corresponde: `motivo` dice por qué | no |

`EntregaAlerta.EN_ESPERA` es el filtro de `elegibles()` y
`EntregaAlerta.TERMINALES` son los de los que no se sale. Las pruebas exigen
que los dos grupos y `enviando` cubran todos los estados sin repetir.

`intentos` cuenta las veces que se reclamó para mandarla. Diferirla no gasta
un intento, y tampoco fallar antes de reclamar: sin dirección, dirección
inválida, canal sin proveedor o un mensaje que no se puede armar.

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
| Un encabezado con salto de línea | `mensaje_invalido` | permanente, sin intento |
| Canal sin proveedor o deshabilitado | `canal_no_disponible` | permanente, sin intento |
| Backend de correo que no entrega (dummy, console…) | — | no se despacha: error de configuración, la entrega no se toca |

Permanente es solo lo que dice algo **del destinatario o del mensaje** con un
5xx: mandarlo igual otra vez da lo mismo. Remitente y autenticación también
pueden venir con 5xx, pero son de nuestra configuración y se arreglan sin
tocar el mensaje, así que se reintentan.

El título de la alerta viene del nombre de la suscripción, que nadie limpia de
saltos de línea. El asunto se arma **en una sola línea**. Si aun así un
encabezado no se puede armar, se descubre **antes de reclamar**: queda
`fallida` con `mensaje_invalido`, sin gastar un intento ni abrir la conexión
SMTP. Antes eran 5 reintentos como `inesperado` hasta `agotada`.

Un corte o un silencio **después** de mandar el mensaje no se da por
entregado ni por perdido: el servidor pudo haberlo procesado. Va a
`reintento`, y el reintento lleva **el mismo Message-ID**, que es la clave de
idempotencia del canal que pide MX-21 para las entregas externas. `smtplib`
convierte el tiempo agotado esperando una respuesta en
`SMTPServerDisconnected`, así que ese caso sale como `conexion` con
`timed out` en el detalle.

El Message-ID es `<alerta-{id de la entrega}@{dominio del remitente}>`. El
dominio sale de la **dirección** de `DEFAULT_FROM_EMAIL`, que puede traer
nombre visible («Ojo al Gasto <no-responder@…>»).

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
  El costo queda para FE-22: si la cuota se completa solo con una en vuelo y
  esa después falla, la diferida espera hasta mañana a las 09:00 aunque ese
  día haya salido una sola. Lo exacto sería diferirla hasta que venza ese
  reclamo.
- Sin fila de preferencias no hay push (`por_push` nace apagado), así que la
  cuota siempre se cuenta bajo el bloqueo de la fila de la persona.
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

El reloj del reclamo es el `ahora` de la corrida. Por eso `--ahora` se acepta
**solo con el buzón de pruebas**: con un proveedor real, un `--ahora` en el
pasado dejaba el reclamo vencido para el cron que corre con la hora real, que
volvía a tomar la entrega y mandaba el mismo correo otra vez.

Las dos limpiezas (la de la organización y la de la persona) borran
preferencias antes que entregas, el mismo orden que el despachador. Con el
orden contrario, una limpieza y un reclamo de la misma persona se esperan el
uno al otro y PostgreSQL corta uno por interbloqueo: lo comprobaron dos de
las mutaciones.

## Qué es doble y qué sería entrega real

| En las pruebas | Qué es | Qué acredita |
|---|---|---|
| backend `locmem` | buzón de Django en memoria; no entrega nada. Solo en las pruebas cuenta como proveedor (`conftest.py`) | qué se manda y qué se anota. La evidencia lo dice: `backend = …locmem.EmailBackend` |
| `ServidorSMTP` (`tests/smtp_de_prueba.py`) | servidor SMTP local que responde lo que se le pida | el backend SMTP real y `smtplib` frente a 250, 550, 451, 554, 452, 553, un corte, un silencio y un puerto cerrado |
| `DobleDePush` | doble de push declarado como tal | la política de descanso y cuota |

**Entrega real** es el backend SMTP con las credenciales del Gmail
provisorio que usa auth en producción. **No se mandó ningún correo real** en
esta tarea.

Una corrida real acotada demuestra el **proveedor**, no la fuente de
direcciones, y hay que presentarla así. En una base de desarrollo, nunca la
de producción, y con una dirección propia cargada a mano:

```bash
export EMAIL_HOST=smtp.gmail.com EMAIL_PORT=587 EMAIL_USE_TLS=True \
       EMAIL_HOST_USER='<gmail provisorio>' EMAIL_HOST_PASSWORD='<clave de aplicación>' \
       DEFAULT_FROM_EMAIL='<gmail provisorio>'
python manage.py shell -c "from notifications.models import DireccionCorreo; \
  DireccionCorreo.objects.create(organizacion_id='<org>', usuario_id='<usuario>', email='<correo propio>')"
python manage.py generar_alertas
python manage.py despachar_alertas
```

La evidencia es la fila `aceptada` con su `message_id` y, en el buzón de
enviados, `rfc822msgid:<alerta-…>` con la captura. No comprobé si Gmail
conserva el Message-ID que ponemos; si lo reemplaza, el correo se busca por
asunto y hora, y eso hay que anotarlo.

## Lo que se guarda

| Tabla | Qué | Se borra con |
|---|---|---|
| `entrega_alerta` | una fila por (alerta, persona, canal): estado, motivo, intentos, espera, reclamo, `destino`, `message_id`, evidencia y último error | la organización, la persona y la alerta |
| `direccion_correo` | (organización, persona) → correo. Hoy no la llena nadie | la organización y la persona |

`destino` guarda la dirección del último intento. Es dato personal, y por eso
la limpieza de la persona se lleva sus entregas además de sus preferencias.
Migración `0008_entregas_de_alertas`. No agrega índices: la selección del
despachador filtra por `estado` y `proximo_intento_en`, y un índice se
justifica con un plan sobre datos reales, que todavía no hay.

## El comando

```bash
python manage.py despachar_alertas                 # con el reloj real, hasta 200
python manage.py despachar_alertas --limite 50
python manage.py despachar_alertas --ahora 2026-11-21T23:00:00-03:00   # solo en pruebas
```

```
2026-11-21 10:00 -03: 1 aceptada(s) por el proveedor, 1 fallida(s).
  · entrega 5b1c…  [email] fallida: sin_direccion (intento 0)
```

Las agotadas también van a stderr. Con un backend que no entrega, falla con
«EMAIL_BACKEND=… no entrega a ningún proveedor» antes de tocar nada.
`--ahora` se lee igual que en `generar_alertas` (`notifications/reloj.py`),
pero aquí se rechaza fuera del buzón de pruebas.

**Hoy no lo programa nadie, a propósito.** Sin fuente de direcciones, cada
correo que tome quedaría `fallida` con `sin_direccion` para siempre:
programarlo antes destruye entregas que podrían salir después. Cuando haya
fuente, el plan es:

- correrlo en el **mismo** CronJob de `k8s/tandas/alertas-notifications.yaml`,
  después de `generar_alertas`, y no en uno aparte: la tanda está en 12 de 12
  pods con el generador corriendo, y `k8s/pruebas/presupuesto.py` cobra un pod
  por CronJob;
- pasarle `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS` y `DEFAULT_FROM_EMAIL`, y
  los secretos `EMAIL_HOST_USER` y `EMAIL_HOST_PASSWORD` como en
  `k8s/10-auth.yaml`, **solo a ese contenedor**: la API y el consumidor de
  notifications no mandan correos (regla 10);
- antes de habilitarlo por primera vez, mirar las entregas `pendiente`
  antiguas: saldrían avisos de cobros que ya pasaron, y anularlas es de
  S3-FE-22.

## Dónde está

| Pieza | Archivo |
|---|---|
| Modelos y migración | `services/notifications/notifications/models.py` → `EntregaAlerta`, `DireccionCorreo`, `PreferenciaNotificacion.de_la_organizacion`; `migrations/0008_entregas_de_alertas.py` |
| Planificar, reclamar, anotar y despachar | `notifications/entregas.py` |
| El canal de correo, la clasificación SMTP y la barrera de proveedor | `notifications/canales.py` |
| Descanso y cuota, sin base ni reloj | `notifications/politica_envio.py` |
| Las entregas nacen con la alerta; las mismas personas para las ventanas | `notifications/generador.py` → `_crear_una_vez`, `_preferencias` |
| Las limpiezas | `notifications/eliminacion.py` |
| El comando | `notifications/management/commands/despachar_alertas.py` |
| Las variables de correo y `EMAIL_BACKENDS_CON_PROVEEDOR` | `notifications_config/settings.py` |
| Las pruebas | `tests/test_entregas_s3_fe_21.py` (120) y `tests/test_carrera_entregas_postgres.py` (6, con dos conexiones a PostgreSQL); `conftest.py` agrega `locmem` como proveedor solo en pruebas |

## Cómo se comprobaron las pruebas

```bash
cd services/notifications
python -m pytest -q tests/test_entregas_s3_fe_21.py tests/test_carrera_entregas_postgres.py
```

Las de carrera se saltan solas si la base no es PostgreSQL. Detienen al hilo
A con un `monkeypatch` en el punto exacto (dentro del reclamo, hablando con el
proveedor, contando la cuota, entre los dos bloqueos) y exigen que B aparezca
en `pg_locks` con `granted = false`, o que termine sin mandar nada.

**Primera vuelta: 31 mutaciones**, y al final cada una hizo fallar al menos
una prueba. Entre otras:

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

**Segunda vuelta, sobre lo corregido tras la revisión: 20 mutaciones, 20
detectadas.** Planificar sin mirar la anticipación, sin descontar a los ya
avisados, contando las descartadas o sin mirar la fecha del cobro; `<` en vez
de `<=`; no volver a mirar la anticipación al mandar; dejar fuera a las
personas sin fila, en la planificación o en el generador; descartar a quien
no tiene fila, o anotarlo como `preferencia_apagada`; el Message-ID cortando
el remitente entero; el asunto sin limpiar; no validar el mensaje antes de
reclamar, o tratar `BadHeaderError` como inesperado; aceptar cualquier
backend, no negarse al empezar la corrida o no exigirlo en el reclamo;
aceptar `--ahora` con cualquier backend; y sacar `reintento` de los estados
en espera o meter `descartada`.

Una la detectaba una prueba por una razón lateral: «no negarse al empezar» la
pillaba la prueba del comando con console solo porque su entrega todavía no
era elegible con el reloj real. Hice elegible esa entrega y agregué una
prueba explícita de que la corrida se niega aunque no haya nada que mandar.

## Decisiones para revisar

- **El canal es el correo**, por RF-09, FE-21, `.env.example` y ADR-006. No
  hay un acuerdo escrito de S3-FE-21 aparte de eso: lo valida Maxi.
- **De dónde sale la dirección**: conflicto abierto entre el catálogo y MX-21.
  Propongo la consulta firmada a auth; lo deciden Maxi y quien lleve auth.
- **El despachador no se programa** hasta tener fuente de direcciones; el plan
  está en «El comando».
- **Anticipación por persona: «dentro de su anticipación y un aviso por
  cobro»**, no «solo si su anticipación es la de la alerta». Con la igualdad,
  B (7 días) no recibía nada si su ventana no alcanzó a generarse (suscripción
  creada a 2 días del cobro). Un aviso por cobro se cuenta por suscripción y
  fecha de cobro, sin contar las descartadas.
- **Sin fila de preferencias valen las de omisión**, en la planificación, en
  el envío y en las ventanas del generador. Eso cambia una cosa de FE-17: con
  personas conocidas sin fila, su ventana de 3 días entra en las de la
  organización aunque otras personas tengan fila.
- **Solo el SMTP es proveedor**, en una lista en settings y no en una
  variable: agregar otro backend es decidir que su respuesta vale como
  aceptación, y eso se revisa en una PR.
- **`--ahora` solo en pruebas**, en vez de usar el reloj real para el reclamo
  y `--ahora` para lo demás. Mezclar dos relojes en la misma corrida obligaba
  a rehacer las pruebas de reclamo vencido y de cuota, y `--ahora` no tiene uso
  con un proveedor real: el correo no tiene franja ni cuota.
- **Remitente y autenticación se reintentan** aunque vengan con 5xx.
- **Solo push y sin dispositivo: no hay correo.** HU-03 y RF-09 dicen «se
  envía igual por correo»; lo leí como "si tiene el correo encendido", porque
  si no el interruptor del correo de FE-21 no serviría mientras no exista el
  push. **Maxi, ¿vale la lectura literal?** Si vale, `planificar()` crea la
  entrega de correo cuando `canales.disponible("push")` es falso.
- **Descanso y cuota solo para push**, con los valores de RN-08 y RN-09 fijos
  en código. Falta el orden de prioridad de RN-08 (fin de prueba antes que
  cobro): dentro de una corrida salen por antigüedad. La cuota con entregas
  en vuelo que después fallan queda para FE-22.
- **Las entregas nacen en el generador.** Cuando FE-24 emita
  `alerta.activada`, el consumidor de `notifications.entregas.v2` llama a
  `planificar()` en lugar del generador; la restricción única lo hace
  idempotente ante reentregas.

## Lo que falta para cerrar

- **La fuente de direcciones**, acordada con Maxi y auth. Sin eso, en
  cualquier entorno, cada correo termina `fallida` con `sin_direccion`.
- **Una corrida real** con el Gmail provisorio, con la captura del correo y su
  Message-ID enlazados en la PR.
- **Programar el despachador** con las variables y secretos de correo solo en
  su contenedor (plan en «El comando»).
- **Respuesta de Maxi** sobre el respaldo por correo de HU-03.
- **FE-22**: cuota, franja y zona horaria por persona, el orden de prioridad
  de RN-08 y la cuota con entregas en vuelo.
- **El push**: proveedor (Expo) y registro de dispositivos.
- **S3-FE-22**: anular las entregas pendientes de una alerta que quedó
  obsoleta (suscripción cancelada, con otra fecha o un cobro que ya pasó).
