"""S3-FE-22 — invalidar los avisos que dejaron de corresponder.

Criterios:
- cancelar o cambiar la fecha evita enviar la alerta antigua;
- los eventos repetidos no recrean notificaciones obsoletas.

Se usan la proyección (`aplicar`), el generador, la planificación de entregas
y el reclamo REALES: los avisos nacen de una suscripción proyectada, igual
que en producción, y los eventos tienen la forma del catálogo MX-21 v2.
"""

import datetime as dt
import uuid
import zoneinfo

import pytest
from rest_framework.test import APIClient

from notifications import entregas
from notifications.generador import generar
from notifications.invalidacion import revisar
from notifications.models import Alerta, DireccionCorreo, EntregaAlerta, PreferenciaNotificacion, SuscripcionVigilada
from notifications.proyeccion import aplicar

pytestmark = pytest.mark.django_db

ORG = "11111111-1111-1111-1111-111111111111"
SUSC = "33333333-3333-3333-3333-333333333333"
SANTIAGO = zoneinfo.ZoneInfo("America/Santiago")
HOY = dt.datetime(2026, 11, 21, 10, 0, tzinfo=SANTIAGO)
COBRO = "2026-11-23"
OTRO_COBRO = "2026-12-23"


def sobre(evento="suscripcion.actualizada", *, ocurrido, **datos):
    base = {
        "suscripcion_id": SUSC, "proveedor_id": None, "nombre": "Netflix",
        "monto": "9990.00", "moneda": "CLP", "ciclo": "mensual",
        "proximo_cobro": COBRO, "estado": "activo",
    }
    base.update(datos)
    return {
        "evento": evento, "version": 2, "id": str(uuid.uuid4()), "ocurrido_en": ocurrido,
        "correlation_id": str(uuid.uuid4()), "organizacion_id": ORG, "datos": base,
    }


@pytest.fixture(autouse=True)
def remitente(settings):
    settings.DEFAULT_FROM_EMAIL = "no-responder@ejemplo.cl"


@pytest.fixture
def con_aviso():
    """Una suscripción que se cobra pasado mañana, su aviso generado y un
    correo planificado para una persona."""
    PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="42")
    DireccionCorreo.objects.create(organizacion_id=ORG, usuario_id="42", email="ana@ejemplo.cl")
    aplicar(sobre("suscripcion.creada", ocurrido="2026-11-01T12:00:00Z"))
    generar(ahora=HOY)
    (alerta,) = Alerta.objects.filter(tipo=Alerta.Tipo.PROXIMO_COBRO)
    assert alerta.datos["fecha_cobro"] == COBRO
    (entrega,) = EntregaAlerta.objects.filter(alerta=alerta, canal="email")
    assert entrega.estado == EntregaAlerta.Estado.PENDIENTE
    return alerta


def recargar(alerta):
    alerta.refresh_from_db()
    return alerta


def correo_de(alerta):
    return EntregaAlerta.objects.get(alerta=alerta, canal="email")


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — cancelar o cambiar la fecha evita enviar la alerta antigua
# ══════════════════════════════════════════════════════════════════════


