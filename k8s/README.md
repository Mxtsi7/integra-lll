# Despliegue en Kubernetes

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

`connectors`, `analytics` y `notifications` **no** se despliegan: todavía no
tienen `manage.py`. Meterlos solo agregaría tres pods en `CrashLoopBackOff`.

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
  `ghcr`, que crea el script de despliegue. Pásale un token de solo lectura en
  `GHCR_TOKEN` (`read:packages`); si no, usa el de `gh`, que puede publicar
  paquetes a tu nombre y queda guardado dentro del cluster.
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
