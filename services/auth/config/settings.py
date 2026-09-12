"""
Configuración del servicio. Todo lo que cambia entre ambientes viene del
entorno (ver .env.example en la raíz); acá no hay valores reales.

Los cinco servicios comparten esta misma estructura: lo único que cambia
entre uno y otro es NOMBRE_SERVICIO y el puerto del Dockerfile.
"""

import sys
from pathlib import Path

import environ

# ── rutas ───────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent      # services/auth
RAIZ_REPO = BASE_DIR.parent.parent                     # proyecto-suscripciones

# `shared/` se monta en el contenedor como /app/shared. Para correr el
# servicio fuera de Docker (python manage.py runserver) se resuelve desde
# la raíz del repositorio.
if str(RAIZ_REPO) not in sys.path:
    sys.path.insert(0, str(RAIZ_REPO))

# ── entorno ─────────────────────────────────────────────────────────
env = environ.Env(DEBUG=(bool, False))
# Dentro de Docker las variables llegan por env_file; fuera, desde el .env
# de la raíz. Si no existe, django-environ solo avisa.
environ.Env.read_env(RAIZ_REPO / ".env")

NOMBRE_SERVICIO = "auth"

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
# El gateway llama al servicio por su nombre de contenedor.
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[]) + [NOMBRE_SERVICIO]

# ── aplicaciones ────────────────────────────────────────────────────
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    "app",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    # Lee las cabeceras X-Organizacion-Id, X-Usuario-Id, X-Rol que inyecta
    # el gateway (ADR-004). Es la misma pieza en los cinco servicios.
    "shared.tenant.base.ContextoTenantMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# ── base de datos ───────────────────────────────────────────────────
# Una instancia, un esquema por servicio (ADR-002). El esquema llega en
# ESQUEMA_BD desde docker-compose.yml y se fija como search_path de la
# conexión: Django crea y consulta sus tablas ahí y no en public.
ESQUEMA_BD = env("ESQUEMA_BD", default=NOMBRE_SERVICIO)

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["OPTIONS"] = {"options": f"-c search_path={ESQUEMA_BD}"}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── API ─────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

SPECTACULAR_SETTINGS = {
    "TITLE": f"Ojo al Gasto · {NOMBRE_SERVICIO}",
    "VERSION": "0.1.0",
}

# ── regional ────────────────────────────────────────────────────────
LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True
