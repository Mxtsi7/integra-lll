"""
FE-03, FE-04 y FE-05 — iniciar OAuth, procesar el callback y desconectar.

Lo que tiene que quedar demostrado, criterio por criterio:

FE-03
- el `state` se valida y no se admite un retorno arbitrario
- cancelar la autorización NO crea una cuenta conectada

FE-04
- el éxito deja la cuenta conectada en el tenant correcto
- un `state` inválido o un código repetido no vinculan ni exponen tokens

FE-05
- desconectar impide nuevas lecturas
- otra organización no puede revocar ni consultar esa cuenta

No se habla con Google en ninguna prueba: `canjear_codigo` y `revocar` se
reemplazan por dobles. Lo que se prueba es NUESTRA lógica —el state, el uso
único, el aislamiento entre organizaciones, qué se guarda cifrado—, no la
librería de HTTP.
"""

import base64
import json
import time
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors import proveedores
from connectors.models import AutorizacionPendiente, CuentaConectada

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

INICIAR = "/api/conectores/autorizaciones/"
CALLBACK = "/api/conectores/autorizaciones/callback/"
LISTA = "/api/conectores/"

RETORNO_OK = "https://ojoalgasto-forellana.dev.censei.cl/conectores"
# El clásico: empieza igual que el permitido, es otro dominio. Si la
# validación usara `startswith` en vez del origen completo, esto pasaría.
RETORNO_TRAMPA = "https://ojoalgasto-forellana.dev.censei.cl.malo.com/roba"

CLIENTE_GMAIL = "cliente-de-prueba"
EMISOR_GOOGLE = "https://accounts.google.com"


def id_token(**cambios) -> str:
    """Un id_token con los claims que el proveedor manda de verdad.

    La firma es inventada y da igual: no se verifica, y está documentado por
    qué (llega como respuesta directa del endpoint de canje, por TLS contra
    el dominio del proveedor). Lo que SÍ se valida son `iss`, `aud` y `exp`,
    y para eso este helper sirve: cada prueba cambia un claim y comprueba
    que se rechace.
    """
    claims = {
        "iss": EMISOR_GOOGLE,
        "aud": CLIENTE_GMAIL,
        "exp": int(time.time()) + 3600,
        "email": "Persona@Gmail.com",
    }
    claims.update(cambios)
    claims = {k: v for k, v in claims.items() if v is not _QUITAR}
    cabeza = base64.urlsafe_b64encode(b'{"alg":"RS256"}').decode().rstrip("=")
    cuerpo = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"{cabeza}.{cuerpo}.firma-que-no-se-verifica"


class _Quitar:
    """Centinela para pedirle a `id_token` que OMITA un claim."""


_QUITAR = _Quitar()


def respuesta_del_canje(**cambios) -> dict:
    base = {
        "access_token": "ya29.token-de-acceso-de-prueba",
        "refresh_token": "1//refresh-de-prueba",
        "expires_in": 3599,
        "id_token": id_token(),
    }
    base.update(cambios)
    return base


RESPUESTA_DEL_CANJE = respuesta_del_canje()


@pytest.fixture
def cliente():
    return APIClient()


@pytest.fixture(autouse=True)
def entorno_oauth(settings, claves):
    """Credenciales y lista blanca para todas las pruebas de este archivo.

    `claves` viene del conftest y deja CLAVES_CIFRADO con una clave recién
    generada: sin eso, CampoCifrado no puede guardar el verificador PKCE.
    """
    settings.OAUTH_REDIRECT_URI = "https://ojoalgasto-forellana.dev.censei.cl/oauth/retorno"
    settings.OAUTH_RETORNOS_PERMITIDOS = ["https://ojoalgasto-forellana.dev.censei.cl"]
    settings.OAUTH_CREDENCIALES = {
        "gmail": {"client_id": "cliente-de-prueba", "client_secret": "secreto"},
        "outlook": {"client_id": "cliente-ms", "client_secret": "secreto-ms"},
    }


USUARIO_A = "42"
USUARIO_B = "99"


def cabecera(org=ORG_A, usuario=USUARIO_A):
    """Las dos cabeceras que inyecta el gateway. El usuario importa desde
    que el state va vinculado a quien abrió el flujo (FE-03)."""
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


