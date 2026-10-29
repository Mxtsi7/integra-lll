# MX-07 — Eliminar cuenta y coordinar limpieza

[MX-07](https://trello.com/c/50Mkov2i), RF-01.7.

`DELETE /api/usuarios/me/` exige contraseña y `confirmacion=ELIMINAR`.
Cancelar o rechazar la contraseña no elimina datos. La identidad procede del
contexto del Gateway; nunca se selecciona el usuario desde el cuerpo.

- Integrante o titular con otro titular: elimina su cuenta y revoca sus sesiones,
  con respuesta 204. En la misma transacción deja una `EliminacionUsuario` durable
  para limpiar sus preferencias en Notifications. El 204 confirma la cuenta local;
  la limpieza personal entre servicios se reintenta hasta recibir ACK.
- Usuario sin organización: elimina su cuenta y sesiones, sin trabajo entre servicios.
- Último titular: exige además `confirmacion_organizacion=ELIMINAR`. Elimina las
  cuentas y revoca las sesiones de sus miembros, registra `EliminacionOrganizacion`
  y devuelve 202 con `operacion_id`. Auth conserva la organización hasta los ACK.

El consentimiento se conserva disociado durante seis años calendario, sin usuario,
organización ni otro identificador. La fecha de borrado se guarda solo con el día:
el instante exacto se podía cruzar con la operación de borrado, que sí conserva la
persona y la organización. Se retiene hasta el fin del día del aniversario. La
versión original del consentimiento no se registraba y no se inventa
retrospectivamente.

## Entrega durable e aislamiento

`python manage.py procesar_eliminaciones --continuo` procesa ambos tipos de trabajo
cada 60 segundos. Solo un 204 quita un destino de pendientes. Errores HTTP, red,
firmas y bloqueos 409 conservan el trabajo; una reentrega es idempotente.

La organización se limpia mediante:

```http
DELETE /internal/organizaciones/<uuid>/
X-Eliminacion-Instante: <unix-segundos>
X-Eliminacion-Firma: <HMAC-SHA256>
Content-Type: application/json

{"operacion_id": "<uuid>"}
```

La firma cubre `servicio:organizacion_id:operacion_id:instante`, con vigencia de
60 segundos. La limpieza personal usa `/internal/organizaciones/<uuid>/usuarios/<id>/`
en Notifications y firma `notifications:usuario:<id>` como destino, vinculando
también el usuario. Una firma de organización no autoriza limpiar una persona.
Las rutas son privadas, el Gateway no las expone y están excluidas del esquema
OpenAPI público (`@extend_schema(exclude=True)`); no aparecen en el contrato que
consume el frontend. No hay consultas entre esquemas.

`ELIMINACION_INTERNA_SECRET` es independiente de JWT y se comparte entre Auth y los
consumidores. Sin él ninguna limpieza se puede firmar, así que Auth responde 503
`eliminacion_no_configurada` antes de revocar sesiones o borrar a nadie. El worker
registra por qué queda pendiente cada destino: sin firma, sin respuesta o una
respuesta distinta de 204. Las URLs se configuran con `URL_SUBSCRIPTIONS`,
`URL_CONNECTORS`, `URL_ANALYTICS` y `URL_NOTIFICATIONS`. Las llamadas limitan
conexión/lectura a 2/5 s y no siguen redirecciones.

`ELIMINACION_DESTINOS` enumera servicios separados por comas; por defecto incluye
los cuatro. Rechaza listas vacías, duplicadas o desconocidas con el mismo 503,
antes de revocar sesiones. Los destinos quedan guardados al crear cada operación: cambiar la
configuración nunca recorta un trabajo que ya está pendiente. Solo se excluye un
servicio que no almacena datos en ese entorno. Habilitar un nuevo servicio exige
agregar su destino antes de que reciba datos.

## Datos y revocación OAuth

- Subscriptions elimina outbox, presupuestos, hallazgos de cobro, cobros, uso,
  transiciones, suscripciones, resúmenes por moneda y evidencia de trabajo derivado.
  Conserva proveedores globales y bloquea FK ajenas inconsistentes, incluidas las
  relaciones de los hallazgos con su suscripción, cobro y cobro relacionado.
- Connectors elimina autorizaciones pendientes, importaciones y cuentas. Antes de
  limpiar invoca `revocar_y_desconectar` de FE-05 para cada concesión sin
  evidencia **cuyo proveedor ofrece revocación**; Outlook se omite y se trata en
  el punto siguiente. Un fallo devuelve 409, conserva las credenciales cifradas y
  revierte los cambios locales de esa cuenta. Una confirmación real guarda
  `revocado_en` y retira tokens. Cada éxito queda confirmado en su propia
  transacción, cuenta por cuenta y releída bajo el bloqueo: sobrevive aunque otra
  cuenta bloquee la limpieza o falle a mitad de camino (una conexión que se cae,
  un pod que se reinicia). No se vuelve a revocar esa concesión en cada reintento. La limpieza final vuelve a
  verificar la evidencia bajo bloqueo, por si hubo reconexión entre preparación y
  borrado. Compara además los identificadores y `credenciales_version` de todas
  las cuentas preparadas: una reconexión o cuenta nueva, también Outlook,
  devuelve `409 credenciales_cambiadas` sin destruir sus nuevas credenciales.
- Outlook se cierra **sin revocación ante Microsoft**. La limpieza no llama a
  Graph, no escribe `revocado_en` y no usa ese campo con otro significado. Las
  credenciales cifradas se destruyen únicamente en el borrado final, dentro de
  la transacción que elimina las filas de `CuentaConectada`, después de que
  pasaron todas las demás validaciones; un 409 deja el ciphertext intacto. La
  razón es que `revokeSignInSessions` no está soportado para cuentas personales
  y, para trabajo/escuela, exige consentimiento administrativo y afecta a todas
  las aplicaciones del usuario. Esto es una **mitigación con riesgo residual** y
  cuenta con el [visto bueno técnico de Felipe / FE-05](https://github.com/Mxtsi7/integra-lll/pull/72#issuecomment-6509078231).
  La enmienda de RF-01.7 está registrada para ratificación del equipo; la decisión completa está en
  `docs/decisiones/mx-07-outlook-revocacion.md`.
- Riesgo residual de Outlook: un refresh token ya emitido por Microsoft podría
  seguir válido hasta que expire o hasta que el usuario retire el acceso. Ya no
  conservamos copia; explotarlo exigiría que alguien lo hubiera obtenido antes.
  El sistema no controla los tokens que el proveedor ya emitió.
- Paso manual para el usuario:
  - cuenta personal: retirar el acceso de la aplicación en
    <https://account.live.com/consent/Manage>. La fuente es una respuesta de
    Microsoft Q&A, **no documentación oficial**;
  - cuenta de trabajo/escuela: el administrador del tenant o el portal de
    aplicaciones de Microsoft. Esta vía **no está verificada** y queda fuera del
    alcance de esta PR.
  El diálogo web (AN-18) muestra el aviso antes de confirmar, sin habilitar su
  bandera de disponibilidad. El flujo móvil AN-19 debe mostrarlo al implementarse.
  La política también permite resolver operaciones durables Outlook ya pendientes;
  el worker vuelve a intentar sus mismos destinos y solo retira Connectors tras 204.
- `pendientes_de_revocar` y `reintentar_revocaciones` excluyen a Outlook: su
  limitación es permanente, no un fallo reintentable. La limpieza registra en
  logs estructurados cuántas cuentas se cerraron sin revocación del proveedor,
  sin correos ni tokens. No se añadió cuerpo al 204 para no romper al consumidor.
- Analytics elimina datos de ingesta/uso, cobertura, recomendaciones y descartes,
  conservando umbrales globales; bloquea cascadas que afectarían otro tenant.
- Notifications elimina alertas y preferencias al borrar la organización. Al
  retirar un integrante elimina solo sus preferencias y conserva una marca mínima
  `(organizacion_id, usuario_id)` para que solicitudes en vuelo no las recreen.
  Si esa limpieza personal llega después de la de la organización, responde 204
  sin escribir: la marca no se recrea en un tenant eliminado. Conserva las
  preferencias de otros usuarios y organizaciones.

`EstadoOrganizacion` vive en cada esquema consumidor. En PostgreSQL las escrituras
HTTP y trabajos internos toman `FOR SHARE`: varias escrituras del mismo tenant
pueden avanzar a la vez. La limpieza usa `FOR UPDATE`, espera las escrituras en
vuelo y marca el tenant eliminado en la misma transacción que borra sus datos.
Después se rechazan nuevas escrituras. El GET de preferencias también participa
del bloqueo porque crea valores iniciales. En bases sin bloqueo compartido se
conserva el camino ORM; la verificación de concurrencia requiere PostgreSQL.
Los trabajos internos deben participar del mismo bloqueo de organización.
Subscriptions lo toma antes de consultar la evidencia del evento o leer la fuente
del resumen y lo conserva hasta confirmar el cálculo y su evidencia; mantiene
además el bloqueo advisory del resumen. También protege el recálculo directo.
Un evento de un tenant eliminado se confirma como obsoleto sin recrear datos;
los fallos reales de base o cálculo conservan su tratamiento de reintento/rechazo.
Los adaptadores de Analytics comprueban la misma marca antes de eventos tardíos.

## Migraciones y despliegue

La migración publicada `connectors.0003_autorizacion_y_revocacion` se conserva
idéntica a main. Se retiran la antigua `0002_cuenta_revocada`, su helper y la unión
`0004_unir_eliminacion_oauth`. Las bases locales desechables que ejecutaron esas
migraciones experimentales deben recrearse por su responsable; este cambio no
intenta reconciliarlas modificando migraciones publicadas. Las actualizaciones
desde `0002_importaciones` y `0003_autorizacion_y_revocacion` preservan datos.
Auth agrega `0015_eliminacionusuario` y Notifications `0004_usuarioeliminado`.
Todos los consumidores aplican también `borrado.0001_initial` en su propio esquema.

Compose ya ejecuta el worker. Kubernetes incorpora `auth-eliminaciones` y genera
`ELIMINACION_INTERNA_SECRET` si falta en el Secret existente. El worker espera las
migraciones de Auth sin ejecutarlas en paralelo. La demo solo despliega
Subscriptions, por eso configura `ELIMINACION_DESTINOS=subscriptions`; esto no
despliega ni acredita Connectors, Analytics o Notifications en ese cluster.
El HPA de Gateway queda en máximo 2, igual que Subscriptions: 10 pods en reposo y
12 al escalar. Presupuesto máximo: 2688 MiB de límite de memoria y 1750 milicores.
La CI comprueba ese presupuesto. No se ejecutó un despliegue ni revocación real.

## Validación

Las suites de Auth, Subscriptions, Connectors, Analytics y Notifications corren
con PostgreSQL local. Las regresiones cubren rollback, reintentos, firmas,
limpieza personal y rechazo de recreación, Gmail confirmado junto a Outlook sin
revocación, credenciales ilegibles, migraciones y aislamiento A/B. PostgreSQL
comprueba escrituras concurrentes por HTTP, que la limpieza espere una escritura
en vuelo en ambos modos de eventos y que una revocación ya confirmada sobreviva a
que otra conexión termine la de la limpieza.
El proveedor OAuth y el transporte entre servicios usan dobles explícitos.
La prueba de Gateway ejecuta `gateway.app.proxy` y Auth en un proceso; no acredita
servidores desplegados. Las dos pruebas de DELETE de #73 pasan a
`tests/test_aislamiento_eliminacion_gateway.py`; registro y GET/PATCH se separan
en una entrega directa a main.
