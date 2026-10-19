import logging
from datetime import datetime, timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from rest_framework.test import APIClient

from app.models import Organizacion, User
from app.recuperacion import generador_token, generar_token_compuesto, usuario_desde_token

URL = "/api/auth/password-reset/"


@pytest.fixture()
def usuario(db):
    org = Organizacion.objects.create(nombre="Hogar de prueba")
    return User.objects.create_user(
        email="ana@test.com",
        password="ClaveSegura123",
        nombre="Ana",
        organizacion=org,
        rol="titular",
    )


def _token_del_correo(correo) -> str:
    enlace = next(linea for linea in correo.body.splitlines() if "token=" in linea)
    return parse_qs(urlparse(enlace.strip()).query)["token"][0]


@pytest.mark.django_db
class TestRespuestaNeutra:
    def test_correo_existente_y_no_existente_responden_identico(self, usuario, mailoutbox):
        existe = APIClient().post(URL, {"email": "ana@test.com"}, format="json")
        no_existe = APIClient().post(URL, {"email": "nadie@test.com"}, format="json")

        assert existe.status_code == no_existe.status_code == 200
        assert existe.data == no_existe.data
        assert len(mailoutbox) == 1
        assert mailoutbox[0].to == ["ana@test.com"]

    def test_usuario_inactivo_no_recibe_correo_y_responde_igual(self, usuario, mailoutbox):
        usuario.is_active = False
        usuario.save()
        resp = APIClient().post(URL, {"email": "ana@test.com"}, format="json")

        assert resp.status_code == 200
        assert mailoutbox == []

    def test_usuario_sin_clave_utilizable_no_recibe_correo(self, usuario, mailoutbox):
        usuario.set_unusable_password()
        usuario.save()
        resp = APIClient().post(URL, {"email": usuario.email}, format="json")
        desconocido = APIClient().post(URL, {"email": "nadie@test.com"}, format="json")

        assert resp.status_code == desconocido.status_code == 200
        assert resp.data == desconocido.data
        assert mailoutbox == []

    def test_fallo_del_envio_no_cambia_la_respuesta(self, usuario):
        with patch("app.recuperacion.send_mail", side_effect=OSError("smtp caído")):
            resp = APIClient().post(URL, {"email": "ana@test.com"}, format="json")
        assert resp.status_code == 200

    def test_email_es_case_insensitive(self, usuario, mailoutbox):
        APIClient().post(URL, {"email": "ANA@Test.com"}, format="json")
        assert len(mailoutbox) == 1

    @pytest.mark.parametrize("body", [{}, {"email": "no-es-correo"}])
    def test_body_invalido_da_400(self, body):
        assert APIClient().post(URL, body, format="json").status_code == 400


@pytest.mark.django_db
class TestToken:
    def test_el_token_del_correo_identifica_al_usuario(self, usuario, mailoutbox):
        APIClient().post(URL, {"email": "ana@test.com"}, format="json")
        assert usuario_desde_token(_token_del_correo(mailoutbox[0])) == usuario

    def test_el_token_no_aparece_en_los_logs(self, usuario, mailoutbox, caplog):
        with caplog.at_level(logging.DEBUG):
            APIClient().post(URL, {"email": "ana@test.com"}, format="json")
        token = _token_del_correo(mailoutbox[0])
        assert token not in caplog.text
        assert token.split(".")[1] not in caplog.text

    def test_backend_configurado_no_imprime_el_correo(self, usuario, settings, capsys):
        from config import settings as configuracion

        # pytest-django sustituye el backend por locmem: comprobar también el
        # configurado por la aplicación, sin conectar a un servidor SMTP real.
        settings.EMAIL_BACKEND = configuracion.EMAIL_BACKEND
        with patch("django.core.mail.backends.smtp.EmailBackend.send_messages", return_value=1):
            resp = APIClient().post(URL, {"email": usuario.email}, format="json")

        assert resp.status_code == 200
        salida = capsys.readouterr()
        assert "token=" not in salida.out + salida.err

    def test_es_de_un_solo_uso(self, usuario):
        token = generar_token_compuesto(usuario)
        usuario.set_password("OtraClave456")
        usuario.save()
        assert usuario_desde_token(token) is None

    def test_caduca_a_los_60_minutos(self, usuario):
        ahora = datetime(2026, 10, 14, 12, 0, 0)
        with patch.object(generador_token, "_now", return_value=ahora):
            token = generar_token_compuesto(usuario)
        with patch.object(generador_token, "_now", return_value=ahora + timedelta(seconds=3599)):
            assert usuario_desde_token(token) == usuario
        with patch.object(generador_token, "_now", return_value=ahora + timedelta(minutes=60)):
            assert usuario_desde_token(token) is None
        with patch.object(generador_token, "_now", return_value=ahora + timedelta(minutes=61)):
            assert usuario_desde_token(token) is None

    def test_el_limite_no_se_amplia_con_password_reset_timeout(self, usuario, settings):
        settings.PASSWORD_RESET_TIMEOUT = 7200
        ahora = datetime(2026, 10, 14, 12, 0, 0)
        with patch.object(generador_token, "_now", return_value=ahora):
            token = generar_token_compuesto(usuario)
        with patch.object(generador_token, "_now", return_value=ahora + timedelta(minutes=60)):
            assert usuario_desde_token(token) is None

    @pytest.mark.parametrize("token", ["", "basura", "MQ.basura", "xx.1-abc"])
    def test_token_malformado_es_invalido(self, usuario, token):
        assert usuario_desde_token(token) is None
