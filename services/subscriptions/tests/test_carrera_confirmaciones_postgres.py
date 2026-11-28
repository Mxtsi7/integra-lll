"""Aplicar dos confirmaciones del MISMO servicio con dos conexiones reales.

La decisión de bloquear por `(organización, servicio normalizado)` solo se
comprueba si dos transacciones se cruzan de verdad: `bloquear()` no hace nada
en SQLite y una sola conexión serializa por definición. Acá:

    1. la primera confirmación de Netflix toma el advisory lock y se detiene
       con la transacción ABIERTA;
    2. la segunda de Netflix entra a `bloquear` y se queda esperando ESE lock;
    3. una de Spotify, mismo tenant, NO se bloquea y termina.

Al soltar la primera, la segunda continúa y ve la suscripción ya creada: hay
una sola Netflix con sus dos cobros. Sin el lock por servicio habría dos
suscripciones Netflix. Con un lock por organización, Spotify también habría
esperado, y eso es lo que se prohíbe (las escrituras HTTP toman FOR SHARE).

`transaction=True` porque pytest-django envuelve cada prueba en una transacción
que no se confirma y la otra conexión no vería nada.
"""

import json
import threading
import uuid

import pytest
from django.db import connection
from shared.borrado.models import EstadoOrganizacion

from app.models import Cobro, Subscription
from events import confirmaciones
from tests.test_aplicacion_confirmados import sobre as sobre_confirmacion

ORG = uuid.UUID("22222222-2222-2222-2222-222222222222")
ESPERA = 15.0
MARGEN_DE_BLOQUEO = 2.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


class Hilo(threading.Thread):
    def __init__(self, nombre, trabajo):
        super().__init__(name=nombre, daemon=True)
        self._trabajo = trabajo
        self.error = None
        self.resultado = None

    def run(self):
        try:
            self.resultado = self._trabajo()
        except BaseException as exc:  # noqa: BLE001 — se relanza en el principal
            self.error = exc
        finally:
            connection.close()

    def exigir_que_termino(self):
        self.join(ESPERA)
        assert not self.is_alive(), f"el hilo {self.name} se quedó colgado"
        if self.error is not None:
            raise self.error
        return self.resultado


def aplicar(servicio):
    evento = sobre_confirmacion(organizacion_id=ORG, servicio=servicio)
    return confirmaciones.procesar_confirmacion(json.dumps(evento).encode())


@pytest.mark.django_db(transaction=True)
def test_dos_netflix_se_serializan_y_spotify_no_espera(solo_postgres, monkeypatch):
    # La fila de control existe ANTES: su primer INSERT serializaría a todos
    # y la prueba mediría eso en vez del lock de servicio.
    EstadoOrganizacion.objects.get_or_create(organizacion_id=ORG)

    real = confirmaciones.bloquear
    primero_tomo = threading.Event()
    soltar_primero = threading.Event()
    segundo_entro = threading.Event()

    def bloquear_con_punto_de_encuentro(espacio, *partes):
        clave = partes[-1]  # servicio normalizado
        if clave == "spotify":
            return real(espacio, *partes)
        if not primero_tomo.is_set():
            real(espacio, *partes)
            primero_tomo.set()
            assert soltar_primero.wait(ESPERA), "nadie soltó a la primera"
            return None
        segundo_entro.set()
        # Acá se BLOQUEA en pg_advisory_xact_lock: la primera todavía no
        # confirmó su transacción. No hay sleeps que decidan el resultado.
        return real(espacio, *partes)

    monkeypatch.setattr(confirmaciones, "bloquear", bloquear_con_punto_de_encuentro)

    primera = Hilo("netflix-1", lambda: aplicar("Netflix"))
    primera.start()
    assert primero_tomo.wait(ESPERA), "la primera no tomó el lock"

    segunda = Hilo("netflix-2", lambda: aplicar("NETFLIX"))
    segunda.start()
    assert segundo_entro.wait(ESPERA), "la segunda no llegó al lock"

    spotify = Hilo("spotify", lambda: aplicar("Spotify"))
    spotify.start()
    spotify.exigir_que_termino()  # tiempo límite del join: no se bloqueó

    segunda.join(MARGEN_DE_BLOQUEO)
    assert segunda.is_alive(), "la segunda no esperó el lock de su servicio"

    soltar_primero.set()
    assert primera.exigir_que_termino().confirmar
    assert segunda.exigir_que_termino().confirmar
    assert spotify.resultado.confirmar

    netflix = list(Subscription.objects.filter(organizacion_id=ORG, nombre__icontains="Netflix"))
    assert len(netflix) == 1, "las dos confirmaciones crearon dos Netflix"
    assert Cobro.objects.filter(suscripcion=netflix[0]).count() == 2
    assert Subscription.objects.filter(organizacion_id=ORG, nombre="Spotify").count() == 1
    assert Cobro.objects.filter(organizacion_id=ORG).count() == 3
