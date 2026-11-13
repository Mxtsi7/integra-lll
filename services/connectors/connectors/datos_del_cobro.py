"""S3-FE-07 — sacar y validar el importe, la moneda y la fecha de un correo.

Toma el texto de un `MensajeCorreo` (S3-FE-02/04) y devuelve lo que se pudo
leer **y cuánto se confía en cada cosa**. No guarda nada.

── Lo ambiguo se señala, no se adivina ─────────────────────────────────────
Es la misma regla que el lector de CSV (S3-FE-12). Cada campo sale con un
estado:

    confirmado   se leyó sin dudas
    ambiguo      hay más de una lectura posible; no se elige
    supuesto     no venía y se usó un respaldo (la fecha de recepción)
    ausente      no venía y no hay respaldo

Todo lo que no es `confirmado` queda en `para_revision`, con su motivo. Los
casos que obligaron a esto:

- **`$` solo.** En un correo chileno son pesos; en uno de un servicio de
  Estados Unidos, dólares. El texto no lo dice: la moneda queda ambigua.
- **Dos totales distintos.** «Total: $9.990» y «Total: $10.990» en el mismo
  correo (un cambio de plan, un prorrateo). No se elige uno.
- **`01/10/2026`.** Puede ser 1 de octubre o 10 de enero. Solo se confirma si
  el día pasa de 12 o si el formato no deja dudas (`2026-10-01`, «1 de
  octubre de 2026», «October 1, 2026»).
- **Sin fecha en el texto.** Se usa el día en que llegó el correo, pero como
  `supuesto`: un recibo puede llegar días después del cobro.

── La precisión ────────────────────────────────────────────────────────────
Los importes son `Decimal`, nunca `float`: `9.990` es 9990 y `12,50` es 12.50
exactos. Las reglas de separadores son las del CSV:

- el último separador seguido de **1 o 2** dígitos es el decimal;
- seguido de **3**, es de miles (ninguna moneda de la tabla usa 3 decimales);
- los demás son de miles y tienen que agrupar de a 3, y no pueden ser el mismo
  signo que el decimal: `1.234,56` y `1,234.56` sí; `1.2.3` no.

Una moneda sin centavos (CLP) con centavos distintos de cero no se acepta
como confirmada.

Las tablas de monedas son las mismas de `csv_candidatos` (#147). Cuando esa
PR entre a `main`, se dejan en un solo lugar.
"""

from __future__ import annotations

import dataclasses
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from .lectura_correo import MensajeCorreo

CONFIRMADO = "confirmado"
AMBIGUO = "ambiguo"
SUPUESTO = "supuesto"
AUSENTE = "ausente"

DECIMALES_POR_MONEDA = {
    "CLP": 0, "ARS": 2, "BRL": 2, "COP": 2, "EUR": 2, "GBP": 2, "MXN": 2, "PEN": 2, "USD": 2, "UYU": 2,
}

#: Lo que SÍ identifica una moneda. `$` no está a propósito.
SIMBOLOS = {
    "US$": "USD", "U$S": "USD", "USD": "USD", "€": "EUR", "EUR": "EUR", "£": "GBP", "GBP": "GBP",
    "CLP": "CLP", "$CL": "CLP", "R$": "BRL", "BRL": "BRL", "S/": "PEN", "PEN": "PEN", "MXN": "MXN",
    "ARS": "ARS", "COP": "COP", "UYU": "UYU",
}
SIMBOLO_AMBIGUO = "$"

IMPORTE_MAXIMO = Decimal("999999999999.99")

#: Las palabras que dicen "este es el monto que se cobró", fuertes primero.
ETIQUETAS_FUERTES = (
    "total pagado", "total cobrado", "monto total", "importe total", "total a pagar", "total charged",
    "amount paid", "amount charged", "total", "grand total",
)
ETIQUETAS_DEBILES = (
    "monto", "importe", "cobro", "cargo", "precio", "valor", "pagaste", "amount", "price", "charged", "paid",
)
#: Las que dicen "esto NO es el total": un subtotal, un impuesto, un descuento.
#: Van primero en la comparación porque «subtotal» contiene «total».
ETIQUETAS_QUE_NO_SON_EL_TOTAL = (
    "subtotal", "sub-total", "sub total", "iva", "impuesto", "impuestos", "tax", "taxes", "vat",
    "descuento", "discount", "saldo", "balance", "propina", "tip",
)

