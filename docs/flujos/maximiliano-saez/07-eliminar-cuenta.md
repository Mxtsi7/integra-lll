# MX-07 — Eliminar cuenta (RF-01.7)

`DELETE /api/usuarios/me/` recibe identidad del gateway, contrasta usuario activo
y organización en auth y exige la contraseña actual y confirmación literal:

```json
{"password": "contraseña actual", "confirmacion": "ELIMINAR"}
```

- Integrante o titular con otro titular activo: revoca todas sus sesiones en
  Redis, elimina únicamente su usuario y responde `204`. Conserva la organización.
- Usuario legítimo sin organización: acepta la ausencia de `X-Organizacion-Id`,
  reautentica, revoca sus sesiones y elimina solo su perfil con `204`, sin outbox.
  Si tiene organización, omitir la cabecera devuelve `403`; enviar una organización
  ajena devuelve `404`, incluso para un usuario sin organización.
- Último titular activo: exige también `"confirmacion_organizacion": "ELIMINAR"`.
  Sin ese campo responde `409`, sin cambios. Con confirmación revoca primero las
  sesiones de todos sus usuarios, elimina esos usuarios y persiste una operación
  de limpieza en la misma transacción. Responde `202` con `operacion_id` y
  `estado=pendiente`; todavía no declara completada la limpieza de la organización.
- Contraseña incorrecta o contexto de usuario ausente: `403`; contexto de otra organización:
  `404`; cuerpo inválido: `400`; Redis no disponible: `503` sin borrado SQL.
  Si Redis falla tras revocar algún usuario, ese usuario debe volver a iniciar sesión.

Se bloquea la organización durante la decisión de último titular. El registro
con código también adquiere ese bloqueo y rechaza organizaciones en eliminación.
La lista de afectados siempre deriva de la organización del usuario autenticado;
no se acepta un identificador de usuario u organización en el cuerpo.

RF-01.7 conserva de forma disociada la fecha de consentimiento existente durante
seis años calendario desde la eliminación. `ConsentimientoDisociado` guarda
únicamente un UUID aleatorio, `consentimiento_en`, `eliminado_en` y `retener_hasta`;
no tiene FK ni identificador de usuario/organización, correo, nombre o hash de
identidad. Solo se copian fechas no nulas de los usuarios afectados en la misma
transacción del borrado. Si falla la operación, tampoco queda una copia parcial.
No se expone mediante API, serializer, admin ni exportación. La versión/texto del
consentimiento no existe en los datos previos y permanece desconocida; no se
reconstruye ni se inventa. Aplicar `0010_retencion_consentimiento`.

El worker de eliminaciones purga estos registros al alcanzar `retener_hasta`,
incluidas las pasadas manuales sin operaciones pendientes. Para eliminaciones
del 29 de febrero, la retención vence el 28 de febrero del sexto año.

## Coordinación y reintentos

`auth.eliminacion_organizacion` guarda UUID de operación, UUID de organización,
servicios pendientes y fechas. No guarda correo, contraseña ni tokens. La
migración `0007_eliminacion_organizacion` debe aplicarse antes de servir tráfico.
El UUID de organización queda como marca de la eliminación y permite reintentar
sin depender de la existencia de sus usuarios.

El worker `auth-eliminaciones` de Compose ejecuta `procesar_eliminaciones
--continuo` cada 60 segundos. Arranque y pasada manual:

```bash
docker compose up -d --build auth auth-eliminaciones subscriptions connectors analytics notifications
docker compose exec auth python manage.py procesar_eliminaciones
```

Los entrypoints de Connectors, Analytics y Notifications esperan PostgreSQL y
ejecutan `migrate --noinput` antes de servir HTTP. Por eso también aplican
`borrado.0001_initial`; Connectors aplica además `0002_cuenta_revocada`.
El worker de eliminaciones espera los healthchecks de auth y de los cuatro
consumidores. El worker de Connectors espera su servidor ya migrado y omite
migraciones duplicadas con `APLICAR_MIGRACIONES=0`.

El worker envía órdenes HTTP privadas por servicio, conforme a la regla 2 del
catálogo de eventos: una orden no se publica como si fuera un hecho consumado.
Cada servicio borra exclusivamente sus propios modelos mediante:

```http
DELETE /internal/organizaciones/<uuid>/
X-Eliminacion-Instante: <unix-segundos>
X-Eliminacion-Firma: <HMAC-SHA256>
X-Correlation-ID: <operacion_id>
Content-Type: application/json

{"operacion_id": "<uuid>"}
```

