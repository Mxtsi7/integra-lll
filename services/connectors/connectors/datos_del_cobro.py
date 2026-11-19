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
    # `signo_medio` es el menos entre el símbolo y el número: «$-9.990».
    rf"(?<![A-Za-z])(?P<antes>{_TOKEN})\s?(?P<signo_medio>[-\u2212]\s?)?(?P<numero_a>{_NUMERO})(?![\d.,]*\d)"
    rf"|(?<![\w.,])(?P<numero_d>{_NUMERO})\s?(?P<despues>{_TOKEN})(?!\w)"
)

#: Lo que, justo antes de un monto, dice que es negativo: «-9.990 CLP»,
#: «-$9.990», «CLP -9.990», o el paréntesis contable «(9.990)».
_MENOS = ("-", "\u2212")

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
#: Lo que dice que una fecha es la del PRÓXIMO ciclo, no la de este cobro.
#: Se mira antes que las etiquetas de fecha, porque «Next billing date»
#: también contiene «billing date». Lo encontró la revisión de #184.
_ETIQUETAS_DE_PROXIMO = re.compile(
    r"\b(?:pr[oó]xim[oa]s?\s+(?:cobro|pago|cargo|renovaci[oó]n|facturaci[oó]n|factura|vencimiento)|"
    r"se\s+renovar[aá]|renueva|vence|vencimiento|fecha\s+l[ií]mite|next\s+(?:billing|payment|charge|renewal)|"
    r"se\s+cobrar[aá]|cobraremos|vamos\s+a\s+cobrar|renews?|will\s+renew|will\s+be\s+charged|due\s+(?:date|on)|valid\s+until|expires?)\b",
    re.IGNORECASE,
)

_ETIQUETAS_DE_FECHA = re.compile(
    r"\b(?:fecha(?:\s+de\s+(?:cobro|pago|cargo|compra|facturaci[oó]n|transacci[oó]n))?|billing date|charge date|"
    r"date of (?:charge|payment|purchase)|payment date|order date|charged on|paid on|date)\b",
    re.IGNORECASE,
)


#: Lo que se guarda alrededor de un dato en su `fragmento`: lo justo para
#: ver de dónde salió («Total: CLP 9.990»), no la línea entera. Un correo
#: HTML de un solo párrafo es UNA línea, y ahí al lado del monto pueden venir
#: el nombre, el RUT o la tarjeta de la persona. Antes se guardaban los
#: primeros 200 caracteres de la línea: a veces el cuerpo entero, y a veces
#: sin el monto. Lo encontró la revisión de S3-FE-09.
CONTEXTO_ANTES = 30
CONTEXTO_DESPUES = 20
#: Dónde termina una frase o un inciso: la ventana no lo cruza. El punto y
#: la coma, solo cuando les sigue un espacio, para no cortar dentro de
#: «9.990» ni de «1.234,50».
_FIN_DE_INCISO = re.compile(r"[.,;](?=\s)|[!?|•·…]|\s[-–—]\s")


def _ventana(linea: str, inicio: int, fin: int) -> str:
    """El dato `linea[inicio:fin]` con un poco de lo que lo rodea: hasta
    `CONTEXTO_ANTES` caracteres antes y `CONTEXTO_DESPUES` después, sin
    pasar de su frase o inciso y sin dejar una palabra cortada."""
    desde = max(0, inicio - CONTEXTO_ANTES)
    antes = linea[desde:inicio]
    if desde > 0 and not linea[desde - 1].isspace():
        antes = re.sub(r"^\S*", "", antes)
    cortes = list(_FIN_DE_INCISO.finditer(antes))
    if cortes:
        antes = antes[cortes[-1].end():]

    hasta = fin + CONTEXTO_DESPUES
    despues = linea[fin:hasta]
    if hasta < len(linea) and not linea[hasta].isspace():
        despues = re.sub(r"\S*$", "", despues)
    corte = _FIN_DE_INCISO.search(despues)
    if corte:
        despues = despues[:corte.start()]
    return (antes + linea[inicio:fin] + despues).strip()


