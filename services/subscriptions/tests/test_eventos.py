"""Eventos de dominio: el trabajo derivado y el interruptor de la bandera.

Lo que estas pruebas tienen que dejar claro es que los DOS modos hacen
exactamente el mismo trabajo. Si eso no se cumple, la comparación con y sin
cola no mide arquitectura: mide dos programas distintos.
"""

import json
import uuid
from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import OutboxEvento, ResumenOrganizacion, Subscription
from app.management.commands.consumir_eventos import SobreInvalido, validar
from events import publicador, topologia
from events.outbox import registrar_creada
from events.contrato import routing_key
from events.trabajo import recalcular_resumen


@pytest.fixture
def cliente() -> APIClient:
    return APIClient()


@pytest.fixture
def org() -> uuid.UUID:
    return uuid.uuid4()


def crear(org, monto, frecuencia=Subscription.Frecuencia.MENSUAL,
          estado=Subscription.Estado.ACTIVO, moneda="CLP"):
    return Subscription.objects.create(
        organizacion_id=org,
        nombre=f"Servicio {monto} {moneda}",
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=frecuencia,
        fecha_proximo_cobro=date(2026, 11, 1),
        categoria="streaming",
        estado=estado,
    )


def solo(resumenes):
    """Para las pruebas de una sola moneda: exige que haya exactamente una fila."""
    assert len(resumenes) == 1, f"se esperaba una moneda y hay {len(resumenes)}"
    return resumenes[0]


CUERPO = {
    "nombre": "Netflix",
    "monto": "9990",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-01",
    "categoria": "streaming",
    "estado": "activo",
}


# ── el trabajo derivado ──────────────────────────────────────────────

@pytest.mark.django_db
class TestRecalcularResumen:
    def test_suma_las_mensuales_tal_cual(self, org):
        crear(org, "1000")
        crear(org, "2500")
        assert solo(recalcular_resumen(org)).total_mensual == Decimal("3500.00")

    def test_divide_las_anuales_por_doce(self, org):
        crear(org, "12000", frecuencia=Subscription.Frecuencia.ANUAL)
        assert solo(recalcular_resumen(org)).total_mensual == Decimal("1000.00")

    def test_ignora_las_que_no_estan_activas(self, org):
        crear(org, "1000")
        crear(org, "9999", estado=Subscription.Estado.CANCELADO)
        resumen = solo(recalcular_resumen(org))
        assert resumen.total_mensual == Decimal("1000.00")
        assert resumen.cantidad_activas == 1

    def test_no_mezcla_organizaciones(self, org):
        otra = uuid.uuid4()
        crear(org, "1000")
        crear(otra, "5000")
        assert solo(recalcular_resumen(org)).total_mensual == Decimal("1000.00")
        assert solo(recalcular_resumen(otra)).total_mensual == Decimal("5000.00")

    def test_es_idempotente(self, org):
        """Regla 1 del catálogo: RabbitMQ entrega *al menos* una vez."""
        crear(org, "1000")
        primero = solo(recalcular_resumen(org))
        segundo = solo(recalcular_resumen(org))
        assert primero.id == segundo.id
        assert segundo.total_mensual == Decimal("1000.00")
        assert ResumenOrganizacion.objects.filter(organizacion_id=org).count() == 1

    def test_sin_suscripciones_no_deja_ninguna_fila(self, org):
        """Sin suscripciones no hay moneda de la cual informar.

        Antes devolvía una fila con total 0. Con el resumen por moneda eso ya
        no tiene sentido: ¿cero de qué divisa? Devuelve una lista vacía y no
        inventa una fila en una moneda que la organización nunca usó.
        """
        assert recalcular_resumen(org) == []
        assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()


