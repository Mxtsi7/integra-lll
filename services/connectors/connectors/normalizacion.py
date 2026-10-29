"""Normalizar nombres de proveedores (FE-12).

Lo que llega de un CSV o de un correo nunca dice "Netflix": dice
`NETFLIX.COM 1234 SANTIAGO CL`, `PAYPAL *SPOTIFY AB`, `Disney Plus`,
`APPLE.COM/BILL`. Para detectar un cobro recurrente (FE-09) o leer un correo
(FE-13) hace falta que todas esas variantes apunten al MISMO proveedor, y
que las que no se puedan resolver queden marcadas, no inventadas.

── Las tres salidas posibles ────────────────────────────────────────────────

    reconocido    una variante conocida → el nombre canónico y su categoría
    ambiguo       el texto calza con MÁS de un proveedor (APPLE.COM/BILL puede
                  ser Apple Music, iCloud o Apple TV+) → se devuelven los
                  candidatos y NO se asigna ninguno
    desconocido   no calza con nada → queda el texto limpio y el original

Los tres conservan el **texto original tal cual**: es la trazabilidad mínima
que pide la tarjeta, y lo que permite revisar a mano un "ambiguo" o corregir
el catálogo cuando un "desconocido" era en realidad una variante nueva.

── Por qué un catálogo en código y no en la base ───────────────────────────
El catálogo global de proveedores (`Proveedor`) vive en el esquema de
`subscriptions`, y connectors no consulta el esquema de otro servicio
(ADR-002). Lo que necesita FE-09/FE-13 es una función pura: mismo texto,
misma respuesta, sin base y sin red. Los nombres canónicos de acá coinciden
con los que usa `subscriptions` (seed y catálogo) para que FE-11 pueda
enlazar por nombre al confirmar; si allá se renombra uno, hay que cambiarlo
acá también, y la prueba de "variantes conocidas" lo recuerda.

── Las reglas, en orden ─────────────────────────────────────────────────────
1. Unicode: se quitan las tildes y se pasa a minúsculas (`Música` → `musica`).
2. Se quita el intermediario de pago si viene como prefijo (`PAYPAL *`,
   `DLOCAL *`, `MERCADOPAGO*`): dice por dónde se pagó, no a quién.
3. `+` pasa a ` plus` (Disney+, Paramount+) y los separadores (`* . _ / - , :`)
   a espacios.
4. Se quita el ruido que no identifica a nadie: dominios (`www`, `com`, `cl`),
   formas jurídicas (`inc`, `ltd`, `spa`, `ltda`), países y ciudades
   frecuentes, y los códigos de transacción (tokens con dígitos).
5. Se compara contra los alias del catálogo, **el más largo primero**: así
   `amazon prime video` gana antes de que `amazon` (ambiguo) pueda opinar.

Cada resultado dice qué regla decidió (`regla`), para poder explicar por qué
un texto terminó donde terminó.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

RECONOCIDO = "reconocido"
AMBIGUO = "ambiguo"
DESCONOCIDO = "desconocido"


@dataclass(frozen=True)
class Proveedor:
    """Una entrada del catálogo: nombre canónico, categoría y sus alias."""

    nombre: str
    #: Código del catálogo `CategoriaSuscripcion` de subscriptions.
    categoria: str
    #: Variantes ya normalizadas (minúsculas, sin tildes, sin ruido).
    alias: tuple[str, ...]

    #: Los alias que son palabra común o nombre de persona. Un alias débil
    #: SOLO reconoce si es todo el texto limpio.
    #:
    #: Sin esto, `claude` calzaba en cualquier posición y
    #: `TRANSFERENCIA A CLAUDE PEREZ` quedaba reconocido como Claude (ia),
    #: siendo una transferencia a una persona. Lo mismo con `zoom`, `slack`,
    #: `notion`, `steam`, `valve` y `canva` dentro de glosas de cartola. Lo
    #: encontró la revisión de la PR, y la prueba que había usaba
    #: `JUAN PEREZ`, por eso no lo veía.
    #:
    #: En contexto se reconocen por un alias MÁS LARGO del mismo proveedor
    #: (`claude ai`, `anthropic`, `zoom video`, `steam games`), que gana
    #: antes porque los alias se prueban del más largo al más corto.
    debiles: frozenset[str] = frozenset()


#: El catálogo. Los nombres canónicos coinciden con `subscriptions`.
#: Un alias no puede estar en dos proveedores (lo comprueba una prueba); si
#: una palabra puede ser de varios, va en `AMBIGUOS`, no acá.
PROVEEDORES: tuple[Proveedor, ...] = (
    Proveedor("Netflix", "streaming", ("netflix",)),
    Proveedor("Spotify", "musica", ("spotify", "spotify premium")),
    Proveedor("Disney+", "streaming", ("disney plus", "disneyplus", "disney")),
    Proveedor("HBO Max", "streaming", ("hbo max", "hbomax", "hbo")),
    Proveedor("Amazon Prime Video", "streaming", ("amazon prime video", "prime video", "primevideo", "amazon prime")),
    Proveedor("Paramount+", "streaming", ("paramount plus", "paramountplus", "paramount")),
    Proveedor("Crunchyroll", "streaming", ("crunchyroll",)),
    Proveedor("YouTube Premium", "streaming", ("youtube premium", "youtube", "google youtube")),
    Proveedor("Apple Music", "musica", ("apple music",)),
    Proveedor("Apple TV+", "streaming", ("apple tv plus", "apple tv", "appletv")),
    Proveedor("iCloud", "nube", ("icloud", "icloud plus", "apple icloud")),
    Proveedor("Google One", "nube", ("google one", "google storage")),
    Proveedor("Dropbox", "nube", ("dropbox",)),
    Proveedor("Microsoft 365", "productividad", ("microsoft 365", "office 365", "msft 365", "microsoft office")),
    Proveedor("Adobe Creative Cloud", "productividad", ("adobe creative cloud", "adobe", "adobe systems")),
    Proveedor("Canva", "productividad", ("canva",), frozenset({"canva"})),
    Proveedor("Notion", "productividad", ("notion", "notion labs"), frozenset({"notion"})),
    Proveedor("Xbox Game Pass", "juegos", ("xbox game pass", "xbox", "game pass")),
    Proveedor("PlayStation Plus", "juegos", ("playstation plus", "playstation", "sony playstation", "ps plus")),
    Proveedor("Nintendo Switch Online", "juegos", ("nintendo switch online", "nintendo")),
    Proveedor("Steam", "juegos", ("steam", "steam games", "valve"), frozenset({"steam", "valve"})),
    Proveedor("Duolingo", "educacion", ("duolingo", "duolingo plus", "duolingo super")),
    Proveedor("Coursera", "educacion", ("coursera",)),
    Proveedor("Platzi", "educacion", ("platzi",)),
    Proveedor("ChatGPT", "ia", ("chatgpt", "openai", "chatgpt plus")),
    Proveedor("Claude", "ia", ("claude", "anthropic", "claude ai"), frozenset({"claude"})),
    Proveedor("GitHub", "productividad", ("github", "github copilot")),
    Proveedor("Zoom", "productividad", ("zoom", "zoom video"), frozenset({"zoom"})),
    Proveedor("Slack", "productividad", ("slack", "slack technologies"), frozenset({"slack"})),
)

#: Palabras que calzan con MÁS de un proveedor. Un cobro que diga solo esto
#: no se asigna: se devuelven los candidatos y queda para revisión. Es el
#: criterio "no fusionar proveedores ambiguos automáticamente".
AMBIGUOS: dict[str, tuple[str, ...]] = {
    "apple": ("Apple Music", "Apple TV+", "iCloud"),
    "itunes": ("Apple Music", "Apple TV+", "iCloud"),
    "amazon": ("Amazon Prime Video", "Amazon"),
    "google": ("Google One", "YouTube Premium", "Google Play"),
    "google play": ("Google One", "YouTube Premium", "Google Play"),
    "microsoft": ("Microsoft 365", "Xbox Game Pass"),
    "sony": ("PlayStation Plus", "Sony"),
}

#: Intermediarios de pago que vienen como prefijo. Dicen por dónde se pagó,
#: no a quién: `PAYPAL *SPOTIFY` es Spotify.
INTERMEDIARIOS = ("paypal", "pp", "dlocal", "dl", "mercadopago", "mercado pago", "mp", "webpay", "transbank", "stripe", "sumup", "flow")

#: Tokens que no identifican a nadie. Se quitan ANTES de comparar.
RUIDO = frozenset({
    # dominios y web
    "www", "com", "net", "org", "cl", "es", "co", "io", "http", "https",
    # formas jurídicas
    "inc", "ltd", "llc", "spa", "ltda", "sa", "s", "a", "ab", "gmbh", "bv", "co",
    # `pty` faltaba y se notó al marcar `canva` como alias débil: "Canva Pty
    # Ltd" dejaba de reconocerse porque el texto limpio no quedaba en solo
    # "canva". Es un sufijo societario como los de arriba.
    "pty",
    # países, ciudades y regiones que aparecen en las cartolas
    "chile", "santiago", "stgo", "usa", "us", "eeuu", "uk", "gb", "ie", "irlanda", "nl", "lu",
    "luxembourg", "sg", "singapore", "ca", "mx", "br", "ar", "pe", "internacional", "international",
    # palabras de cartola
    "compra", "pago", "cobro", "cargo", "suscripcion", "subscription", "mensual", "monthly",
    "recurrente", "recurring", "bill", "billing", "pagos", "servicio",
    # monedas
    "clp", "usd", "eur", "dolares", "dolar", "pesos",
})

_SEPARADORES = re.compile(r"[*._/\-,:;()\[\]'\"#|]+")
_ESPACIOS = re.compile(r"\s+")
_INTERMEDIARIO = re.compile(
    r"^(?P<nombre>" + "|".join(
        re.escape(n) for n in sorted(INTERMEDIARIOS, key=len, reverse=True)
    ) + r")(?:\s*[*\-:]\s*|\s+|$)"
)


#: Los números que SÍ son parte de un nombre: los que aparecen en algún alias
#: ("365" de Microsoft 365). Cualquier otro token con dígitos es un código.
NUMEROS_CON_NOMBRE = frozenset(
    tok for p in PROVEEDORES for a in p.alias for tok in a.split() if tok.isdigit()
)


def _es_codigo(token: str) -> bool:
    """Un id de transacción, una fecha, los últimos dígitos de la tarjeta.

    Todo lo que tenga dígitos se quita (`p1a2b3c4`, `1234`, `28`, `2026`),
    salvo los números que forman parte de un nombre del catálogo: `365` es
    "Microsoft 365", no un código.
    """
    if not any(c.isdigit() for c in token):
        return False
    return token not in NUMEROS_CON_NOMBRE


@dataclass(frozen=True)
class Normalizacion:
    """El resultado. `original` se conserva siempre, tal cual llegó."""

    original: str
    limpio: str
    resultado: str
    proveedor: str | None
    categoria: str | None
    candidatos: tuple[str, ...]
    regla: str

    @property
    def reconocido(self) -> bool:
        return self.resultado == RECONOCIDO

    @property
    def para_revision(self) -> bool:
        """Lo que FE-09/FE-13 tienen que mostrar sin asignar: ambiguos y desconocidos."""
        return self.resultado != RECONOCIDO


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )


def _quitar_intermediario(texto: str) -> tuple[str, str | None]:
    """Si el texto empieza con un intermediario de pago, lo quita.

    Devuelve (resto, intermediario). El separador puede ser `*`, espacio, `-`
    o `:`; `PAYPAL *SPOTIFY`, `PP*NETFLIX` y `DLOCAL -CANVA` se tratan igual.
    """
    # Tiene que haber separador, espacio o fin después del nombre: "ppal" no
    # es "pp" + "al", ni "flowers" es "flow" + "ers".
    m = _INTERMEDIARIO.match(texto)
    if m:
        return texto[m.end():], m.group("nombre")
    return texto, None


def limpiar(texto: str) -> str:
    """Las reglas 1 a 4: deja el texto listo para comparar contra los alias.

    Es la parte reproducible: mismo texto, mismo resultado, sin estado.
    """
    t = _sin_tildes(texto or "").casefold().strip()
    t, _ = _quitar_intermediario(t)
    t = t.replace("+", " plus")
    t = _SEPARADORES.sub(" ", t)
    tokens = [
        tok for tok in _ESPACIOS.split(t)
        if tok and tok not in RUIDO and not _es_codigo(tok)
    ]
    return " ".join(tokens)


def _alias_ordenados() -> list[tuple[str, "Proveedor | None", bool]]:
    """Todos los alias, del más largo al más corto, con si son débiles.

    Del más largo al más corto importa: así `claude ai` y `anthropic` deciden
    antes de que el débil `claude` alcance a opinar, y `apple music` antes que
    el ambiguo `apple`.
    """
    salida: list[tuple[str, Proveedor | None, bool]] = []
    for p in PROVEEDORES:
        salida.extend((a, p, a in p.debiles) for a in p.alias)
    salida.extend((a, None, False) for a in AMBIGUOS)
    return sorted(salida, key=lambda trio: (-len(trio[0]), trio[0]))


def _calza(alias: str, limpio: str) -> bool:
    """El alias aparece en el texto como frase COMPLETA, donde sea.

    "netflix" calza con "netflix", "netflix premium" y "compra netflix", no
    con "netflixx". Y como se prueba del alias más largo al más corto,
    "apple music" decide antes de que "apple" (ambiguo) alcance a opinar en
    `APPLE.COM/BILL APPLE MUSIC`.
    """
    return re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", limpio) is not None


#: Palabras que delatan una transferencia entre personas, no un cobro de un
#: servicio. Si aparecen, el texto NO asigna proveedor aunque adentro haya un
#: alias: `TRANSFERENCIA A CLAUDE PEREZ` es plata a una persona que se llama
#: Claude, no una suscripción a Claude.
#:
#: Van acá y no en RUIDO a propósito: en RUIDO se borrarían antes de poder
#: mirarlas, y lo que hacen falta es justamente que se vean.
MARCAS_DE_TRANSFERENCIA = frozenset({
    "transferencia", "transferencias", "transf", "tef", "traspaso", "traspasos",
})


def _es_transferencia(limpio: str) -> bool:
    return any(t in MARCAS_DE_TRANSFERENCIA for t in limpio.split())


def normalizar(texto: str) -> Normalizacion:
    """Resuelve un nombre tal como viene de un CSV o un correo.

    Nunca lanza: un texto vacío o puro ruido es `desconocido`, no un error.
    """
    original = texto if texto is not None else ""
    limpio = limpiar(original)
    if not limpio:
        return Normalizacion(
            original=original, limpio="", resultado=DESCONOCIDO, proveedor=None,
            categoria=None, candidatos=(), regla="sin texto util",
        )

    if _es_transferencia(limpio):
        # Antes de mirar alias: una transferencia entre personas no asigna
        # proveedor ni aunque el nombre de la persona sea el de una marca.
        return Normalizacion(
            original=original, limpio=limpio, resultado=DESCONOCIDO, proveedor=None,
            categoria=None, candidatos=(),
            regla="parece una transferencia entre personas",
        )

    for alias, proveedor, debil in _alias_ordenados():
        if not _calza(alias, limpio):
            continue
        if debil and limpio != alias:
            # Un alias débil es palabra común o nombre de persona: solo
            # reconoce si es TODO el texto. En contexto decide un alias más
            # largo del mismo proveedor, que ya se probó antes que este.
            return Normalizacion(
                original=original, limpio=limpio, resultado=DESCONOCIDO,
                proveedor=None, categoria=None, candidatos=(),
                regla=f"'{alias}' es un alias debil y no viene solo; queda para revision",
            )
        if proveedor is None:
            return Normalizacion(
                original=original, limpio=limpio, resultado=AMBIGUO, proveedor=None,
                categoria=None, candidatos=AMBIGUOS[alias],
                regla=f"'{alias}' puede ser varios; queda para revision",
            )
        return Normalizacion(
            original=original, limpio=limpio, resultado=RECONOCIDO,
            proveedor=proveedor.nombre, categoria=proveedor.categoria,
            candidatos=(), regla=f"alias '{alias}'",
        )

    return Normalizacion(
        original=original, limpio=limpio, resultado=DESCONOCIDO, proveedor=None,
        categoria=None, candidatos=(), regla="ningun alias del catalogo",
    )


def nombres_canonicos() -> tuple[str, ...]:
    """Los nombres que esto puede devolver. Para que FE-11 y las pruebas de
    `subscriptions` comprueben que el catálogo de allá los conoce."""
    return tuple(p.nombre for p in PROVEEDORES)
