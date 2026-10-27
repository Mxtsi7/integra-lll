"""
FE-02 — Listar cuentas conectadas y su estado.

Lo que tiene que quedar demostrado:

- el listado solo muestra las cuentas de la organización de la petición
- sin la cabecera de organización no se entrega nada
- los filtros de estado y proveedor funcionan y rechazan basura
- los tokens no salen por la API, ni siquiera en el detalle
"""

import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from connectors.models import CuentaConectada

pytestmark = pytest.mark.django_db

TOKEN = "ya29.a0AfB_token-de-prueba-largo"
ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

LISTA = "/api/conectores/"


@pytest.fixture
def cliente():
    return APIClient()


def crear(org=ORG_A, proveedor="gmail", cuenta="persona@gmail.com", **extra):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=cuenta, **extra
    )


def cabecera(org=ORG_A):
    return {"X-Organizacion-Id": str(org)}


# ── Aislamiento ──────────────────────────────────────────────────────────


def test_solo_muestra_las_cuentas_de_su_organizacion(cliente, claves):
    crear(org=ORG_A, cuenta="mia@gmail.com")
    crear(org=ORG_B, cuenta="ajena@gmail.com")

    respuesta = cliente.get(LISTA, headers=cabecera(ORG_A))

    assert respuesta.status_code == status.HTTP_200_OK
    cuentas = [c["cuenta_externa"] for c in respuesta.data["results"]]
    assert cuentas == ["mia@gmail.com"]


def test_sin_la_cabecera_de_organizacion_responde_403(cliente, claves):
    crear()
    respuesta = cliente.get(LISTA)
    assert respuesta.status_code == status.HTTP_403_FORBIDDEN


def test_el_detalle_de_una_cuenta_ajena_da_404(cliente, claves):
    ajena = crear(org=ORG_B, cuenta="ajena@gmail.com")
    respuesta = cliente.get(f"{LISTA}{ajena.id}/", headers=cabecera(ORG_A))
    assert respuesta.status_code == status.HTTP_404_NOT_FOUND


# ── Los tokens no salen ──────────────────────────────────────────────────


def test_el_listado_no_expone_los_tokens(cliente, claves):
    crear(access_token=TOKEN, refresh_token=TOKEN)

    respuesta = cliente.get(LISTA, headers=cabecera())

    cuerpo = str(respuesta.content)
    assert TOKEN not in cuerpo
    fila = respuesta.data["results"][0]
    assert "access_token" not in fila
    assert "refresh_token" not in fila


