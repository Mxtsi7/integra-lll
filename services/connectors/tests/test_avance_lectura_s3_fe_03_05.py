"""S3-FE-03 / S3-FE-05 — guardar hasta dónde se leyó cada cuenta de correo.

Criterios:
- FE-03: reanudar no relee indefinidamente ni pierde mensajes tras un fallo;
  cuentas distintas conservan cursores separados.
- FE-05: reiniciar retoma el avance correcto; un cursor inválido no elimina
  evidencia ni provoca duplicados.

La mayoría usa un lector de prueba que entrega páginas programadas: lo que se
prueba aquí es el cursor, no el proveedor. Al final, los lectores REALES de
Gmail y Outlook con `requests` reemplazado, para ver que el `pageToken` y la
`@odata.nextLink` viajan bien.
"""

import uuid
from datetime import datetime, timedelta, timezone as tz

import pytest
from django.utils import timezone

from connectors import lector_gmail, lector_outlook
from connectors.avance_lectura import SOLAPE, VENTANA_INICIAL, leer_siguiente_lote
from connectors.lectura_correo import (
    CuentaNoDisponible,
    ErrorDelProveedor,
    ErrorTransitorio,
    MensajeCorreo,
    PaginaDeMensajes,
)
from connectors.models import AvanceDeLectura, CuentaConectada
from connectors.origen_correo import identificador_de

pytestmark = pytest.mark.django_db

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTRA = uuid.UUID("22222222-2222-2222-2222-222222222222")
LUNES = datetime(2026, 11, 16, 12, 0, tzinfo=tz.utc)


def mensaje(cuenta, n):
    return MensajeCorreo(
        cuenta_id=cuenta.pk, id_mensaje=f"m{n}", id_hilo="", recibido_en=LUNES - timedelta(hours=n),
        remitente="Netflix <info@netflix.com>", asunto="Tu recibo", texto="", proveedor_correo="gmail",
        message_id=f"m{n}@netflix.com",
    )


def pagina(cuenta, *numeros, siguiente=None):
    return PaginaDeMensajes(tuple(mensaje(cuenta, n) for n in numeros), siguiente)


class LectorFalso:
    """Entrega la página que corresponde a cada cursor. Una entrada puede ser
    una excepción, o una función que se llama al leer (algo que pasa mientras
    la petición está en vuelo)."""

    PROVEEDOR = "gmail"

    def __init__(self, paginas):
        self.paginas = paginas
        self.llamadas = []

    def leer_mensajes(self, *, organizacion_id, cuenta_id, filtro=None, pagina=None, limite=25):
        self.llamadas.append({"pagina": pagina, "filtro": filtro, "limite": limite})
        respuesta = self.paginas[pagina]
        if isinstance(respuesta, list):
            respuesta = respuesta.pop(0) if len(respuesta) > 1 else respuesta[0]
        if callable(respuesta) and not isinstance(respuesta, type):
            respuesta = respuesta()
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta


class Procesado:
    def __init__(self, fallar=0):
        self.lotes = []
        self.fallar = fallar

    def __call__(self, lote):
        if self.fallar:
            self.fallar -= 1
            raise RuntimeError("la base se cayó a mitad del lote")
        self.lotes.append([m.id_mensaje for m in lote.mensajes])

    @property
    def ids(self):
        return [i for lote in self.lotes for i in lote]


def cuenta(*, org=ORG, correo="p@gmail.com", proveedor="gmail"):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=correo,
        access_token="tok", refresh_token="ref", token_expira_en=timezone.now() + timedelta(minutes=50),
    )


def lote(lector, c, procesar, ahora=LUNES, **extra):
    return leer_siguiente_lote(lector, organizacion_id=c.organizacion_id, cuenta_id=c.pk, procesar=procesar,
                               ahora=ahora, **extra)


def avance(c):
    return AvanceDeLectura.objects.get(cuenta=c)


# ══════════════════════════════════════════════════════════════════════
# FE-03 — una corrida, página por página
# ══════════════════════════════════════════════════════════════════════


