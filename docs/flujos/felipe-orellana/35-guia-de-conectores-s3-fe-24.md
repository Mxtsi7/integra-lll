# S3-FE-24 — Guía de los conectores de correo: de la cuenta de prueba al candidato

**Para quién.** Para cualquier persona del equipo que quiera conectar una
cuenta de prueba de Gmail u Outlook, leerla, importar una cartola y ver los
candidatos, sin haber escrito el código. Cada paso dice qué se espera ver.
Los detalles de diseño están en los documentos de cada tarjeta (enlaces al
final).

**Sin secretos.** Esta guía nombra variables, nunca sus valores. Los
`client_secret` y las claves de cifrado van en tu `.env` local (que no se
sube) o en el Secret del clúster.

```
navegador ─▶ web /cuentas ─▶ POST /api/conectores/autorizaciones/ ─▶ Google o Microsoft
                                                                          │ (consentimiento)
             web /oauth/retorno ◀─────────────────────────────────────────┘
                    │  POST /api/conectores/autorizaciones/callback/
                    ▼
             CuentaConectada (tokens cifrados) ─▶ beat cada 15 min ─▶ leer_cuenta_de_correo
                                                                          │
             cartola CSV ─▶ POST /api/importaciones/archivos/             ▼
                                   │                           CobroCandidato (propuesto)
                                   └──────────────────────────────────────┘
                                                    confirmar / rechazar ─▶ orden en el outbox
                                                                  │
                                                   candidato.confirmado.v1
                                                                  ▼
                                      subscriptions: suscripción + cobro + acuse
                                                                  │
                                                  candidato.aplicado.v1
                                                                  ▼
                                      CobroCandidato.aplicado_en → `aplicada`
```

## 1. Antes de empezar: las cuentas de prueba

Necesitas una aplicación OAuth en cada proveedor que quieras probar. Las
dos piden lo mismo: un ID de cliente, un secreto y **la URL de retorno
registrada exactamente igual** a `OAUTH_REDIRECT_URI`.

| | Google | Microsoft |
|---|---|---|
| Dónde | Google Cloud Console → APIs y servicios → Credenciales → «ID de cliente OAuth», tipo **aplicación web** | Microsoft Entra → Registros de aplicaciones, cuentas de cualquier organización **y personales** (el conector usa el tenant `common`) |
| API que hay que habilitar | Gmail API | Microsoft Graph (viene habilitada) |
| Pantalla de consentimiento | en modo «Prueba»: agrega la cuenta de prueba como **usuario de prueba**, o Google la rechaza | no hace falta configurarla para cuentas personales |
| URL de retorno | `http://localhost:5173/oauth/retorno` en local | igual |
| Secreto | se descarga al crear el cliente | Certificados y secretos → Nuevo secreto |

Usa una cuenta de correo **de prueba**, con algunos recibos de suscripciones
(Netflix, Spotify…). No uses tu correo personal: el lector solo lee, pero
el candidato guarda el remitente y el asunto como evidencia.

## 2. Configuración

Copia `.env.example` a `.env` en la raíz del repo y completa:

