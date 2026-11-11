"""S3-FE-15 y S3-FE-16 — confirmar contra rechazar, con dos conexiones a PostgreSQL.

`test_confirmar_segunda_revision.py` prueba la decisión con UNA conexión: qué
hace el código cuando la fila ya cambió. Esto prueba el mecanismo, que es el
que las revisiones de #159 usaron para reproducir el defecto: dos peticiones
HTTP reales, cada una en su conexión y en su transacción, coordinadas por
eventos y sin un solo `sleep` que decida nada.

── Los tres intercalados ───────────────────────────────────────────────────

    1. confirmar lee `propuesto` → rechazar confirma su transacción →
       confirmar sigue.          Esperado: 409 candidato_rechazado, el rechazo
                                 conservado, CERO órdenes.
                                 (Antes: 200 con estado "rechazado".)

    2. rechazar lee `propuesto` → confirmar confirma su transacción →
       rechazar sigue.           Esperado: 409 candidato_ya_confirmado, la
                                 confirmación conservada, UNA orden.

    3. confirmar escribe y NO confirma todavía → rechazar intenta escribir.
                                 Esperado: rechazar SE BLOQUEA en la fila; al
                                 confirmar el otro, reevalúa su WHERE, afecta
                                 0 filas y responde 409. Es el orden que
                                 SQLite no puede mostrar.

Cada petición corre entera dentro de la transacción que abre
`EscrituraOrganizacionMiddleware`, con el bloqueo de la organización en modo
compartido: dos escrituras no se estorban entre sí por ese bloqueo, así que lo
que serializa la carrera es la fila del candidato y nada más.

`transaction=True` porque pytest-django envuelve cada prueba en una
transacción que no se confirma, y la otra conexión no vería nada.
"""

import threading
import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection, connections
from rest_framework.test import APIClient

from connectors import confirmacion, views
from connectors.models import CobroCandidato, Importacion, OutboxEvento
from shared.borrado.models import EstadoOrganizacion

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
QUIEN_CONFIRMA = "42"
QUIEN_RECHAZA = "77"

#: Cuánto se espera a que un hilo llegue a su punto de encuentro. Generoso: si
#: se agota es que algo no pasó, no que el equipo esté lento.
ESPERA = 15.0

#: Cuánto se le da al segundo para demostrar que NO está bloqueado. Es una
#: cota inferior: sin el bloqueo de fila, el UPDATE vuelve en milisegundos.
MARGEN_DE_BLOQUEO = 2.0


@pytest.fixture
def solo_postgres():
    if connection.vendor != "postgresql":
        pytest.skip("dos conexiones de verdad: solo contra PostgreSQL")


class Hilo(threading.Thread):
    """Un hilo con su propia conexión, que guarda su error y su resultado."""

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
            connections.close_all()

    def exigir_que_termino(self):
        self.join(ESPERA)
        assert not self.is_alive(), f"el hilo {self.name} se quedó colgado"
        if self.error is not None:
            raise self.error
        return self.resultado


@pytest.fixture
def candidato(solo_postgres):
    # La fila de control de la organización se crea ANTES de la carrera. Su
    # primer `get_or_create` es un INSERT, y dos peticiones simultáneas se
    # serializarían ahí en vez de en el candidato, que es lo que se mide.
    EstadoOrganizacion.objects.get_or_create(organizacion_id=ORG)
    importacion = Importacion.objects.create(
        organizacion_id=ORG,
        usuario_id=QUIEN_CONFIRMA,
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
    )
    return CobroCandidato.objects.create(
        organizacion_id=ORG,
        importacion=importacion,
        origen=CobroCandidato.Origen.CSV,
        identificador_origen="sha:2",
        servicio="Netflix",
        servicio_texto="NETFLIX.COM",
        servicio_resultado="reconocido",
        importe=Decimal("9990"),
        moneda="CLP",
        fecha=date(2026, 10, 1),
        tipo_mensaje=CobroCandidato.TipoMensaje.COBRO_REALIZADO,
        estado=CobroCandidato.Estado.PROPUESTO,
        evidencia={"fila": "2", "descripcion_original": "NETFLIX.COM"},
    )


