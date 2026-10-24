"""Eventos de dominio: el trabajo derivado, el interruptor y el sobre.

Lo que estas pruebas tienen que dejar claro es que los DOS modos hacen
exactamente el mismo trabajo. Si eso no se cumple, la comparación con y sin
cola no mide arquitectura: mide dos programas distintos.
"""

import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import ResumenOrganizacion, Subscription
from events import despacho, publicador, topologia
from events.trabajo import recalcular_resumen


@pytest.fixture
def cliente() -> APIClient:
    return APIClient()


@pytest.fixture
def org() -> uuid.UUID:
    return uuid.uuid4()


def crear(org, monto, frecuencia=Subscription.Frecuencia.MENSUAL,
          estado=Subscription.Estado.ACTIVO, moneda=Subscription.Moneda.CLP):
    return Subscription.objects.create(
        organizacion_id=org,
        nombre=f"Servicio {monto} {moneda}",
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=frecuencia,
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria=Subscription.Categoria.STREAMING,
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
        crear(org, "10000", moneda=Subscription.Moneda.CLP)
        crear(org, "10", moneda=Subscription.Moneda.USD)

        por_moneda = {r.moneda: r.total_mensual for r in recalcular_resumen(org)}

        assert por_moneda == {"CLP": Decimal("10000.00"), "USD": Decimal("10.00")}
        assert Decimal("10010") not in por_moneda.values()

    def test_una_fila_por_moneda(self, org):
        crear(org, "1000", moneda=Subscription.Moneda.CLP)
        crear(org, "2000", moneda=Subscription.Moneda.CLP)
        crear(org, "5", moneda=Subscription.Moneda.USD)

        resumenes = recalcular_resumen(org)

        assert len(resumenes) == 2
        por_moneda = {r.moneda: (r.total_mensual, r.cantidad_activas) for r in resumenes}
        assert por_moneda["CLP"] == (Decimal("3000.00"), 2)
        assert por_moneda["USD"] == (Decimal("5.00"), 1)

    def test_las_anuales_se_dividen_dentro_de_su_moneda(self, org):
        crear(org, "12000", frecuencia=Subscription.Frecuencia.ANUAL, moneda=Subscription.Moneda.CLP)
        crear(org, "120", frecuencia=Subscription.Frecuencia.ANUAL, moneda=Subscription.Moneda.USD)

        por_moneda = {r.moneda: r.total_mensual for r in recalcular_resumen(org)}

        assert por_moneda == {"CLP": Decimal("1000.00"), "USD": Decimal("10.00")}

    def test_una_moneda_que_se_deja_de_usar_no_queda_de_fantasma(self, org):
        usd = crear(org, "10", moneda=Subscription.Moneda.USD)
        crear(org, "1000", moneda=Subscription.Moneda.CLP)
        assert len(recalcular_resumen(org)) == 2

        usd.activo = False
        usd.save(update_fields=["activo"])

        resumenes = recalcular_resumen(org)
        assert [r.moneda for r in resumenes] == ["CLP"]
        assert not ResumenOrganizacion.objects.filter(
            organizacion_id=org, moneda="USD"
        ).exists()

    def test_sigue_siendo_idempotente_con_varias_monedas(self, org):
        crear(org, "1000", moneda=Subscription.Moneda.CLP)
        crear(org, "10", moneda=Subscription.Moneda.USD)

        primeros = {r.moneda: r.id for r in recalcular_resumen(org)}
        segundos = {r.moneda: r.id for r in recalcular_resumen(org)}

        assert primeros == segundos
        assert ResumenOrganizacion.objects.filter(organizacion_id=org).count() == 2

    def test_no_mezcla_monedas_entre_organizaciones(self, org):
        otra = uuid.uuid4()
        crear(org, "1000", moneda=Subscription.Moneda.CLP)
        crear(otra, "10", moneda=Subscription.Moneda.USD)

        assert [r.moneda for r in recalcular_resumen(org)] == ["CLP"]
        assert [r.moneda for r in recalcular_resumen(otra)] == ["USD"]


# ── el sobre del catálogo ────────────────────────────────────────────

class TestSobre:
    def test_tiene_exactamente_los_campos_del_catalogo(self):
        s = publicador.sobre("suscripcion.creada", {"x": 1}, uuid.uuid4(), "abc")
        assert set(s) == {
            "evento", "version", "id", "ocurrido_en",
            "correlation_id", "organizacion_id", "datos",
        }

    def test_la_organizacion_viaja_siempre(self):
        """Regla 4: un evento sin organizacion_id se rechaza."""
        org = uuid.uuid4()
        assert publicador.sobre("suscripcion.creada", {}, org)["organizacion_id"] == str(org)

    def test_el_correlation_id_nunca_va_vacio(self):
        """El contrato lo valida con `format: uuid` (MX-21): "" lo incumple."""
        s = publicador.sobre("suscripcion.creada", {}, uuid.uuid4())
        assert s["correlation_id"]
        assert uuid.UUID(s["correlation_id"])

    def test_el_correlation_id_generado_viene_con_guiones(self):
        """32 caracteres sin guiones pasan por UUID y fallan `format: uuid`."""
        generado = publicador.sobre("suscripcion.creada", {}, uuid.uuid4())["correlation_id"]
        assert str(uuid.UUID(generado)) == generado

    def test_respeta_el_correlation_id_que_le_pasan(self):
        """El de la petición manda: es lo que une el evento con el HTTP."""
        de_la_peticion = str(uuid.uuid4())
        s = publicador.sobre("suscripcion.creada", {}, uuid.uuid4(), de_la_peticion)
        assert s["correlation_id"] == de_la_peticion

    def test_el_id_es_distinto_en_cada_evento(self):
        """El id sirve para descartar duplicados; repetido no serviría."""
        uno = publicador.sobre("suscripcion.creada", {}, uuid.uuid4())["id"]
        otro = publicador.sobre("suscripcion.creada", {}, uuid.uuid4())["id"]
        assert uno != otro


# ── el interruptor ───────────────────────────────────────────────────

@pytest.mark.django_db
class TestInterruptor:
    def test_sincrono_deja_el_resumen_listo_al_responder(self, cliente, org, settings):
        settings.EVENTOS_ASINCRONOS = False
        respuesta = cliente.post(
            "/api/suscripciones/", CUERPO, format="json",
            headers={"X-Organizacion-Id": str(org)},
        )
        assert respuesta.status_code == status.HTTP_201_CREATED
        resumen = ResumenOrganizacion.objects.get(organizacion_id=org)
        assert resumen.total_mensual == Decimal("9990.00")

    def test_asincrono_publica_y_NO_recalcula_en_la_peticion(self, cliente, org, settings):
        settings.EVENTOS_ASINCRONOS = True
        with patch.object(despacho, "publicar") as publicar_falso:
            respuesta = cliente.post(
                "/api/suscripciones/", CUERPO, format="json",
                headers={"X-Organizacion-Id": str(org)},
            )
        assert respuesta.status_code == status.HTTP_201_CREATED
        publicar_falso.assert_called_once()
        # La clave de la comparación: el POST respondió SIN hacer el trabajo.
        assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()

    def test_publica_el_evento_del_catalogo_con_su_organizacion(self, cliente, org, settings):
        settings.EVENTOS_ASINCRONOS = True
        with patch.object(despacho, "publicar") as publicar_falso:
            cliente.post(
                "/api/suscripciones/", CUERPO, format="json",
                headers={"X-Organizacion-Id": str(org), "X-Correlation-ID": "corr-1"},
            )
        evento, datos, organizacion, correlation = publicar_falso.call_args.args
        assert evento == "suscripcion.creada"
        assert str(organizacion) == str(org)
        assert correlation == "corr-1"
        assert set(datos) == {
            "suscripcion_id", "proveedor_id", "monto", "ciclo", "proximo_cobro",
        }

    def test_el_payload_lleva_los_cinco_campos_del_catalogo(self, cliente, org, settings):
        """Regresión del [P2] de la revisión: faltaba `proveedor_id`.

        El catálogo declara suscripcion_id, proveedor_id, monto, ciclo y
        proximo_cobro. Nadie valida el payload contra el contrato todavía, así
        que un campo faltante no lo avisa nada.
        """
        settings.EVENTOS_ASINCRONOS = True
        with patch.object(despacho, "publicar") as publicar_falso:
            cliente.post(
                "/api/suscripciones/", CUERPO, format="json",
                headers={"X-Organizacion-Id": str(org)},
            )
        datos = publicar_falso.call_args.args[1]
        del_catalogo = {"suscripcion_id", "proveedor_id", "monto", "ciclo", "proximo_cobro"}
        assert set(datos) == del_catalogo
        # Sin proveedor va null, no ausente: el consumidor puede confiar en la
        # forma del sobre aunque el dato no esté.
        assert datos["proveedor_id"] is None

    def test_si_rabbitmq_esta_caido_la_suscripcion_igual_se_crea(self, cliente, org, settings):
        """El ADR-003 existe para desacoplar; tumbar el POST sería lo contrario."""
        settings.EVENTOS_ASINCRONOS = True
        with patch.object(despacho, "publicar", side_effect=OSError("broker caído")):
            respuesta = cliente.post(
                "/api/suscripciones/", CUERPO, format="json",
                headers={"X-Organizacion-Id": str(org)},
            )
        assert respuesta.status_code == status.HTTP_201_CREATED
        assert Subscription.objects.filter(organizacion_id=org).count() == 1

    def test_los_dos_modos_terminan_en_el_mismo_estado(self, cliente, settings):
        """Si esto falla, la comparación no mide arquitectura: mide otra cosa."""
        sincrona, asincrona = uuid.uuid4(), uuid.uuid4()

        settings.EVENTOS_ASINCRONOS = False
        cliente.post("/api/suscripciones/", CUERPO, format="json",
                     headers={"X-Organizacion-Id": str(sincrona)})

        settings.EVENTOS_ASINCRONOS = True
        with patch.object(despacho, "publicar"):
            cliente.post("/api/suscripciones/", CUERPO, format="json",
                         headers={"X-Organizacion-Id": str(asincrona)})
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

    Un exchange topic descarta en silencio los mensajes que no tienen cola
    enlazada. Si el publicador solo declaraba el exchange, todo lo publicado
    antes de que arrancara el consumidor se perdía: sin error y sin rastro.
    Por eso la cola y el enlace los declaran los dos lados.
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
        assert despacho.EVENTO_SUSCRIPCION_CREADA in claves

    def test_el_publicador_declara_la_topologia_completa(self):
        """Si alguien vuelve a dejar solo el exchange, esto falla."""
        import inspect

        fuente = inspect.getsource(publicador._canal_vivo)
        assert "declarar(" in fuente
        assert "exchange_declare" not in fuente
