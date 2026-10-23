from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.db import IntegrityError, close_old_connections, connection, transaction
from django.utils import timezone
import pytest
from rest_framework.test import APIClient

from app.models import SolicitudVerificacionCorreo, User
from app.recuperacion import generar_token_compuesto

SOLICITUD = "/api/auth/email-verification/request/"
CONFIRMACION = "/api/auth/email-verification/confirm/"
CLAVE = "Anterior123"


@pytest.fixture
def usuario(db):
    return User.objects.create_user(email="ana@test.com", password=CLAVE, nombre="Ana")


def solicitar(usuario, **datos):
    return APIClient().post(SOLICITUD, datos, format="json", HTTP_X_USUARIO_ID=str(usuario.pk))


def token_del_correo(correo):
    enlace = next(linea for linea in correo.body.splitlines() if "token=" in linea)
    return parse_qs(urlparse(enlace).query)["token"][0]


def confirmar(token, **datos):
    return APIClient().post(CONFIRMACION, {"token": token, **datos}, format="json")


@pytest.mark.django_db
def test_verifica_actual_sin_activar_hasta_confirmar_y_no_expone_token(usuario, mailoutbox, caplog):
    assert solicitar(usuario).status_code == 200
    usuario.refresh_from_db()
    assert usuario.correo_verificado_en is None
    token = token_del_correo(mailoutbox[0])
    registro = SolicitudVerificacionCorreo.objects.get()
    assert token not in caplog.text and token not in registro.huella
    assert confirmar(token).status_code == 200
    assert confirmar(token).status_code == 410
    usuario.refresh_from_db()
    assert usuario.correo_verificado_en is not None
    assert usuario.email == "ana@test.com" and len(mailoutbox) == 1


@pytest.mark.django_db
def test_cambio_exige_password_conserva_anterior_y_avisa(usuario, mailoutbox):
    for clave in (None, "Incorrecta123"):
        assert solicitar(usuario, email="nuevo@test.com", password=clave).status_code == 400
    assert solicitar(usuario, email="Nuevo@TEST.com", password=CLAVE).status_code == 200
    usuario.refresh_from_db()
    assert usuario.email == "ana@test.com" and mailoutbox[0].to == ["nuevo@test.com"]
    assert confirmar(token_del_correo(mailoutbox[0])).status_code == 200
    usuario.refresh_from_db()
    assert usuario.email == "nuevo@test.com" and mailoutbox[1].to == ["ana@test.com"]


@pytest.mark.django_db
@pytest.mark.parametrize("identidad", [None, "abc", "9" * 19, "0", "9" * 100, "١"])
def test_solicitud_rechaza_contexto_ausente_o_invalido(usuario, identidad):
    headers = {} if identidad is None else {"HTTP_X_USUARIO_ID": identidad}
    assert APIClient().post(SOLICITUD, {}, format="json", **headers).status_code == 403


@pytest.mark.django_db
def test_no_cambia_correo_ajeno_ni_por_parametros_del_cliente(usuario, mailoutbox):
    otro = User.objects.create_user(email="Ajeno@test.com", password=CLAVE, nombre="Otro")
    assert solicitar(usuario, email="AJENO@test.com", password=CLAVE).status_code == 400
    assert solicitar(usuario, email="nuevo@test.com", password=CLAVE, usuario_id=otro.pk).status_code == 200
    token = token_del_correo(mailoutbox[0])
    assert confirmar(token, email=otro.email, usuario_id=otro.pk).status_code == 200
    otro.refresh_from_db()
    assert otro.email == "Ajeno@test.com" and otro.correo_verificado_en is None


@pytest.mark.django_db
def test_destino_ocupado_despues_de_solicitar_rechaza_confirmacion(usuario, mailoutbox):
    solicitar(usuario, email="nuevo@test.com", password=CLAVE)
    User.objects.create_user(email="NUEVO@test.com", password=CLAVE, nombre="Otro")
    assert confirmar(token_del_correo(mailoutbox[0])).status_code == 400
    usuario.refresh_from_db()
    assert usuario.email == "ana@test.com"


@pytest.mark.django_db
def test_unicidad_insensible_a_mayusculas_tambien_en_registro(usuario):
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(email="ANA@test.com", password=CLAVE, nombre="Duplicado")
    respuesta = APIClient().post("/api/auth/register/", {
        "email": "ANA@test.com", "password": CLAVE, "nombre": "Duplicado", "acepta_datos": True,
    }, format="json")
    assert respuesta.status_code == 400 and User.objects.count() == 1


