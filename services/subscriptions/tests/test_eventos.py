"""Eventos de dominio: el trabajo derivado y el interruptor de la bandera.

Lo que estas pruebas tienen que dejar claro es que los DOS modos hacen
exactamente el mismo trabajo. Si eso no se cumple, la comparación con y sin
cola no mide arquitectura: mide dos programas distintos.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import OutboxEvento, ResumenOrganizacion, Subscription
from events import publicador, topologia
from events.trabajo import recalcular_resumen


@pytest.fixture
def cliente() -> APIClient:
    return APIClient()


@pytest.fixture
def org() -> uuid.UUID:
    return uuid.uuid4()


def crear(org, monto, frecuencia=Subscription.Frecuencia.MENSUAL,
          estado=Subscription.Estado.ACTIVO, moneda="CLP"):
    return Subscription.objects.create(
        organizacion_id=org,
        nombre=f"Servicio {monto} {moneda}",
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=frecuencia,
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria="streaming",
        estado=estado,
    )


def solo(resumenes):
    """Para las pruebas de una sola moneda: exige que haya exactamente una fila."""
    assert len(resumenes) == 1, f"se esperaba una moneda y hay {len(resumenes)}"
    return resumenes[0]


CUERPO = {
    "nombre": "Netflix",
    "monto": "9990",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-01",
    "categoria": "streaming",
    "estado": "activo",
}


# ── el trabajo derivado ──────────────────────────────────────────────

@pytest.mark.django_db
class TestRecalcularResumen:
    def test_suma_las_mensuales_tal_cual(self, org):
        crear(org, "1000")
        crear(org, "2500")
        assert solo(recalcular_resumen(org)).total_mensual == Decimal("3500.00")

    def test_divide_las_anuales_por_doce(self, org):
        crear(org, "12000", frecuencia=Subscription.Frecuencia.ANUAL)
        assert solo(recalcular_resumen(org)).total_mensual == Decimal("1000.00")

    def test_ignora_las_que_no_estan_activas(self, org):
        crear(org, "1000")
        crear(org, "9999", estado=Subscription.Estado.CANCELADO)
        resumen = solo(recalcular_resumen(org))
        assert resumen.total_mensual == Decimal("1000.00")
        assert resumen.cantidad_activas == 1

    def test_no_mezcla_organizaciones(self, org):
        otra = uuid.uuid4()
        crear(org, "1000")
        crear(otra, "5000")
        assert solo(recalcular_resumen(org)).total_mensual == Decimal("1000.00")
        assert solo(recalcular_resumen(otra)).total_mensual == Decimal("5000.00")

    def test_es_idempotente(self, org):
        """Regla 1 del catálogo: RabbitMQ entrega *al menos* una vez."""
        crear(org, "1000")
        primero = solo(recalcular_resumen(org))
        segundo = solo(recalcular_resumen(org))
        assert primero.id == segundo.id
        assert segundo.total_mensual == Decimal("1000.00")
        assert ResumenOrganizacion.objects.filter(organizacion_id=org).count() == 1

    def test_sin_suscripciones_no_deja_ninguna_fila(self, org):
        """Sin suscripciones no hay moneda de la cual informar.

        Antes devolvía una fila con total 0. Con el resumen por moneda eso ya
        no tiene sentido: ¿cero de qué divisa? Devuelve una lista vacía y no
        inventa una fila en una moneda que la organización nunca usó.
        """
        assert recalcular_resumen(org) == []
        assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()


@pytest.mark.django_db
class TestMonedas:
    """Regresión del [P1] de la revisión de la #78.

    Antes se sumaba `monto` sin mirar la divisa: 10.000 CLP más 10 USD daban
    10.010, que no es plata de ninguna moneda.
    """

    def test_no_suma_clp_con_usd(self, org):
        crear(org, "10000", moneda="CLP")
        crear(org, "10", moneda="USD")

        por_moneda = {r.moneda: r.total_mensual for r in recalcular_resumen(org)}

        assert por_moneda == {"CLP": Decimal("10000.00"), "USD": Decimal("10.00")}
        assert Decimal("10010") not in por_moneda.values()

    def test_una_fila_por_moneda(self, org):
        crear(org, "1000", moneda="CLP")
        crear(org, "2000", moneda="CLP")
        crear(org, "5", moneda="USD")

        resumenes = recalcular_resumen(org)

        assert len(resumenes) == 2
        por_moneda = {r.moneda: (r.total_mensual, r.cantidad_activas) for r in resumenes}
        assert por_moneda["CLP"] == (Decimal("3000.00"), 2)
        assert por_moneda["USD"] == (Decimal("5.00"), 1)

    def test_las_anuales_se_dividen_dentro_de_su_moneda(self, org):
        crear(org, "12000", frecuencia=Subscription.Frecuencia.ANUAL, moneda="CLP")
        crear(org, "120", frecuencia=Subscription.Frecuencia.ANUAL, moneda="USD")

        por_moneda = {r.moneda: r.total_mensual for r in recalcular_resumen(org)}

        assert por_moneda == {"CLP": Decimal("1000.00"), "USD": Decimal("10.00")}

    def test_una_moneda_que_se_deja_de_usar_no_queda_de_fantasma(self, org):
        usd = crear(org, "10", moneda="USD")
        crear(org, "1000", moneda="CLP")
        assert len(recalcular_resumen(org)) == 2

        usd.activo = False
        usd.save(update_fields=["activo"])

        resumenes = recalcular_resumen(org)
        assert [r.moneda for r in resumenes] == ["CLP"]
        assert not ResumenOrganizacion.objects.filter(
            organizacion_id=org, moneda="USD"
        ).exists()

    def test_sigue_siendo_idempotente_con_varias_monedas(self, org):
        crear(org, "1000", moneda="CLP")
        crear(org, "10", moneda="USD")

        primeros = {r.moneda: r.id for r in recalcular_resumen(org)}
        segundos = {r.moneda: r.id for r in recalcular_resumen(org)}

        assert primeros == segundos
        assert ResumenOrganizacion.objects.filter(organizacion_id=org).count() == 2

    def test_no_mezcla_monedas_entre_organizaciones(self, org):
        otra = uuid.uuid4()
        crear(org, "1000", moneda="CLP")
        crear(otra, "10", moneda="USD")

        assert [r.moneda for r in recalcular_resumen(org)] == ["CLP"]
        assert [r.moneda for r in recalcular_resumen(otra)] == ["USD"]


# ── el interruptor ───────────────────────────────────────────────────

EVENTO_CREADA = "suscripcion.creada"


@pytest.mark.django_db
class TestInterruptor:
    """Lo único que decide la bandera es QUIÉN espera.

    El evento se registra en el outbox en los dos modos: es parte del contrato
    MX-21 y puede haber otros consumidores. Lo que cambia es si el POST además
    recalcula el resumen antes de responder.

    Por eso estas pruebas no parchean el publicador: miran el outbox y la
    tabla del resumen, que es el estado real que deja cada camino.
    """

    def _crear(self, cliente, org, **cabeceras):
        return cliente.post(
            "/api/suscripciones/", CUERPO, format="json",
            headers={"X-Organizacion-Id": str(org), **cabeceras},
        )

    def test_sincrono_deja_el_resumen_listo_al_responder(self, cliente, org, settings):
        settings.EVENTOS_ASINCRONOS = False
        respuesta = self._crear(cliente, org)
        assert respuesta.status_code == status.HTTP_201_CREATED
        resumen = ResumenOrganizacion.objects.get(organizacion_id=org)
        assert resumen.total_mensual == Decimal("9990.00")

    def test_asincrono_NO_recalcula_en_la_peticion(self, cliente, org, settings):
        """La clave de la comparación: el POST responde sin hacer el trabajo."""
        settings.EVENTOS_ASINCRONOS = True
        respuesta = self._crear(cliente, org)
        assert respuesta.status_code == status.HTTP_201_CREATED
        assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()

    def test_el_evento_queda_en_el_outbox_en_los_dos_modos(self, cliente, settings):
        """La bandera no apaga el outbox: otros consumidores dependen de él."""
        for asincrono in (False, True):
            org = uuid.uuid4()
            settings.EVENTOS_ASINCRONOS = asincrono
            self._crear(cliente, org)
            eventos = OutboxEvento.objects.filter(organizacion_id=org)
            assert eventos.count() == 1, f"con EVENTOS_ASINCRONOS={asincrono}"
            assert eventos.get().evento == EVENTO_CREADA

    def test_el_evento_del_outbox_lleva_la_organizacion_y_su_correlation(
        self, cliente, org
    ):
        """Regla 4 del catálogo: un evento sin organizacion_id se rechaza."""
        correlation = str(uuid.uuid4())
        self._crear(cliente, org, **{"X-Correlation-ID": correlation})
        evento = OutboxEvento.objects.get(organizacion_id=org)
        assert str(evento.organizacion_id) == str(org)
        assert str(evento.correlation_id) == correlation

    def test_el_payload_lleva_proveedor_id_aunque_vaya_vacio(self, cliente, org):
        """Regresión del [P2] de la revisión: faltaba `proveedor_id`.

        Sin proveedor va null, no ausente: el consumidor puede confiar en la
        forma del sobre aunque el dato no esté.
        """
        self._crear(cliente, org)
        datos = OutboxEvento.objects.get(organizacion_id=org).datos
        assert "proveedor_id" in datos
        assert datos["proveedor_id"] is None

    def test_si_falla_el_resumen_no_queda_la_suscripcion_a_medias(
        self, cliente, org, settings, monkeypatch
    ):
        """El modo síncrono acopla a propósito: o entra todo, o no entra nada.

        Ese acoplamiento es exactamente lo que el modo asíncrono quita, y es
        lo que la comparación mide. Lo que NO puede pasar es quedar con la
        suscripción creada y el resumen a medio escribir.
        """
        def explotar(*_a, **_k):
            raise RuntimeError("se cayó el recálculo")

        settings.EVENTOS_ASINCRONOS = False
        monkeypatch.setattr("events.modo.recalcular_resumen", explotar)
        with pytest.raises(RuntimeError):
            self._crear(cliente, org)
        assert not Subscription.objects.filter(organizacion_id=org).exists()
        assert not OutboxEvento.objects.filter(organizacion_id=org).exists()

    def test_los_dos_modos_terminan_en_el_mismo_estado(self, cliente, settings):
        """Si esto falla, la comparación no mide arquitectura: mide otra cosa."""
        sincrona, asincrona = uuid.uuid4(), uuid.uuid4()

        settings.EVENTOS_ASINCRONOS = False
        self._crear(cliente, sincrona)

        settings.EVENTOS_ASINCRONOS = True
        self._crear(cliente, asincrona)
        # Lo que haría el consumidor al recibir el evento:
        recalcular_resumen(asincrona)

        uno = ResumenOrganizacion.objects.get(organizacion_id=sincrona)
        otro = ResumenOrganizacion.objects.get(organizacion_id=asincrona)
        assert uno.total_mensual == otro.total_mensual
        assert uno.cantidad_activas == otro.cantidad_activas


# ── la topología ─────────────────────────────────────────────────────

class CanalFalso:
    """Anota lo que le piden, para ver qué se declara y en qué orden."""

    def __init__(self):
        self.llamadas = []

    def exchange_declare(self, **kw):
        self.llamadas.append(("exchange", kw))

    def queue_declare(self, **kw):
        self.llamadas.append(("cola", kw))

    def queue_bind(self, **kw):
        self.llamadas.append(("enlace", kw))


class TestTopologia:
    """Regresión de un bug encontrado probando contra un RabbitMQ real.

    Un exchange topic descarta los mensajes que no tienen cola enlazada. Con
    `mandatory=True` el publicador se entera (UnroutableError) en vez de
    perderlos en silencio, pero igual no llegan: el outbox reintenta hasta los
    900 s. Declarando la cola en el publicador, los eventos esperan en ella
    aunque el consumidor todavía no haya arrancado.
    """

    def test_declara_exchange_cola_y_enlace(self):
        canal = CanalFalso()
        topologia.declarar(canal)
        assert [tipo for tipo, _ in canal.llamadas] == ["exchange", "cola", "enlace"]

    def test_la_cola_y_el_exchange_son_durables(self):
        """Sin durable, un reinicio del broker se lleva los eventos pendientes."""
        canal = CanalFalso()
        topologia.declarar(canal)
        for _, kw in canal.llamadas[:2]:
            assert kw["durable"] is True

    def test_el_enlace_cubre_el_evento_que_publicamos(self):
        canal = CanalFalso()
        topologia.declarar(canal)
        claves = {kw["routing_key"] for tipo, kw in canal.llamadas if tipo == "enlace"}
        assert EVENTO_CREADA in claves

    def test_el_publicador_declara_la_topologia_completa(self):
        """Si alguien vuelve a dejar solo el exchange, esto falla."""
        import inspect

        fuente = inspect.getsource(publicador.publicar)
        assert "declarar(canal)" in fuente
        assert "exchange_declare" not in fuente

    def test_el_exchange_tiene_una_sola_definicion(self):
        """Dos constantes con el mismo nombre se desincronizan calladas."""
        assert publicador.EXCHANGE is topologia.EXCHANGE