@pytest.mark.django_db
class TestMonedas:
    """Regresión del [P1] de la revisión de la #78.

    Antes se sumaba `monto` sin mirar la divisa: 10.000 CLP más 10 USD daban
    10.010, que no es plata de ninguna moneda.
    """

    def test_no_suma_clp_con_usd(self, org):
        crear(org, "10000", moneda="CLP")
        crear(org, "10", moneda="USD")

        por_moneda = {r.moneda: r.total_mensual for r in recalcular_resumen(org)}

        assert por_moneda == {"CLP": Decimal("10000.00"), "USD": Decimal("10.00")}
        assert Decimal("10010") not in por_moneda.values()

    def test_una_fila_por_moneda(self, org):
        crear(org, "1000", moneda="CLP")
        crear(org, "2000", moneda="CLP")
        crear(org, "5", moneda="USD")

        resumenes = recalcular_resumen(org)

        assert len(resumenes) == 2
        por_moneda = {r.moneda: (r.total_mensual, r.cantidad_activas) for r in resumenes}
        assert por_moneda["CLP"] == (Decimal("3000.00"), 2)
        assert por_moneda["USD"] == (Decimal("5.00"), 1)

    def test_las_anuales_se_dividen_dentro_de_su_moneda(self, org):
        crear(org, "12000", frecuencia=Subscription.Frecuencia.ANUAL, moneda="CLP")
        crear(org, "120", frecuencia=Subscription.Frecuencia.ANUAL, moneda="USD")

        por_moneda = {r.moneda: r.total_mensual for r in recalcular_resumen(org)}

        assert por_moneda == {"CLP": Decimal("1000.00"), "USD": Decimal("10.00")}

    def test_una_moneda_que_se_deja_de_usar_no_queda_de_fantasma(self, org):
        usd = crear(org, "10", moneda="USD")
        crear(org, "1000", moneda="CLP")
        assert len(recalcular_resumen(org)) == 2

        usd.activo = False
        usd.save(update_fields=["activo"])

        resumenes = recalcular_resumen(org)
        assert [r.moneda for r in resumenes] == ["CLP"]
        assert not ResumenOrganizacion.objects.filter(
            organizacion_id=org, moneda="USD"
        ).exists()

    def test_sigue_siendo_idempotente_con_varias_monedas(self, org):
        crear(org, "1000", moneda="CLP")
        crear(org, "10", moneda="USD")

        primeros = {r.moneda: r.id for r in recalcular_resumen(org)}
        segundos = {r.moneda: r.id for r in recalcular_resumen(org)}

        assert primeros == segundos
        assert ResumenOrganizacion.objects.filter(organizacion_id=org).count() == 2

    def test_no_mezcla_monedas_entre_organizaciones(self, org):
        otra = uuid.uuid4()
        crear(org, "1000", moneda="CLP")
        crear(otra, "10", moneda="USD")

        assert [r.moneda for r in recalcular_resumen(org)] == ["CLP"]
        assert [r.moneda for r in recalcular_resumen(otra)] == ["USD"]


# ── el interruptor ───────────────────────────────────────────────────

EVENTO_CREADA = "suscripcion.creada"