@dataclasses.dataclass(frozen=True)
class Campo:
    valor: object
    estado: str
    motivo: str = ""
    #: El dato y lo que lo rodea en su línea (`_ventana`), para la evidencia
    #: (S3-FE-09). Nunca la línea entera.
    fragmento: str = ""

    @property
    def confirmado(self) -> bool:
        return self.estado == CONFIRMADO


@dataclasses.dataclass(frozen=True)
class DatosDelCobro:
    importe: Campo
    moneda: Campo
    fecha: Campo
    #: La fecha del PRÓXIMO cobro, si el correo la dice: sirve para un aviso
    #: (S3-FE-08). No es la del cobro y no entra en `para_revision`.
    fecha_proximo_cobro: Campo = Campo(None, AUSENTE)

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
    negativo: bool = False


def _es_negativo(linea: str, m, fin: int) -> bool:
    """¿El monto que calzó en `m` lleva un signo menos o va entre paréntesis?

    La expresión del monto empieza DESPUÉS del signo, así que hay que mirar
    alrededor. Antes no se miraba, y «Total: -9.990 CLP» salía como 9.990
    confirmado: un abono o una devolución se proponía como un gasto. Lo
    encontró la revisión de #184.

    `fin` es donde termina el monto ENTERO, que no siempre es donde termina
    `m`: en «($9.990 CLP)» el código que va después del número es parte del
    monto, y el paréntesis de cierre viene después del código. Mirando desde
    el final de `m` se veía «CLP)» y el abono salía positivo. Lo encontró la
    segunda revisión de #184.
    """
    if m.group("signo_medio"):
        return True
    antes = linea[:m.start()].rstrip()
    despues = linea[fin:].lstrip()
    if antes.endswith(_MENOS):
        return True
    return antes.endswith("(") and despues.startswith(")")


def _montos(texto: str) -> list[_Monto]:
    encontrados = []
    for linea in texto.splitlines():
        for m in _MONTO.finditer(linea):
            numero = m.group("numero_a") or m.group("numero_d")
            token = m.group("antes") or m.group("despues")
            fin = m.end()
            if token == SIMBOLO_AMBIGUO:
                # «$9.990 CLP»: el código que viene después dice cuál `$` es,
                # y es parte del monto: el monto termina después del código.
                despues = _CODIGO_DESPUES.match(linea, m.end())
                if despues:
                    token = despues.group(1)
                    fin = despues.end()
            leido = leer_numero(numero)
            if leido is None:
                continue
            valor, decimales = leido
            if valor <= 0 or valor > IMPORTE_MAXIMO:
                continue
            encontrados.append(_Monto(valor, decimales, token, _etiqueta(linea, m.start()),
                                      _ventana(linea, m.start(), fin), negativo=_es_negativo(linea, m, fin)))
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
    if any(m.negativo for m in elegidos):
        # Un cobro es positivo. Un total negativo es un abono, una devolución
        # o un saldo a favor: no se propone como gasto sin que alguien lo mire.
        return (Campo(-monto.valor, AMBIGUO, "el monto es negativo: puede ser una devolución o un abono, no un cobro",
                      fragmento), moneda)
    if moneda.confirmado and monto.decimales > DECIMALES_POR_MONEDA[moneda.valor]:
        return (Campo(monto.valor, AMBIGUO, f"{moneda.valor} no lleva {monto.decimales} decimales", fragmento),
                moneda)
    return Campo(monto.valor, CONFIRMADO, "", fragmento), moneda


def _moneda(montos: list[_Monto], fragmento: str) -> Campo:
    tokens = {m.token for m in montos}
    codigos = {SIMBOLOS.get(t) for t in tokens}
    if codigos == {None}:
        return Campo(None, AMBIGUO, "el monto viene con `$` solo: pueden ser pesos o dólares", fragmento)
    if None in codigos:
        # «Total: USD 10» y, en otra línea, «Total: $10». Nada dice que ese
        # `$` sea USD: antes se descartaba y la moneda salía confirmada. El
        # `$` se ata a un código solo en el MISMO monto («$10 USD»). Lo
        # encontró la revisión de #184.
        conocidos = ", ".join(sorted(c for c in codigos if c))
        return Campo(None, AMBIGUO, f"un monto viene en {conocidos} y otro con `$` solo, que no dice cuál es",
                     fragmento)
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