def iniciar(cliente, org=ORG_A, proveedor="gmail", usuario=USUARIO_A, **extra):
    cuerpo = {"proveedor": proveedor, **extra}
    return cliente.post(
        INICIAR, cuerpo, format="json", headers=cabecera(org, usuario)
    )


def canje_falso(monkeypatch, respuesta=None, error=None):
    """Reemplaza `canjear_codigo` y devuelve la lista de llamadas que recibió."""
    llamadas = []

    def falso(proveedor, **kw):
        llamadas.append({"proveedor": proveedor, **kw})
        if error:
            raise error
        return dict(respuesta or RESPUESTA_DEL_CANJE)

    monkeypatch.setattr(proveedores, "canjear_codigo", falso)
    return llamadas


# ══════════════════════════════════════════════════════════════════════
# FE-03 — iniciar el flujo
# ══════════════════════════════════════════════════════════════════════


class TestIniciar:
    def test_devuelve_la_url_y_guarda_el_flujo(self, cliente):
        respuesta = iniciar(cliente)
        assert respuesta.status_code == status.HTTP_200_OK
        assert AutorizacionPendiente.objects.count() == 1

        fila = AutorizacionPendiente.objects.get()
        assert fila.organizacion_id == ORG_A
        assert respuesta.data["estado_oauth"] == fila.estado_oauth
        assert fila.vigente

    def test_la_url_lleva_el_state_y_el_desafio_pkce(self, cliente):
        respuesta = iniciar(cliente)
        parametros = parse_qs(urlsplit(respuesta.data["url_autorizacion"]).query)

        fila = AutorizacionPendiente.objects.get()
        assert parametros["state"] == [fila.estado_oauth]
        assert parametros["code_challenge_method"] == ["S256"]
        assert parametros["code_challenge"][0]
        # base64url sin relleno, como pide el RFC 7636.
        assert "=" not in parametros["code_challenge"][0]

    def test_el_verificador_pkce_NO_viaja_en_la_url(self, cliente):
        """Si el verificador saliera, PKCE no probaría nada."""
        respuesta = iniciar(cliente)
        url = respuesta.data["url_autorizacion"]
        verificador = str(AutorizacionPendiente.objects.get().verificador_pkce)
        assert verificador
        assert verificador not in url

    def test_pide_solo_permiso_de_lectura(self, cliente):
        """Pedir más de lo que se usa es regalarle un riesgo al usuario."""
        respuesta = iniciar(cliente)
        scopes = parse_qs(urlsplit(respuesta.data["url_autorizacion"]).query)["scope"][0]
        assert "gmail.readonly" in scopes
        for prohibido in ("gmail.modify", "gmail.send", "mail.google.com"):
            assert prohibido not in scopes

    def test_iniciar_NO_crea_cuenta_conectada(self, cliente):
        """Criterio: cancelar la autorización no crea cuenta conectada.

        Acá se cumple por construcción: iniciar no crea nada, así que cerrar
        la pestaña tampoco. Lo único que queda es un flujo que vence solo.
        """
        iniciar(cliente)
        assert not CuentaConectada.objects.exists()

    def test_el_csv_no_tiene_oauth(self, cliente):
        """Es un proveedor válido del modelo, pero no hay a quién pedirle permiso."""
        respuesta = iniciar(cliente, proveedor="csv")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert not AutorizacionPendiente.objects.exists()

    def test_un_proveedor_inventado_se_rechaza(self, cliente):
        assert iniciar(cliente, proveedor="hotmail").status_code == 400

    def test_sin_cabecera_de_organizacion_no_se_inicia_nada(self, cliente):
        respuesta = cliente.post(INICIAR, {"proveedor": "gmail"}, format="json")
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not AutorizacionPendiente.objects.exists()

    # ── el retorno ───────────────────────────────────────────────────

    def test_acepta_un_retorno_de_la_lista_blanca(self, cliente):
        respuesta = iniciar(cliente, retorno=RETORNO_OK)
        assert respuesta.status_code == status.HTTP_200_OK
        assert AutorizacionPendiente.objects.get().retorno == RETORNO_OK

    def test_rechaza_un_retorno_arbitrario(self, cliente):
        """Criterio: no admite retorno arbitrario."""
        respuesta = iniciar(cliente, retorno="https://sitio-cualquiera.com/")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert "retorno" in respuesta.data
        assert not AutorizacionPendiente.objects.exists()

    def test_rechaza_un_dominio_que_solo_empieza_igual(self, cliente):
        """Con `startswith` esto pasaría. Por eso se compara el origen completo."""
        respuesta = iniciar(cliente, retorno=RETORNO_TRAMPA)
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST

    def test_sin_lista_blanca_no_se_acepta_ningun_retorno(self, cliente, settings):
        settings.OAUTH_RETORNOS_PERMITIDOS = []
        assert iniciar(cliente, retorno=RETORNO_OK).status_code == 400

    def test_sin_retorno_tambien_sirve(self, cliente):
        """El frontend puede saber solo a dónde volver."""
        assert iniciar(cliente).status_code == status.HTTP_200_OK

    def test_sin_redirect_uri_configurado_avisa(self, cliente, settings):
        settings.OAUTH_REDIRECT_URI = ""
        respuesta = iniciar(cliente)
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert not AutorizacionPendiente.objects.exists()

    def test_cada_inicio_tiene_su_propio_state(self, cliente):
        """Un state repetido dejaría dos flujos compartiendo la misma llave."""
        iniciar(cliente)
        iniciar(cliente)
        estados = set(AutorizacionPendiente.objects.values_list("estado_oauth", flat=True))
        assert len(estados) == 2


