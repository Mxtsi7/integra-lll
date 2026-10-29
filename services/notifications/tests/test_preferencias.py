"""
FE-21 — leer y guardar preferencias de notificación (RF-09).

Lo que tiene que quedar demostrado, criterio por criterio:

- un **PATCH inválido no sustituye** preferencias válidas
- al recargar se conservan los toggles **y el alcance del propietario**
- los canales y los tipos se pueden encender y apagar por separado
- no se promete un canal que todavía no está habilitado
"""

import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from notifications.models import Alerta, PreferenciaNotificacion

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
USUARIO_A = "42"
USUARIO_B = "99"

RUTA = "/api/preferencias-alertas/"


@pytest.fixture
def cliente():
    return APIClient()


def cabecera(org=ORG_A, usuario=USUARIO_A):
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


# ── el contrato del modelo con las alertas ───────────────────────────


class TestCoherenciaConLasAlertas:
    def test_hay_una_preferencia_por_cada_tipo_de_alerta(self):
        """Si alguien agrega un `Alerta.Tipo` y no su preferencia, el tipo
        queda sin poder apagarse y nadie se entera. Esto lo avisa."""
        faltan = set(Alerta.Tipo.values) - set(
            PreferenciaNotificacion.CAMPO_POR_TIPO.keys()
        )
        assert not faltan, f"tipos de alerta sin preferencia: {sorted(faltan)}"

    def test_cada_preferencia_apunta_a_un_campo_que_existe(self):
        preferencia = PreferenciaNotificacion()
        for campo in PreferenciaNotificacion.CAMPO_POR_TIPO.values():
            assert hasattr(preferencia, campo), campo
        for campo in PreferenciaNotificacion.CAMPO_POR_CANAL.values():
            assert hasattr(preferencia, campo), campo

    def test_un_tipo_desconocido_no_se_avisa(self):
        """Ante la duda no se manda: es más seguro no avisar que avisar por un
        canal que nadie eligió."""
        preferencia = PreferenciaNotificacion()
        assert preferencia.quiere("tipo.inventado") is False
        assert preferencia.debe_avisar("tipo.inventado", "email") is False

    def test_un_canal_desconocido_no_se_avisa(self):
        preferencia = PreferenciaNotificacion()
        assert preferencia.debe_avisar(Alerta.Tipo.PROXIMO_COBRO, "paloma") is False


# ── valores por omisión ──────────────────────────────────────────────


class TestPorOmision:
    def test_el_primer_GET_crea_la_fila_con_los_valores_documentados(self, cliente):
        """No existe el estado "esta persona no tiene preferencias": existe
        "todavía no las cambió". Por eso el GET crea en vez de dar 404."""
        assert not PreferenciaNotificacion.objects.exists()
        respuesta = cliente.get(RUTA, headers=cabecera())

        assert respuesta.status_code == status.HTTP_200_OK
        assert PreferenciaNotificacion.objects.count() == 1
        assert respuesta.data["por_email"] is True
        assert respuesta.data["en_la_app"] is True
        assert respuesta.data["dias_anticipacion"] == 3

    def test_el_push_viene_apagado(self, cliente):
        """Está apagado a propósito: todavía no hay quién entregue un push."""
        respuesta = cliente.get(RUTA, headers=cabecera())
        assert respuesta.data["por_push"] is False

    def test_todos_los_tipos_vienen_encendidos(self, cliente):
        respuesta = cliente.get(RUTA, headers=cabecera())
        for campo in PreferenciaNotificacion.CAMPO_POR_TIPO.values():
            assert respuesta.data[campo] is True, campo

    def test_un_segundo_GET_no_crea_otra_fila(self, cliente):
        cliente.get(RUTA, headers=cabecera())
        cliente.get(RUTA, headers=cabecera())
        assert PreferenciaNotificacion.objects.count() == 1


# ── el alcance: de quién son las preferencias ────────────────────────