La firma cubre `servicio:organizacion_id:operacion_id:instante` y caduca a los
60 segundos. Requiere `ELIMINACION_INTERNA_SECRET` independiente, compartido por
auth y consumidores, suministrado por el entorno y sin valor en `.env.example`.
Estas rutas no pertenecen a `/api/` ni se enrutan desde el gateway. Los servicios
deben permanecer en la red privada según ADR-004.

`URL_SUBSCRIPTIONS`, `URL_CONNECTORS`, `URL_ANALYTICS` y `URL_NOTIFICATIONS`
permiten configurar los destinos internos. Cada llamada limita conexión a 2 s y
lectura a 5 s, sin redirecciones. Solo `204` elimina el destino de pendientes;
fallo de red, firma, `409` o caída del proceso conserva el trabajo para reintento.
La entrega puede repetirse: los handlers son idempotentes. Cuando llegan los
cuatro ACK se elimina la organización en auth y se completa la operación. No hay
consultas ni claves foráneas entre esquemas (ADR-002).

## Datos cubiertos y límites de integración

- Subscriptions: elimina cobros, registros de uso, historial de transiciones y suscripciones del UUID.
  Conserva el catálogo global de proveedores. Si una FK local inconsistente
  conecta un hijo de otro tenant, devuelve `409` y conserva los datos para que
  se corrija la inconsistencia, evitando el borrado ajeno por cascada.
- Connectors: marca las cuentas como desconectadas. CSV y cuentas OAuth con
  revocación acreditada se eliminan si no hay revocaciones pendientes en el tenant.
  Si hay cuentas OAuth de Gmail/Outlook sin `revocado_en`, devuelve
  `409 revocacion_proveedor_pendiente`: FE-05 todavía no provee adaptadores para
  revocar la autorización externa. Conserva los tokens cifrados y la operación
  pendiente para permitir esa revocación y reintentar después. Borrar el token
  local no demuestra que el proveedor haya revocado el acceso, tampoco encontrar
  tokens nulos. Aplicar migración `connectors.0002_cuenta_revocada`. FE-05 deberá
  registrar `revocado_en` únicamente tras confirmar la revocación con el proveedor;
  el serializer público no permite editar esa fecha. El siguiente reintento
  elimina las credenciales locales y confirma la limpieza del esquema.
- Analytics y Notifications: sus modelos de dominio están vacíos en esta versión;
  sus ACK corresponden a esa ausencia real de datos. Nuevos modelos tenant deben
  incorporarse al handler dueño antes de almacenar datos de producción.

Cada consumidor instala la app `shared.borrado` y aplica su migración
`borrado.0001_initial` en su propio esquema. Su fila `EstadoOrganizacion` guarda
solo UUID de organización, operación y marca de eliminación. El middleware de
escritura toma un bloqueo sobre esa fila hasta terminar cada POST/PUT/PATCH/DELETE
con contexto tenant. La limpieza toma el mismo bloqueo y persiste la marca antes
de borrar o responder `409`/`204`. Así espera las escrituras en vuelo y rechaza
las posteriores con `410 organizacion_eliminada`, incluso después de reiniciar
el servicio. No usa Redis ni consulta auth para guardar esa marca.

Los futuros trabajos internos que escriban datos deben utilizar el mismo
contrato: `with shared.borrado.bloqueo.escritura_organizacion(organizacion_id):`.
No se debe escribir directamente al ORM desde consumidores o sincronizadores
sin adquirir ese bloqueo. Los servicios vacíos de esta versión aún no ejecutan
trabajos de dominio.

El despliegue Kubernetes actual no incluye todos los consumidores; para completar
la limpieza debe desplegarlos junto al worker/supervisor y el secreto compartido.
Si falta alguno, la operación queda pendiente. Este PR no resuelve FE-05 ni
declara cumplida la revocación externa de cuentas OAuth.

## Validación

Pruebas de negocio y aislamiento con bases PostgreSQL de prueba independientes:

```bash
docker compose run --rm auth pytest tests/test_eliminacion.py -q
docker compose run --rm subscriptions pytest tests/test_eliminacion.py -q
docker compose run --rm connectors pytest tests/test_eliminacion.py -q
```

Cubren integrante, varios titulares, confirmaciones, contexto ajeno, caída de
Redis, outbox/reintentos, aislamiento de cobros/uso, conservación de proveedores,
firmas alteradas/caducadas, CSV y bloqueo recuperable de revocación externa.
