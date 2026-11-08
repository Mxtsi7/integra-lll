"""
FE-05 — revocar con el token de REFRESCO y leer bien lo que contesta Google.

El problema que esto cierra (lo encontró la revisión de #72):

- Connectors mandaba primero el token de ACCESO. Google lo emite por una hora
  y Connectors no lo refresca, así que en cualquier cuenta conectada hace más
  de una hora el de acceso ya está vencido.
- Google responde `400 {"error": "invalid_token"}` a un token que ya no
  reconoce, y `revocar` solo aceptaba 200/204: la revocación no se confirmaba
  nunca y la limpieza de MX-07 quedaba en 409 para siempre.

Lo que tiene que quedar demostrado:

- con los dos tokens se manda el de refresco;
- `invalid_token` no acredita la revocación de la autorización completa,
  tampoco sobre el refresh; se conservan las credenciales para reintentar;
- cualquier otra respuesta sigue siendo "no confirmó" y conserva el ciphertext;
- si la fila desaparece mientras se habla con el proveedor, no se revienta.

Estas pruebas usan el `proveedores.revocar` REAL y solo reemplazan
`requests.post` por lo que respondería Google. Así se prueba también cómo se
lee la respuesta HTTP, no solo la lógica de arriba.
"""

import uuid
from datetime import timedelta
from io import StringIO

import pytest
import requests
from django.core.management import call_command
from django.utils import timezone

from connectors import proveedores
from connectors.models import CuentaConectada
from connectors.revocacion import revocar_y_desconectar

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")


class _Respuesta:
    def __init__(self, status_code, cuerpo=None, texto=None):
        self.status_code = status_code
        self._cuerpo = cuerpo
        self._texto = texto

    def json(self):
        if self._cuerpo is None:
            raise ValueError("no es JSON")
        return self._cuerpo


INVALID_TOKEN = _Respuesta(400, {"error": "invalid_token", "error_description": "Token expired or revoked"})


def google_falso(monkeypatch, responder):
    """Reemplaza `requests.post` de proveedores. `responder(token)` decide la
    respuesta; devuelve la lista de tokens que se mandaron a revocar."""
    enviados = []

    def post(url, data=None, timeout=None):
        assert url == "https://oauth2.googleapis.com/revoke"
        enviados.append(data["token"])
        resultado = responder(data["token"])
        if isinstance(resultado, Exception):
            raise resultado
        return resultado

    monkeypatch.setattr(proveedores.requests, "post", post)
    return enviados


def gmail(*, access="ya29.acceso", refresh="1//refresco", org=ORG_A, correo="p@gmail.com"):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor="gmail", cuenta_externa=correo,
        access_token=access, refresh_token=refresh,
        token_expira_en=timezone.now() - timedelta(hours=2),
    )


# ══════════════════════════════════════════════════════════════════════
# Qué token se manda
# ══════════════════════════════════════════════════════════════════════


