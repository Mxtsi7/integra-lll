"""
Pruebas del gateway. No necesitan base de datos ni servicios levantados:
el reenvío hacia los servicios se reemplaza por un doble que registra qué
se le pidió y responde lo que se le indique.

Cada prueba dice qué tarea del sprint verifica.
"""

import datetime as dt

import jwt
import pytest
import requests
from django.conf import settings
from django.test import Client

from app import proxy


# ── dobles ──────────────────────────────────────────────────────────

class RespuestaFalsa:
    def __init__(self, estado=200, cuerpo=b'{"ok": true}', cabeceras=None):
        self.status_code = estado
        self.content = cuerpo
        self.headers = {"Content-Type": "application/json", **(cabeceras or {})}


@pytest.fixture
def upstream(monkeypatch):
    """Reemplaza requests.request; guarda cada llamada en .llamadas."""
    class Doble:
        llamadas = []
        respuesta = RespuestaFalsa()
        error = None

        def __call__(self, metodo, url, **kw):
            if self.error:
                raise self.error
            self.llamadas.append({"metodo": metodo, "url": url, **kw})
            return self.respuesta

    doble = Doble()
    monkeypatch.setattr(proxy.requests, "request", doble)
    return doble


def token(**claims):
    base = {
        "sub": "7f3a1b",
        "organizacion_id": "9c2140",
        "rol": "titular",
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
    }
    base.update(claims)
    return jwt.encode(base, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)


def con_token(t):
    return {"HTTP_AUTHORIZATION": f"Bearer {t}"}


cliente = Client()


# ── /health/ ────────────────────────────────────────────────────────

def test_health_responde_sin_base_de_datos():
    r = cliente.get("/health/")
    assert r.status_code == 200
    assert r.json() == {"servicio": "gateway", "estado": "ok"}


# ── [68] proxy base ─────────────────────────────────────────────────

def test_reenvia_metodo_ruta_query_y_cuerpo_al_servicio_correcto(upstream):
    r = cliente.post(
        "/api/suscripciones/?pagina=2", data='{"nombre": "Netflix"}',
        content_type="application/json", **con_token(token()),
    )
    assert r.status_code == 200
    llamada = upstream.llamadas[-1]
    assert llamada["metodo"] == "POST"
    assert llamada["url"] == settings.SERVICIOS["subscriptions"] + "/api/suscripciones/?pagina=2"
    assert llamada["data"] == b'{"nombre": "Netflix"}'
    assert llamada["headers"]["Content-Type"] == "application/json"


def test_cada_prefijo_va_a_su_servicio(upstream):
    for ruta, servicio in (("/api/usuarios/me/", "auth"), ("/api/alertas/", "notifications")):
        cliente.get(ruta, **con_token(token()))
        assert upstream.llamadas[-1]["url"].startswith(settings.SERVICIOS[servicio])


def test_ruta_desconocida_es_404_sin_tocar_ningun_servicio(upstream):
    r = cliente.get("/api/loquesea/", **con_token(token()))
    assert r.status_code == 404
    assert upstream.llamadas == []


# ── [69][70] leer, decodificar y validar la firma ───────────────────

def test_sin_token_es_401(upstream):
    r = cliente.get("/api/suscripciones/")
    assert r.status_code == 401
    assert r["WWW-Authenticate"] == "Bearer"
    assert "Authorization: Bearer" in r.json()["detalle"]
    assert upstream.llamadas == []


def test_firma_con_otro_secreto_es_401(upstream):
    ajeno = jwt.encode({"sub": "x", "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)},
                       "otro-secreto", algorithm="HS256")
    r = cliente.get("/api/suscripciones/", **con_token(ajeno))
    assert r.status_code == 401
    assert r.json()["detalle"] == "Token inválido"
    assert upstream.llamadas == []


def test_token_expirado_es_401(upstream):
    vencido = token(exp=dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1))
    r = cliente.get("/api/suscripciones/", **con_token(vencido))
    assert r.status_code == 401
    assert r.json()["detalle"] == "El token expiró"


