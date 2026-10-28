"""Reglas de negocio compartidas por la persistencia y el listado de VI-17.

RN-REC-001 vive aquí, en el servicio que genera y lista recomendaciones. No
existe un valor por defecto: una moneda sin configuración activa no habilita
recomendaciones y el listado debe informarlo.
"""

import re
from decimal import Decimal

MONEDA_ISO_4217 = re.compile(r"^[A-Z]{3}$")


def normalizar_moneda(valor) -> str:
    """Devuelve el código ISO en mayúsculas o falla si no es válido."""
    if not isinstance(valor, str) or not valor.strip():
        raise ValueError("La moneda es obligatoria.")
    moneda = valor.strip().upper()
    if not MONEDA_ISO_4217.fullmatch(moneda):
        raise ValueError(
            "La moneda debe ser un código ISO de tres letras (por ejemplo CLP)."
        )
    return moneda


def umbrales_activos(monedas=None) -> dict[str, Decimal]:
    """Mapea cada moneda con umbral activo a su monto mínimo.

    ``monedas`` permite acotar la consulta a las monedas relevantes para el
    listado. Una moneda ausente del resultado significa "sin configuración".
    """
    from analytics.models import UmbralAhorro

    consulta = UmbralAhorro.objects.filter(activo=True, monto__gt=0)
    if monedas is not None:
        consulta = consulta.filter(moneda__in=list(monedas))
    return {
        moneda: monto
        for moneda, monto in consulta.values_list("moneda", "monto")
    }


def umbral_minimo(moneda):
    """RN-REC-001: umbral activo de la moneda, o ``None`` si no está configurado."""
    codigo = normalizar_moneda(moneda)
    return umbrales_activos({codigo}).get(codigo)