class TestCambioYCancelacion:
    def test_cambiar_la_fecha_invalida_el_aviso_y_descarta_su_correo(self, con_aviso):
        assert aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))

        alerta = recargar(con_aviso)
        assert alerta.invalidada_en is not None and alerta.motivo_invalidacion == "cobro_cambiado"
        entrega = correo_de(alerta)
        assert (entrega.estado, entrega.motivo) == ("descartada", "alerta_obsoleta")

    def test_cancelar_invalida_el_aviso(self, con_aviso):
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado"))
        alerta = recargar(con_aviso)
        assert alerta.motivo_invalidacion == "no_vigente"
        assert correo_de(alerta).estado == "descartada"

    def test_el_despacho_no_manda_el_correo_viejo(self, con_aviso, settings, monkeypatch):
        enviados = []
        monkeypatch.setattr(entregas, "atender", lambda entrega_id, **k: enviados.append(entrega_id))
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        entregas.despachar(ahora=HOY + dt.timedelta(hours=1))
        assert enviados == []

    def test_un_correo_planificado_y_obsoleto_despues_se_descarta_al_reclamarlo(self, con_aviso):
        """Si la invalidación llega mientras la entrega se planificaba (o la
        deja en un estado que `revisar` no toca), el reclamo la ataja."""
        entrega = correo_de(con_aviso)
        Alerta.objects.filter(pk=con_aviso.pk).update(invalidada_en=HOY, motivo_invalidacion="cobro_cambiado")
        assert entregas.reclamar(entrega.pk, ahora=HOY + dt.timedelta(hours=1)) == "descartada"
        entrega.refresh_from_db()
        assert (entrega.estado, entrega.motivo) == ("descartada", "alerta_obsoleta")

    def test_un_correo_ya_aceptado_no_se_toca(self, con_aviso):
        EntregaAlerta.objects.filter(alerta=con_aviso).update(estado=EntregaAlerta.Estado.ACEPTADA)
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        assert correo_de(con_aviso).estado == "aceptada"

    def test_la_campana_no_muestra_ni_cuenta_el_aviso_obsoleto(self, con_aviso):
        cliente = APIClient()
        cabeceras = {"X-Organizacion-Id": ORG, "X-Usuario-Id": "42"}
        assert cliente.get("/api/alertas/contador/", headers=cabeceras).data["pendientes"] == 1
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        assert cliente.get("/api/alertas/contador/", headers=cabeceras).data["pendientes"] == 0
        listado = cliente.get("/api/alertas/", headers=cabeceras).data["results"]
        assert listado == []
        assert cliente.get(f"/api/alertas/{con_aviso.pk}/", headers=cabeceras).status_code == 404

    def test_el_aviso_obsoleto_no_se_borra(self, con_aviso):
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        assert Alerta.objects.filter(pk=con_aviso.pk).exists()

    def test_otros_tipos_de_aviso_no_se_invalidan(self, con_aviso):
        alza = Alerta.objects.create(organizacion_id=ORG, tipo=Alerta.Tipo.ALZA_TARIFA, titulo="Subió Netflix",
                                     mensaje="…", suscripcion_id=uuid.UUID(SUSC), evento_id=uuid.uuid4())
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado"))
        assert recargar(alza).invalidada_en is None

    def test_el_aviso_de_otra_suscripcion_no_se_toca(self, con_aviso):
        otra = SuscripcionVigilada.objects.get(suscripcion_id=uuid.UUID(SUSC))
        otra.suscripcion_id = uuid.uuid4()
        Alerta.objects.filter(pk=con_aviso.pk).update(suscripcion_id=otra.suscripcion_id)
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        assert recargar(con_aviso).invalidada_en is None


class TestFinDePrueba:
    def _con_aviso_de_prueba(self):
        PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="42")
        aplicar(sobre("suscripcion.creada", ocurrido="2026-11-01T12:00:00Z", estado="prueba",
                      fin_prueba="2026-11-22"))
        generar(ahora=HOY)
        (alerta,) = Alerta.objects.filter(tipo=Alerta.Tipo.FIN_PRUEBA)
        return alerta

    def test_cambiar_el_fin_de_la_prueba(self):
        alerta = self._con_aviso_de_prueba()
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", estado="prueba", fin_prueba="2026-12-01"))
        assert recargar(alerta).motivo_invalidacion == "prueba_cambiada"

    def test_la_prueba_termina_y_pasa_a_activa(self):
        alerta = self._con_aviso_de_prueba()
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="activo",
                      fin_prueba="2026-11-22"))
        assert recargar(alerta).motivo_invalidacion == "prueba_terminada"


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — eventos repetidos no recrean notificaciones obsoletas
# ══════════════════════════════════════════════════════════════════════


