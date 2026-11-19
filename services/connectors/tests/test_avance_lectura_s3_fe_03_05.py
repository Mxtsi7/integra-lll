"""S3-FE-03 / S3-FE-05 — guardar hasta dónde se leyó cada cuenta de correo.

Criterios:
- FE-03: reanudar no relee indefinidamente ni pierde mensajes tras un fallo;
  cuentas distintas conservan cursores separados.
- FE-05: reiniciar retoma el avance correcto; un cursor inválido no elimina
  evidencia ni provoca duplicados.

La mayoría usa un lector de prueba que entrega páginas programadas: lo que se
prueba aquí es el cursor, no el proveedor. Al final, los lectores REALES de
Gmail y Outlook con `requests` reemplazado, para ver que el `pageToken` y el
cursor por fecha de Outlook viajan bien, y las aceptaciones de la revisión de
#189: Outlook con más de 1000 coincidencias (P1), que solo un rechazo
explícito del cursor reinicie (P2) y, en la ronda 3, un reinicio por corrida
y un borrado a mitad de corrida en Outlook. Los dos workers con dos conexiones a PostgreSQL
están en `test_carrera_avance_lectura_postgres.py`.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone as tz
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from django.utils import timezone

from connectors import lector_gmail, lector_outlook
from connectors.avance_lectura import SOLAPE, VENTANA_INICIAL, descartar_corrida, leer_siguiente_lote
from connectors.lectura_correo import (
    CuentaNoDisponible,
    CursorRechazado,
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
    """Solo un rechazo EXPLÍCITO del cursor (`CursorRechazado`) reinicia la
    corrida; cualquier otro error sale con el avance intacto (revisión de
    #189, P2). Con los lectores reales, más abajo."""

    def test_vuelve_al_inicio_de_la_misma_corrida(self, claves):
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1, 2)],
                              "vencido": CursorRechazado("Gmail rechazó la página siguiente (400).")})
        procesado = Procesado()
        lote(lector, c, procesado)

        resultado = lote(lector, c, procesado)

        assert resultado.reiniciada and resultado.corrida_terminada
        a = avance(c)
        assert (a.leido_hasta, a.reinicios_por_pagina_invalida) == (LUNES, 1)
        # Mismo tope: el reinicio relee esta corrida, no amplía ni achica.
        assert [l["filtro"].hasta for l in lector.llamadas] == [LUNES, LUNES, LUNES]
        assert [l["pagina"] for l in lector.llamadas] == [None, "vencido", None]

    @pytest.mark.parametrize("error", [
        ErrorDelProveedor("Gmail respondió algo que no es JSON."),
        ErrorDelProveedor("La API de Gmail no está habilitada.", codigo="api_deshabilitada"),
        ValueError("`pagina` no es una página de mensajes de Microsoft Graph."),
    ], ids=["json-ilegible", "api-deshabilitada", "pagina-que-el-lector-no-reconoce"])
    def test_otro_error_con_pagina_guardada_sale_tal_cual_y_no_reinicia(self, claves, error):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, siguiente="tok-2"), "tok-2": error})
        procesado = Procesado()
        lote(lector, c, procesado)

        for _ in range(3):  # ni a la primera ni a la tercera: no hay bucle
            with pytest.raises(type(error)):
                lote(lector, c, procesado)

        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida, a.leido_hasta) == ("tok-2", 0, None)
        assert procesado.ids == ["m1"], "se volvió a procesar la primera página"
        assert [l["pagina"] for l in lector.llamadas] == [None, "tok-2", "tok-2", "tok-2"]

    def test_releer_entrega_los_mismos_mensajes_con_la_misma_identidad(self, claves):
        """Lo que se relee tras un reinicio trae la misma identidad (el
        Message-ID, S3-FE-06), que es la llave única de los candidatos: no se
        duplica. Nada se borra: el avance solo sube su contador."""
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1, 2)],
                              "vencido": CursorRechazado("400")})
        identidades = []

        def procesar(lote_):
            identidades.extend(identificador_de(m) for m in lote_.mensajes)

        lote(lector, c, procesar)
        lote(lector, c, procesar)
        assert len(identidades) == 3 and len(set(identidades)) == 2

    def test_sin_pagina_guardada_el_error_no_es_del_cursor(self, claves):
        c = cuenta()
        lector = LectorFalso({None: CursorRechazado("400")})
        with pytest.raises(CursorRechazado):
            lote(lector, c, Procesado())
        assert avance(c).reinicios_por_pagina_invalida == 0
        assert len(lector.llamadas) == 1

    def test_si_el_reinicio_falla_al_procesar_no_cuenta(self, claves):
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1)],
                              "vencido": CursorRechazado("400")})
        lote(lector, c, Procesado())
        with pytest.raises(RuntimeError):
            lote(lector, c, Procesado(fallar=1))
        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida, a.leido_hasta) == ("vencido", 0, None)

    def test_si_al_reiniciar_vuelve_el_mismo_cursor_rechazado_no_se_guarda_ni_se_procesa(self, claves):
        """El proveedor rechaza la página B y, al empezar de nuevo, entrega
        otra vez B como siguiente: reiniciar no lleva a ninguna parte. Sin
        esto, cada llamada procesaría la primera página y volvería a guardar
        B, respondiendo éxito para siempre."""
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, siguiente="B"), "B": CursorRechazado("400")})
        procesado = Procesado()
        lote(lector, c, procesado)

        with pytest.raises(ErrorDelProveedor) as error:
            lote(lector, c, procesado)

        assert error.value.codigo == "reinicio_sin_avance"
        assert isinstance(error.value.__cause__, CursorRechazado)
        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida, a.leido_hasta) == ("B", 0, None)
        assert procesado.ids == ["m1"]


