"""Frontera tipada del contexto que se envía al proveedor de IA (VI-23).

El endpoint del asistente devuelve a su propio cliente el contexto con los
nombres reales de los servicios (es información de la organización
autenticada). Lo que **sale hacia el proveedor externo** es otra cosa: sólo el
payload construido acá.

La defensa es estructural, no una lista de expresiones regulares sobre texto
libre:

* Cada clave permitida tiene un tipo explícito. ``minutos`` y ``dias_con_uso``
  sólo aceptan enteros en rango; ``ahorro_estimado``, sólo números; ``mes``,
  un periodo ``YYYY-MM``; ``moneda``, un código ISO de tres letras.
* Los nombres de servicio se sustituyen por un alias local (``servicio_1``…).
  El proveedor puede distinguir servicios sin recibir su denominación, que
  puede contener el nombre de una persona.
* Los textos libres (``motivo`` y la pregunta del usuario) pasan por una capa
  defensiva que redacta correos, RUT, tarjetas, credenciales, UUID y frases de
  inyección, además de quitar caracteres de control y recortar.
* Todo lo que no esté en el esquema se descarta antes de salir.

Los montos y los periodos se conservan: no son datos personales y son el
contexto que la IA necesita para responder.
"""

from __future__ import annotations

from decimal import Decimal
import math
import re
import unicodedata
from typing import Any, Mapping

MAX_TEXTO = 300
MAX_PREGUNTA = 500
MAX_ELEMENTOS = 20
MAX_MONETARIO = Decimal("999999999999.99")
MAX_ENTERO = 1_000_000

# ── patrones de datos sensibles e inyección ──────────────────────────
_PATRON_CORREO = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+", re.IGNORECASE)
_PATRON_RUT = re.compile(
    r"\b\d{1,2}(?:\.\d{3}){2}\s*-\s*[\dkK]\b"
    r"|\b\d{7,8}\s*-\s*[\dkK]\b",
    re.IGNORECASE,
)
_PATRON_TARJETA = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_PATRON_CREDENCIAL = re.compile(
    r"(?i)\b(?:bearer\s+[A-Za-z0-9._~+/=-]+"
    r"|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|contraseña)"
    r"\s*[:=]\s*\S+"
    r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"
)
_PATRON_UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_PATRONES_INYECCION = (
    re.compile(
        r"(?i)\b(?:ignora|ignore|olvida|forget|disregard)\b.{0,60}"
        r"\b(?:instrucciones|instructions|reglas|rules|prompt)\b"
    ),
    re.compile(
        r"(?i)\b(?:system\s*prompt|mensaje\s+del\s+sistema|"
        r"prompt\s+del\s+sistema|instrucciones\s+del\s+sistema)\b"
    ),
    re.compile(
        r"(?i)\b(?:revela|reveal|muestra|show|imprime|print)\b.{0,40}"
        r"\b(?:secreto|secret|token|contraseña|password|prompt)\b"
    ),
    re.compile(r"(?i)\b(?:actúa\s+como|act\s+as|you\s+are\s+now|ahora\s+eres)\b"),
    re.compile(r"(?i)\b(?:jailbreak|dan\s+mode|modo\s+desarrollador)\b"),
    re.compile(r"(?i)</?\s*(?:system|assistant|user)\s*>"),
)

_PATRON_PERIODO = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")
_PATRON_MONEDA = re.compile(r"^[A-Z]{3}$")
# ``construir_contexto()`` serializa los importes como texto decimal
# (``DecimalField(max_digits=14, decimal_places=2)``). Se aceptan sólo con esa
# forma exacta: nada de exponentes, signos sueltos ni cadenas arbitrarias.
_PATRON_MONTO_TEXTO = re.compile(r"^\d{1,12}(?:\.\d{1,2})?$")

MARCADOR_INSTRUCCION = "[instrucción no confiable omitida]"
MARCADOR_CORREO = "[correo omitido]"
MARCADOR_RUT = "[RUT omitido]"
MARCADOR_TARJETA = "[tarjeta omitida]"
MARCADOR_CREDENCIAL = "[credencial omitida]"
MARCADOR_IDENTIFICADOR = "[identificador omitido]"