def test_el_detalle_tampoco_los_expone(cliente, claves):
    cuenta = crear(access_token=TOKEN, refresh_token=TOKEN)

    respuesta = cliente.get(f"{LISTA}{cuenta.id}/", headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    assert TOKEN not in str(respuesta.content)
    assert "access_token" not in respuesta.data


# ── El estado, que es lo que pide la tarjeta ─────────────────────────────


def test_devuelve_el_estado_legible_y_si_hay_que_reautorizar(cliente, claves):
    crear(estado=CuentaConectada.Estado.REQUIERE_REAUTORIZACION)

    fila = cliente.get(LISTA, headers=cabecera()).data["results"][0]

    assert fila["estado"] == "requiere_reautorizacion"
    assert fila["estado_legible"]
    assert fila["necesita_reautorizacion"] is True
    assert fila["proveedor_legible"]


# ── Filtros ──────────────────────────────────────────────────────────────


def test_filtra_por_estado(cliente, claves):
    crear(cuenta="ok@gmail.com", estado=CuentaConectada.Estado.CONECTADA)
    crear(cuenta="rota@gmail.com", estado=CuentaConectada.Estado.ERROR)

    respuesta = cliente.get(LISTA, {"estado": "error"}, headers=cabecera())

    assert [c["cuenta_externa"] for c in respuesta.data["results"]] == ["rota@gmail.com"]


def test_filtra_por_proveedor(cliente, claves):
    crear(proveedor="gmail", cuenta="a@gmail.com")
    crear(proveedor="outlook", cuenta="b@outlook.com")

    respuesta = cliente.get(LISTA, {"proveedor": "outlook"}, headers=cabecera())

    assert [c["cuenta_externa"] for c in respuesta.data["results"]] == ["b@outlook.com"]


def test_filtra_las_que_necesitan_reautorizacion(cliente, claves):
    crear(cuenta="ok@gmail.com", estado=CuentaConectada.Estado.CONECTADA)
    crear(cuenta="vencida@gmail.com", estado=CuentaConectada.Estado.REQUIERE_REAUTORIZACION)

    respuesta = cliente.get(
        LISTA, {"necesita_reautorizacion": "true"}, headers=cabecera()
    )

    assert [c["cuenta_externa"] for c in respuesta.data["results"]] == ["vencida@gmail.com"]


def test_una_cuenta_en_error_tambien_necesita_reautorizacion(cliente, claves):
    """Regresión: el filtro y la propiedad decían cosas distintas.

    `necesita_reautorizacion` devuelve True para ERROR, pero el filtro solo
    miraba REQUIERE_REAUTORIZACION. La cuenta desaparecía justo al pedir las
    que necesitan acción.
    """
    crear(cuenta="rota@gmail.com", estado=CuentaConectada.Estado.ERROR)

    respuesta = cliente.get(LISTA, {"necesita_reautorizacion": "true"}, headers=cabecera())

    assert [c["cuenta_externa"] for c in respuesta.data["results"]] == ["rota@gmail.com"]


def test_la_de_error_no_aparece_entre_las_que_no_necesitan(cliente, claves):
    crear(cuenta="ok@gmail.com", estado=CuentaConectada.Estado.CONECTADA)
    crear(cuenta="rota@gmail.com", estado=CuentaConectada.Estado.ERROR)

    respuesta = cliente.get(LISTA, {"necesita_reautorizacion": "false"}, headers=cabecera())

    assert [c["cuenta_externa"] for c in respuesta.data["results"]] == ["ok@gmail.com"]


def test_el_filtro_y_el_json_nunca_se_contradicen(cliente, claves):
    """Lo que el listado dice de cada fila tiene que calzar con el filtro."""
    for estado in CuentaConectada.Estado.values:
        CuentaConectada.objects.all().delete()
        crear(estado=estado)

        con = cliente.get(LISTA, {"necesita_reautorizacion": "true"}, headers=cabecera())
        aparece = len(con.data["results"]) == 1
        dice = cliente.get(LISTA, headers=cabecera()).data["results"][0]["necesita_reautorizacion"]

        assert aparece == dice, f"estado {estado}: el filtro dice {aparece} y el JSON dice {dice}"


def test_la_lista_de_estados_es_la_misma_en_los_dos_lados(claves):
    """Si alguien agrega un estado a uno solo de los dos, esto falla."""
    de_la_consulta = CuentaConectada.filtro_exigen_reautorizar().children[0][1]
    assert tuple(de_la_consulta) == tuple(CuentaConectada.ESTADOS_QUE_EXIGEN_REAUTORIZAR)
    for estado in CuentaConectada.ESTADOS_QUE_EXIGEN_REAUTORIZAR:
        assert CuentaConectada(estado=estado).necesita_reautorizacion is True


@pytest.mark.parametrize(
    "parametros",
    [
        {"estado": "inventado"},
        {"proveedor": "telegram"},
        {"necesita_reautorizacion": "quizas"},
    ],
)
def test_un_filtro_invalido_responde_400_y_no_lista_todo(cliente, claves, parametros):
    """Si no validara, un typo devolvería el listado completo como si nada."""
    crear()
    respuesta = cliente.get(LISTA, parametros, headers=cabecera())
    assert respuesta.status_code == status.HTTP_400_BAD_REQUEST


def test_el_filtro_no_se_aplica_al_detalle(cliente, claves):
    """get_queryset() lo usan list y retrieve: un filtro colgado no debe ocultar el recurso."""
    cuenta = crear(estado=CuentaConectada.Estado.CONECTADA)
    respuesta = cliente.get(
        f"{LISTA}{cuenta.id}/", {"estado": "error"}, headers=cabecera()
    )
    assert respuesta.status_code == status.HTTP_200_OK


# ── No se escribe por acá ────────────────────────────────────────────────


def test_no_se_puede_crear_una_cuenta_con_un_post(cliente, claves):
    """Una cuenta nace del callback de OAuth (FE-04), no de un POST suelto."""
    respuesta = cliente.post(
        LISTA,
        {"proveedor": "gmail", "cuenta_externa": "falsa@gmail.com", "access_token": TOKEN},
        format="json",
        headers=cabecera(),
    )
    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert not CuentaConectada.objects.filter(cuenta_externa="falsa@gmail.com").exists()


# ── Paginación ───────────────────────────────────────────────────────────


def test_el_listado_viene_paginado(cliente, claves):
    for i in range(12):
        crear(cuenta=f"cuenta{i:02d}@gmail.com")

    respuesta = cliente.get(LISTA, headers=cabecera())

    assert respuesta.data["count"] == 12
    assert len(respuesta.data["results"]) == 10
    assert respuesta.data["next"]
