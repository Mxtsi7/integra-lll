"""S3-FE-02 — consultar los mensajes de una cuenta de Gmail autorizada.

Criterios de la tarjeta:
- se leen los mensajes permitidos de una cuenta;
- una cuenta ajena o desconectada queda excluida.

Estas pruebas usan el `lector_gmail` REAL y reemplazan solo `requests.get` por
lo que respondería Google.

── De dónde salen las respuestas de Google ─────────────────────────────────
- Los errores 401 son **copia literal** de lo que respondió
  `gmail.googleapis.com` el 13-11-2026 a un token inventado y a una petición
  sin token.
- Las respuestas 200 (`messages.list` y `messages.get?format=full`) y los
  demás errores siguen la referencia publicada de la API de Gmail. Se
  contrastan con la cuenta de prueba real; ver el documento 23.
"""

import base64
import uuid
from datetime import datetime, timedelta, timezone as tz

import pytest
import requests
from django.utils import timezone

from connectors import lector_gmail
from connectors.lector_gmail import (
    LARGO_MAXIMO_TEXTO,
    LIMITE_MAXIMO,
    URL_MENSAJES,
    AutorizacionRechazada,
    CuentaNoDisponible,
    ErrorDelProveedor,
    ErrorTransitorio,
    FiltroCorreos,
    leer_mensajes,
)
from connectors.models import CuentaConectada

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
TOKEN = "ya29.token-de-prueba-que-no-debe-salir"


# ══════════════════════════════════════════════════════════════════════
# Google falso
# ══════════════════════════════════════════════════════════════════════


class _Respuesta:
    def __init__(self, status_code, cuerpo=None):
        self.status_code = status_code
        self._cuerpo = cuerpo

    def json(self):
        if isinstance(self._cuerpo, Exception):
            raise self._cuerpo
        if self._cuerpo is None:
            raise ValueError("no es JSON")
        return self._cuerpo


# Copia literal de gmail.googleapis.com (13-11-2026), token inventado.
ERROR_401 = {
    "error": {
        "code": 401,
        "message": (
            "Request had invalid authentication credentials. Expected OAuth 2 access token, "
            "login cookie or other valid authentication credential. See "
            "https://developers.google.com/identity/sign-in/web/devconsole-project."
        ),
        "errors": [{
            "message": "Invalid Credentials", "domain": "global", "reason": "authError",
            "location": "Authorization", "locationType": "header",
        }],
        "status": "UNAUTHENTICATED",
    }
}


def error_google(codigo, razon, estado, mensaje="..."):
    return {"error": {"code": codigo, "message": mensaje,
                      "errors": [{"message": mensaje, "domain": "global", "reason": razon}],
                      "status": estado}}


def b64(texto, juego="utf-8"):
    return base64.urlsafe_b64encode(texto.encode(juego)).decode().rstrip("=")


def parte(tipo, texto, *, juego="UTF-8", nombre=""):
    return {
        "partId": "0", "mimeType": tipo, "filename": nombre,
        "headers": [{"name": "Content-Type", "value": f'{tipo}; charset="{juego}"'}],
        "body": {"size": len(texto), "data": b64(texto, juego)},
    }


def mensaje_gmail(id_mensaje, *, asunto="Tu recibo de Netflix", remitente="Netflix <info@account.netflix.com>",
                  milisegundos="1727780400000", partes=None):
    """Lo que devuelve `messages.get?format=full` con `fields=id,threadId,internalDate,payload`."""
    return {
        "id": id_mensaje,
        "threadId": id_mensaje,
        "internalDate": milisegundos,
        "payload": {
            "partId": "", "mimeType": "multipart/alternative", "filename": "",
            "headers": [
                {"name": "From", "value": remitente},
                {"name": "Subject", "value": asunto},
                {"name": "Date", "value": "Tue, 1 Oct 2024 08:00:00 -0300"},
            ],
            "body": {"size": 0},
            "parts": partes if partes is not None else [
                parte("text/plain", "Cobro mensual: $9.990 CLP"),
                # El HTML dice algo más que el texto plano, para que se note
                # cuál de los dos se usó.
                parte("text/html", "<p>Cobro mensual: <b>$9.990</b> CLP</p><p>Ver en el navegador</p>"),
            ],
        },
    }


