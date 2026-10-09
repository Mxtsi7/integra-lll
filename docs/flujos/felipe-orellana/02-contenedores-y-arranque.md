# 02 · Contenedores, red Docker y arranque de los servicios

**Tareas de la planilla:** Dockerfile de Auth · Dockerfile de Subscriptions ·
Red Docker Auth + Subscriptions + Postgres · Test que ambos servicios hablan
con la DB · Comando migrate al levantar compose · Test migraciones aplicadas ·
Seed de un usuario y datos mínimos.

**Archivos:**

| Archivo | Qué hace |
|---|---|
| `services/auth/Dockerfile`, `services/subscriptions/Dockerfile` | imagen de cada servicio |
| `services/*/entrypoint.sh` | corre `migrate` (y el seed en auth) antes del servidor |
| `docker-compose.yml` | red, orden de arranque, volúmenes |
| `services/auth/app/management/commands/seed.py` | usuario de demostración |
| `services/subscriptions/app/management/commands/seed_subscriptions.py` | 5 suscripciones de ejemplo |
| `services/*/tests/test_migraciones.py` | ningún modelo sin su migración |
| `services/auth/tests/test_seed.py` | 6 pruebas del seed |

## La imagen

Los dos Dockerfiles son iguales salvo el puerto:

```
python:3.12-slim
  + build-essential, libpq-dev, curl      (psycopg y el healthcheck)
  + pip install -r requirements.txt       (capa aparte: se cachea si no cambian)
  + COPY . .                              (el código, tests incluidos)
HEALTHCHECK  curl -f http://localhost:8001/health/
ENTRYPOINT   sh entrypoint.sh
CMD          python manage.py runserver 0.0.0.0:8001
```

Dos detalles que no son obvios:

- `PYTHONPATH=/app` para que `import shared` funcione: `shared/` se monta
  dentro del contenedor en `/app/shared` (solo lectura).
- `ENTRYPOINT ["sh", "entrypoint.sh"]` con `sh` explícito porque el bind mount
  desde Windows no garantiza el bit de ejecución del archivo.

## Red y orden de arranque

Docker Compose crea una red por proyecto y cada servicio se resuelve por su
nombre: `postgres`, `rabbitmq`, `auth`, `subscriptions`, `gateway`. Por eso
`DATABASE_URL` apunta a `postgres:5432` y el gateway a `http://auth:8001`.

```
postgres ──healthy──▶ auth ──┐
rabbitmq ──healthy──▶ subscriptions ──┴──▶ gateway
                       subscriptions ──healthy──▶ subscriptions-worker / -beat
```

`depends_on` con `condition: service_healthy` es lo que ordena todo: un
servicio no arranca hasta que su dependencia pasó el healthcheck.

## Arranque: migraciones y seed

`entrypoint.sh` corre **antes** del comando del Dockerfile, en cada arranque:

```sh
python manage.py migrate --noinput        # idempotente: solo aplica lo que falta
if [ "$SEED_DEMO" = "1" ]; then python manage.py seed; fi   # solo auth
exec "$@"                                 # runserver
```

Así, levantar el sistema desde cero deja la base migrada sin pasos a mano, y
reiniciar un contenedor no rompe nada porque `migrate` no repite lo aplicado.

En Kubernetes esto mismo va en un `initContainer` llamado `migrar`
(`k8s/10-auth.yaml`, `k8s/11-subscriptions.yaml`) para que corra una sola vez
por despliegue y no una vez por réplica.

## El seed

`seed` (auth) crea el usuario de demostración **con su organización**, como
titular. Sin organización el token sale sin `organizacion_id`, el gateway no
inyecta la cabecera y `subscriptions` responde 403: el usuario entraría y no
podría hacer nada. Credenciales desde `SEED_CORREO`, `SEED_CLAVE`,
`SEED_NOMBRE` o los valores de `.env.example`.

Es idempotente: si el correo ya existe no toca nada, ni la clave ni la
organización. La clave pasa por `create_user()`, nunca se guarda en texto
plano.

`seed_subscriptions` (subscriptions) crea 5 suscripciones para la
organización que se le pase (`--organizacion-id` o `SEED_ORGANIZACION_ID`).
Necesita el UUID porque el esquema de subscriptions **no conoce** la tabla de
organizaciones de auth (ADR-002).

```bash
docker compose exec auth python manage.py seed
docker compose exec subscriptions python manage.py seed_subscriptions --organizacion-id <uuid>
```

