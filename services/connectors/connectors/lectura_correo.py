"""Lo común a los lectores de correo (S3-FE-02 Gmail y S3-FE-04 Outlook).

Cada proveedor tiene su módulo (`lector_gmail`, `lector_outlook`) con lo que
es SUYO: la URL, cómo se arma la búsqueda, cómo pagina y cómo responde cuando
algo sale mal. Lo que vive aquí es lo que tiene que decir lo mismo en los dos,
porque lo consumen las mismas tarjetas:

- **qué cuenta se puede leer** (`cuenta_para_leer`): por organización, del
  proveedor pedido, conectada y con un token vigente;
- **qué se devuelve** (`MensajeCorreo`, `PaginaDeMensajes`) y **qué errores**,
  con un `codigo` estable para S3-FE-18 (reintentos) y S3-FE-19 (renovar o
  pedir reconexión);
- **qué se filtra** (`FiltroCorreos`), validado antes de que cada lector lo
  traduzca a la sintaxis de su proveedor;
- y **cómo se pasa un HTML a texto**.

Ningún lector guarda nada ni cambia la cuenta.
"""

from __future__ import annotations

import dataclasses
import re
import uuid
from datetime import datetime, timedelta
from html.parser import HTMLParser

from django.core.exceptions import ValidationError
from django.utils import timezone

from shared.cifrado import SECRETO_ILEGIBLE

from .models import CuentaConectada

#: Cuántos mensajes trae una llamada si no se dice otra cosa, y el máximo.
LIMITE_POR_DEFECTO = 25
LIMITE_MAXIMO = 100

#: Tope del texto que se conserva de cada mensaje. Un recibo cabe de sobra;
#: un boletín con todo su HTML, no, y no hace falta.
LARGO_MAXIMO_TEXTO = 20_000

#: Un token que vence en menos de esto ya no alcanza para leer una página.
MARGEN_VENCIMIENTO = timedelta(seconds=30)

#: Lo que buscan los lectores por omisión. Va en español y en inglés porque
#: los recibos de servicios extranjeros llegan en inglés. Es un filtro amplio a
#: propósito: un recibo que no entra aquí no se ve nunca, uno que sobra lo
#: descarta S3-FE-08.
PALABRAS_DE_COBRO = (
    "recibo", "factura", "boleta", "pago", "cobro", "suscripción",
    "suscripcion", "renovación", "renovacion", "cargo",
    "receipt", "invoice", "payment", "subscription", "renewal", "billing",
)

#: Cómo se reconoce un remitente aceptable para el filtro: una dirección o un
#: dominio. Cualquier otra cosa podría cambiar el sentido de la búsqueda
#: (`a) OR in:anywhere`, o un `-` adelante, que en Gmail niega), así que se
#: rechaza antes de armarla.
_REMITENTE = re.compile(
    r"^[A-Za-z0-9._%+][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$"
    r"|^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$"
)


# ── errores ─────────────────────────────────────────────────────────────────


class ErrorDeLectura(Exception):
    """Base de lo que puede salir mal al leer. `codigo` es estable; el
    mensaje es para una persona y nunca lleva el token."""

    codigo = "error_de_lectura"

    def __init__(self, mensaje: str, *, codigo: str | None = None):
        super().__init__(mensaje)
        if codigo is not None:
            self.codigo = codigo


class CuentaNoDisponible(ErrorDeLectura):
    """No se habló con el proveedor: la cuenta no se puede leer tal como está."""

    NO_ENCONTRADA = "cuenta_no_encontrada"
    DESCONECTADA = "cuenta_desconectada"
    REQUIERE_REAUTORIZACION = "requiere_reautorizacion"
    SIN_CREDENCIALES = "sin_credenciales"
    CREDENCIAL_VENCIDA = "credencial_vencida"
    ESTADO_NO_LEGIBLE = "estado_no_legible"


class AutorizacionRechazada(ErrorDeLectura):
    """El proveedor dijo que el token ya no sirve o no alcanza (401, o 403
    de permisos). Lo resuelve S3-FE-19: renovar o pedir reconexión."""

    codigo = "autorizacion_rechazada"


