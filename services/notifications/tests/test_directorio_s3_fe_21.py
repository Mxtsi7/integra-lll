"""S3-FE-21 — de dónde salen las personas y sus correos: auth.

Criterio que faltaba para cerrar la tarjeta: «la fuente de direcciones,
acordada con auth». La revisión de #203 pidió una fuente autoritativa con
auth; es la consulta firmada de `shared/directorio.py`.

Dos partes:
- el CLIENTE HTTP real (`notifications.directorio.destinatarios`), con
  `requests.get` reemplazado por respuestas con la forma EXACTA de la vista
  de auth (copiada de `services/auth/tests/test_directorio_s3_fe_21.py`, que
  prueba la vista real);
- lo que cambia en el envío, con el doble del directorio de `conftest.py`.
"""

import datetime as dt
import uuid

import pytest
import requests
from django.core import mail

from notifications import entregas
from notifications.directorio import DirectorioNoDisponible
from notifications.directorio import destinatarios as destinatarios_reales
from notifications.models import Alerta, EntregaAlerta, PreferenciaNotificacion
from shared import directorio as contrato
from tests.directorio_falso import DIRECTORIO
from tests.test_entregas_s3_fe_21 import ORG, a_las, la_entrega, nueva_alerta, persona

pytestmark = pytest.mark.django_db

SECRETO = "secreto-del-directorio-solo-prueba"
Estado = EntregaAlerta.Estado


# ══════════════════════════════════════════════════════════════════════
# El cliente HTTP
# ══════════════════════════════════════════════════════════════════════


class _Respuesta:
    def __init__(self, status_code, cuerpo):
        self.status_code = status_code
        self._cuerpo = cuerpo

    def json(self):
        if isinstance(self._cuerpo, Exception):
            raise self._cuerpo
        return self._cuerpo


#: Lo que responde la vista de auth (ver su prueba de forma del contrato).
RESPUESTA_DE_AUTH = {"destinatarios": [
    {"usuario_id": "12", "email": "ana@ejemplo.cl"},
    {"usuario_id": "15", "email": "beto@ejemplo.cl"},
]}


@pytest.fixture
def auth(monkeypatch, settings):
    """Un auth falso a nivel de `requests.get`. Guarda cada petición."""
    monkeypatch.setenv(contrato.VARIABLE_SECRETO, SECRETO)
    settings.URL_AUTH = "http://auth:8001"

    class Falso:
        peticiones = []
        respuesta = _Respuesta(200, RESPUESTA_DE_AUTH)

        @classmethod
        def get(cls, url, headers=None, timeout=None, allow_redirects=True):
            cls.peticiones.append({"url": url, "headers": dict(headers or {}), "timeout": timeout,
                                   "allow_redirects": allow_redirects})
            if isinstance(cls.respuesta, Exception):
                raise cls.respuesta
            return cls.respuesta

    Falso.peticiones = []
    monkeypatch.setattr(requests, "get", Falso.get)
    return Falso


class TestCliente:
    def test_entrega_usuario_y_correo(self, auth):
        assert destinatarios_reales(ORG) == {"12": "ana@ejemplo.cl", "15": "beto@ejemplo.cl"}

    def test_pide_la_ruta_interna_firmada_para_esa_organizacion(self, auth):
        destinatarios_reales(ORG)
        (peticion,) = auth.peticiones
        assert peticion["url"] == f"http://auth:8001/internal/organizaciones/{ORG}/destinatarios/"
        # La firma la acepta el MISMO verificador que usa auth.
        contrato.verificar(peticion["headers"], ORG)
        with pytest.raises(contrato.FirmaInvalida):
            contrato.verificar(peticion["headers"], uuid.uuid4())
        assert peticion["allow_redirects"] is False
        assert peticion["timeout"] == (2, 5)

    def test_sin_secreto_no_pregunta(self, auth, monkeypatch):
        monkeypatch.delenv(contrato.VARIABLE_SECRETO)
        with pytest.raises(DirectorioNoDisponible) as error:
            destinatarios_reales(ORG)
        assert error.value.codigo == "sin_secreto"
        assert auth.peticiones == []

    @pytest.mark.parametrize("respuesta, codigo", [
        (_Respuesta(403, {"detail": "Solicitud interna inválida"}), "respuesta_403"),
        (_Respuesta(503, None), "respuesta_503"),
        (requests.Timeout("lento"), "tiempo_agotado"),
        (requests.ConnectionError("rechazada"), "sin_conexion"),
        (_Respuesta(200, ValueError("no es JSON")), "respuesta_invalida"),
        (_Respuesta(200, {"otra": []}), "respuesta_invalida"),
        (_Respuesta(200, {"destinatarios": [{"usuario_id": 12, "email": "ana@ejemplo.cl"}]}), "respuesta_invalida"),
        (_Respuesta(200, {"destinatarios": [{"usuario_id": "12"}]}), "respuesta_invalida"),
    ])
    def test_si_auth_no_entrega_la_lista_no_se_inventa(self, auth, respuesta, codigo):
        auth.respuesta = respuesta
        with pytest.raises(DirectorioNoDisponible) as error:
            destinatarios_reales(ORG)
        assert error.value.codigo == codigo


# ══════════════════════════════════════════════════════════════════════
# Quiénes son las personas
# ══════════════════════════════════════════════════════════════════════