| Variable | Valor en local | Qué hace |
|---|---|---|
| `OAUTH_REDIRECT_URI` | `http://localhost:5173/oauth/retorno` | el retorno que se le registra al proveedor. Apunta a la **web**, que recibe `code` y `state` y los reenvía por POST. Vacía: iniciar la conexión responde 400 («OAUTH_REDIRECT_URI no está configurado») |
| `OAUTH_RETORNOS_PERMITIDOS` | `http://localhost:5173` | los orígenes completos (esquema + host + puerto) a los que se acepta volver. Vacía: ninguno |
| `OAUTH_GMAIL_CLIENT_ID` / `_SECRET` | los de tu cliente de Google | |
| `OAUTH_OUTLOOK_CLIENT_ID` / `_SECRET` | los de tu registro de Microsoft | |
| `CLAVES_CIFRADO` | una clave Fernet (cómo generarla está en `.env.example`) | cifra los tokens guardados. Sin ella no se puede guardar una cuenta |
| `CONECTORES_LECTURA_CORREO_SEGUNDOS` | `900` | cada cuánto el beat programa la lectura |
| `CONECTORES_PUBLICACION_SEGUNDOS` | el del código | cada cuánto beat drena el outbox de `candidato.confirmado` |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` (default del código) | broker del publicador y del consumidor del acuse. En el clúster lo sobrescribe el Secret `ojoalgasto-rabbitmq`; en local basta el default para correr `manage.py check` sin `.env` |

Las de importación tienen valores por omisión que sirven tal cual:
`IMPORTACION_TAMANO_MAXIMO_BYTES` (5 MB), `IMPORTACION_CUOTA_DIARIA` (20
archivos), `IMPORTACION_DIAS_RETENCION` (7 días),
`IMPORTACION_MONEDA_POR_DEFECTO` (`CLP`) e `IMPORTACION_ORDEN_FECHA`
(vacía: se deduce del archivo). Todas se leen en
`services/connectors/connectors_config/settings.py`.

FASE 3 también lee una variable en **subscriptions**, no en connectors:
`CONFIRMACIONES_FUENTES_HABILITADAS` (default `csv,correo`). Si una fuente se
quita, las órdenes de esa fuente se ACK con un log
`confirmacion.omitida ... motivo=fuente_no_habilitada`: no se aplican, pero
tampoco quedan rebotando en la cola.

> Hasta el sprint 3, `.env.example` traía un bloque «Conector Gmail» con
> `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI`, que
> **connectors no lee** (el `GOOGLE_CLIENT_ID` que sí existe es el del login
> de auth). Se corrigió en esta tarjeta.

## 3. Levantar todo en local

```bash
docker compose up -d --build
```

| Servicio | Qué hace para esta guía |
|---|---|
| `frontend` | la web en `http://localhost:5173` |
| `gateway` | `http://localhost:8000`: valida el JWT y pone `X-Organizacion-Id` y `X-Usuario-Id` |
| `connectors` | la API de conectores, importaciones y candidatos |
| `connectors-worker` | el worker de Celery **con beat** (`--beat`): procesa los CSV, lee las cuentas cada 15 minutos y (FASE 3) publica las confirmaciones. En k8s, además, el sidecar `aplicaciones` consume el acuse |
| `notifications` | las alertas |

Cuando `docker compose ps` muestre todo `healthy`, entra a la web con el
usuario de demostración (`SEED_CORREO` en `.env`).

## 4. Repetir la lectura del correo

**4.1 Conectar la cuenta.** En la web, ve a **Cuentas** → **Conectar correo**
→ Gmail (u Outlook). El proveedor muestra el consentimiento con un solo
permiso de correo, de **solo lectura**. Acepta.

- Esperado: vuelves a `/oauth/retorno`, que muestra «cuenta conectada», y en
  **Cuentas** aparece la cuenta como `conectada`.
- Si cancelas: «autorización cancelada» y **no** se crea ninguna cuenta.

**4.2 Leer a mano, sin guardar** (para comprobar que la conexión sirve):

```bash
docker compose exec connectors python manage.py shell -c \
  "from connectors.models import CuentaConectada as C; print(list(C.objects.values_list('id', 'organizacion_id', 'proveedor', 'estado')))"
docker compose exec connectors python manage.py leer_gmail --organizacion <organizacion_id> --cuenta <id> --limite 5
```

(`leer_outlook` para Outlook.) Muestra de cada mensaje el identificador, la
fecha, el remitente, el asunto y el **largo** del texto, nunca el cuerpo.
Acepta `--desde AAAA-MM-DD` y `--pagina` para seguir una página anterior. No
guarda nada.

**4.3 Leer de verdad.** El beat lo hace solo cada 15 minutos. Para no
esperar:

```bash
docker compose exec connectors-worker celery -A connectors_config call connectors.tasks.leer_cuenta_de_correo --args='["<id>"]'
docker compose logs -f connectors-worker
```

- Esperado: en el log, la tarea termina con un resumen como
  `{'paginas': 1, 'mensajes': N, 'importacion': '<uuid>'}`.
- Los recibos quedan como **candidatos** `propuesto`, con el servicio, el
  importe, la moneda, la fecha y el correo de origen. Se consultan con
  `GET /api/candidatos/?origen=correo` (con el JWT, a través del gateway).
- **En la web todavía no se ven.** La pantalla **Importaciones** pide
  `GET /api/importaciones/?mias=true`, o sea, las que subió la persona; la
  lectura programada firma las suyas como `lectura-programada`. Falta decidir
  dónde se muestran (anotado en la retrospectiva, doc 36).
- Un correo que no cuadra (por ejemplo, un cobro con fecha posterior a la
  llegada del correo) no inventa un candidato: queda como error en la
  importación, con su motivo.

**4.4 Confirmar o rechazar.** Desde la web, o con
`POST /api/candidatos/<id>/confirmar/` y `POST /api/candidatos/<id>/rechazar/`.
Confirmar deja una orden `candidato.confirmado` en el outbox. Confirmar dos
veces no deja dos órdenes.

