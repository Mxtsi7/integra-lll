"""S3-FE-18 y S3-FE-20 — la lectura programada de las cuentas de correo.

Criterios:
- FE-18: simular un fallo transitorio conserva el cursor y permite retomar;
  el agotamiento y el error permanente quedan observables.
- FE-20: desconectar durante una lectura evita resultados posteriores; las
  tareas programadas dejan de leer la cuenta.

Se usan `lectura_programada`, `avance_lectura`, `renovacion` y
`candidatos_correo` REALES. Solo el lector se reemplaza por uno que entrega
páginas programadas: el proveedor ya está probado en sus documentos (23, 24).
Los correos son recibos que de verdad producen un candidato (los mismos de
las pruebas de S3-FE-09).
"""

import uuid
from datetime import datetime, timedelta, timezone as tz

import pytest
from celery.exceptions import Retry
from django.utils import timezone
from rest_framework.test import APIClient

from connectors import lectura_programada, proveedores, tasks
from connectors.lectura_correo import (
    ErrorDelProveedor,
    ErrorTransitorio,
    MensajeCorreo,
    PaginaDeMensajes,
)
from connectors.lectura_programada import (
    ENFRIAMIENTO,
    ESPERA_MAXIMA,
    ESPERAS,
    PAGINAS_POR_TAREA,
    cancelar_lectura,
    cuentas_para_leer,
    espera_para,
    leer_cuenta,
)
from connectors.models import AvanceDeLectura, CobroCandidato, CuentaConectada, Importacion

pytestmark = pytest.mark.django_db

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTRA = uuid.UUID("22222222-2222-2222-2222-222222222222")
AHORA = datetime(2026, 11, 23, 12, 0, tzinfo=tz.utc)
RECIBIDO = datetime(2026, 10, 2, 13, 30, tzinfo=tz.utc)
RECIBO = "Hola, gracias por tu pago.\nFecha de cobro: 1 de octubre de 2026\nTotal: CLP 9.990\n"


@pytest.fixture(autouse=True)
def _claves(claves):
    """Las cuentas guardan su token cifrado (FE-06)."""


def cuenta(*, org=ORG, proveedor="gmail", correo="p@gmail.com", estado="conectada"):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=correo, estado=estado,
        access_token="ya29.token", refresh_token="1//refresco",
        token_expira_en=timezone.now() + timedelta(minutes=50),
    )


def recibo(c, n):
    return MensajeCorreo(
        cuenta_id=c.pk, id_mensaje=f"m{n}", id_hilo="", recibido_en=RECIBIDO,
        remitente="Netflix <info@account.netflix.com>", asunto="Tu recibo de Netflix", texto=RECIBO,
        proveedor_correo=c.proveedor, message_id=f"m{n}@correo.example.test",
    )


def pagina(c, *numeros, siguiente=None):
    return PaginaDeMensajes(tuple(recibo(c, n) for n in numeros), siguiente)


class LectorFalso:
    """Entrega una respuesta por llamada, en orden. Una respuesta puede ser
    una excepción, o una función que se llama mientras la petición está «en
    vuelo» (para desconectar la cuenta a mitad de la lectura)."""

    PROVEEDOR = "gmail"

    def __init__(self, *respuestas):
        self.respuestas = list(respuestas)
        self.llamadas = []

    def leer_mensajes(self, *, organizacion_id, cuenta_id, filtro=None, pagina=None, limite=25):
        self.llamadas.append(pagina)
        respuesta = self.respuestas.pop(0) if len(self.respuestas) > 1 else self.respuestas[0]
        if callable(respuesta):
            respuesta = respuesta()
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta


@pytest.fixture
def lector(monkeypatch):
    def instalar(*respuestas, proveedor="gmail"):
        falso = LectorFalso(*respuestas)
        falso.PROVEEDOR = proveedor
        monkeypatch.setitem(lectura_programada.LECTORES, proveedor, falso)
        return falso
    return instalar


def avance(c):
    return AvanceDeLectura.objects.get(cuenta=c)


# ══════════════════════════════════════════════════════════════════════
# S3-FE-20 — una cuenta desconectada no se lee ni se guarda
# ══════════════════════════════════════════════════════════════════════


