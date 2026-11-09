"""Leer un CSV ya validado y sacar candidatos (S3-FE-11, S3-FE-12, S3-FE-13).

`archivos.py` (FE-07) ya decidió que esto es un CSV, que pesa lo que debe y
que tiene cabecera, filas y un separador. Acá se lee de verdad.

Son tres trabajos encadenados y se leen en ese orden:

    S3-FE-11   ¿están las columnas? ¿esta fila tiene la forma correcta?
    S3-FE-12   convertir «1.234,56», «$», «03/04/2026» a valores canónicos
    S3-FE-13   juntar los errores de fila SIN botar las filas buenas

── Una fila mala no arruina el archivo ─────────────────────────────────────
Es el criterio central de S3-FE-13, y es lo que separa esto de un parser
ingenuo: un CSV de 200 filas con 3 malas tiene que entregar **197 candidatos
y 3 rechazos trazables**, no una excepción. Lo contrario obliga a la persona
a corregir el archivo a ciegas, una fila por intento.

Lo único que detiene la lectura entera es que falte una columna obligatoria:
ahí no hay nada que leer y el error es del archivo, no de una fila. Eso lo
pide S3-FE-11 explícitamente («falta de columna se informa a nivel de
archivo»).

── Lo ambiguo se rechaza, no se adivina ────────────────────────────────────
`03/04/2026` es 3 de abril o 4 de marzo, y `$ 1.500` es mil quinientos pesos
o mil quinientos dólares. Las dos lecturas son defendibles y elegir en
silencio mete un error que nadie va a encontrar después: la suscripción queda
con una fecha de cobro corrida un mes, o con un monto 900 veces mayor.

Para la fecha se resuelve en tres pasos, el primero que sirva:

    1. lo que declare quien llama (`orden_fecha`)
    2. lo que el propio archivo demuestre: si **alguna** fila trae un día
       mayor que 12, el orden del archivo queda fijado para todas
    3. si no hay ninguna de las dos, la fila se rechaza con su motivo

El paso 2 es lo que hace esto usable: una cartola real casi siempre tiene
algún día 13 o más, y basta una para desambiguar el archivo completo.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable, Mapping, Sequence

from . import normalizacion
from .archivos import decodificar
from .candidatos import ORIGEN_CSV, Candidato, EstadoCandidato, TipoMensaje

# ══════════════════════════════════════════════════════════════════════
# Códigos de error. Estables: el frontend los usa para decidir qué decir.
# ══════════════════════════════════════════════════════════════════════

FALTAN_COLUMNAS = "faltan_columnas"
CABECERA_VACIA = "cabecera_vacia"
ORDEN_FECHA_INCONSISTENTE = "orden_fecha_inconsistente"

FILA_INCOMPLETA = "fila_incompleta"
FECHA_INVALIDA = "fecha_invalida"
FECHA_AMBIGUA = "fecha_ambigua"
IMPORTE_INVALIDO = "importe_invalido"
IMPORTE_CERO = "importe_cero"
MONEDA_AMBIGUA = "moneda_ambigua"
MONEDA_DESCONOCIDA = "moneda_desconocida"
MONEDA_NO_INDICADA = "moneda_no_indicada"
DESCRIPCION_VACIA = "descripcion_vacia"

# ══════════════════════════════════════════════════════════════════════
# Columnas
# ══════════════════════════════════════════════════════════════════════

CAMPO_FECHA = "fecha"
CAMPO_DESCRIPCION = "descripcion"
CAMPO_MONTO = "monto"
CAMPO_MONEDA = "moneda"

CAMPOS_OBLIGATORIOS = (CAMPO_FECHA, CAMPO_DESCRIPCION, CAMPO_MONTO)

#: Cómo llama cada banco a lo mismo. Se compara sin tildes, sin mayúsculas y
#: sin espacios de más, así que acá van las formas ya normalizadas.
ALIAS_ENCABEZADO: Mapping[str, str] = {
    "fecha": CAMPO_FECHA,
    "fecha movimiento": CAMPO_FECHA,
    "fecha de movimiento": CAMPO_FECHA,
    "fecha transaccion": CAMPO_FECHA,
    "fecha de transaccion": CAMPO_FECHA,
    "fecha operacion": CAMPO_FECHA,
    "fecha contable": CAMPO_FECHA,
    "date": CAMPO_FECHA,
    "descripcion": CAMPO_DESCRIPCION,
    "detalle": CAMPO_DESCRIPCION,
    "glosa": CAMPO_DESCRIPCION,
    "concepto": CAMPO_DESCRIPCION,
    "comercio": CAMPO_DESCRIPCION,
    "description": CAMPO_DESCRIPCION,
    "monto": CAMPO_MONTO,
    "importe": CAMPO_MONTO,
    "cargo": CAMPO_MONTO,
    "valor": CAMPO_MONTO,
    "monto total": CAMPO_MONTO,
    "amount": CAMPO_MONTO,
    "moneda": CAMPO_MONEDA,
    "divisa": CAMPO_MONEDA,
    "currency": CAMPO_MONEDA,
}

# ══════════════════════════════════════════════════════════════════════
# Monedas
# ══════════════════════════════════════════════════════════════════════

#: Cuántos decimales admite cada una. El peso chileno no tiene centavos, y eso
#: no es un detalle estético: sirve para desambiguar separadores más abajo.
DECIMALES_POR_MONEDA: Mapping[str, int] = {
    "CLP": 0,
    "ARS": 2,
    "BRL": 2,
    "COP": 2,
    "EUR": 2,
    "GBP": 2,
    "MXN": 2,
    "PEN": 2,
    "USD": 2,
    "UYU": 2,
}

#: Símbolos que SÍ identifican una moneda. `$` no está acá a propósito.
SIMBOLOS: Mapping[str, str] = {
    "US$": "USD",
    "USD": "USD",
    "U$S": "USD",
    "€": "EUR",
    "EUR": "EUR",
    "£": "GBP",
    "GBP": "GBP",
    "CLP": "CLP",
    "$CL": "CLP",
    "R$": "BRL",
    "S/": "PEN",
}

#: El peor de todos: en una cartola chilena son pesos y en una de Amazon son
#: dólares, y el texto no lo dice. Se rechaza con motivo.
SIMBOLO_AMBIGUO = "$"

ORDEN_DMY = "dmy"
ORDEN_MDY = "mdy"

_SEPARADORES_FECHA = re.compile(r"[/\-.]")
_SOLO_DIGITOS_Y_SEPARADORES = re.compile(r"[^0-9,.\-]")
_ESPACIOS = re.compile(r"\s+")


# ══════════════════════════════════════════════════════════════════════
# Resultados
# ══════════════════════════════════════════════════════════════════════


class CsvInvalido(ValueError):
    """El archivo entero no se puede leer. No hay filas que rescatar."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


