# Despliegue en Kubernetes

Seguridad D-11: antes de migrar, leer [aislamiento de red y secretos](../docs/seguridad-d11.md).
El despliegue configura roles PostgreSQL por esquema y aplica `40-red.yaml`
**si la cuenta puede crear NetworkPolicy**. Hace falta un CNI que las haga
cumplir y un `GHCR_TOKEN` de lectura explícito.

> **En el cluster del ramo hoy NO hay ninguna política de red aplicada.** El
> rol de estudiante solo da lectura sobre `networkpolicies` (verificado el
> 10-11-2026 con `kubectl auth can-i` y con `kubectl get networkpolicy`, que
> devuelve vacío). `desplegar.sh` lo detecta, salta `40-red.yaml` y lo avisa al
> terminar. Mientras siga así, cualquier pod del cluster que conozca el nombre
> de un Service interno puede hablarle directo, sin pasar por el gateway: el
> aislamiento que describe `docs/seguridad-d11.md` está escrito y probado, pero
> no desplegado.
La contraseña histórica de PostgreSQL requiere la rotación indicada abajo;
la PR por sí sola no la invalida.

El sistema completo corriendo en el cluster del ramo:
**https://ojoalgasto-forellana.dev.censei.cl**

> El navegador va a mostrar una advertencia de certificado. Es esperable: el
> cluster no tiene cert-manager y nginx sirve un certificado de relleno. Hay
> que entrar por «Avanzado → Continuar».

## Qué se despliega

| Pieza | Tipo | Notas |
|---|---|---|
| `postgres` | StatefulSet + PVC 2Gi | Un esquema por servicio, creado al primer arranque (ADR-002) |
| `redis` | Deployment | Broker de Celery |
| `rabbitmq` | Deployment | Bus de eventos del ADR-003; todavía nadie publica en él |
| `auth` | Deployment | Migra y siembra en un initContainer, después gunicorn |
| `subscriptions` | Deployment | Ídem |
| `subscriptions-worker` / `-beat` | Deployment | El Temporizador del RF-13 |
| `gateway` | Deployment | Único punto de entrada (ADR-004) |
| `web` | Deployment | SPA compilada + nginx, que además hace de proxy hacia el gateway |
| `auth-eliminaciones` | Deployment | Reintenta la limpieza durable de organizaciones e integrantes |
| `gateway` / `subscriptions` | HorizontalPodAutoscaler | Escalan por CPU: 1→2 y 1→2 (ver `30-autoescalado.yaml`) |

`connectors` y `analytics` **no** se despliegan todavía: no tienen manifiestos
(lo que falta está en `tandas/perfiles.yaml`). `notifications` sí, pero **no en
este namespace**: ver la sección siguiente.

## Reparto entre namespaces

El núcleo usa 10 de los 12 pods de la cuota y los 2 que quedan son del
autoescalado: los servicios que faltan no caben. Como cada integrante tiene su
propio namespace con su propia cuota, esos servicios corren **en el namespace de
otro integrante** y siguen usando el PostgreSQL, el RabbitMQ y el Redis de acá.

| Namespace | Qué corre |
|---|---|
| `student-forellana` (núcleo) | Todo lo de la tabla de arriba, incluidos los datos |
| el anotado en `reparto.env` | `notifications`: API + consumidor en un pod, y el CronJob `generar-alertas` |

Quién tiene qué está escrito en [`reparto.env`](reparto.env), que leen los dos
guiones. No es una variable de entorno a propósito: si dependiera de acordarse
de exportarla, un despliegue del núcleo sin ella dejaría al gateway buscando el
servicio donde no está.

```bash
./k8s/desplegar.sh                          # el núcleo, como siempre
./k8s/desplegar-satelite.sh notifications   # el servicio, en el namespace anotado
SOLO_ENSAYAR=1 ./k8s/desplegar-satelite.sh notifications   # valida y no cambia nada
```

El guion del satélite apunta el núcleo solo después de ver al consumidor
conectado. Lo espera consultando sus logs cada `PAUSA_CONSUMIDOR` segundos (3
por omisión) durante `PLAZO_CONSUMIDOR` segundos como máximo (120). Si el plazo
vence, aborta y el núcleo queda como estaba.