# ── esquema ──────────────────────────────────────────────────────────
_TIPO_SERVICIO = "servicio"
_TIPO_PERIODO = "periodo"
_TIPO_ENTERO = "entero"
_TIPO_MONETARIO = "monetario"
_TIPO_MONEDA = "moneda"
_TIPO_TEXTO = "texto"
_TIPO_MAPA = "mapa"
_TIPO_LISTA = "lista"

ESQUEMA_CAMPOS: dict[str, str] = {
    "uso_mensual": _TIPO_LISTA,
    "recomendaciones": _TIPO_LISTA,
    "servicio": _TIPO_SERVICIO,
    "mes": _TIPO_PERIODO,
    "minutos": _TIPO_ENTERO,
    "dias_con_uso": _TIPO_ENTERO,
    "ahorro_estimado": _TIPO_MONETARIO,
    "moneda": _TIPO_MONEDA,
    "motivo": _TIPO_TEXTO,
}

# Claves que jamás deben copiarse aunque una futura ampliación las incluya.
CAMPOS_PROHIBIDOS = frozenset(
    {
        "id",
        "organizacion_id",
        "usuario_id",
        "suscripcion_id",
        "evento_origen_id",
        "correlation_id",
        "nombre",
        "correo",
        "email",
        "rut",
        "telefono",
        "direccion",
        "tarjeta",
        "numero_tarjeta",
        "token",
        "access_token",
        "refresh_token",
        "password",
        "contrasena",
        "secret",
        "api_key",
        "evidencia_id",
        "evidencia_url",
        "evidencia_descripcion",
    }
)

_DESCARTAR = object()


def _limpiar_control(texto: str) -> str:
    limpio = "".join(
        caracter for caracter in texto if unicodedata.category(caracter)[0] != "C"
    )
    return re.sub(r"\s+", " ", limpio).strip()


def sanitizar_texto(texto: str, *, limite: int = MAX_TEXTO) -> str:
    """Redacta datos sensibles y frases de inyección, y recorta el texto.

    Es una segunda capa defensiva. La principal es que los nombres de servicio
    nunca viajan: se reemplazan por alias.
    """
    limpio = texto
    for patron in _PATRONES_INYECCION:
        limpio = patron.sub(MARCADOR_INSTRUCCION, limpio)
    limpio = _PATRON_CORREO.sub(MARCADOR_CORREO, limpio)
    limpio = _PATRON_RUT.sub(MARCADOR_RUT, limpio)
    limpio = _PATRON_UUID.sub(MARCADOR_IDENTIFICADOR, limpio)
    limpio = _PATRON_TARJETA.sub(MARCADOR_TARJETA, limpio)
    limpio = _PATRON_CREDENCIAL.sub(MARCADOR_CREDENCIAL, limpio)
    return _limpiar_control(limpio)[:limite]


class _Contexto:
    """Estado compartido: el mismo servicio recibe siempre el mismo alias."""

    def __init__(self) -> None:
        self.alias_servicios: dict[str, str] = {}

    def alias(self, valor: str) -> str:
        clave = valor.strip().casefold()
        if clave not in self.alias_servicios:
            self.alias_servicios[clave] = f"servicio_{len(self.alias_servicios) + 1}"
        return self.alias_servicios[clave]


def _entero_seguro(valor: Any) -> Any:
    if isinstance(valor, bool) or not isinstance(valor, int):
        return _DESCARTAR
    return valor if 0 <= valor <= MAX_ENTERO else _DESCARTAR


def _monetario_seguro(valor: Any) -> Any:
    if isinstance(valor, bool):
        return _DESCARTAR
    if isinstance(valor, Decimal):
        numero = valor
        if not numero.is_finite():
            return _DESCARTAR
    elif isinstance(valor, int):
        numero = Decimal(valor)
    elif isinstance(valor, float):
        if not math.isfinite(valor):
            return _DESCARTAR
        numero = Decimal(str(valor))
    elif isinstance(valor, str):
        texto = valor.strip()
        if not _PATRON_MONTO_TEXTO.fullmatch(texto):
            return _DESCARTAR
        numero = Decimal(texto)
    else:
        return _DESCARTAR
    if abs(numero) > MAX_MONETARIO:
        return _DESCARTAR
    return valor