# ══════════════════════════════════════════════════════════════════════
# FE-04 — el callback
# ══════════════════════════════════════════════════════════════════════


class TestCallback:
    def _flujo(self, cliente, org=ORG_A, proveedor="gmail", usuario=USUARIO_A):
        iniciar(cliente, org=org, proveedor=proveedor, usuario=usuario)
        return AutorizacionPendiente.objects.filter(usada_en__isnull=True).latest(
            "creado_en"
        )

    def _volver(self, cliente, flujo, *, org=ORG_A, usuario=USUARIO_A, **cuerpo):
        """El POST del callback, con las cabeceras que inyecta el gateway.

        Las manda siempre: `/api/conectores/` no está en `RUTAS_PUBLICAS`, así
        que el gateway exige JWT y la identidad llega. Una versión anterior de
        estas pruebas no las mandaba, y pasaban igual — porque la vista
        comprobaba la organización solo "si venía".
        """
        datos = {"estado_oauth": flujo.estado_oauth}
        datos.update(cuerpo)
        return cliente.post(
            CALLBACK, datos, format="json", headers=cabecera(org, usuario)
        )

    def test_el_exito_deja_la_cuenta_en_el_tenant_correcto(self, cliente, monkeypatch):
        """Criterio: éxito deja cuenta conectada del tenant correcto."""
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)

        respuesta = self._volver(cliente, flujo, codigo="codigo-de-un-uso")
        assert respuesta.status_code == status.HTTP_200_OK

        cuenta = CuentaConectada.objects.get()
        assert cuenta.organizacion_id == ORG_A
        assert cuenta.proveedor == "gmail"
        # El correo se normaliza: "Persona@Gmail.com" llegaría como una cuenta
        # distinta de "persona@gmail.com" y rompería la unicidad.
        assert cuenta.cuenta_externa == "persona@gmail.com"
        assert cuenta.estado == CuentaConectada.Estado.CONECTADA

    def test_guarda_los_tokens_y_el_vencimiento(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)
        antes = timezone.now()

        self._volver(cliente, flujo, codigo="c")
        cuenta = CuentaConectada.objects.get()
        assert str(cuenta.access_token) == RESPUESTA_DEL_CANJE["access_token"]
        assert str(cuenta.refresh_token) == RESPUESTA_DEL_CANJE["refresh_token"]
        assert cuenta.token_expira_en > antes

    def test_los_tokens_quedan_cifrados_en_la_base(self, cliente, monkeypatch):
        """Lo que se guarda es un bloque Fernet, no el token (FE-06)."""
        from django.db import connection

        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)
        self._volver(cliente, flujo, codigo="c")

        with connection.cursor() as cursor:
            cursor.execute("SELECT access_token FROM cuenta_conectada")
            crudo = cursor.fetchone()[0]
        assert RESPUESTA_DEL_CANJE["access_token"] not in crudo

    def test_la_respuesta_no_devuelve_los_tokens(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)
        respuesta = self._volver(cliente, flujo, codigo="c")
        cuerpo = str(respuesta.data)
        assert RESPUESTA_DEL_CANJE["access_token"] not in cuerpo
        assert RESPUESTA_DEL_CANJE["refresh_token"] not in cuerpo

    def test_el_canje_recibe_el_verificador_que_nunca_salio(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        llamadas = canje_falso(monkeypatch)
        self._volver(cliente, flujo, codigo="c")
        assert llamadas[0]["verificador_pkce"] == str(flujo.verificador_pkce)
        # La misma redirect_uri del inicio: si no calza, el proveedor rechaza.
        assert llamadas[0]["redirect_uri"] == flujo.redirect_uri

    # ── state inválido ───────────────────────────────────────────────

    def test_un_state_desconocido_no_vincula_nada(self, cliente, monkeypatch):
        """Criterio: state inválido no vincula ni expone tokens."""
        llamadas = canje_falso(monkeypatch)
        respuesta = cliente.post(
            CALLBACK,
            {"estado_oauth": "inventado", "codigo": "c"},
            format="json",
            headers=cabecera(),
        )
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert not CuentaConectada.objects.exists()
        # Y ni siquiera se le habló al proveedor.
        assert llamadas == []

    def test_un_state_vencido_no_sirve(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        AutorizacionPendiente.objects.filter(pk=flujo.pk).update(
            expira_en=timezone.now() - timedelta(seconds=1)
        )
        canje_falso(monkeypatch)
        respuesta = self._volver(cliente, flujo, codigo="c")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert not CuentaConectada.objects.exists()

    def test_el_codigo_repetido_no_crea_una_segunda_cuenta(self, cliente, monkeypatch):
        """Criterio: código repetido no vincula. El state es de un solo uso."""
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)

        primera = self._volver(cliente, flujo, codigo="mismo-codigo")
        segunda = self._volver(cliente, flujo, codigo="mismo-codigo")

        assert primera.status_code == status.HTTP_200_OK
        assert segunda.status_code == status.HTTP_400_BAD_REQUEST
        assert CuentaConectada.objects.count() == 1

    def test_el_state_se_quema_aunque_el_canje_falle(self, cliente, monkeypatch):
        """El código de OAuth también es de un solo uso del lado del proveedor:
        reintentar con el mismo fallaría igual. Hay que empezar de nuevo."""
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch, error=proveedores.ErrorDelProveedor("rechazado"))
        self._volver(cliente, flujo, codigo="c")
        flujo.refresh_from_db()
        assert flujo.usada_en is not None
        assert not flujo.vigente

    def test_marcar_usada_solo_gana_una_vez(self, cliente):
        """El UPDATE condicional es lo que hace el uso único de verdad."""
        flujo = self._flujo(cliente)
        otra_vista = AutorizacionPendiente.objects.get(pk=flujo.pk)
        assert flujo.marcar_usada() is True
        # `otra_vista` cree que está sin usar: es la carrera que se simula.
        assert otra_vista.marcar_usada() is False

    # ── cancelar ─────────────────────────────────────────────────────

    def test_cancelar_no_crea_cuenta_conectada(self, cliente, monkeypatch):
        """Criterio de FE-03, verificado desde el callback."""
        flujo = self._flujo(cliente)
        llamadas = canje_falso(monkeypatch)
        respuesta = self._volver(cliente, flujo, error="access_denied")
        assert respuesta.status_code == status.HTTP_200_OK
        assert respuesta.data["resultado"] == "cancelada"
        assert not CuentaConectada.objects.exists()
        assert llamadas == []

    def test_cancelar_tambien_quema_el_state(self, cliente):
        flujo = self._flujo(cliente)
        self._volver(cliente, flujo, error="access_denied")
        flujo.refresh_from_db()
        assert flujo.usada_en is not None

    def test_sin_codigo_ni_error_es_una_peticion_mal_armada(self, cliente):
        flujo = self._flujo(cliente)
        respuesta = self._volver(cliente, flujo)
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        # No se quemó: la petición no llegó a ser un desenlace del flujo.
        flujo.refresh_from_db()
        assert flujo.usada_en is None

    # ── quién puede cerrar el flujo ──────────────────────────────────

    def test_otra_organizacion_no_puede_cerrarlo(self, cliente, monkeypatch):
        flujo = self._flujo(cliente, org=ORG_A)
        canje_falso(monkeypatch)
        respuesta = self._volver(cliente, flujo, org=ORG_B, codigo="c")
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not CuentaConectada.objects.exists()

    def test_OTRO_USUARIO_DEL_MISMO_TENANT_no_puede_cerrarlo(
        self, cliente, monkeypatch
    ):
        """FE-03 pide el state "vinculado a sesión".

        Sin el vínculo, cualquiera del mismo tenant cerraba el flujo de otro y
        se quedaba con la cuenta conectada a su nombre. El state aleatorio y
        PKCE prueban que el flujo es legítimo, **no** que vuelva quien lo
        abrió. Lo reprodujo la revisión de la PR y era cierto.
        """
        flujo = self._flujo(cliente, usuario=USUARIO_A)
        llamadas = canje_falso(monkeypatch)
        respuesta = self._volver(cliente, flujo, usuario=USUARIO_B, codigo="c")
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not CuentaConectada.objects.exists()
        # Ni siquiera se canjeó el código.
        assert llamadas == []

    def test_el_mismo_usuario_si_puede_cerrarlo(self, cliente, monkeypatch):
        """El control no puede romper el caso normal."""
        flujo = self._flujo(cliente, usuario=USUARIO_A)
        canje_falso(monkeypatch)
        respuesta = self._volver(cliente, flujo, usuario=USUARIO_A, codigo="c")
        assert respuesta.status_code == status.HTTP_200_OK

    def test_sin_cabecera_de_usuario_se_rechaza(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)
        respuesta = cliente.post(
            CALLBACK,
            {"estado_oauth": flujo.estado_oauth, "codigo": "c"},
            format="json",
            headers={"X-Organizacion-Id": str(ORG_A)},
        )
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not CuentaConectada.objects.exists()

    def test_sin_ninguna_cabecera_se_rechaza(self, cliente, monkeypatch):
        """Antes pasaba derecho: la organización se comprobaba solo "si venía"."""
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)
        respuesta = cliente.post(
            CALLBACK,
            {"estado_oauth": flujo.estado_oauth, "codigo": "c"},
            format="json",
        )
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        assert not CuentaConectada.objects.exists()

    def test_el_flujo_guarda_quien_lo_abrio(self, cliente):
        flujo = self._flujo(cliente, usuario=USUARIO_A)
        assert flujo.usuario_id == USUARIO_A

    # ── los claims del id_token ──────────────────────────────────────

    @pytest.mark.parametrize(
        "cambio, porque",
        [
            ({"iss": "https://atacante.example"}, "emisor ajeno"),
            ({"aud": "cliente-de-OTRO"}, "audiencia de otro cliente"),
            ({"exp": 1}, "vencido en 1970"),
            ({"exp": _QUITAR}, "sin exp"),
            ({"email": _QUITAR}, "sin email"),
        ],
    )
    def test_un_id_token_con_claims_malos_no_vincula_la_cuenta(
        self, cliente, monkeypatch, cambio, porque
    ):
        """OIDC Core §3.1.3.7.

        No verificar la **firma** es una excepción documentada: el token llegó
        como respuesta directa del endpoint de canje, por TLS contra el
        dominio del proveedor. Pero esa excepción **no cubre el resto**: que el
        canal autentique al emisor no dice para quién se emitió el token ni si
        sigue vigente. Saltarse iss/aud/exp dejaba pasar un token con emisor
        ajeno, audiencia de otro y vencido en 1970.
        """
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch, respuesta=respuesta_del_canje(id_token=id_token(**cambio)))
        respuesta = self._volver(cliente, flujo, codigo="c")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST, porque
        assert not CuentaConectada.objects.exists(), porque

    def test_sin_id_token_no_se_vincula_nada(self, cliente, monkeypatch):
        """Un campo `email` suelto no es una identidad verificada: no tiene
        emisor, ni audiencia, ni vencimiento."""
        flujo = self._flujo(cliente)
        canje_falso(
            monkeypatch,
            respuesta={
                "access_token": "t",
                "expires_in": 60,
                "email": "suelto@gmail.com",
            },
        )
        respuesta = self._volver(cliente, flujo, codigo="c")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert not CuentaConectada.objects.exists()

    def test_un_id_token_valido_si_vincula(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch, respuesta=respuesta_del_canje())
        respuesta = self._volver(cliente, flujo, codigo="c")
        assert respuesta.status_code == status.HTTP_200_OK
        assert CuentaConectada.objects.get().cuenta_externa == "persona@gmail.com"

    def test_una_audiencia_en_lista_tambien_vale(self, cliente, monkeypatch):
        """OIDC permite `aud` como lista."""
        flujo = self._flujo(cliente)
        canje_falso(
            monkeypatch,
            respuesta=respuesta_del_canje(
                id_token=id_token(aud=["otro-cliente", CLIENTE_GMAIL])
            ),
        )
        assert self._volver(cliente, flujo, codigo="c").status_code == 200

    # ── errores del proveedor ────────────────────────────────────────

    def test_si_el_proveedor_falla_no_queda_cuenta_a_medias(self, cliente, monkeypatch):
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch, error=proveedores.ErrorDelProveedor("rechazó el canje"))
        respuesta = self._volver(cliente, flujo, codigo="c")
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
        assert not CuentaConectada.objects.exists()

    def test_reconectar_no_pisa_el_refresh_token_con_vacio(self, cliente, monkeypatch):
        """Google solo manda el refresh token con prompt=consent. Si llega sin
        él, pisarlo dejaría la cuenta sin poder refrescarse."""
        flujo = self._flujo(cliente)
        canje_falso(monkeypatch)
        self._volver(cliente, flujo, codigo="c")

        otro = self._flujo(cliente)
        canje_falso(
            monkeypatch,
            respuesta=respuesta_del_canje(
                access_token="ya29.token-nuevo", refresh_token=None
            ),
        )
        self._volver(cliente, otro, codigo="c2")

        cuenta = CuentaConectada.objects.get()
        assert str(cuenta.access_token) == "ya29.token-nuevo"
        assert str(cuenta.refresh_token) == RESPUESTA_DEL_CANJE["refresh_token"]