_TOKENS = sorted({*SIMBOLOS, SIMBOLO_AMBIGUO}, key=len, reverse=True)
_TOKEN = "|".join(re.escape(t) for t in _TOKENS)
#: Un número con separadores: dígitos y grupos separados por `.`, `,` o un
#: espacio duro o fino (algunos correos agrupan miles así). El espacio común
#: NO: «$10 100 productos» no es diez mil cien.
_NUMERO = r"\d{1,3}(?:[.,\u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?"
_MONTO = re.compile(
    # Un código pegado a otra palabra no es una moneda: «XCLP 9.990» no.
    rf"(?<![A-Za-z])(?P<antes>{_TOKEN})\s?(?P<numero_a>{_NUMERO})(?![\d.,]*\d)"
    rf"|(?<![\w.,])(?P<numero_d>{_NUMERO})\s?(?P<despues>{_TOKEN})(?!\w)"
)

#: Un código de moneda pegado (o a un espacio) después de un monto con `$`.
_CODIGO_DESPUES = re.compile(r"\s?(" + "|".join(c for c in SIMBOLOS if c.isalpha()) + r")(?![A-Za-z])")

_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "sept": 9, "oct": 10,
    "nov": 11, "dic": 12, "jan": 1, "apr": 4, "aug": 8, "dec": 12,
}
_MES = "|".join(sorted(_MESES, key=len, reverse=True))
_FECHA_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")
_FECHA_NUMERICA = re.compile(r"(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(?![\d/.-])")
_FECHA_ES = re.compile(rf"(?<!\d)(\d{{1,2}})\s+de\s+({_MES})\.?(?:\s+de)?\s+(\d{{4}})(?!\d)", re.IGNORECASE)
_FECHA_EN_MDY = re.compile(rf"(?<![\w])({_MES})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})(?!\d)", re.IGNORECASE)
_FECHA_EN_DMY = re.compile(rf"(?<!\d)(\d{{1,2}})\s+({_MES})\.?,?\s+(\d{{4}})(?!\d)", re.IGNORECASE)
_ETIQUETAS_DE_FECHA = re.compile(
    r"\b(?:fecha(?:\s+de\s+(?:cobro|pago|cargo|compra|facturaci[oó]n|transacci[oó]n))?|billing date|charge date|"
    r"date of (?:charge|payment|purchase)|payment date|order date|charged on|paid on|date)\b",
    re.IGNORECASE,
)


@dataclasses.dataclass(frozen=True)
class Campo:
    valor: object
    estado: str
    motivo: str = ""
    #: El pedazo de texto del que salió, para la evidencia (S3-FE-09).
    fragmento: str = ""

    @property
    def confirmado(self) -> bool:
        return self.estado == CONFIRMADO


@dataclasses.dataclass(frozen=True)
class DatosDelCobro:
    importe: Campo
    moneda: Campo
    fecha: Campo

    @property
    def para_revision(self) -> tuple[tuple[str, str], ...]:
        """(campo, motivo) de lo que no está confirmado."""
        return tuple(
            (nombre, campo.motivo)
            for nombre, campo in (("importe", self.importe), ("moneda", self.moneda), ("fecha", self.fecha))
            if not campo.confirmado
        )


# ── el importe y la moneda ─────────────────────────────────────────────────


