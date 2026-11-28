"""RF-14: aplicar las órdenes de cobro de connectors, sin duplicar el cargo.

`candidato.confirmado` v1 llega por `subscriptions.candidatos` y lo aplica
`app.candidatos.aplicar`. Lo que se prueba:

  · la orden crea la suscripción o usa la que había, y el cobro si hubo pago;
  · el mismo cargo por correo y por cartola deja DOS cobros y el hallazgo de
    posible doble cobro: no se adivina; la persona concilia («es el mismo»,
    queda uno con los dos orígenes, RN-DAT-004) o lo marca revisado («son dos»);
  · un pago nuevo saca a la suscripción de cancelada o de por confirmar con la
    transición de RF-03; un aviso, un fallo o un cobro viejo no;
  · cada orden aplicada (o apartada a fallos) deja su respuesta para connectors;
  · reentregar no repite nada; un sobre fuera de contrato va a fallos;
  · una organización eliminada no recibe escrituras.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time
from decimal import Decimal

import pytest
from django.utils import timezone

from app.anomalias import MISMO_CARGO, conciliar_doble_cobro
from app.candidatos import aplicar
from app.management.commands import consumir_eventos
from app.management.commands.consumir_eventos import Command, procesar_candidato
from app.models import (
    CandidatoAplicado, Cobro, HallazgoCobro, OutboxEvento, Proveedor, ResumenOrganizacion,
    Subscription, TrabajoDerivado,
)
from events.trabajo import OrganizacionEliminada
from shared.borrado.models import EstadoOrganizacion
from shared.contratos import candidato_aplicado, candidato_confirmado

pytestmark = pytest.mark.django_db


@pytest.fixture
def org():
    return uuid.uuid4()


@pytest.fixture
def netflix():
    return Proveedor.objects.get_or_create(nombre="Netflix", defaults={"categoria": "streaming"})[0]


def sobre(org, *, origen="correo", identificador=None, importe="9990.00", moneda="CLP",
          fecha="2026-11-05", tipo="cobro_realizado", servicio="Netflix", candidato=None, id_sobre=None):
    crear = tipo == "cobro_realizado"
    return {
        "evento": "candidato.confirmado",
        "version": 1,
        "id": str(id_sobre or uuid.uuid4()),
        "ocurrido_en": "2026-11-06T12:00:00Z",
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": str(org),
        "datos": {
            "candidato_id": str(candidato or uuid.uuid4()),
            "importacion_id": str(uuid.uuid4()),
            "origen": origen,
            "identificador_origen": identificador or f"{origen}:{uuid.uuid4().hex}",
            "servicio": servicio,
            "servicio_texto": f"PAGO {servicio.upper()}",
            "importe": importe,
            "moneda": moneda,
            "fecha": fecha,
            "tipo_mensaje": tipo,
            "crear_cobro": crear,
            "decidido_por": "7",
            "evidencia": {"fila": 3},
        },
    }


def suscripcion(org, proveedor=None, *, nombre="Netflix", moneda="CLP", estado=Subscription.Estado.ACTIVO,
                activo=True):
    return Subscription.objects.create(
        organizacion_id=org, nombre=nombre, proveedor=proveedor, monto=Decimal("9990"), moneda=moneda,
        frecuencia=Subscription.Frecuencia.MENSUAL, fecha_proximo_cobro=date(2026, 12, 5),
        estado=estado, activo=activo,
    )


# ── la suscripción ───────────────────────────────────────────────────────


class TestLaSuscripcion:
    def test_sin_suscripcion_la_crea_con_lo_que_dice_la_orden(self, org, netflix):
        aplicacion = aplicar(sobre(org, fecha="2026-01-31"))

        nueva = Subscription.objects.get(organizacion_id=org)
        assert (nueva.nombre, nueva.proveedor, nueva.categoria) == ("Netflix", netflix, "streaming")
        assert (nueva.monto, nueva.moneda, nueva.frecuencia) == (Decimal("9990.00"), "CLP", "mensual")
        # Un mes después del cobro, sin saltarse febrero.
        assert nueva.fecha_proximo_cobro == date(2026, 2, 28)
        assert nueva.estado == Subscription.Estado.ACTIVO
        assert aplicacion.nueva and aplicacion.fila.suscripcion_creada

    def test_crearla_avisa_y_deja_el_resumen_hecho(self, org, netflix):
        aplicar(sobre(org))
        evento = OutboxEvento.objects.get(organizacion_id=org, evento="suscripcion.creada")
        assert ResumenOrganizacion.objects.get(organizacion_id=org).cantidad_activas == 1
        # Acreditado contra ese evento: el consumidor no lo recalcula otra vez.
        assert TrabajoDerivado.objects.filter(evento_id=evento.id).exists()

    def test_usa_la_que_ya_existe_por_proveedor_aunque_se_llame_distinto(self, org, netflix):
        propia = suscripcion(org, netflix, nombre="Netflix familiar")
        aplicar(sobre(org))
        assert Subscription.objects.filter(organizacion_id=org).count() == 1
        assert Cobro.objects.get(organizacion_id=org).suscripcion == propia
        assert not OutboxEvento.objects.filter(organizacion_id=org, evento="suscripcion.creada").exists()

    def test_o_por_nombre_si_se_creo_a_mano_sin_proveedor(self, org, netflix):
        propia = suscripcion(org, None, nombre="netflix")
        aplicar(sobre(org))
        assert Cobro.objects.get(organizacion_id=org).suscripcion == propia

    def test_no_usa_la_de_otra_organizacion_ni_la_de_otra_moneda_ni_una_desactivada(self, org, netflix):
        ajena = suscripcion(uuid.uuid4(), netflix)
        en_dolares = suscripcion(org, netflix, moneda="USD")
        desactivada = suscripcion(org, netflix, activo=False)
        aplicar(sobre(org))
        usada = Cobro.objects.get(organizacion_id=org).suscripcion
        assert usada not in (ajena, en_dolares, desactivada)
        assert usada.moneda == "CLP" and usada.activo

    def test_prefiere_la_vigente_y_usa_la_cancelada_solo_si_no_hay_otra(self, org, netflix):
        cancelada = suscripcion(org, netflix, estado=Subscription.Estado.CANCELADO)
        vigente = suscripcion(org, netflix)
        aplicar(sobre(org))
        assert Cobro.objects.get(organizacion_id=org).suscripcion == vigente

        otra_org = uuid.uuid4()
        sola = suscripcion(otra_org, netflix, estado=Subscription.Estado.CANCELADO)
        aplicar(sobre(otra_org))
        cobro = Cobro.objects.get(organizacion_id=otra_org)
        # El cobro de una cancelada es lo que la persona tiene que ver; no se
        # inventa otra suscripción ni se le cambia el estado.
        assert cobro.suscripcion == sola
        sola.refresh_from_db()
        assert sola.estado == Subscription.Estado.CANCELADO
        assert cancelada.pk != sola.pk

    def test_no_toca_el_proximo_cobro_de_la_que_existia(self, org, netflix):
        propia = suscripcion(org, netflix)
        aplicar(sobre(org, fecha="2026-11-20"))
        propia.refresh_from_db()
        assert propia.fecha_proximo_cobro == date(2026, 12, 5)

    def test_servicio_fuera_del_catalogo_crea_sin_proveedor(self, org):
        aplicar(sobre(org, servicio="Gimnasio Pacific"))
        nueva = Subscription.objects.get(organizacion_id=org)
        assert (nueva.nombre, nueva.proveedor, nueva.categoria) == ("Gimnasio Pacific", None, "otro")


# ── el cobro y los tipos de mensaje ──────────────────────────────────────


class TestElCobro:
    def test_cobro_realizado_registra_el_cobro_con_su_origen(self, org, netflix):
        aplicacion = aplicar(sobre(org, origen="csv", identificador="csv:abc"))
        cobro = Cobro.objects.get(organizacion_id=org)
        assert (cobro.monto, cobro.moneda, cobro.fecha) == (Decimal("9990.00"), "CLP", date(2026, 11, 5))
        fila = aplicacion.fila
        assert (fila.cobro, fila.resultado) == (cobro, CandidatoAplicado.Resultado.COBRO_CREADO)
        assert (fila.origen, fila.identificador_origen) == ("csv", "csv:abc")

    def test_aviso_de_cobro_no_registra_un_pago(self, org, netflix):
        aplicacion = aplicar(sobre(org, tipo="aviso_de_cobro", fecha="2026-12-05"))
        assert not Cobro.objects.filter(organizacion_id=org).exists()
        assert aplicacion.fila.resultado == CandidatoAplicado.Resultado.SIN_COBRO
        assert aplicacion.fila.cobro is None
        # Lo que se avisó es el próximo cobro.
        assert Subscription.objects.get(organizacion_id=org).fecha_proximo_cobro == date(2026, 12, 5)

    def test_pago_fallido_sin_suscripcion_la_deja_por_confirmar(self, org, netflix):
        aplicar(sobre(org, tipo="pago_fallido"))
        assert not Cobro.objects.filter(organizacion_id=org).exists()
        assert Subscription.objects.get(organizacion_id=org).estado == Subscription.Estado.POR_CONFIRMAR

    def test_la_orden_decide_el_cobro_no_el_tipo(self, org, netflix):
        # La decisión viaja resuelta (confirmacion.CREA_COBRO). Si dice que no
        # hubo pago, no se re-deduce otra cosa del tipo de mensaje.
        orden = sobre(org)
        orden["datos"]["crear_cobro"] = False
        aplicar(orden)
        assert not Cobro.objects.filter(organizacion_id=org).exists()


# ── el mismo cargo por las dos fuentes ───────────────────────────────────


def el_doble_cobro(org) -> HallazgoCobro:
    return HallazgoCobro.objects.get(organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO)


class TestElMismoCargoSeVeYNoSeAdivina:
    """La segunda revisión de #242: fecha, importe y moneda iguales no prueban
    que sea el mismo cargo. Nada se junta solo; sale el posible doble cobro."""

    def test_correo_y_cartola_del_mismo_dia_dejan_dos_cobros_y_el_hallazgo(self, org, netflix):
        aplicar(sobre(org, origen="correo", identificador="<abc@netflix.com>", fecha="2026-11-05"))
        segunda = aplicar(sobre(org, origen="csv", identificador="csv:huella-1", fecha="2026-11-05"))

        assert Cobro.objects.filter(organizacion_id=org).count() == 2
        assert segunda.fila.resultado == CandidatoAplicado.Resultado.COBRO_CREADO
        hallazgo = el_doble_cobro(org)
        assert hallazgo.estado == HallazgoCobro.Estado.PENDIENTE
        assert hallazgo.detalle["dias_diferencia"] == 0
        # Cada cobro con su fuente: lo que la persona necesita para decidir.
        fuentes = {o.origen for c in (hallazgo.cobro, hallazgo.cobro_relacionado) for o in c.origenes.all()}
        assert fuentes == {"correo", "csv"}

    @pytest.mark.parametrize("fecha_csv", ["2026-11-02", "2026-11-04"])
    def test_con_fechas_distintas_tambien(self, org, netflix, fecha_csv):
        aplicar(sobre(org, origen="correo", fecha="2026-11-01"))
        aplicar(sobre(org, origen="csv", fecha=fecha_csv))
        assert Cobro.objects.filter(organizacion_id=org).count() == 2
        assert el_doble_cobro(org).estado == HallazgoCobro.Estado.PENDIENTE

    def test_un_cobro_ingresado_a_mano_tampoco_se_junta(self, org, netflix):
        propia = suscripcion(org, netflix)
        Cobro.objects.create(organizacion_id=org, suscripcion=propia, monto=Decimal("9990"), fecha=date(2026, 11, 5))
        aplicar(sobre(org, origen="csv"))
        assert Cobro.objects.filter(organizacion_id=org).count() == 2
        assert el_doble_cobro(org)

    def test_dos_lineas_de_la_misma_fuente_son_dos_cobros(self, org, netflix):
        aplicar(sobre(org, origen="csv", identificador="csv:1"))
        aplicar(sobre(org, origen="csv", identificador="csv:2"))
        assert Cobro.objects.filter(organizacion_id=org).count() == 2

    def test_lejos_en_el_tiempo_no_hay_hallazgo(self, org, netflix):
        aplicar(sobre(org, origen="correo", fecha="2026-11-01"))
        aplicar(sobre(org, origen="csv", fecha="2026-11-06"))
        assert not HallazgoCobro.objects.filter(organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO).exists()

    def test_un_cobro_de_otra_suscripcion_no_es_su_par(self, org, netflix):
        otra = suscripcion(org, None, nombre="Spotify")
        Cobro.objects.create(organizacion_id=org, suscripcion=otra, monto=Decimal("9990"), fecha=date(2026, 11, 5))
        aplicar(sobre(org, origen="csv"))
        assert not HallazgoCobro.objects.filter(organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO).exists()


def conciliar(org, hallazgo):
    from rest_framework.test import APIClient

    return APIClient().post(f"/api/hallazgos/{hallazgo.pk}/conciliar/", HTTP_X_ORGANIZACION_ID=str(org))


def revisar(org, hallazgo):
    from rest_framework.test import APIClient

    return APIClient().post(f"/api/hallazgos/{hallazgo.pk}/revisar/", HTTP_X_ORGANIZACION_ID=str(org))


class TestLaPersonaResuelve:
    """Las dos salidas explícitas, y que cada una quede en los datos."""

    def test_es_el_mismo_cargo_deja_un_cobro_con_los_dos_origenes(self, org, netflix):
        aplicar(sobre(org, origen="correo", identificador="<abc@netflix.com>"))
        aplicar(sobre(org, origen="csv", identificador="csv:huella-1"))
        hallazgo = el_doble_cobro(org)

        respuesta = conciliar(org, hallazgo)

        assert respuesta.status_code == 200, respuesta.content
        (cobro,) = Cobro.objects.filter(organizacion_id=org)
        # RN-DAT-004: los dos identificadores quedan, colgados del que queda.
        assert {(o.origen, o.identificador_origen) for o in cobro.origenes.all()} == {
            ("correo", "<abc@netflix.com>"), ("csv", "csv:huella-1"),
        }
        hallazgo.refresh_from_db()
        assert hallazgo.estado == HallazgoCobro.Estado.REVISADA
        assert hallazgo.detalle["resolucion"] == MISMO_CARGO
        assert respuesta.json()["detalle"]["resolucion"] == MISMO_CARGO
        # Lo que se borró queda escrito en la decisión.
        assert [o["origen"] for o in hallazgo.detalle["cobro_conciliado"]["origenes"]] == ["csv"]

    def test_con_fechas_distintas_queda_el_de_la_fecha_mas_temprana(self, org, netflix):
        """El caso inverso de la revisión: el mismo cargo, asentado otro día."""
        aplicar(sobre(org, origen="csv", fecha="2026-11-03"))
        aplicar(sobre(org, origen="correo", fecha="2026-11-01"))

        assert conciliar(org, el_doble_cobro(org)).status_code == 200

        (cobro,) = Cobro.objects.filter(organizacion_id=org)
        assert cobro.fecha == date(2026, 11, 1)
        assert {o.origen for o in cobro.origenes.all()} == {"correo", "csv"}
        assert el_doble_cobro(org).detalle["cobro_conciliado"]["fecha"] == "2026-11-03"

    def test_son_dos_cargos_deja_los_dos(self, org, netflix):
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv"))

        assert revisar(org, el_doble_cobro(org)).status_code == 200

        assert Cobro.objects.filter(organizacion_id=org).count() == 2
        hallazgo = el_doble_cobro(org)
        assert hallazgo.estado == HallazgoCobro.Estado.REVISADA
        assert "resolucion" not in hallazgo.detalle

    def test_conciliar_dos_veces_no_borra_nada_mas(self, org, netflix):
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv"))
        hallazgo = el_doble_cobro(org)
        assert conciliar(org, hallazgo).status_code == 200
        assert conciliar(org, hallazgo).status_code == 200
        assert Cobro.objects.filter(organizacion_id=org).count() == 1
        assert CandidatoAplicado.objects.filter(organizacion_id=org, cobro__isnull=False).count() == 2

    def test_revisado_como_dos_todavia_se_puede_conciliar(self, org, netflix):
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv"))
        hallazgo = el_doble_cobro(org)
        revisar(org, hallazgo)
        assert conciliar(org, hallazgo).status_code == 200
        assert Cobro.objects.filter(organizacion_id=org).count() == 1

    def test_con_importes_distintos_no_se_concilia(self, org, netflix):
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv", importe="9991.00"))
        respuesta = conciliar(org, el_doble_cobro(org))
        assert respuesta.status_code == 409
        assert respuesta.json()["codigo"] == "importes_distintos"
        assert Cobro.objects.filter(organizacion_id=org).count() == 2

    def test_un_alza_no_se_concilia(self, org, netflix):
        propia = suscripcion(org, netflix)
        for dia in (date(2026, 8, 5), date(2026, 9, 5), date(2026, 10, 5)):
            Cobro.objects.create(organizacion_id=org, suscripcion=propia, monto=Decimal("9990"), fecha=dia)
        aplicar(sobre(org, importe="12990.00"))
        alza = HallazgoCobro.objects.get(organizacion_id=org, tipo=HallazgoCobro.Tipo.ALZA_TARIFA)
        respuesta = conciliar(org, alza)
        assert respuesta.status_code == 409 and respuesta.json()["codigo"] == "no_es_doble_cobro"

    def test_el_hallazgo_de_otra_organizacion_no_se_ve(self, org, netflix):
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv"))
        assert conciliar(uuid.uuid4(), el_doble_cobro(org)).status_code == 404
        assert Cobro.objects.filter(organizacion_id=org).count() == 2

    def test_un_tercer_cobro_cercano_no_pierde_su_aviso(self, org, netflix):
        """El cobro que se borra puede ser también el par de un tercero. Ese
        posible doble cobro tiene que seguir a la vista, ahora con el que queda."""
        aplicar(sobre(org, origen="correo", fecha="2026-11-05"))
        aplicar(sobre(org, origen="csv", fecha="2026-11-05", identificador="csv:1"))
        par = el_doble_cobro(org)
        aplicar(sobre(org, origen="csv", fecha="2026-11-07", identificador="csv:2"))

        assert conciliar(org, par).status_code == 200

        assert Cobro.objects.filter(organizacion_id=org).count() == 2
        pendientes = HallazgoCobro.objects.filter(
            organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO, estado=HallazgoCobro.Estado.PENDIENTE
        )
        assert pendientes.count() == 1
        restante = pendientes.get()
        assert {restante.cobro.fecha, restante.cobro_relacionado.fecha} == {date(2026, 11, 5), date(2026, 11, 7)}

    def test_una_reentrega_despues_de_conciliar_no_trae_el_cobro_de_vuelta(self, org, netflix):
        correo = sobre(org, origen="correo")
        csv = sobre(org, origen="csv")
        aplicar(correo)
        aplicar(csv)
        conciliar_doble_cobro(el_doble_cobro(org))
        assert not aplicar(csv).nueva
        assert Cobro.objects.filter(organizacion_id=org).count() == 1


# ── una suscripción cancelada a la que la siguen cobrando (RF-03) ────────


def cancelada_el(org, proveedor, dia: date):
    from app.models import TransicionEstado

    propia = suscripcion(org, proveedor)
    propia.transicionar(Subscription.EventoEstado.CANCELACION_USUARIO, actor_rol="usuario")
    TransicionEstado.objects.filter(suscripcion=propia).update(
        ocurrido_en=timezone.make_aware(datetime.combine(dia, time(12)))
    )
    propia.refresh_from_db()
    assert propia.estado == Subscription.Estado.CANCELADO
    return propia


class TestCanceladaQueSiguenCobrando:
    def test_un_cobro_posterior_a_la_cancelacion_la_reactiva_con_la_transicion_del_dominio(self, org, netflix):
        propia = cancelada_el(org, netflix, date(2026, 10, 20))
        aplicar(sobre(org, fecha="2026-11-05"))

        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.ACTIVO
        ultima = propia.transiciones_estado.order_by("-ocurrido_en", "-id").first()
        assert (ultima.evento, ultima.estado_anterior, ultima.actor_rol) == (
            "cobro_nuevo_detectado", "cancelado", "sistema",
        )
        # Y avisa, como cualquier transición (el resumen y notifications lo escuchan).
        assert OutboxEvento.objects.filter(
            organizacion_id=org, evento="suscripcion.estado_cambiado",
            datos__evento_estado="cobro_nuevo_detectado",
        ).exists()

    @pytest.mark.parametrize("fecha", ["2026-10-15", "2026-10-20"])
    def test_un_cobro_de_antes_o_del_mismo_dia_es_historia(self, org, netflix, fecha):
        propia = cancelada_el(org, netflix, date(2026, 10, 20))
        aplicar(sobre(org, fecha=fecha))
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.CANCELADO
        assert Cobro.objects.filter(suscripcion=propia).count() == 1

    @pytest.mark.parametrize("tipo", ["aviso_de_cobro", "pago_fallido"])
    def test_sin_plata_no_la_reactiva(self, org, netflix, tipo):
        propia = cancelada_el(org, netflix, date(2026, 10, 20))
        aplicar(sobre(org, tipo=tipo, fecha="2026-11-05"))
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.CANCELADO

    def test_una_reentrega_no_la_vuelve_a_tocar(self, org, netflix):
        propia = cancelada_el(org, netflix, date(2026, 10, 20))
        orden = sobre(org, fecha="2026-11-05")
        aplicar(orden)
        antes = propia.transiciones_estado.count()
        aplicar(orden)
        assert propia.transiciones_estado.count() == antes

    def test_el_segundo_cobro_ya_la_encuentra_activa(self, org, netflix):
        propia = cancelada_el(org, netflix, date(2026, 10, 20))
        aplicar(sobre(org, origen="correo", fecha="2026-11-05"))
        antes = propia.transiciones_estado.count()
        aplicar(sobre(org, origen="csv", fecha="2026-11-05"))
        assert propia.transiciones_estado.count() == antes

    def test_una_activa_no_se_toca(self, org, netflix):
        propia = suscripcion(org, netflix)
        aplicar(sobre(org))
        assert not propia.transiciones_estado.exists()


# ── una suscripción por confirmar que se vuelve a pagar (RF-03) ──────────


def por_confirmar_el(org, proveedor, dia: date):
    from app.models import TransicionEstado

    propia = suscripcion(org, proveedor)
    propia.transicionar(Subscription.EventoEstado.FALLO_COBRO, actor_rol="sistema")
    TransicionEstado.objects.filter(suscripcion=propia).update(
        ocurrido_en=timezone.make_aware(datetime.combine(dia, time(12)))
    )
    propia.refresh_from_db()
    assert propia.estado == Subscription.Estado.POR_CONFIRMAR
    return propia


class TestPorConfirmarQueSePaga:
    """La segunda revisión de #242: un pago nuevo en una por confirmar la
    dejaba igual, aunque RF-03 tiene `cobro_regularizado` para eso."""

    def test_un_pago_posterior_la_regulariza_con_la_transicion_del_dominio(self, org, netflix):
        propia = por_confirmar_el(org, netflix, date(2026, 11, 1))
        aplicar(sobre(org, fecha="2026-11-05"))

        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.ACTIVO
        ultima = propia.transiciones_estado.order_by("-ocurrido_en", "-id").first()
        assert (ultima.evento, ultima.estado_anterior, ultima.actor_rol) == (
            "cobro_regularizado", "por_confirmar", "sistema",
        )
        assert OutboxEvento.objects.filter(
            organizacion_id=org, evento="suscripcion.estado_cambiado",
            datos__evento_estado="cobro_regularizado",
        ).exists()

    @pytest.mark.parametrize("fecha", ["2026-10-25", "2026-11-01"])
    def test_un_cobro_de_antes_o_del_mismo_dia_es_historia(self, org, netflix, fecha):
        # Del mismo día puede ser justamente el que falló.
        propia = por_confirmar_el(org, netflix, date(2026, 11, 1))
        aplicar(sobre(org, fecha=fecha))
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.POR_CONFIRMAR

    @pytest.mark.parametrize("tipo", ["aviso_de_cobro", "pago_fallido"])
    def test_un_aviso_o_un_fallo_no_la_regularizan(self, org, netflix, tipo):
        propia = por_confirmar_el(org, netflix, date(2026, 11, 1))
        aplicar(sobre(org, tipo=tipo, fecha="2026-11-05"))
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.POR_CONFIRMAR

    @pytest.mark.parametrize("tipo", ["aviso_de_cobro", "pago_fallido"])
    def test_un_fallo_que_dice_crear_cobro_no_pasa_el_contrato(self, org, netflix, tipo):
        """`crear_cobro` viaja decidido, pero el contrato no admite decidir que
        un aviso o un pago fallido son plata que salió: crearía un cobro que no
        existió y regularizaría la suscripción con él."""
        propia = por_confirmar_el(org, netflix, date(2026, 11, 1))
        orden = sobre(org, tipo=tipo, fecha="2026-11-05")
        orden["datos"]["crear_cobro"] = True

        assert candidato_confirmado.errores(orden)
        assert not procesar_candidato(json.dumps(orden).encode()).confirmar
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.POR_CONFIRMAR
        assert not Cobro.objects.filter(organizacion_id=org).exists()

    def test_una_reentrega_no_transiciona_dos_veces(self, org, netflix):
        propia = por_confirmar_el(org, netflix, date(2026, 11, 1))
        orden = sobre(org, fecha="2026-11-05")
        aplicar(orden)
        antes = propia.transiciones_estado.count()
        aplicar(orden)
        assert propia.transiciones_estado.count() == antes

    def test_la_que_nacio_por_confirmar_con_un_fallo_se_regulariza_con_el_pago_siguiente(self, org, netflix):
        aplicar(sobre(org, tipo="pago_fallido", fecha="2026-11-05"))
        propia = Subscription.objects.get(organizacion_id=org)
        Subscription.objects.filter(pk=propia.pk).update(
            creado_en=timezone.make_aware(datetime.combine(date(2026, 11, 5), time(12)))
        )
        aplicar(sobre(org, fecha="2026-11-06"))
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.ACTIVO

    @pytest.mark.parametrize("estado", [Subscription.Estado.PRUEBA, Subscription.Estado.FANTASMA])
    def test_los_demas_estados_no_salen_por_un_cobro(self, org, netflix, estado):
        propia = suscripcion(org, netflix, estado=estado)
        aplicar(sobre(org))
        propia.refresh_from_db()
        assert propia.estado == estado


# ── el importe ───────────────────────────────────────────────────────────


class TestElImporte:
    def test_el_rango_del_contrato_es_el_de_las_columnas(self):
        """Si alguien cambia las columnas o el contrato, esto falla: una orden
        que pasa el contrato tiene que caber donde se guarda."""
        for campo in (Cobro._meta.get_field("monto"), Subscription._meta.get_field("monto")):
            enteros = campo.max_digits - campo.decimal_places
            assert Decimal("9" * enteros + "." + "9" * campo.decimal_places) == candidato_confirmado.IMPORTE_MAXIMO
        patron = candidato_confirmado.esquema()["properties"]["datos"]["properties"]["importe"]["pattern"]
        assert patron == "^[0-9]{1,8}\\.[0-9]{2}$"

    def test_el_maximo_se_guarda_exacto(self, org, netflix):
        aplicar(sobre(org, importe="99999999.99"))
        cobro = Cobro.objects.get(organizacion_id=org)
        cobro.refresh_from_db()
        assert cobro.monto == Decimal("99999999.99")
        assert Subscription.objects.get(organizacion_id=org).monto == Decimal("99999999.99")

    def test_uno_mas_no_pasa_el_contrato(self, org):
        assert not procesar_candidato(json.dumps(sobre(org, importe="100000000.00")).encode()).confirmar


# ── la exportación muestra de dónde vino cada cobro ──────────────────────


def exportar(org, **filtros):
    from rest_framework.test import APIClient

    consulta = "&".join(f"{k}={v}" for k, v in {"desde": "2026-11-01", "hasta": "2026-11-30", **filtros}.items())
    respuesta = APIClient().get(f"/api/export/cobros/?{consulta}", HTTP_X_ORGANIZACION_ID=str(org))
    assert respuesta.status_code == 200, respuesta.content
    filas = respuesta.content.decode("utf-8").strip().splitlines()[1:]
    return [fila.split(",")[5] for fila in filas]


class TestLaExportacion:
    def test_cada_cobro_dice_su_origen_y_el_conciliado_sale_una_vez(self, org, netflix):
        aplicar(sobre(org, origen="correo", fecha="2026-11-05"))
        aplicar(sobre(org, origen="csv", fecha="2026-11-05"))
        conciliar_doble_cobro(el_doble_cobro(org))
        aplicar(sobre(org, origen="csv", fecha="2026-11-20", identificador="csv:otra"))
        propia = Subscription.objects.get(organizacion_id=org)
        Cobro.objects.create(organizacion_id=org, suscripcion=propia, monto=Decimal("10"), fecha=date(2026, 11, 25))

        assert exportar(org) == ["correo+csv", "csv", "manual"]
        assert exportar(org, origen="manual") == ["manual"]
        assert exportar(org, origen="correo") == ["correo+csv"]
        assert exportar(org, origen="csv") == ["correo+csv", "csv"]

    def test_un_origen_desconocido_sigue_siendo_400(self, org):
        from rest_framework.test import APIClient

        respuesta = APIClient().get(
            "/api/export/cobros/?desde=2026-11-01&hasta=2026-11-30&origen=pdf", HTTP_X_ORGANIZACION_ID=str(org)
        )
        assert respuesta.status_code == 400


# ── la respuesta para connectors (candidato.aplicado v1) ─────────────────


def respuestas(org):
    return list(OutboxEvento.objects.filter(organizacion_id=org, evento="candidato.aplicado").order_by("creado_en"))


def como_sobre(fila):
    from events.publicador import crear_payload

    return crear_payload(fila)


class TestLaRespuesta:
    def test_una_orden_aplicada_deja_su_respuesta_correlacionada(self, org, netflix):
        orden = sobre(org)
        aplicacion = aplicar(orden)

        (fila,) = respuestas(org)
        assert candidato_aplicado.errores(como_sobre(fila)) == []
        assert fila.version == 1
        assert str(fila.correlation_id) == orden["correlation_id"]
        assert fila.datos == {
            "candidato_id": orden["datos"]["candidato_id"],
            "orden_id": orden["id"],
            "resultado": "aplicado",
            "motivo": "cobro_creado",
            "suscripcion_id": str(aplicacion.fila.suscripcion_id),
            "cobro_id": str(aplicacion.fila.cobro_id),
        }

    def test_un_aviso_contesta_sin_cobro(self, org, netflix):
        aplicar(sobre(org, tipo="aviso_de_cobro"))
        (fila,) = respuestas(org)
        assert (fila.datos["motivo"], fila.datos["cobro_id"]) == ("sin_cobro", None)
        assert candidato_aplicado.errores(como_sobre(fila)) == []

    def test_una_reentrega_no_contesta_otra_vez(self, org, netflix):
        orden = sobre(org)
        aplicar(orden)
        aplicar(orden)
        assert len(respuestas(org)) == 1

    def test_si_la_respuesta_no_se_puede_escribir_la_orden_tampoco_queda(self, org, netflix, monkeypatch):
        import app.candidatos as modulo

        def revienta(**_kw):
            raise RuntimeError("sin outbox")

        monkeypatch.setattr(modulo, "registrar_resultado", revienta)
        with pytest.raises(RuntimeError):
            aplicar(sobre(org))
        assert not Cobro.objects.filter(organizacion_id=org).exists()
        assert not CandidatoAplicado.objects.filter(organizacion_id=org).exists()

    def test_una_orden_que_no_se_puede_aplicar_contesta_fallido(self, org, netflix):
        orden = sobre(org, moneda="XXX")
        assert not procesar_candidato(json.dumps(orden).encode()).confirmar

        (fila,) = respuestas(org)
        assert candidato_aplicado.errores(como_sobre(fila)) == []
        assert (fila.datos["resultado"], fila.datos["motivo"]) == ("fallido", "no_aplicable")
        assert fila.datos["candidato_id"] == orden["datos"]["candidato_id"]
        assert str(fila.correlation_id) == orden["correlation_id"]

    def test_un_sobre_fuera_de_contrato_contesta_fallido_si_se_sabe_a_quien(self, org, netflix):
        orden = sobre(org)
        orden["datos"]["importe"] = 9990
        assert not procesar_candidato(json.dumps(orden).encode()).confirmar
        (fila,) = respuestas(org)
        assert fila.datos["motivo"] == "contrato_invalido"

    def test_sin_a_quien_contestar_no_contesta(self, org):
        orden = sobre(org)
        orden["datos"].pop("candidato_id")
        assert not procesar_candidato(json.dumps(orden).encode()).confirmar
        assert respuestas(org) == []

    def test_volver_a_fallar_no_contesta_dos_veces(self, org, netflix):
        cuerpo = json.dumps(sobre(org, moneda="XXX")).encode()
        procesar_candidato(cuerpo)
        procesar_candidato(cuerpo)
        assert len(respuestas(org)) == 1

    def test_una_organizacion_eliminada_no_recibe_respuesta(self, org, netflix):
        EstadoOrganizacion.objects.create(organizacion_id=org, eliminada=True)
        procesar_candidato(json.dumps(sobre(org)).encode())
        assert respuestas(org) == []

    def test_si_contestar_falla_la_orden_va_a_fallos_igual(self, org, netflix, monkeypatch):
        import app.candidatos as modulo

        def revienta(*_a, **_kw):
            raise RuntimeError("sin outbox")

        monkeypatch.setattr(modulo, "registrar_fallo", revienta)
        assert not procesar_candidato(json.dumps(sobre(org, moneda="XXX")).encode()).confirmar

    def test_el_despacho_la_saca_por_el_exchange_de_ordenes(self, org, netflix, monkeypatch, settings):
        import events.despacho as despacho

        publicadas, otras = [], []
        monkeypatch.setattr(despacho, "publicar_resultado", lambda e: publicadas.append(e.evento))
        monkeypatch.setattr(despacho, "publicar", lambda e: otras.append(e.evento))
        aplicar(sobre(org))
        despacho.despachar_pendientes()
        assert publicadas == ["candidato.aplicado"]
        assert "candidato.aplicado" not in otras


# ── idempotencia ─────────────────────────────────────────────────────────


class TestReentregas:
    def test_el_mismo_sobre_dos_veces_no_repite_nada(self, org, netflix):
        orden = sobre(org)
        primera = aplicar(orden)
        segunda = aplicar(orden)
        assert primera.nueva and not segunda.nueva
        assert segunda.fila == primera.fila
        assert Cobro.objects.filter(organizacion_id=org).count() == 1
        assert Subscription.objects.filter(organizacion_id=org).count() == 1
        assert CandidatoAplicado.objects.filter(organizacion_id=org).count() == 1

    def test_el_mismo_candidato_con_otro_sobre_tampoco(self, org, netflix):
        # El outbox de connectors publica al menos una vez.
        candidato = uuid.uuid4()
        aplicar(sobre(org, candidato=candidato))
        assert not aplicar(sobre(org, candidato=candidato)).nueva
        assert Cobro.objects.filter(organizacion_id=org).count() == 1

    def test_el_mismo_hecho_desde_otro_candidato_tampoco(self, org, netflix):
        # Dos importaciones de la misma cartola: mismo identificador de origen.
        aplicar(sobre(org, origen="csv", identificador="csv:igual"))
        assert not aplicar(sobre(org, origen="csv", identificador="csv:igual")).nueva
        assert Cobro.objects.filter(organizacion_id=org).count() == 1

    def test_el_mismo_identificador_en_otra_organizacion_es_otro_hecho(self, org, netflix):
        aplicar(sobre(org, origen="csv", identificador="csv:igual"))
        otra = uuid.uuid4()
        assert aplicar(sobre(otra, origen="csv", identificador="csv:igual")).nueva
        assert Cobro.objects.filter(organizacion_id=otra).count() == 1


class TestOrganizacionEliminada:
    def test_borrar_la_organizacion_borra_sus_ordenes_y_no_las_ajenas(self, org, netflix, monkeypatch):
        from rest_framework.test import APIClient

        from shared.eliminacion import cabeceras_eliminacion

        monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
        otra = uuid.uuid4()
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv"))
        aplicar(sobre(otra))
        operacion = uuid.uuid4()
        cabeceras = cabeceras_eliminacion("subscriptions", org, operacion)
        respuesta = APIClient().delete(
            f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
            **{f"HTTP_{k.upper().replace('-', '_')}": v for k, v in cabeceras.items()},
        )
        assert respuesta.status_code == 204
        # Los identificadores de origen son datos de la persona: se van con ella.
        assert not CandidatoAplicado.objects.filter(organizacion_id=org).exists()
        assert CandidatoAplicado.objects.filter(organizacion_id=otra).count() == 1

    def test_no_escribe_nada(self, org, netflix):
        EstadoOrganizacion.objects.create(organizacion_id=org, eliminada=True)
        with pytest.raises(OrganizacionEliminada):
            aplicar(sobre(org))
        assert not Subscription.objects.filter(organizacion_id=org).exists()
        assert not CandidatoAplicado.objects.filter(organizacion_id=org).exists()

    def test_tampoco_con_una_suscripcion_que_ya_existia(self, org, netflix):
        # Sin crear suscripción no pasa por el resumen, que también mira la
        # marca: lo único que frena el cobro es la guarda de `aplicar`.
        suscripcion(org, netflix)
        EstadoOrganizacion.objects.create(organizacion_id=org, eliminada=True)
        with pytest.raises(OrganizacionEliminada):
            aplicar(sobre(org))
        assert not Cobro.objects.filter(organizacion_id=org).exists()
        assert not CandidatoAplicado.objects.filter(organizacion_id=org).exists()

    def test_el_consumidor_la_confirma_como_obsoleta(self, org, netflix):
        EstadoOrganizacion.objects.create(organizacion_id=org, eliminada=True)
        desenlace = procesar_candidato(json.dumps(sobre(org)).encode())
        assert desenlace.confirmar and desenlace.motivo == "organizacion_eliminada"


# ── el consumidor ────────────────────────────────────────────────────────


class CanalQueMiraLaBase:
    """Al confirmar, comprueba que la orden YA esté aplicada en la base."""

    def __init__(self, org):
        self.org = org
        self.acks = 0
        self.rechazos = []
        self.aplicada_al_confirmar = None

    def basic_ack(self, *, delivery_tag):
        self.acks += 1
        self.aplicada_al_confirmar = CandidatoAplicado.objects.filter(organizacion_id=self.org).exists()

    def basic_reject(self, *, delivery_tag, requeue):
        self.rechazos.append(requeue)


class _Metodo:
    delivery_tag = 1


class TestElConsumidor:
    @pytest.fixture(autouse=True)
    def _conexion_de_la_prueba(self, monkeypatch):
        # `atender` suelta las conexiones viejas antes de cada mensaje; en una
        # prueba eso cerraría la transacción que la envuelve.
        monkeypatch.setattr(consumir_eventos, "close_old_connections", lambda: None)

    def test_confirma_despues_de_aplicar(self, org, netflix):
        canal = CanalQueMiraLaBase(org)
        desenlace = Command().atender(
            canal, _Metodo(), json.dumps(sobre(org)).encode(), procesador=procesar_candidato,
            cola_fallidos=candidato_confirmado.COLA_FALLIDOS,
        )
        assert desenlace.confirmar and desenlace.motivo == "cobro_creado"
        assert canal.acks == 1 and canal.aplicada_al_confirmar

    def test_una_reentrega_se_confirma_como_ya_aplicada(self, org, netflix):
        cuerpo = json.dumps(sobre(org)).encode()
        procesar_candidato(cuerpo)
        desenlace = procesar_candidato(cuerpo)
        assert desenlace.confirmar and desenlace.motivo == "ya_aplicada"

    @pytest.mark.parametrize(
        "romper",
        [
            lambda s: s.pop("organizacion_id"),
            lambda s: s.update(version=2),
            lambda s: s.update(evento="suscripcion.creada"),
            lambda s: s["datos"].update(importe=9990),            # número, no texto
            lambda s: s["datos"].update(importe="9990"),          # sin los dos decimales
            lambda s: s["datos"].update(origen="sms"),
            lambda s: s["datos"].update(moneda="$"),
            lambda s: s["datos"].update(fecha="5/11/2026"),
            lambda s: s["datos"].pop("crear_cobro"),
            lambda s: s["datos"].update(servicio=""),
            lambda s: s["datos"].update(campo_nuevo=1),
        ],
    )
    def test_un_sobre_fuera_de_contrato_va_a_fallos_sin_tocar_la_base(self, org, netflix, romper):
        orden = sobre(org)
        romper(orden)
        canal = CanalQueMiraLaBase(org)
        desenlace = Command().atender(
            canal, _Metodo(), json.dumps(orden).encode(), procesador=procesar_candidato,
            cola_fallidos=candidato_confirmado.COLA_FALLIDOS,
        )
        assert not desenlace.confirmar
        assert canal.rechazos == [False]  # sin reencolar: la DLX lo guarda
        assert not CandidatoAplicado.objects.exists()

    def test_no_es_json(self):
        assert not procesar_candidato(b"{no").confirmar

    def test_una_moneda_fuera_del_catalogo_va_a_fallos(self, org, netflix):
        desenlace = procesar_candidato(json.dumps(sobre(org, moneda="XXX")).encode())
        assert not desenlace.confirmar
        assert not Subscription.objects.filter(organizacion_id=org).exists()

    def test_la_base_caida_se_reintenta_y_despues_aplica(self, org, netflix, monkeypatch):
        from django.db.utils import OperationalError

        import app.candidatos as modulo

        real = modulo.aplicar
        llamadas = []

        def falla_una_vez(s):
            llamadas.append(1)
            if len(llamadas) == 1:
                raise OperationalError("se cayó")
            return real(s)

        monkeypatch.setattr(modulo, "aplicar", falla_una_vez)
        desenlace = procesar_candidato(json.dumps(sobre(org)).encode(), dormir=lambda _s: None)
        assert desenlace.confirmar and len(llamadas) == 2


class TestTopologia:
    def test_la_cola_escucha_la_clave_exacta_y_tiene_cola_de_fallos(self):
        llamadas = []

        class Canal:
            def exchange_declare(self, **kw):
                llamadas.append(("exchange", kw))

            def queue_declare(self, **kw):
                llamadas.append(("cola", kw))

            def queue_bind(self, **kw):
                llamadas.append(("enlace", kw))

        candidato_confirmado.declarar(Canal())
        enlaces = [kw for tipo, kw in llamadas if tipo == "enlace" and kw["queue"] == candidato_confirmado.COLA]
        assert enlaces == [{
            "exchange": "connectors.eventos", "queue": "subscriptions.candidatos",
            "routing_key": "candidato.confirmado.v1",
        }]
        (cola,) = [kw for tipo, kw in llamadas if tipo == "cola" and kw["queue"] == candidato_confirmado.COLA]
        assert cola["durable"] and cola["arguments"] == {"x-dead-letter-exchange": "connectors.eventos.fallidos"}

    def test_la_respuesta_va_a_la_cola_de_connectors_con_su_cola_de_fallos(self):
        llamadas = []

        class Canal:
            def exchange_declare(self, **kw):
                llamadas.append(("exchange", kw))

            def queue_declare(self, **kw):
                llamadas.append(("cola", kw))

            def queue_bind(self, **kw):
                llamadas.append(("enlace", kw))

        candidato_aplicado.declarar(Canal())
        enlaces = [kw for tipo, kw in llamadas if tipo == "enlace" and kw["queue"] == candidato_aplicado.COLA]
        assert enlaces == [{
            "exchange": "suscripciones.ordenes", "queue": "connectors.candidatos.resultados",
            "routing_key": "candidato.aplicado.v1",
        }]
        (cola,) = [kw for tipo, kw in llamadas if tipo == "cola" and kw["queue"] == candidato_aplicado.COLA]
        assert cola["arguments"] == {"x-dead-letter-exchange": "suscripciones.ordenes.fallidos"}
