"""S3-FE-19 — renovar credenciales vencidas y pedir reconexión cuando ya no sirven.

Los lectores (S3-FE-02 Gmail, S3-FE-04 Outlook) no renuevan nada: con el
token vencido responden `credencial_vencida`, y con un 401 responden
`AutorizacionRechazada`. Este módulo es el que decide qué hacer:

    leer_con_renovacion(lector, organizacion_id=..., cuenta_id=..., ...)
      │
      ├─ 1. token_vigente: si vence en menos de 5 minutos, se refresca
      ├─ 2. se lee
      ├─ 3. si el proveedor rechazó el token (401): se refresca UNA vez y se
      │     lee UNA vez más
      └─ 4. si vuelve a rechazarlo, o si el proveedor dijo `invalid_grant` al
            refrescar, o si faltan permisos (403): la cuenta queda en
            `requiere_reautorizacion` y se responde `CuentaNoDisponible`

── Por qué no entra en bucle ────────────────────────────────────────────────
Una cuenta en `requiere_reautorizacion` ya no se refresca ni se lee: los dos
pasos la rechazan **antes** de hablar con el proveedor. La primera vez que la
autorización falla de verdad se pide UN refresco y, como mucho, UNA lectura
más. Desde ahí, cero peticiones hasta que el usuario reconecte (el callback
de OAuth la vuelve a dejar `conectada`).

── Qué ve la interfaz ───────────────────────────────────────────────────────
El listado de cuentas ya expone `estado`, `necesita_reautorizacion` y
`detalle_del_estado` (sprint 2, FE-02), y nunca los tokens. Este módulo deja
ahí un motivo para una persona: «Google ya no acepta la autorización…».

── Qué NO marca la cuenta ───────────────────────────────────────────────────
- Un error transitorio al refrescar (red, 429, 5xx): se reintenta después
  (S3-FE-18).
- Un error de NUESTRO cliente OAuth (`invalid_client`, `unauthorized_client`):
  marcar las cuentas haría que todos los usuarios tuvieran que reconectar por
  un error de configuración que ellos no pueden arreglar.

── Por qué el refresco no sube `credenciales_version` ───────────────────────
La versión dice "llegó una autorización nueva" (la sube el callback). Un
refresco no es una autorización nueva: el token de refresco de Google sigue
siendo el mismo, y revocarlo sigue revocando la concesión. Si el refresco la
subiera, una desconexión que el usuario pidió mientras un worker refrescaba
fallaría su escritura condicional y la cuenta quedaría conectada: justo lo
contrario de lo que se pidió.

── Dos workers a la vez ─────────────────────────────────────────────────────
El refresco toma la fila con `select_for_update` y vuelve a mirar el
vencimiento ya con el candado: si otro worker refrescó mientras tanto, no se
refresca dos veces. Importa con Microsoft, que ROTA el token de refresco:
refrescar dos veces con el mismo podría terminar en `invalid_grant` y en una
reconexión que nadie necesitaba.
"""

from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from shared.cifrado import SECRETO_ILEGIBLE

from . import proveedores
from .lectura_correo import (
    AutorizacionRechazada,
    huella_de_token,
    CuentaNoDisponible,
    ErrorDelProveedor,
    ErrorTransitorio,
    PaginaDeMensajes,
)
from .models import CuentaConectada

#: Se refresca si al token le queda menos que esto. Más que el margen de los
#: lectores (30 s), para que una página que tarda no se quede a medio camino.
MARGEN_RENOVACION = timedelta(minutes=5)

#: Si el proveedor no dice cuánto dura el token nuevo, se asume esto, que es
#: lo que dan Google y Microsoft. Asumir "para siempre" dejaría de refrescar.
DURACION_SUPUESTA = timedelta(hours=1)

_NOMBRES = dict(CuentaConectada.Proveedor.choices)


def _marcar(cuenta_id, *, organizacion_id, version: int | None, motivo: str, huella: str | None = None) -> bool:
    """Deja la cuenta en `requiere_reautorizacion` si sigue `conectada` y con
    LAS MISMAS credenciales que fallaron: la misma versión y, si se sabe, el
    mismo token (`huella`).

    Si el usuario reconectó mientras tanto (la versión subió) o si otro
    worker ya refrescó el token (la huella cambió), no se toca: esas
    credenciales son otras y nadie dijo que no sirvan. Se mira con la fila
    tomada, porque el token está cifrado y no se puede comparar en el WHERE.
    """
    with transaction.atomic():
        try:
            cuenta = (
                CuentaConectada.objects.select_for_update()
                .filter(pk=cuenta_id, organizacion_id=organizacion_id, estado=CuentaConectada.Estado.CONECTADA)
                .first()
            )
        except (ValidationError, ValueError, TypeError):
            return False
        if cuenta is None or version is None or cuenta.credenciales_version != version:
            return False
        if huella is not None and huella_de_token(cuenta.access_token) != huella:
            return False
        cuenta.estado = CuentaConectada.Estado.REQUIERE_REAUTORIZACION
        cuenta.detalle_del_estado = motivo[:200]
        cuenta.save(update_fields=["estado", "detalle_del_estado", "actualizado_en"])
        return True


def _motivo(proveedor: str, que_paso: str) -> str:
    nombre = _NOMBRES.get(proveedor, proveedor)
    return f"{nombre} {que_paso}: hay que volver a conectar la cuenta."


