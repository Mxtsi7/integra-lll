"""
FE-19 — Listar alertas con filtro y paginación.
FE-20 — Marcar alertas leídas y consultar contador.

Lo que tiene que quedar demostrado:

- el listado y el contador solo ven las alertas de su organización
- los filtros funcionan y rechazan basura en vez de devolver todo
- marcar leída y revisar cambian el estado y el contador baja
- no se pueden crear ni editar alertas desde afuera
"""

import uuid
from datetime import timedelta

import pytest
from rest_framework import status
from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Alerta

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

LISTA = "/api/alertas/"
CONTADOR = "/api/alertas/contador/"


@pytest.fixture
def cliente():
    return APIClient()


def crear(org=ORG_A, tipo=Alerta.Tipo.PROXIMO_COBRO, **extra):
    extra.setdefault("titulo", "Netflix se cobra en 3 días")
    extra.setdefault("mensaje", "El cobro de 9.990 está programado.")
    return Alerta.objects.create(organizacion_id=org, tipo=tipo, **extra)


def cab(org=ORG_A):
    return {"X-Organizacion-Id": str(org)}


# ── Aislamiento ──────────────────────────────────────────────────────────


def test_solo_lista_las_alertas_de_su_organizacion(cliente):
    crear(org=ORG_A, titulo="mia")
    crear(org=ORG_B, titulo="ajena")

    respuesta = cliente.get(LISTA, headers=cab(ORG_A))

    assert respuesta.status_code == status.HTTP_200_OK
    assert [a["titulo"] for a in respuesta.data["results"]] == ["mia"]


def test_sin_cabecera_de_organizacion_responde_403(cliente):
    crear()
    assert cliente.get(LISTA).status_code == status.HTTP_403_FORBIDDEN


def test_el_contador_no_cuenta_las_de_otra_organizacion(cliente):
    crear(org=ORG_A)
    crear(org=ORG_B)
    crear(org=ORG_B)

    datos = cliente.get(CONTADOR, headers=cab(ORG_A)).data

    assert datos == {"pendientes": 1, "total": 1}


def test_no_se_puede_leer_una_alerta_ajena(cliente):
    ajena = crear(org=ORG_B)
    respuesta = cliente.post(f"{LISTA}{ajena.id}/leer/", headers=cab(ORG_A))
    assert respuesta.status_code == status.HTTP_404_NOT_FOUND
    ajena.refresh_from_db()
    assert ajena.pendiente is True


# ── FE-19: filtros y paginación ──────────────────────────────────────────


def test_filtra_por_estado_de_lectura(cliente):
    crear(titulo="sin ver")
    leida = crear(titulo="ya vista")
    leida.marcar_leida()

    respuesta = cliente.get(LISTA, {"lectura": "pendiente"}, headers=cab())

    assert [a["titulo"] for a in respuesta.data["results"]] == ["sin ver"]


def test_filtra_por_tipo(cliente):
    crear(tipo=Alerta.Tipo.PROXIMO_COBRO, titulo="cobro")
    crear(tipo=Alerta.Tipo.ALZA_TARIFA, titulo="alza")

    respuesta = cliente.get(LISTA, {"tipo": "alza_tarifa"}, headers=cab())

    assert [a["titulo"] for a in respuesta.data["results"]] == ["alza"]


def test_filtra_por_suscripcion(cliente):
    suscripcion = uuid.uuid4()
    crear(suscripcion_id=suscripcion, titulo="de esa")
    crear(titulo="de otra")

    respuesta = cliente.get(LISTA, {"suscripcion_id": str(suscripcion)}, headers=cab())

    assert [a["titulo"] for a in respuesta.data["results"]] == ["de esa"]


@pytest.mark.parametrize(
    "parametros",
    [
        {"lectura": "inventado"},
        {"tipo": "no_existe"},
        {"suscripcion_id": "esto-no-es-un-uuid"},
    ],
)
def test_un_filtro_invalido_responde_400_y_no_lista_todo(cliente, parametros):
    """Sin validar, un typo devolvería el listado completo como si nada."""
    crear()
    respuesta = cliente.get(LISTA, parametros, headers=cab())
    assert respuesta.status_code == status.HTTP_400_BAD_REQUEST


def test_el_filtro_no_se_aplica_al_detalle(cliente):
    alerta = crear()
    respuesta = cliente.get(
        f"{LISTA}{alerta.id}/", {"lectura": "revisada"}, headers=cab()
    )
    assert respuesta.status_code == status.HTTP_200_OK


def test_el_listado_viene_paginado(cliente):
    for i in range(12):
        crear(titulo=f"alerta {i:02d}")

    respuesta = cliente.get(LISTA, headers=cab())

    assert respuesta.data["count"] == 12
    assert len(respuesta.data["results"]) == 10
    assert respuesta.data["next"]


def test_las_mas_nuevas_van_primero(cliente):
    vieja = crear(titulo="vieja")
    Alerta.objects.filter(pk=vieja.pk).update(creado_en=timezone.now() - timedelta(days=1))
    crear(titulo="nueva")
    titulos = [a["titulo"] for a in cliente.get(LISTA, headers=cab()).data["results"]]
    assert titulos == ["nueva", "vieja"]


# ── FE-20: marcar y contar ───────────────────────────────────────────────


def test_marcar_leida_baja_el_contador(cliente):
    alerta = crear()
    assert cliente.get(CONTADOR, headers=cab()).data["pendientes"] == 1

    respuesta = cliente.post(f"{LISTA}{alerta.id}/leer/", headers=cab())

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.data["lectura"] == "leida"
    assert respuesta.data["pendiente"] is False
    assert cliente.get(CONTADOR, headers=cab()).data["pendientes"] == 0