class TestDesconectada:
    def test_una_tarea_encolada_antes_de_desconectar_no_lee(self, lector):
        c = cuenta(estado="desconectada")
        falso = lector(pagina(c, 1))
        assert leer_cuenta(c.pk, ahora=AHORA) == {"omitida": "no_conectada"}
        assert falso.llamadas == []
        assert not CobroCandidato.objects.exists()

    def test_desconectar_durante_la_lectura_no_deja_resultados(self, lector):
        """La página llega DESPUÉS de que el usuario desconectó: no se guarda
        ni un candidato y el cursor no se mueve."""
        c = cuenta()

        def desconecta_y_entrega():
            CuentaConectada.objects.filter(pk=c.pk).update(estado=CuentaConectada.Estado.DESCONECTADA)
            return pagina(c, 1, 2, siguiente="tok-2")

        lector(desconecta_y_entrega)
        resultado = leer_cuenta(c.pk, ahora=AHORA)

        assert resultado["omitida"] == "cuenta_desconectada"
        assert not CobroCandidato.objects.exists()
        assert not Importacion.objects.exists()
        assert avance(c).pagina == ""

    def test_lo_guardado_antes_de_desconectar_se_conserva(self, lector):
        c = cuenta()

        def desconecta_y_entrega():
            CuentaConectada.objects.filter(pk=c.pk).update(estado=CuentaConectada.Estado.DESCONECTADA)
            return pagina(c, 2)

        lector(pagina(c, 1, siguiente="tok-2"), desconecta_y_entrega)
        leer_cuenta(c.pk, ahora=AHORA)
        assert list(CobroCandidato.objects.values_list("evidencia__message_id", flat=True)) == ["m1@correo.example.test"]
        assert avance(c).pagina == "tok-2"

    @pytest.mark.parametrize("estado", ["desconectada", "requiere_reautorizacion", "error"])
    def test_las_tareas_programadas_dejan_de_leer_la_cuenta(self, estado):
        leida = cuenta(correo="si@gmail.com")
        cuenta(correo="no@gmail.com", estado=estado)
        assert cuentas_para_leer(AHORA) == [leida.pk]

    def test_programa_gmail_y_outlook_y_no_csv(self):
        gmail = cuenta()
        outlook = cuenta(proveedor="outlook", correo="p@outlook.com")
        cuenta(proveedor="csv", correo="cartola")
        assert sorted(cuentas_para_leer(AHORA)) == sorted([gmail.pk, outlook.pk])

    def test_cancelar_descarta_la_corrida_y_cierra_su_importacion(self, lector):
        c = cuenta()
        lector(pagina(c, 1, siguiente="tok-2"))
        leer_cuenta(c.pk, ahora=AHORA)
        abierta = Importacion.objects.create(organizacion_id=ORG, usuario_id="x", origen="correo", cuenta=c,
                                             estado=Importacion.Estado.PROCESANDO)
        otra = cuenta(correo="otra@gmail.com")
        ajena = Importacion.objects.create(organizacion_id=ORG, usuario_id="x", origen="correo", cuenta=otra,
                                           estado=Importacion.Estado.PROCESANDO)

        cancelar_lectura(c)

        a = avance(c)
        assert (a.corrida_hasta, a.pagina) == (None, "")
        abierta.refresh_from_db()
        assert abierta.estado == Importacion.Estado.FALLIDA
        assert abierta.errores[0]["codigo"] == "cuenta_desconectada"
        ajena.refresh_from_db()
        assert ajena.estado == Importacion.Estado.PROCESANDO

    def test_desconectar_desde_la_api_cancela_la_lectura(self, lector, monkeypatch):
        c = cuenta()
        lector(pagina(c, 1, siguiente="tok-2"))
        leer_cuenta(c.pk, ahora=AHORA)
        monkeypatch.setattr(proveedores, "revocar", lambda *a, **k: True)

        respuesta = APIClient().delete(f"/api/conectores/{c.pk}/", headers={"X-Organizacion-Id": str(ORG)})

        assert respuesta.status_code == 200
        assert avance(c).corrida_hasta is None


