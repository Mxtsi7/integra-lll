"""S3-FE-16 — rechazar candidatos sin crear suscripciones ni cobros.

Los criterios de la tarjeta:
- un rechazo no crea suscripción ni cobro
- rechazar nuevamente tiene resultado definido

Y lo que hace que no sea un agujero: el candidato NO se borra —si se borrara,
S3-FE-17 lo volvería a proponer la próxima vez que se lea el mismo archivo—,
queda registrado quién decidió y cuándo, la segunda petición no mueve esa
fecha, y un candidato ya confirmado no se puede rechazar.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors.models import CandidatoYaConfirmado, CobroCandidato, Importacion

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


def crear_importacion(org=ORG_A):
    return Importacion.objects.create(
        organizacion_id=org,
        usuario_id=USUARIO,
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
    )


def crear_candidato(
    importacion=None,
    *,
    org=ORG_A,
    identificador="sha:2",
    estado=CobroCandidato.Estado.PROPUESTO,
):
    importacion = importacion or crear_importacion(org)
    return CobroCandidato.objects.create(
        organizacion_id=importacion.organizacion_id,
        importacion=importacion,
        origen=CobroCandidato.Origen.CSV,
        identificador_origen=identificador,
        servicio="Netflix",
        servicio_texto="NETFLIX.COM",
        servicio_resultado="reconocido",
        importe=Decimal("9990"),
        moneda="CLP",
        fecha=date(2026, 10, 1),
        tipo_mensaje=CobroCandidato.TipoMensaje.COBRO_REALIZADO,
        estado=estado,
        evidencia={"fila": "2", "descripcion_original": "NETFLIX.COM"},
    )


def rechazar(cliente, candidato, **extra):
    return cliente.post(f"{RUTA}{candidato.id}/rechazar/", {}, format="json", **extra)


# ══════════════════════════════════════════════════════════════════════
# El camino feliz, y la trazabilidad
# ══════════════════════════════════════════════════════════════════════


def test_rechazar_deja_el_candidato_rechazado(cliente):
    candidato = crear_candidato()

    respuesta = rechazar(cliente, candidato, headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.json()["estado"] == CobroCandidato.Estado.RECHAZADO
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.RECHAZADO


def test_queda_registrado_quien_rechazo_y_cuando(cliente):
    """Sin esto, un rechazo no se puede auditar y el dato no se reconstruye."""
    candidato = crear_candidato()
    antes = timezone.now()

    cuerpo = rechazar(cliente, candidato, headers=cabecera(usuario=OTRO_USUARIO)).json()

    assert cuerpo["decidido_por"] == OTRO_USUARIO
    assert cuerpo["decidido_en"] is not None
    candidato.refresh_from_db()
    assert candidato.decidido_en >= antes


def test_el_candidato_rechazado_no_se_borra_y_sigue_consultable(cliente):
    """Borrarlo perdería la trazabilidad, y S3-FE-17 lo volvería a proponer.

    El identificador de origen es `<sha256>:<fila>`: si la fila desapareciera
    de la tabla, releer el mismo archivo la propondría de nuevo como si nadie
    la hubiera visto.
    """
    candidato = crear_candidato()

    rechazar(cliente, candidato, headers=cabecera())

    assert CobroCandidato.objects.filter(pk=candidato.pk).exists()
    listado = cliente.get(RUTA, {"estado": "rechazado"}, headers=cabecera()).json()
    assert listado["count"] == 1
    assert listado["results"][0]["identificador_origen"] == "sha:2"


# ══════════════════════════════════════════════════════════════════════
# Criterio: un rechazo no crea suscripción ni cobro
# ══════════════════════════════════════════════════════════════════════


def test_rechazar_no_marca_la_importacion_como_confirmada(cliente):
    """`confirmada_en` es la marca de "se tocaron las suscripciones" (FE-08).

    Es lo único que este servicio puede afirmar sobre movimientos: las
    suscripciones y los cobros viven en `subscriptions` y acá no se conocen
    (ADR-002). Si rechazar moviera esta fecha, el resto del sistema leería que
    alguien aceptó la importación.
    """
    importacion = crear_importacion()
    candidato = crear_candidato(importacion)

    rechazar(cliente, candidato, headers=cabecera())

    importacion.refresh_from_db()
    assert importacion.confirmada_en is None
    assert importacion.estado == Importacion.Estado.PENDIENTE


def test_rechazar_uno_no_toca_a_los_demas(cliente):
    importacion = crear_importacion()
    rechazado = crear_candidato(importacion, identificador="sha:2")
    intacto = crear_candidato(importacion, identificador="sha:3")

    rechazar(cliente, rechazado, headers=cabecera())

    intacto.refresh_from_db()
    assert intacto.estado == CobroCandidato.Estado.PROPUESTO
    assert intacto.decidido_en is None
    assert intacto.decidido_por == ""


def test_rechazar_no_cambia_el_importe_ni_la_evidencia(cliente):
    """Un candidato es evidencia de lo que decía la cartola, decidido o no."""
    candidato = crear_candidato()

    rechazar(cliente, candidato, headers=cabecera())

    candidato.refresh_from_db()
    assert candidato.importe == Decimal("9990")
    assert candidato.moneda == "CLP"
    assert candidato.evidencia == {"fila": "2", "descripcion_original": "NETFLIX.COM"}


# ══════════════════════════════════════════════════════════════════════
# Criterio: rechazar nuevamente tiene resultado definido
# ══════════════════════════════════════════════════════════════════════


def test_rechazar_dos_veces_devuelve_200_las_dos(cliente):
    candidato = crear_candidato()

    primera = rechazar(cliente, candidato, headers=cabecera())
    segunda = rechazar(cliente, candidato, headers=cabecera())

    assert primera.status_code == segunda.status_code == status.HTTP_200_OK
    assert segunda.json()["estado"] == CobroCandidato.Estado.RECHAZADO


def test_la_segunda_peticion_no_mueve_la_fecha_ni_el_autor(cliente):
    """La decisión es la primera, no la última petición que llegó.

    Es lo que le permite a S3-CH-09 reintentar sin cuidarse de los dobles
    envíos: mandar dos veces no reescribe la auditoría.
    """
    candidato = crear_candidato()

    primera = rechazar(cliente, candidato, headers=cabecera(usuario=USUARIO)).json()
    segunda = rechazar(cliente, candidato, headers=cabecera(usuario=OTRO_USUARIO)).json()

    assert segunda["decidido_en"] == primera["decidido_en"]
    assert segunda["decidido_por"] == primera["decidido_por"] == USUARIO


def test_el_metodo_del_modelo_dice_si_cambio_algo():
    """`True` la primera vez, `False` después. Lo usa quien necesite saberlo."""
    candidato = crear_candidato()

    assert candidato.rechazar(por=USUARIO) is True
    assert candidato.rechazar(por=OTRO_USUARIO) is False


# ══════════════════════════════════════════════════════════════════════
# Un confirmado no se rechaza
# ══════════════════════════════════════════════════════════════════════


def test_rechazar_un_confirmado_es_409_con_codigo_estable(cliente):
    """Ese ya creó suscripciones y cobros: deshacerlos es otra operación."""
    candidato = crear_candidato(estado=CobroCandidato.Estado.CONFIRMADO)

    respuesta = rechazar(cliente, candidato, headers=cabecera())

    assert respuesta.status_code == status.HTTP_409_CONFLICT
    assert respuesta.json()["codigo"] == "candidato_ya_confirmado"
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.CONFIRMADO


def test_si_lo_confirman_entremedio_el_rechazo_no_pasa(monkeypatch):
    """La carrera: confirmado entre la comprobación y el UPDATE.

    La guarda real va en el WHERE, así que el `UPDATE` no afecta ninguna fila
    y el llamador se entera igual que si hubiera llegado tarde desde el
    principio. Sin esa guarda, el rechazo pisaría un candidato con
    movimientos ya creados.
    """
    candidato = crear_candidato()
    original = timezone.now

    def confirmarlo_justo_antes():
        CobroCandidato.objects.filter(pk=candidato.pk).update(
            estado=CobroCandidato.Estado.CONFIRMADO
        )
        monkeypatch.setattr(timezone, "now", original)
        return original()

    monkeypatch.setattr(timezone, "now", confirmarlo_justo_antes)

    with pytest.raises(CandidatoYaConfirmado):
        candidato.rechazar(por=USUARIO)

    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.CONFIRMADO
    assert candidato.decidido_en is None


# ══════════════════════════════════════════════════════════════════════
# El aislamiento y los permisos
# ══════════════════════════════════════════════════════════════════════


def test_no_se_puede_rechazar_un_candidato_de_otra_organizacion(cliente):
    """404 y no 403: un 403 confirmaría que ese id es de alguien."""
    ajeno = crear_candidato(org=ORG_B)

    respuesta = rechazar(cliente, ajeno, headers=cabecera(org=ORG_A))

    assert respuesta.status_code == status.HTTP_404_NOT_FOUND
    ajeno.refresh_from_db()
    assert ajeno.estado == CobroCandidato.Estado.PROPUESTO


def test_sin_cabecera_de_organizacion_no_se_rechaza_nada(cliente):
    candidato = crear_candidato()

    respuesta = rechazar(cliente, candidato, headers={})

    assert respuesta.status_code == status.HTTP_403_FORBIDDEN
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.PROPUESTO


def test_sin_cabecera_de_usuario_tampoco(cliente):
    """Queda guardado quién decidió: sin saber quién, no se decide."""
    candidato = crear_candidato()

    respuesta = rechazar(
        cliente, candidato, headers={"X-Organizacion-Id": str(ORG_A)}
    )

    assert respuesta.status_code == status.HTTP_403_FORBIDDEN
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.PROPUESTO


@pytest.mark.parametrize("metodo", ["get", "patch", "delete"])
def test_la_ruta_de_rechazar_solo_acepta_post(cliente, metodo):
    candidato = crear_candidato()

    respuesta = getattr(cliente, metodo)(
        f"{RUTA}{candidato.id}/rechazar/", headers=cabecera()
    )

    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_rechazar_un_id_que_no_existe_es_404(cliente):
    respuesta = cliente.post(
        f"{RUTA}{uuid.uuid4()}/rechazar/", {}, format="json", headers=cabecera()
    )

    assert respuesta.status_code == status.HTTP_404_NOT_FOUND


def test_el_cuerpo_de_la_peticion_se_ignora(cliente):
    """No hay nada que mandar: un cliente que mande cualquier cosa no rompe."""
    candidato = crear_candidato()

    respuesta = cliente.post(
        f"{RUTA}{candidato.id}/rechazar/",
        {"estado": "confirmado", "importe": "1", "decidido_por": "999"},
        format="json",
        headers=cabecera(),
    )

    assert respuesta.status_code == status.HTTP_200_OK
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.RECHAZADO
    assert candidato.importe == Decimal("9990")
    assert candidato.decidido_por == USUARIO


def test_el_contrato_expone_la_decision(cliente):
    """Los dos campos nuevos entran en el contrato que lista S3-FE-14."""
    crear_candidato()

    fila = cliente.get(RUTA, headers=cabecera()).json()["results"][0]

    assert fila["decidido_en"] is None
    assert fila["decidido_por"] == ""
