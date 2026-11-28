"""RF-14: aplicar las órdenes de cobro de connectors, sin duplicar el cargo.

`candidato.confirmado` v1 llega por `subscriptions.candidatos` y lo aplica
`app.candidatos.aplicar`. Lo que se prueba:

  · la orden crea la suscripción o usa la que había, y el cobro si hubo pago;
  · el mismo cargo por correo y por cartola deja UN cobro con los dos orígenes
    (RN-DAT-004), pero un doble cobro de verdad no se tapa;
  · reentregar no repite nada; un sobre fuera de contrato va a fallos;
  · una organización eliminada no recibe escrituras.
"""

from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.candidatos import aplicar, mismo_cobro
from app.management.commands import consumir_eventos
from app.management.commands.consumir_eventos import Command, procesar_candidato
from app.models import (
    CandidatoAplicado, Cobro, HallazgoCobro, OutboxEvento, Proveedor, ResumenOrganizacion,
    Subscription, TrabajoDerivado,
)
from events.trabajo import OrganizacionEliminada
from shared.borrado.models import EstadoOrganizacion
from shared.contratos import candidato_confirmado

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

    def test_no_toca_el_estado_ni_el_proximo_cobro_de_la_que_existia(self, org, netflix):
        propia = suscripcion(org, netflix, estado=Subscription.Estado.POR_CONFIRMAR)
        aplicar(sobre(org))
        propia.refresh_from_db()
        assert propia.estado == Subscription.Estado.POR_CONFIRMAR
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


class TestElMismoCargo:
    def test_correo_y_cartola_del_mismo_cargo_dejan_un_cobro_con_los_dos_origenes(self, org, netflix):
        aplicar(sobre(org, origen="correo", identificador="<abc@netflix.com>", fecha="2026-11-05"))
        segunda = aplicar(sobre(org, origen="csv", identificador="csv:huella-1", fecha="2026-11-07"))

        (cobro,) = Cobro.objects.filter(organizacion_id=org)
        assert segunda.fila.resultado == CandidatoAplicado.Resultado.COBRO_EXISTENTE
        assert segunda.fila.cobro == cobro
        # RN-DAT-004: los dos identificadores quedan, cada uno con su fecha.
        origenes = {(f.origen, f.identificador_origen, f.fecha) for f in cobro.origenes.all()}
        assert origenes == {
            ("correo", "<abc@netflix.com>", date(2026, 11, 5)),
            ("csv", "csv:huella-1", date(2026, 11, 7)),
        }
        # El cobro conserva la fecha del primero que llegó.
        assert cobro.fecha == date(2026, 11, 5)

    def test_en_el_otro_orden_tambien(self, org, netflix):
        aplicar(sobre(org, origen="csv", fecha="2026-11-07"))
        segunda = aplicar(sobre(org, origen="correo", fecha="2026-11-05"))
        assert Cobro.objects.filter(organizacion_id=org).count() == 1
        assert segunda.fila.resultado == CandidatoAplicado.Resultado.COBRO_EXISTENTE

    def test_juntar_no_levanta_un_doble_cobro(self, org, netflix):
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv"))
        assert not HallazgoCobro.objects.filter(
            organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO
        ).exists()

    def test_un_doble_cobro_de_verdad_no_se_tapa(self, org, netflix):
        # Netflix cobró dos veces: la cartola trae dos líneas, el correo una.
        aplicar(sobre(org, origen="correo"))
        aplicar(sobre(org, origen="csv", identificador="csv:linea-1"))
        tercera = aplicar(sobre(org, origen="csv", identificador="csv:linea-2"))

        assert Cobro.objects.filter(organizacion_id=org).count() == 2
        assert tercera.fila.resultado == CandidatoAplicado.Resultado.COBRO_CREADO
        assert HallazgoCobro.objects.filter(
            organizacion_id=org, tipo=HallazgoCobro.Tipo.DOBLE_COBRO
        ).exists()

    def test_dos_lineas_de_la_misma_fuente_son_dos_cobros(self, org, netflix):
        aplicar(sobre(org, origen="csv", identificador="csv:1"))
        aplicar(sobre(org, origen="csv", identificador="csv:2"))
        assert Cobro.objects.filter(organizacion_id=org).count() == 2

    def test_se_junta_con_un_cobro_ingresado_a_mano(self, org, netflix):
        propia = suscripcion(org, netflix)
        a_mano = Cobro.objects.create(
            organizacion_id=org, suscripcion=propia, monto=Decimal("9990"), fecha=date(2026, 11, 6)
        )
        aplicacion = aplicar(sobre(org, origen="csv"))
        assert aplicacion.fila.cobro == a_mano
        assert Cobro.objects.filter(organizacion_id=org).count() == 1

    @pytest.mark.parametrize(
        "cambio",
        [
            {"importe": "9991.00"},           # otro importe
            {"fecha": "2026-11-10"},          # 5 días: ya no es «menos de 5»
            {"fecha": "2026-10-31"},          # 5 días hacia atrás
        ],
    )
    def test_no_se_junta_si_no_es_el_mismo_cargo(self, org, netflix, cambio):
        aplicar(sobre(org, origen="correo", fecha="2026-11-05"))
        aplicar(sobre(org, origen="csv", **cambio))
        assert Cobro.objects.filter(organizacion_id=org).count() == 2

    def test_cuatro_dias_si_se_junta(self, org, netflix):
        aplicar(sobre(org, origen="correo", fecha="2026-11-05"))
        aplicar(sobre(org, origen="csv", fecha="2026-11-09"))
        assert Cobro.objects.filter(organizacion_id=org).count() == 1

    def test_elige_el_mas_cercano(self, org, netflix):
        propia = suscripcion(org, netflix)
        lejos = Cobro.objects.create(organizacion_id=org, suscripcion=propia, monto=Decimal("9990"),
                                     fecha=date(2026, 11, 2))
        cerca = Cobro.objects.create(organizacion_id=org, suscripcion=propia, monto=Decimal("9990"),
                                     fecha=date(2026, 11, 6))
        assert mismo_cobro(propia, origen="csv", importe=Decimal("9990.00"), moneda="CLP",
                           fecha=date(2026, 11, 5)) == cerca
        assert lejos != cerca

    def test_no_se_junta_con_un_cobro_de_otra_suscripcion(self, org, netflix):
        otra = suscripcion(org, None, nombre="Spotify")
        Cobro.objects.create(organizacion_id=org, suscripcion=otra, monto=Decimal("9990"), fecha=date(2026, 11, 5))
        aplicar(sobre(org, origen="csv"))
        assert Cobro.objects.filter(organizacion_id=org).count() == 2


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
