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
- De la `@odata.nextLink` el lector solo usa que venga: la página siguiente
  la arma él, por fecha (revisión de #189, ronda 3).

Lo común con Gmail (qué cuenta se puede leer, el filtro, el HTML a texto) ya
está probado en `test_lector_gmail.py` sobre el mismo `lectura_correo`. Aquí
se repite lo que tiene que valer **para Outlook en particular**: que pida la
cuenta de Outlook y no otra.
"""

import hashlib
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
    CursorRechazado,
    ErrorDelProveedor,
    ErrorTransitorio,
    MAXIMO_VISTOS,
    FiltroCorreos,
    filtro_fechas_outlook,
    leer_mensajes,
)
from connectors.models import CuentaConectada

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
TOKEN = "EwB4A8l6BAAU-token-de-prueba-que-no-debe-salir"
#: Lo que manda Graph cuando hay más. El lector solo mira que venga.
SIGUIENTE = "https://graph.microsoft.com/v1.0/me/messages?%24top=25&%24select=id&%24skip=25"
#: Un cursor del lector: lo recibido antes del 1-10 a las 11:00:01, sin vistos.
CURSOR = "antes-de=20261001T110001Z"


def huella(id_mensaje):
    return hashlib.sha256(id_mensaje.encode("utf-8")).hexdigest()[:16]


def cursor(corte="20261001T110001Z", *vistos):
    return f"antes-de={corte}" + (f"&vistos={','.join(sorted(huella(v) for v in vistos))}" if vistos else "")


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
        assert peticion["params"]["$select"] == "id,internetMessageId,conversationId,receivedDateTime,from,subject,body"
        # ImmutableId: el `id` no cambia si el usuario mueve el correo de carpeta.
        assert peticion["headers"]["Prefer"] == 'outlook.body-content-type="text", IdType="ImmutableId"'

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
    """La página siguiente la arma el lector, por fecha: la `@odata.nextLink`
    avanza con `$skip`, y un borrado a mitad de corrida hacía saltar un correo
    (revisión de #189, ronda 3). De la `nextLink` solo importa que venga."""

    def test_si_hay_mas_el_cursor_es_el_ultimo_segundo_y_los_de_ese_segundo(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1", recibido="2026-10-01T12:00:00Z"),
                             mensaje_graph("a2", recibido="2026-10-01T11:00:00.75Z"),
                             mensaje_graph("a3", recibido="2026-10-01T11:00:00Z"), siguiente=SIGUIENTE))
        # Graph muestra al segundo y el buzón guarda fracciones: el corte va
        # un segundo después, para que vuelvan los de ese segundo.
        assert leer(cuenta).siguiente_pagina == cursor("20261001T110001Z", "a2", "a3")

    def test_la_pagina_siguiente_es_la_misma_consulta_con_el_corte(self, claves, graph):
        cuenta = outlook()
        filtro = FiltroCorreos(desde=datetime(2026, 9, 1, tzinfo=tz.utc), hasta=datetime(2026, 11, 1, tzinfo=tz.utc))
        graph.responde(lista(mensaje_graph("b1", recibido="2026-10-01T10:00:00Z")))
        leer(cuenta, filtro=filtro, pagina=cursor("20261001T110001Z", "a1"), limite=5)
        (peticion,) = graph.peticiones
        assert peticion["url"] == URL_MENSAJES
        assert peticion["params"]["$filter"] == (
            "receivedDateTime ge 2026-09-01T00:00:00Z and receivedDateTime lt 2026-10-01T11:00:01Z"
        )
        assert peticion["params"]["$orderby"] == "receivedDateTime desc"
        # Los vistos vuelven a venir: se piden `limite` más ellos.
        assert peticion["params"]["$top"] == 6
        assert "$skip" not in peticion["params"]

    def test_recorre_dos_paginas_sin_repetir_el_del_borde(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1"), siguiente=SIGUIENTE),
                       lista(mensaje_graph("a1"), mensaje_graph("b1", recibido="2026-10-01T10:00:00Z")))
        primera = leer(cuenta)
        segunda = leer(cuenta, pagina=primera.siguiente_pagina)
        assert [m.id_mensaje for m in primera.mensajes + segunda.mensajes] == ["a1", "b1"]
        assert segunda.siguiente_pagina is None

    def test_los_del_mismo_segundo_que_no_alcanzaron_se_entregan_en_la_siguiente(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("x"), mensaje_graph("y"), siguiente=SIGUIENTE),
                       lista(mensaje_graph("x"), mensaje_graph("y"), mensaje_graph("z"),
                             mensaje_graph("w", recibido="2026-10-01T10:59:59Z")))
        primera = leer(cuenta, limite=2)
        segunda = leer(cuenta, pagina=primera.siguiente_pagina, limite=2)
        assert [m.id_mensaje for m in segunda.mensajes] == ["z", "w"]
        assert graph.peticiones[1]["params"]["$top"] == 4

    def test_una_pagina_entera_en_el_mismo_segundo_suma_sus_vistos_a_los_de_antes(self, claves, graph):
        """En el mismo segundo el orden no está garantizado: si uno ya visto
        no vuelve en la segunda página, sigue contado como visto y no se
        entrega dos veces en la tercera."""
        cuenta = outlook()
        graph.responde(
            lista(mensaje_graph("x"), mensaje_graph("y"), siguiente=SIGUIENTE),
            lista(mensaje_graph("y"), mensaje_graph("z"), mensaje_graph("w"), mensaje_graph("u"), siguiente=SIGUIENTE),
            lista(*(mensaje_graph(i) for i in "xyzwu"), mensaje_graph("q", recibido="2026-10-01T10:59:59Z")),
        )
        primera = leer(cuenta, limite=2)
        segunda = leer(cuenta, pagina=primera.siguiente_pagina, limite=2)
        assert segunda.siguiente_pagina == cursor("20261001T110001Z", *"xyzwu")
        tercera = leer(cuenta, pagina=segunda.siguiente_pagina, limite=2)
        assert [m.id_mensaje for m in primera.mensajes + segunda.mensajes + tercera.mensajes] == list("xyzwuq")

    def test_un_cursor_que_no_avanza_es_un_error(self, claves, graph):
        """Graph dice que hay más y solo entrega lo ya visto: seguir sería un
        bucle, y terminar sería perder lo que falta."""
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1"), siguiente=SIGUIENTE))
        with pytest.raises(ErrorDelProveedor) as error:
            leer(cuenta, pagina=cursor("20261001T110001Z", "a1"))
        assert error.value.codigo == "pagina_sin_avance"

    @pytest.mark.parametrize("respuesta", [
        lista(siguiente=SIGUIENTE),
        lista(mensaje_graph("sin-fecha", recibido=None), siguiente=SIGUIENTE),
    ], ids=["vacia", "sin-fecha"])
    def test_hay_mas_pero_nada_con_fecha_es_un_error(self, claves, graph, respuesta):
        cuenta = outlook()
        graph.responde(respuesta)
        with pytest.raises(ErrorDelProveedor) as error:
            leer(cuenta)
        assert error.value.codigo == "pagina_sin_avance"

    def test_en_un_mismo_segundo_caben_hasta_maximo_vistos(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(*(mensaje_graph(f"m{i}") for i in range(MAXIMO_VISTOS)), siguiente=SIGUIENTE))
        assert leer(cuenta, limite=100).siguiente_pagina.count(",") == MAXIMO_VISTOS - 1

        graph.responde(lista(*(mensaje_graph(f"m{i}") for i in range(MAXIMO_VISTOS + 1)), siguiente=SIGUIENTE))
        with pytest.raises(ErrorDelProveedor) as error:
            leer(cuenta, limite=100)
        assert error.value.codigo == "demasiados_en_un_segundo"

    def test_con_vistos_el_top_no_pasa_del_maximo(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista())
        leer(cuenta, pagina=cursor("20261001T110001Z", "a", "b", "c"), limite=100)
        assert graph.peticiones[0]["params"]["$top"] == 100

    def test_una_next_link_ajena_nunca_se_pide(self, claves, graph):
        """La `nextLink` no se sigue: el token va siempre a la lista."""
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("a1"), siguiente="https://otro.sitio/v1.0/me/messages?$skip=1"), lista())
        primera = leer(cuenta)
        leer(cuenta, pagina=primera.siguiente_pagina)
        assert [p["url"] for p in graph.peticiones] == [URL_MENSAJES, URL_MENSAJES]
        assert all(p["allow_redirects"] is False for p in graph.peticiones)

    @pytest.mark.parametrize("pagina", [
        # Las que Graph armaría, y las que llevarían el token a otro lado:
        # ninguna se pide, porque ninguna es un cursor de este lector.
        SIGUIENTE,
        "https://otro.sitio/v1.0/me/messages?$skip=10",
        "https://graph.microsoft.com.otro.sitio/v1.0/me/messages",
        "https://graph.microsoft.com@otro.sitio/v1.0/me/messages",
        "//graph.microsoft.com/v1.0/me/messages",
        # Cursores mal formados.
        "antes-de=2026-10-01T11:00:01Z",
        "antes-de=20261399T110001Z",
        "antes-de=20261001T110001Z&vistos=",
        "antes-de=20261001T110001Z&vistos=ABCDEF0123456789",
        "antes-de=20261001T110001Z&vistos=abc",
        f"antes-de=20261001T110001Z&vistos={huella('a')},{huella('a')}",
        "antes-de=20261001T110001Z&vistos=" + ",".join(huella(f"m{i}") for i in range(MAXIMO_VISTOS + 1)),
        " antes-de=20261001T110001Z",
        "antes-de=20261001T110001Z\n",
        "antes-de=\u0662\u0660\u0662\u0666\u0661\u0660\u0660\u0661T110001Z",
        "", 123,
    ])
    def test_una_pagina_que_no_armo_este_lector_no_recibe_el_token(self, claves, graph, pagina):
        cuenta = outlook()
        with pytest.raises(ValueError):
            leer(cuenta, pagina=pagina)
        assert graph.peticiones == []

    def test_un_cursor_de_otra_ventana_no_se_usa(self, claves, graph):
        cuenta = outlook()
        with pytest.raises(ValueError, match="otra ventana"):
            leer(cuenta, filtro=FiltroCorreos(desde=datetime(2026, 10, 1, 11, 0, 1, tzinfo=tz.utc)), pagina=CURSOR)
        assert graph.peticiones == []

    def test_un_cursor_mas_alla_del_hasta_no_amplia_la_ventana(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista())
        leer(cuenta, filtro=FiltroCorreos(hasta=datetime(2026, 10, 1, tzinfo=tz.utc)), pagina=CURSOR)
        assert graph.peticiones[0]["params"]["$filter"] == "receivedDateTime lt 2026-10-01T00:00:00Z"

    def test_si_graph_devuelve_mas_de_lo_pedido_no_se_recorta(self, claves, graph):
        """Recortar perdería los que sobran sin aviso: es un error explícito."""
        cuenta = outlook()
        graph.responde(lista(*(mensaje_graph(f"m{i}") for i in range(8))))
        with pytest.raises(ErrorDelProveedor, match="se pidieron 3"):
            leer(cuenta, limite=3)

    def test_con_vistos_tampoco_se_recorta(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(*(mensaje_graph(f"m{i}", recibido="2026-10-01T10:00:00Z") for i in range(5))))
        with pytest.raises(ErrorDelProveedor, match="se pidieron 4"):
            leer(cuenta, pagina=cursor("20261001T110001Z", "a1"), limite=3)

    # ── Revisión de #177: seguir una página con otro límite ───────────────

    def test_seguir_una_pagina_con_otro_limite_no_pierde_ninguno(self, claves, graph):
        """El caso de Maxi: antes el tamaño de la página seguida lo fijaba su
        `$top` y se recortaba a `limite`. Ahora el cursor no trae tamaño: se
        piden `limite` más los vistos y se devuelve todo lo que llega."""
        cuenta = outlook()
        horas = [f"2026-10-01T{h:02}:30:00Z" for h in range(23, -1, -1)]
        primera_tanda = [mensaje_graph(f"m{i}", recibido=horas[i]) for i in range(24)]
        graph.responde(lista(*primera_tanda[:20], siguiente=SIGUIENTE),
                       lista(primera_tanda[19], *primera_tanda[20:24], siguiente=SIGUIENTE))
        primera = leer(cuenta, limite=20)
        segunda = leer(cuenta, pagina=primera.siguiente_pagina, limite=5)
        assert graph.peticiones[1]["params"]["$top"] == 6
        assert [m.id_mensaje for m in primera.mensajes + segunda.mensajes] == [f"m{i}" for i in range(24)]
        assert segunda.siguiente_pagina == cursor("20261001T003001Z", "m23")

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
        error = self._falla(graph, _Respuesta(400, error_graph("InefficientFilter")), ErrorDelProveedor,
                            "error_del_proveedor")
        assert not isinstance(error, CursorRechazado)  # no se seguía ninguna página

    @pytest.mark.parametrize("estado, codigo_graph", [(400, "ErrorInvalidRequest"), (410, "SyncStateNotFound")])
    def test_con_cursor_un_400_o_410_no_es_un_cursor_rechazado(self, claves, graph, estado, codigo_graph):
        """El cursor lo arma este lector y Graph no lo conoce: no tiene cómo
        vencer. Cuando la página siguiente era la `@odata.nextLink`, esto era
        un `CursorRechazado` (revisión de #189, ronda 3)."""
        cuenta = outlook()
        graph.responde(_Respuesta(estado, error_graph(codigo_graph)))
        with pytest.raises(ErrorDelProveedor) as error:
            leer(cuenta, pagina=CURSOR)
        assert not isinstance(error.value, CursorRechazado)
        assert error.value.codigo == "error_del_proveedor"
        assert TOKEN not in str(error.value)

    @pytest.mark.parametrize("respuesta", [
        _Respuesta(200, ValueError("no es JSON")),
        _Respuesta(200, ["una", "lista"]),
        _Respuesta(200, {"value": "no es una lista"}),
        _Respuesta(404, error_graph("ErrorItemNotFound")),
        _Respuesta(404, error_graph("MailboxNotEnabledForRESTAPI")),
    ], ids=["no-es-json", "no-es-objeto", "value-no-es-lista", "404", "sin-buzon"])
    def test_otro_error_en_la_pagina_siguiente_no_es_un_cursor_rechazado(self, claves, graph, respuesta):
        cuenta = outlook()
        graph.responde(respuesta)
        with pytest.raises(ErrorDelProveedor) as error:
            leer(cuenta, pagina=CURSOR)
        assert not isinstance(error.value, CursorRechazado)

    def test_un_410_en_la_primera_pagina_no_es_un_cursor_rechazado(self, claves, graph):
        error = self._falla(graph, _Respuesta(410, error_graph("Gone")), ErrorDelProveedor, "error_del_proveedor")
        assert not isinstance(error, CursorRechazado)

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
            leer(cuenta, pagina=CURSOR)


