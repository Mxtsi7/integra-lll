import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import time
from unittest.mock import patch
from uuid import uuid4
import pytest
from django.db import DatabaseError, close_old_connections
from django.utils import timezone
from analytics.models import CupoIngesta, DocumentoIngesta, IntentoPDF, ConsumoMensualIA
from analytics.politica_ia import PoliticaIA, CuotaAgotada, reservar, consumir_llamada, purgar_cuotas_organizacion

pytestmark = pytest.mark.django_db(transaction=True)
DATOS = {"ahorro": None, "gastos_por_moneda": {"CLP": "9990.00", "USD": "5.00"}}
HUELLA = "a" * 64


async def rapido(timeout):
    return {"valor": "real"}


def test_valores_predeterminados_corresponden_a_reglas_vigentes():
    politica = PoliticaIA()
    assert politica.timeout == 3.5
    assert politica.max_intentos_pdf == 3
    assert politica.max_llamadas_mes == 200


def test_timeout_cancela_y_conserva_datos_sin_bloquear_otras_funciones():
    org = uuid4()
    async def escenario():
        politica = PoliticaIA(timeout=.02, simultaneas=1)
        comenzo, cancelado = asyncio.Event(), asyncio.Event()
        async def lento(timeout):
            comenzo.set()
            try:
                await asyncio.sleep(10)
            finally:
                cancelado.set()
        llamada = asyncio.create_task(politica.ejecutar(lento, DATOS, organizacion_id=org, usuario_id=42))
        await comenzo.wait()
        assert (await politica.ejecutar(rapido, DATOS, organizacion_id=org, usuario_id=42))["motivo"] == "capacidad"
        inicio = time.monotonic()
        resultado = await llamada
        assert time.monotonic() - inicio < 1 and cancelado.is_set()
        assert resultado == {"estado": "degradado", "motivo": "timeout", "datos": DATOS}
        resultado["datos"]["gastos_por_moneda"]["CLP"] = "0"
        assert DATOS["gastos_por_moneda"]["CLP"] == "9990.00"
        assert (await politica.ejecutar(rapido, DATOS, organizacion_id=org, usuario_id=42))["estado"] == "ok"
    asyncio.run(escenario())
    assert ConsumoMensualIA.objects.get().llamadas == 2


def test_mismo_pdf_tres_intentos_dia_y_reintento_idempotente_sin_costo():
    org, otra, doc = uuid4(), uuid4(), uuid4()
    llamadas = []
    async def proveedor(timeout):
        llamadas.append(timeout)
        return {"analisis": "solo datos del caso"}
    async def escenario():
        politica = PoliticaIA()
        async def procesar(organizacion, usuario, documento, huella=HUELLA):
            return await politica.procesar_documento(organizacion, usuario, documento, proveedor, DATOS, huella_pdf=huella)
        assert (await procesar(org, 42, doc))["estado"] == "ok"
        assert (await procesar(org, 42, doc))["estado"] == "ya_procesado"
        for _ in range(2):
            assert (await procesar(org, 42, uuid4()))["estado"] == "ok"
        assert (await procesar(otra, 42, uuid4()))["motivo"] == "cuota_agotada"
        assert len(llamadas) == 3
        assert (await procesar(org, 43, doc))["estado"] == "ok"
        assert (await procesar(org, 42, uuid4(), "b" * 64))["estado"] == "ok"
    asyncio.run(escenario())
    assert DocumentoIngesta.objects.count() == len(llamadas) == 5
    assert all(registro.huella != HUELLA for registro in IntentoPDF.objects.all())


def test_dia_nuevo_reinicia_intentos_y_mes_nuevo_reinicia_llamadas():
    org, hoy = uuid4(), timezone.localdate()
    reservar(org, 42, uuid4(), 1, 60, HUELLA)
    consumir_llamada(org, 42, 1)
    with pytest.raises(CuotaAgotada):
        reservar(org, 42, uuid4(), 1, 60, HUELLA)
    with patch("analytics.politica_ia.timezone.localdate", return_value=hoy + timedelta(days=1)):
        reservar(org, 42, uuid4(), 1, 60, HUELLA)
    siguiente_mes = (hoy.replace(day=28) + timedelta(days=4)).replace(day=1)
    with patch("analytics.politica_ia.timezone.localdate", return_value=siguiente_mes):
        consumir_llamada(org, 42, 1)
    assert ConsumoMensualIA.objects.count() == 2


def test_limite_mensual_chat_por_usuario_aunque_cambie_organizacion():
    org, otra = uuid4(), uuid4()
    async def escenario():
        politica = PoliticaIA(max_llamadas_mes=1)
        assert (await politica.ejecutar(rapido, DATOS, organizacion_id=org, usuario_id=42))["estado"] == "ok"
        assert (await politica.ejecutar(rapido, DATOS, organizacion_id=otra, usuario_id=42))["motivo"] == "cuota_agotada"
        assert (await politica.ejecutar(rapido, DATOS, organizacion_id=otra, usuario_id=43))["estado"] == "ok"
    asyncio.run(escenario())
    assert list(ConsumoMensualIA.objects.values_list("llamadas", flat=True)) == [1, 1]


