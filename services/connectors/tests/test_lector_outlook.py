"""S3-FE-04 — consultar los mensajes de una cuenta de Outlook autorizada.

Criterios de la tarjeta:
- la lectura usa la cuenta correcta;
- maneja páginas adicionales y el rechazo de autorización de forma explícita.

Estas pruebas usan el `lector_outlook` REAL y reemplazan solo `requests.get`.

── De dónde salen las respuestas de Graph ───────────────────────────────────
- Los dos 401 son **copia literal** de lo que respondió `graph.microsoft.com`
  el 13-11-2026 a un token ilegible y a una petición sin token.
- La forma de la lista (`@odata.context`, `value`, `@odata.nextLink`) y de cada
  mensaje sigue la referencia publicada de "List messages" y del recurso
  `message`. Se contrasta con una cuenta de prueba real; ver el documento 24.

Lo común con Gmail (qué cuenta se puede leer, el filtro, el HTML a texto) ya
está probado en `test_lector_gmail.py` sobre el mismo `lectura_correo`. Aquí
se repite lo que tiene que valer **para Outlook en particular**: que pida la
cuenta de Outlook y no otra.
"""

import uuid
from datetime import datetime, timedelta, timezone as tz

import pytest
import requests
from django.utils import timezone

from connectors import lector_outlook
from connectors.lector_outlook import (
    URL_MENSAJES,
    AutorizacionRechazada,
    CuentaNoDisponible,
    ErrorDelProveedor,
    ErrorTransitorio,
    FiltroCorreos,
    busqueda_outlook,
    es_pagina_de_graph,
    filtro_fechas_outlook,
    leer_mensajes,
)
from connectors.models import CuentaConectada

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
TOKEN = "EwB4A8l6BAAU-token-de-prueba-que-no-debe-salir"
SIGUIENTE = "https://graph.microsoft.com/v1.0/me/messages?%24top=25&%24select=id&%24skip=25"


# ══════════════════════════════════════════════════════════════════════
# Graph falso
# ══════════════════════════════════════════════════════════════════════


class _Respuesta:
    def __init__(self, status_code, cuerpo=None, cabeceras=None):
        self.status_code = status_code
        self._cuerpo = cuerpo
        self.headers = cabeceras or {}

    def json(self):
        if isinstance(self._cuerpo, Exception):
            raise self._cuerpo
        if self._cuerpo is None:
            raise ValueError("no es JSON")
        return self._cuerpo


# Copia literal de graph.microsoft.com (13-11-2026), token ilegible.
ERROR_401 = {"error": {
    "code": "InvalidAuthenticationToken",
    "message": "Protocol 'Bearer' failed to validate because The token could not be read.",
    "innerError": {"date": "2026-11-13T21:52:08", "request-id": "f0713d8b-c08a-4f0a-b5a8-7e01e7009ca9",
                   "client-request-id": "f0713d8b-c08a-4f0a-b5a8-7e01e7009ca9"},
}}
# Copia literal, petición sin token.
ERROR_401_SIN_TOKEN = {"error": {
    "code": "InvalidAuthenticationToken", "message": "Access token is empty.",
    "innerError": {"date": "2026-11-13T21:52:08", "request-id": "2bc027e2-5b47-4b6c-a24b-be16654641cd",
                   "client-request-id": "2bc027e2-5b47-4b6c-a24b-be16654641cd"},
}}


def error_graph(codigo, mensaje="..."):
    return {"error": {"code": codigo, "message": mensaje, "innerError": {}}}


def mensaje_graph(id_mensaje, *, asunto="Tu recibo de Microsoft 365", recibido="2026-10-01T11:00:00Z",
                  texto="Cobro mensual: $8.990 CLP", tipo="text", remitente=("Microsoft", "billing@microsoft.com")):
    return {
        "@odata.etag": 'W/"CQAAABYAAADHcgC8Hl9tRZ/hc1wEUs1TAAAwR4Hg"',
        "id": id_mensaje,
        "conversationId": f"conv-{id_mensaje}",
        "receivedDateTime": recibido,
        "subject": asunto,
        "from": {"emailAddress": {"name": remitente[0], "address": remitente[1]}},
        "body": {"contentType": tipo, "content": texto},
    }