class TestUnReinicioPorCorrida:
    """Revisión de #189, ronda 3 (P2): la guarda del mismo cursor solo cortaba
    un ciclo de un paso. Si la página C (la tercera) se rechazaba siempre, la
    corrida volvía al inicio cada dos llamadas, para siempre, respondiendo
    éxito y sin que la marca avanzara. Ahora una corrida se reinicia una vez
    como mucho: el segundo rechazo es un error."""

    def test_un_rechazo_que_persiste_en_la_tercera_pagina_reinicia_una_vez_y_despues_es_un_error(self, claves):
        c = cuenta()
        lector = LectorFalso({None: pagina(c, 1, siguiente="B"), "B": pagina(c, 2, siguiente="C"),
                              "C": CursorRechazado("Gmail rechazó la página siguiente (400).")})
        procesado = Procesado()
        lote(lector, c, procesado)
        lote(lector, c, procesado)
        assert lote(lector, c, procesado).reiniciada  # C rechazada: vuelve al inicio
        assert avance(c).reiniciada_en_corrida
        lote(lector, c, procesado)  # B otra vez, y guarda C

        for _ in range(3):  # ni a la primera ni a la tercera: no hay bucle
            with pytest.raises(ErrorDelProveedor) as error:
                lote(lector, c, procesado)
            assert error.value.codigo == "cursor_rechazado_otra_vez"
            assert isinstance(error.value.__cause__, CursorRechazado)

        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida, a.leido_hasta, a.corrida_hasta) == ("C", 1, None, LUNES)
        assert procesado.ids == ["m1", "m2", "m1", "m2"], "se procesó algo después del segundo rechazo"
        # Tras el segundo rechazo no se vuelve a pedir la primera página.
        assert [l["pagina"] for l in lector.llamadas][-3:] == ["C", "C", "C"]

    def test_la_corrida_siguiente_puede_reiniciarse_otra_vez(self, claves):
        """La marca de «ya se reinició» es de la corrida, no de la cuenta."""
        c = cuenta()
        lector = LectorFalso({
            None: [pagina(c, 1, siguiente="vencido"), pagina(c, 1), pagina(c, 1, siguiente="vencido"), pagina(c, 1)],
            "vencido": CursorRechazado("400"),
        })
        lote(lector, c, Procesado())
        assert lote(lector, c, Procesado()).reiniciada
        assert not avance(c).reiniciada_en_corrida, "la marca quedó puesta al terminar la corrida"

        martes = LUNES + timedelta(days=1)
        lote(lector, c, Procesado(), ahora=martes)
        resultado = lote(lector, c, Procesado(), ahora=martes)

        assert resultado.reiniciada and resultado.corrida_terminada
        assert (avance(c).reinicios_por_pagina_invalida, avance(c).corridas_completadas) == (2, 2)


