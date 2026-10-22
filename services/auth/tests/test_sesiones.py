from unittest.mock import patch
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import jwt
import pytest
from django.conf import settings
from django.core.cache import caches
from django.db import connection, close_old_connections
from django.utils import timezone
from redis.exceptions import ConnectionError
from rest_framework.test import APIClient

from app.models import Organizacion, Sesion, User
from shared.sesiones import sesion_activa


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="sesion@example.test", password="Anterior123", nombre="Sesión",
                                    organizacion=Organizacion.objects.create(nombre="Organización A"), rol="titular")


def login(usuario):
    respuesta = APIClient().post("/api/auth/login/", {"email": usuario.email, "password": "Anterior123"})
    assert respuesta.status_code == 200
    return respuesta.data


def claims(token):
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITMO])


def vigente(token):
    datos = claims(token)
    return sesion_activa(datos["user_id"], datos["session_version"], datos["sid"])


def refresh(token):
    return APIClient().post("/api/auth/refresh/", {"refresh_token": token})


def test_logout_revoca_solo_su_dispositivo_y_su_refresh(usuario):
    primera, segunda = login(usuario), login(usuario)
    respuesta = APIClient().post("/api/auth/logout/", {"refresh_token": primera["refresh_token"]})
    assert respuesta.status_code == 204
    assert not vigente(primera["access_token"])
    assert vigente(segunda["access_token"])
    assert refresh(primera["refresh_token"]).status_code == 401


def test_refresh_rotatorio_y_reutilizacion_revoca_familia(usuario):
    primera = login(usuario)
    renovada = refresh(primera["refresh_token"])
    assert renovada.status_code == 200
    assert vigente(renovada.data["access_token"])
    assert renovada.data["refresh_token"] != primera["refresh_token"]
    assert claims(renovada.data["refresh_token"])["exp"] == claims(primera["refresh_token"])["exp"]
    assert refresh(primera["refresh_token"]).status_code == 401
    assert not vigente(renovada.data["access_token"])
    assert refresh(renovada.data["refresh_token"]).status_code == 401


def test_access_vencido_no_impide_refresh_vigente(usuario):
    tokens = login(usuario)
    datos = claims(tokens["access_token"])
    datos["exp"] = 1
    access_vencido = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    respuesta = APIClient().post("/api/auth/refresh/", {"refresh_token": tokens["refresh_token"]},
                                HTTP_AUTHORIZATION=f"Bearer {access_vencido}")
    assert respuesta.status_code == 200


@pytest.mark.parametrize("valor", ["invalido", "", "eyJ.fake.token"])
def test_refresh_invalido_se_rechaza(usuario, valor):
    assert refresh(valor).status_code in (400, 401)


def test_reset_o_usuario_inactivo_impide_refresh(usuario):
    tokens = login(usuario)
    caches["sesiones"].delete(f"usuario:{usuario.pk}")
    assert refresh(tokens["refresh_token"]).status_code == 401
    tokens = login(usuario)
    usuario.is_active = False
    usuario.save(update_fields=["is_active"])
    assert refresh(tokens["refresh_token"]).status_code == 401


def test_redis_caido_no_entrega_tokens_rotados(usuario):
    tokens = login(usuario)
    jti = Sesion.objects.get().refresh_jti
    with patch("app.sesiones.sesion_activa", side_effect=ConnectionError()):
        assert refresh(tokens["refresh_token"]).status_code == 503
    assert Sesion.objects.get().refresh_jti == jti


def test_logout_no_admite_sid_de_otro_usuario(usuario):
    tokens = login(usuario)
    otro = User.objects.create_user(email="otro@example.test", password="Anterior123", nombre="Otro")
    datos = claims(tokens["refresh_token"])
    datos["user_id"] = otro.pk
    firmado = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    assert APIClient().post("/api/auth/logout/", {"refresh_token": firmado}).status_code == 401
    assert vigente(tokens["access_token"])


def test_sid_malformado_no_causa_error_interno(usuario):
    tokens = login(usuario)
    datos = claims(tokens["refresh_token"])
    datos["sid"] = "uuid-invalido"
    firmado = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    assert refresh(firmado).status_code == 401


def test_refresh_vencido_o_access_usado_como_refresh_se_rechaza(usuario):
    tokens = login(usuario)
    datos = claims(tokens["refresh_token"])
    datos["exp"] = 1
    vencido = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    assert refresh(vencido).status_code == 401
    assert refresh(tokens["access_token"]).status_code == 401


