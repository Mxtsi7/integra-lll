"""Tests específicos para la tarjeta de Trello: 'Test de paginación de Suscripciones'.

Verifica:
1. Paginación con distintos volúmenes de datos:
   - 0 suscripciones (lista vacía)
   - 1 suscripción
   - 7 suscripciones (< page_size)
   - 10 suscripciones (límite exacto de página)
   - 11 suscripciones (límite + 1)
   - 25 suscripciones (ejemplo explícito de la tarjeta Trello)
   - 50 suscripciones (múltiples páginas completas)
2. El shape exacto de respuesta requerido para Sebastián y los controles visuales en Home:
   - count (int)
   - next (str | None)
   - previous (str | None)
   - results (list de suscripciones serializadas)
3. Recorrido secuencial completo sin duplicados ni omisiones.
4. Aislamiento multi-tenant con distintos volúmenes por organización.
5. Combinación de paginación con filtros (?estado=...&page=...).
6. Validación del shape de paginación en segunda página.
"""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Subscription


@pytest.fixture()
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture()
def org_a() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture()
def org_b() -> uuid.UUID:
    return uuid.uuid4()


def crear_suscripciones(org_id: uuid.UUID, total: int, estado: str = "activo") -> list[Subscription]:
    """Helper para sembrar un volumen determinado de suscripciones para una organización."""
    items = []
    for i in range(1, total + 1):
        items.append(
            Subscription.objects.create(
                organizacion_id=org_id,
                nombre=f"Suscripcion {i:03d}",
                monto=Decimal(f"{1000 + i * 10}.00"),
                moneda="CLP",
                frecuencia="mensual",
                fecha_proximo_cobro=date(2026, 10, ((i - 1) % 28) + 1),
                categoria="streaming",
                estado=estado,
            )
        )
    return items