class TestPersonas:
    def test_son_las_que_auth_dice(self):
        DIRECTORIO.con_preferencias_como_miembros = False
        DIRECTORIO.agregar(ORG, "42", "ana@ejemplo.cl")
        DIRECTORIO.agregar(ORG, "43", "beto@ejemplo.cl")
        PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="42", dias_anticipacion=7)
        # Tiene fila pero auth ya no la entrega: dejó la organización.
        PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="99")

        personas = PreferenciaNotificacion.de_la_organizacion(ORG)

        assert [(p.usuario_id, p.dias_anticipacion, p._state.adding) for p in personas] == [
            ("42", 7, False),   # sus preferencias
            ("43", 3, True),    # nunca abrió Ajustes: las de omisión
        ]

    def test_solo_se_planifica_para_quienes_auth_conoce(self):
        DIRECTORIO.con_preferencias_como_miembros = False
        DIRECTORIO.agregar(ORG, "42", "ana@ejemplo.cl")
        PreferenciaNotificacion.objects.create(organizacion_id=ORG, usuario_id="99")
        alerta = nueva_alerta()
        assert sorted(alerta.entregas.values_list("usuario_id", flat=True).distinct()) == ["42"]

    def test_si_auth_no_responde_no_se_genera_a_medias(self):
        """Sin saber quiénes son, no se puede planificar: la alerta y sus
        entregas no nacen, y la próxima corrida lo intenta de nuevo."""
        from notifications.generador import generar
        from tests.test_generador import HOY, vigilada

        vigilada(org=ORG, cobro=HOY.date() + dt.timedelta(days=2))
        DIRECTORIO.caido = True
        with pytest.raises(DirectorioNoDisponible):
            generar(ahora=HOY)
        assert not Alerta.objects.exists()

        DIRECTORIO.caido = False
        generar(ahora=HOY)
        assert Alerta.objects.count() == 1


# ══════════════════════════════════════════════════════════════════════
# A dónde se manda
# ══════════════════════════════════════════════════════════════════════


class TestAlMandar:
    def test_sale_a_la_direccion_vigente(self, mailoutbox):
        """Cambió su correo en auth después de que se planificó: sale al nuevo."""
        persona("42", correo="ana@antiguo.cl")
        nueva_alerta()
        DIRECTORIO.agregar(ORG, "42", "ana@nuevo.cl")

        entregas.despachar(ahora=a_las(10))

        (enviado,) = mailoutbox
        assert enviado.to == ["ana@nuevo.cl"]
        assert la_entrega().destino == "ana@nuevo.cl"

    def test_si_auth_no_responde_espera_sin_gastar_un_intento(self, mailoutbox):
        persona("42")
        nueva_alerta()
        DIRECTORIO.caido = True

        resumen = entregas.despachar(ahora=a_las(10))

        entrega = la_entrega()
        assert resumen[entregas.DIFERIDA] == 1
        assert (entrega.estado, entrega.motivo, entrega.codigo_error, entrega.intentos) == (
            Estado.DIFERIDA, entregas.MOTIVO_DIRECTORIO, "directorio_sin_conexion", 0)
        assert entrega.proximo_intento_en == a_las(10) + entregas.ESPERA_DIRECTORIO
        assert mailoutbox == []

        # Antes de la espera no se vuelve a intentar; después, sí, y sale.
        DIRECTORIO.caido = False
        entregas.despachar(ahora=a_las(10, 4))
        assert la_entrega().estado == Estado.DIFERIDA
        entregas.despachar(ahora=a_las(10, 5))
        assert la_entrega().estado == Estado.ACEPTADA
        assert len(mailoutbox) == 1


# ══════════════════════════════════════════════════════════════════════
# Un aviso vencido no sale
# ══════════════════════════════════════════════════════════════════════


def aviso(tipo, **datos):
    alerta = Alerta.objects.create(
        organizacion_id=ORG, tipo=tipo, titulo="aviso", mensaje="aviso", evento_id=uuid.uuid4(), datos=datos,
    )
    entregas.planificar(alerta, ahora=a_las(9, dia=1))
    return alerta


class TestAvisoVencido:
    @pytest.mark.parametrize("fecha, sale", [
        ("2026-11-22", True),    # mañana
        ("2026-11-21", True),    # hoy: «se cobra hoy» todavía sirve
        ("2026-11-20", False),   # ayer
    ])
    def test_proximo_cobro(self, mailoutbox, fecha, sale):
        persona("42", dias_anticipacion=30)
        aviso(Alerta.Tipo.PROXIMO_COBRO, fecha_cobro=fecha, dias_faltantes=0)

        entregas.despachar(ahora=a_las(10))

        entrega = la_entrega()
        if sale:
            assert entrega.estado == Estado.ACEPTADA
        else:
            assert (entrega.estado, entrega.motivo) == (Estado.DESCARTADA, entregas.MOTIVO_VENCIDO)
            assert mailoutbox == []

    @pytest.mark.parametrize("fecha, sale", [("2026-11-22", True), ("2026-11-21", False)])
    def test_fin_de_prueba(self, mailoutbox, fecha, sale):
        persona("42")
        aviso(Alerta.Tipo.FIN_PRUEBA, fin_prueba=fecha)

        entregas.despachar(ahora=a_las(10))

        assert (la_entrega().estado == Estado.ACEPTADA) is sale

    def test_un_aviso_sin_fecha_no_vence(self, mailoutbox):
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        assert la_entrega().estado == Estado.ACEPTADA

    def test_auth_caido_hasta_que_vence_termina_descartado(self, mailoutbox):
        persona("42", dias_anticipacion=30)
        aviso(Alerta.Tipo.PROXIMO_COBRO, fecha_cobro="2026-11-21", dias_faltantes=0)
        DIRECTORIO.caido = True
        entregas.despachar(ahora=a_las(10))
        assert la_entrega().estado == Estado.DIFERIDA

        entregas.despachar(ahora=a_las(10, dia=22))

        assert (la_entrega().estado, la_entrega().motivo) == (Estado.DESCARTADA, entregas.MOTIVO_VENCIDO)
        assert mailoutbox == []