class ErrorTransitorio(ErrorDeLectura):
    """Red, tiempo agotado, cuota o una falla del proveedor. Se puede
    reintentar más tarde (S3-FE-18) sin perder nada: no se guardó nada.

    `reintentar_en` son los segundos que el proveedor pidió esperar
    (`Retry-After`), si los dijo. S3-FE-18 decide qué hacer con ellos."""

    codigo = "error_transitorio"

    def __init__(self, mensaje: str, *, codigo: str | None = None, reintentar_en: int | None = None):
        super().__init__(mensaje, codigo=codigo)
        self.reintentar_en = reintentar_en


class ErrorDelProveedor(ErrorDeLectura):
    """El proveedor contestó algo que reintentar no arregla: una página
    inválida, la API sin habilitar, una respuesta que no se entiende."""

    codigo = "error_del_proveedor"


# ── lo que se pide y lo que se devuelve ─────────────────────────────────────


@dataclasses.dataclass(frozen=True)
class FiltroCorreos:
    """Qué correos interesan. Todo opcional; por omisión, los que parecen
    cobros, de cualquier fecha y remitente. `hasta` es exclusivo.

    Cada lector lo traduce a la búsqueda de su proveedor, después de
    `validar()`.
    """

    desde: datetime | None = None
    hasta: datetime | None = None
    remitentes: tuple[str, ...] = ()
    solo_cobros: bool = True

    def validar(self) -> None:
        """`ValueError` si el filtro no se puede traducir sin cambiar su
        sentido. Se llama antes de hablar con el proveedor."""
        for nombre, valor in (("desde", self.desde), ("hasta", self.hasta)):
            if valor is not None and timezone.is_naive(valor):
                raise ValueError(f"`{nombre}` tiene que traer zona horaria.")
        if self.desde and self.hasta and self.desde >= self.hasta:
            raise ValueError("`desde` tiene que ser anterior a `hasta`.")
        for remitente in self.remitentes:
            if not isinstance(remitente, str) or not _REMITENTE.match(remitente):
                raise ValueError(f"remitente no válido para el filtro: {remitente!r:.60}")

    def admite(self, recibido_en: datetime) -> bool:
        """¿La fecha cae dentro de `desde` y `hasta`? Para los proveedores
        cuya búsqueda solo entiende días y no la hora exacta."""
        if self.desde and recibido_en < self.desde:
            return False
        if self.hasta and recibido_en >= self.hasta:
            return False
        return True


@dataclasses.dataclass(frozen=True)
class MensajeCorreo:
    """Un mensaje leído. Vive en memoria: los lectores no lo guardan."""

    cuenta_id: uuid.UUID
    id_mensaje: str
    id_hilo: str
    recibido_en: datetime
    remitente: str
    asunto: str
    #: Fuera del `repr` para que un log o una traza no se lleven el correo.
    texto: str = dataclasses.field(repr=False)
    #: True si el texto se cortó en `LARGO_MAXIMO_TEXTO`.
    texto_truncado: bool = False


@dataclasses.dataclass(frozen=True)
class MensajeOmitido:
    """Un mensaje que la lista nombró pero no se pudo usar. Se informa en
    vez de callarlo: perderlo en silencio es perder un cobro."""

    id_mensaje: str
    motivo: str


@dataclasses.dataclass(frozen=True)
class PaginaDeMensajes:
    mensajes: tuple[MensajeCorreo, ...]
    #: Para pedir la página siguiente; `None` si no hay más.
    siguiente_pagina: str | None
    omitidos: tuple[MensajeOmitido, ...] = ()


def validar_limite(limite) -> None:
    if isinstance(limite, bool) or not isinstance(limite, int) or not 1 <= limite <= LIMITE_MAXIMO:
        raise ValueError(f"`limite` va de 1 a {LIMITE_MAXIMO}.")


def recortar(texto: str) -> tuple[str, bool]:
    """El texto con el tope aplicado, y si se cortó."""
    return texto[:LARGO_MAXIMO_TEXTO], len(texto) > LARGO_MAXIMO_TEXTO