def _periodo_seguro(valor: Any) -> Any:
    if isinstance(valor, str) and _PATRON_PERIODO.fullmatch(valor.strip()):
        return valor.strip()
    return _DESCARTAR


def _moneda_segura(valor: Any) -> Any:
    if not isinstance(valor, str):
        return _DESCARTAR
    codigo = valor.strip().upper()
    return codigo if _PATRON_MONEDA.fullmatch(codigo) else _DESCARTAR


def _servicio_seguro(valor: Any, contexto: _Contexto) -> Any:
    if not isinstance(valor, str) or not valor.strip():
        return _DESCARTAR
    return contexto.alias(valor)


def _sanitizar_campo(clave: str, tipo: str, valor: Any, contexto: _Contexto) -> Any:
    if tipo == _TIPO_SERVICIO:
        return _servicio_seguro(valor, contexto)
    if tipo == _TIPO_PERIODO:
        return _periodo_seguro(valor)
    if tipo == _TIPO_ENTERO:
        return _entero_seguro(valor)
    if tipo == _TIPO_MONETARIO:
        return _monetario_seguro(valor)
    if tipo == _TIPO_MONEDA:
        return _moneda_segura(valor)
    if tipo == _TIPO_TEXTO:
        return sanitizar_texto(valor) if isinstance(valor, str) else _DESCARTAR
    return _DESCARTAR


def _sanitizar_mapa(datos: Mapping[str, Any], contexto: _Contexto) -> dict[str, Any]:
    saneado: dict[str, Any] = {}
    for clave, valor in datos.items():
        if not isinstance(clave, str) or clave in CAMPOS_PROHIBIDOS:
            continue
        tipo = ESQUEMA_CAMPOS.get(clave)
        if tipo is None:
            continue
        if tipo == _TIPO_MAPA:
            if isinstance(valor, Mapping):
                saneado[clave] = _sanitizar_mapa(valor, contexto)
            continue
        if tipo == _TIPO_LISTA:
            if not isinstance(valor, (list, tuple)):
                continue
            elementos: list[dict[str, Any]] = []
            for item in list(valor)[:MAX_ELEMENTOS]:
                # Un escalar suelto (por ejemplo un número de tarjeta) no
                # tiene forma de objeto y no entra al payload.
                if not isinstance(item, Mapping):
                    continue
                limpio = _sanitizar_mapa(item, contexto)
                if limpio:
                    elementos.append(limpio)
            saneado[clave] = elementos
            continue
        limpio = _sanitizar_campo(clave, tipo, valor, contexto)
        if limpio is not _DESCARTAR:
            saneado[clave] = limpio
    return saneado


def _a_json(valor: Any) -> Any:
    """Convierte tipos de Python a valores serializables sin perder precisión."""
    if isinstance(valor, Decimal):
        return format(valor, "f")
    if isinstance(valor, Mapping):
        return {str(clave): _a_json(contenido) for clave, contenido in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_a_json(item) for item in valor]
    return valor


def sanitizar_contexto_asistente(contexto: Mapping[str, Any]) -> dict[str, Any]:
    """Copia el contexto limitada al esquema, con servicios ya aliasados."""
    if not isinstance(contexto, Mapping):
        return {}
    return _sanitizar_mapa(contexto, _Contexto())


def construir_payload_asistente(
    contexto: Mapping[str, Any],
    mensaje: str = "",
) -> dict[str, Any]:
    """Payload exacto que puede llegar al proveedor externo.

    ``pregunta`` pasa por la capa defensiva y ``datos`` sale ya saneado y
    serializable (montos como cadena decimal, periodos ISO). El contexto
    original no se modifica.
    """
    return {
        "datos": _a_json(sanitizar_contexto_asistente(contexto)),
        "pregunta": sanitizar_texto(mensaje, limite=MAX_PREGUNTA),
    }
