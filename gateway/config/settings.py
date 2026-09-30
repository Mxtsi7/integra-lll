"""
Configuración del gateway.

Es el único punto de entrada del sistema (ADR-004): valida el JWT una sola
vez, y reenvía cada petición al servicio que corresponde con la identidad
del usuario en cabeceras. Los servicios internos confían en esas cabeceras
y no vuelven a validar nada.

No tiene base de datos. No tiene modelos. Solo enruta.
"""

import sys
from pathlib import Path

import environ

# ── rutas ───────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent      # gateway/
RAIZ_REPO = BASE_DIR.parent                            # proyecto-suscripciones

if str(RAIZ_REPO) not in sys.path:
    sys.path.insert(0, str(RAIZ_REPO))

# ── entorno ─────────────────────────────────────────────────────────
env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(RAIZ_REPO / ".env")

NOMBRE_SERVICIO = "gateway"

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[]) + [NOMBRE_SERVICIO]

# ── aplicaciones ────────────────────────────────────────────────────
# corsheaders es la única app: el navegador de la web (localhost:5173)
# llama al gateway (localhost:8000), y sin CORS el navegador bloquea la
# llamada antes de que salga.
INSTALLED_APPS = ["corsheaders"]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Sin base de datos, a propósito. Django 5 lo admite.
DATABASES = {}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])
# El token viaja en la cabecera Authorization, no en cookies.
CORS_ALLOW_CREDENTIALS = False
CORS_EXPOSE_HEADERS = ["X-Correlation-ID"]

# ── JWT ─────────────────────────────────────────────────────────────
# auth firma los tokens con este secreto; el gateway solo los valida.
# Tiene que ser IDÉNTICO en los dos servicios (ver .env.example).
JWT_SECRET = env("JWT_SECRET")
JWT_ALGORITMO = env("JWT_ALGORITMO", default="HS256")

# ── enrutamiento ────────────────────────────────────────────────────
# Dónde vive cada servicio. En Docker llegan desde docker-compose.yml;
# los valores por defecto son los nombres de contenedor.
SERVICIOS = {
    "auth": env("URL_AUTH", default="http://auth:8001"),
    "subscriptions": env("URL_SUBSCRIPTIONS", default="http://subscriptions:8002"),
    "connectors": env("URL_CONNECTORS", default="http://connectors:8003"),
    "analytics": env("URL_ANALYTICS", default="http://analytics:8004"),
    "notifications": env("URL_NOTIFICATIONS", default="http://notifications:8005"),
}

# Qué prefijo va a qué servicio. La ruta NO cambia, solo el host:
# GET /api/suscripciones/ en el gateway llega a subscriptions como
# GET /api/suscripciones/. Así cada servicio expone su API bajo /api/
# y no hay que traducir nada.
RUTAS = {
    "/api/auth/": "auth",
    "/api/usuarios/": "auth",
    "/api/organizaciones/": "auth",
    "/api/suscripciones/": "subscriptions",
    "/api/usos/": "subscriptions",
    "/api/conectores/": "connectors",
    "/api/recomendaciones/": "analytics",
    "/api/asistente/": "analytics",
    "/api/alertas/": "notifications",
}

# Las únicas rutas que no exigen token: registrarse, entrar, refrescar.
RUTAS_PUBLICAS = ("/api/auth/",)

# Cuánto se espera a un servicio antes de responder 504.
TIEMPO_ESPERA_SEGUNDOS = 10

# ── regional ────────────────────────────────────────────────────────
LANGUAGE_CODE = "es-cl"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True