class TestAlcanceDelPropietario:
    """Criterio: al recargar se conservan los toggles Y el alcance."""

    def test_dos_personas_de_la_misma_organizacion_tienen_las_suyas(self, cliente):
        """Al contador le sirven los avisos de presupuesto y al que usa las
        cuentas los de fin de prueba: no puede ser una sola fila."""
        cliente.patch(
            RUTA, {"por_email": False}, format="json",
            headers=cabecera(ORG_A, USUARIO_A),
        )
        respuesta_b = cliente.get(RUTA, headers=cabecera(ORG_A, USUARIO_B))

        assert respuesta_b.data["por_email"] is True, "se mezclaron las dos personas"
        assert PreferenciaNotificacion.objects.count() == 2

    def test_la_misma_persona_en_otra_organizacion_tiene_las_suyas(self, cliente):
        cliente.patch(
            RUTA, {"dias_anticipacion": 10}, format="json",
            headers=cabecera(ORG_A, USUARIO_A),
        )
        respuesta = cliente.get(RUTA, headers=cabecera(ORG_B, USUARIO_A))
        assert respuesta.data["dias_anticipacion"] == 3

    def test_no_se_puede_cambiar_la_organizacion_desde_el_cuerpo(self, cliente):
        """Si se pudiera, cualquiera tocaría las preferencias de otro."""
        cliente.patch(
            RUTA,
            {"organizacion_id": str(ORG_B), "usuario_id": USUARIO_B, "por_email": False},
            format="json",
            headers=cabecera(ORG_A, USUARIO_A),
        )
        fila = PreferenciaNotificacion.objects.get()
        assert fila.organizacion_id == ORG_A
        assert fila.usuario_id == USUARIO_A

    def test_sin_cabecera_de_organizacion_no_se_entrega_nada(self, cliente):
        respuesta = cliente.get(RUTA, headers={"X-Usuario-Id": USUARIO_A})
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not PreferenciaNotificacion.objects.exists()

    def test_sin_cabecera_de_usuario_tampoco(self, cliente):
        """Sin saber quién pregunta no hay preferencias personales que dar.
        Devolver las de la organización mezclaría a dos personas."""
        respuesta = cliente.get(RUTA, headers={"X-Organizacion-Id": str(ORG_A)})
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not PreferenciaNotificacion.objects.exists()


# ── guardar ──────────────────────────────────────────────────────────


class TestGuardar:
    def test_se_conserva_al_recargar(self, cliente):
        """El criterio textual: al recargar se conservan los toggles."""
        cliente.patch(
            RUTA,
            {"por_email": False, "por_push": True, "avisar_doble_cobro": False,
             "dias_anticipacion": 7},
            format="json", headers=cabecera(),
        )
        respuesta = cliente.get(RUTA, headers=cabecera())
        assert respuesta.data["por_email"] is False
        assert respuesta.data["por_push"] is True
        assert respuesta.data["avisar_doble_cobro"] is False
        assert respuesta.data["dias_anticipacion"] == 7

    def test_un_PATCH_parcial_no_pisa_lo_que_no_menciona(self, cliente):
        """Por eso es PATCH y no PUT: un cliente que mande de menos borraría
        sin querer lo que no conoce."""
        cliente.patch(RUTA, {"dias_anticipacion": 9}, format="json", headers=cabecera())
        cliente.patch(RUTA, {"por_push": True}, format="json", headers=cabecera())

        respuesta = cliente.get(RUTA, headers=cabecera())
        assert respuesta.data["dias_anticipacion"] == 9, "el segundo PATCH lo piso"
        assert respuesta.data["por_push"] is True

    def test_los_tipos_se_apagan_por_separado(self, cliente):
        cliente.patch(
            RUTA, {"avisar_alza_tarifa": False}, format="json", headers=cabecera()
        )
        respuesta = cliente.get(RUTA, headers=cabecera())
        assert respuesta.data["avisar_alza_tarifa"] is False
        assert respuesta.data["avisar_proximo_cobro"] is True

    def test_el_PUT_no_esta_permitido(self, cliente):
        """Exigiría el objeto completo y un cliente incompleto borraría cosas."""
        assert cliente.put(
            RUTA, {"por_email": False}, format="json", headers=cabecera()
        ).status_code == status.HTTP_405_METHOD_NOT_ALLOWED


# ── un PATCH inválido no sustituye preferencias válidas ──────────────


