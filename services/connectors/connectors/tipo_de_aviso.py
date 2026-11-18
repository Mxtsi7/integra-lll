"""S3-FE-08 — recibo pagado, aviso de cobro futuro o pago fallido.

Un recibo dice «te cobramos»; un aviso, «te vamos a cobrar»; un fallo, «no
pudimos cobrarte». Mezclarlos inventaría un cobro que no ocurrió, o lo
contaría dos veces cuando después llegue el recibo del aviso. Este módulo
decide cuál es, con la evidencia del propio mensaje, y **cuando no está
seguro lo dice**. No guarda nada.

Los tipos son los del contrato de candidatos (S3-FE-01, `TipoMensaje`):
`cobro_realizado`, `aviso_de_cobro`, `pago_fallido`. Un mensaje incierto no
tiene tipo (`tipo=None`): queda para revisión.

── La evidencia ────────────────────────────────────────────────────────────
Frases, en español y en inglés, comparadas como palabras enteras sobre el
texto sin tildes y en minúsculas: «recibo» no calza dentro de «recibirás».

── El asunto pesa más que el cuerpo ────────────────────────────────────────
Un recibo suele decir abajo «tu próximo cobro será el 1 de noviembre», y un
aviso puede decir «te enviaremos el recibo cuando se cobre». Si el cuerpo
decidiera solo, el primero sería un aviso y el segundo un recibo. El asunto
es lo que el remitente eligió para decir de qué se trata, así que:

1. Si el asunto trae evidencia de **un solo** tipo, ese manda… salvo que el
   cuerpo diga que el pago falló y el asunto diga que se cobró: eso es una
   contradicción y queda incierto.
2. Si el asunto no decide, decide el cuerpo:
   - un solo tipo → ese;
   - fallo + aviso («no pudimos cobrar, lo intentaremos el 5») → fallo;
   - cobro + aviso, o cobro + fallo → **incierto**;
   - nada → incierto.

La regla de fondo es la del criterio de la tarjeta: **un aviso o un fallo no
puede salir como cobro realizado**. Ante la duda entre «se cobró» y otra
cosa, se responde incierto, nunca «se cobró».
"""

from __future__ import annotations

import dataclasses
import re
import unicodedata

from .lectura_correo import MensajeCorreo

COBRO_REALIZADO = "cobro_realizado"
AVISO_DE_COBRO = "aviso_de_cobro"
PAGO_FALLIDO = "pago_fallido"

#: No es un tipo del contrato: es la MENCIÓN del próximo ciclo («tu próximo
#: cobro será el 1 de noviembre», «renews on»). Un recibo la trae casi
#: siempre, así que junto a un cobro realizado no lo contradice. Sola, sí es
#: un aviso.
_PROXIMO_CICLO = "proximo_ciclo"

#: La evidencia de cada tipo. Sin tildes y en minúsculas, como se compara.
EVIDENCIA: dict[str, tuple[str, ...]] = {
    PAGO_FALLIDO: (
        "pago rechazado", "pago fallido", "fue rechazado", "fue rechazada", "pago no procesado", "cobro rechazado", "tarjeta rechazada",
        "no pudimos procesar", "no pudimos cobrar", "no pudimos realizar el cobro", "no hemos podido cobrar",
        "no hemos podido procesar", "no se pudo procesar", "no se pudo realizar el cobro", "problema con tu pago",
        "problema con el pago", "fallo en el pago", "payment failed", "payment declined", "payment was declined",
        "card was declined", "card declined", "unable to process your payment", "we couldn't process",
        "we could not process", "we were unable to charge", "unsuccessful payment", "payment unsuccessful",
        "problem with your payment",
    ),
    # Un cobro que TODAVÍA no ocurre, anunciado.
    AVISO_DE_COBRO: (
        "se cobrara", "te cobraremos", "vamos a cobrar", "realizaremos el cobro", "se realizara el cobro",
        "tu prueba gratuita termina", "tu periodo de prueba termina", "recordatorio de pago",
        "recordatorio de renovacion", "upcoming payment", "upcoming charge", "upcoming renewal",
        "will be charged", "your trial ends", "trial ending", "payment reminder", "renewal reminder",
    ),
    _PROXIMO_CICLO: (
        "proximo cobro", "proximo pago", "proxima renovacion", "proxima factura", "se renovara",
        "will renew", "renews on", "will be renewed", "next billing date", "next payment",
    ),
    COBRO_REALIZADO: (
        "recibo", "comprobante de pago", "pago recibido", "pago confirmado", "pago exitoso", "pago realizado",
        "hemos recibido tu pago", "recibimos tu pago", "gracias por tu pago", "cobro realizado",
        "se ha cobrado", "hemos cobrado", "te cobramos", "pagaste", "factura pagada", "receipt",
        "payment received", "payment confirmation", "payment successful", "thanks for your payment",
        "thank you for your payment", "you paid", "has been charged", "was charged", "we charged",
        "your invoice has been paid", "invoice paid",
    ),
}