@pytest.mark.django_db
class TestInterruptor:
    """Lo único que decide la bandera es QUIÉN espera.

    El evento se registra en el outbox en los dos modos: es parte del contrato
    MX-21 y puede haber otros consumidores. Lo que cambia es si el POST además
    recalcula el resumen antes de responder.

    Por eso estas pruebas no parchean el publicador: miran el outbox y la
    tabla del resumen, que es el estado real que deja cada camino.
    """

    def _crear(self, cliente, org, **cabeceras):
        return cliente.post(
            "/api/suscripciones/", CUERPO, format="json",
            headers={"X-Organizacion-Id": str(org), **cabeceras},
        )

    def test_sincrono_deja_el_resumen_listo_al_responder(self, cliente, org, settings):
        settings.EVENTOS_ASINCRONOS = False
        respuesta = self._crear(cliente, org)
        assert respuesta.status_code == status.HTTP_201_CREATED
        resumen = ResumenOrganizacion.objects.get(organizacion_id=org)
        assert resumen.total_mensual == Decimal("9990.00")

    def test_asincrono_NO_recalcula_en_la_peticion(self, cliente, org, settings):
        """La clave de la comparación: el POST responde sin hacer el trabajo."""
        settings.EVENTOS_ASINCRONOS = True
        respuesta = self._crear(cliente, org)
        assert respuesta.status_code == status.HTTP_201_CREATED
        assert not ResumenOrganizacion.objects.filter(organizacion_id=org).exists()

    def test_el_evento_queda_en_el_outbox_en_los_dos_modos(self, cliente, settings):
        """La bandera no apaga el outbox: otros consumidores dependen de él."""
        for asincrono in (False, True):
            org = uuid.uuid4()
            settings.EVENTOS_ASINCRONOS = asincrono
            self._crear(cliente, org)
            eventos = OutboxEvento.objects.filter(organizacion_id=org)
            assert eventos.count() == 1, f"con EVENTOS_ASINCRONOS={asincrono}"
            assert eventos.get().evento == EVENTO_CREADA

    def test_el_evento_del_outbox_lleva_la_organizacion_y_su_correlation(
        self, cliente, org
    ):
        """Regla 4 del catálogo: un evento sin organizacion_id se rechaza."""
        correlation = str(uuid.uuid4())
        self._crear(cliente, org, **{"X-Correlation-ID": correlation})
        evento = OutboxEvento.objects.get(organizacion_id=org)
        assert str(evento.organizacion_id) == str(org)
        assert str(evento.correlation_id) == correlation

    def test_el_payload_lleva_proveedor_id_aunque_vaya_vacio(self, cliente, org):
        """Regresión del [P2] de la revisión: faltaba `proveedor_id`.

        Sin proveedor va null, no ausente: el consumidor puede confiar en la
        forma del sobre aunque el dato no esté.
        """
        self._crear(cliente, org)
        datos = OutboxEvento.objects.get(organizacion_id=org).datos
        assert "proveedor_id" in datos
        assert datos["proveedor_id"] is None

    def test_si_falla_el_resumen_no_queda_la_suscripcion_a_medias(
        self, cliente, org, settings, monkeypatch
    ):
        """El modo síncrono acopla a propósito: o entra todo, o no entra nada.

        Ese acoplamiento es exactamente lo que el modo asíncrono quita, y es
        lo que la comparación mide. Lo que NO puede pasar es quedar con la
        suscripción creada y el resumen a medio escribir.
        """
        def explotar(*_a, **_k):
            raise RuntimeError("se cayó el recálculo")

        settings.EVENTOS_ASINCRONOS = False
        monkeypatch.setattr("events.modo.recalcular_resumen", explotar)
        with pytest.raises(RuntimeError):
            self._crear(cliente, org)
        assert not Subscription.objects.filter(organizacion_id=org).exists()
        assert not OutboxEvento.objects.filter(organizacion_id=org).exists()

    def test_los_dos_modos_terminan_en_el_mismo_estado(self, cliente, settings):
        """Si esto falla, la comparación no mide arquitectura: mide otra cosa."""
        sincrona, asincrona = uuid.uuid4(), uuid.uuid4()

        settings.EVENTOS_ASINCRONOS = False
        self._crear(cliente, sincrona)

        settings.EVENTOS_ASINCRONOS = True
        self._crear(cliente, asincrona)
        # Lo que haría el consumidor al recibir el evento:
        recalcular_resumen(asincrona)

        uno = ResumenOrganizacion.objects.get(organizacion_id=sincrona)
        otro = ResumenOrganizacion.objects.get(organizacion_id=asincrona)
        assert uno.total_mensual == otro.total_mensual
        assert uno.cantidad_activas == otro.cantidad_activas


# ── la topología ─────────────────────────────────────────────────────

class CanalFalso:
    """Anota lo que le piden, para ver qué se declara y en qué orden."""

    def __init__(self):
        self.llamadas = []

    def exchange_declare(self, **kw):
        self.llamadas.append(("exchange", kw))

    def queue_declare(self, **kw):
        self.llamadas.append(("cola", kw))

    def queue_bind(self, **kw):
        self.llamadas.append(("enlace", kw))