def leer_numero(texto: str) -> tuple[Decimal, int] | None:
    """`9.990` → (9990, 0), `1.234,56` → (1234.56, 2). `None` si no es un
    número bien agrupado. El segundo valor es cuántos decimales traía."""
    limpio = re.sub(r"[\u00a0\u202f]", ".", texto.strip())
    separadores = [(i, c) for i, c in enumerate(limpio) if c in ".,"]
    entero, decimales = limpio, ""
    if separadores:
        posicion, signo = separadores[-1]
        cola = limpio[posicion + 1:]
        if len(cola) in (1, 2):
            entero, decimales = limpio[:posicion], cola
            if any(c == signo for _, c in separadores[:-1]):
                return None  # `1.234.56`: el decimal no puede repetirse como miles
    grupos = re.split(r"[.,]", entero)
    if len(grupos) > 1:
        if len({c for c in entero if c in ".,"}) > 1:
            return None  # miles con dos signos distintos
        if not (1 <= len(grupos[0]) <= 3) or any(len(g) != 3 for g in grupos[1:]):
            return None
    try:
        valor = Decimal("".join(grupos) + ("." + decimales if decimales else ""))
    except InvalidOperation:
        return None
    return valor, len(decimales)


def _etiqueta(linea: str, inicio: int) -> int:
    """Cuánto dice lo que hay antes del monto, en su línea, que ese es el
    monto cobrado: 2 una etiqueta fuerte («Total»), 1 una débil («Monto»), 0
    ninguna y -1 una que dice que NO lo es («Subtotal», «IVA»).

    Cuenta la etiqueta MÁS CERCANA al monto, comparada como palabra, así que
    en «Subtotal» no hay un «Total». En «Total con descuento» la más cercana
    es «descuento»: si ese es el único monto, queda para revisión.
    """
    antes = linea[:inicio].lower()[-60:]
    mejor_posicion, fuerza = -1, 0
    for etiquetas, valor in ((ETIQUETAS_QUE_NO_SON_EL_TOTAL, -1), (ETIQUETAS_FUERTES, 2), (ETIQUETAS_DEBILES, 1)):
        for etiqueta in etiquetas:
            for encontrada in re.finditer(rf"(?<![a-z]){re.escape(etiqueta)}(?![a-z])", antes):
                # Si dos terminan en el mismo lugar («total» dentro de
                # «monto total»), gana la que se miró primero.
                if encontrada.end() > mejor_posicion:
                    mejor_posicion, fuerza = encontrada.end(), valor
    return fuerza


@dataclasses.dataclass(frozen=True)
class _Monto:
    valor: Decimal
    decimales: int
    token: str
    fuerza: int
    fragmento: str


def _montos(texto: str) -> list[_Monto]:
    encontrados = []
    for linea in texto.splitlines():
        for m in _MONTO.finditer(linea):
            numero = m.group("numero_a") or m.group("numero_d")
            token = m.group("antes") or m.group("despues")
            if token == SIMBOLO_AMBIGUO:
                # «$9.990 CLP»: el código que viene después dice cuál `$` es.
                despues = _CODIGO_DESPUES.match(linea, m.end())
                if despues:
                    token = despues.group(1)
            leido = leer_numero(numero)
            if leido is None:
                continue
            valor, decimales = leido
            if valor <= 0 or valor > IMPORTE_MAXIMO:
                continue
            encontrados.append(_Monto(valor, decimales, token, _etiqueta(linea, m.start()), linea.strip()[:200]))
    return encontrados


def _importe_y_moneda(texto: str) -> tuple[Campo, Campo]:
    montos = _montos(texto)
    if not montos:
        return (Campo(None, AUSENTE, "no se encontró un monto con su moneda"),
                Campo(None, AUSENTE, "no se encontró un monto con su moneda"))
    fuerza = max(m.fuerza for m in montos)
    elegidos = [m for m in montos if m.fuerza == fuerza]
    valores = {m.valor for m in elegidos}
    fragmento = elegidos[0].fragmento
    if fuerza < 0:
        # Solo hay subtotales, impuestos o descuentos: ninguno es lo cobrado.
        return (Campo(None, AMBIGUO, "los montos del correo son subtotales, impuestos o descuentos, no un total",
                      fragmento), _moneda(elegidos, fragmento))
    if len(valores) > 1:
        lista = ", ".join(str(v) for v in sorted(valores))
        motivo = f"hay {len(valores)} montos posibles ({lista}) y ninguno se distingue"
        return Campo(None, AMBIGUO, motivo, fragmento), _moneda(elegidos, fragmento)
    moneda = _moneda(elegidos, fragmento)
    monto = elegidos[0]
    if moneda.confirmado and monto.decimales > DECIMALES_POR_MONEDA[moneda.valor]:
        return (Campo(monto.valor, AMBIGUO, f"{moneda.valor} no lleva {monto.decimales} decimales", fragmento),
                moneda)
    return Campo(monto.valor, CONFIRMADO, "", fragmento), moneda