# ══════════════════════════════════════════════════════════════════════
# S3-FE-18 — reintentos con espera y con tope
# ══════════════════════════════════════════════════════════════════════


class TestTransitorio:
    def test_un_fallo_transitorio_conserva_el_cursor_y_se_retoma_sin_perder(self, lector):
        c = cuenta()
        falso = lector(pagina(c, 1, siguiente="tok-2"), ErrorTransitorio("Gmail falló (503).", codigo="falla_del_proveedor"),
                       pagina(c, 2))

        primero = leer_cuenta(c.pk, ahora=AHORA)
        assert primero["reintentar_en"] == ESPERAS[0]
        a = avance(c)
        assert (a.pagina, a.estado_lectura, a.fallos_seguidos, a.ultimo_error) == (
            "tok-2", "reintentando", 1, "falla_del_proveedor")

        segundo = leer_cuenta(c.pk, intento=1, ahora=AHORA)
        assert "reintentar_en" not in segundo
        a = avance(c)
        assert (a.estado_lectura, a.fallos_seguidos, a.leido_hasta) == ("al_dia", 0, AHORA)
        assert falso.llamadas == [None, "tok-2", "tok-2"]
        assert CobroCandidato.objects.count() == 2

    def test_las_esperas_crecen(self):
        error = ErrorTransitorio("x")
        assert [espera_para(i, error) for i in range(len(ESPERAS))] == list(ESPERAS)
        assert espera_para(len(ESPERAS), error) is None

    @pytest.mark.parametrize("pedida, esperada", [(120, 120), (10, ESPERAS[0]), (99999, ESPERA_MAXIMA)])
    def test_retry_after_se_respeta_con_tope(self, pedida, esperada):
        assert espera_para(0, ErrorTransitorio("429", reintentar_en=pedida)) == esperada

    def test_agotar_los_reintentos_queda_observable(self, lector, caplog):
        c = cuenta()
        lector(ErrorTransitorio("Gmail falló (503).", codigo="falla_del_proveedor"))
        with caplog.at_level("ERROR"):
            resultado = leer_cuenta(c.pk, intento=len(ESPERAS), ahora=AHORA)
        assert resultado["agotada"] == "falla_del_proveedor"
        assert "reintentar_en" not in resultado
        a = avance(c)
        assert (a.estado_lectura, a.fallos_seguidos, a.ultimo_error_en) == ("agotada", len(ESPERAS) + 1, AHORA)
        assert "agotada" in caplog.text

    def test_una_cuenta_agotada_descansa_antes_de_volver_a_programarse(self, lector):
        c = cuenta()
        lector(ErrorTransitorio("x", codigo="falla_del_proveedor"))
        leer_cuenta(c.pk, intento=len(ESPERAS), ahora=AHORA)
        assert cuentas_para_leer(AHORA + ENFRIAMIENTO - timedelta(minutes=1)) == []
        assert cuentas_para_leer(AHORA + ENFRIAMIENTO + timedelta(minutes=1)) == [c.pk]


class TestPermanente:
    def test_un_error_permanente_no_se_reintenta_y_queda_observable(self, lector, caplog):
        c = cuenta()
        lector(ErrorDelProveedor("La API de Gmail no está habilitada.", codigo="api_deshabilitada"))
        with caplog.at_level("ERROR"):
            resultado = leer_cuenta(c.pk, ahora=AHORA)
        assert resultado["detenida"] == "api_deshabilitada"
        assert "reintentar_en" not in resultado
        a = avance(c)
        assert (a.estado_lectura, a.ultimo_error, a.detenida_en_version) == (
            "detenida", "api_deshabilitada", c.credenciales_version)
        assert "detenida" in caplog.text

    def test_una_cuenta_detenida_no_se_programa_ni_se_lee(self, lector):
        c = cuenta()
        falso = lector(ErrorDelProveedor("x", codigo="api_deshabilitada"))
        leer_cuenta(c.pk, ahora=AHORA)
        assert cuentas_para_leer(AHORA) == []
        assert leer_cuenta(c.pk, ahora=AHORA) == {"omitida": "detenida"}
        assert len(falso.llamadas) == 1

    def test_una_reconexion_la_vuelve_a_leer(self, lector):
        c = cuenta()
        lector(ErrorDelProveedor("x", codigo="api_deshabilitada"), pagina(c, 1))
        leer_cuenta(c.pk, ahora=AHORA)
        CuentaConectada.objects.filter(pk=c.pk).update(credenciales_version=c.credenciales_version + 1)
        assert cuentas_para_leer(AHORA) == [c.pk]
        assert "omitida" not in leer_cuenta(c.pk, ahora=AHORA)
        assert avance(c).estado_lectura == "al_dia"


