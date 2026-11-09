"""S3-FE-15 — confirmar candidatos y dejar la orden de crear.

Los criterios de la tarjeta:
- confirmar es atómico según el contrato
- un aviso futuro no genera un pago realizado, y los errores no dejan datos
  parciales

Y lo que hace que no sea un agujero: repetir la confirmación no deja dos
órdenes (o sea, no crea cobros dobles), un candidato sin proveedor resuelto no
se confirma, y el sobre lleva la decisión YA TOMADA para que nadie la vuelva a
deducir del otro lado.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors import confirmacion
from connectors.models import CobroCandidato, Importacion, OutboxEvento

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
USUARIO = "42"
OTRO_USUARIO = "77"

RUTA = "/api/candidatos/"


@pytest.fixture
def cliente():
    return APIClient()


def cabecera(org=ORG_A, usuario=USUARIO):
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


def crear_candidato(
    *,
    org=ORG_A,
    identificador="sha:2",
    servicio="Netflix",
    servicio_resultado="reconocido",
    tipo=CobroCandidato.TipoMensaje.COBRO_REALIZADO,
    estado=CobroCandidato.Estado.PROPUESTO,
    importe="9990",
):
    importacion = Importacion.objects.create(
        organizacion_id=org,
        usuario_id=USUARIO,
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
    )
    return CobroCandidato.objects.create(
        organizacion_id=org,
        importacion=importacion,
        origen=CobroCandidato.Origen.CSV,
        identificador_origen=identificador,
        servicio=servicio,
        servicio_texto="NETFLIX.COM",
        servicio_resultado=servicio_resultado,
        importe=Decimal(importe),
        moneda="CLP",
        fecha=date(2026, 10, 1),
        tipo_mensaje=tipo,
        estado=estado,
        evidencia={"fila": "2", "descripcion_original": "NETFLIX.COM"},
    )


def confirmar(cliente, candidato, **extra):
    return cliente.post(f"{RUTA}{candidato.id}/confirmar/", {}, format="json", **extra)


def unica_orden():
    assert OutboxEvento.objects.count() == 1
    return OutboxEvento.objects.get()


# ══════════════════════════════════════════════════════════════════════
# Criterio: confirmar es atómico
# ══════════════════════════════════════════════════════════════════════


def test_confirmar_deja_el_candidato_y_la_orden(cliente):
    candidato = crear_candidato()

    respuesta = confirmar(cliente, candidato, headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.json()["estado"] == CobroCandidato.Estado.CONFIRMADO
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.CONFIRMADO
    orden = unica_orden()
    assert orden.evento == confirmacion.EVENTO
    assert orden.version == confirmacion.VERSION
    assert orden.publicado_en is None


def test_si_la_orden_no_se_puede_escribir_el_candidato_no_queda_confirmado(monkeypatch):
    """Los dos o ninguno. Es el criterio, dicho al revés.

    Un candidato confirmado sin su orden sería lo peor de los dos mundos: la
    persona ve que dijo "sí" y la suscripción no se crea nunca, sin que nada
    quede registrado para reintentarlo.
    """
    candidato = crear_candidato()

    def reventar(*_args, **_extra):
        raise RuntimeError("se cayó la base al escribir el outbox")

    monkeypatch.setattr(OutboxEvento.objects, "create", reventar)

    with pytest.raises(RuntimeError):
        confirmacion.confirmar(candidato, por=USUARIO)

    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.PROPUESTO
    assert candidato.decidido_en is None
    assert OutboxEvento.objects.count() == 0


def test_cuando_se_escribe_la_orden_el_candidato_ya_esta_confirmado(monkeypatch):
    """El orden de las dos escrituras, visto desde adentro.

    Si fueran dos operaciones separadas, acá se leería `propuesto` todavía y
    existiría un instante con la orden escrita y el candidato sin decidir.

    Lo que NO se comprueba acá es que las dos compartan transacción: pytest
    envuelve cada prueba en una, así que preguntar por `autocommit` desde
    adentro devuelve lo mismo esté el código bien o mal. Eso lo prueba
    `test_si_la_orden_no_se_puede_escribir_el_candidato_no_queda_confirmado`,
    que revienta la segunda escritura y exige que la primera se deshaga.
    """
    candidato = crear_candidato()
    visto = {}
    original = OutboxEvento.objects.create

    def espiar(**campos):
        visto["estado"] = CobroCandidato.objects.values_list("estado", flat=True).get(
            pk=candidato.pk
        )
        return original(**campos)

    monkeypatch.setattr(OutboxEvento.objects, "create", espiar)

    confirmacion.confirmar(candidato, por=USUARIO)

    assert visto == {"estado": CobroCandidato.Estado.CONFIRMADO}


# ══════════════════════════════════════════════════════════════════════
# Criterio: un aviso futuro no genera un pago realizado
# ══════════════════════════════════════════════════════════════════════


def test_un_cobro_realizado_si_crea_cobro(cliente):
    candidato = crear_candidato(tipo=CobroCandidato.TipoMensaje.COBRO_REALIZADO)

    confirmar(cliente, candidato, headers=cabecera())

    assert unica_orden().datos["crear_cobro"] is True


@pytest.mark.parametrize(
    "tipo",
    [
        CobroCandidato.TipoMensaje.AVISO_DE_COBRO,
        CobroCandidato.TipoMensaje.PAGO_FALLIDO,
    ],
)
def test_un_aviso_o_un_fallo_no_crean_cobro(cliente, tipo):
    """«Te vamos a cobrar» y «no pudimos cobrarte» no son plata que salió.

    Contarlos como cobro los contaría DOS veces cuando después llegue el
    recibo de verdad, y haría cuadrar mal el presupuesto.
    """
    candidato = crear_candidato(tipo=tipo)

    respuesta = confirmar(cliente, candidato, headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    orden = unica_orden()
    assert orden.datos["crear_cobro"] is False
    assert orden.datos["tipo_mensaje"] == tipo


def test_la_regla_cubre_todos_los_tipos_que_existen():
    """Si mañana se agrega un tipo, esto falla antes que la decisión silenciosa.

    Un tipo sin regla no puede caer en "no crea cobro" por omisión: eso
    perdería cobros reales sin que nadie se enterara.
    """
    assert set(confirmacion.CREA_COBRO) == set(CobroCandidato.TipoMensaje.values)


def test_un_tipo_sin_regla_no_se_confirma(monkeypatch):
    """La red por si alguien agrega un tipo y no toca la tabla."""
    candidato = crear_candidato()
    monkeypatch.setitem(
        confirmacion.CREA_COBRO, CobroCandidato.TipoMensaje.COBRO_REALIZADO, True
    )
    monkeypatch.delitem(
        confirmacion.CREA_COBRO, CobroCandidato.TipoMensaje.COBRO_REALIZADO
    )

    with pytest.raises(confirmacion.ConfirmacionRechazada) as e:
        confirmacion.confirmar(candidato, por=USUARIO)

    assert e.value.codigo == confirmacion.TIPO_SIN_REGLA
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.PROPUESTO


# ══════════════════════════════════════════════════════════════════════
# El sobre: todo lo que el receptor necesita, sin preguntar nada
# ══════════════════════════════════════════════════════════════════════


def test_el_sobre_lleva_todo_lo_necesario_para_crear(cliente):
    candidato = crear_candidato()

    confirmar(cliente, candidato, headers=cabecera())

    datos = unica_orden().datos
    assert set(datos) == {
        "candidato_id",
        "importacion_id",
        "origen",
        "identificador_origen",
        "servicio",
        "servicio_texto",
        "importe",
        "moneda",
        "fecha",
        "tipo_mensaje",
        "crear_cobro",
        "decidido_por",
        "evidencia",
    }
    assert datos["candidato_id"] == str(candidato.id)
    assert datos["servicio"] == "Netflix"
    assert datos["moneda"] == "CLP"
    assert datos["fecha"] == "2026-10-01"
    assert datos["decidido_por"] == USUARIO


def test_el_importe_del_sobre_es_texto(cliente):
    """En JSON un decimal se vuelve `float` del otro lado y se pierde.

    Y esto es, literalmente, plata de otra persona: el importe viaja como
    texto desde el parser hasta acá y tiene que seguir así al cruzar.
    """
    candidato = crear_candidato(importe="9990.50")

    confirmar(cliente, candidato, headers=cabecera())

    importe = unica_orden().datos["importe"]
    assert isinstance(importe, str)
    assert importe == "9990.50"


def test_el_importe_del_sobre_siempre_trae_dos_decimales(cliente):
    """Incluso en pesos, que no tienen centavos. Es parte del contrato.

    No es una decisión: la columna es NUMERIC(14,2), así que un importe de
    9990 vuelve de la base como `Decimal("9990.00")` y su texto los trae.
    Verificado igual en PostgreSQL y en SQLite. El valor es exacto; quien lo
    consuma no puede suponer que no hay decimales porque la moneda sea CLP.
    """
    candidato = crear_candidato(importe="9990")

    confirmar(cliente, candidato, headers=cabecera())

    assert unica_orden().datos["importe"] == "9990.00"


def test_la_orden_hereda_la_organizacion_del_candidato(cliente):
    """El aislamiento también del lado de la orden (RF-26)."""
    candidato = crear_candidato(org=ORG_A)

    confirmar(cliente, candidato, headers=cabecera(org=ORG_A))

    assert unica_orden().organizacion_id == ORG_A


def test_la_orden_nace_sin_publicar(cliente):
    """Todavía no hay publicador: la fila espera, durable, y no se finge."""
    candidato = crear_candidato()

    confirmar(cliente, candidato, headers=cabecera())

    orden = unica_orden()
    assert orden.publicado_en is None
    assert orden.intentos == 0
    assert orden.ultimo_error == ""


# ══════════════════════════════════════════════════════════════════════
# Repetir no crea cobros dobles
# ══════════════════════════════════════════════════════════════════════


def test_confirmar_dos_veces_no_deja_dos_ordenes(cliente):
    """El criterio de S3-CH-08. Dos órdenes serían dos cobros."""
    candidato = crear_candidato()

    primera = confirmar(cliente, candidato, headers=cabecera())
    segunda = confirmar(cliente, candidato, headers=cabecera(usuario=OTRO_USUARIO))

    assert primera.status_code == segunda.status_code == status.HTTP_200_OK
    assert OutboxEvento.objects.count() == 1
    # Y la decisión sigue siendo la primera.
    assert segunda.json()["decidido_en"] == primera.json()["decidido_en"]
    assert segunda.json()["decidido_por"] == USUARIO


def test_el_metodo_dice_si_cambio_algo():
    candidato = crear_candidato()

    assert confirmacion.confirmar(candidato, por=USUARIO) is True
    assert confirmacion.confirmar(candidato, por=OTRO_USUARIO) is False


def test_si_otra_corrida_gana_no_se_escribe_una_segunda_orden(monkeypatch):
    """Dos peticiones simultáneas sobre el mismo candidato.

    Las dos leen `propuesto`; la guarda del WHERE deja pasar a una. La que
    pierde no puede dejar su orden, porque dos órdenes son dos cobros.
    """
    candidato = crear_candidato()
    original = timezone.now

    def confirmarlo_justo_antes():
        CobroCandidato.objects.filter(pk=candidato.pk).update(
            estado=CobroCandidato.Estado.CONFIRMADO, decidido_por=OTRO_USUARIO
        )
        monkeypatch.setattr(timezone, "now", original)
        return original()

    monkeypatch.setattr(timezone, "now", confirmarlo_justo_antes)

    assert confirmacion.confirmar(candidato, por=USUARIO) is False
    assert OutboxEvento.objects.count() == 0
    candidato.refresh_from_db()
    assert candidato.decidido_por == OTRO_USUARIO


# ══════════════════════════════════════════════════════════════════════
# Lo que no se confirma
# ══════════════════════════════════════════════════════════════════════


def test_un_candidato_rechazado_no_se_confirma(cliente):
    candidato = crear_candidato(estado=CobroCandidato.Estado.RECHAZADO)

    respuesta = confirmar(cliente, candidato, headers=cabecera())

    assert respuesta.status_code == status.HTTP_409_CONFLICT
    assert respuesta.json()["codigo"] == confirmacion.CANDIDATO_RECHAZADO
    assert OutboxEvento.objects.count() == 0
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.RECHAZADO


@pytest.mark.parametrize("resultado", ["ambiguo", "desconocido"])
def test_sin_proveedor_resuelto_no_se_confirma(cliente, resultado):
    """Una suscripción llamada «PAYPAL *SPOTIFY» no es un dato.

    Es basura con forma de dato, y una vez creada queda en el presupuesto de
    la persona. Mejor un 409 que dice qué falta.
    """
    candidato = crear_candidato(servicio=None, servicio_resultado=resultado)

    respuesta = confirmar(cliente, candidato, headers=cabecera())

    assert respuesta.status_code == status.HTTP_409_CONFLICT
    assert respuesta.json()["codigo"] == confirmacion.SERVICIO_SIN_RESOLVER
    # El mensaje dice POR QUÉ no se reconoció, para que se pueda arreglar.
    assert resultado in respuesta.json()["detail"]
    assert OutboxEvento.objects.count() == 0
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.PROPUESTO


def test_rechazar_despues_de_confirmar_sigue_siendo_409(cliente):
    """S3-FE-16 y esto no se pisan: una decisión tomada no se cambia acá."""
    candidato = crear_candidato()
    confirmar(cliente, candidato, headers=cabecera())

    respuesta = cliente.post(
        f"{RUTA}{candidato.id}/rechazar/", {}, format="json", headers=cabecera()
    )

    assert respuesta.status_code == status.HTTP_409_CONFLICT
    assert respuesta.json()["codigo"] == "candidato_ya_confirmado"
    assert OutboxEvento.objects.count() == 1


# ══════════════════════════════════════════════════════════════════════
# El aislamiento y los permisos
# ══════════════════════════════════════════════════════════════════════


def test_no_se_confirma_un_candidato_de_otra_organizacion(cliente):
    ajeno = crear_candidato(org=ORG_B)

    respuesta = confirmar(cliente, ajeno, headers=cabecera(org=ORG_A))

    assert respuesta.status_code == status.HTTP_404_NOT_FOUND
    assert OutboxEvento.objects.count() == 0
    ajeno.refresh_from_db()
    assert ajeno.estado == CobroCandidato.Estado.PROPUESTO


def test_sin_cabecera_de_usuario_no_se_confirma(cliente):
    """Queda guardado quién confirmó: sin saber quién, no se decide."""
    candidato = crear_candidato()

    respuesta = confirmar(cliente, candidato, headers={"X-Organizacion-Id": str(ORG_A)})

    assert respuesta.status_code == status.HTTP_403_FORBIDDEN
    assert OutboxEvento.objects.count() == 0


@pytest.mark.parametrize("metodo", ["get", "patch", "delete"])
def test_la_ruta_de_confirmar_solo_acepta_post(cliente, metodo):
    candidato = crear_candidato()

    respuesta = getattr(cliente, metodo)(
        f"{RUTA}{candidato.id}/confirmar/", headers=cabecera()
    )

    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_el_cuerpo_de_la_peticion_se_ignora(cliente):
    candidato = crear_candidato()

    respuesta = cliente.post(
        f"{RUTA}{candidato.id}/confirmar/",
        {"importe": "1", "crear_cobro": True, "servicio": "Otro"},
        format="json",
        headers=cabecera(),
    )

    assert respuesta.status_code == status.HTTP_200_OK
    assert unica_orden().datos["importe"] == "9990.00"
    assert unica_orden().datos["servicio"] == "Netflix"
