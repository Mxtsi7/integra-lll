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


def _marcar(cuenta_id, *, organizacion_id, version: int, motivo: str) -> bool:
    """Deja la cuenta en `requiere_reautorizacion` si sigue `conectada` y con
    las mismas credenciales. Si el usuario reconectó mientras tanto (la
    versión subió), no se toca: esas credenciales son otras."""
    return bool(
        CuentaConectada.objects.filter(
            pk=cuenta_id,
            organizacion_id=organizacion_id,
            estado=CuentaConectada.Estado.CONECTADA,
            credenciales_version=version,
        ).update(
            estado=CuentaConectada.Estado.REQUIERE_REAUTORIZACION,
            detalle_del_estado=motivo[:200],
            actualizado_en=timezone.now(),
        )
    )


def _motivo(proveedor: str, que_paso: str) -> str:
    nombre = _NOMBRES.get(proveedor, proveedor)
    return f"{nombre} {que_paso}: hay que volver a conectar la cuenta."


def token_vigente(*, organizacion_id, cuenta_id, proveedor: str, forzar: bool = False) -> None:
    """Deja en la base un token de acceso que sirva, si se puede.

    No lanza por una cuenta que no se puede leer (ajena, desconectada, que
    pide reautorizar): eso lo informa el lector, que es quien sabe decirlo.
    Lanza `ErrorTransitorio` o `ErrorDelProveedor` si el refresco falló por
    algo que no es de la cuenta.

    `forzar=True` refresca aunque el token no esté por vencer: es lo que se
    hace cuando el proveedor ya rechazó el token con un 401.
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
    en la cabecera del módulo.
    """
    proveedor = lector.PROVEEDOR
    token_vigente(organizacion_id=organizacion_id, cuenta_id=cuenta_id, proveedor=proveedor)
    version = _version(cuenta_id)
    try:
        return lector.leer_mensajes(organizacion_id=organizacion_id, cuenta_id=cuenta_id, **lectura)
    except AutorizacionRechazada as rechazo:
        if rechazo.codigo == "permiso_insuficiente":
            # Faltan permisos: refrescar entrega un token con los MISMOS
            # permisos. Solo sirve que el usuario vuelva a autorizar.
            _marcar(cuenta_id, organizacion_id=organizacion_id, version=version,
                    motivo=_motivo(proveedor, "no dio los permisos necesarios para leer el correo"))
            raise _requiere(proveedor) from None

    token_vigente(organizacion_id=organizacion_id, cuenta_id=cuenta_id, proveedor=proveedor, forzar=True)
    try:
        return lector.leer_mensajes(organizacion_id=organizacion_id, cuenta_id=cuenta_id, **lectura)
    except AutorizacionRechazada:
        _marcar(cuenta_id, organizacion_id=organizacion_id, version=version,
                motivo=_motivo(proveedor, "rechazó el token aun recién renovado"))
        raise _requiere(proveedor) from None


def _version(cuenta_id) -> int | None:
    try:
        return CuentaConectada.objects.filter(pk=cuenta_id).values_list("credenciales_version", flat=True).first()
    except (ValidationError, ValueError, TypeError):
        return None


def _requiere(proveedor: str) -> CuentaNoDisponible:
    return CuentaNoDisponible(
        _motivo(proveedor, "rechazó la autorización"),
        codigo=CuentaNoDisponible.REQUIERE_REAUTORIZACION,
    )
