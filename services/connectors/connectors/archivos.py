"""Validar un archivo subido para importar (FE-07).

Todo lo que se decide ANTES de guardar nada: si el formato se admite, si el
tamaño cabe y si el contenido es lo que la extensión dice que es. Son
funciones puras sobre bytes, así que se prueban sin API y FE-09 puede volver
a llamarlas antes de procesar.

── Formatos admitidos, explícitos ───────────────────────────────────────────
    .csv   una cartola o una exportación del banco, texto con columnas
    .pdf   una cartola en PDF (la tarjeta lo pide; FE-09 decide qué extrae)

Nada más. Un `.xlsx` o un `.txt` se rechazan por extensión, no se intentan
adivinar: el error dice qué se admite.

── La extensión no prueba nada ──────────────────────────────────────────────
Un archivo se llama como el usuario quiera. Por eso se mira el contenido:

    .pdf   tiene que empezar con `%PDF-`
    .csv   tiene que ser texto (sin bytes nulos, decodificable), con una
           cabecera y al menos una fila, y con al menos dos columnas en un
           separador conocido (`,` `;` tabulador `|`)

Un `.csv` que trae un PDF adentro, o un `.pdf` que es texto, se rechazan como
"contenido incompatible". Es el criterio "archivo excedido o contenido
incompatible se rechaza antes de procesar".
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

FORMATOS_ADMITIDOS = ("csv", "pdf")
SEPARADORES = (",", ";", "\t", "|")

#: Los saltos de linea, como constantes: escribirlos en linea obliga a
#: escaparlos y ya se rompio una vez al editar este archivo.
LF = chr(10)
CR = chr(13)
CRLF = CR + LF

FORMATO_NO_ADMITIDO = "formato_no_admitido"
ARCHIVO_VACIO = "archivo_vacio"
ARCHIVO_EXCEDIDO = "archivo_excedido"
CONTENIDO_INCOMPATIBLE = "contenido_incompatible"


class ArchivoRechazado(ValueError):
    """El archivo no se puede importar. `codigo` es estable; `mensaje`, para la persona."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


@dataclass(frozen=True)
class ArchivoValidado:
    nombre: str
    formato: str
    tamano: int
    sha256: str
    #: Filas de datos (sin la cabecera) en un CSV; None en un PDF, que no se
    #: sabe hasta leerlo.
    filas: int | None
    separador: str | None


def nombre_seguro(nombre: str) -> str:
    """Solo el nombre, sin ruta: `../../x.csv` queda `x.csv`. Acotado a 255."""
    base = os.path.basename((nombre or "").replace("\\", "/")).strip()
    return base[:255]


def _extension(nombre: str) -> str:
    _, punto, ext = nombre.rpartition(".")
    return ext.lower() if punto else ""


def _decodificar(contenido: bytes) -> str:
    """UTF-8 (con o sin BOM) y, si no, Latin-1: es lo que exportan los bancos
    chilenos. Si ninguna sirve, no es texto."""
    for codificacion in ("utf-8-sig", "latin-1"):
        try:
            return contenido.decode(codificacion)
        except UnicodeDecodeError:
            continue
    raise ArchivoRechazado(CONTENIDO_INCOMPATIBLE, "El archivo no es texto legible.")


def _validar_csv(contenido: bytes) -> tuple[int, str]:
    """(filas de datos, separador). Lanza si no parece una tabla."""
    if contenido.startswith(b"%PDF-"):
        raise ArchivoRechazado(
            CONTENIDO_INCOMPATIBLE, "El archivo dice .csv pero su contenido es un PDF."
        )
    if b"\x00" in contenido:
        raise ArchivoRechazado(CONTENIDO_INCOMPATIBLE, "El archivo no es texto: trae bytes nulos.")
    texto = _decodificar(contenido)
    # ── `split` y no `splitlines` ───────────────────────────────────────
    # `splitlines()` corta en MÁS cosas que el salto de línea: también en
    # U+0085 (NEL), U+2028 y U+2029. En un CSV de Excel en cp1252
    # decodificado como Latin-1, el byte 0x85 son los puntos suspensivos
    # "…", así que cada celda que los tuviera sumaba una fila falsa a
    # `filas_totales` y la barra de progreso de CH-27 quedaba mintiendo.
    # Lo encontró la revisión de #120.
    #
    # Se normaliza CRLF y CR a LF primero, para que un archivo de Windows
    # o de Mac clásico cuente igual.
    normalizado = texto.replace(CRLF, LF).replace(CR, LF)
    lineas = [l for l in normalizado.split(LF) if l.strip()]
    if len(lineas) < 2:
        raise ArchivoRechazado(
            CONTENIDO_INCOMPATIBLE,
            "El CSV necesita una fila de cabecera y al menos una fila de datos.",
        )
    cabecera = lineas[0]
    separador = max(SEPARADORES, key=cabecera.count)
    if cabecera.count(separador) < 1:
        raise ArchivoRechazado(
            CONTENIDO_INCOMPATIBLE,
            "El CSV tiene una sola columna: no se encontró un separador (coma, punto y coma, tabulador o barra).",
        )
    return len(lineas) - 1, separador


def _validar_pdf(contenido: bytes) -> None:
    if not contenido.startswith(b"%PDF-"):
        raise ArchivoRechazado(
            CONTENIDO_INCOMPATIBLE, "El archivo dice .pdf pero su contenido no es un PDF."
        )


def validar(nombre: str, contenido: bytes, *, tamano_maximo: int) -> ArchivoValidado:
    """Decide si el archivo se puede importar. Lanza `ArchivoRechazado` si no.

    El orden importa: primero lo barato (nombre, extensión, tamaño) y recién
    después el contenido. Un archivo de 2 GB con extensión `.exe` no se lee.
    """
    nombre = nombre_seguro(nombre)
    if not nombre:
        raise ArchivoRechazado(FORMATO_NO_ADMITIDO, "El archivo no tiene nombre.")
    formato = _extension(nombre)
    if formato not in FORMATOS_ADMITIDOS:
        admitidos = ", ".join(f".{f}" for f in FORMATOS_ADMITIDOS)
        raise ArchivoRechazado(
            FORMATO_NO_ADMITIDO,
            f"Formato no admitido ({'.' + formato if formato else 'sin extensión'}). Se aceptan: {admitidos}.",
        )
    tamano = len(contenido)
    if tamano == 0:
        raise ArchivoRechazado(ARCHIVO_VACIO, "El archivo está vacío.")
    if tamano > tamano_maximo:
        raise ArchivoRechazado(
            ARCHIVO_EXCEDIDO,
            f"El archivo pesa {tamano:,} bytes y el máximo es {tamano_maximo:,}.".replace(",", "."),
        )

    filas = separador = None
    if formato == "csv":
        filas, separador = _validar_csv(contenido)
    else:
        _validar_pdf(contenido)

    return ArchivoValidado(
        nombre=nombre,
        formato=formato,
        tamano=tamano,
        sha256=hashlib.sha256(contenido).hexdigest(),
        filas=filas,
        separador=separador,
    )
