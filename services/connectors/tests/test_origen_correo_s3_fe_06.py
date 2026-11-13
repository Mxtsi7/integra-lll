"""S3-FE-06 — el servicio y el identificador de origen de cada mensaje.

Criterios de la tarjeta:
- dos mensajes distintos conservan identidad distinta;
- un proveedor desconocido no se asigna arbitrariamente.

Los resultados del normalizador que se esperan aquí salen de correr
`normalizar` de verdad sobre estos mismos textos (13-11-2026), no de suponer
lo que devuelve.
"""

import base64
import uuid
from datetime import datetime, timedelta, timezone as tz

import pytest
from django.utils import timezone

from connectors import lector_gmail, lector_outlook
from connectors.lectura_correo import MensajeCorreo, normalizar_message_id
from connectors.models import CuentaConectada
from connectors.origen_correo import (
    FUENTE_ASUNTO,
    FUENTE_DOMINIO,
    FUENTE_NINGUNA,
    FUENTE_NOMBRE,
    identificador_de,
    origen_de,
)

CUENTA_A = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
CUENTA_B = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")


def mensaje(*, remitente="Netflix <info@account.netflix.com>", asunto="Tu recibo", message_id="CAF1x2@mail.netflix.com",
            id_mensaje="18c2f0a1b2c3d4e5", cuenta=CUENTA_A, proveedor="gmail"):
    return MensajeCorreo(
        cuenta_id=cuenta, id_mensaje=id_mensaje, id_hilo="", recibido_en=datetime(2026, 10, 1, tzinfo=tz.utc),
        remitente=remitente, asunto=asunto, texto="", proveedor_correo=proveedor, message_id=message_id,
    )


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — dos mensajes distintos conservan identidad distinta
# ══════════════════════════════════════════════════════════════════════


class TestIdentidad:
    def test_el_mismo_message_id_es_la_misma_identidad(self):
        """Aunque llegue a dos cuentas (con copia) o por los dos proveedores:
        es un solo correo y un solo cobro."""
        en_gmail = mensaje(cuenta=CUENTA_A, proveedor="gmail", id_mensaje="18c2")
        en_outlook = mensaje(cuenta=CUENTA_B, proveedor="outlook", id_mensaje="AAMkAGUAAAwTW09AAA=")
        assert identificador_de(en_gmail) == identificador_de(en_outlook)

    def test_message_id_distinto_es_identidad_distinta(self):
        assert identificador_de(mensaje(message_id="a@x.com")) != identificador_de(mensaje(message_id="b@x.com"))

    def test_mayusculas_distintas_son_mensajes_distintos(self):
        """La parte izquierda distingue mayúsculas: no se normaliza de más."""
        assert identificador_de(mensaje(message_id="Ab@x.com")) != identificador_de(mensaje(message_id="ab@x.com"))

    def test_entra_siempre_en_el_campo(self):
        largo = "x" * 900 + "@ejemplo.com"
        identificador = identificador_de(mensaje(message_id=largo))
        assert identificador.startswith("mid:") and len(identificador) == 4 + 64

    def test_sin_message_id_se_usa_el_del_proveedor_dentro_de_su_buzon(self):
        a = identificador_de(mensaje(message_id="", cuenta=CUENTA_A, id_mensaje="18c2"))
        b = identificador_de(mensaje(message_id="", cuenta=CUENTA_B, id_mensaje="18c2"))
        assert a.startswith("gmail:") and b.startswith("gmail:")
        # El mismo id de Gmail en dos buzones son dos mensajes distintos.
        assert a != b
        assert identificador_de(mensaje(message_id="", id_mensaje="18c3")) != a

    def test_el_respaldo_no_choca_con_un_message_id(self):
        con = identificador_de(mensaje(message_id="18c2@x"))
        sin = identificador_de(mensaje(message_id="", id_mensaje="18c2@x"))
        assert con != sin

    def test_gmail_y_outlook_sin_message_id_no_chocan(self):
        assert identificador_de(mensaje(message_id="", proveedor="gmail")) != identificador_de(
            mensaje(message_id="", proveedor="outlook"))

    def test_sin_nada_no_se_inventa(self):
        with pytest.raises(ValueError):
            identificador_de(mensaje(message_id="", id_mensaje=""))
        with pytest.raises(ValueError):
            identificador_de(mensaje(message_id="", proveedor=""))