# ══════════════════════════════════════════════════════════════════════
# FE-05 — desconectar y revocar
# ══════════════════════════════════════════════════════════════════════


def revocacion_falsa(monkeypatch, confirma=True):
    llamadas = []

    def falsa(proveedor, *, access_token):
        llamadas.append({"proveedor": proveedor, "access_token": access_token})
        return confirma

    monkeypatch.setattr(proveedores, "revocar", falsa)
    return llamadas


@pytest.fixture
def cuenta(claves):
    return CuentaConectada.objects.create(
        organizacion_id=ORG_A,
        proveedor="gmail",
        cuenta_externa="persona@gmail.com",
        access_token="ya29.token-vivo",
        refresh_token="1//refresh-vivo",
        token_expira_en=timezone.now() + timedelta(hours=1),
    )


class TestDesconectar:
    def test_cuando_el_proveedor_confirma_se_borran_las_credenciales(
        self, cliente, cuenta, monkeypatch
    ):
        llamadas = revocacion_falsa(monkeypatch, confirma=True)
        respuesta = cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))

        assert respuesta.status_code == status.HTTP_200_OK
        assert llamadas[0]["access_token"] == "ya29.token-vivo"

        cuenta.refresh_from_db()
        assert cuenta.estado == CuentaConectada.Estado.DESCONECTADA
        assert cuenta.access_token is None
        assert cuenta.refresh_token is None
        assert cuenta.token_expira_en is None
        # La evidencia que consume la limpieza coordinada de #72.
        assert cuenta.revocado_en is not None

    def test_cuando_NO_confirma_el_token_se_conserva_para_reintentar(
        self, cliente, cuenta, monkeypatch
    ):
        """El hallazgo de la revisión: borrar la única credencial de reintento
        convierte la revocación en imposible, no en pendiente."""
        revocacion_falsa(monkeypatch, confirma=False)
        respuesta = cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))

        assert respuesta.status_code == status.HTTP_200_OK
        cuenta.refresh_from_db()
        # Desconectada igual: dejar de leer no depende del proveedor.
        assert cuenta.estado == CuentaConectada.Estado.DESCONECTADA
        # Pero el token sigue, cifrado, para poder reintentar.
        assert str(cuenta.access_token) == "ya29.token-vivo"
        # Y NO se da por revocada.
        assert cuenta.revocado_en is None
        assert "no confirmó" in cuenta.detalle_del_estado

    def test_con_access_vencido_se_intenta_con_el_refresh(
        self, cliente, claves, monkeypatch
    ):
        """Antes no se intentaba siquiera: solo miraba el access_token, así que
        las cuentas más viejas —las que ya tenían el access vencido— se
        quedaban sin revocar y encima perdían el refresh."""
        sin_access = CuentaConectada.objects.create(
            organizacion_id=ORG_A,
            proveedor="gmail",
            cuenta_externa="vieja@gmail.com",
            refresh_token="1//solo-refresh",
        )
        llamadas = revocacion_falsa(monkeypatch, confirma=True)
        respuesta = cliente.delete(f"{LISTA}{sin_access.id}/", headers=cabecera(ORG_A))

        assert respuesta.status_code == status.HTTP_200_OK
        assert llamadas and llamadas[0]["access_token"] == "1//solo-refresh"
        sin_access.refresh_from_db()
        assert sin_access.revocado_en is not None

    def test_la_fila_no_se_borra(self, cliente, cuenta, monkeypatch):
        """Los cobros ya importados apuntan acá; borrarla los dejaría huérfanos."""
        revocacion_falsa(monkeypatch)
        cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))
        assert CuentaConectada.objects.filter(pk=cuenta.pk).exists()

    def test_desconectar_impide_nuevas_lecturas(self, cliente, cuenta, monkeypatch):
        """Criterio: desconectar impide nuevas lecturas.

        FE-13 leerá el correo de las cuentas en estado `conectada`. Al pasar a
        `desconectada` deja de entrar en esa selección — incluso cuando el
        token se conserva para reintentar la revocación.
        """
        revocacion_falsa(monkeypatch, confirma=False)
        cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))

        legibles = CuentaConectada.objects.filter(
            organizacion_id=ORG_A, estado=CuentaConectada.Estado.CONECTADA
        )
        assert cuenta not in list(legibles)

    def test_otra_organizacion_no_puede_desconectarla(
        self, cliente, cuenta, monkeypatch
    ):
        """Criterio: otra organización no puede revocar ni consultar esa cuenta."""
        llamadas = revocacion_falsa(monkeypatch)
        respuesta = cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_B))

        # 404 y no 403: para ORG_B esa cuenta no existe. Un 403 confirmaría
        # que el id es de alguien.
        assert respuesta.status_code == status.HTTP_404_NOT_FOUND
        assert llamadas == []
        cuenta.refresh_from_db()
        assert cuenta.estado == CuentaConectada.Estado.CONECTADA
        assert cuenta.access_token is not None

    def test_sin_cabecera_no_se_desconecta_nada(self, cliente, cuenta, monkeypatch):
        revocacion_falsa(monkeypatch)
        respuesta = cliente.delete(f"{LISTA}{cuenta.id}/")
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN
        cuenta.refresh_from_db()
        assert cuenta.estado == CuentaConectada.Estado.CONECTADA

    def test_una_cuenta_sin_token_se_desconecta_sin_llamar_al_proveedor(
        self, cliente, claves, monkeypatch
    ):
        sin_token = CuentaConectada.objects.create(
            organizacion_id=ORG_A, proveedor="csv", cuenta_externa="cartola.csv"
        )
        llamadas = revocacion_falsa(monkeypatch)
        respuesta = cliente.delete(f"{LISTA}{sin_token.id}/", headers=cabecera(ORG_A))

        assert respuesta.status_code == status.HTTP_200_OK
        assert llamadas == []
        sin_token.refresh_from_db()
        assert sin_token.estado == CuentaConectada.Estado.DESCONECTADA
        # Sin token no hubo nada que revocar, así que NO se acredita revocación.
        assert sin_token.revocado_en is None

    def test_desconectar_dos_veces_no_falla(self, cliente, cuenta, monkeypatch):
        revocacion_falsa(monkeypatch)
        cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))
        segunda = cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))
        assert segunda.status_code == status.HTTP_200_OK

    def test_sigue_sin_poder_crearse_ni_editarse_por_la_API(self, cliente, cuenta):
        """El DELETE se agregó; el POST y el PUT siguen cerrados."""
        assert cliente.post(LISTA, {}, format="json", headers=cabecera()).status_code == 405
        assert cliente.put(
            f"{LISTA}{cuenta.id}/", {}, format="json", headers=cabecera()
        ).status_code == 405


