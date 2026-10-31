import sys
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent.parent

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(REPO_ROOT / ".env")

SERVICE_NAME = "analytics"
IA_TIMEOUT_SEGUNDOS = env.float("IA_TIMEOUT_SEGUNDOS", default=3.5)
IA_MAX_LLAMADAS_MES = env.int("IA_MAX_LLAMADAS_MES", default=200)
IA_MAX_INTENTOS_PDF_DIA = env.int("IA_MAX_INTENTOS_PDF_DIA", default=3)
IA_MAX_LLAMADAS_SIMULTANEAS = env.int("IA_MAX_LLAMADAS_SIMULTANEAS", default=4)

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
    "analytics",
    "shared.borrado.apps.BorradoConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "shared.borrado.middleware.EscrituraOrganizacionMiddleware",
    # Lee las cabeceras X-Organizacion-Id, X-Usuario-Id, X-Rol que inyecta
    # el gateway (ADR-004). Es la misma pieza en todos los servicios.
    "shared.tenant.base.ContextoTenantMiddleware",
]

ROOT_URLCONF = "analytics_config.urls"
WSGI_APPLICATION = "analytics_config.wsgi.application"
ASGI_APPLICATION = "analytics_config.asgi.application"

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
if "sqlite" not in DATABASES["default"]["ENGINE"]:
    DATABASES["default"]["OPTIONS"] = {"options": f"-c search_path={ESQUEMA_BD}"}
DATABASES["default"]["TEST"] = {"NAME": f"test_{SERVICE_NAME}"}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

SPECTACULAR_SETTINGS = {
    "TITLE": f"Ojo al Gasto · {SERVICE_NAME}",
    "VERSION": "0.1.0",
}

RABBITMQ_URL = env("RABBITMQ_URL", default="")

# ── Bajo uso (FE-29) ──────────────────────────────────────
# Los tres parámetros de la fórmula. Son configurables porque el umbral
# bueno depende del tipo de servicio y nadie lo sabe todavía: 60 minutos al
# mes es razonable para un streaming y no quiere decir nada para una
# herramienta que se abre dos veces y resuelve el trámite.
#
# Cada puntaje guarda en su evidencia el umbral con que se calculó, así que
# cambiar esto no vuelve incomparables los puntajes viejos.
UMBRAL_BAJO_USO_MINUTOS = env.int("UMBRAL_BAJO_USO_MINUTOS", default=60)

# Cuánto hay que haber observado una suscripción antes de opinar sobre su
# uso. Por debajo de esto la clasificación es `sin_datos`: es la diferencia
# entre "no la usa" y "todavía no sabemos", y es un criterio de FE-29.
UMBRAL_DIAS_OBSERVACION = env.int("UMBRAL_DIAS_OBSERVACION", default=30)

# Cuántos meses mira la ventana.
MESES_VENTANA_USO = env.int("MESES_VENTANA_USO", default=3)

LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