class TestNormalizarMessageId:
    @pytest.mark.parametrize("crudo, esperado", [
        ("<CAF1x2@mail.netflix.com>", "CAF1x2@mail.netflix.com"),
        ("  <CAF1x2@mail.netflix.com>  ", "CAF1x2@mail.netflix.com"),
        ("CAF1x2@mail.netflix.com", "CAF1x2@mail.netflix.com"),
        ("<a.b+c@[127.0.0.1]>", "a.b+c@[127.0.0.1]"),
    ])
    def test_validos(self, crudo, esperado):
        assert normalizar_message_id(crudo) == esperado

    @pytest.mark.parametrize("crudo", [
        None, "", "<>", "sin-arroba", "@solo-derecha", "solo-izquierda@", "<a@b> <c@d>", "a b@c", "a@b\x00",
        "a<b@c", "x" * 999 + "@a", 123,
    ])
    def test_no_usables(self, crudo):
        assert normalizar_message_id(crudo) == ""


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — un proveedor desconocido no se asigna arbitrariamente
# ══════════════════════════════════════════════════════════════════════


def servicio(remitente, asunto):
    origen = origen_de(mensaje(remitente=remitente, asunto=asunto))
    return origen.servicio.resultado, origen.servicio.proveedor, origen.servicio.candidatos, origen.fuente


class TestServicio:
    def test_el_nombre_del_remitente(self):
        assert servicio("Netflix <info@account.netflix.com>", "Tu recibo") == ("reconocido", "Netflix", (), FUENTE_NOMBRE)

    def test_el_dominio_si_el_nombre_no_dice(self):
        assert servicio("Facturación <billing@spotify.com>", "Tu recibo") == ("reconocido", "Spotify", (), FUENTE_DOMINIO)

    def test_un_intermediario_de_pago_cede_al_asunto(self):
        assert servicio("PayPal <service@paypal.com>", "Recibo de tu pago a Spotify AB") == (
            "reconocido", "Spotify", (), FUENTE_ASUNTO)
        assert servicio("Mercado Pago <info@mercadopago.cl>", "Pagaste Disney+") == (
            "reconocido", "Disney+", (), FUENTE_ASUNTO)

    def test_un_intermediario_que_escribe_desde_otro_dominio(self):
        """Algunos mandan desde un servicio de correo masivo: solo el NOMBRE
        dice que es PayPal, y viene con mayúsculas."""
        assert servicio("PayPal <notificaciones@envios.ejemplo-masivo.com>", "Recibo de tu pago a Spotify AB") == (
            "reconocido", "Spotify", (), FUENTE_ASUNTO)

    def test_un_remitente_ambiguo_que_el_asunto_resuelve(self):
        assert servicio("Microsoft <billing@microsoft.com>", "Tu factura de Microsoft 365") == (
            "reconocido", "Microsoft 365", (), FUENTE_ASUNTO)

    def test_un_remitente_ambiguo_que_el_asunto_no_resuelve(self):
        resultado, proveedor, candidatos, _ = servicio("Apple <no_reply@email.apple.com>", "Tu recibo de Apple")
        assert (resultado, proveedor) == ("ambiguo", None)
        assert candidatos == ("Apple Music", "Apple TV+", "iCloud")

    def test_apple_cobrando_una_suscripcion_ajena_no_se_decide(self):
        resultado, proveedor, candidatos, fuente = servicio("Apple <no_reply@email.apple.com>", "Recibo de Netflix")
        assert (resultado, proveedor, fuente) == ("ambiguo", None, FUENTE_NINGUNA)
        assert "Netflix" in candidatos and "iCloud" in candidatos

    def test_la_promocion_de_una_tienda_no_es_un_cobro_del_servicio(self):
        """El caso que obligó a la regla: el asunto nombra Netflix, pero el
        remitente es una tienda. Se sugiere, no se asigna."""
        resultado, proveedor, candidatos, fuente = servicio(
            "Falabella <ofertas@falabella.com>", "Gana Netflix gratis con tu tarjeta")
        assert (resultado, proveedor, candidatos, fuente) == ("ambiguo", None, ("Netflix",), FUENTE_NINGUNA)

    def test_remitente_y_asunto_en_desacuerdo(self):
        resultado, proveedor, candidatos, fuente = servicio("Netflix <info@netflix.com>", "Tu pago de Spotify")
        assert (resultado, proveedor, candidatos, fuente) == ("ambiguo", None, ("Netflix", "Spotify"), FUENTE_NINGUNA)

    def test_nada_reconocible_queda_desconocido(self):
        resultado, proveedor, candidatos, fuente = servicio("Juan <juan@empresa.cl>", "hola")
        assert (resultado, proveedor, candidatos, fuente) == ("desconocido", None, (), FUENTE_NINGUNA)

    def test_un_intermediario_sin_asunto_util_queda_desconocido(self):
        resultado, proveedor, _, _ = servicio("PayPal <service@paypal.com>", "Recibiste un pago")
        assert (resultado, proveedor) == ("desconocido", None)

    def test_flow_no_calza_dentro_de_otra_palabra(self):
        """`flow` es intermediario, pero `overflow` no lo es."""
        resultado, proveedor, _, _ = servicio("Overflow Store <hola@overflow.cl>", "Tu pago de Spotify")
        assert (resultado, proveedor) == ("ambiguo", None)

    def test_el_original_se_conserva(self):
        origen = origen_de(mensaje(remitente="Falabella <ofertas@falabella.com>", asunto="Gana Netflix gratis"))
        assert origen.servicio.original == "Gana Netflix gratis"
        assert origen.remitente == "ofertas@falabella.com"


