"""Revisión de #159 — dos defectos reproducidos en PostgreSQL por los revisores.

    P1  la limpieza de una organización respondía 204 y dejaba atrás su outbox,
        con el importe, la glosa de la cartola y quién confirmó
    P2  perder la confirmación frente a un rechazo devolvía 200 con el
        candidato en `rechazado` y ninguna orden

Acá están las versiones determinísticas, con una sola conexión: lo que el
código DECIDE cuando la fila ya cambió. El mecanismo que sostiene esa decisión
—el bloqueo de fila, con dos conexiones de verdad— está en
`test_carrera_confirmar_rechazar_postgres.py`.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.apps import apps
from django.db import models
from rest_framework.test import APIClient

from connectors import confirmacion, views
from connectors.eliminacion import LimpiezaConnectorsView
from connectors.models import CobroCandidato, Importacion, OutboxEvento
from shared.eliminacion import cabeceras_eliminacion

pytestmark = pytest.mark.django_db

USUARIO = "42"
OTRO_USUARIO = "77"


def cabecera(org, usuario=USUARIO):
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


def crear_candidato(org, *, identificador="sha:2", glosa="NETFLIX.COM", importe="9990"):
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
        servicio="Netflix",
        servicio_texto=glosa,
        servicio_resultado="reconocido",
        importe=Decimal(importe),
        moneda="CLP",
        fecha=date(2026, 10, 1),
        tipo_mensaje=CobroCandidato.TipoMensaje.COBRO_REALIZADO,
        estado=CobroCandidato.Estado.PROPUESTO,
        evidencia={"fila": "2", "descripcion_original": glosa},
    )


def confirmar_por_http(candidato, usuario=USUARIO):
    return APIClient().post(
        f"/api/candidatos/{candidato.pk}/confirmar/",
        headers=cabecera(candidato.organizacion_id, usuario),
    )


def rechazar_por_http(candidato, usuario=USUARIO):
    return APIClient().post(
        f"/api/candidatos/{candidato.pk}/rechazar/",
        headers=cabecera(candidato.organizacion_id, usuario),
    )


def limpiar(org, operacion=None):
    operacion = operacion or uuid.uuid4()
    firma = cabeceras_eliminacion("connectors", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{clave.upper().replace('-', '_')}": valor for clave, valor in firma.items()},
    )


@pytest.fixture
def firma_interna(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")


# ══════════════════════════════════════════════
# P1 — la limpieza se lleva también el outbox
# ══════════════════════════════════════════════


def test_limpiar_una_organizacion_borra_sus_ordenes_y_no_las_ajenas(firma_interna):
    """La reproducción de la revisión: confirmar en A y en B, limpiar A.

    Antes: 204, candidato de A borrado, y su orden intacta con
    `importe="9990.00"`, la glosa `NETFLIX.COM` y el actor `42`.
    """
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    de_a = crear_candidato(org_a, glosa="NETFLIX.COM", importe="9990")
    de_b = crear_candidato(org_b, glosa="SPOTIFY", importe="4990")
    assert confirmar_por_http(de_a).status_code == 200
    assert confirmar_por_http(de_b, OTRO_USUARIO).status_code == 200
    assert OutboxEvento.objects.count() == 2

    assert limpiar(org_a).status_code == 204

    assert not OutboxEvento.objects.filter(organizacion_id=org_a).exists()
    assert not CobroCandidato.objects.filter(organizacion_id=org_a).exists()
    # Ni por la columna ni por el contenido: en lo que queda no hay un solo
    # dato de A. Se mira el sobre entero, que es donde iban el importe, la
    # glosa y quién confirmó.
    restantes = list(OutboxEvento.objects.values_list("organizacion_id", "datos"))
    assert [org for org, _ in restantes] == [org_b]
    assert str(de_a.pk) not in str(restantes)
    assert "NETFLIX.COM" not in str(restantes)

    # B, intacta: su candidato confirmado y su orden, con sus datos.
    de_b.refresh_from_db()
    assert de_b.estado == CobroCandidato.Estado.CONFIRMADO
    sobre_b = restantes[0][1]
    assert sobre_b["candidato_id"] == str(de_b.pk)
    assert sobre_b["importe"] == "4990.00"
    assert sobre_b["decidido_por"] == OTRO_USUARIO


def test_reintentar_la_limpieza_da_lo_mismo_y_no_toca_a_la_otra(firma_interna):
    """El coordinador reintenta hasta recibir el ACK: la segunda vez no puede
    fallar ni llevarse nada más."""
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    confirmar_por_http(crear_candidato(org_a))
    confirmar_por_http(crear_candidato(org_b))
    operacion = uuid.uuid4()

    assert limpiar(org_a, operacion).status_code == 204
    assert limpiar(org_a, operacion).status_code == 204

    assert not OutboxEvento.objects.filter(organizacion_id=org_a).exists()
    assert OutboxEvento.objects.filter(organizacion_id=org_b).count() == 1


def test_despues_de_la_limpieza_no_puede_nacer_otra_orden(firma_interna):
    """La coordinación con una confirmación que llega tarde: toda escritura
    por HTTP toma el bloqueo de la organización, y una organización eliminada
    responde 410. Si no fuera así, la orden nacería DESPUÉS del borrado y
    quedaría huérfana para siempre."""
    org = uuid.uuid4()
    assert limpiar(org).status_code == 204
    # Un candidato que llega tarde, de una importación que ya estaba en vuelo.
    tardio = crear_candidato(org)

    respuesta = confirmar_por_http(tardio)

    assert respuesta.status_code == 410
    assert respuesta.json() == {"code": "organizacion_eliminada"}
    assert not OutboxEvento.objects.filter(organizacion_id=org).exists()
    tardio.refresh_from_db()
    assert tardio.estado == CobroCandidato.Estado.PROPUESTO


def test_toda_tabla_tenant_tiene_quien_la_borre():
    """La regla general detrás del P1: registrar una tabla tenant nueva exige
    cubrir su borrado, además de su creación.

    Una tabla con `organizacion_id` queda cubierta si está en la lista de la
    limpieza, o si cuelga —por una clave foránea en CASCADA— de una que lo
    está. `OutboxEvento` no cumplía ninguna de las dos: no tiene claves
    foráneas, a propósito, y nadie lo había anotado.
    """
    declarados = set(LimpiezaConnectorsView.modelos)

    def cubierto(modelo, vistos=()):
        if modelo in declarados:
            return True
        return any(
            campo.remote_field.on_delete is models.CASCADE
            and campo.related_model not in vistos
            and cubierto(campo.related_model, (*vistos, modelo))
            for campo in modelo._meta.get_fields()
            if isinstance(campo, models.ForeignKey)
        )

    tenant = [
        modelo for modelo in apps.get_app_config("connectors").get_models()
        if any(campo.name == "organizacion_id" for campo in modelo._meta.get_fields())
    ]
    assert OutboxEvento in tenant and CobroCandidato in tenant, "la prueba dejó de ver los modelos"
    sin_cubrir = [modelo.__name__ for modelo in tenant if not cubierto(modelo)]
    assert sin_cubrir == []


# ══════════════════════════════════════════════
# P2 — perder la carrera no es lo mismo que haber confirmado
# ══════════════════════════════════════════════


def test_si_gano_un_rechazo_confirmar_no_devuelve_exito():
    """La instancia se leyó `propuesto` y, antes de escribir, otra petición
    rechazó. El UPDATE condicionado afecta 0 filas. Antes eso se leía siempre
    como «otro confirmó» y se devolvía `False`: la vista respondía 200."""
    candidato = crear_candidato(uuid.uuid4())
    leido_antes = CobroCandidato.objects.get(pk=candidato.pk)
    # La otra petición, confirmada en la base entre la lectura y la escritura.
    CobroCandidato.objects.get(pk=candidato.pk).rechazar(por=OTRO_USUARIO)

    with pytest.raises(confirmacion.ConfirmacionRechazada) as error:
        confirmacion.confirmar(leido_antes, por=USUARIO)

    assert error.value.codigo == confirmacion.CANDIDATO_RECHAZADO
    assert not OutboxEvento.objects.exists()
    candidato.refresh_from_db()
    # El rechazo se conserva entero: estado y auditoría de quien rechazó.
    assert candidato.estado == CobroCandidato.Estado.RECHAZADO
    assert candidato.decidido_por == OTRO_USUARIO


def test_si_gano_otra_confirmacion_sigue_siendo_idempotente():
    """El comportamiento correcto que la corrección tiene que preservar: dos
    confirmaciones, una sola orden y la auditoría de la primera."""
    candidato = crear_candidato(uuid.uuid4())
    leido_antes = CobroCandidato.objects.get(pk=candidato.pk)
    assert confirmacion.confirmar(CobroCandidato.objects.get(pk=candidato.pk), por=OTRO_USUARIO) is True
    primera = CobroCandidato.objects.get(pk=candidato.pk).decidido_en

    assert confirmacion.confirmar(leido_antes, por=USUARIO) is False

    assert OutboxEvento.objects.count() == 1
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.CONFIRMADO
    assert candidato.decidido_por == OTRO_USUARIO
    assert candidato.decidido_en == primera
    # La instancia del que perdió quedó al día: es la que la vista serializa.
    assert leido_antes.estado == CobroCandidato.Estado.CONFIRMADO
    assert leido_antes.decidido_por == OTRO_USUARIO


def test_por_http_el_rechazo_que_gana_da_409_y_no_200(monkeypatch):
    """El mismo intercalado visto desde afuera, con la vista real: el rechazo
    entra justo después de que confirmar leyó el candidato.

    Esperado por el contrato: 409 / candidato_rechazado, el rechazo
    conservado y ninguna orden. Antes: 200 con `estado="rechazado"`.
    """
    candidato = crear_candidato(uuid.uuid4())
    real = confirmacion.confirmar

    def con_un_rechazo_en_medio(leido, **extra):
        # La vista ya hizo su `get_object()`: `leido` dice `propuesto`.
        assert leido.estado == CobroCandidato.Estado.PROPUESTO
        CobroCandidato.objects.get(pk=leido.pk).rechazar(por=OTRO_USUARIO)
        return real(leido, **extra)

    monkeypatch.setattr(views.confirmacion, "confirmar", con_un_rechazo_en_medio)

    respuesta = confirmar_por_http(candidato)

    assert respuesta.status_code == 409
    assert respuesta.json()["codigo"] == confirmacion.CANDIDATO_RECHAZADO
    assert not OutboxEvento.objects.exists()
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.RECHAZADO
    assert candidato.decidido_por == OTRO_USUARIO


def test_por_http_el_orden_inverso_tambien_da_conflicto(monkeypatch):
    """La otra mitad de la carrera: la confirmación entra justo después de que
    rechazar leyó el candidato. Rechazar tiene que perder con 409 y la orden
    —una sola— tiene que existir."""
    candidato = crear_candidato(uuid.uuid4())
    real = CobroCandidato.rechazar

    def con_una_confirmacion_en_medio(self, **extra):
        assert self.estado == CobroCandidato.Estado.PROPUESTO
        confirmacion.confirmar(CobroCandidato.objects.get(pk=self.pk), por=OTRO_USUARIO)
        return real(self, **extra)

    monkeypatch.setattr(CobroCandidato, "rechazar", con_una_confirmacion_en_medio)

    respuesta = rechazar_por_http(candidato)

    assert respuesta.status_code == 409
    assert respuesta.json()["codigo"] == "candidato_ya_confirmado"
    assert OutboxEvento.objects.count() == 1
    candidato.refresh_from_db()
    assert candidato.estado == CobroCandidato.Estado.CONFIRMADO
    assert candidato.decidido_por == OTRO_USUARIO


# ══════════════════════════════════════════════
# «Confirmado» no es «aplicado»
# ══════════════════════════════════════════════


def test_un_confirmado_dice_que_su_aplicacion_esta_pendiente():
    """Lo que piden las dos revisiones para la interfaz: poder distinguir la
    orden guardada de la suscripción creada. Hoy no hay publicador ni
    consumidor, así que TODO confirmado está pendiente, y la respuesta lo
    dice en vez de dejar que `estado="confirmado"` se lea como «ya está»."""
    candidato = crear_candidato(uuid.uuid4())

    respuesta = confirmar_por_http(candidato)

    assert respuesta.status_code == 200
    assert respuesta.json()["estado"] == "confirmado"
    assert respuesta.json()["aplicacion"] == "pendiente"
    # Repetir la confirmación no lo convierte en aplicado.
    assert confirmar_por_http(candidato).json()["aplicacion"] == "pendiente"


def test_la_lista_tambien_lo_dice_y_solo_para_los_confirmados():
    org = uuid.uuid4()
    propuesto = crear_candidato(org, identificador="sha:2")
    rechazado = crear_candidato(org, identificador="sha:3")
    confirmado = crear_candidato(org, identificador="sha:4")
    assert rechazar_por_http(rechazado).status_code == 200
    assert confirmar_por_http(confirmado).status_code == 200

    filas = APIClient().get("/api/candidatos/", headers=cabecera(org)).json()["results"]

    por_id = {fila["id"]: fila["aplicacion"] for fila in filas}
    assert por_id == {
        str(propuesto.pk): None,
        str(rechazado.pk): None,
        str(confirmado.pk): "pendiente",
    }


def test_ningun_valor_afirma_que_la_suscripcion_existe():
    """No hay quien pueda afirmarlo todavía. El día que exista el consumidor
    y aparezca `aplicada`, esta prueba se cambia a propósito, en la misma PR
    que lo implemente y con la evidencia de que la suscripción se creó."""
    from connectors.serializers import CobroCandidatoSerializer

    valores = {
        CobroCandidatoSerializer().get_aplicacion(CobroCandidato(estado=estado))
        for estado in CobroCandidato.Estado.values
    }
    assert valores == {None, "pendiente"}