def test_revisar_la_descarta_y_tambien_baja_el_contador(cliente):
    alerta = crear(tipo=Alerta.Tipo.ALZA_TARIFA)

    respuesta = cliente.post(f"{LISTA}{alerta.id}/revisar/", headers=cab())

    assert respuesta.data["lectura"] == "revisada"
    assert respuesta.data["revisada_en"] is not None
    assert cliente.get(CONTADOR, headers=cab()).data["pendientes"] == 0


def test_leer_todas_vacia_la_campana(cliente):
    for i in range(3):
        crear(titulo=f"a{i}")
    ya_leida = crear(titulo="ya vista")
    ya_leida.marcar_leida()

    respuesta = cliente.post(f"{LISTA}leer-todas/", headers=cab())

    assert respuesta.data == {"leidas": 3}
    assert cliente.get(CONTADOR, headers=cab()).data["pendientes"] == 0


def test_leer_todas_le_pone_fecha_a_cada_una(cliente):
    """Un update() masivo dejaría el estado cambiado y la fecha en NULL."""
    crear()
    crear()

    cliente.post(f"{LISTA}leer-todas/", headers=cab())

    assert not Alerta.objects.filter(leida_en__isnull=True).exists()


def test_leer_todas_no_toca_las_de_otra_organizacion(cliente):
    crear(org=ORG_A)
    de_otra = crear(org=ORG_B)

    cliente.post(f"{LISTA}leer-todas/", headers=cab(ORG_A))

    de_otra.refresh_from_db()
    assert de_otra.pendiente is True


def test_leerla_dos_veces_no_falla_ni_descuenta_de_mas(cliente):
    alerta = crear()
    cliente.post(f"{LISTA}{alerta.id}/leer/", headers=cab())
    respuesta = cliente.post(f"{LISTA}{alerta.id}/leer/", headers=cab())

    assert respuesta.status_code == status.HTTP_200_OK
    assert cliente.get(CONTADOR, headers=cab()).data["pendientes"] == 0


# ── Regresiones de la revisión de la #84 ─────────────────────────────────


@pytest.mark.parametrize("ruta", [CONTADOR, LISTA + "leer-todas/"])
def test_las_acciones_sin_cabecera_dan_403_no_cero(cliente, ruta):
    """Antes consultaban el ORM directo: sin cabecera filtraban por None y
    respondían 200 con cero alertas. Una configuración rota se veía igual que
    una bandeja vacía."""
    crear()
    metodo = cliente.get if ruta == CONTADOR else cliente.post
    respuesta = metodo(ruta)
    assert respuesta.status_code == status.HTTP_403_FORBIDDEN


def test_leer_todas_sin_cabecera_no_toca_nada(cliente):
    alerta = crear()
    cliente.post(LISTA + "leer-todas/")
    alerta.refresh_from_db()
    assert alerta.pendiente is True


def test_el_orden_es_total_con_fechas_iguales(cliente):
    """Sin desempate por id, páginas consecutivas podían repetir o saltarse filas."""
    fijo = timezone.now()
    for i in range(15):
        a = crear(titulo=f"alerta {i:02d}")
        Alerta.objects.filter(pk=a.pk).update(creado_en=fijo)

    primera = cliente.get(LISTA, headers=cab()).data["results"]
    segunda = cliente.get(LISTA, {"page": 2}, headers=cab()).data["results"]
    ids = [a["id"] for a in primera] + [a["id"] for a in segunda]

    assert len(set(ids)) == 15, "hay filas repetidas entre páginas"


def test_el_orden_se_repite_entre_consultas(cliente):
    fijo = timezone.now()
    for i in range(12):
        a = crear(titulo=f"a{i:02d}")
        Alerta.objects.filter(pk=a.pk).update(creado_en=fijo)

    uno = [a["id"] for a in cliente.get(LISTA, headers=cab()).data["results"]]
    otro = [a["id"] for a in cliente.get(LISTA, headers=cab()).data["results"]]
    assert uno == otro


@pytest.mark.parametrize("accion", ["leer", "revisar"])
def test_las_acciones_aceptan_patch_ademas_de_post(cliente, accion):
    """La tarjeta pide PATCH; los clientes que ya existen usan POST."""
    alerta = crear()
    respuesta = cliente.patch(f"{LISTA}{alerta.id}/{accion}/", headers=cab())
    assert respuesta.status_code == status.HTTP_200_OK


def test_aceptar_patch_en_la_accion_no_habilita_el_patch_del_recurso(cliente):
    alerta = crear()
    respuesta = cliente.patch(
        f"{LISTA}{alerta.id}/", {"titulo": "x"}, format="json", headers=cab()
    )
    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


# ── No se escribe por acá ────────────────────────────────────────────────


def test_no_se_puede_crear_una_alerta_con_un_post(cliente):
    """Una alerta nace de un evento, no de que alguien la invente."""
    respuesta = cliente.post(
        LISTA,
        {"tipo": "alza_tarifa", "titulo": "falsa", "mensaje": "x"},
        format="json",
        headers=cab(),
    )
    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert not Alerta.objects.filter(titulo="falsa").exists()


def test_no_se_puede_editar_una_alerta(cliente):
    alerta = crear()
    respuesta = cliente.patch(
        f"{LISTA}{alerta.id}/", {"titulo": "cambiado"}, format="json", headers=cab()
    )
    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_el_evento_de_origen_no_sale_en_la_respuesta(cliente):
    """Es plomería de la idempotencia de FE-24, no información del usuario."""
    crear(evento_id=uuid.uuid4())
    fila = cliente.get(LISTA, headers=cab()).data["results"][0]
    assert "evento_id" not in fila