@dataclass(frozen=True)
class ErrorFila:
    """Una fila que no se pudo leer, con su número y su motivo (S3-FE-13).

    `fila` es la línea **física** del archivo, contando la cabecera como 1.
    Es el número que la persona ve al abrir el CSV en su planilla, que es el
    único que le sirve para ir a arreglarlo.
    """

    fila: int
    codigo: str
    mensaje: str

    def como_json(self) -> dict:
        # Las mismas tres claves que guarda `Importacion.errores`, para que el
        # llamador pueda volcarlas sin traducir nada.
        return {"fila": self.fila, "codigo": self.codigo, "mensaje": self.mensaje}


@dataclass(frozen=True)
class ResultadoLectura:
    """Lo que salió del archivo: lo bueno y lo malo, por separado."""

    candidatos: tuple[Candidato, ...]
    errores: tuple[ErrorFila, ...]
    #: Filas de datos que se intentaron leer (sin la cabecera).
    filas_totales: int

    @property
    def filas_validas(self) -> int:
        return len(self.candidatos)

    @property
    def hubo_errores(self) -> bool:
        return bool(self.errores)


# ══════════════════════════════════════════════════════════════════════
# S3-FE-11 — la cabecera
# ══════════════════════════════════════════════════════════════════════


def _encabezado_limpio(texto: str) -> str:
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn"
    )
    return _ESPACIOS.sub(" ", sin_tildes).strip().lower()


