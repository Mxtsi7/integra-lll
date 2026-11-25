import sys
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent.parent

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(REPO_ROOT / ".env")

SERVICE_NAME = "notifications"

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
    "notifications",
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
    # cualquier ViewSet responde 403: el servicio queda inalcanzable aunque
    # los modelos y las rutas estén bien.
    "shared.tenant.base.ContextoTenantMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "shared.borrado.middleware.EscrituraOrganizacionMiddleware",
]

ROOT_URLCONF = "notifications_config.urls"
WSGI_APPLICATION = "notifications_config.wsgi.application"
ASGI_APPLICATION = "notifications_config.asgi.application"

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
# así que la guarda tiene que estar. Igual que en connectors y subscriptions.
if "sqlite" not in DATABASES["default"]["ENGINE"]:
    DATABASES["default"]["OPTIONS"] = {"options": f"-c search_path={ESQUEMA_BD}"}
DATABASES["default"]["TEST"] = {"NAME": f"test_{SERVICE_NAME}"}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── Canales de notificación realmente entregables (FE-21 / RF-09) ────
# Una persona puede PEDIR que le avisen por push; que el push llegue es otra
# cosa, y hoy no hay quién lo entregue (eso es FE-22 y más).
#
# La preferencia se guarda igual —es lo que la persona quiere— y la API
# informa esta lista aparte, para que el frontend no prometa un canal que no
# va a cumplir. Guardar la intención y poder cumplirla son cosas distintas.
#
# Cuando el push exista, se agrega acá y nadie tiene que volver a elegirlo.
CANALES_HABILITADOS = env.list("CANALES_HABILITADOS", default=["email", "in_app"])

# ── A quién escribirle (S3-FE-21) ────────────────────────────────────
# Las personas de cada organización y su correo se le preguntan a auth
# (`notifications/directorio.py`), firmado con DIRECTORIO_INTERNO_SECRET.
# En el clúster, para un satélite, `k8s/satelite.py` califica el host.
URL_AUTH = env("URL_AUTH", default="http://auth:8001")

# ── Correo de las alertas (S3-FE-21) ─────────────────────────────────
# Las MISMAS variables y valores por omisión que auth
# (`services/auth/config/settings.py`), que ya manda el correo de
# recuperación de contraseña: un solo buzón de envío y una sola sección en
# `.env.example` («Correo (servicios auth y notifications)»). TLS y SSL son
# alternativas: se activa solo una.
#
# SMTP por omisión y no el backend de consola: el de consola escribe el
# correo completo en los logs del contenedor. Las pruebas usan el de memoria
# (`locmem`), que pytest-django pone solo; ese no entrega nada.
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-responder@ojoalgasto.cl")
EMAIL_BACKEND = env(
    "EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend"
)
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=5)

# Los backends cuya aceptación es la de un proveedor. Con SMTP, `send()`
# devuelve 1 solo si el servidor respondió 250. dummy, console y filebased
# devuelven 1 sin que salga nada (console, además, escribe el correo completo
# en el log) y locmem es un buzón en memoria: con cualquiera de ellos una
# entrega quedaría «aceptada por el proveedor» sin proveedor, así que
# `despachar_alertas` se niega a correr. No sale de una variable a propósito:
# agregar un backend es decidir que su respuesta vale como aceptación, y eso
# se revisa en una PR. Las pruebas agregan locmem (`conftest.py`).
EMAIL_BACKENDS_CON_PROVEEDOR = ["django.core.mail.backends.smtp.EmailBackend"]

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

SPECTACULAR_SETTINGS = {
    "TITLE": f"Ojo al Gasto · {SERVICE_NAME}",
    "VERSION": "0.1.0",
}

LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Solo el consumidor lo exige; la API y el generador no abren AMQP.
RABBITMQ_URL = env("RABBITMQ_URL", default="")
