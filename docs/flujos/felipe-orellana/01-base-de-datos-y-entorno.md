# 01 · Base de datos y variables de entorno

**Tareas de la planilla:** Dejar Postgres usable en docker-compose · Testear
conexión a la base · Completar `.env.example` y lectura de env · Test de que
Auth lee el env.

**Archivos:**

| Archivo | Qué hace |
|---|---|
| `docker-compose.yml` (servicio `postgres`) | levanta Postgres 16 con healthcheck |
| `infra/migraciones/01-esquemas.sql` | crea un esquema por servicio en el primer arranque |
| `.env.example` | plantilla de todas las variables; se copia a `.env` |
| `services/*/config/settings.py` | lee `.env` con `django-environ` y arma `DATABASES` |
| `services/*/tests/test_salud.py` | prueba que el servicio responde y está parado en su esquema |

## Flujo de datos

```
.env ──(env_file)──▶ contenedor auth ──▶ settings.py lee DATABASE_URL y ESQUEMA_BD
                                              │
                                              ▼
                              conexión a postgres:5432/suscripciones
                              con  search_path = auth
                                              │
                                              ▼
                              todas las tablas de auth viven en el esquema "auth"
```

1. **Una sola instancia de Postgres, un esquema por servicio** (ADR-002). La
   base se llama `suscripciones`. Al crear el volumen por primera vez,
   Postgres ejecuta `01-esquemas.sql` y crea los esquemas `auth`,
   `subscriptions`, `connectors`, `analytics` y `notifications`.
2. **Cada contenedor recibe `ESQUEMA_BD`** desde `docker-compose.yml`
   (`auth` → `ESQUEMA_BD: auth`, etc.). Esa variable no va en `.env` porque es
   distinta por servicio.
3. **`settings.py` fija el `search_path`** con esa variable:

   ```python
   ESQUEMA_BD = env("ESQUEMA_BD", default=NOMBRE_SERVICIO)
   DATABASES = {"default": env.db("DATABASE_URL")}
   DATABASES["default"]["OPTIONS"] = {"options": f"-c search_path={ESQUEMA_BD}"}
   ```

   Con eso, `CREATE TABLE` y `SELECT` sin prefijo caen en el esquema del
   servicio. Un servicio **no ve** las tablas de otro aunque comparta la
   conexión.
4. **El healthcheck de Postgres** (`pg_isready`) es lo que permite que los
   servicios declaren `depends_on: { condition: service_healthy }`: ningún
   servicio arranca hasta que la base acepta conexiones. Sin eso, `migrate`
   corría antes que Postgres y el contenedor moría al arrancar.

## Lectura de variables de entorno

`.env.example` es la plantilla. Lo que importa de cómo se lee:

- `environ.Env.read_env(RAIZ_REPO / ".env")` carga el archivo **sin pisar**
  variables que ya existan en el entorno. Por eso en Docker y en Kubernetes
  manda lo que inyecta el contenedor, y `.env` solo rellena lo que falta.
- `SECRET_KEY`, `JWT_SECRET` y `DATABASE_URL` **no tienen default**: si
  faltan, el servicio no arranca, que es lo que queremos (mejor que arrancar
  con una clave vacía).
- `JWT_SECRET` tiene que ser **idéntico** en `auth` (firma) y en el gateway
  (valida). Es el único secreto que comparten dos servicios.
- `PBKDF2_ITERACIONES` se agregó en el sprint para el cluster: con las
  870 000 iteraciones por defecto de Django el login tardaba 15 s en una CPU
  limitada a 250m y el gateway cortaba a los 10 s. En local no se define.

## Dónde está cada cosa en el código