def pedir(accion, candidato, usuario):
    """Una petición HTTP real, con su propio cliente (y, en su hilo, su conexión)."""
    respuesta = APIClient().post(
        f"/api/candidatos/{candidato.pk}/{accion}/",
        headers={"X-Organizacion-Id": str(ORG), "X-Usuario-Id": usuario},
    )
    return respuesta.status_code, respuesta.json()


@pytest.mark.django_db(transaction=True)
class TestConfirmarYRechazarSeCruzan:
    def test_el_rechazo_que_gana_deja_a_confirmar_con_409(self, candidato, monkeypatch):
        """El defecto reproducido por la revisión: confirmar ya leyó
        `propuesto`, el rechazo confirma su transacción en otra conexión, y
        confirmar sigue. Respondía 200 con `estado="rechazado"`."""
        confirmar_leyo = threading.Event()
        confirmar_puede_seguir = threading.Event()
        real = confirmacion.confirmar

        def detenerse_despues_de_leer(leido, **extra):
            # La vista ya hizo su lectura en ESTA transacción.
            assert leido.estado == CobroCandidato.Estado.PROPUESTO
            confirmar_leyo.set()
            assert confirmar_puede_seguir.wait(ESPERA), "nadie soltó a confirmar"
            return real(leido, **extra)

        monkeypatch.setattr(views.confirmacion, "confirmar", detenerse_despues_de_leer)

        confirmar = Hilo("confirmar", lambda: pedir("confirmar", candidato, QUIEN_CONFIRMA))
        confirmar.start()
        assert confirmar_leyo.wait(ESPERA), "confirmar no llegó a leer"

        # El rechazo entra y CONFIRMA su transacción mientras el otro espera.
        rechazar = Hilo("rechazar", lambda: pedir("rechazar", candidato, QUIEN_RECHAZA))
        rechazar.start()
        assert rechazar.exigir_que_termino()[0] == 200

        confirmar_puede_seguir.set()
        codigo, cuerpo = confirmar.exigir_que_termino()

        assert codigo == 409
        assert cuerpo["codigo"] == confirmacion.CANDIDATO_RECHAZADO
        assert OutboxEvento.objects.count() == 0
        candidato.refresh_from_db()
        assert candidato.estado == CobroCandidato.Estado.RECHAZADO
        assert candidato.decidido_por == QUIEN_RECHAZA

    def test_la_confirmacion_que_gana_deja_a_rechazar_con_409(self, candidato, monkeypatch):
        """El orden inverso: rechazar ya leyó `propuesto` y la confirmación
        confirma su transacción antes de que escriba."""
        rechazar_leyo = threading.Event()
        rechazar_puede_seguir = threading.Event()
        real = CobroCandidato.rechazar

        def detenerse_despues_de_leer(self, **extra):
            assert self.estado == CobroCandidato.Estado.PROPUESTO
            rechazar_leyo.set()
            assert rechazar_puede_seguir.wait(ESPERA), "nadie soltó a rechazar"
            return real(self, **extra)

        monkeypatch.setattr(CobroCandidato, "rechazar", detenerse_despues_de_leer)

        rechazar = Hilo("rechazar", lambda: pedir("rechazar", candidato, QUIEN_RECHAZA))
        rechazar.start()
        assert rechazar_leyo.wait(ESPERA), "rechazar no llegó a leer"

        confirmar = Hilo("confirmar", lambda: pedir("confirmar", candidato, QUIEN_CONFIRMA))
        confirmar.start()
        assert confirmar.exigir_que_termino()[0] == 200

        rechazar_puede_seguir.set()
        codigo, cuerpo = rechazar.exigir_que_termino()

        assert codigo == 409
        assert cuerpo["codigo"] == "candidato_ya_confirmado"
        assert OutboxEvento.objects.count() == 1
        candidato.refresh_from_db()
        assert candidato.estado == CobroCandidato.Estado.CONFIRMADO
        assert candidato.decidido_por == QUIEN_CONFIRMA

    def test_quien_escribe_primero_bloquea_al_otro_hasta_confirmar(self, candidato, monkeypatch):
        """Lo que solo PostgreSQL puede mostrar. Confirmar hace su UPDATE y se
        detiene con la transacción abierta; rechazar llega a su UPDATE y se
        queda esperando la fila. Cuando el primero confirma, el segundo
        reevalúa su `WHERE`, encuentra el candidato confirmado y pierde con
        409: ni pisa la decisión ni borra la orden."""
        confirmar_escribio = threading.Event()
        confirmar_puede_terminar = threading.Event()
        real_sobre = confirmacion._sobre

        def detenerse_con_la_fila_tomada(leido, **extra):
            # `_sobre` se arma dentro de la transacción, después del UPDATE.
            confirmar_escribio.set()
            assert confirmar_puede_terminar.wait(ESPERA), "nadie soltó a confirmar"
            return real_sobre(leido, **extra)

        monkeypatch.setattr(confirmacion, "_sobre", detenerse_con_la_fila_tomada)

        confirmar = Hilo("confirmar", lambda: pedir("confirmar", candidato, QUIEN_CONFIRMA))
        confirmar.start()
        assert confirmar_escribio.wait(ESPERA), "confirmar no llegó a escribir"

        rechazar = Hilo("rechazar", lambda: pedir("rechazar", candidato, QUIEN_RECHAZA))
        rechazar.start()
        rechazar.join(MARGEN_DE_BLOQUEO)
        assert rechazar.is_alive(), "rechazar no se bloqueó: escribió sobre una fila tomada"

        confirmar_puede_terminar.set()
        assert confirmar.exigir_que_termino()[0] == 200
        codigo, cuerpo = rechazar.exigir_que_termino()

        assert codigo == 409
        assert cuerpo["codigo"] == "candidato_ya_confirmado"
        assert OutboxEvento.objects.count() == 1
        candidato.refresh_from_db()
        assert candidato.estado == CobroCandidato.Estado.CONFIRMADO
        assert candidato.decidido_por == QUIEN_CONFIRMA

    def test_dos_confirmaciones_simultaneas_dejan_una_sola_orden(self, candidato, monkeypatch):
        """El comportamiento correcto que la corrección tenía que preservar:
        200 y 200, la auditoría de la primera y exactamente una orden."""
        primera_escribio = threading.Event()
        primera_puede_terminar = threading.Event()
        real_sobre = confirmacion._sobre

        def detenerse_con_la_fila_tomada(leido, **extra):
            primera_escribio.set()
            assert primera_puede_terminar.wait(ESPERA), "nadie soltó a la primera"
            return real_sobre(leido, **extra)

        monkeypatch.setattr(confirmacion, "_sobre", detenerse_con_la_fila_tomada)

        primera = Hilo("primera", lambda: pedir("confirmar", candidato, QUIEN_CONFIRMA))
        primera.start()
        assert primera_escribio.wait(ESPERA), "la primera no llegó a escribir"

        segunda = Hilo("segunda", lambda: pedir("confirmar", candidato, QUIEN_RECHAZA))
        segunda.start()
        segunda.join(MARGEN_DE_BLOQUEO)
        assert segunda.is_alive(), "la segunda no se bloqueó"

        primera_puede_terminar.set()
        codigo_1, cuerpo_1 = primera.exigir_que_termino()
        codigo_2, cuerpo_2 = segunda.exigir_que_termino()

        assert (codigo_1, codigo_2) == (200, 200)
        assert OutboxEvento.objects.count() == 1
        # Las dos respuestas cuentan la misma decisión: la de la primera.
        assert cuerpo_1["decidido_por"] == cuerpo_2["decidido_por"] == QUIEN_CONFIRMA
        assert cuerpo_1["decidido_en"] == cuerpo_2["decidido_en"]