class _EventoFalso:
    def __init__(self, evento, version):
        self.evento = evento
        self.version = version


class TestTopologia:
    """Regresión de dos bugs encontrados contra un RabbitMQ real.

    **1. El enlace no calzaba con la clave publicada.** `PATRONES_RESUMEN`
    decía `suscripcion.creada` mientras el publicador mandaba a
    `suscripcion.creada.v2`. En un exchange topic ese enlace exacto no
    coincide con esa clave: la publicación fallaba por no enrutable y el
    resumen no llegaba nunca.

    La versión anterior de estas pruebas NO lo vio, y vale la pena decir por
    qué: comparaba la constante de `topologia` contra el enlace que arma
    `topologia`. Una prueba que se da la razón sola. Ahora se compara contra
    `contrato.routing_key`, que es la MISMA función con que se publica.

    **2. Un mensaje rechazado se borraba.** La cola no tenía dead-letter
    exchange, así que un `reject(requeue=False)` —o un `nack`— lo hacía
    desaparecer, incluso por una caída pasajera de la base.

    El recorrido completo contra un broker de verdad está en
    `tests/test_eventos_extremo_a_extremo.py`. Estas son las comprobaciones
    baratas; esa es la que de verdad lo caza.
    """

    def test_el_enlace_usa_la_clave_CON_VERSION_que_publica_el_publicador(self):
        """La regresión del bug 1.

        Si alguien vuelve a escribir el patrón a mano sin la versión, esto
        falla, porque la clave se le pregunta al contrato.
        """
        esperada = routing_key(_EventoFalso("suscripcion.creada", 2))
        assert esperada == "suscripcion.creada.v2"
        assert esperada in topologia.PATRONES_RESUMEN

    def test_los_patrones_se_derivan_del_contrato_no_de_literales(self):
        """Cada evento declarado tiene que producir su clave versionada."""
        derivadas = tuple(
            routing_key(_EventoFalso(nombre, version))
            for nombre, version in topologia.EVENTOS_DEL_RESUMEN
        )
        assert topologia.PATRONES_RESUMEN == derivadas

    def test_se_enlaza_la_version_exacta_y_no_un_comodin(self):
        """Una v3 es, por el catálogo, un cambio que rompe el esquema.
        Consumirla en silencio con el código de v2 sería peor que no
        recibirla, así que el enlace NO lleva comodín."""
        for patron in topologia.PATRONES_RESUMEN:
            assert "*" not in patron
            assert "#" not in patron

    def test_declara_las_dos_colas_y_sus_enlaces(self):
        canal = CanalFalso()
        topologia.declarar(canal)
        tipos = [tipo for tipo, _ in canal.llamadas]
        assert tipos.count("exchange") == 2  # el de eventos y el de fallos
        assert tipos.count("cola") == 2      # resumen y fallidos
        assert tipos.count("enlace") == 2

    def test_la_cola_del_resumen_manda_sus_rechazos_a_la_cola_de_fallos(self):
        """La regresión del bug 2, en la declaración."""
        canal = CanalFalso()
        topologia.declarar(canal)
        resumen = next(
            kw for tipo, kw in canal.llamadas
            if tipo == "cola" and kw["queue"] == topologia.COLA_RESUMEN
        )
        assert resumen["arguments"]["x-dead-letter-exchange"] == topologia.EXCHANGE_FALLIDOS

    def test_todo_es_durable(self):
        """Sin durable, un reinicio del broker se lleva los eventos pendientes."""
        canal = CanalFalso()
        topologia.declarar(canal)
        for tipo, kw in canal.llamadas:
            if tipo in ("exchange", "cola"):
                assert kw["durable"] is True, kw

    def test_el_publicador_declara_la_topologia_completa(self):
        """Si alguien vuelve a dejar solo el exchange, esto falla."""
        import inspect

        fuente = inspect.getsource(publicador.publicar)
        assert "declarar(canal)" in fuente
        assert "exchange_declare" not in fuente

    def test_el_publicador_usa_la_clave_del_contrato(self):
        """Si la clave se vuelve a escribir en línea, esta prueba y la de
        arriba dejan de estar atadas y el bug puede volver."""
        import inspect

        fuente = inspect.getsource(publicador.publicar)
        assert "routing_key(evento)" in fuente

    def test_el_exchange_tiene_una_sola_definicion(self):
        """Dos constantes con el mismo nombre se desincronizan calladas."""
        assert publicador.EXCHANGE is topologia.EXCHANGE