# ══════════════════════════════════════════════════════════════════════
# Filtros: las fechas van en $filter; palabras y remitentes, de este lado
# ══════════════════════════════════════════════════════════════════════
#
# Sin `$search`: entrega 1000 resultados como mucho y ordena por fecha de
# envío, así que no sirve para saber que se leyó una ventana entera
# (revisión de #189). La prueba con más de 1000 coincidencias está en
# `test_avance_lectura_s3_fe_03_05.py`.


#: Un remitente que no dice nada de cobros, ni en el nombre ni en la dirección.
NEUTRO = ("Avisos", "avisos@servicio.cl")


class TestFiltros:
    def test_por_omision_no_busca_con_search_y_ordena_por_recepcion(self, claves, graph):
        cuenta = outlook()
        leer(cuenta)
        params = graph.peticiones[0]["params"]
        assert "$search" not in params
        assert params["$orderby"] == "receivedDateTime desc"
        assert "$filter" not in params  # sin fechas no hay qué filtrar

    def test_las_fechas_van_en_filter_y_ordenado(self, claves, graph):
        cuenta = outlook()
        desde = datetime(2026, 10, 1, 3, 0, tzinfo=tz.utc)
        hasta = datetime(2026, 11, 1, tzinfo=tz(timedelta(hours=-3)))
        leer(cuenta, filtro=FiltroCorreos(desde=desde, hasta=hasta))
        params = graph.peticiones[0]["params"]
        assert params["$filter"] == "receivedDateTime ge 2026-10-01T03:00:00Z and receivedDateTime lt 2026-11-01T03:00:00Z"
        assert params["$orderby"] == "receivedDateTime desc"
        assert "$search" not in params

    def test_lo_que_no_es_un_cobro_se_descarta_de_este_lado_y_no_es_un_omitido(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(
            mensaje_graph("hola", asunto="Hola", texto="¿Nos vemos el viernes?", remitente=("Ana", "ana@correo.cl")),
            mensaje_graph("en-el-cuerpo", asunto="Aviso", texto="Tu FACTURA del mes", remitente=NEUTRO),
            mensaje_graph("acento-aparte", asunto="Aviso", texto="Tu SUSCRIPCIO\u0301N se renovó", remitente=NEUTRO),
            mensaje_graph("en-el-nombre", asunto="Aviso", texto="", remitente=("Cobros Netflix", "x@netflix.com")),
            mensaje_graph("en-la-direccion", asunto="Aviso", texto="", remitente=("Netflix", "billing@netflix.com")),
            mensaje_graph("sin-fecha-y-no-es-cobro", asunto="Hola", texto="", recibido=None,
                          remitente=("Ana", "ana@correo.cl")),
            mensaje_graph("sin-fecha-y-es-cobro", recibido=None),
            siguiente=SIGUIENTE,
        ))
        pagina = leer(cuenta)
        assert [m.id_mensaje for m in pagina.mensajes] == [
            "en-el-cuerpo", "acento-aparte", "en-el-nombre", "en-la-direccion",
        ]
        # Solo el cobro que no se pudo armar se informa; el que no era un
        # cobro no le importa a nadie.
        assert [o.id_mensaje for o in pagina.omitidos] == ["sin-fecha-y-es-cobro"]
        # Los que no son cobros también cuentan para el cursor: ya se vieron.
        assert pagina.siguiente_pagina == cursor(
            "20261001T110001Z", "hola", "en-el-cuerpo", "acento-aparte", "en-el-nombre", "en-la-direccion",
        )

    @pytest.mark.parametrize("cuerpo", [
        "<p>Tu suscripci&oacute;n se renov&oacute; el 16/11. Total: $5.990</p>",
        "<p>Renovaci&#243;n de tu plan. Total: $5.990</p>",
        "<p>Renovaci&#xF3;n de tu plan. Total: $5.990</p>",
    ], ids=["entidad-con-nombre", "entidad-numerica", "entidad-hexadecimal"])
    def test_un_cuerpo_html_con_el_acento_escrito_como_entidad_es_un_cobro(self, claves, graph, cuerpo):
        """Revisión de #189, ronda 3 (P3): el filtro miraba el HTML crudo, y
        `suscripci&oacute;n` no contiene `suscripción`. El mensaje se perdía
        sin quedar ni entre los omitidos."""
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("html", asunto="Novedades de tu cuenta Premium", texto=cuerpo,
                                           tipo="html", remitente=NEUTRO)))
        pagina = leer(cuenta)
        assert [m.id_mensaje for m in pagina.mensajes] == ["html"]

    def test_en_un_cuerpo_html_tambien_cuenta_lo_que_no_se_ve(self, claves, graph):
        """Se busca en el crudo y en el texto: una palabra que solo está en el
        HTML (un enlace, un `alt`) también deja pasar el mensaje."""
        cuenta = outlook()
        cuerpo = '<p>Hola</p><a href="https://cuenta.servicio.cl/billing">Ver detalle</a>'
        graph.responde(lista(mensaje_graph("enlace", asunto="Novedades", texto=cuerpo, tipo="html", remitente=NEUTRO)))
        assert [m.id_mensaje for m in leer(cuenta).mensajes] == ["enlace"]

    def test_una_pagina_sin_cobros_sigue_teniendo_pagina_siguiente(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("hola", asunto="Hola", texto="", remitente=("Ana", "a@b.cl")),
                             siguiente=SIGUIENTE))
        pagina = leer(cuenta)
        assert (pagina.mensajes, pagina.siguiente_pagina) == ((), cursor("20261001T110001Z", "hola"))

    def test_sin_solo_cobros_pasa_todo(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(mensaje_graph("hola", asunto="Hola", texto="", remitente=("Ana", "a@b.cl"))))
        assert [m.id_mensaje for m in leer(cuenta, filtro=FiltroCorreos(solo_cobros=False)).mensajes] == ["hola"]

    def test_remitentes_por_direccion_o_por_dominio(self, claves, graph):
        cuenta = outlook()
        graph.responde(lista(
            mensaje_graph("dominio", remitente=("Netflix", "info@netflix.com")),
            mensaje_graph("subdominio", remitente=("Netflix", "Info@Account.Netflix.com")),
            mensaje_graph("direccion", remitente=("Spotify", "a@b.cl")),
            mensaje_graph("parecido", remitente=("Falso", "info@notnetflix.com")),
            mensaje_graph("otro", remitente=("Microsoft", "billing@microsoft.com")),
        ))
        filtro = FiltroCorreos(remitentes=("netflix.com", "a@b.cl"))
        assert [m.id_mensaje for m in leer(cuenta, filtro=filtro).mensajes] == ["dominio", "subdominio", "direccion"]

    @pytest.mark.parametrize("remitente", ['a" OR "x', "a) OR (b", "-netflix.com"])
    def test_un_remitente_que_no_es_direccion_ni_dominio(self, claves, graph, remitente):
        cuenta = outlook()
        with pytest.raises(ValueError):
            leer(cuenta, filtro=FiltroCorreos(remitentes=(remitente,)))
        assert graph.peticiones == []

    def test_si_graph_entrega_algo_fuera_de_las_fechas_no_pasa(self, claves, graph):
        """Graph filtra al segundo; aquí se aplica la hora exacta, y lo que
        quede fuera no es un omitido."""
        cuenta = outlook()
        graph.responde(lista(
            mensaje_graph("antes", recibido="2026-09-30T23:59:59Z"),
            mensaje_graph("dentro", recibido="2026-10-15T10:00:00Z"),
            mensaje_graph("justo-hasta", recibido="2026-11-01T00:00:00Z"),
        ))
        filtro = FiltroCorreos(desde=datetime(2026, 10, 1, tzinfo=tz.utc), hasta=datetime(2026, 11, 1, tzinfo=tz.utc))
        pagina = leer(cuenta, filtro=filtro)
        assert [m.id_mensaje for m in pagina.mensajes] == ["dentro"]
        assert pagina.omitidos == ()

    def test_el_filtro_de_fechas_valida_por_su_cuenta(self):
        with pytest.raises(ValueError):
            filtro_fechas_outlook(FiltroCorreos(remitentes=('a" OR "x',)))

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
        graph.responde(lista("no", {"id": None, "subject": "Tu recibo"},
                             {"id": "x" * 600, "receivedDateTime": "2026-10-01T00:00:00Z", "subject": "Tu recibo"},
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
        assert "a1" in salida.getvalue() and cursor("20261001T110001Z", "a1") in salida.getvalue()
        assert "cuerpo-privado" not in salida.getvalue()

    def test_no_lee_una_cuenta_de_gmail(self, claves, graph):
        from django.core.management import call_command
        from django.core.management.base import CommandError

        gmail = outlook(proveedor="gmail", correo="p@gmail.com")
        with pytest.raises(CommandError, match="cuenta_no_encontrada"):
            call_command("leer_outlook", "--organizacion", str(ORG_A), "--cuenta", str(gmail.pk))
        assert graph.peticiones == []