class TestDescartarCorrida:
    """Cómo se saca a mano una cuenta detenida (documento 29): se descarta la
    corrida a medias y la siguiente empieza desde la marca, que no se movió."""

    def test_una_cuenta_detenida_vuelve_a_leer_desde_la_marca(self, claves):
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1), pagina(c, 2, siguiente="B"), pagina(c, 3)],
                              "B": ValueError("`pagina` no es una página que este lector reconozca.")})
        lote(lector, c, Procesado())  # la primera corrida termina: leído hasta el lunes
        martes = LUNES + timedelta(days=1)
        lote(lector, c, Procesado(), ahora=martes)
        with pytest.raises(ValueError):
            lote(lector, c, Procesado(), ahora=martes)  # detenida en B

        assert descartar_corrida(organizacion_id=ORG, cuenta_id=c.pk)

        a = avance(c)
        assert (a.corrida_hasta, a.pagina, a.reiniciada_en_corrida) == (None, "", False)
        # Lo que ya se sabía no se toca.
        assert (a.leido_hasta, a.corridas_completadas) == (LUNES, 1)
        miercoles = martes + timedelta(days=1)
        assert lote(lector, c, Procesado(), ahora=miercoles).corrida_terminada
        llamada = lector.llamadas[-1]
        assert llamada["pagina"] is None
        assert (llamada["filtro"].desde, llamada["filtro"].hasta) == (LUNES - SOLAPE, miercoles)

    def test_despues_del_segundo_rechazo_tambien_se_puede_reiniciar(self, claves):
        c = cuenta()
        lector = LectorFalso({None: [pagina(c, 1, siguiente="X"), pagina(c, 1, siguiente="X"), pagina(c, 1)],
                              "X": [pagina(c, 2, siguiente="Y"), pagina(c, 2, siguiente="Y")],
                              "Y": CursorRechazado("400")})
        for _ in range(4):
            lote(lector, c, Procesado())
        with pytest.raises(ErrorDelProveedor, match="otra"):
            lote(lector, c, Procesado())
        assert avance(c).reiniciada_en_corrida

        descartar_corrida(organizacion_id=ORG, cuenta_id=c.pk)

        assert not avance(c).reiniciada_en_corrida
        assert lote(lector, c, Procesado(), ahora=LUNES + timedelta(hours=1)).corrida_terminada

    def test_sin_corrida_a_medias_no_hay_nada_que_descartar(self, claves):
        c = cuenta()
        assert not descartar_corrida(organizacion_id=ORG, cuenta_id=c.pk)
        lote(LectorFalso({None: pagina(c, 1)}), c, Procesado())
        assert not descartar_corrida(organizacion_id=ORG, cuenta_id=c.pk)
        assert avance(c).leido_hasta == LUNES

    def test_la_de_otra_organizacion_no_se_toca(self, claves):
        ajena = cuenta(org=OTRA)
        lote(LectorFalso({None: pagina(ajena, 1, siguiente="B")}), ajena, Procesado())
        assert not descartar_corrida(organizacion_id=ORG, cuenta_id=ajena.pk)
        assert (avance(ajena).corrida_hasta, avance(ajena).pagina) == (LUNES, "B")


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
        if isinstance(self._cuerpo, Exception):
            raise self._cuerpo
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

    def test_outlook_guarda_su_cursor_por_fecha_y_un_400_con_el_no_reinicia(self, claves, monkeypatch):
        """El cursor de Outlook lo arma su lector (revisión de #189, ronda 3):
        Graph no lo conoce y no tiene cómo vencer. Un 400 al seguirlo es un
        error de la consulta: sale tal cual, con el cursor guardado."""
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        uno, dos = LUNES - timedelta(hours=1), LUNES - timedelta(hours=2)
        respuestas = [
            _Respuesta(200, {"value": [correo_graph("m1", recibido=uno)],
                             "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?%24skip=1"}),
            _Respuesta(400, {"error": {"code": "ErrorInvalidRequest", "message": "..."}}),
            _Respuesta(200, {"value": [correo_graph("m1", recibido=uno), correo_graph("m2", recibido=dos)]}),
        ]
        pedidos = []

        def get(url, params=None, headers=None, timeout=None, allow_redirects=False):
            pedidos.append((url, dict(params or {})))
            return respuestas.pop(0)

        monkeypatch.setattr(lector_outlook.requests, "get", get)
        procesado = Procesado()
        lote(lector_outlook, c, procesado)
        guardado = avance(c).pagina
        assert guardado.startswith("antes-de=20261116T110001Z&vistos=")

        with pytest.raises(ErrorDelProveedor) as error:
            lote(lector_outlook, c, procesado)
        assert not isinstance(error.value, CursorRechazado)
        assert (avance(c).pagina, avance(c).reinicios_por_pagina_invalida) == (guardado, 0)

        assert lote(lector_outlook, c, procesado).corrida_terminada
        assert procesado.ids == ["m1", "m2"]
        # Nunca se pidió otra URL que la de la lista, y la página siguiente
        # es la misma consulta con el corte.
        assert {url for url, _ in pedidos} == {lector_outlook.URL_MENSAJES}
        assert pedidos[2][1]["$filter"].endswith("receivedDateTime lt 2026-11-16T11:00:01Z")