# ── el sobre que entra al consumidor ─────────────────────────────────


@pytest.mark.django_db
class TestValidarSobre:
    """`validar()` decide si un mensaje se procesa o se aparta.

    Antes esto no existía: el consumidor hacía `sobre["organizacion_id"]`
    dentro de un `except (ValueError, KeyError)`. Un cuerpo `[]` reventaba
    con `TypeError` —"list indices must be integers"—, que no estaba
    capturado, y **mataba el proceso entero**. Y un objeto con tenant válido
    pero `evento="no.admitido"` pasaba derecho al recálculo y recibía ACK.
    """

    @staticmethod
    def sobre(org=None, **cambios):
        """Un sobre armado por el PRODUCTOR REAL, no a mano.

        Pasa por `registrar_creada` (el outbox) y `crear_payload` (el
        publicador), así que es exactamente lo que sale al broker. Un fixture
        escrito a mano se desincroniza del productor sin que nada avise: la
        primera versión de esta prueba traía cuatro campos y le faltaban
        `ocurrido_en`, `correlation_id` y todo `datos`, y aun así la daba por
        buena porque `validar()` tampoco los miraba. Lo señaló la revisión.
        """
        from events.publicador import crear_payload  # noqa: PLC0415

        org = org or uuid.uuid4()
        suscripcion = crear(org, "9990")
        evento = registrar_creada(suscripcion)
        base = crear_payload(evento)
        base.update(cambios)
        return json.dumps(base).encode()

    def test_un_sobre_del_productor_real_pasa_la_validacion(self):
        """Si esto falla, el productor y el consumidor no se entienden."""
        org = uuid.uuid4()
        assert validar(self.sobre(org=org)) == str(org)

    def test_el_sobre_del_productor_cumple_el_contrato_compartido(self):
        """Doble comprobación contra el mismo archivo que usa la CI."""
        from events.validacion import errores  # noqa: PLC0415

        assert errores(json.loads(self.sobre())) == []

    @pytest.mark.parametrize(
        "campo",
        ["id", "ocurrido_en", "correlation_id", "organizacion_id", "datos"],
    )
    def test_si_falta_un_campo_obligatorio_se_aparta(self, campo):
        """Los que la versión anterior no miraba. Sin `id` no se pueden
        descartar duplicados, que es la regla 1 del catálogo."""
        sobre = json.loads(self.sobre())
        del sobre[campo]
        with pytest.raises(SobreInvalido):
            validar(json.dumps(sobre).encode())

    @pytest.mark.parametrize(
        "campo, valor",
        [
            ("id", "no-soy-un-uuid"),
            ("correlation_id", "tampoco"),
            ("organizacion_id", "menos"),
            ("ocurrido_en", "2026-13-45T99:99:99Z"),
            ("ocurrido_en", "2026-10-27T00:00:00+03:00"),  # el contrato pide Z
        ],
    )
    def test_un_formato_invalido_se_aparta(self, campo, valor):
        """Sin FormatChecker, jsonschema IGNORA los `format` y esto pasaría."""
        with pytest.raises(SobreInvalido):
            validar(self.sobre(**{campo: valor}))

    def test_una_carga_invalida_se_aparta(self):
        """`datos` tiene su propio esquema: un monto con formato malo no pasa."""
        sobre = json.loads(self.sobre())
        sobre["datos"]["monto"] = "nueve mil"
        with pytest.raises(SobreInvalido):
            validar(json.dumps(sobre).encode())

    def test_datos_vacio_se_aparta(self):
        with pytest.raises(SobreInvalido):
            validar(self.sobre(datos={}))

    @pytest.mark.parametrize(
        "cuerpo",
        [
            pytest.param(b"[]", id="lista-vacia"),
            pytest.param(b"null", id="null"),
            pytest.param(b'"texto"', id="string"),
            pytest.param(b"42", id="numero"),
            pytest.param(b"[1,2,3]", id="lista-con-cosas"),
        ],
    )
    def test_un_json_que_no_es_objeto_se_aparta_sin_matar_el_proceso(self, cuerpo):
        """`[]` es el caso exacto que tumbaba el consumidor."""
        with pytest.raises(SobreInvalido):
            validar(cuerpo)

    def test_algo_que_no_es_json_se_aparta(self):
        with pytest.raises(SobreInvalido):
            validar(b"{ esto no cierra")

    def test_sin_organizacion_se_aparta(self):
        """Regla 4 del catálogo: el contexto multi-tenant viaja en el evento."""
        with pytest.raises(SobreInvalido):
            validar(self.sobre(organizacion_id=None))

    def test_una_organizacion_que_no_es_uuid_se_aparta(self):
        """Recalcular la organización equivocada es peor que apartar el mensaje."""
        with pytest.raises(SobreInvalido):
            validar(self.sobre(organizacion_id="la-organizacion"))

    def test_un_evento_no_admitido_se_aparta_aunque_el_tenant_sea_valido(self):
        with pytest.raises(SobreInvalido):
            validar(self.sobre(evento="no.admitido"))

    def test_una_version_distinta_se_aparta(self):
        """Una v999 no se procesa con el código de v2."""
        with pytest.raises(SobreInvalido):
            validar(self.sobre(version=999))

    def test_el_mensaje_siguiente_sigue_funcionando(self):
        """Lo que importa de apartar en vez de reventar: el proceso sigue."""
        with pytest.raises(SobreInvalido):
            validar(b"[]")
        org = uuid.uuid4()
        assert validar(self.sobre(org=org)) == str(org)

    def test_el_motivo_no_queda_vacio(self):
        """Va al log y a la cola de fallos: sin motivo no se puede diagnosticar."""
        with pytest.raises(SobreInvalido) as caso:
            validar(self.sobre(version=999))
        assert str(caso.value)