def token_vigente(
    *, organizacion_id, cuenta_id, proveedor: str, forzar: bool = False, rechazo: AutorizacionRechazada | None = None,
) -> None:
    """Deja en la base un token de acceso que sirva, si se puede.

    No lanza por una cuenta que no se puede leer (ajena, desconectada, que
    pide reautorizar): eso lo informa el lector, que es quien sabe decirlo.
    Lanza `ErrorTransitorio` o `ErrorDelProveedor` si el refresco falló por
    algo que no es de la cuenta.

    `forzar=True` refresca aunque el token no esté por vencer: es lo que se
    hace cuando el proveedor ya rechazó el token con un 401.

    `rechazo` es ese 401, con las credenciales con que se pidió. Si al tomar
    la fila las credenciales ya no son esas —el usuario reconectó, o otro
    worker refrescó—, no se refresca ni se marca nada: el rechazo era de
    credenciales que ya no están. Antes se refrescaba (o se marcaba) lo que
    hubiera, y un 401 tardío de la autorización vieja podía dejar pidiendo
    reconexión a la nueva. Lo encontró la revisión de #180.
    """
    with transaction.atomic():
        try:
            cuenta = (
                CuentaConectada.objects.select_for_update()
                .filter(pk=cuenta_id, organizacion_id=organizacion_id, proveedor=proveedor)
                .first()
            )
        except (ValidationError, ValueError, TypeError):
            cuenta = None
        if cuenta is None or cuenta.estado != CuentaConectada.Estado.CONECTADA or cuenta.necesita_reautorizacion:
            return
        if rechazo is not None and (
            cuenta.credenciales_version != rechazo.credenciales_version
            or huella_de_token(cuenta.access_token) != rechazo.huella_token
        ):
            return

        vence = cuenta.token_expira_en
        if not forzar and cuenta.access_token and (vence is None or vence > timezone.now() + MARGEN_RENOVACION):
            return

        refresco = cuenta.refresh_token
        if not refresco or refresco is SECRETO_ILEGIBLE:
            _marcar(cuenta.pk, organizacion_id=organizacion_id, version=cuenta.credenciales_version,
                    motivo=_motivo(proveedor, "no dejó un token de refresco y el de acceso venció"))
            return

        try:
            datos = proveedores.refrescar_token(proveedor, refresh_token=str(refresco))
        except proveedores.RefrescoRechazado:
            _marcar(cuenta.pk, organizacion_id=organizacion_id, version=cuenta.credenciales_version,
                    motivo=_motivo(proveedor, "ya no acepta la autorización de esta cuenta"))
            return
        except proveedores.RefrescoNoDisponible as exc:
            raise ErrorTransitorio(str(exc), codigo="refresco_no_disponible") from None
        except proveedores.ErrorDelProveedor as exc:
            raise ErrorDelProveedor(str(exc), codigo="refresco_rechazado_por_configuracion") from None

        segundos = datos.get("expires_in")
        duracion = (
            timedelta(seconds=int(segundos))
            if isinstance(segundos, (int, float)) and not isinstance(segundos, bool) and segundos > 0
            else DURACION_SUPUESTA
        )
        cuenta.access_token = datos["access_token"]
        cuenta.token_expira_en = timezone.now() + duracion
        campos = ["access_token", "token_expira_en", "detalle_del_estado", "actualizado_en"]
        nuevo_refresco = datos.get("refresh_token")
        if isinstance(nuevo_refresco, str) and nuevo_refresco:
            # Microsoft rota el de refresco: el viejo deja de servir pronto.
            cuenta.refresh_token = nuevo_refresco
            campos.append("refresh_token")
        cuenta.detalle_del_estado = ""
        cuenta.save(update_fields=campos)


def leer_con_renovacion(lector, *, organizacion_id, cuenta_id, **lectura) -> PaginaDeMensajes:
    """`lector.leer_mensajes(...)` con el token renovado cuando hace falta.

    `lector` es el módulo `lector_gmail` o `lector_outlook`. Ver el recorrido
    en la cabecera del módulo. Cada rechazo trae con qué credenciales se pidió,
    y solo esas se refrescan o se marcan.
    """
    proveedor = lector.PROVEEDOR
    token_vigente(organizacion_id=organizacion_id, cuenta_id=cuenta_id, proveedor=proveedor)
    try:
        return lector.leer_mensajes(organizacion_id=organizacion_id, cuenta_id=cuenta_id, **lectura)
    except AutorizacionRechazada as rechazo:
        primero = rechazo
    if primero.codigo == "permiso_insuficiente":
        # Faltan permisos: refrescar entrega un token con los MISMOS
        # permisos. Solo sirve que el usuario vuelva a autorizar.
        if _marcar(cuenta_id, organizacion_id=organizacion_id, version=primero.credenciales_version,
                   huella=primero.huella_token,
                   motivo=_motivo(proveedor, "no dio los permisos necesarios para leer el correo")):
            raise _requiere(proveedor) from None
        # Las credenciales ya cambiaron: se lee una vez más con las nuevas.

    else:
        token_vigente(organizacion_id=organizacion_id, cuenta_id=cuenta_id, proveedor=proveedor, forzar=True,
                      rechazo=primero)
    try:
        return lector.leer_mensajes(organizacion_id=organizacion_id, cuenta_id=cuenta_id, **lectura)
    except AutorizacionRechazada as segundo:
        _marcar(cuenta_id, organizacion_id=organizacion_id, version=segundo.credenciales_version,
                huella=segundo.huella_token,
                motivo=_motivo(proveedor, "rechazó el token aun recién renovado"))
        raise _requiere(proveedor) from None


def _requiere(proveedor: str) -> CuentaNoDisponible:
    return CuentaNoDisponible(
        _motivo(proveedor, "rechazó la autorización"),
        codigo=CuentaNoDisponible.REQUIERE_REAUTORIZACION,
    )