_ORDEN = (PAGO_FALLIDO, AVISO_DE_COBRO, _PROXIMO_CICLO, COBRO_REALIZADO)
_PATRONES = {
    tipo: re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(f) for f in frases) + r")(?![a-z0-9])")
    for tipo, frases in EVIDENCIA.items()
}


@dataclasses.dataclass(frozen=True)
class Clasificacion:
    #: Uno de los tres tipos, o `None` si quedó incierto.
    tipo: str | None
    motivo: str
    #: Las frases que se encontraron, por tipo y dónde: para explicar la
    #: decisión y para la evidencia del candidato (S3-FE-09).
    evidencia: tuple[str, ...] = ()

    @property
    def incierto(self) -> bool:
        return self.tipo is None


def _comparable(texto: str) -> str:
    sin_tildes = "".join(c for c in unicodedata.normalize("NFKD", texto or "") if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sin_tildes.lower())


#: No es un tipo: una frase de cobro hecho que el contexto NIEGA o deja en
#: condicional («Aún no hemos recibido tu pago», «Te enviaremos el recibo
#: cuando pagues»). No acredita un pago. Lo encontró la revisión de #185.
_COBRO_NO_ACREDITADO = "cobro_no_acreditado"

#: Lo que, ANTES de la frase y en la misma oración, la niega.
_NEGACION = re.compile(
    r"(?<![a-z0-9])(?:no|nunca|jamas|sin|aun no|todavia no|not|never|"
    r"haven't|havent|hasn't|hasnt|didn't|didnt|don't|dont|won't|wont)(?![a-z0-9])"
)
#: Lo que, en cualquier parte de la misma oración, la deja en futuro o en
#: condicional: el pago o el recibo todavía no existen.
_FUTURO_O_CONDICIONAL = re.compile(
    r"(?<![a-z0-9])(?:cuando|si|una vez que|apenas|enviaremos|te enviaremos|recibiras|recibira|"
    r"llegara|estara|estaran|podras|pendiente|en espera|when|if|once|will|we'll|would|pending|"
    r"as soon as|after you)(?![a-z0-9])"
)
#: Dónde termina una oración. La coma no: «Gracias por tu pago, tu próximo
#: cobro será…» es la misma idea, y cortarla ahí no cambia nada aquí.
_FIN_DE_ORACION = re.compile(r"[.!?;\n]")


def _oracion(comparable: str, inicio: int, fin: int) -> tuple[str, str]:
    """(lo que va antes de la frase, la oración entera), dentro de su oración."""
    desde = max((m.end() for m in _FIN_DE_ORACION.finditer(comparable, 0, inicio)), default=0)
    hasta_m = _FIN_DE_ORACION.search(comparable, fin)
    hasta = hasta_m.start() if hasta_m else len(comparable)
    return comparable[desde:inicio], comparable[desde:hasta]


def _no_acredita(comparable: str, inicio: int, fin: int) -> bool:
    """¿La frase de cobro hecho está negada antes, o en futuro o condicional
    en su oración? Una negación DESPUÉS no cuenta: «Recibo no. 123» es un
    número de recibo, no un «no»."""
    antes, oracion = _oracion(comparable, inicio, fin)
    return bool(_NEGACION.search(antes) or _FUTURO_O_CONDICIONAL.search(oracion))