# ── la cuenta ───────────────────────────────────────────────────────────────


def cuenta_para_leer(*, organizacion_id, cuenta_id, proveedor: str) -> tuple[CuentaConectada, str]:
    """La cuenta de ESA organización y de ESE proveedor, con su token, o
    `CuentaNoDisponible`.

    Devuelve el token aparte para que no haya que volver a descifrarlo, y
    para que nadie tenga que leer `cuenta.access_token` fuera de aquí.
    """
    nombre = CuentaConectada.Proveedor(proveedor).label
    try:
        cuenta = CuentaConectada.objects.filter(
            pk=cuenta_id,
            organizacion_id=organizacion_id,
            proveedor=proveedor,
        ).first()
    except (ValidationError, ValueError, TypeError):
        # Un identificador que ni siquiera es un UUID tampoco es una cuenta.
        cuenta = None
    if cuenta is None:
        # Ajena, de otro proveedor o inexistente: la misma respuesta.
        raise CuentaNoDisponible(
            f"No hay una cuenta de {nombre} con ese identificador en esta organización.",
            codigo=CuentaNoDisponible.NO_ENCONTRADA,
        )
    if cuenta.estado == CuentaConectada.Estado.DESCONECTADA:
        raise CuentaNoDisponible(
            "La cuenta está desconectada.", codigo=CuentaNoDisponible.DESCONECTADA,
        )
    if cuenta.necesita_reautorizacion:
        raise CuentaNoDisponible(
            "La cuenta necesita que el usuario vuelva a autorizarla.",
            codigo=CuentaNoDisponible.REQUIERE_REAUTORIZACION,
        )
    if cuenta.estado != CuentaConectada.Estado.CONECTADA:
        # Un estado que no conocemos no se lee "por si acaso".
        raise CuentaNoDisponible(
            f"La cuenta está en un estado que no permite leer ({cuenta.estado[:30]}).",
            codigo=CuentaNoDisponible.ESTADO_NO_LEGIBLE,
        )
    token = cuenta.access_token
    if not token or token is SECRETO_ILEGIBLE:
        raise CuentaNoDisponible(
            "La cuenta no tiene credenciales guardadas.",
            codigo=CuentaNoDisponible.SIN_CREDENCIALES,
        )
    if cuenta.token_expira_en and cuenta.token_expira_en <= timezone.now() + MARGEN_VENCIMIENTO:
        raise CuentaNoDisponible(
            "El token de acceso venció; hay que renovarlo antes de leer (S3-FE-19).",
            codigo=CuentaNoDisponible.CREDENCIAL_VENCIDA,
        )
    return cuenta, str(token)


# ── HTML a texto ────────────────────────────────────────────────────────────


class _ExtractorDeTexto(HTMLParser):
    """HTML a texto, sin dependencias: se queda con el texto visible y salta
    `script`, `style` y `head`. Los bloques terminan en salto de línea para
    que un importe no quede pegado a la palabra de la celda vecina."""

    _OCULTOS = {"script", "style", "head", "title"}
    _BLOQUES = {"p", "div", "br", "tr", "li", "table", "h1", "h2", "h3", "h4", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._partes: list[str] = []
        self._oculto = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._OCULTOS:
            self._oculto += 1
        elif tag in self._BLOQUES:
            self._partes.append("\n")

    def handle_endtag(self, tag):
        if tag in self._OCULTOS and self._oculto:
            self._oculto -= 1
        elif tag in self._BLOQUES:
            self._partes.append("\n")

    def handle_data(self, data):
        if not self._oculto:
            self._partes.append(data)

    def texto(self) -> str:
        unido = "".join(self._partes)
        lineas = (re.sub(r"[ \t ]+", " ", linea).strip() for linea in unido.splitlines())
        return "\n".join(linea for linea in lineas if linea)


def html_a_texto(html: str) -> str:
    if not html:
        return ""
    extractor = _ExtractorDeTexto()
    extractor.feed(html)
    extractor.close()
    return extractor.texto()
