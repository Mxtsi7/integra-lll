"""S3-FE-19 — renovar credenciales vencidas y pedir reconexión.

Criterios de la tarjeta:
- una credencial revocada no entra en bucle;
- la API informa a la interfaz y no revela tokens.

Se usan `renovacion`, `proveedores.refrescar_token` y los lectores REALES. Se
reemplazan solo `requests.post` (el endpoint de token) y `requests.get` (la
API de correo).

── De dónde salen las respuestas ────────────────────────────────────────────
- `invalid_client` de Google y `unauthorized_client` de Microsoft son **copia
  literal** de lo que respondieron el 13-11-2026 a un cliente inventado.
- El 401 de Gmail es copia literal (ver `test_lector_gmail.py`).
- `invalid_grant` y la respuesta 200 del refresco siguen el RFC 6749 §5 y la
  documentación de cada proveedor: para provocarlos de verdad hace falta un
  cliente y una cuenta reales.
"""

import uuid
from datetime import timedelta

import pytest
import requests
from django.utils import timezone
from rest_framework.test import APIClient

from connectors import lector_gmail, lector_outlook, proveedores
from connectors.lectura_correo import CuentaNoDisponible, ErrorDelProveedor, ErrorTransitorio
from connectors.models import CuentaConectada
from connectors.renovacion import leer_con_renovacion, token_vigente

pytestmark = pytest.mark.django_db

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTRA = uuid.UUID("22222222-2222-2222-2222-222222222222")
ACCESO_VIEJO = "ya29.acceso-viejo-que-no-debe-salir"
ACCESO_NUEVO = "ya29.acceso-nuevo-que-no-debe-salir"
REFRESCO = "1//refresco-que-no-debe-salir"


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


REFRESCO_OK = _Respuesta(200, {"access_token": ACCESO_NUEVO, "expires_in": 3599, "scope": "x", "token_type": "Bearer"})
INVALID_GRANT = _Respuesta(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
# Copias literales (13-11-2026), cliente inventado.
INVALID_CLIENT_GOOGLE = _Respuesta(401, {"error": "invalid_client", "error_description": "The OAuth client was not found."})
UNAUTHORIZED_CLIENT_MICROSOFT = _Respuesta(400, {
    "error": "unauthorized_client",
    "error_description": "AADSTS700038: 00000000-0000-0000-0000-000000000000 is not a valid application identifier. "
                         "Trace ID: 0e067d6f-3b17-46fb-af4d-e3fce910b300 Correlation ID: "
                         "3cb613b9-7ffc-4791-8363-4d9a600b7166 Timestamp: 2026-11-13 22:19:41Z",
    "error_codes": [700038], "timestamp": "2026-11-13 22:19:41Z",
    "trace_id": "0e067d6f-3b17-46fb-af4d-e3fce910b300", "correlation_id": "3cb613b9-7ffc-4791-8363-4d9a600b7166",
})
GMAIL_401 = _Respuesta(401, {"error": {"code": 401, "message": "Request had invalid authentication credentials.",
                                       "errors": [{"message": "Invalid Credentials", "domain": "global",
                                                   "reason": "authError"}], "status": "UNAUTHENTICATED"}})
GMAIL_403 = _Respuesta(403, {"error": {"code": 403, "message": "Request had insufficient authentication scopes.",
                                       "errors": [{"message": "Insufficient Permission", "domain": "global",
                                                   "reason": "insufficientPermissions"}],
                                       "status": "PERMISSION_DENIED"}})
GMAIL_VACIO = _Respuesta(200, {})


class Proveedor:
    """El endpoint de token y la API de Gmail, con colas de respuestas."""

    def __init__(self, monkeypatch):
        self.refrescos = []
        self.lecturas = []
        self.respuestas_refresco = [REFRESCO_OK]
        self.respuestas_lectura = [GMAIL_VACIO]
        monkeypatch.setattr(proveedores.requests, "post", self.post)
        monkeypatch.setattr(lector_gmail.requests, "get", self.get)
        monkeypatch.setattr(lector_outlook.requests, "get", self.get)

    @staticmethod
    def _siguiente(cola):
        respuesta = cola.pop(0) if len(cola) > 1 else cola[0]
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta

    def post(self, url, data=None, timeout=None):
        self.refrescos.append({"url": url, "data": dict(data or {})})
        return self._siguiente(self.respuestas_refresco)

    def get(self, url, params=None, headers=None, timeout=None, allow_redirects=True):
        token = (headers or {}).get("Authorization", "")
        self.lecturas.append({"url": url, "token": token})
        respuesta = self._siguiente(self.respuestas_lectura)
        # Una respuesta puede ser una función: lo que pasa MIENTRAS la
        # petición está en vuelo (el usuario reconecta, otro worker refresca),
        # y después lo que contesta el proveedor.
        return respuesta(token) if callable(respuesta) else respuesta


@pytest.fixture
def proveedor(monkeypatch, settings):
    settings.OAUTH_CREDENCIALES = {
        "gmail": {"client_id": "cliente-gmail", "client_secret": "secreto-gmail"},
        "outlook": {"client_id": "cliente-outlook", "client_secret": "secreto-outlook"},
    }
    return Proveedor(monkeypatch)


def cuenta(*, proveedor="gmail", vence_en=timedelta(minutes=50), refresco=REFRESCO, acceso=ACCESO_VIEJO, org=ORG):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=f"p@{proveedor}.com",
        access_token=acceso, refresh_token=refresco,
        token_expira_en=None if vence_en is None else timezone.now() + vence_en,
    )