> **Con FASE 3 las órdenes sí se consumen**, pero la rama
> `aplicar-cobros-confirmados` no está fusionada: en lo que hoy corre en el
> clúster, confirmar sigue sin crear la suscripción ni el cobro. Cuando se
> despliegue, `subscriptions` aplica la orden y devuelve
> `candidato.aplicado`; el sidecar `aplicaciones` del worker marca
> `aplicado_en` y la API pasa a mostrar `aplicacion="aplicada"` (ver doc 21).
> Los contratos siguen pendientes de ratificación con Maxi/Víctor/Felipe.

## 5. Repetir la importación de una cartola

En la web, **Importaciones** (`/importaciones`) → subir archivo; el detalle
de cada importación (`/importaciones/<id>`) muestra sus cobros. Por la API es
`POST /api/importaciones/archivos/`, multipart con el campo `archivo`.
Responde 201 con la importación, y el worker la procesa. Su estado se
consulta en `GET /api/importaciones/<id>/`.

Un archivo mínimo que funciona:

```
Fecha;Glosa;Monto;Moneda
13/10/2026;NETFLIX.COM 1234 SANTIAGO CL;9990;CLP
17/10/2026;PAYPAL *SPOTIFY;4990;CLP
```

| Columna | Nombres que se reconocen |
|---|---|
| fecha | fecha, fecha movimiento, fecha de movimiento, fecha transaccion, fecha de transaccion, fecha operacion, fecha contable, date |
| descripción | descripcion, detalle, glosa, concepto, comercio, description |
| monto | monto, importe, cargo, valor, monto total, amount |
| moneda (opcional) | moneda, divisa, currency. Sin columna, manda el símbolo y después `IMPORTACION_MONEDA_POR_DEFECTO` |

El separador se detecta solo. Las fechas `dd/mm` y `mm/dd` se distinguen con
un día mayor que 12 en cualquier fila del archivo. **Si todas son ambiguas,
no se adivina**: cada fila sale con `fecha_ambigua` (o se fija
`IMPORTACION_ORDEN_FECHA`).

Cada fila que no sirve queda como error **con su número de fila y su
motivo**, y no tumba a las demás. Los motivos posibles son `fecha_invalida`,
`fecha_ambigua`, `importe_invalido`, `importe_cero`,
`importe_fuera_de_rango`, `moneda_ambigua`, `moneda_desconocida`,
`moneda_no_indicada`, `descripcion_vacia`, `fila_incompleta`,
`columnas_sobrantes` y `celda_demasiado_larga`.

Volver a subir el mismo archivo, o uno que se traslapa (octubre, y después
octubre + noviembre), no propone otra vez los cobros que ya estaban.

## 6. Permisos que se piden

| Proveedor | Permisos | Por qué |
|---|---|---|
| Gmail | `gmail.readonly`, `openid`, `email`. Además `access_type=offline` y `prompt=consent` | leer y nada más. Sin `prompt=consent`, Google no vuelve a mandar el refresh token al reconectar |
| Outlook | `Mail.Read`, `offline_access`, `openid`, `email` | leer y nada más. `offline_access` es el refresh token |

Los tokens se guardan **cifrados** con `CLAVES_CIFRADO`, y la API nunca los
devuelve. Desconectar revoca el token en Google. Microsoft no publica una
revocación por token: se revoca desde la cuenta del usuario.

## 7. Cursores, reintentos y qué significa cada estado

Cada cuenta tiene su `AvanceDeLectura`: hasta dónde se leyó (`leido_hasta`),
la página en curso y cómo le fue a la última lectura (`estado_lectura`).

| `estado_lectura` | Qué pasó | Qué hace el sistema |
|---|---|---|
| `al_dia` | la última lectura funcionó | la vuelve a programar el beat |
| `reintentando` | un error transitorio (red, 429, 5xx) | reintenta a los 1, 5, 15, 30 y 60 minutos, o con el `Retry-After` del proveedor (tope de 60). Una sola cadena por cuenta: mientras espera, nadie más la lee |
| `agotada` | se acabaron los 5 reintentos | descansa 1 hora y vuelve a programarse |
| `detenida` | un error permanente del proveedor | no se lee hasta que la cuenta se reconecte |

El cursor solo avanza si la página se guardó. Un fallo a mitad de camino
vuelve a leer la misma página, y lo ya guardado no se duplica.

## 8. Reconexión