def mapear_columnas(cabecera: Sequence[str]) -> dict[str, int]:
    """Nombre canónico → posición. Lanza `CsvInvalido` si falta una obligatoria.

    Devuelve posiciones y no nombres porque después se lee por índice: una
    cartola puede repetir un encabezado vacío y `csv.DictReader` se comería
    una de las dos columnas sin avisar.
    """
    posiciones: dict[str, int] = {}
    for indice, bruto in enumerate(cabecera):
        canonico = ALIAS_ENCABEZADO.get(_encabezado_limpio(bruto))
        # El primero gana: si la cartola trae "Monto" y "Monto Total", se usa
        # el que aparece antes y no el último, que es lo que haría un dict.
        if canonico and canonico not in posiciones:
            posiciones[canonico] = indice

    if not any(_encabezado_limpio(c) for c in cabecera):
        raise CsvInvalido(CABECERA_VACIA, "La primera fila del archivo no tiene encabezados.")

    faltan = [campo for campo in CAMPOS_OBLIGATORIOS if campo not in posiciones]
    if faltan:
        raise CsvInvalido(
            FALTAN_COLUMNAS,
            "Al archivo le faltan columnas obligatorias: "
            + ", ".join(faltan)
            + ". Se encontraron: "
            + (", ".join(c.strip() for c in cabecera if c.strip()) or "ninguna")
            + ".",
        )
    return posiciones


# ══════════════════════════════════════════════════════════════════════
# S3-FE-12 — valores canónicos
# ══════════════════════════════════════════════════════════════════════


def detectar_orden_fecha(valores: Iterable[str]) -> str | None:
    """Qué orden usa el archivo, si es que lo demuestra.

    Devuelve `ORDEN_DMY`, `ORDEN_MDY` o `None` cuando ninguna fila desambigua.
    Lanza si el archivo se contradice: hay filas que solo se explican como
    día/mes y otras que solo se explican como mes/día, y entonces no es que
    falte información, es que el archivo está mal.
    """
    hay_dmy = hay_mdy = False
    for valor in valores:
        partes = _partes_fecha(valor)
        if partes is None:
            continue
        primera, segunda, _ = partes
        if primera > 12:
            hay_dmy = True
        if segunda > 12:
            hay_mdy = True

    if hay_dmy and hay_mdy:
        raise CsvInvalido(
            ORDEN_FECHA_INCONSISTENTE,
            "El archivo mezcla fechas día/mes y mes/día: no hay un orden que explique todas.",
        )
    if hay_dmy:
        return ORDEN_DMY
    if hay_mdy:
        return ORDEN_MDY
    return None


def _partes_fecha(valor: str) -> tuple[int, int, int] | None:
    """(primera, segunda, año) de una fecha con separadores, o None.

    No decide qué es día y qué es mes: solo parte el texto. Una fecha ISO
    (`2026-04-03`, año primero) devuelve None porque no hay nada que decidir.
    """
    texto = (valor or "").strip()
    if not texto:
        return None
    partes = [p for p in _SEPARADORES_FECHA.split(texto) if p]
    if len(partes) != 3 or not all(p.isdigit() for p in partes):
        return None
    if len(partes[0]) == 4:
        return None  # ISO: el año va primero, no hay ambigüedad
    try:
        return int(partes[0]), int(partes[1]), int(partes[2])
    except ValueError:
        return None


def _normalizar_anio(anio: int) -> int:
    """Dos dígitos pasan a 2000+. Una cartola de 1998 no se va a importar."""
    return anio + 2000 if anio < 100 else anio