class TestRepetidosYOrden:
    def test_el_generador_no_recrea_el_aviso_viejo_y_crea_el_nuevo(self, con_aviso):
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro="2026-11-24"))
        generar(ahora=HOY)
        generar(ahora=HOY)
        vigentes = Alerta.objects.filter(tipo=Alerta.Tipo.PROXIMO_COBRO, invalidada_en__isnull=True)
        assert [a.datos["fecha_cobro"] for a in vigentes] == ["2026-11-24"]
        assert Alerta.objects.filter(datos__fecha_cobro=COBRO).count() == 1

    def test_un_evento_repetido_no_hace_nada(self, con_aviso):
        cambio = sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO)
        aplicar(cambio)
        invalidada_en = recargar(con_aviso).invalidada_en
        assert aplicar(cambio) is False
        assert recargar(con_aviso).invalidada_en == invalidada_en

    def test_un_evento_viejo_no_invalida(self, con_aviso):
        """Llega después un evento anterior al que creó el aviso: no cambia
        la proyección y no toca los avisos."""
        assert aplicar(sobre(ocurrido="2026-10-01T12:00:00Z", proximo_cobro=OTRO_COBRO)) is False
        assert recargar(con_aviso).invalidada_en is None
        assert correo_de(con_aviso).estado == "pendiente"

    def test_una_cancelacion_repetida_despues_de_generar_no_recrea_nada(self, con_aviso):
        cancelacion = sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado")
        aplicar(cancelacion)
        aplicar(cancelacion)
        generar(ahora=HOY)
        assert Alerta.objects.filter(invalidada_en__isnull=True).count() == 0

    def test_si_la_fecha_vuelve_el_aviso_vuelve_a_valer(self, con_aviso):
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        aplicar(sobre(ocurrido="2026-11-21T15:00:00Z", proximo_cobro=COBRO))
        alerta = recargar(con_aviso)
        assert (alerta.invalidada_en, alerta.motivo_invalidacion) == (None, "")
        entrega = correo_de(alerta)
        assert (entrega.estado, entrega.motivo) == ("pendiente", "")

    def test_cancelada_y_reactivada_no_vuelve_sola(self, con_aviso):
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado"))
        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T15:00:00Z", estado="activo"))
        assert recargar(con_aviso).motivo_invalidacion == "no_vigente"

    def test_reactivar_no_devuelve_un_correo_descartado_por_otra_razon(self, con_aviso):
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        EntregaAlerta.objects.filter(alerta=con_aviso).update(motivo="preferencia_apagada")
        aplicar(sobre(ocurrido="2026-11-21T15:00:00Z", proximo_cobro=COBRO))
        assert correo_de(con_aviso).estado == "descartada"


class TestYaInvalidado:
    def test_un_segundo_cambio_no_pisa_cuando_ni_por_que_quedo_obsoleto(self, con_aviso):
        aplicar(sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro=OTRO_COBRO))
        primera = recargar(con_aviso).invalidada_en

        aplicar(sobre("suscripcion.estado_cambiado", ocurrido="2026-11-21T15:00:00Z", estado="cancelado",
                      proximo_cobro=OTRO_COBRO))

        alerta = recargar(con_aviso)
        assert (alerta.invalidada_en, alerta.motivo_invalidacion) == (primera, "cobro_cambiado")


class TestRevisarSolo:
    def test_sin_cambios_no_toca_nada(self, con_aviso):
        resultado = revisar(SuscripcionVigilada.objects.get(suscripcion_id=uuid.UUID(SUSC)))
        assert resultado == {"invalidadas": 0, "reactivadas": 0, "entregas_descartadas": 0, "entregas_devueltas": 0}


# ══════════════════════════════════════════════════════════════════════
# Revisión de #215 — el generador contra un cambio que llega a mitad
# ══════════════════════════════════════════════════════════════════════


def evento_a_mitad_de_la_corrida(monkeypatch, *eventos, cambia=True):
    """Aplica `eventos` después de que la corrida LEYÓ la proyección y antes
    de que cree el aviso: la intercalación que encontró la revisión. La
    versión con dos conexiones está en `test_carrera_generador_postgres.py`."""
    from notifications import generador

    real = generador.bloquear_organizacion
    pendientes = list(eventos)

    def bloquear(*args, **kwargs):
        while pendientes:
            assert aplicar(pendientes.pop(0)) is cambia
        return real(*args, **kwargs)

    monkeypatch.setattr(generador, "bloquear_organizacion", bloquear)


