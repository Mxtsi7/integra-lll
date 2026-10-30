# D-11: aislamiento de red y secretos

## Cambios

- Compose publica solo frontend y gateway. Cada dominio comparte una red
  propia con gateway, sus workers e infraestructura. La web y los otros
  dominios no pueden conectarse directamente a esa API.
- `k8s/40-red.yaml` deniega entradas a los pods de esta aplicación y permite
  gateway → dominio, web/Ingress → gateway, Ingress → web y dominio/workers →
  infraestructura en sus puertos concretos. El panel RabbitMQ queda bloqueado.
  OAuth y SMTP conservan salida: no se restringe egress.
- RabbitMQ usa un usuario dedicado y contraseña aleatoria en el Secret
  `ojoalgasto-rabbitmq`; su URL ya no está en ConfigMap. El despliegue actual
  no persiste su base interna: al recrear el pod nace el usuario nuevo.
  `actualizar-rabbitmq.py` exige un drenaje verificable antes de reemplazarlo.
  Si se agrega un PVC, migrar usuarios con `rabbitmqctl`, sin borrar las colas.
- Kubernetes configura los roles `svc_auth`, `svc_subscriptions`,
  `svc_connectors`, `svc_analytics` y `svc_notifications`, sin privilegios
  administrativos y con propiedad de su propio esquema. Transfiere propiedad
  de tablas y secuencias previas para permitir migraciones sin borrar datos.
- Auth y subscriptions, sus initContainers y workers reciben `DATABASE_URL`
  de su propio Secret. No reciben contraseña ni URL administrativa. Los otros
  tres roles quedan preparados para futuros Deployments, que deberán usar
  sus respectivos Secrets `ojoalgasto-bd-<servicio>`.
- El borrador `infra/k8s/base/config.yaml` ya no puede sobrescribir secretos
  reales con una plantilla. Seed demo apagado por defecto. Se exige un token
  de lectura de imágenes explícito en lugar del token de escritura de `gh`.

## Desarrollo con Compose

Completar `.env` con claves aleatorias; por ejemplo:
`python -c "import secrets; print(secrets.token_hex(32))"`.
`POSTGRES_PASSWORD` y `RABBITMQ_PASSWORD` son obligatorias. La clave de Postgres
debe coincidir con `DATABASE_URL`. Compose construye la URL RabbitMQ para sus
clientes desde las mismas variables del broker. Usar claves hexadecimales
evita escapes URL. En ejecuciones fuera de Compose, completar `RABBITMQ_URL`.

La API sigue accesible por `http://localhost:8000/api/`. Para depurar servicios,
usar herramientas dentro del contenedor o un override local que publique el
puerto **solo en 127.0.0.1**. No volver a exponerlos en todas las interfaces.

Compose mantiene el usuario PostgreSQL de desarrollo de `.env`; el aislamiento
de usuarios por esquema se aplica a Kubernetes. No usar Compose en producción.
Una base Compose ya inicializada conserva su contraseña: editar `.env` no la
rota. Cambiarla mediante `ALTER USER` y sincronizar `DATABASE_URL`, sin borrar
el volumen para resolver problemas de credenciales.

## Migración de Kubernetes

1. Programar mantenimiento y respaldar. La transferencia de propiedad puede
   bloquear tablas brevemente; no borra ni recrea datos.
2. Confirmar que el CNI aplica NetworkPolicy. Los selectores admiten Ingress
   nginx (`ingress-nginx` o `rke2-ingress-nginx`, componente `controller`) en
   namespaces `ingress-nginx` o `kube-system`. Adaptarlos si el clúster usa
   otras etiquetas. Sin soporte efectivo del CNI, no hay aislamiento.
3. Definir `GHCR_TOKEN` con `read:packages` y las variables habituales. Ejecutar
   `bash k8s/desplegar.sh` (requiere Python 3). Primero verifica y actualiza
   RabbitMQ con el procedimiento siguiente. Prepara Postgres, conserva Secrets, configura
   roles y luego aplica dominio y políticas. Los reintentos reutilizan las
   contraseñas guardadas; no borrar los Secrets de roles existentes.
4. Comprobar login y suscripciones por web/gateway. Desde gateway, `/health/`
   de auth debe responder; desde web, otro dominio o un pod sin autorización,
   debe fallar por bloqueo de red. Repetir desde otro namespace si hay permisos.
   Comprobar antes resolución DNS y existencia del Service: un fallo de DNS no
   demuestra aislamiento. Las sondas de kubelet conservan su funcionamiento.
5. Verificar `SELECT current_user` desde las conexiones Django: `svc_auth` y
   `svc_subscriptions`, sin imprimir URLs ni contraseñas. Los workers usan
   el rol de subscriptions. No volver a importar el Secret administrativo
   completo mediante `envFrom` en servicios de aplicación.

### Broker existente sin volumen

Durante mantenimiento, detener la carga de usuarios y los publicadores externos,
dejando los consumidores y el despachador del outbox activos para drenar.
El despliegue espera hasta 60 comprobaciones, separadas por 2 segundos
(`RABBIT_DRENAR_INTENTOS` y `RABBIT_DRENAR_PAUSA`). Consulta **todos** los vhosts
y colas, incluida `subscriptions.resumen.fallidos`, y cuenta mensajes listos y
sin ACK. Un error, cola no disponible o contador desconocido aborta; no equivale a cero.