class TestCorrida:
    def test_la_primera_corrida_mira_la_ventana_inicial_y_no_el_buzon_entero(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1)})
        lote(lector, c, Procesado())
        filtro = lector.llamadas[0]["filtro"]
        assert (filtro.desde, filtro.hasta) == (LUNES - VENTANA_INICIAL, LUNES)

    def test_dos_paginas_y_la_corrida_termina(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, 2, siguiente="tok-2"), "tok-2": pagina(c, 3)})
        procesado = Procesado()

        primero = lote(lector, c, procesado)
        assert (primero.mensajes, primero.corrida_terminada) == (2, False)
        assert (avance(c).pagina, avance(c).leido_hasta, avance(c).corrida_hasta) == ("tok-2", None, LUNES)

        segundo = lote(lector, c, procesado, ahora=LUNES + timedelta(hours=1))
        assert segundo.corrida_terminada
        a = avance(c)
        # La marca es el TOPE de la corrida, no el momento en que terminó.
        assert (a.leido_hasta, a.corrida_hasta, a.pagina, a.corridas_completadas) == (LUNES, None, "", 1)
        assert procesado.ids == ["m1", "m2", "m3"]
        assert [l["pagina"] for l in lector.llamadas] == [None, "tok-2"]

    def test_la_corrida_siguiente_empieza_donde_termino_la_anterior_con_solape(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1)})
        lote(lector, c, Procesado())
        martes = LUNES + timedelta(days=1)
        lote(lector, c, Procesado(), ahora=martes)
        filtro = lector.llamadas[1]["filtro"]
        assert (filtro.desde, filtro.hasta) == (LUNES - SOLAPE, martes)

    def test_dentro_de_una_corrida_el_tope_no_se_mueve(self, claves):
        """No releer para siempre: lo que llegue durante la corrida es de la
        próxima, no alarga esta."""
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, siguiente="tok-2"), "tok-2": pagina(c, 2)})
        lote(lector, c, Procesado(), ahora=LUNES)
        lote(lector, c, Procesado(), ahora=LUNES + timedelta(hours=5))
        assert [l["filtro"].hasta for l in lector.llamadas] == [LUNES, LUNES]

    def test_el_limite_llega_al_lector(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1)})
        lote(lector, c, Procesado(), limite=7)
        assert lector.llamadas[0]["limite"] == 7


class TestFallos:
    def test_si_procesar_falla_el_cursor_no_se_mueve_y_se_relee_la_misma_pagina(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, 2, siguiente="tok-2"), "tok-2": pagina(c, 3, siguiente="tok-3"),
                              "tok-3": pagina(c, 4)})
        procesado = Procesado()
        lote(lector, c, procesado)

        con_falla = Procesado(fallar=1)
        with pytest.raises(RuntimeError):
            lote(lector, c, con_falla)
        assert avance(c).pagina == "tok-2"

        lote(lector, c, procesado)
        lote(lector, c, procesado)
        # Ni uno perdido, y la página que falló se leyó de nuevo.
        assert procesado.ids == ["m1", "m2", "m3", "m4"]
        assert [l["pagina"] for l in lector.llamadas] == [None, "tok-2", "tok-2", "tok-3"]
        assert avance(c).leido_hasta == LUNES

    def test_un_error_del_proveedor_deja_el_cursor_intacto(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, siguiente="tok-2"),
                              "tok-2": [ErrorTransitorio("Gmail falló (503)."), pagina(c, 2)]})
        procesado = Procesado()
        lote(lector, c, procesado)
        with pytest.raises(ErrorTransitorio):
            lote(lector, c, procesado)
        assert (avance(c).pagina, avance(c).corrida_hasta) == ("tok-2", LUNES)
        assert lote(lector, c, procesado).corrida_terminada
        assert procesado.ids == ["m1", "m2"]

    def test_una_cuenta_que_no_se_puede_leer_no_mueve_nada(self, claves):
        c = cuenta()
        CuentaConectada.objects.filter(pk=c.pk).update(estado="desconectada")
        with pytest.raises(CuentaNoDisponible):
            lote(lector_gmail, c, Procesado())
        a = avance(c)
        assert (a.pagina, a.leido_hasta, a.corridas_completadas) == ("", None, 0)


class TestCuentasSeparadas:
    def test_cada_cuenta_tiene_su_cursor(self, claves):
        a, b = cuenta(correo="a@gmail.com"), cuenta(correo="b@gmail.com")
        lector_a = LectorFalso({None: pagina(a, 1, siguiente="a-2"), "a-2": pagina(a, 2)})
        lector_b = LectorFalso({None: pagina(b, 7, siguiente="b-2"), "b-2": pagina(b, 8)})
        lote(lector_a, a, Procesado())
        lote(lector_b, b, Procesado())
        assert (avance(a).pagina, avance(b).pagina) == ("a-2", "b-2")
        lote(lector_a, a, Procesado())
        assert (avance(a).leido_hasta, avance(b).leido_hasta) == (LUNES, None)
        assert avance(b).pagina == "b-2"

    def test_una_cuenta_de_otra_organizacion_no_se_toca(self, claves):
        ajena = cuenta(org=OTRA)
        with pytest.raises(CuentaConectada.DoesNotExist):
            leer_siguiente_lote(LectorFalso({}), organizacion_id=ORG, cuenta_id=ajena.pk, procesar=Procesado())
        assert not AvanceDeLectura.objects.exists()

    def test_el_avance_es_de_la_organizacion_de_la_cuenta(self, claves):
        c = cuenta(org=OTRA)
        lote(LectorFalso({None: pagina(c, 1)}), c, Procesado())
        assert avance(c).organizacion_id == OTRA


# ══════════════════════════════════════════════════════════════════════
# FE-05 — un cursor que el proveedor ya no acepta
# ══════════════════════════════════════════════════════════════════════


