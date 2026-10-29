"""Regresiones de la revisión del PR #122 (VI-19 / VI-23).

Cubre los cuatro defectos reproducidos sobre ``aeb20ba``:

1. el porcentaje de un alza extrema no cabía en el campo y el cobro quedaba
   persistido aunque la API devolviera 500;
2. una moneda inválida producía 500 en el POST de cobros;
3. el redondeo del promedio ocultaba alzas superiores al 5 %;
4. la sanitización descartaba monedas válidas del catálogo extensible.
"""

from datetime import date
from decimal import Decimal
from io import StringIO
import uuid

import pytest
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Cobro, HallazgoCobro, Moneda, Subscription
from app.sanitizacion_ia import enviar_contexto_ia


pytestmark = pytest.mark.django_db


def headers(org: uuid.UUID) -> dict[str, str]:
    return {
        "X-Organizacion-Id": str(org),
        "X-Usuario-Id": "42",
        "X-Rol": "titular",
    }


def crear_suscripcion(
    org: uuid.UUID,
    *,
    monto: str = "10000.00",
    moneda: str = "CLP",
) -> Subscription:
    return Subscription.objects.create(
        organizacion_id=org,
        nombre="Servicio",
        monto=Decimal(monto),
        moneda=moneda,
        frecuencia=Subscription.Frecuencia.MENSUAL,
        fecha_proximo_cobro=date(2026, 8, 5),
    )


def crear_cobro(
    suscripcion: Subscription,
    fecha: date,
    monto: str,
    *,
    moneda: str | None = None,
) -> Cobro:
    return Cobro.objects.create(
        organizacion_id=suscripcion.organizacion_id,
        suscripcion=suscripcion,
        monto=Decimal(monto),
        moneda=moneda or suscripcion.moneda,
        fecha=fecha,
    )


def post_cobro(cliente: APIClient, suscripcion: Subscription, data: dict):
    return cliente.post(
        f"/api/suscripciones/{suscripcion.id}/cobros/",
        data=data,
        format="json",
        headers=headers(suscripcion.organizacion_id),
    )


# ── 1. P1: porcentaje fuera de rango y atomicidad ────────────────────


def test_un_alza_extrema_responde_201_y_persiste_un_solo_cobro() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org, monto="0.01", moneda="USD")
    cliente = APIClient()

    for fecha in ("2026-08-05", "2026-09-05"):
        respuesta = post_cobro(
            cliente,
            suscripcion,
            {"monto": "0.01", "fecha": fecha, "moneda": "USD"},
        )
        assert respuesta.status_code == status.HTTP_201_CREATED

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "1000.00", "fecha": "2026-10-05", "moneda": "USD"},
    )

    assert respuesta.status_code == status.HTTP_201_CREATED
    assert Cobro.objects.filter(suscripcion=suscripcion).count() == 3

    hallazgo = HallazgoCobro.objects.get(
        suscripcion=suscripcion,
        tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
    )
    assert hallazgo.porcentaje_variacion == Decimal("9999900.00")

    listado = cliente.get(
        f"/api/suscripciones/{suscripcion.id}/cobros/",
        headers=headers(org),
    )
    assert listado.status_code == status.HTTP_200_OK
    assert listado.data["count"] == 3


def test_si_falla_la_deteccion_el_cobro_no_queda_guardado(monkeypatch) -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org)
    cliente = APIClient()
    cliente.raise_request_exception = False

    def deteccion_que_falla(cobro):
        raise RuntimeError("fallo simulado en la detección")

    monkeypatch.setattr(
        "app.anomalias.detectar_anomalias_cobro",
        deteccion_que_falla,
    )

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "10000.00", "fecha": "2026-10-05"},
    )

    assert respuesta.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert not Cobro.objects.filter(suscripcion=suscripcion).exists()
    assert not HallazgoCobro.objects.filter(suscripcion=suscripcion).exists()


# ── 2. P2: moneda inválida es 400, no 500 ────────────────────────────


def test_moneda_desconocida_es_400_y_no_deja_cobros_ni_hallazgos() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org)
    cliente = APIClient()

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "10.00", "fecha": "2026-10-05", "moneda": "XXX"},
    )

    assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
    assert "moneda" in respuesta.data
    assert not Cobro.objects.filter(suscripcion=suscripcion).exists()
    assert not HallazgoCobro.objects.filter(suscripcion=suscripcion).exists()


def test_moneda_inactiva_es_400_y_no_persiste() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org, moneda="USD")
    cliente = APIClient()
    call_command(
        "gestionar_catalogo",
        "monedas",
        "USD",
        desactivar=True,
        stdout=StringIO(),
    )

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "10.00", "fecha": "2026-10-05", "moneda": "USD"},
    )

    assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
    assert "moneda" in respuesta.data
    assert not Cobro.objects.filter(suscripcion=suscripcion).exists()