def leer(c, lector=lector_gmail, org=ORG):
    return leer_con_renovacion(lector, organizacion_id=org, cuenta_id=c.pk)


# ══════════════════════════════════════════════════════════════════════
# Renovar cuando procede
# ══════════════════════════════════════════════════════════════════════


class TestRenovar:
    def test_un_token_vigente_no_se_refresca(self, claves, proveedor):
        c = cuenta()
        leer(c)
        assert proveedor.refrescos == []
        assert proveedor.lecturas[0]["token"] == f"Bearer {ACCESO_VIEJO}"

    @pytest.mark.parametrize("vence_en", [timedelta(minutes=-30), timedelta(minutes=2)])
    def test_vencido_o_por_vencer_se_refresca_y_se_lee_con_el_nuevo(self, claves, proveedor, vence_en):
        c = cuenta(vence_en=vence_en)

        leer(c)

        (refresco,) = proveedor.refrescos
        assert refresco["url"] == "https://oauth2.googleapis.com/token"
        assert refresco["data"] == {"client_id": "cliente-gmail", "client_secret": "secreto-gmail",
                                    "grant_type": "refresh_token", "refresh_token": REFRESCO}
        assert proveedor.lecturas[0]["token"] == f"Bearer {ACCESO_NUEVO}"
        c.refresh_from_db()
        assert c.access_token == ACCESO_NUEVO
        assert timedelta(minutes=58) < c.token_expira_en - timezone.now() <= timedelta(seconds=3599)

    def test_google_no_rota_el_de_refresco_y_se_conserva(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1))
        leer(c)
        c.refresh_from_db()
        assert c.refresh_token == REFRESCO

    def test_outlook_pide_los_scopes_y_guarda_el_de_refresco_rotado(self, claves, proveedor):
        c = cuenta(proveedor="outlook", vence_en=timedelta(minutes=-1), refresco="M.C1-viejo")
        proveedor.respuestas_refresco = [_Respuesta(200, {
            "token_type": "Bearer", "scope": "Mail.Read", "expires_in": 3600,
            "access_token": "EwB-nuevo", "refresh_token": "M.C1-rotado"})]
        proveedor.respuestas_lectura = [_Respuesta(200, {"value": []})]

        leer(c, lector=lector_outlook)

        (refresco,) = proveedor.refrescos
        assert refresco["url"].startswith("https://login.microsoftonline.com/")
        assert "Mail.Read" in refresco["data"]["scope"] and "offline_access" in refresco["data"]["scope"]
        c.refresh_from_db()
        assert (c.access_token, c.refresh_token) == ("EwB-nuevo", "M.C1-rotado")

    def test_sin_expires_in_se_supone_una_hora(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [_Respuesta(200, {"access_token": ACCESO_NUEVO})]
        leer(c)
        c.refresh_from_db()
        assert timedelta(minutes=59) < c.token_expira_en - timezone.now() <= timedelta(hours=1)

    def test_el_refresco_no_sube_la_version_ni_toca_la_revocacion(self, claves, proveedor):
        """Subirla haría fallar una desconexión pedida mientras se refrescaba."""
        c = cuenta(vence_en=timedelta(minutes=-1))
        version = c.credenciales_version
        leer(c)
        c.refresh_from_db()
        assert c.credenciales_version == version
        assert c.estado == "conectada"

    @pytest.mark.parametrize("cuerpo", [{}, {"access_token": ""}, ["x"], ValueError("html")])
    def test_un_refresco_200_inservible_no_se_guarda(self, claves, proveedor, cuerpo):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [_Respuesta(200, cuerpo)]
        with pytest.raises(ErrorDelProveedor):
            leer(c)
        c.refresh_from_db()
        assert (c.access_token, c.estado) == (ACCESO_VIEJO, "conectada")


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — una credencial revocada no entra en bucle
# ══════════════════════════════════════════════════════════════════════


class TestSinBucle:
    def test_invalid_grant_deja_la_cuenta_pidiendo_reconexion(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [INVALID_GRANT]

        with pytest.raises(CuentaNoDisponible) as error:
            leer(c)

        assert error.value.codigo == CuentaNoDisponible.REQUIERE_REAUTORIZACION
        assert proveedor.lecturas == []
        c.refresh_from_db()
        assert c.estado == "requiere_reautorizacion"
        assert c.detalle_del_estado == "Gmail ya no acepta la autorización de esta cuenta: hay que volver a conectar la cuenta."

    def test_despues_de_marcada_no_se_vuelve_a_pedir_nada(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [INVALID_GRANT]
        for _ in range(5):
            with pytest.raises(CuentaNoDisponible):
                leer(c)
        assert len(proveedor.refrescos) == 1
        assert proveedor.lecturas == []

    def test_401_refresca_una_vez_y_lee_una_vez_mas(self, claves, proveedor):
        c = cuenta()
        proveedor.respuestas_lectura = [GMAIL_401, GMAIL_VACIO]

        pagina = leer(c)

        assert pagina.mensajes == ()
        assert len(proveedor.refrescos) == 1
        assert [l["token"] for l in proveedor.lecturas] == [f"Bearer {ACCESO_VIEJO}", f"Bearer {ACCESO_NUEVO}"]

    def test_401_aun_con_el_token_nuevo_marca_y_corta(self, claves, proveedor):
        c = cuenta()
        proveedor.respuestas_lectura = [GMAIL_401]

        with pytest.raises(CuentaNoDisponible) as error:
            leer(c)
        assert error.value.codigo == CuentaNoDisponible.REQUIERE_REAUTORIZACION
        assert (len(proveedor.refrescos), len(proveedor.lecturas)) == (1, 2)

        for _ in range(3):
            with pytest.raises(CuentaNoDisponible):
                leer(c)
        assert (len(proveedor.refrescos), len(proveedor.lecturas)) == (1, 2)
        c.refresh_from_db()
        assert c.estado == "requiere_reautorizacion"

    def test_401_y_el_refresco_dice_invalid_grant(self, claves, proveedor):
        c = cuenta()
        proveedor.respuestas_lectura = [GMAIL_401]
        proveedor.respuestas_refresco = [INVALID_GRANT]
        with pytest.raises(CuentaNoDisponible):
            leer(c)
        assert (len(proveedor.refrescos), len(proveedor.lecturas)) == (1, 1)

    def test_403_de_permisos_no_se_arregla_refrescando(self, claves, proveedor):
        c = cuenta()
        proveedor.respuestas_lectura = [GMAIL_403]
        with pytest.raises(CuentaNoDisponible):
            leer(c)
        assert proveedor.refrescos == []
        c.refresh_from_db()
        assert c.estado == "requiere_reautorizacion"
        assert "permisos" in c.detalle_del_estado

    def test_sin_token_de_refresco_y_vencido_no_se_intenta(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1), refresco=None)
        with pytest.raises(CuentaNoDisponible):
            leer(c)
        assert proveedor.refrescos == [] and proveedor.lecturas == []
        c.refresh_from_db()
        assert c.estado == "requiere_reautorizacion"

    def test_la_cuenta_de_otra_organizacion_no_se_refresca_ni_se_marca(self, claves, proveedor):
        ajena = cuenta(org=OTRA, vence_en=timedelta(minutes=-1))
        with pytest.raises(CuentaNoDisponible) as error:
            leer(ajena, org=ORG)
        assert error.value.codigo == CuentaNoDisponible.NO_ENCONTRADA
        assert proveedor.refrescos == []
        ajena.refresh_from_db()
        assert ajena.estado == "conectada"

    @pytest.mark.parametrize("estado", ["desconectada", "requiere_reautorizacion", "error"])
    def test_una_cuenta_que_no_esta_conectada_no_se_refresca(self, claves, proveedor, estado):
        c = cuenta(vence_en=timedelta(minutes=-1))
        CuentaConectada.objects.filter(pk=c.pk).update(estado=estado)
        with pytest.raises(CuentaNoDisponible):
            leer(c)
        assert proveedor.refrescos == []


# ══════════════════════════════════════════════════════════════════════
# Lo que NO marca la cuenta
# ══════════════════════════════════════════════════════════════════════


class TestNoEsCulpaDeLaCuenta:
    @pytest.mark.parametrize("respuesta", [INVALID_CLIENT_GOOGLE, UNAUTHORIZED_CLIENT_MICROSOFT])
    def test_un_cliente_oauth_mal_configurado_no_marca_a_nadie(self, claves, proveedor, respuesta):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [respuesta]
        with pytest.raises(ErrorDelProveedor) as error:
            leer(c)
        assert error.value.codigo == "refresco_rechazado_por_configuracion"
        c.refresh_from_db()
        assert c.estado == "conectada"

    @pytest.mark.parametrize("respuesta", [
        requests.ConnectionError(f"sin red {REFRESCO}"), requests.Timeout("lento"),
        _Respuesta(429, {"error": "rate_limited"}), _Respuesta(503, ValueError("html")),
    ])
    def test_un_fallo_transitorio_no_marca_y_se_puede_reintentar(self, claves, proveedor, respuesta):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [respuesta]
        with pytest.raises(ErrorTransitorio) as error:
            leer(c)
        assert error.value.codigo == "refresco_no_disponible"
        assert REFRESCO not in str(error.value)
        c.refresh_from_db()
        assert c.estado == "conectada"

    def test_un_error_raro_del_proveedor_no_se_copia(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [_Respuesta(400, {"error": f"algo {REFRESCO}"})]
        with pytest.raises(ErrorDelProveedor) as error:
            leer(c)
        assert REFRESCO not in str(error.value) and "algo" not in str(error.value)


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — la API informa a la interfaz y no revela tokens
# ══════════════════════════════════════════════════════════════════════


class TestLaInterfazSeEntera:
    def test_el_listado_muestra_la_reconexion_y_ningun_token(self, claves, proveedor):
        c = cuenta(vence_en=timedelta(minutes=-1))
        proveedor.respuestas_refresco = [INVALID_GRANT]
        with pytest.raises(CuentaNoDisponible):
            leer(c)

        respuesta = APIClient().get("/api/conectores/", headers={"X-Organizacion-Id": str(ORG)})

        assert respuesta.status_code == 200
        (dato,) = respuesta.data["results"]
        assert dato["estado"] == "requiere_reautorizacion"
        assert dato["necesita_reautorizacion"] is True
        assert "volver a conectar" in dato["detalle_del_estado"]
        crudo = respuesta.content.decode()
        for secreto in (ACCESO_VIEJO, ACCESO_NUEVO, REFRESCO):
            assert secreto not in crudo


class TestTokenVigenteSolo:
    def test_forzar_refresca_aunque_no_venza(self, claves, proveedor):
        c = cuenta()
        token_vigente(organizacion_id=ORG, cuenta_id=c.pk, proveedor="gmail", forzar=True)
        assert len(proveedor.refrescos) == 1

    def test_un_identificador_mal_formado_no_revienta(self, claves, proveedor):
        token_vigente(organizacion_id=ORG, cuenta_id="no-es-uuid", proveedor="gmail")
        assert proveedor.refrescos == []

    def test_marcar_no_toca_la_cuenta_de_otra_organizacion(self, claves, proveedor):
        """Hoy `_marcar` solo se llama después de que el lector validó la
        organización. Igual filtra por ella: es la escritura que deja a un
        usuario sin poder leer, y no puede depender de quién la llame."""
        from connectors.renovacion import _marcar

        c = cuenta(org=OTRA)
        assert _marcar(c.pk, organizacion_id=ORG, version=c.credenciales_version, motivo="x") is False
        c.refresh_from_db()
        assert c.estado == "conectada"


# ══════════════════════════════════════════════════════════════════════
# Revisión de #180 — un 401 tardío no castiga a las credenciales nuevas
# ══════════════════════════════════════════════════════════════════════


ACCESO_B = "ya29.acceso-de-la-reconexion"


def reconectar(c, *, acceso=ACCESO_B, refresco=None):
    """Lo que hace el callback de OAuth (`views.CallbackAutorizacionView`):
    guarda el token nuevo, conserva el de refresco si no vino uno, deja la
    cuenta conectada y sube la versión con `registrar_credenciales_nuevas`."""
    from connectors import revocacion

    c = CuentaConectada.objects.get(pk=c.pk)
    c.access_token = acceso
    c.token_expira_en = timezone.now() + timedelta(minutes=55)
    c.estado = CuentaConectada.Estado.CONECTADA
    c.detalle_del_estado = ""
    if refresco is not None:
        c.refresh_token = refresco
    c.save()
    revocacion.registrar_credenciales_nuevas(c)


def en_vuelo(efecto, respuesta):
    """Una lectura durante la cual pasa `efecto`, y que termina en `respuesta`."""
    def ocurre(_token):
        efecto()
        return respuesta
    return ocurre


class TestRechazoTardio:
    def test_el_caso_de_maxi_b_sin_refresco_queda_conectada_y_legible(self, claves, proveedor):
        """A está en vuelo; el usuario reconecta con B (sin token de refresco,
        acceso vigente); llega el 401 de A. B no se toca y se lee."""
        c = cuenta(refresco=None)
        proveedor.respuestas_lectura = [en_vuelo(lambda: reconectar(c), GMAIL_401), GMAIL_VACIO]

        pagina = leer(c)

        assert pagina.mensajes == ()
        assert proveedor.refrescos == []
        assert [l["token"] for l in proveedor.lecturas] == [f"Bearer {ACCESO_VIEJO}", f"Bearer {ACCESO_B}"]
        c.refresh_from_db()
        assert (c.estado, c.access_token, c.detalle_del_estado) == ("conectada", ACCESO_B, "")

    def test_b_con_refresco_tampoco_se_refresca_por_el_rechazo_de_a(self, claves, proveedor):
        c = cuenta()
        proveedor.respuestas_lectura = [en_vuelo(lambda: reconectar(c, refresco="1//refresco-b"), GMAIL_401),
                                        GMAIL_VACIO]
        leer(c)
        assert proveedor.refrescos == []
        c.refresh_from_db()
        assert (c.estado, c.access_token, c.refresh_token) == ("conectada", ACCESO_B, "1//refresco-b")

    def test_si_b_tambien_es_rechazada_se_marca_porque_el_rechazo_es_suyo(self, claves, proveedor):
        """El rechazo de la generación vigente sí marca."""
        c = cuenta(refresco=None)
        proveedor.respuestas_lectura = [en_vuelo(lambda: reconectar(c), GMAIL_401), GMAIL_401]
        with pytest.raises(CuentaNoDisponible):
            leer(c)
        c.refresh_from_db()
        assert c.estado == "requiere_reautorizacion"

    def test_desconectada_mientras_tanto_no_se_refresca_ni_se_marca(self, claves, proveedor):
        c = cuenta()

        def desconectar():
            CuentaConectada.objects.filter(pk=c.pk).update(estado=CuentaConectada.Estado.DESCONECTADA)

        proveedor.respuestas_lectura = [en_vuelo(desconectar, GMAIL_401)]
        with pytest.raises(CuentaNoDisponible) as error:
            leer(c)
        assert error.value.codigo == CuentaNoDisponible.DESCONECTADA
        assert proveedor.refrescos == []
        c.refresh_from_db()
        assert c.estado == "desconectada"

    def test_un_403_de_a_no_marca_a_b(self, claves, proveedor):
        c = cuenta()
        proveedor.respuestas_lectura = [en_vuelo(lambda: reconectar(c), GMAIL_403), GMAIL_VACIO]
        leer(c)
        c.refresh_from_db()
        assert (c.estado, c.access_token) == ("conectada", ACCESO_B)

    def test_si_otro_worker_ya_refresco_no_se_refresca_de_nuevo(self, claves, proveedor):
        """Misma versión, otro token: no se refresca otra vez (Microsoft rota
        el de refresco) y se lee con el que dejó el otro worker."""
        c = cuenta()

        def otro_worker_refresca():
            fila = CuentaConectada.objects.get(pk=c.pk)
            fila.access_token = "ya29.del-otro-worker"
            fila.save(update_fields=["access_token"])

        proveedor.respuestas_lectura = [en_vuelo(otro_worker_refresca, GMAIL_401), GMAIL_VACIO]
        leer(c)
        assert proveedor.refrescos == []
        assert proveedor.lecturas[1]["token"] == "Bearer ya29.del-otro-worker"

    def test_el_rechazo_dice_con_que_credenciales_se_pidio_y_no_lleva_el_token(self, claves, proveedor):
        from connectors.lectura_correo import AutorizacionRechazada, huella_de_token

        c = cuenta()
        proveedor.respuestas_lectura = [GMAIL_401]
        with pytest.raises(AutorizacionRechazada) as error:
            lector_gmail.leer_mensajes(organizacion_id=ORG, cuenta_id=c.pk)
        assert error.value.credenciales_version == c.credenciales_version
        assert error.value.huella_token == huella_de_token(ACCESO_VIEJO)
        assert ACCESO_VIEJO not in repr(vars(error.value))

    def test_outlook_tambien_dice_con_que_credenciales(self, claves, proveedor):
        from connectors.lectura_correo import AutorizacionRechazada, huella_de_token

        c = cuenta(proveedor="outlook")
        proveedor.respuestas_lectura = [_Respuesta(401, {"error": {"code": "InvalidAuthenticationToken"}})]
        with pytest.raises(AutorizacionRechazada) as error:
            lector_outlook.leer_mensajes(organizacion_id=ORG, cuenta_id=c.pk)
        assert error.value.huella_token == huella_de_token(ACCESO_VIEJO)

    def test_un_403_no_marca_si_otro_worker_ya_cambio_el_token(self, claves, proveedor):
        """Misma versión, otro token: el 403 era del token viejo."""
        c = cuenta()

        def otro_worker_refresca():
            fila = CuentaConectada.objects.get(pk=c.pk)
            fila.access_token = "ya29.del-otro-worker"
            fila.save(update_fields=["access_token"])

        proveedor.respuestas_lectura = [en_vuelo(otro_worker_refresca, GMAIL_403), GMAIL_VACIO]
        leer(c)
        c.refresh_from_db()
        assert c.estado == "conectada"

    @pytest.mark.parametrize("respuesta", [GMAIL_401, GMAIL_403])
    def test_una_reconexion_es_otra_autorizacion_aunque_repita_el_token(self, claves, proveedor, respuesta):
        """Si el proveedor entrega el mismo token al reconectar, la versión
        igual cambió: el rechazo de la autorización anterior no la toca."""
        c = cuenta(refresco=None)
        proveedor.respuestas_lectura = [en_vuelo(lambda: reconectar(c, acceso=ACCESO_VIEJO), respuesta), GMAIL_VACIO]
        leer(c)
        assert proveedor.refrescos == []
        c.refresh_from_db()
        assert c.estado == "conectada"