| Paso | Archivo y línea | Qué buscar |
|---|---|---|
| Postgres 16 con healthcheck | `docker-compose.yml:13-27` | servicio `postgres`, `healthcheck: pg_isready` |
| Un esquema por servicio al primer arranque | `docker-compose.yml:23` → `infra/migraciones/01-esquemas.sql:5-9` | el `.sql` montado en `docker-entrypoint-initdb.d`, los 5 `CREATE SCHEMA` |
| Los servicios esperan a Postgres | `docker-compose.yml:71` (auth), ídem en subscriptions | `postgres: { condition: service_healthy }` |
| `.env` entra al contenedor | `docker-compose.yml:48, 66` | `env_file: .env` en gateway, auth, subscriptions |
| `ESQUEMA_BD` distinto por servicio | `docker-compose.yml`, bloque `environment` de `auth` y `subscriptions` | `ESQUEMA_BD: auth` / `ESQUEMA_BD: subscriptions` |
| Lectura del `.env` sin pisar el entorno | `services/auth/config/settings.py:15-16` | `env = environ.Env(...)`, `read_env(RAIZ_REPO / ".env")` |
| Variables sin default (si faltan, no arranca) | `services/auth/config/settings.py:20, 104` | `SECRET_KEY = env("SECRET_KEY")`, `JWT_SECRET = env("JWT_SECRET")` |
| Esquema y `search_path` | `services/auth/config/settings.py:60-63` | `ESQUEMA_BD = env(...)`, `DATABASES["default"]["OPTIONS"]` |
| Base de pruebas separada por servicio | `services/auth/config/settings.py:66` | `DATABASES["default"]["TEST"] = {"NAME": "test_auth"}` |
| `JWT_SECRET` compartido con el gateway | `services/auth/config/settings.py:107-108` ↔ `gateway/config/settings.py:59` | `SIMPLE_JWT["SIGNING_KEY"] = JWT_SECRET` en auth; `JWT_SECRET = env(...)` en gateway |
| Iteraciones de PBKDF2 configurables | `services/auth/config/settings.py:41` | `PBKDF2_ITERACIONES = env.int(...)` |
| Vista de salud que pregunta el esquema a la base | `services/auth/config/urls.py:10-14, 22` | `def salud`, `SELECT current_schema()`, `path("health/", salud)` |
| Prueba de conexión y de esquema | `services/auth/tests/test_salud.py:12` y `services/subscriptions/tests/test_salud.py:12` | `test_health_responde_desde_el_esquema_del_servicio` |

`subscriptions` tiene la misma estructura en `services/subscriptions/config/settings.py`
y `services/subscriptions/config/urls.py`, con `NOMBRE_SERVICIO = "subscriptions"`.

## Cómo probarlo

```bash
cp .env.example .env
docker compose up -d postgres auth subscriptions
docker compose exec auth pytest tests/test_salud.py -v
docker compose exec subscriptions pytest tests/test_salud.py -v
```

`test_health_responde_desde_el_esquema_del_servicio` hace `GET /health/`. La
vista ejecuta `SELECT current_schema()` contra la base y devuelve el
resultado; el test comprueba que coincide con `settings.ESQUEMA_BD`.
Eso cubre dos tareas de una: la conexión a la base y que el servicio leyó
`ESQUEMA_BD` del entorno.

Para mirar la base a mano:

```bash
docker compose exec postgres psql -U postgres -d suscripciones -c "\dn"      # esquemas
docker compose exec postgres psql -U postgres -d suscripciones -c "\dt auth.*"
```

## Qué queda pendiente

- No hay un test dedicado a que `auth` lee *cada* variable del `.env`; solo
  está cubierto `ESQUEMA_BD` (por el health) y `PBKDF2_ITERACIONES` (por
  `test_hashers.py`). Las demás fallan en el arranque si faltan, que es una
  verificación más dura que un test, pero no queda registrada como prueba.
- `01-esquemas.sql` deja comentado el usuario por esquema (`svc_subscriptions`
  con permisos solo sobre su esquema). Hoy todos conectan como `postgres`.
  Es la forma de que el aislamiento entre esquemas lo imponga el motor y no
  la disciplina del equipo; va para un sprint posterior.
