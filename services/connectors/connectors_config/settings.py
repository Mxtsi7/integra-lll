import sys
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent.parent

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(REPO_ROOT / ".env")

SERVICE_NAME = "connectors"

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[]) + [SERVICE_NAME]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "connectors",
    "shared.borrado.apps.BorradoConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    # Lee las cabeceras X-Organizacion-Id, X-Usuario-Id, X-Rol que inyecta
    # el gateway (ADR-004). Es la misma pieza en los cinco servicios.
    #
    # Sin esto, `ModeloTenant` no tiene de dónde sacar la organización y
    # TenantViewSet responde 403 a todo: el servicio queda inalcanzable
    # aunque los modelos y las rutas estén bien.
    "shared.tenant.base.ContextoTenantMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "shared.borrado.middleware.EscrituraOrganizacionMiddleware",
]

ROOT_URLCONF = "connectors_config.urls"
WSGI_APPLICATION = "connectors_config.wsgi.application"
ASGI_APPLICATION = "connectors_config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ESQUEMA_BD = env("ESQUEMA_BD", default=SERVICE_NAME)
DATABASES = {"default": env.db("DATABASE_URL")}
# `-c search_path=` es sintaxis de Postgres: pasárselo a sqlite revienta con
# "Connection() got an unexpected keyword argument 'options'". Las pruebas
# locales caen a sqlite en memoria cuando no hay Postgres (ver conftest.py),
# así que la guarda tiene que estar. Igual que en subscriptions.
if "sqlite" not in DATABASES["default"]["ENGINE"]:
    DATABASES["default"]["OPTIONS"] = {"options": f"-c search_path={ESQUEMA_BD}"}
DATABASES["default"]["TEST"] = {"NAME": f"test_{SERVICE_NAME}"}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── OAuth de los conectores (FE-03 / FE-04 / FE-05) ─────────────────
#
# El callback que se le registra al proveedor. Tiene que ser EXACTAMENTE el
# mismo que se manda en el canje, o el proveedor rechaza. Apunta al frontend,
# que recibe el `code` y el `state` en la URL y nos los reenvía por POST a
# /api/conectores/autorizaciones/callback/.
OAUTH_REDIRECT_URI = env("OAUTH_REDIRECT_URI", default="")

# Lista blanca de orígenes a los que se puede mandar el navegador al cerrar
# el flujo. Se compara el ORIGEN completo (esquema + host + puerto), no un
# prefijo: con `startswith`, "https://ojoalgasto.cl.malo.com" pasaría por
# empezar igual que el nuestro.
#
# Vacía por omisión a propósito: sin configurar, NO se acepta ningún retorno.
# El flujo igual funciona (el frontend sabe a dónde volver); lo que no se
# acepta es que lo diga la petición.
OAUTH_RETORNOS_PERMITIDOS = env.list("OAUTH_RETORNOS_PERMITIDOS", default=[])

# Credenciales por proveedor. Los secretos vienen del Secret del cluster,
# nunca del ConfigMap ni del repo.
OAUTH_CREDENCIALES = {
    "gmail": {
        "client_id": env("OAUTH_GMAIL_CLIENT_ID", default=""),
        "client_secret": env("OAUTH_GMAIL_CLIENT_SECRET", default=""),
    },
    "outlook": {
        "client_id": env("OAUTH_OUTLOOK_CLIENT_ID", default=""),
        "client_secret": env("OAUTH_OUTLOOK_CLIENT_SECRET", default=""),
    },
}

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

SPECTACULAR_SETTINGS = {
    "TITLE": f"Ojo al Gasto · {SERVICE_NAME}",
    "VERSION": "0.1.0",
}

# ── Subida de archivos para importar (FE-07) ──────────────────────────
# Tope de tamaño por archivo. 5 MB alcanza para años de cartola en CSV y
# para una cartola PDF; más que eso no es una cartola, es otra cosa.
IMPORTACION_TAMANO_MAXIMO_BYTES = env.int(
    "IMPORTACION_TAMANO_MAXIMO_BYTES", default=5 * 1024 * 1024
)
# Cuántos archivos puede subir una organización por día. Es la cuota de
# ingesta de la tarjeta: sin ella, un cliente en bucle llenaría la base de
# archivos pendientes.
IMPORTACION_CUOTA_DIARIA = env.int("IMPORTACION_CUOTA_DIARIA", default=20)
# Cuánto se guarda el archivo. Es almacenamiento TEMPORAL: lo necesita el
# procesamiento (FE-09) y después sobra. `purgar_archivos_importacion` borra
# los vencidos; la importación y sus candidatos quedan.
IMPORTACION_DIAS_RETENCION = env.int("IMPORTACION_DIAS_RETENCION", default=7)