# ══════════════════════════════════════════════════════════════════════
# Los lectores entregan lo que esto necesita
# ══════════════════════════════════════════════════════════════════════


class _Respuesta:
    def __init__(self, cuerpo):
        self.status_code = 200
        self._cuerpo = cuerpo
        self.headers = {}

    def json(self):
        return self._cuerpo


@pytest.mark.django_db
class TestLosLectoresTraenElMessageId:
    def _cuenta(self, proveedor):
        return CuentaConectada.objects.create(
            organizacion_id=uuid.uuid4(), proveedor=proveedor, cuenta_externa=f"p@{proveedor}.com",
            access_token="tok", refresh_token="ref", token_expira_en=timezone.now() + timedelta(minutes=50),
        )

    def test_gmail_lee_la_cabecera_message_id(self, claves, monkeypatch):
        cuenta = self._cuenta("gmail")
        cuerpo = {"id": "m1", "threadId": "m1", "internalDate": "1727780400000", "payload": {
            "mimeType": "text/plain", "filename": "",
            "headers": [{"name": "From", "value": "Netflix <info@netflix.com>"},
                        {"name": "Message-ID", "value": "<CAF1x2@mail.netflix.com>"}],
            "body": {"data": base64.urlsafe_b64encode(b"hola").decode().rstrip("=")}}}

        def get(url, params=None, headers=None, timeout=None):
            return _Respuesta({"messages": [{"id": "m1", "threadId": "m1"}]} if url == lector_gmail.URL_MENSAJES
                              else cuerpo)

        monkeypatch.setattr(lector_gmail.requests, "get", get)
        (leido,) = lector_gmail.leer_mensajes(organizacion_id=cuenta.organizacion_id, cuenta_id=cuenta.pk).mensajes
        assert (leido.message_id, leido.proveedor_correo) == ("CAF1x2@mail.netflix.com", "gmail")

    def test_outlook_pide_y_lee_internet_message_id(self, claves, monkeypatch):
        cuenta = self._cuenta("outlook")
        pedido = {}

        def get(url, params=None, headers=None, timeout=None, allow_redirects=True):
            pedido.update(params or {})
            return _Respuesta({"value": [{
                "id": "AAMk=", "internetMessageId": "<BN6PR@namprd.outlook.com>",
                "receivedDateTime": "2026-10-01T11:00:00Z", "subject": "x", "from": {}, "body": {}}]})

        monkeypatch.setattr(lector_outlook.requests, "get", get)
        (leido,) = lector_outlook.leer_mensajes(organizacion_id=cuenta.organizacion_id, cuenta_id=cuenta.pk).mensajes
        assert "internetMessageId" in pedido["$select"].split(",")
        assert (leido.message_id, leido.proveedor_correo) == ("BN6PR@namprd.outlook.com", "outlook")