@pytest.mark.django_db
class TestPaginacionDistintosVolumenes:
    """Verifica que la paginación funciona correctamente con distintos volúmenes de datos."""

    def test_ejemplo_trello_25_suscripciones_sembradas(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """
        Ejemplo explícito de la tarjeta:
        Con 25 suscripciones sembradas, GET /subscriptions/ debe devolver
        10 resultados y un campo 'next' con el link a la página 2.
        """
        crear_suscripciones(org_a, 25)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.data

        # 10 resultados
        assert len(data["results"]) == 10
        # Total de 25
        assert data["count"] == 25
        # Campo next con link a página 2
        assert data["next"] is not None
        assert "page=2" in data["next"]
        # previous en None para la primera página
        assert data["previous"] is None

    def test_recorrido_completo_3_paginas_con_25_suscripciones(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Recorre las 3 páginas de las 25 suscripciones verificando next, previous, count e integridad."""
        suscripciones_creadas = crear_suscripciones(org_a, 25)
        todos_los_ids_creados = {str(s.id) for s in suscripciones_creadas}

        # ── Página 1 ──────────────────────────────────────────────────
        resp1 = api_client.get("/api/suscripciones/?page=1", headers={"X-Organizacion-Id": str(org_a)})
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["count"] == 25
        assert len(resp1.data["results"]) == 10
        assert resp1.data["next"] is not None
        assert "page=2" in resp1.data["next"]
        assert resp1.data["previous"] is None

        # ── Página 2 ──────────────────────────────────────────────────
        resp2 = api_client.get("/api/suscripciones/?page=2", headers={"X-Organizacion-Id": str(org_a)})
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["count"] == 25
        assert len(resp2.data["results"]) == 10
        assert resp2.data["next"] is not None
        assert "page=3" in resp2.data["next"]
        assert resp2.data["previous"] is not None

        # ── Página 3 ──────────────────────────────────────────────────
        resp3 = api_client.get("/api/suscripciones/?page=3", headers={"X-Organizacion-Id": str(org_a)})
        assert resp3.status_code == status.HTTP_200_OK
        assert resp3.data["count"] == 25
        assert len(resp3.data["results"]) == 5
        assert resp3.data["next"] is None
        assert resp3.data["previous"] is not None

        # ── Página 4 (fuera de rango) ─────────────────────────────────
        resp4 = api_client.get("/api/suscripciones/?page=4", headers={"X-Organizacion-Id": str(org_a)})
        assert resp4.status_code == status.HTTP_404_NOT_FOUND

        # ── Integridad total: no hay duplicados ni elementos omitidos ─
        ids_pag1 = [s["id"] for s in resp1.data["results"]]
        ids_pag2 = [s["id"] for s in resp2.data["results"]]
        ids_pag3 = [s["id"] for s in resp3.data["results"]]

        total_ids_obtenidos = ids_pag1 + ids_pag2 + ids_pag3
        assert len(total_ids_obtenidos) == 25
        assert len(set(total_ids_obtenidos)) == 25
        assert set(total_ids_obtenidos) == todos_los_ids_creados

    def test_volumen_cero_suscripciones(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Con 0 suscripciones: count=0, results=[], next=None, previous=None."""
        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 0
        assert response.data["results"] == []
        assert response.data["next"] is None
        assert response.data["previous"] is None

    def test_volumen_una_suscripcion(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Con 1 suscripción: count=1, 1 resultado, sin páginas extra."""
        crear_suscripciones(org_a, 1)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 1
        assert len(response.data["results"]) == 1
        assert response.data["next"] is None
        assert response.data["previous"] is None

    def test_volumen_menor_a_page_size_7_items(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Con 7 suscripciones (< page_size=10): devuelve los 7, next=None, previous=None."""
        crear_suscripciones(org_a, 7)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 7
        assert len(response.data["results"]) == 7
        assert response.data["next"] is None
        assert response.data["previous"] is None

    def test_volumen_exacto_limite_de_pagina_10_items(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Con exactamente 10 suscripciones: no debe generar next link a página 2 inexistente."""
        crear_suscripciones(org_a, 10)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == 10
        assert len(response.data["results"]) == 10
        assert response.data["next"] is None
        assert response.data["previous"] is None

        # Página 2 no existe
        resp_p2 = api_client.get(
            "/api/suscripciones/?page=2",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert resp_p2.status_code == status.HTTP_404_NOT_FOUND

    def test_volumen_limite_mas_uno_11_items(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Con 11 suscripciones: página 1 tiene 10 items y next; página 2 tiene 1 item y previous."""
        crear_suscripciones(org_a, 11)

        resp1 = api_client.get("/api/suscripciones/", headers={"X-Organizacion-Id": str(org_a)})
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["count"] == 11
        assert len(resp1.data["results"]) == 10
        assert resp1.data["next"] is not None

        resp2 = api_client.get("/api/suscripciones/?page=2", headers={"X-Organizacion-Id": str(org_a)})
        assert resp2.status_code == status.HTTP_200_OK
        assert resp2.data["count"] == 11
        assert len(resp2.data["results"]) == 1
        assert resp2.data["next"] is None
        assert resp2.data["previous"] is not None

    def test_gran_volumen_50_suscripciones(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Con 50 suscripciones: genera exactamente 5 páginas de 10 elementos."""
        crear_suscripciones(org_a, 50)

        # Página 1
        resp1 = api_client.get("/api/suscripciones/", headers={"X-Organizacion-Id": str(org_a)})
        assert resp1.status_code == status.HTTP_200_OK
        assert resp1.data["count"] == 50
        assert len(resp1.data["results"]) == 10

        # Última página válida: página 5
        resp5 = api_client.get("/api/suscripciones/?page=5", headers={"X-Organizacion-Id": str(org_a)})
        assert resp5.status_code == status.HTTP_200_OK
        assert resp5.data["count"] == 50
        assert len(resp5.data["results"]) == 10
        assert resp5.data["next"] is None
        assert resp5.data["previous"] is not None

        # Página 6 debe ser 404
        resp6 = api_client.get("/api/suscripciones/?page=6", headers={"X-Organizacion-Id": str(org_a)})
        assert resp6.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestShapePaginacionContratoFrontend:
    """
    Consideraciones de la tarjeta:
    'Sebastián implementará los controles de paginación visual en Home sobre esta
    misma respuesta; confirmar con él el shape exacto de count / next / previous
    antes de cerrar el endpoint.'
    """

    CAMPOS_OBLIGATORIOS_RAIZ = {"count", "next", "previous", "results"}
    CAMPOS_OBLIGATORIOS_ITEM = {
        "id",
        "nombre",
        "monto",
        "moneda",
        "frecuencia",
        "fecha_proximo_cobro",
        "categoria",
        "estado",
        "fin_prueba",
        "horas_uso_mes",
        "ultima_actividad",
        "proveedor",
        "organizacion_id",
        "creado_en",
        "actualizado_en",
    }

    def test_shape_exacto_respuesta_raiz(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Valida que la respuesta posee el shape exacto requerido por el frontend y PaginationProps."""
        crear_suscripciones(org_a, 15)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.data

        # 1. Claves de primer nivel exactas
        assert set(data.keys()) == self.CAMPOS_OBLIGATORIOS_RAIZ

        # 2. Tipos de datos estrictos
        assert isinstance(data["count"], int)
        assert data["count"] == 15
        assert isinstance(data["next"], str)
        assert data["previous"] is None
        assert isinstance(data["results"], list)
        assert len(data["results"]) == 10

    def test_shape_exacto_cada_elemento_en_results(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Cada elemento del arreglo 'results' debe contener los campos del modelo requeridos por el frontend."""
        crear_suscripciones(org_a, 3)

        response = api_client.get(
            "/api/suscripciones/",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        data = response.data

        for item in data["results"]:
            assert isinstance(item, dict)
            assert self.CAMPOS_OBLIGATORIOS_ITEM.issubset(set(item.keys()))
            assert isinstance(item["id"], str)
            assert isinstance(item["nombre"], str)
            assert isinstance(item["monto"], str)  # DecimalField se serializa como string
            assert isinstance(item["moneda"], str)
            assert item["moneda"] in ("CLP", "USD")
            assert isinstance(item["frecuencia"], str)
            assert isinstance(item["fecha_proximo_cobro"], str)
            assert isinstance(item["estado"], str)
            assert str(item["organizacion_id"]) == str(org_a)

    def test_shape_paginacion_segunda_pagina(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """Verifica que /api/suscripciones/?page=2 devuelve el contrato correcto en la segunda página."""
        crear_suscripciones(org_a, 12)

        resp = api_client.get("/api/suscripciones/?page=2", headers={"X-Organizacion-Id": str(org_a)})

        assert resp.status_code == status.HTTP_200_OK

        assert resp.data["count"] == 12
        assert len(resp.data["results"]) == 2
        assert resp.data["next"] is None
        assert resp.data["previous"] is not None


@pytest.mark.django_db
class TestPaginacionAislamientoYFiltros:
    """Pruebas de interacción entre paginación, filtros y aislamiento multi-tenant."""

    def test_paginacion_aislamiento_entre_organizaciones_con_volumenes_distintos(
        self, api_client: APIClient, org_a: uuid.UUID, org_b: uuid.UUID
    ) -> None:
        """Organización A con 25 suscripciones y Organización B con 15 suscripciones no se mezclan."""
        crear_suscripciones(org_a, 25)
        crear_suscripciones(org_b, 15)

        # Org A
        resp_a1 = api_client.get("/api/suscripciones/", headers={"X-Organizacion-Id": str(org_a)})
        assert resp_a1.data["count"] == 25
        assert len(resp_a1.data["results"]) == 10
        for s in resp_a1.data["results"]:
            assert str(s["organizacion_id"]) == str(org_a)

        # Org B
        resp_b1 = api_client.get("/api/suscripciones/", headers={"X-Organizacion-Id": str(org_b)})
        assert resp_b1.data["count"] == 15
        assert len(resp_b1.data["results"]) == 10
        for s in resp_b1.data["results"]:
            assert str(s["organizacion_id"]) == str(org_b)

        # Página 2 de B solo tiene 5 elementos
        resp_b2 = api_client.get("/api/suscripciones/?page=2", headers={"X-Organizacion-Id": str(org_b)})
        assert resp_b2.data["count"] == 15
        assert len(resp_b2.data["results"]) == 5
        assert resp_b2.data["next"] is None

        # Página 3 de B responde 404 (B solo tiene 15)
        resp_b3 = api_client.get("/api/suscripciones/?page=3", headers={"X-Organizacion-Id": str(org_b)})
        assert resp_b3.status_code == status.HTTP_404_NOT_FOUND

        # Página 3 de A sí existe y tiene 5 elementos (A tiene 25)
        resp_a3 = api_client.get("/api/suscripciones/?page=3", headers={"X-Organizacion-Id": str(org_a)})
        assert resp_a3.status_code == status.HTTP_200_OK
        assert resp_a3.data["count"] == 25
        assert len(resp_a3.data["results"]) == 5

    def test_paginacion_combinada_con_filtro_estado(
        self, api_client: APIClient, org_a: uuid.UUID
    ) -> None:
        """25 suscripciones sembradas: 18 activas y 7 canceladas."""
        crear_suscripciones(org_a, 18, estado="activo")
        crear_suscripciones(org_a, 7, estado="cancelado")

        # Activas: total 18 -> página 1 (10), página 2 (8)
        resp_act_p1 = api_client.get(
            "/api/suscripciones/?estado=activo",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert resp_act_p1.data["count"] == 18
        assert len(resp_act_p1.data["results"]) == 10
        assert resp_act_p1.data["next"] is not None

        resp_act_p2 = api_client.get(
            "/api/suscripciones/?estado=activo&page=2",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert resp_act_p2.data["count"] == 18
        assert len(resp_act_p2.data["results"]) == 8
        assert resp_act_p2.data["next"] is None
        assert all(s["estado"] == "activo" for s in resp_act_p2.data["results"])

        # Canceladas: total 7 -> solo 1 página (7), next=None
        resp_canc = api_client.get(
            "/api/suscripciones/?estado=cancelado",
            headers={"X-Organizacion-Id": str(org_a)},
        )
        assert resp_canc.data["count"] == 7
        assert len(resp_canc.data["results"]) == 7
        assert resp_canc.data["next"] is None
        assert all(s["estado"] == "cancelado" for s in resp_canc.data["results"])