def lista(*mensajes, siguiente=None):
    cuerpo = {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('bb8775a4')/messages",
        "value": list(mensajes),
    }
    if siguiente:
        cuerpo["@odata.nextLink"] = siguiente
    return _Respuesta(200, cuerpo)


class GraphFalso:
    def __init__(self, monkeypatch):
        self.peticiones = []
        self.respuestas = [lista()]
        monkeypatch.setattr(lector_outlook.requests, "get", self.get)

    def get(self, url, params=None, headers=None, timeout=None, allow_redirects=True):
        self.peticiones.append({"url": url, "params": dict(params) if params else None,
                                "headers": dict(headers or {}), "timeout": timeout,
                                "allow_redirects": allow_redirects})
        respuesta = self.respuestas.pop(0) if len(self.respuestas) > 1 else self.respuestas[0]
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta

    def responde(self, *respuestas):
        self.respuestas = list(respuestas)
        return self


@pytest.fixture
def graph(monkeypatch):
    return GraphFalso(monkeypatch)


def outlook(*, org=ORG_A, correo="prueba@outlook.com", estado="conectada", access=TOKEN,
            vence_en=timedelta(minutes=50), proveedor="outlook"):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=correo, estado=estado,
        access_token=access, refresh_token="M.C1-refresco",
        token_expira_en=None if vence_en is None else timezone.now() + vence_en,
    )


def leer(cuenta, org=ORG_A, **extra):
    return leer_mensajes(organizacion_id=org, cuenta_id=cuenta.pk, **extra)


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — la lectura usa la cuenta correcta
# ══════════════════════════════════════════════════════════════════════


class TestLaCuentaCorrecta:
    def test_lee_y_devuelve_los_mensajes(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("AAMkAGUAAAwTW09AAA="), mensaje_graph("AAMkAGUAAAwTW09AAB=")))

        pagina = leer(cuenta)

        assert [m.id_mensaje for m in pagina.mensajes] == ["AAMkAGUAAAwTW09AAA=", "AAMkAGUAAAwTW09AAB="]
        primero = pagina.mensajes[0]
        assert primero.cuenta_id == cuenta.pk
        assert primero.id_hilo == "conv-AAMkAGUAAAwTW09AAA="
        assert primero.recibido_en == datetime(2026, 10, 1, 11, 0, tzinfo=tz.utc)
        assert primero.remitente == "Microsoft <billing@microsoft.com>"
        assert primero.asunto == "Tu recibo de Microsoft 365"
        assert primero.texto == "Cobro mensual: $8.990 CLP"
        assert pagina.siguiente_pagina is None and pagina.omitidos == ()

    def test_manda_el_token_de_esa_cuenta_y_nada_mas(self, claves, graph):
        outlook(correo="otra@outlook.com", access="EwB-de-la-otra")
        outlook(org=ORG_B, access="EwB-de-otra-organizacion")
        cuenta = outlook()
        leer(cuenta)
        (peticion,) = graph.peticiones
        assert peticion["headers"]["Authorization"] == f"Bearer {TOKEN}"
        assert peticion["timeout"]
        assert peticion["allow_redirects"] is False

    def test_una_sola_peticion_por_pagina_con_los_campos_justos(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(*(mensaje_graph(f"m{i}") for i in range(5))))
        leer(cuenta, limite=5)
        (peticion,) = graph.peticiones
        assert peticion["url"] == URL_MENSAJES
        assert peticion["params"]["$top"] == 5
        assert peticion["params"]["$select"] == "id,conversationId,receivedDateTime,from,subject,body"
        assert peticion["headers"]["Prefer"] == 'outlook.body-content-type="text"'

    def test_la_cuenta_de_gmail_con_ese_id_no_sirve(self, claves, graph):
        gmail = outlook(proveedor="gmail", correo="p@gmail.com")
        with pytest.raises(CuentaNoDisponible) as error:
            leer(gmail)
        assert error.value.codigo == CuentaNoDisponible.NO_ENCONTRADA
        assert "Outlook" in str(error.value)
        assert graph.peticiones == []

    def test_la_de_otra_organizacion_tampoco(self, claves, graph):
        ajena = outlook(org=ORG_B)
        with pytest.raises(CuentaNoDisponible) as error:
            leer(ajena)
        assert error.value.codigo == CuentaNoDisponible.NO_ENCONTRADA
        assert graph.peticiones == []

    @pytest.mark.parametrize("estado, codigo", [
        ("desconectada", CuentaNoDisponible.DESCONECTADA),
        ("requiere_reautorizacion", CuentaNoDisponible.REQUIERE_REAUTORIZACION),
        ("error", CuentaNoDisponible.REQUIERE_REAUTORIZACION),
    ])
    def test_ni_una_que_no_esta_conectada(self, claves, graph, estado, codigo):
        cuenta = outlook(estado=estado)
        with pytest.raises(CuentaNoDisponible) as error:
            leer(cuenta)
        assert error.value.codigo == codigo
        assert graph.peticiones == []

    def test_ni_una_con_el_token_vencido(self, claves, graph):
        cuenta = outlook(vence_en=timedelta(minutes=-1))
        with pytest.raises(CuentaNoDisponible) as error:
            leer(cuenta)
        assert error.value.codigo == CuentaNoDisponible.CREDENCIAL_VENCIDA
        assert graph.peticiones == []

    def test_no_cambia_la_cuenta(self, claves, graph):
        cuenta = outlook()
        antes = CuentaConectada.objects.values().get(pk=cuenta.pk)
        graph.responde(_Respuesta(401, ERROR_401))
        with pytest.raises(AutorizacionRechazada):
            leer(cuenta)
        assert CuentaConectada.objects.values().get(pk=cuenta.pk) == antes


