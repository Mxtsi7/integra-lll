# Despliegue en Kubernetes

Seguridad D-11: antes de migrar, leer [aislamiento de red y secretos](../docs/seguridad-d11.md).
El despliegue configura roles PostgreSQL por esquema y aplica `40-red.yaml`.
Hace falta un CNI con NetworkPolicy y un `GHCR_TOKEN` de lectura explícito.
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
| `gateway` / `subscriptions` | HorizontalPodAutoscaler | Escalan por CPU: 1→3 y 1→2 (ver `30-autoescalado.yaml`) |

`connectors`, `analytics` y `notifications` **no** se despliegan: todavía no
tienen `manage.py`. Meterlos solo agregaría tres pods en `CrashLoopBackOff`.

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

| Recurso | Tope | En reposo (9 pods) | Peor caso (HPA al máximo, 12 pods) |
|---|---|---|---|
| `limits.memory` | 2752Mi | 1760Mi | 2496Mi |
| `requests.memory` | 1152Mi | 648Mi | 888Mi |
| `limits.cpu` | 2000m | 1150m | 1750m |
| `requests.cpu` | 1000m | 375m | 525m |
| `pods` | 12 | 9 | 12 |

**Una `ResourceQuota` no mata los pods que ya están corriendo**, solo bloquea
los nuevos. Por eso un despliegue puede venir funcionando semanas y reventar
recién al siguiente `rollout`. Si ves `exceeded quota` en `kubectl get events`,
es esto.

Para recalcular el presupuesto después de tocar un límite, sin aplicar nada:

```bash
python k8s/pruebas/presupuesto.py k8s
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

No se pueden consultar (`kubectl get resourcequota` y `get ingressclass` dan
`Forbidden`): se descubren chocando. Quedan acá para que nadie las vuelva a
pelear.

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
