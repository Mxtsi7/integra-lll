from pathlib import Path
import sys

import environ
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent
RAIZ_REPO = BASE_DIR.parent.parent

if str(RAIZ_REPO) not in sys.path:
    sys.path.insert(0, str(RAIZ_REPO))


env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(RAIZ_REPO / ".env")

NOMBRE_SERVICIO = "auth"

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

SIMPLE_JWT = {
    "SIGNING_KEY": env("JWT_SECRET"),
    "ALGORITHM": env("JWT_ALGORITMO", default="HS256"),
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_MINUTOS_ACCESO", default=30)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_DIAS_REFRESCO", default=7)),
}