def convertir_fecha(valor: str, orden: str | None) -> date:
    """Texto a `date`. Lanza `_ErrorDeCampo` con el motivo si no se puede."""
    texto = (valor or "").strip()
    if not texto:
        raise _ErrorDeCampo(FECHA_INVALIDA, "La fecha está vacía.")

    # ISO primero: es el único formato que no necesita saber nada del archivo.
    try:
        return date.fromisoformat(texto[:10])
    except ValueError:
        pass
    # Formatos con hora pegada, que exporta más de un banco.
    for patron in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%d de %B de %Y"):
        try:
            return datetime.strptime(texto, patron).date()
        except ValueError:
            continue

    partes = _partes_fecha(texto)
    if partes is None:
        raise _ErrorDeCampo(FECHA_INVALIDA, f"No se entiende la fecha {texto!r}.")
    primera, segunda, anio = partes
    anio = _normalizar_anio(anio)

    if primera > 12 and segunda > 12:
        raise _ErrorDeCampo(FECHA_INVALIDA, f"La fecha {texto!r} no tiene un mes válido.")
    if primera > 12:
        dia, mes = primera, segunda
    elif segunda > 12:
        dia, mes = segunda, primera
    elif orden == ORDEN_DMY:
        dia, mes = primera, segunda
    elif orden == ORDEN_MDY:
        dia, mes = segunda, primera
    else:
        raise _ErrorDeCampo(
            FECHA_AMBIGUA,
            f"{texto!r} puede ser día/mes o mes/día y el archivo no lo aclara. "
            "Indica el orden de fecha al importar.",
        )

    try:
        return date(anio, mes, dia)
    except ValueError:
        raise _ErrorDeCampo(FECHA_INVALIDA, f"La fecha {texto!r} no existe.") from None


def detectar_moneda(texto_monto: str, texto_moneda: str, por_defecto: str | None) -> str:
    """Código ISO. Lanza si es ambigua, desconocida o no viene por ningún lado.

    Orden: la columna de moneda manda sobre el símbolo del monto, y el símbolo
    manda sobre el valor por omisión que haya declarado quien importa.
    """
    declarada = (texto_moneda or "").strip().upper()
    if declarada:
        if declarada in DECIMALES_POR_MONEDA:
            return declarada
        if declarada in SIMBOLOS:
            return SIMBOLOS[declarada]
        if declarada == SIMBOLO_AMBIGUO:
            raise _ErrorDeCampo(
                MONEDA_AMBIGUA,
                "La columna de moneda dice solo «$», que no distingue pesos de dólares.",
            )
        raise _ErrorDeCampo(MONEDA_DESCONOCIDA, f"Moneda no reconocida: {declarada!r}.")

    monto = (texto_monto or "").strip().upper()
    # El más largo primero: `US$` antes que `$`, o `US$ 10` saldría ambiguo.
    for simbolo in sorted(SIMBOLOS, key=len, reverse=True):
        if simbolo in monto:
            return SIMBOLOS[simbolo]
    if SIMBOLO_AMBIGUO in monto:
        raise _ErrorDeCampo(
            MONEDA_AMBIGUA,
            "El monto trae «$», que no distingue pesos de dólares. "
            "Agrega una columna de moneda o indica cuál es al importar.",
        )

    if por_defecto:
        return por_defecto
    raise _ErrorDeCampo(
        MONEDA_NO_INDICADA,
        "La fila no indica moneda y no se declaró una por omisión para el archivo.",
    )


