"""Exportación CSV de cobros por periodo (VI-25 / RF-15).

El CSV es una fila por cobro, enriquecida con los datos de la suscripción a
la que pertenece. No está limitado por la paginación de la API: una
exportación de marzo a agosto devuelve todos los cobros del rango, no solo
la primera página.

Reglas de seguridad:

* El filtro por ``organizacion_id`` se aplica siempre, tanto al cobro como a
  su suscripción (defensa en profundidad).
* Las celdas de texto se protegen contra inyección de fórmulas de hoja de
  cálculo: si empiezan con ``=``, ``+``, ``-``, ``@``, tabulación o retorno
  de carro se antepone un apóstrofo. Los montos numéricos no se tocan.
* No se incluyen tokens, correos ni identificadores de otras cuentas.
"""

from __future__ import annotations

import csv
from datetime import date
from io import StringIO
import uuid

from app.models import Cobro


COLUMNAS = (
    "servicio",
    "categoria",
    "monto",
    "moneda",
    "fecha",
    "origen",
    "estado",
)

# Los cobros existentes se cargaron a mano; cuando exista ingesta CSV/PDF/
# correo, el origen real podrá venir de un campo del cobro. Mientras tanto
# "manual" es la respuesta verdadera, no un valor inventado.
ORIGEN_POR_DEFECTO = "manual"


def escapar_formula_csv(valor: object) -> str:
    """Neutraliza una celda que Excel/Sheets podría interpretar como fórmula.

    Se revisa el primer carácter no blanco para cubrir el caso en que la
    celda venga precedida de espacios o tabulaciones. El apóstrofo es el
    mecanismo estándar de OWASP y hace que la hoja muestre el texto literal.
    """
    texto = "" if valor is None else str(valor)
    if not texto:
        return texto

    inicial = texto.lstrip(" \t\r\n")
    if inicial[:1] in {"=", "+", "-", "@", "\t", "\r"}:
        return "'" + texto
    return texto


def _estado_suscripcion(cobro: Cobro) -> str:
    return getattr(cobro.suscripcion, "estado", "") or ""


def _categoria_suscripcion(cobro: Cobro) -> str:
    return getattr(cobro.suscripcion, "categoria", "") or ""


def construir_csv_cobros(
    organizacion_id: uuid.UUID,
    desde: date,
    hasta: date,
) -> str:
    """Construye el CSV completo (encabezados + filas) para el rango inclusivo."""
    cobros = (
        Cobro.objects.filter(
            organizacion_id=organizacion_id,
            suscripcion__organizacion_id=organizacion_id,
            fecha__gte=desde,
            fecha__lte=hasta,
        )
        .select_related("suscripcion")
        .order_by("fecha", "id")
    )

    salida = StringIO(newline="")
    escritor = csv.writer(salida)
    escritor.writerow(COLUMNAS)

    for cobro in cobros.iterator():
        escritor.writerow(
            (
                escapar_formula_csv(cobro.suscripcion.nombre),
                escapar_formula_csv(_categoria_suscripcion(cobro)),
                # El monto es numérico: se escribe sin prefijo para que la
                # hoja lo trate como número y no como texto/fórmula.
                f"{cobro.monto:.2f}",
                escapar_formula_csv(cobro.moneda),
                cobro.fecha.isoformat(),
                escapar_formula_csv(ORIGEN_POR_DEFECTO),
                escapar_formula_csv(_estado_suscripcion(cobro)),
            )
        )

    return salida.getvalue()