def test_logout_con_access_vencido_o_ausente_es_idempotente(usuario):
    tokens = login(usuario)
    datos = claims(tokens["access_token"])
    datos["exp"] = 1
    vencido = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    client = APIClient()
    assert client.post("/api/auth/logout/", {"refresh_token": tokens["refresh_token"]},
                       HTTP_AUTHORIZATION=f"Bearer {vencido}").status_code == 204
    assert client.post("/api/auth/logout/", {"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert not vigente(tokens["access_token"])
    assert refresh(tokens["refresh_token"]).status_code == 401


def test_logout_no_confia_en_cabeceras_y_no_afecta_otra_organizacion(usuario):
    primera = login(usuario)
    otro = User.objects.create_user(email="otra-org@example.test", password="Anterior123", nombre="Otra",
                                   organizacion=Organizacion.objects.create(nombre="Organización B"), rol="titular")
    segunda = login(otro)
    assert usuario.organizacion_id != otro.organizacion_id
    respuesta = APIClient().post("/api/auth/logout/", {"refresh_token": primera["refresh_token"]},
                                HTTP_X_USUARIO_ID=str(otro.pk),
                                HTTP_X_SESION_ID=claims(segunda["refresh_token"])["sid"])
    assert respuesta.status_code == 204
    assert not vigente(primera["access_token"])
    assert vigente(segunda["access_token"])
    assert refresh(segunda["refresh_token"]).status_code == 200


def test_logout_rechaza_refresh_anterior_tras_rotacion_sin_revocar_el_nuevo(usuario):
    primera = login(usuario)
    nueva = refresh(primera["refresh_token"])
    assert nueva.status_code == 200
    assert APIClient().post("/api/auth/logout/", {"refresh_token": primera["refresh_token"]}).status_code == 401
    assert vigente(nueva.data["access_token"])
    assert APIClient().post("/api/auth/logout/", {"refresh_token": nueva.data["refresh_token"]}).status_code == 204


@pytest.mark.parametrize("cambio", [{"sid": None}, {"sid": "malformado"}, {"exp": 1}, {"jti": "otro-jti"}])
def test_logout_rechaza_claims_invalidos_sin_revocar(usuario, cambio):
    tokens = login(usuario)
    datos = claims(tokens["refresh_token"])
    datos.update(cambio)
    firmado = jwt.encode(datos, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITMO)
    assert APIClient().post("/api/auth/logout/", {"refresh_token": firmado}).status_code == 401
    assert vigente(tokens["access_token"])


def test_logout_rechaza_access_y_firma_ajena(usuario):
    tokens = login(usuario)
    firma_ajena = jwt.encode(claims(tokens["refresh_token"]), "otra-clave", algorithm=settings.JWT_ALGORITMO)
    for token in (tokens["access_token"], firma_ajena, "invalido"):
        assert APIClient().post("/api/auth/logout/", {"refresh_token": token}).status_code == 401
        assert vigente(tokens["access_token"])


def test_logout_sin_body_no_acepta_solo_cabeceras_de_identidad(usuario):
    tokens = login(usuario)
    assert APIClient().post("/api/auth/logout/", HTTP_X_USUARIO_ID=str(usuario.pk),
                            HTTP_X_SESION_ID=claims(tokens["refresh_token"])["sid"]).status_code == 400
    assert vigente(tokens["access_token"])


def test_logout_redis_caido_no_confirma_y_permite_reintentar(usuario):
    tokens = login(usuario)
    with patch.object(caches["sesiones"], "delete", side_effect=ConnectionError()):
        respuesta = APIClient().post("/api/auth/logout/", {"refresh_token": tokens["refresh_token"]})
    assert respuesta.status_code == 503
    assert not Sesion.objects.get().revocada
    assert vigente(tokens["access_token"])
    assert APIClient().post("/api/auth/logout/", {"refresh_token": tokens["refresh_token"]}).status_code == 204


def test_logout_rechaza_sesion_expirada_en_servidor(usuario):
    tokens = login(usuario)
    Sesion.objects.update(vence_en=timezone.now() - timedelta(seconds=1))
    assert APIClient().post("/api/auth/logout/", {"refresh_token": tokens["refresh_token"]}).status_code == 401


@pytest.mark.parametrize("campo", ["organizacion", "rol"])
def test_refresh_revoca_sesion_con_pertenencia_o_rol_obsoleto(usuario, campo):
    tokens = login(usuario)
    valor = Organizacion.objects.create(nombre="Nueva") if campo == "organizacion" else "integrante"
    setattr(usuario, campo, valor)
    usuario.save(update_fields=[campo])
    assert refresh(tokens["refresh_token"]).status_code == 401
    assert Sesion.objects.get().revocada
    assert not vigente(tokens["access_token"])


@pytest.mark.django_db(transaction=True)
def test_refresh_concurrente_revoca_familia_sin_afectar_otro_dispositivo(usuario):
    if not connection.features.has_select_for_update:
        pytest.skip("La prueba de concurrencia requiere bloqueo de fila.")
    primera, otro_dispositivo = login(usuario), login(usuario)
    inicio = Barrier(2)

    def renovar():
        close_old_connections()
        try:
            inicio.wait(timeout=5)
            respuesta = refresh(primera["refresh_token"])
            return respuesta.status_code, respuesta.data
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as tareas:
        resultados = list(tareas.map(lambda _: renovar(), range(2)))
    assert sorted(estado for estado, _ in resultados) == [200, 401]
    renovada = next(datos for estado, datos in resultados if estado == 200)
    assert not vigente(renovada["access_token"])
    assert refresh(renovada["refresh_token"]).status_code == 401
    assert vigente(otro_dispositivo["access_token"])