**Cómo se hablan.** Dentro de un namespace basta el nombre corto del Service
(`postgres`). Desde otro hay que calificarlo: `postgres.student-forellana`.
`satelite.py` reescribe esas direcciones al copiar la configuración, y agrega
el nombre calificado del servicio a `ALLOWED_HOSTS` (el gateway lo llama por
ese nombre y Django rechaza con 400 un `Host` que no conoce). En el núcleo,
`URL_NOTIFICATIONS` pasa a ser `http://notifications.<satélite>:8005`; la usan
el gateway para enrutar y Auth para el borrado de organizaciones.

**Qué secretos cruzan.** Solo las claves que el servicio lee, nombradas una a
una en `desplegar-satelite.sh`: la credencial de lectura del registro,
`SECRET_KEY`, `ELIMINACION_INTERNA_SECRET`, la URL del rol `svc_notifications`
(restringido a su esquema) y la URL del broker. **No cruzan** la clave
administradora de PostgreSQL, el secreto de los JWT, las claves de cifrado de
los conectores ni la cuenta de correo. Lo que cruza lo puede leer el dueño del
namespace satélite: es un integrante del equipo, pero conviene saberlo.

**Permisos.** Quien despliega necesita escribir en los dos namespaces. El dueño
del satélite lo concede una vez, con su cuenta:

```bash
kubectl create rolebinding acceso-nucleo --clusterrole=student-workspace-admin --user=ldap:USUARIO
```

**Lo que hay que tener presente:**

- Funciona porque el cluster **no** tiene políticas de red entre namespaces
  (ver arriba). `40-red.yaml` tal como está escrito lo impediría: si algún día
  se pueden aplicar, hay que agregarle el namespace satélite como origen
  permitido hacia PostgreSQL, RabbitMQ y el servicio.
- Si el satélite se cae, el núcleo sigue funcionando: `/api/alertas/` responde
  502 o 504 y los eventos se acumulan en la cola `notifications.dominio.v2` del
  broker (tope de 1000; al llenarse el outbox reintenta). El borrado de una
  organización queda esperando el ACK de `notifications` hasta que vuelva.
- El núcleo y el satélite tienen que estar en la **misma versión**: comparten
  el contrato de eventos. Desplegar uno sin el otro es desplegar a medias.
- La cuota del satélite es la de su dueño y puede ser menor que la de acá.

## Rotar la clave de Postgres

La clave de la base estuvo en `k8s/00-configuracion.yaml`, dentro de un
`DATABASE_URL`, en un repo público. El commit que la sacó del archivo **no la
invalidó**: la base siguió usándola, y sigue siendo la misma hoy.

```bash
./k8s/rotar-clave-postgres.sh            # ensayo, no toca nada
./k8s/rotar-clave-postgres.sh --aplicar
```

### Por qué no basta con editar el Secret

Dos cosas se sumaron:

- `desplegar.sh` solo genera una clave aleatoria **si el Secret no existe**. El
  Secret ya existía, así que esa rama nunca corrió.
- `POSTGRES_PASSWORD` solo se aplica en el **primer arranque** de Postgres. Con
  la base ya inicializada, cambiar esa variable no cambia nada.

Por eso el script hace `ALTER USER` dentro del pod y recién después actualiza
el Secret, con `POSTGRES_PASSWORD` y `DATABASE_URL` en el mismo patch: si
quedaran desincronizados, ningún servicio podría conectar.

### Hay una ventana de corte

Entre el `ALTER USER` y el reinicio de los servicios, las conexiones ya
abiertas siguen funcionando pero las nuevas fallan. Django abre una por
petición, así que el sitio responde error durante el reinicio —alrededor de un
minuto—. **No correrlo durante la demo.**

Cómo saber si todavía está la vieja, sin imprimirla:

```bash
kubectl get secret ojoalgasto -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d | wc -c
```

8 caracteres es la publicada. Las que genera el script son de 32.

## El presupuesto de recursos

El namespace tiene una `ResourceQuota` (`student-provisioner-quota`) que no se
puede subir. Los límites de cada pod están calculados para que **el HPA tenga
espacio donde escalar**: si la cuota está llena, el autoescalado no sirve de
nada, porque el pod nuevo recibe `exceeded quota` y nunca nace.

| Recurso | Tope | En reposo (10 pods) | Peor caso (HPA al máximo, 12 pods) |
|---|---|---|---|
| `limits.memory` | 2752Mi | 2176Mi | 2688Mi |
| `requests.memory` | 1152Mi | 776Mi | 952Mi |
| `limits.cpu` | 2000m | 1350m | 1750m |
| `requests.cpu` | 1000m | 425m | 525m |
| `pods` | 12 | 10 | 12 |

