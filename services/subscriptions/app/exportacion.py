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
* Los filtros opcionales de ``moneda`` y ``origen`` se validan contra los
  catálogos/valores soportados antes de consultar. La moneda se compara con
  el valor exacto del cobro; no se convierte entre divisas.
"""

from __future__ import annotations

import csv
from datetime import date
from io import StringIO
import uuid

from django.core.exceptions import ValidationError

from app.models import Cobro, Moneda


COLUMNAS = (
    "servicio",
    "categoria",
    "monto",
    "moneda",
    "fecha",
    "origen",
    "estado",
)

# La procedencia de un cobro sale de sus `CandidatoAplicado` (RF-14): uno
# por fuente que lo trajo. Un cobro sin ninguno se ingresó a mano. Uno que
# llegó por las dos fuentes (el mismo cargo en el correo y en la cartola) es
# UNA fila con `correo+csv`, no dos: el cobro es uno solo.
ORIGEN_POR_DEFECTO = "manual"
ORIGENES_SOPORTADOS = frozenset({ORIGEN_POR_DEFECTO, "csv", "correo"})
SEPARADOR_DE_ORIGENES = "+"


def normalizar_moneda(valor: object) -> str | None:
    """Valida ``moneda`` contra el catálogo activo y la devuelve en mayúsculas.

    Un valor vacío significa "sin filtro". Un código válido pero inactivo, o
    uno que no existe, es un 400: no se inventa una moneda ni se devuelve
    silenciosamente el catálogo completo.
    """
    if valor is None or str(valor).strip() == "":
        return None
    codigo = str(valor).strip().upper()
    if not Moneda.objects.filter(codigo=codigo, activo=True).exists():
        raise ValidationError(
            {"moneda": "Debe ser un código del catálogo activo de monedas."}
        )
    return codigo


def normalizar_origen(valor: object) -> str | None:
    """Valida ``origen`` contra los orígenes que el sistema registra.

    ``manual`` (sin orden de cobro detrás), ``csv`` o ``correo`` (lo trajo
    esa fuente, sola o junto con la otra). Cualquier otro valor es un 400.
    """
    if valor is None or str(valor).strip() == "":
        return None
    normalizado = str(valor).strip().lower()
    if normalizado not in ORIGENES_SOPORTADOS:
        raise ValidationError(
            {
                "origen": (
                    "Origen no soportado. Usa 'manual', 'csv' o 'correo'."
                )
            }
        )
    return normalizado


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


def origen_del_cobro(cobro: Cobro) -> str:
    """`manual`, `csv`, `correo` o `correo+csv`. Usa los orígenes precargados."""
    fuentes = sorted({fila.origen for fila in cobro.origenes.all()})
    return SEPARADOR_DE_ORIGENES.join(fuentes) if fuentes else ORIGEN_POR_DEFECTO


def construir_csv_cobros(
    organizacion_id: uuid.UUID,
    desde: date,
    hasta: date,
    *,
    moneda: str | None = None,
    origen: str | None = None,
) -> str:
    """Construye el CSV completo (encabezados + filas) para el rango inclusivo.

    ``moneda`` y ``origen`` ya llegan normalizados por
    :func:`normalizar_moneda` / :func:`normalizar_origen`. ``manual`` son los
    cobros sin orden de cobro; ``csv`` y ``correo``, los que trajo esa fuente
    (también si la otra trajo el mismo cargo). Un cobro con dos fuentes sale
    una sola vez.
    """
    cobros = Cobro.objects.filter(
        organizacion_id=organizacion_id,
        suscripcion__organizacion_id=organizacion_id,
        fecha__gte=desde,
        fecha__lte=hasta,
    )
    if moneda:
        cobros = cobros.filter(moneda=moneda)
    if origen == ORIGEN_POR_DEFECTO:
        cobros = cobros.filter(origenes__isnull=True)
    elif origen:
        # Filtrar por una relación de muchos repite el cobro por cada fila que
        # calce: con `distinct` sale una vez aunque tenga dos órdenes.
        cobros = cobros.filter(origenes__origen=origen).distinct()
    cobros = (
        cobros.select_related("suscripcion")
        .prefetch_related("origenes")
        .order_by("fecha", "id")
    )

    salida = StringIO(newline="")
    escritor = csv.writer(salida)
    escritor.writerow(COLUMNAS)

    # Por tandas, como antes, y con los orígenes de cada tanda precargados.
    for cobro in cobros.iterator(chunk_size=500):
        escritor.writerow(
            (
                escapar_formula_csv(cobro.suscripcion.nombre),
                escapar_formula_csv(_categoria_suscripcion(cobro)),
                # El monto es numérico: se escribe sin prefijo para que la
                # hoja lo trate como número y no como texto/fórmula.
                f"{cobro.monto:.2f}",
                escapar_formula_csv(cobro.moneda),
                cobro.fecha.isoformat(),
                escapar_formula_csv(origen_del_cobro(cobro)),
                escapar_formula_csv(_estado_suscripcion(cobro)),
            )
        )

    return salida.getvalue()