class GoogleFalso:
    """Responde según la URL. Guarda cada petición para revisarla."""

    def __init__(self, monkeypatch):
        self.peticiones = []
        self.lista = {"messages": [], "nextPageToken": None}
        self.mensajes = {}
        monkeypatch.setattr(lector_gmail.requests, "get", self.get)

    def get(self, url, params=None, headers=None, timeout=None):
        self.peticiones.append({"url": url, "params": dict(params or {}), "headers": dict(headers or {}),
                                "timeout": timeout})
        respuesta = self.lista if url == URL_MENSAJES else self.mensajes[url.rsplit("/", 1)[1]]
        if isinstance(respuesta, Exception):
            raise respuesta
        if isinstance(respuesta, _Respuesta):
            return respuesta
        return _Respuesta(200, {k: v for k, v in respuesta.items() if v is not None})

    def con_mensajes(self, *mensajes, siguiente=None):
        self.lista = {"messages": [{"id": m["id"], "threadId": m["threadId"]} for m in mensajes],
                      "nextPageToken": siguiente}
        self.mensajes.update({m["id"]: m for m in mensajes})
        return self


@pytest.fixture
def google(monkeypatch):
    return GoogleFalso(monkeypatch)


def gmail(*, org=ORG_A, correo="prueba@gmail.com", estado="conectada", access=TOKEN, vence_en=timedelta(minutes=50),
          proveedor="gmail"):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=correo, estado=estado,
        access_token=access, refresh_token="1//refresco",
        token_expira_en=None if vence_en is None else timezone.now() + vence_en,
    )


def leer(cuenta, org=ORG_A, **extra):
    return leer_mensajes(organizacion_id=org, cuenta_id=cuenta.pk, **extra)


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — se leen los mensajes permitidos
# ══════════════════════════════════════════════════════════════════════


class TestLeeLaCuentaAutorizada:
    def test_devuelve_los_mensajes_con_su_contenido(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("18c2f0a1b2c3d4e5"), mensaje_gmail("18c2f0a1b2c3d4e6", asunto="Recibo Spotify"),
                            siguiente="09876543210")

        pagina = leer(cuenta)

        assert [m.id_mensaje for m in pagina.mensajes] == ["18c2f0a1b2c3d4e5", "18c2f0a1b2c3d4e6"]
        primero = pagina.mensajes[0]
        assert primero.cuenta_id == cuenta.pk
        assert primero.id_hilo == "18c2f0a1b2c3d4e5"
        assert primero.remitente == "Netflix <info@account.netflix.com>"
        assert primero.asunto == "Tu recibo de Netflix"
        assert primero.recibido_en == datetime(2024, 10, 1, 11, 0, tzinfo=tz.utc)
        # Con texto plano disponible se usa ese y no el HTML.
        assert primero.texto == "Cobro mensual: $9.990 CLP"
        assert pagina.siguiente_pagina == "09876543210"
        assert pagina.omitidos == ()

    def test_usa_el_token_de_esa_cuenta_y_un_tiempo_limite(self, claves, google):
        gmail(correo="otra@gmail.com", access="ya29.de-la-otra")
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("a1"))

        leer(cuenta)

        assert {p["headers"]["Authorization"] for p in google.peticiones} == {f"Bearer {TOKEN}"}
        assert all(p["timeout"] for p in google.peticiones)

    def test_pide_solo_los_campos_que_usa(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("a1"))

        leer(cuenta)

        lista, detalle = google.peticiones
        assert lista["params"]["fields"] == "messages(id,threadId),nextPageToken"
        assert detalle["url"] == f"{URL_MENSAJES}/a1"
        assert detalle["params"] == {"format": "full", "fields": "id,threadId,internalDate,payload"}

    def test_por_omision_busca_solo_los_que_parecen_cobros(self, claves, google):
        cuenta = gmail()
        leer(cuenta)
        consulta = google.peticiones[0]["params"]["q"]
        assert consulta.startswith("{") and consulta.endswith("}")
        for palabra in ("recibo", "factura", "receipt", "invoice", "suscripción"):
            assert palabra in consulta.split("{")[1]

    def test_una_lista_vacia_es_una_pagina_vacia(self, claves, google):
        cuenta = gmail()
        google.lista = {}  # Gmail omite `messages` cuando no hay ninguno.
        pagina = leer(cuenta)
        assert pagina.mensajes == () and pagina.siguiente_pagina is None
        assert len(google.peticiones) == 1

    def test_no_guarda_nada_ni_cambia_la_cuenta(self, claves, google):
        cuenta = gmail()
        antes = CuentaConectada.objects.values().get(pk=cuenta.pk)
        google.con_mensajes(mensaje_gmail("a1"))
        leer(cuenta)
        assert CuentaConectada.objects.values().get(pk=cuenta.pk) == antes


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — una cuenta ajena o desconectada queda excluida
# ══════════════════════════════════════════════════════════════════════