**Una `ResourceQuota` no mata los pods que ya están corriendo**, solo bloquea
los nuevos. Por eso un despliegue puede venir funcionando semanas y reventar
recién al siguiente `rollout`. Si ves `exceeded quota` en `kubectl get events`,
es esto.

Para recalcular el presupuesto después de tocar un límite, sin aplicar nada:

```bash
python k8s/pruebas/presupuesto.py k8s --generador k8s/pruebas/carga-fortio-otro-namespace.yaml --namespace-generador student-TUUSUARIO
```

### Los límites salen de medir

`kubectl top` no está permitido para nuestro usuario (RBAC), así que se lee del
cgroup de cada pod. El `MSYS_NO_PATHCONV` es obligatorio en Git Bash: sin él la
ruta `/sys/...` se convierte en `C:/Program Files/Git/sys/...` y falla.

```bash
export MSYS_NO_PATHCONV=1
for p in $(kubectl get pods -o jsonpath='{.items[*].metadata.name}'); do
  usado=$(kubectl exec "$p" -- cat /sys/fs/cgroup/memory.current)
  echo "$p -> $(( usado / 1048576 )) Mi"
done
```

Medición del 2026-10-19, con los 9 pods arriba:

| Pod | Uso real | Límite |
|---|---|---|
| `web` | 8Mi | 64Mi |
| `redis` | 14Mi | 64Mi |
| `postgres` | 69Mi | 192Mi |
| `subscriptions-beat` | 77Mi | 160Mi |
| `gateway` | 83Mi | 224Mi |
| `auth` | 121Mi | 256Mi |
| `subscriptions` | 128Mi | 288Mi |
| `rabbitmq` | 136Mi | 256Mi |
| `subscriptions-worker` | **359Mi** → ver abajo | 256Mi |

El worker se salía del molde: `celery worker` sin `--concurrency` levanta un
proceso hijo **por core del nodo**, y los nodos tienen 16. Eran 16 procesos
peleándose 200m de CPU. Con `--concurrency=2` entra holgado.

## Desplegar

```bash
gh auth token | docker login ghcr.io -u <tu-usuario> --password-stdin
./k8s/desplegar.sh
```

El script construye las cuatro imágenes, las publica, crea los secretos si no
existen y aplica los manifiestos. Para aplicar sin reconstruir:
`SOLO_APLICAR=1 ./k8s/desplegar.sh`.

## Por qué hay Dockerfiles aparte

Los Dockerfiles de cada servicio no sirven tal cual en Kubernetes:

- El de los servicios tiene como contexto la carpeta del servicio, así que
  **`shared/` queda afuera**. En `docker compose` eso se tapa con un bind
  mount; en Kubernetes no hay bind mounts y la imagen tiene que traerlo
  adentro. Por eso `Dockerfile.servicio` se construye desde la raíz del repo.
- El de la web corre `vite dev`, el servidor de desarrollo. `Dockerfile.web`
  compila la SPA y la sirve con nginx.

Ninguno reemplaza a los de nadie: conviven.

## Reglas del cluster del ramo

Durante semanas no se pudieron consultar y se descubrieron chocando. Desde
noviembre la cuota y el LimitRange **sí se leen** (`kubectl get resourcequota`,
`kubectl get limitrange -o yaml`); lo demás sigue quedando acá para que nadie
lo vuelva a pelear.

Cuota de `student-forellana` al 10-11-2026: **12 pods**, 2 CPU y 2752 Mi en
límites, 1 CPU y 1152 Mi en solicitudes, 3 PVC, 10 Services. Por contenedor:
mínimo 25m / 64Mi, **máximo 500m / 512Mi**. No todos los namespaces tienen la
misma: el de otro integrante mostró 2 Gi de memoria en límites y 1 Gi en
solicitudes. Revisar la propia antes de calcular.

| Regla | Consecuencia |
|---|---|
| Mínimo **25m de CPU y 64Mi** por contenedor | Nada puede pedir menos |
| Techo de **2 CPU** en límites para todo el namespace | Los límites están repartidos a mano; suman 1600m para dejar holgura |
| Con la cuota al tope, un `RollingUpdate` se traba | Todos los Deployments usan `strategy: Recreate` |
| El Ingress exige `ingressClassName: nginx` | — |
| El hostname debe ser `<algo>.dev.censei.cl` (un solo nivel) | — |
| Exige la anotación `external-dns…/target: proxy.inf.uct.cl` | — |
| **Cada hostname puede usar solo el path `/`** | No se puede tener `/api` y `/` en el mismo dominio |
| **Cada Ingress publica exactamente un hostname** | Un objeto por dominio |