# ══════════════════════════════════════════════════════════════════════
# Revisión de #189, P1 — Outlook con más de 1000 coincidencias
# ══════════════════════════════════════════════════════════════════════
#
# `$search` de Graph entrega 1000 resultados como mucho y los ordena por fecha
# de ENVÍO (https://learn.microsoft.com/en-us/graph/search-query-parameter).
# Si el lector buscaba con `$search`, que no viniera `@odata.nextLink` no
# quería decir que la ventana se hubiera leído entera, y la marca avanzaba
# igual.


class BuzonDeGraph:
    """Un buzón de Outlook detrás de un Graph falso que respeta lo que importa
    aquí, tal como lo documenta Microsoft:

    - `$filter` por `receivedDateTime` (`ge`/`lt`), `$orderby receivedDateTime
      desc`, `$top`, y la página siguiente con `$skip`, sin tope;
    - `$search`: ordena por fecha de envío y entrega 1000 como mucho;
    - la fecha se muestra al segundo, pero se filtra y se ordena con la que
      guarda el buzón, que puede traer fracción (`_interno`, si la hay).

    Puede fallar una petición (un 503) para ver que un corte a mitad de
    camino tampoco adelanta la marca, y se puede borrar un correo a mitad de
    camino (`borrar`).
    """

    TOPE_DE_SEARCH = 1000

    def __init__(self, mensajes, *, falla_en_la_peticion=None):
        self.mensajes = mensajes
        self.consultas = []
        self.falla_en_la_peticion = falla_en_la_peticion

    def borrar(self, *identificadores):
        """Borrado definitivo (vaciar «Elementos eliminados»): el correo deja
        de aparecer en cualquier consulta."""
        self.mensajes = [m for m in self.mensajes if m["id"] not in identificadores]

    def get(self, url, params=None, headers=None, timeout=None, allow_redirects=False):
        if params is None:
            # Una página siguiente: la consulta entera va en la URL.
            consulta = {clave: valores[0] for clave, valores in parse_qs(urlsplit(url).query).items()}
        else:
            consulta = {clave: str(valor) for clave, valor in params.items()}
        self.consultas.append(consulta)
        if len(self.consultas) == self.falla_en_la_peticion:
            return _Respuesta(503, {"error": {"code": "ServiceUnavailable", "message": "..."}})

        if "$search" in consulta:
            elegidos = sorted((m for m in self.mensajes if _menciona_un_cobro(m)),
                              key=lambda m: m["sentDateTime"], reverse=True)[:self.TOPE_DE_SEARCH]
        else:
            desde, hasta = _rango_del_filter(consulta.get("$filter", ""))
            elegidos = sorted((m for m in self.mensajes if desde <= _guardada(m) < hasta),
                              key=_guardada, reverse=True)
        top, salto = int(consulta.get("$top", 10)), int(consulta.get("$skip", 0))
        cuerpo = {"value": elegidos[salto:salto + top]}
        if salto + top < len(elegidos):
            cuerpo["@odata.nextLink"] = lector_outlook.URL_MENSAJES + "?" + urlencode({**consulta, "$skip": salto + top})
        return _Respuesta(200, cuerpo)