class TestExcluyeLoQueNoEstaAutorizado:
    """En todos estos casos NO se habla con Google: ni una petición."""

    def _rechaza(self, google, cuenta_id, codigo, org=ORG_A):
        with pytest.raises(CuentaNoDisponible) as error:
            leer_mensajes(organizacion_id=org, cuenta_id=cuenta_id)
        assert error.value.codigo == codigo
        assert google.peticiones == []
        return error.value

    def test_la_cuenta_de_otra_organizacion_no_existe_para_esta(self, claves, google):
        ajena = gmail(org=ORG_B)
        self._rechaza(google, ajena.pk, CuentaNoDisponible.NO_ENCONTRADA)

    def test_ajena_e_inexistente_responden_lo_mismo(self, claves, google):
        ajena = gmail(org=ORG_B)
        por_ajena = self._rechaza(google, ajena.pk, CuentaNoDisponible.NO_ENCONTRADA)
        por_inexistente = self._rechaza(google, uuid.uuid4(), CuentaNoDisponible.NO_ENCONTRADA)
        assert str(por_ajena) == str(por_inexistente)

    @pytest.mark.parametrize("identificador", ["no-es-un-uuid", "", None])
    def test_un_identificador_mal_formado_tampoco_es_una_cuenta(self, claves, google, identificador):
        gmail()
        self._rechaza(google, identificador, CuentaNoDisponible.NO_ENCONTRADA)

    def test_una_organizacion_mal_formada_tampoco(self, claves, google):
        cuenta = gmail()
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.NO_ENCONTRADA, org="no-es-un-uuid")

    def test_desconectada_aunque_conserve_el_token_cifrado(self, claves, google):
        """Una desconexión sin revocación confirmada CONSERVA el token para
        reintentar la revocación (FE-05). Eso no la vuelve legible."""
        cuenta = gmail(estado="desconectada")
        assert cuenta.access_token == TOKEN
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.DESCONECTADA)

    def test_desconectada_con_token_ilegible_dice_desconectada(self, claves, google):
        """Desconectada manda sobre "vuelve a autorizar": pedirle al usuario
        que reautorice una cuenta que él mismo desconectó sería un error."""
        from shared.cifrado.cifrador import generar_clave

        cuenta = gmail(estado="desconectada")
        claves(generar_clave())
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.DESCONECTADA)

    def test_un_estado_que_no_se_conoce_no_se_lee(self, claves, google):
        cuenta = gmail()
        CuentaConectada.objects.filter(pk=cuenta.pk).update(estado="pausada")
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.ESTADO_NO_LEGIBLE)

    @pytest.mark.parametrize("estado", ["requiere_reautorizacion", "error"])
    def test_que_pide_reautorizar(self, claves, google, estado):
        cuenta = gmail(estado=estado)
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.REQUIERE_REAUTORIZACION)

    def test_token_que_ya_no_descifra(self, claves, google):
        from shared.cifrado.cifrador import generar_clave

        cuenta = gmail()
        claves(generar_clave())  # la clave con que se cifró ya no está
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.REQUIERE_REAUTORIZACION)

    def test_cuenta_de_otro_proveedor(self, claves, google):
        outlook = gmail(proveedor="outlook", correo="p@outlook.com")
        self._rechaza(google, outlook.pk, CuentaNoDisponible.NO_ENCONTRADA)

    def test_sin_token_de_acceso(self, claves, google):
        cuenta = gmail(access=None)
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.SIN_CREDENCIALES)

    @pytest.mark.parametrize("vence_en", [timedelta(minutes=-5), timedelta(seconds=10)])
    def test_token_vencido_o_por_vencer(self, claves, google, vence_en):
        cuenta = gmail(vence_en=vence_en)
        self._rechaza(google, cuenta.pk, CuentaNoDisponible.CREDENCIAL_VENCIDA)

    def test_sin_fecha_de_vencimiento_se_intenta(self, claves, google):
        cuenta = gmail(vence_en=None)
        leer(cuenta)
        assert len(google.peticiones) == 1


