"""
FE-17 / FE-18 — la proyección de suscripciones que alimenta al generador.

Sin broker: `aplicar()` recibe el sobre ya decodificado (FE-24 lo va a
enganchar a RabbitMQ). Lo que se prueba es que un sobre del catálogo deje
los datos correctos, que uno fuera de orden no pise datos más nuevos, y que
uno roto se rechace en vez de ensuciar la proyección.
"""

import datetime as dt
import uuid
from decimal import Decimal

import pytest

from notifications.models import SuscripcionVigilada
from notifications.proyeccion import SobreInvalido, aplicar

pytestmark = pytest.mark.django_db

ORG = "11111111-1111-1111-1111-111111111111"
SUSC = "33333333-3333-3333-3333-333333333333"


def sobre(evento="suscripcion.creada", *, ocurrido="2026-11-01T12:00:00Z",
          org=ORG, susc=SUSC, **datos):
    base = {
        "suscripcion_id": susc, "proveedor_id": None, "nombre": "Netflix",
        "monto": "9990.00", "moneda": "CLP", "ciclo": "mensual",
        "proximo_cobro": "2026-11-24", "estado": "activo",
    }
    base.update(datos)
    return {
        "evento": evento, "version": 2, "id": str(uuid.uuid4()),
        "ocurrido_en": ocurrido, "correlation_id": str(uuid.uuid4()),
        "organizacion_id": org, "datos": base,
    }


def fila():
    return SuscripcionVigilada.objects.get(suscripcion_id=uuid.UUID(SUSC))


class TestCreada:
    def test_deja_la_suscripcion_con_sus_datos(self):
        assert aplicar(sobre()) is True
        f = fila()
        assert str(f.organizacion_id) == ORG
        assert f.nombre == "Netflix"
        assert f.monto == Decimal("9990.00") and f.moneda == "CLP"
        assert f.ciclo == "mensual"
        assert f.proximo_cobro == dt.date(2026, 11, 24)
        assert f.estado == "activo"
        assert f.fin_prueba is None
        assert f.observada_en.isoformat() == "2026-11-01T12:00:00+00:00"

    def test_guarda_fin_de_prueba_si_el_sobre_la_trae(self):
        """Extensión del contrato: hoy MX-21 v2 no la incluye."""
        aplicar(sobre(estado="prueba", fin_prueba="2026-11-23"))
        assert fila().fin_prueba == dt.date(2026, 11, 23)

    def test_reprocesarla_no_duplica_la_fila(self):
        s = sobre()
        aplicar(s)
        assert aplicar(s) is False
        assert SuscripcionVigilada.objects.count() == 1

    def test_no_mezcla_organizaciones(self):
        aplicar(sobre(org=ORG))
        aplicar(sobre(org="22222222-2222-2222-2222-222222222222"))
        assert SuscripcionVigilada.objects.count() == 2


class TestActualizadaYEstado:
    def test_actualizada_mueve_el_proximo_cobro(self):
        aplicar(sobre())
        aplicar(sobre("suscripcion.actualizada", ocurrido="2026-11-25T09:00:00Z",
                      proximo_cobro="2026-12-24", monto="10990.00",
                      campos_modificados=["monto", "proximo_cobro"]))
        f = fila()
        assert f.proximo_cobro == dt.date(2026, 12, 24)
        assert f.monto == Decimal("10990.00")

    def test_estado_cambiado_deja_el_estado_nuevo(self):
        aplicar(sobre())
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-10T09:00:00Z",
                      estado="cancelado", estado_anterior="activo",
                      evento_estado="cancelacion_usuario"))
        assert fila().estado == "cancelado"

    def test_un_evento_mas_viejo_no_pisa_uno_mas_nuevo(self):
        """Fuera de orden: la cancelación de hoy llega antes que la
        actualización de ayer. La de ayer no puede resucitarla."""
        aplicar(sobre())
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-10T09:00:00Z",
                      estado="cancelado"))
        cambio = aplicar(sobre("suscripcion.actualizada", ocurrido="2026-11-09T09:00:00Z",
                               estado="activo", monto="1.00"))
        assert cambio is False
        f = fila()
        assert f.estado == "cancelado" and f.monto == Decimal("9990.00")

    def test_el_mismo_instante_tampoco_pisa(self):
        aplicar(sobre())
        assert aplicar(sobre(nombre="Otro")) is False
        assert fila().nombre == "Netflix"