def convertir_importe(valor: str, moneda: str) -> Decimal:
    """«1.234,56», «1,234.56», «-$ 1.500» a `Decimal` positivo.

    ── Qué separador es el decimal ─────────────────────────────────────
    Si están los dos, manda **el último**: en `1.234,56` la coma, en
    `1,234.56` el punto. Eso no tiene vuelta.

    Si hay uno solo, decide cuántos dígitos lo siguen:
        1 o 2   decimal       `1500,5`  `1500,50`
        3       miles         `1,500` son mil quinientos
        otro    inválido

    El grupo de 3 es miles y no decimales porque ninguna de las monedas que
    aceptamos tiene tres decimales. Si alguna vez entra una que sí (el dinar
    kuwaití tiene tres), hay que revisar esta regla y no solo la tabla.
    """
    texto = (valor or "").strip()
    if not texto:
        raise _ErrorDeCampo(IMPORTE_INVALIDO, "El monto está vacío.")

    # El signo se descarta a propósito, venga como `-1500` o como `(1500)`:
    # en una cartola el mismo cargo sale negativo o positivo según el banco, y
    # lo que importa acá es cuánto se pagó. Distinguir cargos de abonos es
    # trabajo de S3-FE-08, con el tipo de mensaje y no con el signo.
    limpio = _SOLO_DIGITOS_Y_SEPARADORES.sub("", texto).replace("-", "")
    if not limpio or not any(c.isdigit() for c in limpio):
        raise _ErrorDeCampo(IMPORTE_INVALIDO, f"No se entiende el monto {texto!r}.")

    ultima_coma = limpio.rfind(",")
    ultimo_punto = limpio.rfind(".")
    corte = max(ultima_coma, ultimo_punto)

    if corte == -1:
        entero, decimales = limpio, ""
    else:
        cola = limpio[corte + 1 :]
        hay_los_dos = ultima_coma != -1 and ultimo_punto != -1
        if not cola.isdigit():
            raise _ErrorDeCampo(IMPORTE_INVALIDO, f"No se entiende el monto {texto!r}.")
        if hay_los_dos or len(cola) in (1, 2):
            entero, decimales = limpio[:corte], cola
        elif len(cola) == 3:
            entero, decimales = limpio, ""  # separador de miles
        else:
            raise _ErrorDeCampo(IMPORTE_INVALIDO, f"No se entiende el monto {texto!r}.")

    entero = entero.replace(",", "").replace(".", "")
    if not entero:
        entero = "0"
    if not entero.isdigit():
        raise _ErrorDeCampo(IMPORTE_INVALIDO, f"No se entiende el monto {texto!r}.")

    try:
        importe = Decimal(entero + ("." + decimales if decimales else ""))
    except InvalidOperation:
        raise _ErrorDeCampo(IMPORTE_INVALIDO, f"No se entiende el monto {texto!r}.") from None

    admitidos = DECIMALES_POR_MONEDA.get(moneda, 2)
    if decimales and len(decimales) > admitidos:
        raise _ErrorDeCampo(
            IMPORTE_INVALIDO,
            f"{moneda} no admite {len(decimales)} decimales"
            + (f": {texto!r} no puede tener centavos." if admitidos == 0 else "."),
        )
    if importe == 0:
        # Una línea en cero no es un cobro. No es un error del archivo, pero
        # tampoco es un candidato: se informa para que se vea que se descartó.
        raise _ErrorDeCampo(IMPORTE_CERO, "El monto es cero: no es un cobro.")

    return importe