class TestQueTokenSeManda:
    def test_con_los_dos_se_manda_el_de_refresco(self, claves, monkeypatch):
        cuenta = gmail()
        enviados = google_falso(monkeypatch, lambda t: _Respuesta(200))
        revocar_y_desconectar(cuenta)
        assert enviados == ["1//refresco"]

    def test_sin_refresco_se_manda_el_de_acceso(self, claves, monkeypatch):
        cuenta = gmail(refresh=None)
        enviados = google_falso(monkeypatch, lambda t: _Respuesta(200))
        revocar_y_desconectar(cuenta)
        assert enviados == ["ya29.acceso"]

    def test_el_caso_de_la_revision_access_vencido_y_refresh_vivo_se_confirma(
        self, claves, monkeypatch
    ):
        """Google rechaza el de acceso vencido y acepta el de refresco. Antes
        se mandaba el de acceso, llegaba 400 y no se confirmaba nunca."""
        cuenta = gmail()

        def google(token):
            return _Respuesta(200) if token.startswith("1//") else INVALID_TOKEN

        google_falso(monkeypatch, google)
        resultado = revocar_y_desconectar(cuenta)
        cuenta.refresh_from_db()
        assert resultado.confirmada is True
        assert cuenta.revocado_en is not None
        assert cuenta.access_token is None and cuenta.refresh_token is None

    def test_un_refresco_ilegible_no_se_manda_y_se_cae_al_de_acceso(self, claves, monkeypatch):
        """Refresh cifrado con una clave que se retiró, access legible: se manda
        el de acceso y el ciphertext del refresh queda intacto."""
        from shared.cifrado import SECRETO_ILEGIBLE
        from shared.cifrado.cifrador import generar_clave

        vieja, nueva = generar_clave(), generar_clave()
        claves(vieja)
        cuenta = gmail(access=None, refresh="1//refresco-con-clave-vieja")
        claves(nueva)                      # se retira la vieja: refresh ilegible
        cuenta = CuentaConectada.objects.get(pk=cuenta.pk)
        assert cuenta.refresh_token is SECRETO_ILEGIBLE
        cuenta.access_token = "ya29.acceso-legible"
        cuenta.save(update_fields=["access_token"])   # cifrado con la nueva
        cuenta = CuentaConectada.objects.get(pk=cuenta.pk)

        enviados = google_falso(monkeypatch, lambda t: _Respuesta(503))
        resultado = revocar_y_desconectar(cuenta)
        assert enviados == ["ya29.acceso-legible"]
        assert resultado.confirmada is False

        claves(nueva, vieja)               # se restaura la vieja
        cuenta = CuentaConectada.objects.get(pk=cuenta.pk)
        assert str(cuenta.refresh_token) == "1//refresco-con-clave-vieja"


# ══════════════════════════════════════════════════════════════════════
# Cómo se lee la respuesta de Google
# ══════════════════════════════════════════════════════════════════════


class TestLeerLaRespuesta:
    @pytest.mark.parametrize("codigo", [200, 204])
    def test_200_y_204_confirman(self, monkeypatch, codigo):
        google_falso(monkeypatch, lambda t: _Respuesta(codigo))
        assert proveedores.revocar("gmail", access_token="x") is True

    def test_invalid_token_es_TOKEN_INVALIDO(self, monkeypatch):
        google_falso(monkeypatch, lambda t: INVALID_TOKEN)
        assert proveedores.revocar("gmail", access_token="x") is proveedores.TOKEN_INVALIDO

    def test_TOKEN_INVALIDO_es_falso_como_booleano(self):
        """Quien trate la respuesta como bool lo lee como 'no confirmó', que
        es la lectura segura."""
        assert not proveedores.TOKEN_INVALIDO

    @pytest.mark.parametrize("respuesta", [
        _Respuesta(400, {"error": "unsupported_token_type"}),
        _Respuesta(400, None),                       # 400 sin JSON
        _Respuesta(400, ["invalid_token"]),          # JSON que no es objeto
        _Respuesta(401, {"error": "invalid_token"}), # otro código
        _Respuesta(500, {"error": "invalid_token"}),
        _Respuesta(503),
    ])
    def test_cualquier_otra_cosa_no_confirma(self, monkeypatch, respuesta):
        google_falso(monkeypatch, lambda t: respuesta)
        resultado = proveedores.revocar("gmail", access_token="x")
        assert resultado is False

    def test_un_error_de_red_no_confirma(self, monkeypatch):
        google_falso(monkeypatch, lambda t: requests.ConnectionError("sin red"))
        assert proveedores.revocar("gmail", access_token="x") is False

    def test_outlook_sigue_sin_llamar_a_nadie(self, monkeypatch):
        enviados = google_falso(monkeypatch, lambda t: _Respuesta(200))
        assert proveedores.revocar("outlook", access_token="x") is False
        assert enviados == []


# ══════════════════════════════════════════════════════════════════════
# Qué hace revocar_y_desconectar con TOKEN_INVALIDO
# ══════════════════════════════════════════════════════════════════════