def test_token_sin_usuario_es_401(upstream):
    r = cliente.get("/api/suscripciones/", **con_token(token(sub=None)))
    assert r.status_code == 401
    assert r.json()["detalle"] == "El token no identifica al usuario"


# ── [71][72][73][74] extraer la identidad e inyectarla ──────────────

def test_inyecta_usuario_organizacion_y_rol_desde_el_token(upstream):
    cliente.get("/api/suscripciones/", **con_token(token()))
    cab = upstream.llamadas[-1]["headers"]
    assert cab["X-Usuario-Id"] == "7f3a1b"
    assert cab["X-Organizacion-Id"] == "9c2140"
    assert cab["X-Rol"] == "titular"
    assert "Authorization" not in cab, "el token se queda en el gateway"


def test_acepta_user_id_como_identificador_de_simplejwt(upstream):
    cliente.get("/api/suscripciones/", **con_token(token(sub=None, user_id=42)))
    assert upstream.llamadas[-1]["headers"]["X-Usuario-Id"] == "42"


def test_sin_organizacion_en_el_token_no_inventa_la_cabecera(upstream):
    cliente.get("/api/suscripciones/", **con_token(token(organizacion_id=None, rol=None)))
    cab = upstream.llamadas[-1]["headers"]
    assert cab["X-Usuario-Id"] == "7f3a1b"
    assert "X-Organizacion-Id" not in cab
    assert "X-Rol" not in cab


# ── [67] aislamiento: nadie fabrica su identidad desde afuera (RF-26) ─

def test_descarta_cabeceras_de_identidad_que_manda_el_cliente(upstream):
    cliente.get(
        "/api/suscripciones/",
        HTTP_X_ORGANIZACION_ID="organizacion-ajena", HTTP_X_USUARIO_ID="otro", HTTP_X_ROL="admin",
        **con_token(token()),
    )
    cab = upstream.llamadas[-1]["headers"]
    assert cab["X-Organizacion-Id"] == "9c2140"
    assert cab["X-Usuario-Id"] == "7f3a1b"
    assert cab["X-Rol"] == "titular"


# ── rutas públicas ──────────────────────────────────────────────────

def test_las_rutas_de_auth_no_exigen_token(upstream):
    r = cliente.post("/api/auth/login/", data='{"correo": "a@b.cl"}', content_type="application/json")
    assert r.status_code == 200
    cab = upstream.llamadas[-1]["headers"]
    assert "X-Usuario-Id" not in cab
    assert upstream.llamadas[-1]["url"].startswith(settings.SERVICIOS["auth"])


# ── [75] errores: 401 propios, 403 del servicio, 502/504 ────────────

def test_el_403_del_servicio_llega_tal_cual_al_cliente(upstream):
    upstream.respuesta = RespuestaFalsa(403, b'{"detail": "Falta el contexto de organizaci\xc3\xb3n"}')
    r = cliente.get("/api/suscripciones/", **con_token(token()))
    assert r.status_code == 403
    assert "organizaci" in r.json()["detail"]


def test_servicio_caido_es_502(upstream):
    upstream.error = requests.ConnectionError()
    r = cliente.get("/api/suscripciones/", **con_token(token()))
    assert r.status_code == 502
    assert "no está disponible" in r.json()["detalle"]


def test_servicio_lento_es_504(upstream):
    upstream.error = requests.Timeout()
    r = cliente.get("/api/suscripciones/", **con_token(token()))
    assert r.status_code == 504


# ── correlación ─────────────────────────────────────────────────────

def test_toda_respuesta_lleva_correlation_id_y_lo_respeta_si_viene(upstream):
    r = cliente.get("/api/suscripciones/", HTTP_X_CORRELATION_ID="abc123", **con_token(token()))
    assert r["X-Correlation-ID"] == "abc123"
    assert upstream.llamadas[-1]["headers"]["X-Correlation-ID"] == "abc123"

    r = cliente.get("/api/suscripciones/")           # incluso un 401
    assert len(r["X-Correlation-ID"]) == 32