# ══════════════════════════════════════════════════════════════════════
# Paginación y límites
# ══════════════════════════════════════════════════════════════════════


class TestPaginacionYLimites:
    def test_la_pagina_pedida_va_a_gmail(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("b1"))
        pagina = leer(cuenta, pagina="09876543210", limite=10)
        assert google.peticiones[0]["params"]["pageToken"] == "09876543210"
        assert google.peticiones[0]["params"]["maxResults"] == 10
        assert pagina.siguiente_pagina is None  # Gmail no mandó otra: era la última

    def test_no_trae_mas_mensajes_que_el_limite(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(*(mensaje_gmail(f"m{i}") for i in range(5)))
        pagina = leer(cuenta, limite=3)
        assert len(pagina.mensajes) == 3
        assert len(google.peticiones) == 1 + 3

    @pytest.mark.parametrize("limite", [0, -1, LIMITE_MAXIMO + 1, True, "5", 2.5])
    def test_limite_fuera_de_rango_no_llega_a_google(self, claves, google, limite):
        cuenta = gmail()
        with pytest.raises(ValueError):
            leer(cuenta, limite=limite)
        assert google.peticiones == []

    @pytest.mark.parametrize("pagina", ["", "x" * 513, 123])
    def test_pagina_que_no_viene_de_gmail(self, claves, google, pagina):
        cuenta = gmail()
        with pytest.raises(ValueError):
            leer(cuenta, pagina=pagina)
        assert google.peticiones == []

    def test_la_validacion_va_antes_que_la_cuenta(self, claves, google):
        """Un límite inválido se informa aunque la cuenta tampoco sirva: no
        hace falta mirar la base para rechazar un argumento mal armado."""
        with pytest.raises(ValueError):
            leer_mensajes(organizacion_id=ORG_A, cuenta_id=999, limite=0)


# ══════════════════════════════════════════════════════════════════════
# Filtros
# ══════════════════════════════════════════════════════════════════════


class TestFiltros:
    def test_fechas_en_segundos_epoch(self):
        desde = datetime(2026, 10, 1, tzinfo=tz.utc)
        hasta = datetime(2026, 11, 1, tzinfo=tz.utc)
        consulta = FiltroCorreos(desde=desde, hasta=hasta, solo_cobros=False).consulta()
        assert consulta == f"after:{int(desde.timestamp())} before:{int(hasta.timestamp())}"

    def test_fecha_sin_zona_horaria(self):
        with pytest.raises(ValueError, match="zona horaria"):
            FiltroCorreos(desde=datetime(2026, 10, 1)).consulta()

    def test_desde_posterior_a_hasta(self):
        d = datetime(2026, 10, 1, tzinfo=tz.utc)
        with pytest.raises(ValueError):
            FiltroCorreos(desde=d, hasta=d).consulta()

    def test_remitentes(self):
        consulta = FiltroCorreos(remitentes=("netflix.com", "billing@spotify.com"), solo_cobros=False).consulta()
        assert consulta == "from:(netflix.com OR billing@spotify.com)"

    @pytest.mark.parametrize("remitente", [
        "a) OR in:anywhere", "-netflix.com", "OR", "netflix", "x@y", 'a"b@x.com', "{a b}", "", None,
    ])
    def test_un_remitente_que_cambiaria_la_busqueda_se_rechaza(self, remitente):
        with pytest.raises(ValueError):
            FiltroCorreos(remitentes=(remitente,)).consulta()

    def test_un_filtro_invalido_no_llega_a_google(self, claves, google):
        cuenta = gmail()
        with pytest.raises(ValueError):
            leer(cuenta, filtro=FiltroCorreos(remitentes=("a) OR in:anywhere",)))
        assert google.peticiones == []

    def test_sin_ningun_filtro_no_se_manda_q(self, claves, google):
        cuenta = gmail()
        leer(cuenta, filtro=FiltroCorreos(solo_cobros=False))
        assert "q" not in google.peticiones[0]["params"]


# ══════════════════════════════════════════════════════════════════════
# Lo que responde Google cuando no es 200
# ══════════════════════════════════════════════════════════════════════


class TestErroresDeGoogle:
    def _falla(self, google, respuesta, excepcion, codigo=None):
        cuenta = gmail()
        google.lista = respuesta
        with pytest.raises(excepcion) as error:
            leer(cuenta)
        if codigo:
            assert error.value.codigo == codigo
        assert TOKEN not in str(error.value) and TOKEN not in repr(error.value)
        return cuenta

    def test_401_es_autorizacion_rechazada(self, claves, google):
        self._falla(google, _Respuesta(401, ERROR_401), AutorizacionRechazada, "autorizacion_rechazada")

    def test_401_no_marca_la_cuenta(self, claves, google):
        """Decidir si se renueva o se pide reconexión es de S3-FE-19."""
        cuenta = self._falla(google, _Respuesta(401, ERROR_401), AutorizacionRechazada)
        cuenta.refresh_from_db()
        assert cuenta.estado == "conectada"

    def test_403_sin_permiso_suficiente(self, claves, google):
        self._falla(google, _Respuesta(403, error_google(403, "insufficientPermissions", "PERMISSION_DENIED")),
                    AutorizacionRechazada, "permiso_insuficiente")

    def test_403_api_sin_habilitar(self, claves, google):
        self._falla(google, _Respuesta(403, error_google(403, "accessNotConfigured", "PERMISSION_DENIED")),
                    ErrorDelProveedor, "api_deshabilitada")

    @pytest.mark.parametrize("respuesta", [
        _Respuesta(403, error_google(403, "rateLimitExceeded", "PERMISSION_DENIED")),
        _Respuesta(403, error_google(403, "userRateLimitExceeded", "PERMISSION_DENIED")),
        _Respuesta(429, error_google(429, "rateLimitExceeded", "RESOURCE_EXHAUSTED")),
    ])
    def test_cuota_es_transitorio(self, claves, google, respuesta):
        self._falla(google, respuesta, ErrorTransitorio, "cuota_excedida")

    @pytest.mark.parametrize("estado", [500, 502, 503])
    def test_falla_de_google_es_transitoria(self, claves, google, estado):
        self._falla(google, _Respuesta(estado, ValueError("html")), ErrorTransitorio, "falla_del_proveedor")

    @pytest.mark.parametrize("excepcion, codigo", [
        (requests.Timeout(f"read timeout url=?access_token={TOKEN}"), "tiempo_agotado"),
        (requests.ConnectionError(f"fallo con Bearer {TOKEN}"), "sin_conexion"),
    ])
    def test_red_es_transitoria_y_no_arrastra_el_mensaje(self, claves, google, excepcion, codigo):
        cuenta = gmail()
        google.lista = excepcion
        with pytest.raises(ErrorTransitorio) as error:
            leer(cuenta)
        assert error.value.codigo == codigo
        assert TOKEN not in str(error.value)
        assert error.value.__cause__ is None and error.value.__suppress_context__

    def test_pagina_invalida_es_permanente(self, claves, google):
        self._falla(google, _Respuesta(400, error_google(400, "invalidArgument", "INVALID_ARGUMENT", "Invalid pageToken")),
                    ErrorDelProveedor)

    def test_404_en_la_lista_no_se_confunde_con_un_mensaje_borrado(self, claves, google):
        self._falla(google, _Respuesta(404, error_google(404, "notFound", "NOT_FOUND")), ErrorDelProveedor)

    @pytest.mark.parametrize("cuerpo", [ValueError("no es JSON"), ["una", "lista"]])
    def test_200_que_no_es_un_objeto(self, claves, google, cuerpo):
        self._falla(google, _Respuesta(200, cuerpo), ErrorDelProveedor)

    def test_un_401_a_mitad_de_pagina_no_entrega_resultados_parciales(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("a1"), mensaje_gmail("a2"))
        google.mensajes["a2"] = _Respuesta(401, ERROR_401)
        with pytest.raises(AutorizacionRechazada):
            leer(cuenta)


class TestMensajesQueNoSePuedenTraer:
    def test_un_mensaje_borrado_se_informa_y_se_sigue(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("a1"), mensaje_gmail("a2"), mensaje_gmail("a3"))
        google.mensajes["a2"] = _Respuesta(404, error_google(404, "notFound", "NOT_FOUND"))

        pagina = leer(cuenta)

        assert [m.id_mensaje for m in pagina.mensajes] == ["a1", "a3"]
        assert [(o.id_mensaje, o.motivo) for o in pagina.omitidos] == [("a2", "el mensaje ya no existe")]

    def test_un_mensaje_sin_fecha_se_informa(self, claves, google):
        cuenta = gmail()
        malo = mensaje_gmail("a1")
        del malo["internalDate"]
        google.con_mensajes(malo, mensaje_gmail("a2"))
        pagina = leer(cuenta)
        assert [m.id_mensaje for m in pagina.mensajes] == ["a2"]
        assert pagina.omitidos[0].id_mensaje == "a1"

    def test_un_identificador_raro_no_se_pide(self, claves, google):
        cuenta = gmail()
        google.lista = {"messages": [{"id": "../../otra-cosa"}, {"id": None}]}
        pagina = leer(cuenta)
        assert pagina.mensajes == ()
        assert len(pagina.omitidos) == 2
        assert len(google.peticiones) == 1

    def test_si_gmail_devuelve_otro_mensaje_no_se_acepta(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("a1"))
        google.mensajes["a1"] = mensaje_gmail("zz")
        pagina = leer(cuenta)
        assert pagina.mensajes == ()
        assert pagina.omitidos[0].id_mensaje == "a1"


# ══════════════════════════════════════════════════════════════════════
# El contenido del mensaje
# ══════════════════════════════════════════════════════════════════════


class TestContenido:
    def _uno(self, google, cuenta, **kw):
        google.con_mensajes(mensaje_gmail("a1", **kw))
        return leer(cuenta).mensajes[0]

    def test_solo_html_se_pasa_a_texto(self, claves, google):
        html = ("<html><head><style>p{color:red}</style><title>x</title></head><body>"
                "<script>alert(1)</script><table><tr><td>Total</td><td>$9.990</td></tr></table>"
                "<p>Gracias&nbsp;por&nbsp;tu&nbsp;pago</p></body></html>")
        mensaje = self._uno(google, gmail(), partes=[parte("text/html", html)])
        assert mensaje.texto == "Total\n$9.990\nGracias por tu pago"

    def test_los_adjuntos_no_se_leen(self, claves, google):
        partes = [parte("text/plain", "Recibo adjunto"),
                  parte("text/plain", "contenido del adjunto", nombre="recibo.txt")]
        mensaje = self._uno(google, gmail(), partes=partes)
        assert mensaje.texto == "Recibo adjunto"

    def test_partes_anidadas(self, claves, google):
        anidada = {"partId": "0", "mimeType": "multipart/alternative", "filename": "", "headers": [],
                   "body": {"size": 0}, "parts": [parte("text/plain", "Monto: 12,50 USD")]}
        mensaje = self._uno(google, gmail(), partes=[anidada])
        assert mensaje.texto == "Monto: 12,50 USD"

    def test_respeta_el_juego_de_caracteres(self, claves, google):
        mensaje = self._uno(google, gmail(), partes=[parte("text/plain", "Suscripción renovada", juego="ISO-8859-1")])
        assert mensaje.texto == "Suscripción renovada"

    def test_texto_largo_se_corta_y_se_avisa(self, claves, google):
        mensaje = self._uno(google, gmail(), partes=[parte("text/plain", "x" * (LARGO_MAXIMO_TEXTO + 10))])
        assert len(mensaje.texto) == LARGO_MAXIMO_TEXTO
        assert mensaje.texto_truncado is True

    def test_asunto_codificado_se_decodifica(self, claves, google):
        mensaje = self._uno(google, gmail(), asunto="=?UTF-8?B?" + base64.b64encode("Tu suscripción".encode()).decode() + "?=")
        assert mensaje.asunto == "Tu suscripción"

    def test_el_repr_no_lleva_el_cuerpo(self, claves, google):
        mensaje = self._uno(google, gmail(), partes=[parte("text/plain", "dato-privado-del-correo")])
        assert "dato-privado-del-correo" not in repr(mensaje)

    def test_un_correo_con_miles_de_partes_no_se_recorre_entero(self, claves, google):
        partes = [parte("text/plain", f"p{i}") for i in range(5000)]
        mensaje = self._uno(google, gmail(), partes=partes)
        assert mensaje.texto.count("\n") < 200


# ══════════════════════════════════════════════════════════════════════
# El comando para la cuenta de prueba
# ══════════════════════════════════════════════════════════════════════


class TestComando:
    def _correr(self, *argumentos):
        from io import StringIO

        from django.core.management import call_command

        salida = StringIO()
        call_command("leer_gmail", *argumentos, stdout=salida)
        return salida.getvalue()

    def test_muestra_los_mensajes_pero_no_el_cuerpo(self, claves, google):
        cuenta = gmail()
        google.con_mensajes(mensaje_gmail("a1", partes=[parte("text/plain", "cuerpo-privado")]), siguiente="pag2")
        salida = self._correr("--organizacion", str(ORG_A), "--cuenta", str(cuenta.pk), "--limite", "5")
        assert "a1" in salida and "Tu recibo de Netflix" in salida and "pag2" in salida
        assert "cuerpo-privado" not in salida

    def test_una_cuenta_ajena_termina_en_error_con_su_codigo(self, claves, google):
        from django.core.management.base import CommandError

        ajena = gmail(org=ORG_B)
        with pytest.raises(CommandError, match=r"\[cuenta_no_encontrada\]"):
            self._correr("--organizacion", str(ORG_A), "--cuenta", str(ajena.pk))
        assert google.peticiones == []

    def test_fechas_del_comando(self, claves, google):
        cuenta = gmail()
        self._correr("--organizacion", str(ORG_A), "--cuenta", str(cuenta.pk), "--desde", "2026-10-01", "--todos")
        desde = int(datetime(2026, 10, 1, tzinfo=tz.utc).timestamp())
        assert google.peticiones[0]["params"]["q"] == f"after:{desde}"