# ══════════════════════════════════════════════════════════════════════
# FE-05 — el reintento de las revocaciones pendientes
# ══════════════════════════════════════════════════════════════════════


class TestReintento:
    """Sin esto, "pendiente" sería un estado del que no se sale nunca."""

    def _desconectar_sin_confirmar(self, cliente, cuenta, monkeypatch):
        revocacion_falsa(monkeypatch, confirma=False)
        cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))
        cuenta.refresh_from_db()
        return cuenta

    def test_la_cuenta_sin_confirmar_queda_en_la_lista_de_pendientes(
        self, cliente, cuenta, monkeypatch
    ):
        from connectors.revocacion import pendientes_de_revocar

        self._desconectar_sin_confirmar(cliente, cuenta, monkeypatch)
        assert list(pendientes_de_revocar()) == [cuenta]

    def test_la_confirmada_no_queda_pendiente(self, cliente, cuenta, monkeypatch):
        from connectors.revocacion import pendientes_de_revocar

        revocacion_falsa(monkeypatch, confirma=True)
        cliente.delete(f"{LISTA}{cuenta.id}/", headers=cabecera(ORG_A))
        assert list(pendientes_de_revocar()) == []

    def test_en_seco_no_toca_nada(self, cliente, cuenta, monkeypatch):
        from io import StringIO

        from django.core.management import call_command

        self._desconectar_sin_confirmar(cliente, cuenta, monkeypatch)
        llamadas = revocacion_falsa(monkeypatch, confirma=True)
        salida = StringIO()
        call_command("reintentar_revocaciones", stdout=salida)

        assert "Modo ensayo" in salida.getvalue()
        assert llamadas == []
        cuenta.refresh_from_db()
        assert cuenta.revocado_en is None

    def test_con_aplicar_reintenta_y_confirma(self, cliente, cuenta, monkeypatch):
        from io import StringIO

        from django.core.management import call_command

        self._desconectar_sin_confirmar(cliente, cuenta, monkeypatch)
        llamadas = revocacion_falsa(monkeypatch, confirma=True)
        call_command("reintentar_revocaciones", aplicar=True, stdout=StringIO())

        assert llamadas and llamadas[0]["access_token"] == "ya29.token-vivo"
        cuenta.refresh_from_db()
        assert cuenta.revocado_en is not None
        assert cuenta.access_token is None

    def test_si_sigue_sin_confirmar_conserva_el_token(
        self, cliente, cuenta, monkeypatch
    ):
        from io import StringIO

        from django.core.management import call_command

        self._desconectar_sin_confirmar(cliente, cuenta, monkeypatch)
        revocacion_falsa(monkeypatch, confirma=False)
        call_command("reintentar_revocaciones", aplicar=True, stdout=StringIO())

        cuenta.refresh_from_db()
        assert cuenta.revocado_en is None
        assert str(cuenta.access_token) == "ya29.token-vivo"

    def test_no_toca_las_cuentas_conectadas(self, cliente, cuenta, monkeypatch):
        """Solo mira las desconectadas sin confirmar."""
        from connectors.revocacion import pendientes_de_revocar

        assert cuenta.estado == CuentaConectada.Estado.CONECTADA
        assert list(pendientes_de_revocar()) == []
