"""
FE-05 — la reconexión concurrente, con dos conexiones a PostgreSQL de verdad.

`test_oauth.py` simula el intercalado DENTRO de los dobles: reconecta en la
misma conexión, en el punto exacto. Es determinístico y vale, pero no prueba
que una reconexión confirmada por OTRA conexión (otro worker, el callback de
OAuth corriendo en la API) se vea desde el comando. Esto es eso.

── Cómo se vuelve determinístico ──────────────────────────────────────────
No hay `sleep` que decida nada. El hilo A corre el comando con su propia
conexión y se detiene en el punto que se le pida (justo después de
seleccionar las pendientes, o justo cuando está "hablando con el proveedor"),
avisa, y no sigue hasta que la prueba lo suelte. Mientras está detenido, la
prueba reconecta la cuenta desde la conexión principal y CONFIRMA. Después
suelta a A y mira qué le mandó al proveedor y cómo quedó la cuenta.

── Lo que se exige ────────────────────────────────────────────────────────
· reconexión ANTES de releer → A no llama al proveedor y no toca nada;
· reconexión DURANTE el proveedor → A llamó con el token VIEJO y la escritura
  condicional dejó las credenciales nuevas intactas y sin `revocado_en`.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma, y otra conexión no vería nada. Solo contra
PostgreSQL: SQLite en memoria no se comparte entre hilos.
"""

import threading
import uuid
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connection, connections
from django.utils import timezone

from connectors import proveedores
from connectors.management.commands import reintentar_revocaciones as cmd
from connectors.models import CuentaConectada

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
ESPERA = 15.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


@pytest.fixture(autouse=True)
def entorno(settings, claves):
    settings.OAUTH_CREDENCIALES = {
        "gmail": {"client_id": "cliente-de-prueba", "client_secret": "secreto"},
    }


class Hilo(threading.Thread):
    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.error = None
        self.termino = threading.Event()

    def run(self):
        try:
            self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connections.close_all()
            self.termino.set()


def pendiente():
    return CuentaConectada.objects.create(
        organizacion_id=ORG, proveedor="gmail", cuenta_externa="p@gmail.com",
        access_token="ya29.token-viejo",
        estado=CuentaConectada.Estado.DESCONECTADA,
    )


def reconectar(cuenta):
    """Lo que deja el callback de OAuth, confirmado en ESTA conexión."""
    CuentaConectada.objects.filter(pk=cuenta.pk).update(
        access_token="ya29.TOKEN-NUEVO",
        refresh_token="1//REFRESH-NUEVO",
        estado=CuentaConectada.Estado.CONECTADA,
        credenciales_version=cuenta.credenciales_version + 1,
        revocado_en=None,
        actualizado_en=timezone.now(),
    )


def correr_comando_en_hilo():
    salida = StringIO()
    hilo = Hilo("A", lambda: call_command("reintentar_revocaciones", aplicar=True, stdout=salida))
    return hilo, salida


@pytest.mark.django_db(transaction=True)
class TestReconexionDesdeOtraConexion:
    def test_reconectar_ANTES_de_releer_no_llama_al_proveedor(self, solo_postgres, monkeypatch):
        cuenta = pendiente()
        a_selecciono = threading.Event()
        a_puede_seguir = threading.Event()
        tocados = []

        real = cmd.pendientes_de_revocar

        def seleccionar_y_detenerse(organizacion_id=None):
            seleccionadas = list(real(organizacion_id))
            a_selecciono.set()
            assert a_puede_seguir.wait(ESPERA), "nadie soltó a A"
            return seleccionadas

        monkeypatch.setattr(cmd, "pendientes_de_revocar", seleccionar_y_detenerse)
        monkeypatch.setattr(
            proveedores, "revocar",
            lambda proveedor, *, access_token: tocados.append(access_token) or True,
        )

        hilo, salida = correr_comando_en_hilo()
        try:
            hilo.start()
            assert a_selecciono.wait(ESPERA), "A nunca seleccionó"
            # Otra conexión reconecta y confirma mientras A está detenido.
            reconectar(cuenta)
        finally:
            a_puede_seguir.set()
            hilo.join(ESPERA)
        assert not hilo.is_alive() and hilo.error is None, hilo.error

        assert tocados == [], f"le mandó al proveedor: {tocados}"
        cuenta.refresh_from_db()
        assert cuenta.estado == CuentaConectada.Estado.CONECTADA
        assert str(cuenta.access_token) == "ya29.TOKEN-NUEVO"
        assert cuenta.revocado_en is None
        assert "no se tocó" in salida.getvalue()

    def test_reconectar_DURANTE_el_proveedor_no_toca_las_nuevas(self, solo_postgres, monkeypatch):
        cuenta = pendiente()
        a_en_el_proveedor = threading.Event()
        a_puede_seguir = threading.Event()
        tocados = []

        def revocar_y_detenerse(proveedor, *, access_token):
            tocados.append(access_token)
            a_en_el_proveedor.set()
            assert a_puede_seguir.wait(ESPERA), "nadie soltó a A"
            return True  # el proveedor confirma… el token viejo

        monkeypatch.setattr(proveedores, "revocar", revocar_y_detenerse)

        hilo, salida = correr_comando_en_hilo()
        try:
            hilo.start()
            assert a_en_el_proveedor.wait(ESPERA), "A nunca llegó al proveedor"
            reconectar(cuenta)
        finally:
            a_puede_seguir.set()
            hilo.join(ESPERA)
        assert not hilo.is_alive() and hilo.error is None, hilo.error

        assert tocados == ["ya29.token-viejo"]
        cuenta.refresh_from_db()
        assert cuenta.estado == CuentaConectada.Estado.CONECTADA
        assert str(cuenta.access_token) == "ya29.TOKEN-NUEVO"
        assert str(cuenta.refresh_token) == "1//REFRESH-NUEVO"
        assert cuenta.revocado_en is None, "acreditó la revocación de las nuevas"
        assert "se reconectó mientras tanto" in salida.getvalue()

    def test_sin_reconexion_de_por_medio_SI_revoca(self, solo_postgres, monkeypatch):
        """El control, también con el comando en otro hilo."""
        cuenta = pendiente()
        tocados = []
        monkeypatch.setattr(
            proveedores, "revocar",
            lambda proveedor, *, access_token: tocados.append(access_token) or True,
        )
        hilo, salida = correr_comando_en_hilo()
        hilo.start()
        hilo.join(ESPERA)
        assert hilo.error is None, hilo.error
        assert tocados == ["ya29.token-viejo"]
        cuenta.refresh_from_db()
        assert cuenta.revocado_en is not None
        assert cuenta.access_token is None
        assert "confirmada" in salida.getvalue()