class TestSobresInvalidos:
    def test_un_evento_que_no_escuchamos_se_ignora(self):
        assert aplicar(sobre("precio.aumentado")) is False
        assert not SuscripcionVigilada.objects.exists()

    @pytest.mark.parametrize("roto, texto", [
        ({"organizacion_id": "no-es-uuid"}, "organizacion_id"),
        ({"ocurrido_en": "ayer"}, "ocurrido_en"),
        ({"ocurrido_en": "2026-11-01T12:00:00"}, "zona horaria"),
    ])
    def test_un_sobre_sin_lo_basico_se_rechaza(self, roto, texto):
        s = sobre()
        s.update(roto)
        with pytest.raises(SobreInvalido, match=texto):
            aplicar(s)
        assert not SuscripcionVigilada.objects.exists()

    @pytest.mark.parametrize("datos, texto", [
        ({"suscripcion_id": "x"}, "suscripcion_id"),
        ({"proximo_cobro": "24/11/2026"}, "proximo_cobro"),
        ({"monto": "nueve mil"}, "monto"),
        ({"estado": ""}, "estado"),
        ({"fin_prueba": "mañana"}, "fin_prueba"),
    ])
    def test_unos_datos_rotos_se_rechazan(self, datos, texto):
        with pytest.raises(SobreInvalido, match=texto):
            aplicar(sobre(**datos))

    def test_algo_que_no_es_un_objeto_se_rechaza(self):
        with pytest.raises(SobreInvalido):
            aplicar([])


# ══════════════════════════════════════════════════════════════════════
# La proyección no inventa lo que el contrato exige
# (hallazgo de la revisión de #119)
# ══════════════════════════════════════════════════════════════════════


class TestNoInventaDatos:
    """MX-21 v2 declara obligatorios `nombre`, `monto`, `moneda`, `ciclo`,
    `proximo_cobro` y `estado`.

    La versión anterior asumía `monto="0.00"`, `moneda="CLP"` y
    `ciclo="mensual"`, y trataba `proximo_cobro` como opcional. Un sobre
    incompleto producía una alerta de **"0 CLP"** en vez de rechazarse: el
    usuario recibía un aviso de un cobro que nadie sabe cuánto es.
    """

    @pytest.mark.parametrize(
        "campo", ["nombre", "monto", "moneda", "ciclo", "proximo_cobro", "estado"]
    )
    def test_si_falta_un_campo_obligatorio_se_rechaza(self, campo):
        s = sobre()
        del s["datos"][campo]
        with pytest.raises(SobreInvalido, match="obligatorio"):
            aplicar(s)
        assert not SuscripcionVigilada.objects.exists(), "guardo una fila a medias"

    @pytest.mark.parametrize(
        "campo", ["nombre", "monto", "moneda", "ciclo", "estado"]
    )
    def test_un_campo_vacio_es_lo_mismo_que_ausente(self, campo):
        with pytest.raises(SobreInvalido):
            aplicar(sobre(**{campo: ""}))
        assert not SuscripcionVigilada.objects.exists()

    @pytest.mark.parametrize(
        "moneda, porque",
        [
            ("pesos", "antes se recortaba a 3 y quedaba 'pes'"),
            ("CL", "dos letras"),
            ("clp", "minúsculas"),
            ("CLP1", "con dígito"),
        ],
    )
    def test_una_moneda_que_no_es_el_codigo_se_rechaza(self, moneda, porque):
        with pytest.raises(SobreInvalido, match="moneda"):
            aplicar(sobre(moneda=moneda))
        assert not SuscripcionVigilada.objects.exists(), porque

    @pytest.mark.parametrize("ciclo", ["mensualmente", "semanal", "MENSUAL", "x"])
    def test_un_ciclo_fuera_del_contrato_se_rechaza(self, ciclo):
        """Antes se recortaba a 10 caracteres: 'mensualmente' quedaba en
        'mensualmen', que no es un ciclo, y se guardaba igual."""
        with pytest.raises(SobreInvalido, match="ciclo"):
            aplicar(sobre(ciclo=ciclo))
        assert not SuscripcionVigilada.objects.exists()

    def test_un_sobre_completo_SI_se_aplica(self):
        """El control: la validación no puede rechazar lo correcto."""
        assert aplicar(sobre()) is True
        f = fila()
        assert f.nombre == "Netflix"
        assert str(f.monto) == "9990.00"
        assert f.moneda == "CLP"
        assert f.ciclo == "mensual"

    def test_fin_prueba_sigue_siendo_OPCIONAL(self):
        """No está en MX-21 v2: es una extensión. Exigirlo rompería a los
        productores que cumplen el contrato."""
        s = sobre()
        s["datos"].pop("fin_prueba", None)
        assert aplicar(s) is True
        assert fila().fin_prueba is None

    def test_proveedor_id_en_null_se_acepta(self):
        """El contrato lo permite: una suscripción puede no tener proveedor."""
        assert aplicar(sobre(proveedor_id=None)) is True
