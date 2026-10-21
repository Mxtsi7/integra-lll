from pathlib import Path
import sys

import environ
from datetime import timedelta
from django.contrib.auth.hashers import PBKDF2PasswordHasher

BASE_DIR = Path(__file__).resolve().parent.parent
RAIZ_REPO = BASE_DIR.parent.parent

if str(RAIZ_REPO) not in sys.path:
    sys.path.insert(0, str(RAIZ_REPO))


env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(RAIZ_REPO / ".env")

NOMBRE_SERVICIO = "auth"
PAGOS_MOCK_HABILITADO = env.bool("PAGOS_MOCK_HABILITADO", default=False)
PAGOS_WEBHOOK_SECRET = env("PAGOS_WEBHOOK_SECRET", default="")
PAGOS_URL_PUBLICA = env("PAGOS_URL_PUBLICA", default="http://localhost:8000")
PAGOS_URL_RETORNO = env("PAGOS_URL_RETORNO", default="http://localhost:5173/planes/retorno")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[]) + [NOMBRE_SERVICIO]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "app.apps.AutenticacionConfig",
]

AUTH_USER_MODEL = "app.User"

# Iteraciones de PBKDF2 para las contraseñas. Por defecto, las de Django; el
# cluster las baja en su ConfigMap porque ahí un hash tarda 15 s y el login
# da 504 (ver app/hashers.py).
PBKDF2_ITERACIONES = env.int(
    "PBKDF2_ITERACIONES", default=PBKDF2PasswordHasher.iterations
)
PASSWORD_HASHERS = ["app.hashers.PBKDF2Configurable"]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "shared.tenant.base.ContextoTenantMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

ESQUEMA_BD = env("ESQUEMA_BD", default=NOMBRE_SERVICIO)

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["OPTIONS"] = {"options": f"-c search_path={ESQUEMA_BD}"}
# Cada servicio usa su propia base de test, para que las pruebas de dos
# servicios puedan correr a la vez (en CI, por ejemplo) sin pisarse.
DATABASES["default"]["TEST"] = {"NAME": f"test_{NOMBRE_SERVICIO}"}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

SPECTACULAR_SETTINGS = {
    "ENUM_NAME_OVERRIDES": {"CodigoPlanEnum": ["free", "premium"], "CodigoPlanCatalogoEnum": [("free", "Gratuito"), ("premium", "Premium")]},
    "TITLE": f"Ojo al Gasto · {NOMBRE_SERVICIO}",
    "VERSION": "0.1.0",
}

LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

JWT_SECRET = env("JWT_SECRET")
JWT_ALGORITMO = env("JWT_ALGORITMO", default="HS256")

# ─── Recuperación de contraseña ───────────────────────────────
RECUPERACION_MINUTOS = 60
PASSWORD_RESET_TIMEOUT = RECUPERACION_MINUTOS * 60
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-responder@ojoalgasto.cl")
# SMTP evita escribir el enlace y su token en los logs del contenedor.
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

SIMPLE_JWT = {
    "SIGNING_KEY": JWT_SECRET,
    "ALGORITHM": JWT_ALGORITMO,
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_MINUTOS_ACCESO", default=30)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_DIAS_REFRESCO", default=7)),
}


# Estado compartido de sesiones. Nunca usar caché local en despliegues.
CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "sesiones": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("SESSION_REDIS_URL", default="redis://redis:6379/2"),
        "KEY_PREFIX": "ojoalgasto:sesiones",
        "OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2},
    },
}
