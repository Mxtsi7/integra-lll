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

# Los cobros existentes se cargaron a mano; cuando exista ingesta CSV/PDF/
# correo, el origen real podrá venir de un campo del cobro. Mientras tanto
# "manual" es la respuesta verdadera, no un valor inventado.
ORIGEN_POR_DEFECTO = "manual"
ORIGENES_SOPORTADOS = frozenset({ORIGEN_POR_DEFECTO})


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
    """Valida ``origen`` contra los orígenes realmente soportados.

    ``Cobro`` todavía no guarda procedencia: todos los cobros de este alcance
    son manuales. Se acepta ``manual`` y se rechazan explícitamente los
    orígenes que aún no existen (``csv``, ``correo``) en lugar de etiquetar
    filas con una procedencia que no se puede demostrar.
    """
    if valor is None or str(valor).strip() == "":
        return None
    normalizado = str(valor).strip().lower()
    if normalizado not in ORIGENES_SOPORTADOS:
        raise ValidationError(
            {
                "origen": (
                    "Origen no soportado. Los cobros actuales son 'manual'; "
                    "csv/correo todavía no tienen procedencia registrada."
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
    :func:`normalizar_moneda` / :func:`normalizar_origen`. El origen ``manual``
    no necesita filtro en la consulta porque es el único soportado hoy; se
    mantiene explícito para que el contrato no cambie cuando exista un campo
    de procedencia real.
    """
    cobros = Cobro.objects.filter(
        organizacion_id=organizacion_id,
        suscripcion__organizacion_id=organizacion_id,
        fecha__gte=desde,
        fecha__lte=hasta,
    )
    if moneda:
        cobros = cobros.filter(moneda=moneda)
    if origen:
        # ``origen`` ya está restringido a ``manual``; se deja el punto de
        # extensión preparado para cuando el modelo registre procedencia.
        assert origen == ORIGEN_POR_DEFECTO
    cobros = cobros.select_related("suscripcion").order_by("fecha", "id")

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