class _ErrorDeCampo(Exception):
    """Interno: un campo de una fila no se pudo convertir. Se vuelve `ErrorFila`."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


# ══════════════════════════════════════════════════════════════════════
# S3-FE-13 — la pasada completa
# ══════════════════════════════════════════════════════════════════════


def leer(
    contenido: bytes,
    *,
    separador: str,
    organizacion_id: str,
    sha256: str,
    orden_fecha: str | None = None,
    moneda_por_defecto: str | None = None,
) -> ResultadoLectura:
    """Lee el CSV entero y devuelve candidatos y errores por fila.

    `sha256` es el del archivo, el que ya calculó `archivos.validar`: con él
    se arma el identificador de origen de cada fila, que es lo que hace que
    reimportar el mismo archivo no duplique nada (S3-FE-17).

    Solo lanza `CsvInvalido`, y solo por problemas del archivo completo:
    cabecera ausente, columna obligatoria faltante u orden de fecha
    contradictorio. Todo lo demás sale como `ErrorFila`.
    """
    texto = decodificar(contenido)
    lector = csv.reader(io.StringIO(texto, newline=""), delimiter=separador)

    # ── El número de fila sale del lector, no de un contador propio ─────
    # `lector.line_num` cuenta líneas del ARCHIVO. Un `enumerate` sobre las
    # filas devueltas se corre en cuanto una glosa trae un salto de línea
    # entre comillas: csv junta esas dos líneas en una sola fila, y de ahí en
    # adelante todos los números apuntarían una línea más arriba. El número
    # tiene que ser el que la persona ve en su planilla, o no sirve de nada.
    filas = [(lector.line_num, fila) for fila in lector]
    if not filas:
        raise CsvInvalido(CABECERA_VACIA, "El archivo no tiene filas.")

    posiciones = mapear_columnas(filas[0][1])
    cuerpo = [(numero, fila) for numero, fila in filas[1:] if any(c.strip() for c in fila)]

    indice_fecha = posiciones[CAMPO_FECHA]
    orden = orden_fecha or detectar_orden_fecha(
        fila[indice_fecha] for _, fila in cuerpo if indice_fecha < len(fila)
    )

    candidatos: list[Candidato] = []
    errores: list[ErrorFila] = []

    for numero, fila in cuerpo:
        try:
            candidatos.append(
                _candidato_de_fila(
                    fila,
                    numero=numero,
                    posiciones=posiciones,
                    organizacion_id=organizacion_id,
                    sha256=sha256,
                    orden=orden,
                    moneda_por_defecto=moneda_por_defecto,
                )
            )
        except _ErrorDeCampo as e:
            # Acá está S3-FE-13: se anota y se sigue con la fila siguiente.
            errores.append(ErrorFila(fila=numero, codigo=e.codigo, mensaje=e.mensaje))

    return ResultadoLectura(
        candidatos=tuple(candidatos),
        errores=tuple(errores),
        filas_totales=len(cuerpo),
    )


def _candidato_de_fila(
    fila: Sequence[str],
    *,
    numero: int,
    posiciones: Mapping[str, int],
    organizacion_id: str,
    sha256: str,
    orden: str | None,
    moneda_por_defecto: str | None,
) -> Candidato:
    def celda(campo: str) -> str:
        indice = posiciones.get(campo)
        if indice is None or indice >= len(fila):
            return ""
        return (fila[indice] or "").strip()

    # Una fila más corta que la cabecera no se completa con vacíos en silencio:
    # significa que el archivo se cortó o que la glosa traía el separador sin
    # comillas, y adivinar cuál columna falta sería inventar datos.
    if len(fila) < max(posiciones[c] for c in CAMPOS_OBLIGATORIOS) + 1:
        raise _ErrorDeCampo(
            FILA_INCOMPLETA,
            f"La fila tiene {len(fila)} columnas y no alcanza para las obligatorias.",
        )

    descripcion = celda(CAMPO_DESCRIPCION)
    if not descripcion:
        raise _ErrorDeCampo(DESCRIPCION_VACIA, "La fila no tiene descripción: no se sabe a quién se le pagó.")

    texto_monto = celda(CAMPO_MONTO)
    moneda = detectar_moneda(texto_monto, celda(CAMPO_MONEDA), moneda_por_defecto)
    importe = convertir_importe(texto_monto, moneda)
    fecha = convertir_fecha(celda(CAMPO_FECHA), orden)

    # Reutiliza el catálogo de FE-12 en vez de volver a resolver nombres acá.
    resuelto = normalizacion.normalizar(descripcion)

    return Candidato(
        origen=ORIGEN_CSV,
        # Fila y archivo: el mismo archivo subido dos veces da el mismo
        # identificador, y dos archivos distintos nunca chocan aunque se
        # llamen igual.
        identificador_origen=f"{sha256}:{numero}",
        organizacion_id=organizacion_id,
        servicio=resuelto.proveedor,
        servicio_texto=descripcion,
        servicio_resultado=resuelto.resultado,
        importe=importe,
        moneda=moneda,
        fecha=fecha,
        # Una cartola registra lo que ya pasó. Los avisos y los fallos llegan
        # por correo, y los distingue S3-FE-08.
        tipo_mensaje=TipoMensaje.COBRO_REALIZADO,
        estado=EstadoCandidato.PROPUESTO,
        evidencia={"fila": str(numero), "descripcion_original": descripcion},
    )
