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

La versión anterior mezclaba las dos: borraba los tokens pasara lo que pasara.
Eso tenía dos consecuencias malas que encontró la revisión de la PR:

· **Se perdía la única credencial para reintentar.** Si el proveedor no
  contestaba, no quedaba con qué volver a pedirlo: la revocación se volvía
  imposible, no solo pendiente.
· **Con `access_token` vacío y `refresh_token` vivo ni siquiera se intentaba**,
  y el refresh se borraba igual. Google revoca con cualquiera de los dos.

Ahora:

    confirmada      → se borran los tokens y se escribe `revocado_en`
    no confirmada   → los tokens se CONSERVAN cifrados para reintentar, la
                      cuenta igual queda desconectada, y `revocado_en` sigue
                      en NULL

`revocado_en` es la evidencia que consume la limpieza coordinada de #72. Que
no haya tokens guardados **no** demuestra que el acceso se haya revocado del
otro lado.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from shared.cifrado import SECRETO_ILEGIBLE

from . import proveedores
from .models import CuentaConectada


@dataclass(frozen=True)
class Resultado:
    """Qué pasó al intentar desconectar."""

    confirmada: bool
    #: True si no había nada que revocar (una cuenta CSV, o sin tokens).
    sin_nada_que_revocar: bool
    detalle: str


def _token_para_revocar(cuenta: CuentaConectada) -> str:
    """El token con que pedirle al proveedor que revoque.

    Se prefiere el de acceso y se cae al de refresco. Google acepta
    cualquiera de los dos y revoca la concesión completa; mirar solo el de
    acceso dejaba sin intentar a las cuentas cuyo access ya había vencido,
    que son justamente las más viejas.

    Un secreto ilegible (cifrado con una clave que ya no está) no sirve para
    hablar con el proveedor: se trata como si no hubiera token.
    """
    for token in (cuenta.access_token, cuenta.refresh_token):
        if token and token is not SECRETO_ILEGIBLE:
            return str(token)
    return ""


def revocar_y_desconectar(cuenta: CuentaConectada) -> Resultado:
    """Intenta revocar y deja la cuenta desconectada pase lo que pase.

    Nunca lanza por culpa del proveedor: desconectar es lo que el usuario
    pidió y de eso nos encargamos nosotros. Lo que el proveedor conteste
    decide si además se puede dar por revocado.
    """
    token = _token_para_revocar(cuenta)

    confirmada = False
    sin_nada = False
    if not token:
        sin_nada = True
        detalle = "Desconectada por el usuario; no había token que revocar."
    else:
        try:
            confirmada = proveedores.revocar(cuenta.proveedor, access_token=token)
        except proveedores.ProveedorNoSoportado:
            # Una cuenta CSV no tiene nada que revocar: no hubo OAuth.
            sin_nada = True
            confirmada = False

        if sin_nada:
            detalle = "Desconectada por el usuario; este proveedor no usa OAuth."
        elif confirmada:
            detalle = (
                "Desconectada por el usuario; el proveedor confirmó la revocación."
            )
        else:
            # Importa que quede escrito: el acceso podría seguir vivo del lado
            # del proveedor hasta que expire solo.
            detalle = (
                "Desconectada por el usuario; el proveedor no confirmó la "
                "revocación. El token se conserva cifrado para reintentar."
            )

    campos = ["estado", "detalle_del_estado", "actualizado_en"]
    with transaction.atomic():
        cuenta.estado = CuentaConectada.Estado.DESCONECTADA
        cuenta.detalle_del_estado = detalle[:200]

        if confirmada or sin_nada:
            # Ya no hace falta reintentar: se borran las credenciales.
            cuenta.access_token = None
            cuenta.refresh_token = None
            cuenta.token_expira_en = None
            campos += ["access_token", "refresh_token", "token_expira_en"]

        if confirmada:
            # La evidencia que consume #72. Solo acá: ni cuando no hay nada
            # que revocar, porque entonces no hay nada que acreditar.
            cuenta.revocado_en = timezone.now()
            campos.append("revocado_en")

        cuenta.save(update_fields=campos)

    return Resultado(confirmada=confirmada, sin_nada_que_revocar=sin_nada, detalle=detalle)


def pendientes_de_revocar(organizacion_id=None):
    """Las cuentas desconectadas que el proveedor nunca confirmó.

    Son las que todavía conservan el token: si no lo tuvieran, no habría con
    qué reintentar. Es lo que recorre `manage.py reintentar_revocaciones`.
    """
    qs = CuentaConectada.objects.filter(
        estado=CuentaConectada.Estado.DESCONECTADA,
        revocado_en__isnull=True,
    ).exclude(access_token__isnull=True, refresh_token__isnull=True)
    if organizacion_id is not None:
        qs = qs.filter(organizacion_id=organizacion_id)
    return qs