Al llegar a cero suspende nuevas conexiones, cierra las existentes y vuelve a
comprobar conexiones y mensajes antes de aplicar el manifiesto. Así no queda
una ventana para que un publicador confirme mensajes entre la lectura y el
reemplazo. Los eventos que no obtengan confirmación siguen pendientes en outbox.
Si llega trabajo durante el cierre, aborta y reanuda el broker original para
drenar y reintentar. No se borran, purgan ni marcan eventos como consumidos.
Las colas exclusivas o autoeliminables requieren preservación manual antes de
migrar: cerrarlas podría destruir mensajes. También se aborta si falta el pod
original o no está listo. No ejecutar despliegues concurrentes ni aplicar
`02-redis-rabbitmq.yaml` directamente para saltarse esta protección.

Si la DLQ no se vacía, investigar y reprocesar o preservar sus mensajes fuera
del pod y comprobar esa copia antes de retirar la cola; el script no decide
que esos eventos son descartables. Un respaldo de PostgreSQL no respalda
los mensajes ya confirmados por RabbitMQ. Si se interrumpe la terminal de forma
irrecuperable o falla la aplicación/rollout después de solicitar el reemplazo,
el broker original permanece suspendido: no reabrirlo mientras el controlador
pueda eliminarlo. Verificar o cancelar primero el reemplazo pendiente y solo
entonces ejecutar allí `rabbitmqctl resume_listeners`. La restauración automática
solo actúa sobre el UID original, nunca sobre un reemplazo.

### Pruebas de carga con políticas activas

Aplicar `40-red.yaml` antes de las pruebas. `carga-fortio`, `carga-comparar` y el
pod `diagnostico` pueden entrar al gateway en su namespace, en TCP 8000.
Conservan el bloqueo de acceso directo a auth/subscriptions y desde otro namespace;
no se debe etiquetar un generador como gateway para eludirlo.

Para comparar cola, registrar dos cuentas de prueba en organizaciones distintas
y vacías e iniciar sesión normalmente por `/api/auth/login/`. Exportar sus
`access_token` como `TOKEN_SIN` y `TOKEN_CON` y ejecutar
`bash k8s/pruebas/comparar-cola.sh`. Las sesiones deben durar ambas corridas
(reducir `DURACION` si es necesario). El script valida cada sesión con la lógica
de Gateway, toma su organización, rechaza organizaciones iguales y usa un Secret
temporal para la cabecera Bearer. Borra ese Secret al salir. No imprime tokens.
Gateway determina la identidad; no se permite enviar `X-Organizacion-Id` a mano.
Un HTTP distinto de 201 invalida la medición y restaura la configuración.
La latencia incluye Gateway, por lo que su límite de CPU puede dominar el resultado.
Las pruebas de otro namespace contra el Service interno son negativas de aislamiento;
no se habilita acceso entre namespaces para recuperar esa carga.

## Rotación de secretos expuestos

Esta PR **no rota la contraseña del clúster** ni demuestra que una clave
histórica haya sido invalidada. Para PostgreSQL usar el procedimiento existente,
que sincroniza `ALTER USER` con el Secret:

```bash
bash k8s/rotar-clave-postgres.sh            # ensayo
bash k8s/rotar-clave-postgres.sh --aplicar  # durante mantenimiento
```

Revisar su resultado: debe verificar la nueva clave y el rechazo de la anterior.
Migrar a usuarios por servicio no invalida por sí mismo la clave administrativa
filtrada. El procedimiento reinicia servicios y comprueba salud.

Si se expusieron JWT, OAuth u otras claves, rotarlas en su emisor y actualizar
su Secret. JWT invalida sesiones anteriores. Fernet requiere conservar claves
de descifrado hasta recifrar los datos (ver `shared/cifrado/README.md`). No
regenerar todas las credenciales automáticamente en cada despliegue.

## Verificación

```bash
python -m pip install pytest PyYAML 'psycopg[binary]'
TEST_DATABASE_ADMIN_URL=postgresql://postgres:clave@localhost:5432/postgres \
  python -m pytest scripts/tests/ -q
bash -n k8s/desplegar.sh
bash -n k8s/configurar-usuarios-bd.sh
bash -n k8s/pruebas/comparar-cola.sh
bash -n k8s/pruebas/estresar.sh
bash k8s/pruebas/probar-comparar-cola.sh
```

Usar PostgreSQL exclusivo de pruebas: se crea una base temporal y roles `svc_*`.
Se prueban permisos entre esquemas, migraciones de tablas previas, conservación
de datos e idempotencia. CI valida Compose y autentica contra un RabbitMQ real:
usuario dedicado aceptado y `guest/guest` rechazado. Las pruebas de selectores
no sustituyen una prueba de conectividad con el CNI del clúster.

Referencias: [NetworkPolicy de Kubernetes](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
y [control de acceso de RabbitMQ](https://www.rabbitmq.com/docs/access-control).