def _encontrado(texto: str) -> dict[str, list[str]]:
    comparable = _comparable(texto)
    hallado: dict[str, set[str]] = {}
    for tipo in _ORDEN:
        for m in _PATRONES[tipo].finditer(comparable):
            clave = tipo
            if tipo == COBRO_REALIZADO and _no_acredita(comparable, m.start(), m.end()):
                clave = _COBRO_NO_ACREDITADO
            hallado.setdefault(clave, set()).add(m.group(0))
    return {tipo: sorted(frases) for tipo, frases in hallado.items()}


def _evidencia(donde: str, hallado: dict[str, list[str]]) -> list[str]:
    return [f"{donde}: {tipo}: {frase}" for tipo in (*_ORDEN, _COBRO_NO_ACREDITADO) for frase in hallado.get(tipo, [])]


def _decidir(tipos: set[str]) -> tuple[str | None, str]:
    """El tipo para un conjunto de evidencias, con las reglas del módulo."""
    if COBRO_REALIZADO in tipos:
        if _COBRO_NO_ACREDITADO in tipos:
            return None, "dice que se pagó y, en otra parte, que no o que todavía no; queda para revisión"
        if PAGO_FALLIDO in tipos:
            return None, "habla de un cobro hecho y de un pago fallido; queda para revisión"
        if AVISO_DE_COBRO in tipos:
            return None, "habla de un cobro hecho y de un cobro que todavía no ocurre; queda para revisión"
        return COBRO_REALIZADO, "habla de un cobro hecho" + (
            " (y menciona el próximo ciclo, como todo recibo)" if _PROXIMO_CICLO in tipos else "")
    if PAGO_FALLIDO in tipos:
        return PAGO_FALLIDO, "el pago falló" + ("; lo que viene es un nuevo intento" if len(tipos) > 1 else "")
    if AVISO_DE_COBRO in tipos or _PROXIMO_CICLO in tipos:
        return AVISO_DE_COBRO, "anuncia un cobro que todavía no ocurre"
    if _COBRO_NO_ACREDITADO in tipos:
        return None, "habla de un pago que no ocurrió o que todavía no ocurre; queda para revisión"
    return None, "el mensaje no dice si se cobró, se va a cobrar o falló el pago"


def clasificar(mensaje: MensajeCorreo) -> Clasificacion:
    """Recibo pagado, aviso de cobro futuro, pago fallido, o incierto.

    Primero el asunto: si decide un tipo, manda, salvo que el cuerpo lo
    contradiga con un fallo o con un cobro que todavía no ocurre. Si el asunto
    no decide, deciden asunto y cuerpo juntos. Ver la cabecera del módulo.
    """
    en_asunto = _encontrado(mensaje.asunto)
    en_cuerpo = _encontrado(mensaje.texto)
    evidencia = tuple(_evidencia("asunto", en_asunto) + _evidencia("cuerpo", en_cuerpo))

    tipo_asunto, _ = _decidir(set(en_asunto))
    if tipo_asunto == COBRO_REALIZADO:
        contradice = {PAGO_FALLIDO, AVISO_DE_COBRO, _COBRO_NO_ACREDITADO} & set(en_cuerpo)
        if contradice:
            que = (
                "que el pago falló" if PAGO_FALLIDO in contradice
                else "que el cobro todavía no ocurre" if AVISO_DE_COBRO in contradice
                else "que el pago no ocurrió o todavía no"
            )
            return Clasificacion(None, f"el asunto dice que se cobró y el cuerpo, {que}", evidencia)
        return Clasificacion(COBRO_REALIZADO, "lo dice el asunto", evidencia)
    if tipo_asunto is not None:
        return Clasificacion(tipo_asunto, "lo dice el asunto", evidencia)

    tipo, motivo = _decidir(set(en_asunto) | set(en_cuerpo))
    return Clasificacion(tipo, motivo, evidencia)