# ══════════════════════════════════════════════════════════════════════
# Criterio 2a — páginas adicionales
# ══════════════════════════════════════════════════════════════════════


class TestPaginas:
    def test_devuelve_la_pagina_siguiente_de_graph(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1"), siguiente=SIGUIENTE))
        assert leer(cuenta).siguiente_pagina == SIGUIENTE

    def test_la_pagina_siguiente_se_pide_tal_cual(self, claves, graph):
        """Microsoft pide usar la `@odata.nextLink` entera, sin sacarle el
        `$skip` ni agregarle parámetros."""
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("b1")))
        pagina = leer(cuenta, pagina=SIGUIENTE)
        (peticion,) = graph.peticiones
        assert peticion["url"] == SIGUIENTE
        assert peticion["params"] is None
        assert [m.id_mensaje for m in pagina.mensajes] == ["b1"]
        assert pagina.siguiente_pagina is None

    def test_recorre_dos_paginas(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1"), siguiente=SIGUIENTE), lista(mensaje_graph("b1")))
        primera = leer(cuenta)
        segunda = leer(cuenta, pagina=primera.siguiente_pagina)
        assert [m.id_mensaje for m in primera.mensajes + segunda.mensajes] == ["a1", "b1"]

    @pytest.mark.parametrize("pagina", [
        "https://otro.sitio/v1.0/me/messages?$skip=10",
        "https://graph.microsoft.com.otro.sitio/v1.0/me/messages",
        "https://graph.microsoft.com@otro.sitio/v1.0/me/messages",
        "https://usuario@graph.microsoft.com/v1.0/me/messages",
        "https://graph.microsoft.com:8443/v1.0/me/messages",
        "http://graph.microsoft.com/v1.0/me/messages",
        "https://graph.microsoft.com/v1.0/users/otro/messages",
        "https://graph.microsoft.com/v1.0/me/messages/../../users/otro/messages",
        "https://graph.microsoft.com/beta/me/messages",
        "https://graph.microsoft.com/v1.0/me/messages#x",
        "https://graph.microsoft.com/v1.0/me/messages?$skip=1 x",
        "//graph.microsoft.com/v1.0/me/messages",
        "https://graph.microsoft.com/v1.0/me/messages?" + "a" * 4100,
        "", 123,
    ])
    def test_una_pagina_ajena_no_recibe_el_token(self, claves, graph, pagina):
        cuenta = outlook()
        with pytest.raises(ValueError):
            leer(cuenta, pagina=pagina)
        assert graph.peticiones == []

    def test_una_pagina_siguiente_ajena_de_graph_no_se_devuelve(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1"), siguiente="https://otro.sitio/v1.0/me/messages?$skip=1"))
        with pytest.raises(ErrorDelProveedor):
            leer(cuenta)

    def test_no_devuelve_mas_que_el_limite(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(*(mensaje_graph(f"m{i}") for i in range(8))))
        assert len(leer(cuenta, limite=3).mensajes) == 3

    @pytest.mark.parametrize("limite", [0, 101, True, "5"])
    def test_limite_fuera_de_rango(self, claves, graph, limite):
        cuenta = outlook()
        with pytest.raises(ValueError):
            leer(cuenta, limite=limite)
        assert graph.peticiones == []

    def test_lista_vacia(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista())
        pagina = leer(cuenta)
        assert pagina.mensajes == () and pagina.siguiente_pagina is None

    @pytest.mark.parametrize("cuerpo", [{"value": "no"}, {"@odata.context": "x"}, ["lista"]])
    def test_una_lista_que_no_es_lista(self, claves, graph, cuerpo):
        cuenta = outlook()
        graph.responde(_Respuesta(200, cuerpo))
        with pytest.raises(ErrorDelProveedor):
            leer(cuenta)


class TestEsPaginaDeGraph:
    def test_la_que_arma_graph(self):
        assert es_pagina_de_graph(SIGUIENTE)
        assert es_pagina_de_graph(URL_MENSAJES + "?%24skiptoken=abc")


# ══════════════════════════════════════════════════════════════════════
# Criterio 2b — rechazo de autorización explícito
# ══════════════════════════════════════════════════════════════════════


class TestRechazoYErrores:
    def _falla(self, graph, respuesta, excepcion, codigo):
        cuenta = outlook()
        graph.responde(respuesta)
        with pytest.raises(excepcion) as error:
            leer(cuenta)
        assert error.value.codigo == codigo
        assert TOKEN not in str(error.value) and TOKEN not in repr(error.value)
        return error.value

    @pytest.mark.parametrize("cuerpo", [ERROR_401, ERROR_401_SIN_TOKEN])
    def test_401_es_autorizacion_rechazada(self, claves, graph, cuerpo):
        error = self._falla(graph, _Respuesta(401, cuerpo), AutorizacionRechazada, "autorizacion_rechazada")
        assert "InvalidAuthenticationToken" in str(error)
        # El `message` de Graph no se propaga.
        assert "could not be read" not in str(error)

    def test_403_es_permiso_insuficiente(self, claves, graph):
        self._falla(graph, _Respuesta(403, error_graph("ErrorAccessDenied", "Access is denied.")),
                    AutorizacionRechazada, "permiso_insuficiente")

    @pytest.mark.parametrize("codigo", ["MailboxNotEnabledForRESTAPI", "ResourceNotFound"])
    def test_cuenta_sin_buzon(self, claves, graph, codigo):
        self._falla(graph, _Respuesta(404, error_graph(codigo)), ErrorDelProveedor, "buzon_no_disponible")

    def test_otro_404_no_se_toma_por_falta_de_buzon(self, claves, graph):
        self._falla(graph, _Respuesta(404, error_graph("ErrorItemNotFound")), ErrorDelProveedor, "error_del_proveedor")

    def test_429_con_retry_after(self, claves, graph):
        error = self._falla(graph, _Respuesta(429, error_graph("TooManyRequests"), {"Retry-After": "12"}),
                            ErrorTransitorio, "cuota_excedida")
        assert error.reintentar_en == 12

    @pytest.mark.parametrize("valor", [None, "mañana", "-5", "999999"])
    def test_retry_after_raro_no_se_usa(self, claves, graph, valor):
        cabeceras = {} if valor is None else {"Retry-After": valor}
        error = self._falla(graph, _Respuesta(429, error_graph("TooManyRequests"), cabeceras),
                            ErrorTransitorio, "cuota_excedida")
        assert error.reintentar_en is None

    @pytest.mark.parametrize("estado", [500, 502, 503, 504])
    def test_5xx_es_transitorio(self, claves, graph, estado):
        self._falla(graph, _Respuesta(estado, ValueError("html")), ErrorTransitorio, "falla_del_proveedor")

    def test_400_es_permanente(self, claves, graph):
        self._falla(graph, _Respuesta(400, error_graph("InefficientFilter")), ErrorDelProveedor, "error_del_proveedor")

    def test_codigo_de_graph_con_texto_raro_no_se_copia(self, claves, graph):
        error = self._falla(graph, _Respuesta(400, error_graph(f"x {TOKEN}")), ErrorDelProveedor, "error_del_proveedor")
        assert "x " not in str(error)

    @pytest.mark.parametrize("excepcion, codigo", [
        (requests.Timeout(f"timeout Bearer {TOKEN}"), "tiempo_agotado"),
        (requests.ConnectionError(f"fallo Bearer {TOKEN}"), "sin_conexion"),
    ])
    def test_red(self, claves, graph, excepcion, codigo):
        error = self._falla(graph, excepcion, ErrorTransitorio, codigo)
        assert error.__cause__ is None and error.__suppress_context__

    @pytest.mark.parametrize("cuerpo", [ValueError("no es JSON"), ["una", "lista"]])
    def test_200_que_no_es_un_objeto(self, claves, graph, cuerpo):
        self._falla(graph, _Respuesta(200, cuerpo), ErrorDelProveedor, "error_del_proveedor")

    def test_401_en_la_segunda_pagina(self, claves, graph):
        cuenta = outlook()
        graph.responde(_Respuesta(401, ERROR_401))
        with pytest.raises(AutorizacionRechazada):
            leer(cuenta, pagina=SIGUIENTE)


# ══════════════════════════════════════════════════════════════════════
# Filtros: $search para palabras y remitentes, $filter para fechas
# ══════════════════════════════════════════════════════════════════════


class TestFiltros:
    def test_por_omision_busca_palabras_de_cobro(self, claves, graph):
        cuenta = outlook()
        leer(cuenta)
        params = graph.peticiones[0]["params"]
        assert params["$search"].startswith('"(recibo OR factura') and params["$search"].endswith(')"')
        assert "$orderby" not in params and "$filter" not in params  # $search no los admite

    def test_remitentes(self):
        assert busqueda_outlook(FiltroCorreos(remitentes=("netflix.com", "a@b.cl"), solo_cobros=False)) == (
            "(from:netflix.com OR from:a@b.cl)"
        )

    def test_palabras_y_remitentes(self):
        busqueda = busqueda_outlook(FiltroCorreos(remitentes=("netflix.com",)))
        assert busqueda.endswith(") AND (from:netflix.com)")

    @pytest.mark.parametrize("remitente", ['a" OR "x', "a) OR (b", "-netflix.com"])
    def test_un_remitente_que_rompe_la_busqueda(self, claves, graph, remitente):
        cuenta = outlook()
        with pytest.raises(ValueError):
            leer(cuenta, filtro=FiltroCorreos(remitentes=(remitente,)))
        assert graph.peticiones == []

    def test_sin_palabras_las_fechas_van_en_filter_y_ordenado(self, claves, graph):
        cuenta = outlook()
        desde = datetime(2026, 10, 1, 3, 0, tzinfo=tz.utc)
        hasta = datetime(2026, 11, 1, tzinfo=tz(timedelta(hours=-3)))
        leer(cuenta, filtro=FiltroCorreos(desde=desde, hasta=hasta, solo_cobros=False))
        params = graph.peticiones[0]["params"]
        assert params["$filter"] == "receivedDateTime ge 2026-10-01T03:00:00Z and receivedDateTime lt 2026-11-01T03:00:00Z"
        assert params["$orderby"] == "receivedDateTime desc"
        assert "$search" not in params

    def test_con_palabras_las_fechas_se_aplican_de_este_lado(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(
            mensaje_graph("antes", recibido="2026-09-30T23:59:59Z"),
            mensaje_graph("dentro", recibido="2026-10-15T10:00:00Z"),
            mensaje_graph("justo-hasta", recibido="2026-11-01T00:00:00Z"),
        ))
        filtro = FiltroCorreos(desde=datetime(2026, 10, 1, tzinfo=tz.utc), hasta=datetime(2026, 11, 1, tzinfo=tz.utc))
        pagina = leer(cuenta, filtro=filtro)
        assert [m.id_mensaje for m in pagina.mensajes] == ["dentro"]
        assert pagina.omitidos == ()  # quedar fuera del rango no es un problema

    @pytest.mark.parametrize("arma", [busqueda_outlook, filtro_fechas_outlook])
    def test_cada_traduccion_valida_por_su_cuenta(self, arma):
        with pytest.raises(ValueError):
            arma(FiltroCorreos(remitentes=('a" OR "x',)))

    def test_sin_fechas_no_hay_filter(self):
        assert filtro_fechas_outlook(FiltroCorreos()) == ""

    def test_fecha_sin_zona(self, claves, graph):
        cuenta = outlook()
        with pytest.raises(ValueError):
            leer(cuenta, filtro=FiltroCorreos(desde=datetime(2026, 10, 1)))
        assert graph.peticiones == []


# ══════════════════════════════════════════════════════════════════════
# El mensaje
# ══════════════════════════════════════════════════════════════════════


class TestMensaje:
    def _uno(self, graph, **kw):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1", **kw)))
        return leer(cuenta)

    def test_cuerpo_html_se_pasa_a_texto(self, claves, graph):
        html = "<html><head><style>x</style></head><body><p>Total:</p><p><b>US$ 12,50</b></p></body></html>"
        (mensaje,) = self._uno(graph, tipo="html", texto=html).mensajes
        assert mensaje.texto == "Total:\nUS$ 12,50"

    def test_fecha_con_siete_decimales(self, claves, graph):
        (mensaje,) = self._uno(graph, recibido="2026-10-01T11:00:00.1234567Z").mensajes
        assert mensaje.recibido_en.replace(microsecond=0) == datetime(2026, 10, 1, 11, 0, tzinfo=tz.utc)

    @pytest.mark.parametrize("recibido", [None, "", "ayer", "2026-10-01T11:00:00"])
    def test_sin_fecha_util_se_informa(self, claves, graph, recibido):
        pagina = self._uno(graph, recibido=recibido)
        assert pagina.mensajes == ()
        assert pagina.omitidos[0].id_mensaje == "a1"

    def test_remitente_sin_nombre(self, claves, graph):
        (mensaje,) = self._uno(graph, remitente=("", "billing@microsoft.com")).mensajes
        assert mensaje.remitente == "billing@microsoft.com"

    def test_un_elemento_que_no_es_un_mensaje(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista("no", {"id": None}, {"id": "x" * 600, "receivedDateTime": "2026-10-01T00:00:00Z"},
                             mensaje_graph("bueno")))
        pagina = leer(cuenta)
        assert [m.id_mensaje for m in pagina.mensajes] == ["bueno"]
        assert len(pagina.omitidos) == 3

    def test_texto_largo_se_corta(self, claves, graph):
        (mensaje,) = self._uno(graph, texto="x" * 25_000).mensajes
        assert len(mensaje.texto) == 20_000 and mensaje.texto_truncado

    def test_el_repr_no_lleva_el_cuerpo(self, claves, graph):
        (mensaje,) = self._uno(graph, texto="dato-privado").mensajes
        assert "dato-privado" not in repr(mensaje)


class TestComando:
    def test_lee_la_cuenta_de_outlook_sin_imprimir_el_cuerpo(self, claves, graph):
        from io import StringIO

        from django.core.management import call_command

        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1", texto="cuerpo-privado"), siguiente=SIGUIENTE))
        salida = StringIO()
        call_command("leer_outlook", "--organizacion", str(ORG_A), "--cuenta", str(cuenta.pk), stdout=salida)
        assert "a1" in salida.getvalue() and SIGUIENTE in salida.getvalue()
        assert "cuerpo-privado" not in salida.getvalue()

    def test_no_lee_una_cuenta_de_gmail(self, claves, graph):
        from django.core.management import call_command
        from django.core.management.base import CommandError

        gmail = outlook(proveedor="gmail", correo="p@gmail.com")
        with pytest.raises(CommandError, match="cuenta_no_encontrada"):
            call_command("leer_outlook", "--organizacion", str(ORG_A), "--cuenta", str(gmail.pk))
        assert graph.peticiones == []