def _instante(texto):
    return datetime.fromisoformat(texto)


def _guardada(crudo):
    """La fecha con que el buzón filtra y ordena; la que muestra va al segundo."""
    return crudo.get("_interno") or _instante(crudo["receivedDateTime"])


def _rango_del_filter(filtro):
    desde = re.search(r"receivedDateTime ge (\S+)", filtro)
    hasta = re.search(r"receivedDateTime lt (\S+)", filtro)
    return (_instante(desde.group(1)) if desde else datetime.min.replace(tzinfo=tz.utc),
            _instante(hasta.group(1)) if hasta else datetime.max.replace(tzinfo=tz.utc))


def _menciona_un_cobro(crudo):
    contenido = f"{crudo['subject']} {crudo['body']['content']}".lower()
    return any(palabra in contenido for palabra in ("recibo", "factura", "suscripción", "cobro"))


def _fecha_graph(instante):
    return instante.astimezone(tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def correo_graph(id_mensaje, *, recibido, enviado=None, asunto="Tu recibo", texto="Cobro mensual: $8.990"):
    """`recibido` puede traer fracción de segundo: Graph la muestra al
    segundo y el buzón la usa entera (`_interno`)."""
    crudo = {
        "id": id_mensaje, "internetMessageId": f"<{id_mensaje}@ejemplo.com>", "conversationId": f"c-{id_mensaje}",
        "receivedDateTime": _fecha_graph(recibido), "sentDateTime": _fecha_graph(enviado or recibido),
        "subject": asunto, "from": {"emailAddress": {"name": "Ejemplo", "address": "avisos@ejemplo.com"}},
        "body": {"contentType": "text", "content": texto},
    }
    if recibido.microsecond:
        crudo["_interno"] = recibido
    return crudo


def buzon_con_mas_de_mil_cobros():
    """El buzón de la aceptación de la revisión: más de 1000 cobros dentro de
    la ventana inicial, con fechas de envío desordenadas respecto de las de
    recepción, y correos fuera de la ventana o que no son cobros.

    Devuelve los mensajes y los identificadores que la corrida TIENE que
    entregar."""
    inicio = LUNES - VENTANA_INICIAL
    mensajes, elegibles = [], set()
    for i in range(1150):
        recibido = inicio + timedelta(minutes=37 + i * 112)
        # El envío se desordena: hasta 9 días antes de la recepción, en un
        # orden que no es el de llegada. A los primeros los deja enviados
        # antes de la ventana aunque llegaron dentro: también se leen.
        enviado = recibido - timedelta(hours=(i * 53) % 217)
        asunto, texto = ("Tu recibo", "Cobro mensual") if i % 3 else ("Aviso", "Tu SUSCRIPCIÓN se renovó")
        mensajes.append(correo_graph(f"dentro-{i}", recibido=recibido, enviado=enviado, asunto=asunto, texto=texto))
        elegibles.add(f"dentro-{i}")
    for i in range(300):
        recibido = inicio + timedelta(minutes=11 + i * 431)
        mensajes.append(correo_graph(f"no-es-cobro-{i}", recibido=recibido, enviado=recibido,
                                     asunto="Hola", texto="¿Nos vemos el viernes?"))
    for i in range(40):
        # Recibidos antes de la ventana: ya no se leen.
        recibido = inicio - timedelta(hours=1 + i * 7)
        mensajes.append(correo_graph(f"antes-{i}", recibido=recibido, enviado=recibido - timedelta(minutes=5)))
    for i in range(40):
        # Enviados dentro de la ventana pero recibidos después del tope: son
        # de la corrida siguiente. Por envío, son de los más nuevos.
        recibido = LUNES + timedelta(minutes=1 + i)
        mensajes.append(correo_graph(f"despues-{i}", recibido=recibido, enviado=LUNES - timedelta(minutes=30 - i % 20)))
    # Los bordes: `desde` entra, `hasta` no.
    mensajes.append(correo_graph("borde-desde", recibido=inicio, enviado=inicio - timedelta(days=2)))
    elegibles.add("borde-desde")
    mensajes.append(correo_graph("borde-hasta", recibido=LUNES, enviado=LUNES - timedelta(days=1)))
    return mensajes, elegibles


class TestOutlookConMasDeMilCoincidencias:
    def _leer_hasta_terminar(self, c, procesado, *, o_hasta_un_error=False):
        resultados = []
        for _ in range(200):
            try:
                resultado = lote(lector_outlook, c, procesado, limite=100)
            except ErrorTransitorio:
                if o_hasta_un_error:
                    return resultados
                raise
            resultados.append(resultado)
            if resultado.corrida_terminada:
                return resultados
            # Mientras la corrida no termina, la marca no se mueve.
            assert avance(c).leido_hasta is None
        pytest.fail("la corrida no terminó en 200 páginas")

    def test_todos_los_elegibles_se_entregan_antes_de_avanzar_la_marca(self, claves, monkeypatch):
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        mensajes, elegibles = buzon_con_mas_de_mil_cobros()
        assert len(elegibles) > BuzonDeGraph.TOPE_DE_SEARCH
        buzon = BuzonDeGraph(mensajes)
        monkeypatch.setattr(lector_outlook.requests, "get", buzon.get)
        procesado = Procesado()

        resultados = self._leer_hasta_terminar(c, procesado)

        assert resultados[-1].corrida_terminada and avance(c).leido_hasta == LUNES
        assert sorted(procesado.ids) == sorted(elegibles), "faltan o sobran correos al avanzar la marca"
        assert len(procesado.ids) == len(set(procesado.ids)), "un correo se entregó dos veces en la misma corrida"
        assert all("$search" not in consulta for consulta in buzon.consultas)

    def test_un_corte_a_mitad_de_camino_no_adelanta_la_marca(self, claves, monkeypatch):
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        mensajes, elegibles = buzon_con_mas_de_mil_cobros()
        buzon = BuzonDeGraph(mensajes, falla_en_la_peticion=7)
        monkeypatch.setattr(lector_outlook.requests, "get", buzon.get)
        procesado = Procesado()

        antes_del_corte = self._leer_hasta_terminar(c, procesado, o_hasta_un_error=True)
        assert len(antes_del_corte) == 6
        a = avance(c)
        assert (a.leido_hasta, a.corrida_hasta) == (None, LUNES) and a.pagina, "el corte movió la marca"

        self._leer_hasta_terminar(c, procesado)
        assert avance(c).leido_hasta == LUNES
        assert sorted(procesado.ids) == sorted(elegibles)


# ══════════════════════════════════════════════════════════════════════
# Revisión de #189, ronda 3 (P2) — un borrado a mitad de corrida
# ══════════════════════════════════════════════════════════════════════
#
# La `@odata.nextLink` avanza con `$skip`, por posición. Si a mitad de una
# corrida se borraba definitivamente un correo ya leído (Outlook.com vacía
# solo «Elementos eliminados»; en Exchange Online lo hace la directiva de
# retención), los que seguían se corrían un lugar y el del borde de la página
# no se entregaba nunca, con la marca avanzando igual. Ahora Outlook arma su
# página siguiente por fecha.


class TestOutlookConBorradosAMitadDeCorrida:
    def _cuenta(self, monkeypatch, mensajes):
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        buzon = BuzonDeGraph(mensajes)
        monkeypatch.setattr(lector_outlook.requests, "get", buzon.get)
        return c, buzon

    def _leer_hasta_terminar(self, c, procesado, *, limite):
        for _ in range(100):
            if lote(lector_outlook, c, procesado, limite=limite).corrida_terminada:
                return
            assert avance(c).leido_hasta is None, "la marca avanzó a mitad de la corrida"
        pytest.fail("la corrida no terminó en 100 páginas")

    def test_un_correo_ya_leido_que_se_borra_no_hace_saltar_al_siguiente(self, claves, monkeypatch):
        mensajes = [correo_graph(f"m{i}", recibido=LUNES - timedelta(hours=1 + i)) for i in range(30)]
        c, buzon = self._cuenta(monkeypatch, mensajes)
        procesado = Procesado()
        lote(lector_outlook, c, procesado, limite=10)
        assert procesado.ids == [f"m{i}" for i in range(10)]

        buzon.borrar("m3")
        self._leer_hasta_terminar(c, procesado, limite=10)

        assert avance(c).leido_hasta == LUNES
        assert sorted(procesado.ids) == sorted(f"m{i}" for i in range(30)), "faltan correos al avanzar la marca"
        assert len(procesado.ids) == len(set(procesado.ids))
        assert all("$skip" not in consulta for consulta in buzon.consultas)

    def test_muchos_en_el_mismo_segundo_y_uno_borrado_entre_ellos(self, claves, monkeypatch):
        """25 cobros en el mismo segundo, con fracciones distintas como las
        guarda el buzón (Graph los muestra todos iguales), más 10 anteriores.
        Las páginas de 10 cortan en medio de ese segundo, y a mitad de camino
        se borra uno de ese segundo que ya se leyó."""
        segundo = LUNES - timedelta(hours=2)
        mensajes = [correo_graph(f"s{i:02}", recibido=segundo + timedelta(microseconds=999_000 - i * 1000))
                    for i in range(25)]
        mensajes += [correo_graph(f"v{i}", recibido=segundo - timedelta(seconds=1 + i)) for i in range(10)]
        c, buzon = self._cuenta(monkeypatch, mensajes)
        procesado = Procesado()
        lote(lector_outlook, c, procesado, limite=10)

        buzon.borrar("s04")
        self._leer_hasta_terminar(c, procesado, limite=10)

        esperados = {m["id"] for m in mensajes}
        assert set(procesado.ids) == esperados, "faltan correos del mismo segundo"
        assert len(procesado.ids) == len(set(procesado.ids)), "un correo se entregó dos veces"

    def test_mas_de_los_que_caben_en_un_segundo_es_un_error_y_la_marca_no_avanza(self, claves, monkeypatch):
        segundo = LUNES - timedelta(hours=2)
        mensajes = [correo_graph(f"s{i:03}", recibido=segundo + timedelta(microseconds=i)) for i in range(150)]
        c, _ = self._cuenta(monkeypatch, mensajes)
        procesado = Procesado()
        lote(lector_outlook, c, procesado, limite=50)
        guardada = avance(c).pagina

        for _ in range(2):
            with pytest.raises(ErrorDelProveedor) as error:
                lote(lector_outlook, c, procesado, limite=50)
            assert error.value.codigo == "demasiados_en_un_segundo"

        a = avance(c)
        assert (a.pagina, a.leido_hasta) == (guardada, None)
        assert len(procesado.ids) == 50


# ══════════════════════════════════════════════════════════════════════
# Revisión de #189, P2 — solo un rechazo explícito del cursor reinicia
# ══════════════════════════════════════════════════════════════════════
#
# La aceptación de la revisión: con un cursor B válido que falla por otra
# cosa (un JSON ilegible) y una primera página A buena, el error sale, B se
# conserva y no sube el contador de reinicios. Un rechazo explícito del
# cursor sí reinicia.

NO_ES_JSON = ValueError("Expecting value: line 1 column 1 (char 0)")


class TestSoloUnRechazoDelCursorReinicia:
    def _gmail(self, monkeypatch, respuestas_de_la_lista, detalles=None):
        """Gmail con una lista de respuestas para `messages.list` y, si hace
        falta, el detalle de cada mensaje."""
        pedidos = []

        def get(url, params=None, headers=None, timeout=None):
            pedidos.append({"url": url, **dict(params or {})})
            if url == lector_gmail.URL_MENSAJES:
                return respuestas_de_la_lista.pop(0)
            return detalles[url.rsplit("/", 1)[1]]

        monkeypatch.setattr(lector_gmail.requests, "get", get)
        return pedidos

    def test_gmail_cursor_valido_con_json_ilegible_sale_el_error_y_se_conserva(self, claves, monkeypatch):
        c = cuenta()
        pedidos = self._gmail(monkeypatch, [
            _Respuesta(200, {"messages": [], "nextPageToken": "B"}),
            _Respuesta(200, NO_ES_JSON),
            # Si se reiniciara, esta primera página A volvería a servir:
            _Respuesta(200, {"messages": [], "nextPageToken": "B"}),
        ])
        lote(lector_gmail, c, Procesado())

        with pytest.raises(ErrorDelProveedor, match="no es JSON") as error:
            lote(lector_gmail, c, Procesado())

        assert not isinstance(error.value, CursorRechazado)
        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida, a.leido_hasta) == ("B", 0, None)
        assert [p.get("pageToken") for p in pedidos] == [None, "B"], "se volvió a la primera página"

    def test_gmail_cursor_valido_con_el_detalle_de_un_mensaje_ilegible_tampoco_reinicia(self, claves, monkeypatch):
        c = cuenta()
        pedidos = self._gmail(monkeypatch, [
            _Respuesta(200, {"messages": [], "nextPageToken": "B"}),
            _Respuesta(200, {"messages": [{"id": "m7", "threadId": "m7"}]}),
        ], detalles={"m7": _Respuesta(200, NO_ES_JSON)})
        lote(lector_gmail, c, Procesado())

        with pytest.raises(ErrorDelProveedor, match="no es JSON"):
            lote(lector_gmail, c, Procesado())

        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida) == ("B", 0)
        assert [p.get("pageToken") for p in pedidos if p["url"] == lector_gmail.URL_MENSAJES] == [None, "B"]

    def test_gmail_rechazo_explicito_del_page_token_si_reinicia(self, claves, monkeypatch):
        c = cuenta()
        pedidos = self._gmail(monkeypatch, [
            _Respuesta(200, {"messages": [], "nextPageToken": "B"}),
            _Respuesta(400, {"error": {"code": 400, "message": "Invalid pageToken", "status": "INVALID_ARGUMENT",
                                       "errors": [{"reason": "invalid"}]}}),
            _Respuesta(200, {"messages": []}),
        ])
        lote(lector_gmail, c, Procesado())

        resultado = lote(lector_gmail, c, Procesado())

        assert resultado.reiniciada and resultado.corrida_terminada
        assert avance(c).reinicios_por_pagina_invalida == 1
        assert [p.get("pageToken") for p in pedidos] == [None, "B", None]

    def _outlook(self, monkeypatch, *respuestas):
        pedidos = []
        respuestas = list(respuestas)

        def get(url, params=None, headers=None, timeout=None, allow_redirects=False):
            pedidos.append(dict(params or {}))
            return respuestas.pop(0)

        monkeypatch.setattr(lector_outlook.requests, "get", get)
        return pedidos

    @staticmethod
    def _primera_de_outlook():
        """Una primera página A buena, con página siguiente."""
        return _Respuesta(200, {"value": [correo_graph("m1", recibido=LUNES - timedelta(hours=1))],
                                "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?%24skip=1"})

    def test_outlook_cursor_valido_con_json_ilegible_sale_el_error_y_se_conserva(self, claves, monkeypatch):
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        pedidos = self._outlook(monkeypatch, self._primera_de_outlook(), _Respuesta(200, NO_ES_JSON),
                                self._primera_de_outlook())
        lote(lector_outlook, c, Procesado())
        guardado = avance(c).pagina

        with pytest.raises(ErrorDelProveedor, match="no es JSON"):
            lote(lector_outlook, c, Procesado())

        a = avance(c)
        assert (a.pagina, a.reinicios_por_pagina_invalida) == (guardado, 0)
        assert len(pedidos) == 2, "se volvió a la primera página"

    @pytest.mark.parametrize("estado, codigo_graph", [(400, "ErrorInvalidRequest"), (410, "SyncStateNotFound")])
    def test_outlook_un_400_o_410_con_el_cursor_ya_no_reinicia(self, claves, monkeypatch, estado, codigo_graph):
        """Antes la página siguiente era una `@odata.nextLink` que podía
        vencer; ahora el cursor es de este lado (ronda 3) y Graph no tiene
        cómo rechazarlo."""
        c = cuenta(proveedor="outlook", correo="p@outlook.com")
        pedidos = self._outlook(monkeypatch, self._primera_de_outlook(),
                                _Respuesta(estado, {"error": {"code": codigo_graph, "message": "..."}}),
                                self._primera_de_outlook())
        lote(lector_outlook, c, Procesado())
        with pytest.raises(ErrorDelProveedor) as error:
            lote(lector_outlook, c, Procesado())
        assert not isinstance(error.value, CursorRechazado)
        assert avance(c).reinicios_por_pagina_invalida == 0 and len(pedidos) == 2