# ══════════════════════════════════════════════════════════════════════
# La carrera del resumen y el doble trabajo del modo 0
# (hallazgos de la tercera revisión de #106)
# ══════════════════════════════════════════════════════════════════════


@pytest.fixture
def solo_postgres():
    """Salta la prueba si la base no es PostgreSQL, EN TIEMPO DE EJECUCIÓN.

    Con `@pytest.mark.skipif(connection.vendor != ...)` no sirve: el decorador
    se evalúa al importar el módulo y el conftest cambia la base después.
    """
    from django.db import connection

    if connection.vendor != "postgresql":
        pytest.skip("los advisory locks son de PostgreSQL; en SQLite es un no-op")


@pytest.mark.django_db
class TestBloqueoDelResumen:
    """El recálculo se serializa por organización ANTES de leer la fuente.

    El `atomic()` agrupaba las escrituras pero no serializaba la lectura: con
    read committed, A leía 100, B insertaba 20 y guardaba 120, y A guardaba su
    100 viejo. Reproducido en la revisión: fuente 120, agregado 100.

    El modo síncrono corre desde varios workers, así que no es hipotético.
    """

    def test_el_lock_se_toma_antes_de_leer_la_fuente(self):
        """Si alguien lo mueve después del SUM, esto falla."""
        import inspect

        from events import trabajo

        fuente = inspect.getsource(trabajo.recalcular_resumen)
        assert 'bloquear("resumen_organizacion"' in fuente
        # Y dentro del atomic, antes de delegar el cálculo.
        assert fuente.index("transaction.atomic()") < fuente.index("bloquear(")
        assert fuente.index("bloquear(") < fuente.index("_recalcular_ya_bloqueado")

    def test_el_calculo_no_se_llama_sin_el_lock(self):
        """`_recalcular_ya_bloqueado` asume el lock tomado: el único camino
        público tiene que pasar por `recalcular_resumen`."""
        import inspect

        from events import trabajo

        fuente = inspect.getsource(trabajo)
        # Una sola llamada, la de recalcular_resumen.
        assert fuente.count("_recalcular_ya_bloqueado(") == 2  # def + 1 llamada

    def test_en_postgres_el_lock_queda_tomado(self, solo_postgres, org):
        """Que la función no reviente no prueba que el lock exista."""
        from django.db import connection, transaction

        from shared.bloqueo import ESPACIOS, bloquear

        with transaction.atomic():
            bloquear("resumen_organizacion", org)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
                    "AND classid = %s AND pid = pg_backend_pid()",
                    [ESPACIOS["resumen_organizacion"]],
                )
                assert cursor.fetchone()[0] == 1

    def test_en_postgres_organizaciones_distintas_no_se_bloquean_entre_si(
        self, solo_postgres
    ):
        """Si todas colapsaran en una clave, se serializaría el servicio entero."""
        from django.db import connection, transaction

        from shared.bloqueo import ESPACIOS, bloquear

        with transaction.atomic():
            for _ in range(4):
                bloquear("resumen_organizacion", uuid.uuid4())
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(DISTINCT objid) FROM pg_locks "
                    "WHERE locktype = 'advisory' AND classid = %s "
                    "AND pid = pg_backend_pid()",
                    [ESPACIOS["resumen_organizacion"]],
                )
                assert cursor.fetchone()[0] == 4

    def test_el_espacio_de_locks_no_choca_con_el_de_analytics(self):
        """Dos familias distintas tienen que tener números distintos."""
        from shared.bloqueo import ESPACIOS

        assert len(set(ESPACIOS.values())) == len(ESPACIOS)

    def test_un_espacio_desconocido_revienta(self):
        from django.db import transaction

        from shared.bloqueo import bloquear

        with pytest.raises(KeyError, match="desconocido"):
            with transaction.atomic():
                bloquear("no-declarado", "x")

    def test_fuera_de_una_transaccion_revienta(self, monkeypatch):
        """Un lock de transacción fuera de un atomic se suelta al tiro."""
        from shared import bloqueo

        class FueraDeTransaccion:
            in_atomic_block = False

        monkeypatch.setattr(
            bloqueo.transaction, "get_connection", lambda *_a, **_k: FueraDeTransaccion()
        )
        with pytest.raises(RuntimeError, match="transacción"):
            bloqueo.bloquear("resumen_organizacion", "x")