# ── Procesamiento de la importación (S3-FE-10) ────────────────────────
# Lo que una cartola no dice y hay que decidir antes de leerla.
#
# Moneda cuando el archivo no trae columna de moneda. Sin esto, cada fila de
# una cartola chilena normal se rechazaría con `moneda_no_indicada`: el
# parser no adivina, y tiene razón en no adivinar.
IMPORTACION_MONEDA_POR_DEFECTO = env("IMPORTACION_MONEDA_POR_DEFECTO", default="CLP")
# Orden de día y mes: "dmy", "mdy", o vacío para deducirlo del archivo.
# Vacío por omisión A PROPÓSITO: una cartola real casi siempre trae algún día
# mayor que 12 y eso desambigua sola; declarar un orden que el archivo no usa
# correría todas las fechas un mes sin que nadie se entere. Lo que no se puede
# deducir se rechaza fila por fila con `fecha_ambigua`.
IMPORTACION_ORDEN_FECHA = env("IMPORTACION_ORDEN_FECHA", default="")

# ── El rescate de importaciones (S3-FE-10) ────────────────────────────
# El broker es Redis y no es durable: una tarea puede perderse con el worker.
# `rescatar_importaciones_estancadas` reencola lo que quedó `pendiente` y
# cierra lo que quedó `procesando`, para que ningún estado se quede sin final.
#
# 5 minutos: suficiente para no competir con la tarea que ya está en vuelo
# —procesar un CSV de 5 MB no toma eso— y poco para que la persona que mira
# la barra no se quede esperando.
IMPORTACION_REENCOLAR_TRAS_MINUTOS = env.int("IMPORTACION_REENCOLAR_TRAS_MINUTOS", default=5)
# 30 minutos: holgado a propósito. Marcar `fallida` es irreversible —es un
# estado terminal— así que el límite tiene que estar muy por encima de lo que
# tarda un archivo grande, o se mataría trabajo que iba a terminar bien.
IMPORTACION_ESTANCADA_TRAS_MINUTOS = env.int("IMPORTACION_ESTANCADA_TRAS_MINUTOS", default=30)

LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ── Celery: el trabajador de connectors (D-01) ──────────────────────
# `connectors-worker` arranca con `celery -A connectors_config worker --beat`;
# la app (connectors_config/celery.py) lee de aquí todo lo que empieza con
# CELERY_.
#
# Broker: el Redis de .env. Sin valor por omisión, igual que DATABASE_URL:
# si falta, el servicio no arranca en vez de buscar un broker inventado. Los
# resultados van al mismo Redis salvo que CELERY_RESULT_BACKEND diga otro.
CELERY_BROKER_URL = env("CELERY_BROKER_URL")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=CELERY_BROKER_URL)
CELERY_TIMEZONE = TIME_ZONE
# subscriptions usa el mismo Redis con la cola y el canal de control por
# omisión ("celery"). Con nombres propios, este worker no le quita las tareas
# del Temporizador (las descartaría por no conocerlas) y a `inspect ping`
# solo contestan los workers de connectors.
CELERY_TASK_DEFAULT_QUEUE = SERVICE_NAME
CELERY_CONTROL_EXCHANGE = SERVICE_NAME
# Beat corre dentro del worker (--beat). Por ahora solo el latido; las tareas
# reales (lectura de correo, FE-13) se programan aquí.
CELERY_BEAT_SCHEDULE = {
    "latido-de-connectors": {
        "task": "connectors.tasks.latido",
        "schedule": env.float("CONECTORES_LATIDO_SEGUNDOS", default=60.0),
    },
    # La red bajo el trapecio de S3-FE-10: ver el docstring de
    # `connectors/tasks.py`. Cada 5 minutos, igual que la espera por omisión
    # para reencolar: no sirve mirar más seguido que el plazo que se controla.
    "rescate-de-importaciones": {
        "task": "connectors.tasks.rescatar_importaciones_estancadas",
        "schedule": env.float("IMPORTACION_RESCATE_SEGUNDOS", default=300.0),
    },
}