Las dos últimas son las que definieron el diseño: en vez de dos dominios (uno
para la web y otro para la API, cada uno con su certificado que el navegador
rechaza), **el nginx de la web hace de proxy hacia el gateway en `/api/`**. Así
hay un solo dominio, un solo certificado que aceptar, y el CORS desaparece
porque todo queda en el mismo origen.

## Detalles que cuesta descubrir

- **La etiqueta de la imagen se reutiliza** (es el hash corto del commit). Con
  `imagePullPolicy` por defecto, el nodo sirve la imagen que ya tiene en caché
  y un `rollout restart` no baja la nueva. Por eso va `Always`.
- **`DEBUG=False` hace que Django rechace Hosts desconocidos**, y las sondas de
  Kubernetes llegan con la IP del pod. Las `httpGet` mandan la cabecera `Host`
  explícita.
- **El worker de Celery no tiene sonda de readiness**: no atiende tráfico (no
  tiene Service) y `celery inspect ping` tarda más que cualquier timeout
  razonable con el CPU acotado. Que está vivo se ve en sus logs.
- **Las imágenes son privadas** en GHCR: el cluster las baja con el Secret
  `ghcr`, que crea el script de despliegue. Es obligatorio pasar un token de
  solo lectura en `GHCR_TOKEN` (`read:packages`).
- **`DATABASE_URL` vive en el Secret**, no en el ConfigMap: lleva la
  contraseña adentro y se arma con la misma clave que recibe Postgres. Ojo:
  `POSTGRES_PASSWORD` solo se aplica en el primer arranque, con el disco
  vacío. Cambiarla después en el Secret no cambia la de la base; hay que
  entrar con `psql` y hacer `ALTER USER`, o borrar el PVC y empezar de cero.

## Comandos del día a día

```bash
kubectl get pods                          # qué está corriendo
kubectl logs -f deployment/gateway        # seguir un log
kubectl port-forward service/web 8090:80  # abrir la web sin pasar por internet
kubectl exec -it postgres-0 -- psql -U postgres -d suscripciones
```


## Limpieza de cuentas (MX-07)

`10-auth.yaml` incluye `auth-eliminaciones`; espera que Auth migre antes de ejecutar
el worker durable. `desplegar.sh` añade `ELIMINACION_INTERNA_SECRET` al Secret si
falta, sin rotar las demás credenciales. Todos los consumidores usan ese secreto.
La demo configura `ELIMINACION_DESTINOS=subscriptions` porque es su único consumidor
desplegado. Agregar Connectors/Analytics/Notifications exige desplegarlos, migrarlos
y agregarlos a la lista antes de que almacenen datos. No retirar destinos de un
entorno que ya tiene datos: las operaciones existentes conservan sus ACK pendientes.
Ver [flujo y límites](../docs/flujos/maximiliano-saez/07-eliminar-cuenta.md).

## Purga de archivos de importación (FE-07)

Este cluster **no tiene un CronJob de purga**, y no es un olvido:

- `connectors` no tiene Deployment acá, así que nadie sube archivos y su
  esquema no se migra. Un CronJob purgaría una tabla que no existe.
- Con los dos HPA al máximo se usan los 12 pods de la cuota, que no se puede
  subir. El pod de la purga sería el 13.º y no podría crearse justo en un pico.

La purga corre donde corre `connectors`: en `docker-compose.yml` es el
servicio `connectors-purga`, una vez por hora y después de que `connectors`
migró. Cuando `connectors` se despliegue en este cluster, su purga tiene que
llegar con él y entrar en el presupuesto: `presupuesto.py` cuenta cada
`CronJob` en el peor caso y falla si no cabe, y una prueba exige que el
despliegue aplique todos los manifiestos numerados de `k8s/`.

Esa prueba mira las tres vías por las que `desplegar.sh` aplica un
manifiesto: el ciclo con los reemplazos de imagen, los `kubectl apply -f`
sueltos de antes de las migraciones, y los que aplica un guion que él invoca
—`02-redis-rabbitmq.yaml` va por ahí desde D-11, porque el broker se drena
antes de reemplazarlo—. Lo que exige no es que vaya por el ciclo, sino que
alguna vía lo aplique.