def test_moneda_valida_se_acepta() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org)
    cliente = APIClient()

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "10.00", "fecha": "2026-10-05", "moneda": "USD"},
    )

    assert respuesta.status_code == status.HTTP_201_CREATED
    assert respuesta.data["moneda"] == "USD"


def test_moneda_omitida_hereda_la_de_la_suscripcion() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org, moneda="USD")
    cliente = APIClient()

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "10.00", "fecha": "2026-10-05"},
    )

    assert respuesta.status_code == status.HTTP_201_CREATED
    assert respuesta.data["moneda"] == "USD"


def test_moneda_heredada_inactiva_es_400() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org, moneda="CLP")
    cliente = APIClient()
    call_command(
        "gestionar_catalogo",
        "monedas",
        "CLP",
        desactivar=True,
        stdout=StringIO(),
    )

    respuesta = post_cobro(
        cliente,
        suscripcion,
        {"monto": "10.00", "fecha": "2026-10-05"},
    )

    assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
    assert "moneda" in respuesta.data
    assert not Cobro.objects.filter(suscripcion=suscripcion).exists()


# ── 3. P2: el umbral se evalúa sin redondeos intermedios ─────────────


def test_promedio_fraccionario_no_oculta_un_alza_mayor_al_cinco_por_ciento() -> None:
    org = uuid.uuid4()
    suscripcion = crear_suscripcion(org, monto="9.99", moneda="USD")
    crear_cobro(suscripcion, date(2026, 8, 5), "9.99", moneda="USD")
    crear_cobro(suscripcion, date(2026, 9, 5), "10.00", moneda="USD")

    nuevo = crear_cobro(
        suscripcion,
        date(2026, 10, 5),
        "10.50",
        moneda="USD",
    )

    hallazgo = HallazgoCobro.objects.get(
        suscripcion=suscripcion,
        tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
    )
    assert hallazgo.cobro_id == nuevo.id
    assert hallazgo.monto_referencia == Decimal("10.00")
    assert hallazgo.porcentaje_variacion == Decimal("5.05")
    # El umbral real es 9,995 * 1,05: no se redondea para decidir.
    assert hallazgo.detalle["umbral"] == "10.49475"


def test_limite_estricto_del_cinco_por_ciento_se_conserva() -> None:
    org_sin_alza = uuid.uuid4()
    sin_alza = crear_suscripcion(org_sin_alza)
    crear_cobro(sin_alza, date(2026, 8, 5), "10000.00")
    crear_cobro(sin_alza, date(2026, 9, 5), "10000.00")
    crear_cobro(sin_alza, date(2026, 10, 5), "10500.00")

    assert not HallazgoCobro.objects.filter(
        suscripcion=sin_alza,
        tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
    ).exists()

    org_con_alza = uuid.uuid4()
    con_alza = crear_suscripcion(org_con_alza)
    crear_cobro(con_alza, date(2026, 8, 5), "10000.00")
    crear_cobro(con_alza, date(2026, 9, 5), "10000.00")
    nuevo = crear_cobro(con_alza, date(2026, 10, 5), "10600.00")

    hallazgo = HallazgoCobro.objects.get(
        suscripcion=con_alza,
        tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
    )
    assert hallazgo.cobro_id == nuevo.id


# ── 4. P2: monedas válidas del catálogo en la sanitización ───────────


class ProveedorEspia:
    """Proveedor simulado: guarda exactamente lo que recibiría el externo."""

    def __init__(self) -> None:
        self.payloads: list[dict] = []

    def generar(self, payload: dict) -> dict:
        self.payloads.append(payload)
        return {"texto": "explicación"}


def test_sanitizacion_conserva_una_moneda_valida_del_catalogo() -> None:
    Moneda.objects.create(codigo="EUR", nombre="Euro", activo=True)
    proveedor = ProveedorEspia()

    resultado = enviar_contexto_ia(
        {"monto": Decimal("10.00"), "moneda": "EUR"},
        proveedor,
    )

    assert resultado.estado == "ok"
    assert proveedor.payloads[0]["datos"] == {
        "monto": "10.00",
        "moneda": "EUR",
    }


def test_sanitizacion_descarta_una_moneda_desconocida_sin_sustituirla() -> None:
    proveedor = ProveedorEspia()

    enviar_contexto_ia(
        {"monto": Decimal("10.00"), "moneda": "XXX"},
        proveedor,
    )

    # No se inventa CLP ni se acepta el código desconocido.
    assert proveedor.payloads[0]["datos"] == {"monto": "10.00"}


def test_sanitizacion_descarta_una_moneda_inactiva() -> None:
    Moneda.objects.create(codigo="EUR", nombre="Euro", activo=False)
    proveedor = ProveedorEspia()

    enviar_contexto_ia(
        {"monto": Decimal("10.00"), "moneda": "EUR"},
        proveedor,
    )

    assert proveedor.payloads[0]["datos"] == {"monto": "10.00"}