| Estado de la cuenta | Cuándo | Qué tiene que hacer la persona |
|---|---|---|
| `conectada` | normal | nada |
| `requiere_reautorizacion` | el proveedor rechazó el token aun después de refrescarlo, dijo `invalid_grant` al refrescar, o faltan permisos (403) | volver a conectar la **misma** cuenta desde **Cuentas**. El listado lo muestra con `necesita_reautorizacion` y un motivo legible |
| `desconectada` | la persona la desconectó | conectarla de nuevo |
| `error` | hoy ningún flujo deja una cuenta así | si aparece, se trata igual que `requiere_reautorizacion`: también marca `necesita_reautorizacion` |

Un token que vence en menos de 5 minutos se refresca antes de leer. Un 401
se refresca una vez y se lee una vez más. Si vuelve a fallar, la cuenta
queda `requiere_reautorizacion` y **deja de hablar con el proveedor** hasta
que la reconecten: no hay bucle. Un error de **nuestro** cliente OAuth
(`invalid_client`) no marca las cuentas, porque el usuario no puede
arreglarlo.

## 9. Alertas

`notifications` escucha los eventos de suscripción, genera los avisos de
próximo cobro y de fin de prueba, planifica un correo por persona y lo
despacha. Un aviso que deja de corresponder (la suscripción se cancela o
cambia la fecha) queda obsoleto y su correo no sale. Detalle en los docs 31
y 33.

Lo que **no** funciona todavía, a propósito:
- `despachar_alertas` **se niega a correr** con un backend de correo que no
  sea SMTP: con `console` o `locmem` una entrega quedaría «aceptada por el
  proveedor» sin proveedor.
- No está programado en beat, y no hay acuerdo sobre de dónde sale la
  dirección de correo de cada persona (doc 31).

## 10. Si algo falla

| Síntoma | Causa probable |
|---|---|
| 400 «OAUTH_REDIRECT_URI no está configurado» al conectar | falta la variable en `.env`, o no se reinició `connectors` |
| Google muestra `redirect_uri_mismatch` | la URL registrada en Google no es **exactamente** `OAUTH_REDIRECT_URI` (ojo con la barra final y el puerto) |
| Google muestra «acceso bloqueado» | la cuenta no está entre los usuarios de prueba de la pantalla de consentimiento |
| La cuenta queda `requiere_reautorizacion` al poco rato | se revocó el acceso desde la cuenta de Google, o el cliente cambió de secreto. Reconectar |
| La lectura no deja candidatos | mira los errores de la importación (`GET /api/importaciones/<id>/`): el motivo de cada correo descartado está ahí. Un boletín sin cobro no deja nada, y es correcto |
| `estado_lectura` = `agotada` | el proveedor falló 6 veces seguidas. El error está en `ultimo_error` y `ultimo_error_detalle` del avance |
| El CSV sale entero con `fecha_ambigua` | ninguna fila tiene un día mayor que 12: fija `IMPORTACION_ORDEN_FECHA` |
| `aplicacion` sigue `pendiente` después de confirmar | la rama de FASE 3 no está desplegada, o la fuente no está en `CONFIRMACIONES_FUENTES_HABILITADAS` (se ACK y queda rastro en el log), o el sobre fue a `subscriptions.confirmaciones.fallidos`. `pendiente` no es un error: es «orden durable, sin acuse» |
| `aplicacion="aplicada"` pero no hay cobro | es correcto si el tipo era `aviso_de_cobro` o `pago_fallido`: el acuse trae `cobro_id=null`. La suscripción sí quedó creada o emparejada |
| Un cobro por correo y otro por CSV del mismo servicio aparecen dos veces | riesgo conocido fuera de alcance: la unicidad es por origen y un `Message-ID` nunca iguala la huella de una fila CSV (doc 34) |

## Dónde está el detalle

| Tema | Documento |
|---|---|
| Conectar y desconectar cuentas | 12 |
| CSV, procesar, consultar, rechazar y confirmar candidatos, duplicados | 17 a 22 |
| Leer Gmail y Outlook, renovar credenciales | 23 a 25 |
| Origen, importe, moneda, fecha y tipo de cada correo | 26 a 28 |
| Cursor, candidatos de correo y lectura programada | 29, 30 y 32 |
| Envío y avisos obsoletos | 31 y 33 |
| Pruebas finales de punta a punta | 34 |
| La pantalla `/oauth/retorno` | `docs/RETORNO-OAUTH-WEB.MD` |

## Qué no se probó con un proveedor real

Esta guía se armó leyendo el código y las pruebas, y se verificó contra
ellos (ver la PR). **No se recorrió todavía con una cuenta real de Gmail u
Outlook**: es la evidencia que falta de S3-FE-23, y la necesita quien la
recorra primero. Si un paso no resulta como dice, se corrige acá.
