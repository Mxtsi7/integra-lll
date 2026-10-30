"""Desconectar una cuenta y revocar el acceso en el proveedor (FE-05).

Está aparte de las vistas porque lo usan dos caminos: el `DELETE` que pide el
usuario, y el reintento (`manage.py reintentar_revocaciones`) para las que
quedaron sin confirmar.

── Las dos cosas que pasan al desconectar, y son distintas ──────────────────
**1. Dejar de leer** — es inmediato y depende solo de nosotros: la cuenta pasa
a `desconectada` y sale de la selección que usa la lectura de correo (FE-13).

**2. Revocar en el proveedor** — depende de que el proveedor conteste. Puede
fallar por una caída pasajera, y Microsoft directamente no publica endpoint de
revocación por token.

    confirmada      → se borran los tokens y se escribe `revocado_en`
    no confirmada   → los tokens se CONSERVAN cifrados para reintentar, la
                      cuenta igual queda desconectada, y `revocado_en` sigue
                      en NULL
    no soportada    → el proveedor no ofrece revocación (Outlook). No se llama
                      al proveedor, no se escribe `revocado_en` y las
                      credenciales se conservan hasta el borrado final de la
                      limpieza. No es un fallo reintentable.

`revocado_en` es la evidencia que consume la limpieza coordinada de #72. Que
no haya tokens guardados **no** demuestra que el acceso se haya revocado del
otro lado.

── Tres cosas que la revisión de la PR encontró, y por qué están así ────────

**La evidencia es de una CONCESIÓN, no de la cuenta.** Hablar con el proveedor
toma tiempo, y en ese rato un callback puede dejar credenciales nuevas. La
versión anterior guardaba sobre la instancia que había leído: borraba los
tokens nuevos y escribía `revocado_en` como si los hubiera revocado, cuando
revocó los viejos. Ahora la escritura es **condicional a que la versión no
haya cambiado**; si cambió, no se toca nada.

**Un secreto ilegible NO es un secreto ausente.** Si la clave de cifrado no
está disponible, `CampoCifrado` devuelve `SECRETO_ILEGIBLE`. Tratar eso como
"no había token" llevaba a escribir ambos campos a NULL, **destruyendo un
ciphertext que se recuperaba restaurando la clave**, y de paso la sacaba del
conjunto de reintentos. Ahora se distingue y no se borra nada.

**Reconectar invalida la evidencia anterior.** Ver `credenciales_version` en
el modelo.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from shared.cifrado import SECRETO_ILEGIBLE

from . import proveedores
from .models import CuentaConectada


#: Situación de las credenciales guardadas. Las tres son distintas y antes se
#: confundían dos de ellas.
HAY = "hay"            # hay un token legible con que pedir la revocación
NINGUNA = "ninguna"    # no hay credenciales: no hay nada que revocar
ILEGIBLE = "ilegible"  # las hay, pero no se pueden descifrar ahora


@dataclass(frozen=True)
class Resultado:
    """Qué pasó al intentar desconectar."""

    confirmada: bool
    #: True si no había nada que revocar (una cuenta CSV, o sin tokens).
    sin_nada_que_revocar: bool
    #: True si había credenciales pero no se pudieron descifrar. NO se borran.
    ilegible: bool
    #: True si alguien reconectó mientras hablábamos con el proveedor, así que
    #: lo revocado fue la concesión anterior y no se tocó la nueva.
    reconectada_mientras_tanto: bool
    detalle: str
    #: True si el proveedor no ofrece revocación. Es una limitación permanente,
    #: no un fallo: no se reintenta y no se escribe `revocado_en`.
    no_soportada: bool = False
    #: True si la fila desapareció mientras hablábamos con el proveedor (la
    #: limpieza de la organización la borró). No se escribió nada.
    ya_no_existe: bool = False


def _credenciales_para_revocar(cuenta: CuentaConectada) -> tuple[str, str]:
    """(token, situación). Se prefiere el de REFRESCO.

    ── Por qué el de refresco primero ───────────────────────────────────────
    La versión anterior mandaba primero el de acceso. Google lo emite por una
    hora y Connectors no lo refresca nunca, así que en cualquier cuenta
    conectada hace más de una hora el de acceso ya está vencido, Google
    responde `400 invalid_token` y la revocación no se confirmaba jamás. Con
    eso, la limpieza de MX-07 quedaba en 409 para siempre. Lo encontró la
    revisión de #72.

    El de refresco no vence en una hora y revocarlo revoca la concesión
    completa, que es lo que se quiere. Si no hay (o no se puede descifrar),
    se cae al de acceso.
    """
    ilegible = False
    for token in (cuenta.refresh_token, cuenta.access_token):
        if token is SECRETO_ILEGIBLE:
            ilegible = True
            continue
        if token:
            return str(token), HAY
    return "", (ILEGIBLE if ilegible else NINGUNA)


def _releer(cuenta: CuentaConectada) -> bool:
    """`refresh_from_db`, pero sin reventar si la fila ya no existe.

    Desde MX-07 las filas se borran (la limpieza de la organización). Si eso
    pasa mientras se habla con el proveedor, el UPDATE condicional afecta 0
    filas y releer lanzaba `DoesNotExist`, que tumbaba `reintentar_revocaciones`
    entero y dejaba sin procesar las pendientes de las demás organizaciones.
    """
    try:
        cuenta.refresh_from_db()
    except CuentaConectada.DoesNotExist:
        return False
    return True


def revocar_y_desconectar(cuenta: CuentaConectada) -> Resultado:
    """Intenta revocar y deja la cuenta desconectada pase lo que pase.

    Nunca lanza por culpa del proveedor: desconectar es lo que el usuario
    pidió y de eso nos encargamos nosotros. Lo que el proveedor conteste
    decide si además se puede dar por revocado.
    """
    version = cuenta.credenciales_version
    if not proveedores.soporta_revocacion(cuenta.proveedor):
        # Outlook: no hay mecanismo que confirmar. Se desconecta localmente,
        # no se inventa `revocado_en` y no se destruyen las credenciales: la
        # limpieza las borra con la fila, después de validar todo lo demás.
        detalle = (
            "Desconectada por el usuario; el proveedor no ofrece revocación "
            "de acceso. Las credenciales se conservan cifradas hasta la "
            "limpieza final."
        )
        with transaction.atomic():
            cambiadas = CuentaConectada.objects.filter(
                pk=cuenta.pk, credenciales_version=version
            ).update(
                estado=CuentaConectada.Estado.DESCONECTADA,
                detalle_del_estado=detalle[:200],
                actualizado_en=timezone.now(),
            )
        existe = _releer(cuenta)
        return Resultado(
            confirmada=False,
            sin_nada_que_revocar=False,
            ilegible=False,
            reconectada_mientras_tanto=not cambiadas and existe,
            detalle=detalle,
            no_soportada=True,
            ya_no_existe=not existe,
        )

    token, situacion = _credenciales_para_revocar(cuenta)

    if situacion == ILEGIBLE:
        # No se puede pedir la revocación sin el token, y borrarlo destruiría
        # un ciphertext recuperable. Se deja desconectada —eso sí depende de
        # nosotros— y la revocación queda pendiente.
        detalle = (
            "Desconectada por el usuario; las credenciales no se pudieron "
            "descifrar con las claves vigentes. Se conservan cifradas: "
            "restaurando la clave se puede completar la revocación."
        )
        cambiadas = CuentaConectada.objects.filter(
            pk=cuenta.pk, credenciales_version=version
        ).update(
            estado=CuentaConectada.Estado.DESCONECTADA,
            detalle_del_estado=detalle[:200],
            actualizado_en=timezone.now(),
        )
        existe = _releer(cuenta)
        return Resultado(
            confirmada=False,
            sin_nada_que_revocar=False,
            ilegible=True,
            reconectada_mientras_tanto=not cambiadas and existe,
            detalle=detalle,
            ya_no_existe=not existe,
        )

    confirmada = False
    token_invalido = False
    sin_nada = situacion == NINGUNA
    if situacion == HAY:
        try:
            respuesta = proveedores.revocar(cuenta.proveedor, access_token=token)
        except proveedores.ProveedorNoSoportado:
            # Una cuenta CSV no tiene nada que revocar: no hubo OAuth.
            sin_nada = True
            confirmada = False
        else:
            if respuesta is proveedores.TOKEN_INVALIDO:
                # Rechazar una credencial no acredita la revocación de toda
                # la autorización. Se conserva la misma versión pendiente.
                token_invalido = True
            else:
                confirmada = bool(respuesta)

    if sin_nada:
        detalle = (
            "Desconectada por el usuario; este proveedor no usa OAuth."
            if situacion == HAY
            else "Desconectada por el usuario; no había token que revocar."
        )
    elif confirmada:
        detalle = "Desconectada por el usuario; el proveedor confirmó la revocación."
    elif token_invalido:
        detalle = (
            "Desconectada por el usuario; el proveedor rechazó el token. "
            "Eso no acredita la revocación de la autorización completa. "
            "Se conservan las credenciales cifradas para reintentar."
        )
    else:
        # Importa que quede escrito: el acceso podría seguir vivo del lado del
        # proveedor hasta que expire solo.
        detalle = (
            "Desconectada por el usuario; el proveedor no confirmó la "
            "revocación. El token se conserva cifrado para reintentar."
        )

    valores = {
        "estado": CuentaConectada.Estado.DESCONECTADA,
        "detalle_del_estado": detalle[:200],
        "actualizado_en": timezone.now(),
    }
    if confirmada or sin_nada:
        # Ya no hace falta reintentar: se borran las credenciales.
        valores.update(access_token=None, refresh_token=None, token_expira_en=None)
    if confirmada:
        # La evidencia que consume #72. Solo acá: ni cuando no hay nada que
        # revocar, porque entonces no hay nada que acreditar.
        valores["revocado_en"] = timezone.now()

    with transaction.atomic():
        # ── La escritura es condicional a la versión ────────────────────────
        # Si alguien reconectó mientras hablábamos con el proveedor, lo que se
        # revocó fue la concesión ANTERIOR. Borrar los tokens nuevos o
        # acreditar su revocación sería mentir, así que no se escribe nada.
        cambiadas = CuentaConectada.objects.filter(
            pk=cuenta.pk, credenciales_version=version
        ).update(**valores)

    existe = _releer(cuenta)
    return Resultado(
        confirmada=confirmada and bool(cambiadas),
        sin_nada_que_revocar=sin_nada,
        ilegible=False,
        reconectada_mientras_tanto=not cambiadas and existe,
        detalle=detalle,
        ya_no_existe=not existe,
    )


def reintentar_pendiente(pendiente: CuentaConectada) -> Resultado | None:
    """Reintenta UNA revocación pendiente. None = ya no corresponde; no se tocó nada.

    `pendiente` es la fila tal como se SELECCIONÓ, y su `credenciales_version`
    identifica qué concesión se iba a revocar. Eso es lo que hay que
    conservar: el trabajo pendiente es "revocar la versión N", no "revocar lo
    que tenga la cuenta cuando le toque".

    ── La carrera que esto cierra ──────────────────────────────────────────
    La versión anterior del comando releía la cuenta por pk y solo la
    descartaba si ya no existía o tenía `revocado_en`. Si alguien reconectaba
    ENTRE seleccionar las pendientes y releer, la relectura la encontraba
    conectada, con versión nueva y `revocado_en` en NULL: pasaba la guarda, y
    `revocar_y_desconectar` recibía justamente la concesión nueva. Su
    escritura condicional calzaba con esa versión nueva y terminaba
    revocándola y desconectándola. Lo reprodujo la revisión de la PR: el
    proveedor recibía el token NUEVO.

    La escritura condicional protege una reconexión que ocurra DESPUÉS de
    leer, mientras se habla con el proveedor. No protege una que ocurra
    antes. Para esa hay que comparar contra lo que se seleccionó, y por eso
    la comprobación es sobre la versión del trabajo pendiente y va ANTES de
    cualquier llamada externa.

    Se omite, sin tocar las credenciales actuales, si la cuenta:
      · ya no existe,
      · cambió de versión (alguien reconectó),
      · ya no está desconectada,
      · ya tiene evidencia de revocación,
      · o su proveedor no ofrece revocación (Outlook).
    """
    actual = CuentaConectada.objects.filter(pk=pendiente.pk).first()
    if actual is None:
        return None
    if actual.credenciales_version != pendiente.credenciales_version:
        return None
    if actual.estado != CuentaConectada.Estado.DESCONECTADA:
        return None
    if actual.revocado_en is not None:
        return None
    try:
        proveedores.configuracion_de(actual.proveedor)
    except proveedores.ProveedorNoSoportado:
        # Sin configuración OAuth no hay nada que reintentar ni credenciales
        # que destruir en este camino.
        return None
    if not proveedores.soporta_revocacion(actual.proveedor):
        # Outlook: no hay nada que reintentar. La limpieza lo trata como
        # limitación conocida y borra sus credenciales con la fila.
        return None
    # Desde acá, `revocar_y_desconectar` lee el token de `actual` (la misma
    # versión que se seleccionó) y su escritura condicional cubre lo que
    # pase mientras se habla con el proveedor.
    return revocar_y_desconectar(actual)


def registrar_credenciales_nuevas(cuenta: CuentaConectada) -> None:
    """Sube la versión e invalida la evidencia de revocación anterior.

    Lo llama el callback de OAuth después de guardar tokens nuevos. Sin esto,
    una cuenta revocada y reconectada conservaba la fecha de la revocación
    vieja, `pendientes_de_revocar()` la excluía por tener `revocado_en`, y la
    limpieza de #72 habría tomado esa fecha como prueba de que las
    credenciales NUEVAS estaban revocadas.
    """
    CuentaConectada.objects.filter(pk=cuenta.pk).update(
        credenciales_version=F("credenciales_version") + 1,
        revocado_en=None,
        actualizado_en=timezone.now(),
    )
    cuenta.refresh_from_db()


def pendientes_de_revocar(organizacion_id=None):
    """Las cuentas desconectadas que el proveedor nunca confirmó.

    Son las que todavía conservan credenciales: si no las tuvieran, no habría
    con qué reintentar. Incluye las ilegibles a propósito — son exactamente
    las que hay que reintentar cuando vuelva la clave de cifrado.

    Excluye a los proveedores que declararon no ofrecer revocación (Outlook):
    no es un pendiente reintentable. Sus credenciales se destruyen con la fila
    en el borrado final de la limpieza, no se reintentan para siempre.

    Devuelve un queryset y no una lista: el comando lo recorre y vuelve a leer
    cada cuenta antes de cada intento, porque una lista materializada queda
    vieja apenas alguien reconecta.
    """
    qs = CuentaConectada.objects.filter(
        estado=CuentaConectada.Estado.DESCONECTADA,
        revocado_en__isnull=True,
    ).exclude(access_token__isnull=True, refresh_token__isnull=True)
    sin_revocacion = proveedores.proveedores_sin_revocacion()
    if sin_revocacion:
        qs = qs.exclude(proveedor__in=sin_revocacion)
    if organizacion_id is not None:
        qs = qs.filter(organizacion_id=organizacion_id)
    return qs