## Dónde está cada cosa en el código

| Paso | Archivo y línea | Qué buscar |
|---|---|---|
| `shared/` importable dentro del contenedor | `services/auth/Dockerfile:4` | `PYTHONPATH=/app` |
| Healthcheck HTTP de la imagen | `services/auth/Dockerfile:14` | `HEALTHCHECK ... curl -f http://localhost:8001/health/` |
| `sh` explícito por el bind mount de Windows | `services/auth/Dockerfile:17` | `ENTRYPOINT ["sh", "entrypoint.sh"]` |
| Comando del servidor | `services/auth/Dockerfile:18` | `CMD ["python", "manage.py", "runserver", "0.0.0.0:8001"]` |
| Montaje del código y de `shared` | `docker-compose.yml`, `volumes` de `auth` | `./services/auth:/app`, `./shared:/app/shared:ro` |
| Orden de arranque | `docker-compose.yml:71-72` | `depends_on` con `condition: service_healthy` |
| `migrate` en cada arranque | `services/auth/entrypoint.sh:7` y `services/subscriptions/entrypoint.sh:7` | `python manage.py migrate --noinput` |
| Seed solo si `SEED_DEMO=1` | `services/auth/entrypoint.sh:11-13` | `if [ "${SEED_DEMO:-0}" = "1" ]` → `manage.py seed` |
| Entrega el control al servidor | `services/auth/entrypoint.sh:16` | `exec "$@"` |
| `SEED_DEMO=1` en desarrollo | `docker-compose.yml`, `environment` de `auth` | `SEED_DEMO: "1"` |
| El seed: no duplica | `services/auth/app/management/commands/seed.py:46` | `User.objects.filter(email__iexact=correo).exists()` |
| El seed: organización + titular en una transacción | `seed.py:54-56` | `transaction.atomic()`, `Organizacion.objects.create`, `create_user(...)` |
| Seed de 5 suscripciones | `services/subscriptions/app/management/commands/seed_subscriptions.py` | `class Command`, argumento `--organizacion-id` |
| Ningún modelo sin migración | `services/auth/tests/test_migraciones.py:6-10` (ídem subscriptions) | `makemigrations app --check --dry-run` |
| Pruebas del seed | `services/auth/tests/test_seed.py:8-61` | 6 funciones `test_seed_*` |
| Lo mismo en Kubernetes, una sola vez | `k8s/10-auth.yaml:29-36`, `k8s/11-subscriptions.yaml:34` | `initContainers` → `name: migrar` → `command: ["sh", "entrypoint.sh", "echo", ...]` |
| Servidor en el cluster (gunicorn, no runserver) | `k8s/10-auth.yaml:49`, `k8s/11-subscriptions.yaml:47` | `command: ["gunicorn", "config.wsgi:application", ...]` |

El truco del `initContainer` es reutilizar el mismo `entrypoint.sh`: corre
`migrate` y el seed, y como el `$@` es `echo "migraciones listas"`, termina en
vez de levantar un servidor.

## Cómo probarlo

```bash
docker compose up -d postgres auth subscriptions
docker compose ps                                   # los tres "healthy"
docker compose exec auth pytest tests/test_salud.py tests/test_migraciones.py tests/test_seed.py -v
docker compose exec subscriptions pytest tests/test_salud.py tests/test_migraciones.py tests/test_seed_subscriptions.py -v
```

- `test_salud`: el servicio responde `/health/` desde su propio esquema. Es la
  prueba de que "ambos servicios hablan con la DB".
- `test_migraciones`: corre `makemigrations --check --dry-run`. Si alguien
  cambió `models.py` sin generar la migración, falla en el CI antes de que
  llegue a `main`. Nació de un caso real: una migración faltante en auth que
  otra persona habría arrastrado dentro de la suya.
- `test_seed`: clave hasheada, consentimiento, titular de su organización,
  no duplica al repetirse ni cambiando mayúsculas, lee el entorno.

## Qué queda pendiente

- **Test de imagen de Auth / Subscriptions:** no existe. El CI corre los
  tests con `python:3.12-slim` directo, no construye la imagen. La imagen
  solo se verifica cuando `k8s/desplegar.sh` la construye y el pod pasa el
  readiness. Un `docker build` en el CI cerraría esa tarea.
- El seed de subscriptions no corre solo: hay que pasarle el UUID de la
  organización a mano. En producción las cuentas de muestra se cargaron por
  API, no con el seed.