@pytest.mark.django_db
class TestSinTrabajoDuplicado:
    """En modo 0 el trabajo tiene que hacerse UNA vez, no dos.

    El POST recalcula y el evento igual va al outbox, así que el consumidor
    recalculaba lo mismo otra vez. El modo 0 hacía el doble de trabajo que el
    modo 1 y los números de la comparación no medían arquitectura.
    """

    def test_el_consumidor_omite_el_recalculo_en_modo_sincrono(self, settings):
        """Lo decide mirando la bandera, igual que el POST."""
        import inspect

        from app.management.commands import consumir_eventos

        fuente = inspect.getsource(consumir_eventos.Command.handle)
        assert "if not settings.EVENTOS_ASINCRONOS:" in fuente
        # Y confirma el mensaje: el trabajo está hecho, no pendiente.
        assert fuente.index("if not settings.EVENTOS_ASINCRONOS:") < fuente.index(
            "ultimo = None"
        )

    def test_los_dos_modos_cuentan_con_el_mismo_formato(self):
        """`comparar-cola.sh` cuenta esas líneas en los dos lados; si los
        formatos se separan, la comparación deja de poder comprobarse."""
        import inspect

        from app.management.commands import consumir_eventos
        from events import modo

        assert "resumen.recalculado modo=sincrono" in inspect.getsource(modo)
        assert "resumen.recalculado modo=asincrono" in inspect.getsource(
            consumir_eventos
        )
