import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import time
from unittest.mock import patch
from uuid import uuid4
import pytest
from django.db import DatabaseError, close_old_connections
from django.utils import timezone
from analytics.models import CupoIngesta, DocumentoIngesta
from analytics.politica_ia import PoliticaIA, CuotaAgotada, reservar, purgar_cuotas_organizacion

pytestmark = pytest.mark.django_db(transaction=True)
DATOS = {"ahorro": None, "gastos_por_moneda": {"CLP": "9990.00", "USD": "5.00"}}


def test_timeout_cancela_y_conserva_datos_sin_bloquear_otras_funciones():
    async def escenario():
        politica = PoliticaIA(timeout=.02, simultaneas=1)
        comenzo, cancelado = asyncio.Event(), asyncio.Event()
        async def lento(timeout):
            comenzo.set()
            try:
                await asyncio.sleep(10)
            finally:
                cancelado.set()
        llamada = asyncio.create_task(politica.ejecutar(lento, DATOS))
        await comenzo.wait()
        async def rapido(timeout):
            return {"valor": "real"}
        assert (await politica.ejecutar(rapido, DATOS))["motivo"] == "capacidad"
        inicio = time.monotonic()
        resultado = await llamada
        assert time.monotonic() - inicio < 1 and cancelado.is_set()
        assert resultado == {"estado": "degradado", "motivo": "timeout", "datos": DATOS}
        assert (await politica.ejecutar(rapido, DATOS))["estado"] == "ok"
    asyncio.run(escenario())


def test_cuota_y_duplicado_evitan_la_llamada_externa_y_no_mezclan_tenants():
    org, otra, doc = uuid4(), uuid4(), uuid4()
    llamadas = []
    async def proveedor(timeout):
        llamadas.append(timeout)
        return {"analisis": "solo datos del caso"}
    async def escenario():
        politica = PoliticaIA(max_documentos=1)
        assert (await politica.procesar_documento(org, 42, doc, proveedor, DATOS))["estado"] == "ok"
        assert (await politica.procesar_documento(org, 42, doc, proveedor, DATOS))["estado"] == "ya_procesado"
        assert (await politica.procesar_documento(org, 42, uuid4(), proveedor, DATOS))["motivo"] == "cuota_agotada"
        assert len(llamadas) == 1
        assert (await politica.procesar_documento(otra, 42, doc, proveedor, DATOS))["estado"] == "ok"
        assert (await politica.procesar_documento(org, 43, doc, proveedor, DATOS))["estado"] == "ok"
    asyncio.run(escenario())
    assert DocumentoIngesta.objects.count() == len(llamadas) == 3
    assert CupoIngesta.objects.count() == 3


def test_error_libera_reserva_y_cuota_no_disponible_nunca_llama_proveedor():
    org, doc = uuid4(), uuid4()
    llamadas = []
    async def caido(timeout):
        llamadas.append(1)
        raise ConnectionError("error sintético")
    async def escenario():
        politica = PoliticaIA(max_documentos=1)
        resultado = await politica.procesar_documento(org, 42, doc, caido, DATOS)
        assert resultado["motivo"] == "proveedor_no_disponible" and resultado["datos"] == DATOS
        with patch("analytics.politica_ia.reservar", side_effect=DatabaseError("caída sintética")):
            assert (await politica.procesar_documento(org, 42, doc, caido, DATOS))["motivo"] == "cuota_no_disponible"
        assert len(llamadas) == 1
    asyncio.run(escenario())
    assert not DocumentoIngesta.objects.exists()


def test_reserva_abandonada_vence_y_purga_elimina_solo_su_tenant():
    org, otra = uuid4(), uuid4()
    reserva = reservar(org, 42, uuid4(), 1, 60)
    reservar(otra, 42, uuid4(), 1, 60)
    DocumentoIngesta.objects.filter(pk=reserva).update(vence_en=timezone.now()-timedelta(seconds=1))
    reservar(org, 42, uuid4(), 1, 60)
    assert DocumentoIngesta.objects.count() == 2
    purgar_cuotas_organizacion(org)
    assert CupoIngesta.objects.count() == DocumentoIngesta.objects.count() == 1
    assert CupoIngesta.objects.get().organizacion_id == otra


def test_reservas_concurrentes_respetan_limite_en_postgresql():
    org = uuid4()
    def solicitar(_):
        close_old_connections()
        try:
            try:
                reservar(org, 42, uuid4(), 1, 60)
                return "reservado"
            except CuotaAgotada:
                return "agotada"
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(solicitar, range(2))) == ["agotada", "reservado"]
    assert DocumentoIngesta.objects.count() == 1


@pytest.mark.parametrize("usuario", [True, 0, -1, "texto", "１２", 2**63])
def test_identidad_invalida_no_reserva(usuario):
    with pytest.raises(ValueError):
        reservar(uuid4(), usuario, uuid4(), 1, 60)
    assert not CupoIngesta.objects.exists()


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf")])
def test_configuracion_invalida_se_rechaza(timeout):
    with pytest.raises(ValueError):
        PoliticaIA(timeout=timeout)


def test_proveedor_sincrono_no_se_ejecuta():
    with pytest.raises(TypeError):
        asyncio.run(PoliticaIA().ejecutar(lambda timeout: {"invalido": True}, DATOS))


def test_documento_en_proceso_no_llama_al_proveedor():
    org, doc = uuid4(), uuid4()
    reservar(org, 42, doc, 1, 60)
    async def no_debe_llamarse(timeout):
        pytest.fail("No se debe duplicar un trabajo reservado")
    resultado = asyncio.run(PoliticaIA(max_documentos=1).procesar_documento(org, 42, doc, no_debe_llamarse, DATOS))
    assert resultado["motivo"] == "documento_en_proceso"


def test_cancelar_peticion_libera_la_reserva():
    org, doc = uuid4(), uuid4()
    async def escenario():
        politica = PoliticaIA()
        comenzo = asyncio.Event()
        async def lento(timeout):
            comenzo.set()
            await asyncio.sleep(10)
        trabajo = asyncio.create_task(politica.procesar_documento(org, 42, doc, lento, DATOS))
        await comenzo.wait()
        trabajo.cancel()
        with pytest.raises(asyncio.CancelledError):
            await trabajo
    asyncio.run(escenario())
    assert not DocumentoIngesta.objects.exists()