@pytest.mark.django_db
def test_limites_reenvio_persistidos_e_invalidacion_del_anterior(usuario, mailoutbox):
    ahora = timezone.now()
    with patch("app.verificacion_correo.timezone.now", return_value=ahora):
        assert solicitar(usuario).status_code == 200
        assert solicitar(usuario).status_code == 429
    primero = token_del_correo(mailoutbox[0])
    for minuto in range(1, 5):
        with patch("app.verificacion_correo.timezone.now", return_value=ahora + timedelta(minutes=minuto)):
            assert solicitar(usuario).status_code == 200
    assert confirmar(primero).status_code == 400
    with patch("app.verificacion_correo.timezone.now", return_value=ahora + timedelta(minutes=5)):
        assert solicitar(usuario).status_code == 429
    with patch("app.verificacion_correo.timezone.now", return_value=ahora + timedelta(hours=1)):
        assert solicitar(usuario).status_code == 200


@pytest.mark.django_db
def test_vencimiento_exacto_y_proposito_distinto_de_recuperacion(usuario, mailoutbox):
    ahora = timezone.now()
    with patch("app.verificacion_correo.timezone.now", return_value=ahora):
        solicitar(usuario)
    with patch("app.verificacion_correo.timezone.now", return_value=ahora + timedelta(minutes=60)):
        respuesta = confirmar(token_del_correo(mailoutbox[0]))
    assert respuesta.status_code == 410 and respuesta.data["code"] == "token_expirado"
    assert confirmar(generar_token_compuesto(usuario)).status_code == 400
    for token in ("invalido", "verificar_correo:😀", "x" * 129):
        assert confirmar(token).status_code == 400
    assert APIClient().post(CONFIRMACION, '{"token":"verificar_correo:\\ud800"}', content_type="application/json").status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("cambio", ["password", "email", "is_active"])
def test_cambio_de_identidad_o_cuenta_inactiva_invalida_enlace(usuario, mailoutbox, cambio):
    solicitar(usuario)
    User.objects.filter(pk=usuario.pk).update(**{cambio: {"password": "nuevo-hash", "email": "otra@test.com", "is_active": False}[cambio]})
    assert confirmar(token_del_correo(mailoutbox[0])).status_code == 400


@pytest.mark.django_db
def test_fallos_smtp_no_consumen_solicitud_ni_cambio(usuario, mailoutbox):
    with patch("app.verificacion_correo.send_mail", side_effect=OSError()):
        assert solicitar(usuario).status_code == 503
    assert not SolicitudVerificacionCorreo.objects.exists()
    solicitar(usuario, email="nuevo@test.com", password=CLAVE)
    token = token_del_correo(mailoutbox[0])
    with patch("app.verificacion_correo.send_mail", side_effect=OSError()):
        assert confirmar(token).status_code == 503
    usuario.refresh_from_db()
    assert usuario.email == "ana@test.com" and usuario.correo_verificado_en is None
    assert confirmar(token).status_code == 200


@pytest.mark.django_db(transaction=True)
def test_confirmaciones_concurrentes_consumen_una_sola_vez(usuario, mailoutbox):
    if connection.vendor != "postgresql":
        pytest.skip("Requiere bloqueo real PostgreSQL")
    solicitar(usuario)
    token = token_del_correo(mailoutbox[0])
    barrera = Barrier(2)
    def enviar(_):
        close_old_connections()
        try:
            barrera.wait(timeout=10)
            return confirmar(token).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(enviar, range(2))) == [200, 410]


@pytest.mark.django_db(transaction=True)
def test_confirmaciones_concurrentes_no_comparten_correo(usuario, mailoutbox):
    if connection.vendor != "postgresql":
        pytest.skip("Requiere unicidad y bloqueo PostgreSQL")
    otro = User.objects.create_user(email="otro@test.com", password=CLAVE, nombre="Otro")
    for cuenta in (usuario, otro):
        assert solicitar(cuenta, email="NUEVO@test.com", password=CLAVE).status_code == 200
    tokens = [token_del_correo(correo) for correo in mailoutbox]
    barrera = Barrier(2)
    def enviar(token):
        close_old_connections()
        try:
            barrera.wait(timeout=10)
            return confirmar(token).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(enviar, tokens)) == [200, 400]
    assert User.objects.filter(email__iexact="nuevo@test.com").count() == 1


@pytest.mark.django_db(transaction=True)
def test_confirmacion_y_registro_concurrentes_no_activan_correo_ajeno(usuario, mailoutbox):
    if connection.vendor != "postgresql":
        pytest.skip("Requiere unicidad PostgreSQL")
    solicitar(usuario, email="nuevo@test.com", password=CLAVE)
    token = token_del_correo(mailoutbox[0])
    barrera = Barrier(2)
    def enviar(es_registro):
        close_old_connections()
        try:
            barrera.wait(timeout=10)
            if es_registro:
                return APIClient().post("/api/auth/register/", {
                    "email": "NUEVO@test.com", "password": CLAVE, "nombre": "Otro", "acepta_datos": True,
                }, format="json").status_code
            return confirmar(token).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert tuple(pool.map(enviar, [False, True])) in ((200, 400), (400, 201))
    assert User.objects.filter(email__iexact="nuevo@test.com").count() == 1