def _moneda(montos: list[_Monto], fragmento: str) -> Campo:
    tokens = {m.token for m in montos}
    codigos = {SIMBOLOS.get(t) for t in tokens}
    if codigos == {None}:
        return Campo(None, AMBIGUO, "el monto viene con `$` solo: pueden ser pesos o dólares", fragmento)
    codigos.discard(None)
    if len(codigos) > 1:
        return Campo(None, AMBIGUO, "el correo trae montos en más de una moneda: " + ", ".join(sorted(codigos)),
                     fragmento)
    return Campo(codigos.pop(), CONFIRMADO, "", fragmento)


# ── la fecha ───────────────────────────────────────────────────────────────


def _fecha_valida(anio: int, mes: int, dia: int) -> date | None:
    try:
        return date(anio, mes, dia)
    except ValueError:
        return None


def _fechas_de(linea: str) -> list[tuple[set[date], str]]:
    """Cada fecha de la línea como el CONJUNTO de lecturas posibles."""
    lecturas: list[tuple[set[date], str]] = []
    for m in _FECHA_ISO.finditer(linea):
        f = _fecha_valida(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if f:
            lecturas.append(({f}, m.group(0)))
    for m in _FECHA_ES.finditer(linea):
        f = _fecha_valida(int(m.group(3)), _MESES[m.group(2).lower()], int(m.group(1)))
        if f:
            lecturas.append(({f}, m.group(0)))
    for m in _FECHA_EN_MDY.finditer(linea):
        f = _fecha_valida(int(m.group(3)), _MESES[m.group(1).lower()], int(m.group(2)))
        if f:
            lecturas.append(({f}, m.group(0)))
    for m in _FECHA_EN_DMY.finditer(linea):
        f = _fecha_valida(int(m.group(3)), _MESES[m.group(2).lower()], int(m.group(1)))
        if f:
            lecturas.append(({f}, m.group(0)))
    for m in _FECHA_NUMERICA.finditer(linea):
        a, b, anio = int(m.group(1)), int(m.group(3)), int(m.group(4))
        posibles = {f for f in (_fecha_valida(anio, b, a), _fecha_valida(anio, a, b)) if f}
        if posibles:
            lecturas.append((posibles, m.group(0)))
    return lecturas


def _fecha(texto: str, recibido: date) -> Campo:
    etiquetadas, sueltas = [], []
    for linea in texto.splitlines():
        for posibles, crudo in _fechas_de(linea):
            (etiquetadas if _ETIQUETAS_DE_FECHA.search(linea) else sueltas).append((posibles, crudo, linea.strip()[:200]))
    candidatas = etiquetadas or sueltas
    if not candidatas:
        return Campo(recibido, SUPUESTO, "el correo no dice la fecha del cobro: se usó el día en que llegó")
    todas = set().union(*(p for p, _, _ in candidatas))
    _, crudo, fragmento = candidatas[0]
    if len(todas) == 1:
        return Campo(todas.pop(), CONFIRMADO, "", fragmento)
    lista = ", ".join(f.isoformat() for f in sorted(todas))
    if len(candidatas) == 1:
        motivo = f"{crudo!r} se puede leer como {lista}"
    else:
        motivo = f"el correo trae más de una fecha ({lista})"
    return Campo(None, AMBIGUO, motivo, fragmento)


# ── todo junto ─────────────────────────────────────────────────────────────


def datos_de(mensaje: MensajeCorreo) -> DatosDelCobro:
    """Importe, moneda y fecha del cobro que describe el correo."""
    texto = "\n".join(t for t in (mensaje.asunto, mensaje.texto) if t)
    importe, moneda = _importe_y_moneda(texto)
    return DatosDelCobro(importe=importe, moneda=moneda, fecha=_fecha(texto, mensaje.recibido_en.date()))