class TestCarreraConElGenerador:
    @pytest.fixture(autouse=True)
    def suscripcion(self):
        PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="42")
        aplicar(sobre("suscripcion.creada", ocurrido="2026-11-01T12:00:00Z"))

    def test_cancelada_a_mitad_no_nace_el_aviso(self, monkeypatch):
        evento_a_mitad_de_la_corrida(monkeypatch, sobre(
            "suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado"))

        resultado = generar(ahora=HOY)

        assert (len(resultado.creadas), resultado.obsoletas) == (0, 1)
        assert not Alerta.objects.exists()
        # Y la corrida siguiente tampoco: ya no está vigente.
        generar(ahora=HOY)
        assert not Alerta.objects.exists()

    def test_fecha_cambiada_a_mitad_se_avisa_la_nueva_en_la_corrida_siguiente(self, monkeypatch):
        evento_a_mitad_de_la_corrida(monkeypatch, sobre(ocurrido="2026-11-21T14:00:00Z", proximo_cobro="2026-11-22"))

        assert generar(ahora=HOY).obsoletas == 1
        assert not Alerta.objects.exists()

        generar(ahora=HOY)
        (alerta,) = Alerta.objects.all()
        assert alerta.datos["fecha_cobro"] == "2026-11-22" and alerta.invalidada_en is None

    def test_un_evento_viejo_a_mitad_no_posterga(self, monkeypatch):
        """Un evento que `aplicar` ignora no cambia la fila: el aviso nace."""
        evento_a_mitad_de_la_corrida(
            monkeypatch, sobre(ocurrido="2026-11-01T12:00:00Z", proximo_cobro="2026-11-22"), cambia=False)
        resultado = generar(ahora=HOY)
        assert (len(resultado.creadas), resultado.obsoletas) == (1, 0)

    def test_fin_de_prueba_cambiado_a_mitad(self, monkeypatch):
        from notifications.generador import generar_fin_de_prueba

        aplicar(sobre(ocurrido="2026-11-02T12:00:00Z", estado="prueba", fin_prueba="2026-11-22"))
        evento_a_mitad_de_la_corrida(monkeypatch, sobre(
            ocurrido="2026-11-21T14:00:00Z", estado="prueba", fin_prueba="2026-12-01"))

        assert generar_fin_de_prueba(ahora=HOY).obsoletas == 1
        assert not Alerta.objects.filter(tipo=Alerta.Tipo.FIN_PRUEBA).exists()

    def test_generar_suma_las_obsoletas_del_fin_de_prueba(self, monkeypatch):
        """Por `generar()`, que junta los dos generadores: el cobro queda
        fuera de la ventana y solo se intenta el aviso de fin de prueba."""
        aplicar(sobre(ocurrido="2026-11-02T12:00:00Z", estado="prueba", fin_prueba="2026-11-22",
                      proximo_cobro=OTRO_COBRO))
        evento_a_mitad_de_la_corrida(monkeypatch, sobre(
            ocurrido="2026-11-21T14:00:00Z", estado="prueba", fin_prueba="2026-12-01", proximo_cobro=OTRO_COBRO))

        assert generar(ahora=HOY).obsoletas == 1

    def test_el_comando_cuenta_las_postergadas(self, monkeypatch):
        from io import StringIO

        from django.core.management import call_command

        evento_a_mitad_de_la_corrida(monkeypatch, sobre(
            "suscripcion.estado_cambiado", ocurrido="2026-11-21T14:00:00Z", estado="cancelado"))
        salida = StringIO()
        call_command("generar_alertas", ahora="2026-11-21T10:00:00-03:00", stdout=salida)
        assert "1 postergada(s)" in salida.getvalue()