def test_error_libera_reserva_pero_no_reembolsa_intento_ni_llamada():
    org, doc = uuid4(), uuid4()
    async def caido(timeout):
        raise ConnectionError("error sintético")
    async def escenario():
        politica = PoliticaIA()
        resultado = await politica.procesar_documento(org, 42, doc, caido, DATOS, huella_pdf=HUELLA)
        assert resultado["motivo"] == "proveedor_no_disponible" and resultado["datos"] == DATOS
        with patch("analytics.politica_ia.reservar", side_effect=DatabaseError("caída sintética")):
            assert (await politica.procesar_documento(org, 42, doc, caido, DATOS, huella_pdf=HUELLA))["motivo"] == "cuota_no_disponible"
        with patch("analytics.politica_ia.consumir_llamada", side_effect=DatabaseError("caída sintética")):
            assert (await politica.ejecutar(rapido, DATOS, organizacion_id=org, usuario_id=42))["motivo"] == "cuota_no_disponible"
    asyncio.run(escenario())
    assert not DocumentoIngesta.objects.exists()
    assert IntentoPDF.objects.get().intentos == ConsumoMensualIA.objects.get().llamadas == 1


def test_reserva_abandonada_vence_y_purga_elimina_solo_su_tenant():
    org, otra = uuid4(), uuid4()
    reserva = reservar(org, 42, uuid4(), 3, 60, HUELLA)
    reservar(otra, 43, uuid4(), 3, 60, HUELLA)
    consumir_llamada(org, 42, 200)
    DocumentoIngesta.objects.filter(pk=reserva).update(vence_en=timezone.now()-timedelta(seconds=1))
    reservar(org, 42, uuid4(), 3, 60, HUELLA)
    assert DocumentoIngesta.objects.count() == 2
    purgar_cuotas_organizacion(org)
    assert CupoIngesta.objects.count() == DocumentoIngesta.objects.count() == IntentoPDF.objects.count() == 1
    assert not ConsumoMensualIA.objects.exists()
    assert CupoIngesta.objects.get().organizacion_id == otra


@pytest.mark.parametrize("tipo", ["pdf", "mensual"])
def test_concurrencia_respeta_limite_postgresql_incluso_entre_tenants(tipo):
    def solicitar(_):
        close_old_connections()
        try:
            try:
                if tipo == "pdf":
                    reservar(uuid4(), 42, uuid4(), 1, 60, HUELLA)
                else:
                    consumir_llamada(uuid4(), 42, 1)
                return "reservado"
            except CuotaAgotada:
                return "agotada"
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(solicitar, range(2))) == ["agotada", "reservado"]


@pytest.mark.parametrize("usuario", [True, 0, -1, "texto", "１２", 2**63])
def test_identidad_invalida_no_reserva(usuario):
    with pytest.raises(ValueError):
        reservar(uuid4(), usuario, uuid4(), 3, 60, HUELLA)
    assert not CupoIngesta.objects.exists()


@pytest.mark.parametrize("valores", [{"timeout": 0}, {"timeout": -1}, {"timeout": float("nan")}, {"timeout": float("inf")}, {"timeout": 4}, {"max_llamadas_mes": 201}, {"max_intentos_pdf": 4}, {"simultaneas": 0}])
def test_configuracion_invalida_se_rechaza(valores):
    with pytest.raises(ValueError):
        PoliticaIA(**valores)


def test_proveedor_sincrono_no_se_ejecuta():
    with pytest.raises(TypeError):
        asyncio.run(PoliticaIA().ejecutar(lambda timeout: {"invalido": True}, DATOS, organizacion_id=uuid4(), usuario_id=42))


def test_documento_en_proceso_no_llama_al_proveedor_y_exige_huella_valida():
    org, doc = uuid4(), uuid4()
    reservar(org, 42, doc, 3, 60, HUELLA)
    resultado = asyncio.run(PoliticaIA().procesar_documento(org, 42, doc, rapido, DATOS, huella_pdf=HUELLA))
    assert resultado["motivo"] == "documento_en_proceso"
    with pytest.raises(ValueError):
        reservar(org, 42, uuid4(), 3, 60, "sin-huella")


def test_cancelar_peticion_libera_reserva_sin_reembolsar_costo():
    org, doc = uuid4(), uuid4()
    async def escenario():
        comenzo = asyncio.Event()
        async def lento(timeout):
            comenzo.set()
            await asyncio.sleep(10)
        trabajo = asyncio.create_task(PoliticaIA().procesar_documento(org, 42, doc, lento, DATOS, huella_pdf=HUELLA))
        await comenzo.wait()
        trabajo.cancel()
        with pytest.raises(asyncio.CancelledError):
            await trabajo
    asyncio.run(escenario())
    assert not DocumentoIngesta.objects.exists()
    assert ConsumoMensualIA.objects.get().llamadas == 1