def _fechas_de(linea: str) -> list[tuple[set[date], re.Match]]:
    """Cada fecha de la línea como el CONJUNTO de lecturas posibles, con
    dónde calzó (para el texto crudo y la ventana de la evidencia)."""
    lecturas: list[tuple[set[date], re.Match]] = []
    for m in _FECHA_ISO.finditer(linea):
        f = _fecha_valida(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if f:
            lecturas.append(({f}, m))
    for m in _FECHA_ES.finditer(linea):
        f = _fecha_valida(int(m.group(3)), _MESES[m.group(2).lower()], int(m.group(1)))
        if f:
            lecturas.append(({f}, m))
    for m in _FECHA_EN_MDY.finditer(linea):
        f = _fecha_valida(int(m.group(3)), _MESES[m.group(1).lower()], int(m.group(2)))
        if f:
            lecturas.append(({f}, m))
    for m in _FECHA_EN_DMY.finditer(linea):
        f = _fecha_valida(int(m.group(3)), _MESES[m.group(2).lower()], int(m.group(1)))
        if f:
            lecturas.append(({f}, m))
    for m in _FECHA_NUMERICA.finditer(linea):
        a, b, anio = int(m.group(1)), int(m.group(3)), int(m.group(4))
        posibles = {f for f in (_fecha_valida(anio, b, a), _fecha_valida(anio, a, b)) if f}
        if posibles:
            lecturas.append((posibles, m))
    return lecturas


def _elegir(candidatas, recibido: date | None, ausente: str) -> Campo:
    """Una fecha de entre las candidatas: confirmada si todas dicen lo mismo,
    ambigua si no, y el respaldo (o ausente) si no hay ninguna."""
    if not candidatas:
        if recibido is None:
            return Campo(None, AUSENTE, ausente)
        return Campo(recibido, SUPUESTO, ausente)
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


def _fechas(texto: str, recibido: date) -> tuple[Campo, Campo]:
    """(fecha del cobro, fecha del próximo cobro).

    Una fecha cuya línea dice que es del próximo ciclo («Next billing date»,
    «Tu próximo cobro será el…», «Renews on») NUNCA es la del cobro. Si es lo
    único que trae el correo, la del cobro queda supuesta con la de recepción,
    y avisada.
    """
    etiquetadas, sueltas, proximas = [], [], []
    for linea in texto.splitlines():
        for posibles, m in _fechas_de(linea):
            fila = (posibles, m.group(0), _ventana(linea, m.start(), m.end()))
            if _ETIQUETAS_DE_PROXIMO.search(linea):
                proximas.append(fila)
            elif _ETIQUETAS_DE_FECHA.search(linea):
                etiquetadas.append(fila)
            else:
                sueltas.append(fila)
    proxima = _elegir(proximas, None, "el correo no dice la fecha del próximo cobro")
    sin_fecha = (
        "el correo solo trae la fecha del próximo cobro: se usó el día en que llegó"
        if proximas else "el correo no dice la fecha del cobro: se usó el día en que llegó"
    )
    return _elegir(etiquetadas or sueltas, recibido, sin_fecha), proxima


# ── todo junto ─────────────────────────────────────────────────────────────


def datos_de(mensaje: MensajeCorreo) -> DatosDelCobro:
    """Importe, moneda y fecha del cobro que describe el correo."""
    texto = "\n".join(t for t in (mensaje.asunto, mensaje.texto) if t)
    importe, moneda = _importe_y_moneda(texto)
    fecha, proxima = _fechas(texto, mensaje.recibido_en.date())
    return DatosDelCobro(importe=importe, moneda=moneda, fecha=fecha, fecha_proximo_cobro=proxima)