class TestPatchInvalido:
    """El criterio difícil de FE-21: lo que ya estaba guardado no se toca."""

    @pytest.fixture
    def guardadas(self, cliente):
        cliente.patch(
            RUTA,
            {"por_email": False, "dias_anticipacion": 7, "avisar_doble_cobro": False},
            format="json", headers=cabecera(),
        )
        return PreferenciaNotificacion.objects.get()

    @pytest.mark.parametrize(
        "cuerpo, porque",
        [
            ({"dias_anticipacion": 0}, "0 días no da margen para cancelar"),
            ({"dias_anticipacion": 31}, "más de un mes deja de ser un aviso"),
            ({"dias_anticipacion": -1}, "negativo"),
            ({"dias_anticipacion": "tres"}, "no es un número"),
            ({"por_email": "quizás"}, "no es un booleano"),
            ({"avisar_proximo_cobro": 7}, "no es un booleano"),
        ],
    )
    def test_un_valor_invalido_se_rechaza_y_no_cambia_nada(
        self, cliente, guardadas, cuerpo, porque
    ):
        respuesta = cliente.patch(RUTA, cuerpo, format="json", headers=cabecera())

        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST, porque
        guardadas.refresh_from_db()
        assert guardadas.por_email is False, porque
        assert guardadas.dias_anticipacion == 7, porque
        assert guardadas.avisar_doble_cobro is False, porque

    def test_un_valor_invalido_junto_a_uno_valido_no_guarda_ninguno(
        self, cliente, guardadas
    ):
        """Todo o nada: si el cuerpo trae una basura, lo bueno tampoco entra.
        Guardar a medias dejaría preferencias que nadie pidió."""
        respuesta = cliente.patch(
            RUTA,
            {"por_push": True, "dias_anticipacion": 99},
            format="json", headers=cabecera(),
        )
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        guardadas.refresh_from_db()
        assert guardadas.por_push is False, "guardo el valido con el invalido al lado"

    def test_una_clave_inventada_se_ignora_sin_romper(self, cliente, guardadas):
        """DRF descarta lo que no está en `fields`. Lo que NO puede pasar es
        que rompa ni que pise lo guardado."""
        respuesta = cliente.patch(
            RUTA, {"avisar_lo_que_sea": True}, format="json", headers=cabecera()
        )
        assert respuesta.status_code == status.HTTP_200_OK
        guardadas.refresh_from_db()
        assert guardadas.dias_anticipacion == 7

    def test_los_limites_validos_si_entran(self, cliente, guardadas):
        """El control: la validación no puede rechazar los extremos buenos."""
        for valor in (1, 30):
            respuesta = cliente.patch(
                RUTA, {"dias_anticipacion": valor}, format="json", headers=cabecera()
            )
            assert respuesta.status_code == status.HTTP_200_OK, valor
            assert respuesta.data["dias_anticipacion"] == valor


# ── no prometer canales que no existen ───────────────────────────────


class TestCanalesDisponibles:
    def test_informa_que_canales_estan_habilitados(self, cliente, settings):
        settings.CANALES_HABILITADOS = ["email", "in_app"]
        respuesta = cliente.get(RUTA, headers=cabecera())
        assert respuesta.data["canales_disponibles"] == ["email", "in_app"]
        assert "push" not in respuesta.data["canales_disponibles"]

    def test_se_puede_pedir_un_canal_que_todavia_no_llega(self, cliente, settings):
        """Guardar la intención y poder cumplirla son cosas distintas: la
        preferencia se guarda y la API dice aparte que todavía no se entrega,
        para que el frontend no prometa lo que no va a llegar."""
        settings.CANALES_HABILITADOS = ["email", "in_app"]
        respuesta = cliente.patch(
            RUTA, {"por_push": True}, format="json", headers=cabecera()
        )
        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["por_push"] is True
        assert "push" in respuesta.data["canales_elegidos"]
        assert "push" not in respuesta.data["canales_disponibles"]

    def test_cuando_el_push_se_habilite_nadie_vuelve_a_elegirlo(
        self, cliente, settings
    ):
        settings.CANALES_HABILITADOS = ["email", "in_app"]
        cliente.patch(RUTA, {"por_push": True}, format="json", headers=cabecera())

        settings.CANALES_HABILITADOS = ["email", "in_app", "push"]
        respuesta = cliente.get(RUTA, headers=cabecera())
        assert respuesta.data["por_push"] is True
        assert "push" in respuesta.data["canales_disponibles"]

    def test_canales_elegidos_refleja_lo_apagado(self, cliente):
        cliente.patch(RUTA, {"por_email": False}, format="json", headers=cabecera())
        respuesta = cliente.get(RUTA, headers=cabecera())
        assert "email" not in respuesta.data["canales_elegidos"]
        assert "in_app" in respuesta.data["canales_elegidos"]


# ── lo que va a consumir FE-17/FE-18 ─────────────────────────────────


class TestDebeAvisar:
    """`debe_avisar` es la pregunta que harán los generadores de alertas."""

    def test_exige_el_tipo_Y_el_canal_encendidos(self, cliente):
        preferencia = PreferenciaNotificacion.objects.create(
            organizacion_id=ORG_A, usuario_id=USUARIO_A,
            por_email=True, avisar_proximo_cobro=True,
        )
        assert preferencia.debe_avisar(Alerta.Tipo.PROXIMO_COBRO, "email") is True

        preferencia.avisar_proximo_cobro = False
        assert preferencia.debe_avisar(Alerta.Tipo.PROXIMO_COBRO, "email") is False

        preferencia.avisar_proximo_cobro = True
        preferencia.por_email = False
        assert preferencia.debe_avisar(Alerta.Tipo.PROXIMO_COBRO, "email") is False

    def test_un_tipo_apagado_no_se_avisa_por_ningun_canal(self, cliente):
        preferencia = PreferenciaNotificacion.objects.create(
            organizacion_id=ORG_A, usuario_id=USUARIO_A, avisar_doble_cobro=False,
        )
        for canal in PreferenciaNotificacion.CAMPO_POR_CANAL:
            assert preferencia.debe_avisar(Alerta.Tipo.DOBLE_COBRO, canal) is False