class TestTokenInvalido:
    def test_sobre_el_de_REFRESCO_conserva_pendiente(self, claves, monkeypatch):
        """Rechazar un token no prueba la revocación de la autorización."""
        cuenta = gmail()
        google_falso(monkeypatch, lambda t: INVALID_TOKEN)
        resultado = revocar_y_desconectar(cuenta)
        cuenta.refresh_from_db()
        assert resultado.confirmada is False
        assert cuenta.revocado_en is None
        assert str(cuenta.access_token) == "ya29.acceso"
        assert str(cuenta.refresh_token) == "1//refresco"

    def test_sobre_el_de_ACCESO_no_acredita_nada(self, claves, monkeypatch):
        """Un access vencido también da invalid_token y la concesión puede
        seguir viva: no se escribe revocado_en y el token se conserva."""
        cuenta = gmail(refresh=None)
        google_falso(monkeypatch, lambda t: INVALID_TOKEN)
        resultado = revocar_y_desconectar(cuenta)
        cuenta.refresh_from_db()
        assert resultado.confirmada is False
        assert cuenta.revocado_en is None
        assert str(cuenta.access_token) == "ya29.acceso"
        assert cuenta.estado == CuentaConectada.Estado.DESCONECTADA
        assert "no acredita" in cuenta.detalle_del_estado

    def test_un_503_conserva_las_dos_credenciales(self, claves, monkeypatch):
        cuenta = gmail()
        google_falso(monkeypatch, lambda t: _Respuesta(503))
        resultado = revocar_y_desconectar(cuenta)
        cuenta.refresh_from_db()
        assert resultado.confirmada is False
        assert cuenta.revocado_en is None
        assert str(cuenta.refresh_token) == "1//refresco"
        assert str(cuenta.access_token) == "ya29.acceso"
        assert "no confirmó" in cuenta.detalle_del_estado

    def test_una_reconexion_durante_la_llamada_no_se_acredita_aunque_sea_invalid_token(
        self, claves, monkeypatch
    ):
        """El CAS de #107 sigue mandando: si reconectaron mientras Google
        contestaba, no se borran ni se acreditan las credenciales nuevas."""
        cuenta = gmail()

        def google(token):
            CuentaConectada.objects.filter(pk=cuenta.pk).update(
                access_token="ya29.NUEVO", refresh_token="1//NUEVO",
                estado=CuentaConectada.Estado.CONECTADA,
                credenciales_version=cuenta.credenciales_version + 1,
            )
            return INVALID_TOKEN

        google_falso(monkeypatch, google)
        resultado = revocar_y_desconectar(cuenta)
        cuenta.refresh_from_db()
        assert resultado.confirmada is False
        assert resultado.reconectada_mientras_tanto is True
        assert cuenta.revocado_en is None
        assert str(cuenta.refresh_token) == "1//NUEVO"


# ══════════════════════════════════════════════════════════════════════
# La fila desaparece mientras se habla con el proveedor
# ══════════════════════════════════════════════════════════════════════


class TestLaFilaDesaparece:
    """Desde MX-07 la limpieza de la organización borra las filas. Si eso pasa
    durante la llamada, releer lanzaba DoesNotExist."""

    def test_revocar_y_desconectar_no_revienta(self, claves, monkeypatch):
        cuenta = gmail()

        def google(token):
            CuentaConectada.objects.filter(pk=cuenta.pk).delete()
            return _Respuesta(200)

        google_falso(monkeypatch, google)
        resultado = revocar_y_desconectar(cuenta)
        assert resultado.ya_no_existe is True
        assert resultado.confirmada is False
        assert resultado.reconectada_mientras_tanto is False

    def test_el_comando_sigue_con_las_demas_organizaciones(self, claves, monkeypatch):
        """Antes abortaba y la pendiente de B no se procesaba en esa corrida."""
        a = gmail(org=ORG_A, correo="a@gmail.com", refresh="1//A")
        b = gmail(org=ORG_B, correo="b@gmail.com", refresh="1//B")
        CuentaConectada.objects.filter(pk__in=[a.pk, b.pk]).update(
            estado=CuentaConectada.Estado.DESCONECTADA
        )

        def google(token):
            if token == "1//A":
                CuentaConectada.objects.filter(pk=a.pk).delete()
            return _Respuesta(200)

        google_falso(monkeypatch, google)
        salida = StringIO()
        call_command("reintentar_revocaciones", aplicar=True, stdout=salida)
        b.refresh_from_db()
        assert b.revocado_en is not None, "la pendiente de B no se procesó"
        assert "se eliminó mientras tanto" in salida.getvalue()