class TestCursorInvalido:
    @pytest.mark.parametrize("rechazo", [
        ErrorDelProveedor("Gmail rechazó la consulta (400, invalidArgument)."),
        ValueError("`pagina` no es una página de mensajes de Microsoft Graph."),
    ])
    def test_vuelve_al_inicio_de_la_misma_corrida(self, claves, rechazo):
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1, 2)], "vencido": rechazo})
        procesado = Procesado()
        lote(lector, c, procesado)

        resultado = lote(lector, c, procesado)

        assert resultado.reiniciada and resultado.corrida_terminada
        a = avance(c)
        assert (a.leido_hasta, a.reinicios_por_pagina_invalida) == (LUNES, 1)
        # Mismo tope: el reinicio relee esta corrida, no amplía ni achica.
        assert [l["filtro"].hasta for l in lector.llamadas] == [LUNES, LUNES, LUNES]
        assert [l["pagina"] for l in lector.llamadas] == [None, "vencido", None]

    def test_releer_entrega_los_mismos_mensajes_con_la_misma_identidad(self, claves):
        """Lo que se relee tras un reinicio trae la misma identidad (el
        Message-ID, S3-FE-06), que es la llave única de los candidatos: no se
        duplica. Nada se borra: el avance solo sube su contador."""
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1, 2)],
                              "vencido": ErrorDelProveedor("400")})
        identidades = []

        def procesar(lote_):
            identidades.extend(identificador_de(m) for m in lote_.mensajes)

        lote(lector, c, procesar)
        lote(lector, c, procesar)
        assert len(identidades) == 3 and len(set(identidades)) == 2

    def test_sin_pagina_guardada_el_error_no_es_del_cursor(self, claves):
        c = cuenta()
        lector = LectorFalso({None: ErrorDelProveedor("La API de Gmail no está habilitada.")})
        with pytest.raises(ErrorDelProveedor):
            lote(lector, c, Procesado())
        assert avance(c).reinicios_por_pagina_invalida == 0
        assert len(lector.llamadas) == 1

    def test_si_el_reinicio_falla_al_procesar_no_cuenta(self, claves):
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1)], "vencido": ErrorDelProveedor("400")})
        lote(lector, c, Procesado())
        with pytest.raises(RuntimeError):
            lote(lector, c, Procesado(fallar=1))
        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida, a.leido_hasta) == ("vencido", 0, None)


class TestDosWorkers:
    def test_si_otro_worker_movio_el_cursor_esta_pagina_no_se_procesa(self, claves):
        c = cuenta()

        def otro_worker_avanza():
            AvanceDeLectura.objects.filter(cuenta=c).update(pagina="tok-del-otro")
            return pagina(c, 1, siguiente="tok-2")

        lector = LectorFalso({None: otro_worker_avanza})
        procesado = Procesado()
        resultado = lote(lector, c, procesado)
        assert resultado.descartado
        assert procesado.lotes == []
        assert avance(c).pagina == "tok-del-otro"


# ══════════════════════════════════════════════════════════════════════
# Con los lectores reales
# ══════════════════════════════════════════════════════════════════════


class _Respuesta:
    def __init__(self, status_code, cuerpo):
        self.status_code = status_code
        self._cuerpo = cuerpo
        self.headers = {}

    def json(self):
        return self._cuerpo


class TestConLosLectoresReales:
    def test_gmail_guarda_y_manda_el_page_token(self, claves, monkeypatch):
        c = cuenta()
        listas = [{"messages": [], "nextPageToken": "09876543210"}, {"messages": []}]
        pedidos = []

        def get(url, params=None, headers=None, timeout=None):
            pedidos.append(dict(params or {}))
            return _Respuesta(200, listas.pop(0))

        monkeypatch.setattr(lector_gmail.requests, "get", get)
        lote(lector_gmail, c, Procesado())
        assert avance(c).pagina == "09876543210"
        assert lote(lector_gmail, c, Procesado()).corrida_terminada
        assert "pageToken" not in pedidos[0] and pedidos[1]["pageToken"] == "09876543210"
        assert pedidos[1]["q"].startswith(f"after:{int((LUNES - VENTANA_INICIAL).timestamp())} before:")

    def test_outlook_guarda_la_next_link_y_se_recupera_si_vence(self, claves, monkeypatch):
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        siguiente = "https://graph.microsoft.com/v1.0/me/messages?%24top=25&%24skiptoken=abc"
        respuestas = [
            _Respuesta(200, {"value": [], "@odata.nextLink": siguiente}),
            # El skiptoken venció: Graph lo rechaza.
            _Respuesta(400, {"error": {"code": "ErrorInvalidRequest", "message": "..."}}),
            _Respuesta(200, {"value": []}),
        ]
        pedidos = []

        def get(url, params=None, headers=None, timeout=None, allow_redirects=False):
            pedidos.append(url)
            return respuestas.pop(0)

        monkeypatch.setattr(lector_outlook.requests, "get", get)
        lote(lector_outlook, c, Procesado())
        assert avance(c).pagina == siguiente
        resultado = lote(lector_outlook, c, Procesado())
        assert resultado.reiniciada and resultado.corrida_terminada
        assert pedidos == [lector_outlook.URL_MENSAJES, siguiente, lector_outlook.URL_MENSAJES]
