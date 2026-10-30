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

LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