# ══════════════════════════════════════════════════════════════════════
# La importación de cada ejecución
# ══════════════════════════════════════════════════════════════════════


class TestImportacion:
    def test_una_ejecucion_una_importacion_cerrada(self, lector):
        c = cuenta()
        lector(pagina(c, 1, siguiente="tok-2"), pagina(c, 2))
        resultado = leer_cuenta(c.pk, ahora=AHORA)
        (importacion,) = Importacion.objects.all()
        assert str(importacion.pk) == resultado["importacion"]
        assert (importacion.estado, importacion.usuario_id, importacion.cuenta_id) == (
            "completada", "lectura-programada", c.pk)
        assert set(CobroCandidato.objects.values_list("importacion_id", flat=True)) == {importacion.pk}

    def test_sin_mensajes_no_se_abre_importacion(self, lector):
        c = cuenta()
        lector(pagina(c))
        assert leer_cuenta(c.pk, ahora=AHORA)["importacion"] is None
        assert not Importacion.objects.exists()

    def test_si_falla_a_mitad_lo_guardado_queda_en_una_importacion_cerrada(self, lector):
        c = cuenta()
        lector(pagina(c, 1, siguiente="tok-2"), ErrorTransitorio("x", codigo="sin_conexion"))
        leer_cuenta(c.pk, ahora=AHORA)
        (importacion,) = Importacion.objects.all()
        assert importacion.estado == "completada"
        assert CobroCandidato.objects.count() == 1

    def test_si_el_rescate_la_cierra_entre_paginas_se_abre_otra_y_no_se_pierde_nada(self, lector):
        c = cuenta()

        def el_rescate_la_cierra():
            Importacion.objects.update(estado=Importacion.Estado.FALLIDA)
            return pagina(c, 2)

        lector(pagina(c, 1, siguiente="tok-2"), el_rescate_la_cierra, pagina(c, 2))
        leer_cuenta(c.pk, ahora=AHORA)
        assert CobroCandidato.objects.count() == 2
        assert Importacion.objects.count() == 2
        assert avance(c).leido_hasta == AHORA

    def test_una_tarea_lee_como_mucho_paginas_por_tarea(self, lector):
        c = cuenta()
        falso = lector(pagina(c, siguiente="otra"))
        resultado = leer_cuenta(c.pk, ahora=AHORA)
        assert resultado["paginas"] == PAGINAS_POR_TAREA == len(falso.llamadas)
        assert avance(c).pagina == "otra"


# ══════════════════════════════════════════════════════════════════════
# Las tareas de Celery
# ══════════════════════════════════════════════════════════════════════


class TestTareas:
    def test_la_tarea_reintenta_con_la_espera_calculada(self, lector, monkeypatch):
        c = cuenta()
        lector(ErrorTransitorio("x", codigo="sin_conexion"))
        pedidos = []

        def retry(countdown=None, **_):
            pedidos.append(countdown)
            raise Retry()

        monkeypatch.setattr(tasks.leer_cuenta_de_correo, "retry", retry)
        with pytest.raises(Retry):
            tasks.leer_cuenta_de_correo.run(str(c.pk))
        assert pedidos == [ESPERAS[0]]

    def test_programar_encola_una_por_cuenta(self, monkeypatch):
        a, b = cuenta(correo="a@gmail.com"), cuenta(correo="b@gmail.com")
        cuenta(correo="c@gmail.com", estado="desconectada")
        encoladas = []
        monkeypatch.setattr(tasks.leer_cuenta_de_correo, "delay", encoladas.append)
        assert tasks.programar_lecturas_de_correo() == {"encoladas": 2}
        assert sorted(encoladas) == sorted([str(a.pk), str(b.pk)])
