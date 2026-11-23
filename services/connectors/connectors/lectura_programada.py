"""S3-FE-18 y S3-FE-20 — la lectura programada de las cuentas de correo.

Junta lo que ya existe en una tarea que corre sola:

    beat ─▶ programar_lecturas()           cada 15 min: una tarea por cuenta conectada
              └▶ leer_cuenta(cuenta_id)     hasta PAGINAS_POR_TAREA páginas
                   └▶ leer_siguiente_lote   S3-FE-03/05: cursor + renovación (S3-FE-19)
                        └▶ guardar_pagina   S3-FE-09: candidatos y errores

── S3-FE-20: una cuenta desconectada no se lee ni se guarda ──────────────
Se mira en tres lugares, porque la desconexión puede llegar en cualquier
momento:

1. **Al programar.** Solo se encolan cuentas `conectada`.
2. **Al empezar la tarea.** Una tarea que ya estaba en la cola cuando el
   usuario desconectó se encuentra la cuenta desconectada y no lee nada. Es
   la forma de «cancelar los trabajos pendientes» que no depende de que el
   broker deje revocar mensajes: la tarea se cancela sola al despertar.
3. **Antes de guardar cada página**, con la fila de la cuenta TOMADA
   (`select_for_update`). Si la desconexión ganó, no se guarda nada y el
   cursor no se mueve. Si la lectura ganó, la desconexión espera a que
   termine de guardar: lo guardado es de antes de desconectar.

Además, `cancelar_lectura` (lo llama la desconexión) descarta la corrida a
medias y cierra la importación abierta, para que una reconexión empiece
limpia desde la última marca.

── S3-FE-18: reintentos con espera, y con tope ───────────────────────────
| Lo que pasó | Qué se hace | Estado |
|---|---|---|
| `ErrorTransitorio` (red, 429, 5xx) | se reintenta con `ESPERAS` (1, 5, 15, 30 y 60 min; o el `Retry-After` si es mayor) | `reintentando` |
| se acabaron los reintentos | no se reintenta más en esta tarea; la cuenta descansa `ENFRIAMIENTO` antes de volver a programarse | `agotada` |
| `ErrorDelProveedor` (permanente) | no se reintenta; no se vuelve a programar mientras la cuenta tenga las mismas credenciales | `detenida` |
| la cuenta no se puede leer | no se reintenta; deja de programarse por estar desconectada o pidiendo reconexión | (el de la cuenta) |

El cursor nunca se mueve por un fallo (S3-FE-03/05): retomar lee la misma
página. Todo queda en `AvanceDeLectura` (estado, fallos seguidos, código y
detalle del último error) y en el log.

── Una importación por ejecución, no por corrida ─────────────────────────
`guardar_pagina` escribe en una `Importacion`. Cada ejecución de la tarea
abre la suya al guardar la primera página con mensajes, y la cierra al
terminar. Si fuera una por corrida, una corrida esperando su reintento
quedaría abierta más de 30 minutos y el rescate de S3-FE-10 la cerraría como
«interrumpida» con un mensaje de CSV. Así ninguna queda abierta mientras se
espera. El `usuario_id` es `lectura-programada`: la cuenta conectada no
guarda quién la conectó, y los candidatos se listan por organización.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import lector_gmail, lector_outlook
from .avance_lectura import descartar_corrida, leer_siguiente_lote
from .candidatos_correo import ImportacionNoDisponible, guardar_pagina
from .lectura_correo import CuentaNoDisponible, ErrorDelProveedor, ErrorTransitorio
from .models import AvanceDeLectura, CuentaConectada, Importacion

log = logging.getLogger(__name__)

LECTORES = {
    CuentaConectada.Proveedor.GMAIL: lector_gmail,
    CuentaConectada.Proveedor.OUTLOOK: lector_outlook,
}

#: Cuántas páginas lee una tarea como mucho. Lo que quede, lo lee la próxima:
#: una cuenta con mucho correo no tiene tomado un worker por horas.
PAGINAS_POR_TAREA = 20

#: Las esperas entre reintentos de un error transitorio, en segundos. Su
#: largo es el tope: después del último, la cuenta queda `agotada`.
ESPERAS = (60, 300, 900, 1800, 3600)
#: Un `Retry-After` mayor que esto no se respeta: un valor absurdo no deja
#: una cuenta sin leer por días.
ESPERA_MAXIMA = 3600

#: Cuánto descansa una cuenta `agotada` antes de volver a programarse.
ENFRIAMIENTO = timedelta(hours=1)

USUARIO_DE_LA_LECTURA = "lectura-programada"


class CuentaDesconectadaAlGuardar(Exception):
    """La cuenta dejó de estar conectada entre la lectura y el guardado."""


def espera_para(intento: int, error: ErrorTransitorio) -> int | None:
    """Segundos hasta el próximo reintento, o `None` si ya no quedan."""
    if intento >= len(ESPERAS):
        return None
    pedida = getattr(error, "reintentar_en", None) or 0
    return min(max(ESPERAS[intento], int(pedida)), ESPERA_MAXIMA)


# ── lo que queda observable ─────────────────────────────────────────────────


def _anotar(cuenta: CuentaConectada, **campos) -> None:
    AvanceDeLectura.objects.filter(cuenta=cuenta).update(actualizado_en=timezone.now(), **campos)


def _anotar_error(cuenta, error, *, estado: str, ahora, **extra) -> None:
    _anotar(
        cuenta,
        estado_lectura=estado,
        ultimo_error=str(getattr(error, "codigo", "") or type(error).__name__)[:60],
        ultimo_error_detalle=str(error)[:200],
        ultimo_error_en=ahora,
        **extra,
    )


# ── la importación de esta ejecución ────────────────────────────────────────


def _abrir_importacion(cuenta: CuentaConectada, ahora) -> Importacion:
    return Importacion.objects.create(
        organizacion_id=cuenta.organizacion_id,
        usuario_id=USUARIO_DE_LA_LECTURA,
        origen=Importacion.Origen.CORREO,
        cuenta=cuenta,
        estado=Importacion.Estado.PROCESANDO,
    )


def _cerrar_importacion(importacion: Importacion | None, ahora) -> None:
    """Completada con lo que guardó, si sigue abierta. Si el rescate o una
    desconexión ya la cerraron, se respeta lo que dejaron."""
    if importacion is None:
        return
    Importacion.objects.filter(pk=importacion.pk, estado=Importacion.Estado.PROCESANDO).update(
        estado=Importacion.Estado.COMPLETADA, terminada_en=ahora, actualizado_en=ahora,
    )


# ── leer una cuenta ─────────────────────────────────────────────────────────


def leer_cuenta(cuenta_id, *, intento: int = 0, ahora=None) -> dict:
    """Lee hasta `PAGINAS_POR_TAREA` páginas de la cuenta y las guarda.

    Devuelve un resumen. Si trae `reintentar_en`, la tarea tiene que volver a
    llamarla en esos segundos con `intento + 1`.
    """
    ahora = ahora or timezone.now()
    cuenta = CuentaConectada.objects.filter(pk=cuenta_id, proveedor__in=list(LECTORES)).first()
    if cuenta is None:
        return {"omitida": "no_existe"}
    if cuenta.estado != CuentaConectada.Estado.CONECTADA:
        # S3-FE-20, punto 2: la tarea encolada antes de desconectar no lee.
        return {"omitida": "no_conectada"}
    avance = AvanceDeLectura.objects.filter(cuenta=cuenta).first()
    if (avance is not None and avance.estado_lectura == AvanceDeLectura.EstadoLectura.DETENIDA
            and avance.detenida_en_version == cuenta.credenciales_version):
        return {"omitida": "detenida"}

    lector = LECTORES[cuenta.proveedor]
    estado = {"importacion": None, "paginas": 0, "mensajes": 0}

    def procesar(pagina):
        # S3-FE-20, punto 3: con la cuenta tomada, en la misma transacción
        # que mueve el cursor.
        actual = CuentaConectada.objects.select_for_update().get(pk=cuenta.pk)
        if actual.estado != CuentaConectada.Estado.CONECTADA:
            raise CuentaDesconectadaAlGuardar(f"la cuenta pasó a {actual.estado} mientras se leía")
        if not pagina.mensajes and not pagina.omitidos:
            return
        if estado["importacion"] is None:
            estado["importacion"] = _abrir_importacion(cuenta, ahora)
        guardar_pagina(estado["importacion"], pagina, ahora=ahora)

    try:
        while estado["paginas"] < PAGINAS_POR_TAREA:
            try:
                resultado = leer_siguiente_lote(
                    lector, organizacion_id=cuenta.organizacion_id, cuenta_id=cuenta.pk, procesar=procesar, ahora=ahora,
                )
            except ImportacionNoDisponible:
                # El rescate la cerró entre dos páginas. La transacción se
                # revirtió: se abre otra y se lee la misma página de nuevo.
                estado["importacion"] = None
                continue
            except BaseException:
                # La transacción se revirtió: si se abrió una importación en
                # ella, ya no existe.
                if estado["importacion"] is not None and not Importacion.objects.filter(
                        pk=estado["importacion"].pk).exists():
                    estado["importacion"] = None
                raise
            estado["paginas"] += 1
            estado["mensajes"] += resultado.mensajes
            if resultado.corrida_terminada or resultado.descartado:
                break
    except ErrorTransitorio as error:
        espera = espera_para(intento, error)
        if espera is None:
            _anotar_error(cuenta, error, estado=AvanceDeLectura.EstadoLectura.AGOTADA, ahora=ahora,
                          fallos_seguidos=intento + 1)
            log.error("lectura de correo agotada: cuenta %s, %s tras %s intentos", cuenta.pk, error.codigo, intento + 1)
            return {"agotada": error.codigo, **_resumen(estado)}
        _anotar_error(cuenta, error, estado=AvanceDeLectura.EstadoLectura.REINTENTANDO, ahora=ahora,
                      fallos_seguidos=intento + 1)
        log.warning("lectura de correo: cuenta %s, %s; reintento en %ss", cuenta.pk, error.codigo, espera)
        return {"reintentar_en": espera, "error": error.codigo, **_resumen(estado)}
    except ErrorDelProveedor as error:
        _anotar_error(cuenta, error, estado=AvanceDeLectura.EstadoLectura.DETENIDA, ahora=ahora,
                      detenida_en_version=cuenta.credenciales_version)
        log.error("lectura de correo detenida: cuenta %s, %s", cuenta.pk, error.codigo)
        return {"detenida": error.codigo, **_resumen(estado)}
    except (CuentaNoDisponible, CuentaDesconectadaAlGuardar) as error:
        _anotar_error(cuenta, error, estado=AvanceDeLectura.EstadoLectura.AL_DIA, ahora=ahora)
        return {"omitida": getattr(error, "codigo", "cuenta_desconectada"), **_resumen(estado)}
    finally:
        _cerrar_importacion(estado["importacion"], timezone.now())

    _anotar(cuenta, estado_lectura=AvanceDeLectura.EstadoLectura.AL_DIA, fallos_seguidos=0)
    return _resumen(estado)


def _resumen(estado) -> dict:
    importacion = estado["importacion"]
    return {
        "paginas": estado["paginas"],
        "mensajes": estado["mensajes"],
        "importacion": str(importacion.pk) if importacion is not None else None,
    }


# ── programar ───────────────────────────────────────────────────────────────


def cuentas_para_leer(ahora=None) -> list:
    """Las cuentas que toca leer ahora (S3-FE-20, punto 1, y S3-FE-18)."""
    ahora = ahora or timezone.now()
    elegidas = []
    cuentas = CuentaConectada.objects.filter(
        estado=CuentaConectada.Estado.CONECTADA, proveedor__in=list(LECTORES),
    ).select_related("avance_de_lectura")
    for cuenta in cuentas:
        avance = getattr(cuenta, "avance_de_lectura", None)
        if avance is not None:
            if (avance.estado_lectura == AvanceDeLectura.EstadoLectura.DETENIDA
                    and avance.detenida_en_version == cuenta.credenciales_version):
                continue
            if (avance.estado_lectura == AvanceDeLectura.EstadoLectura.AGOTADA
                    and avance.ultimo_error_en and avance.ultimo_error_en > ahora - ENFRIAMIENTO):
                continue
        elegidas.append(cuenta.pk)
    return elegidas


# ── cancelar ────────────────────────────────────────────────────────────────


def cancelar_lectura(cuenta: CuentaConectada) -> None:
    """Lo que hace la desconexión de una cuenta con su lectura (S3-FE-20).

    Descarta la corrida a medias y cierra la importación que estuviera
    abierta. Las tareas que ya estaban en la cola se cancelan solas al
    despertar (ver el módulo).
    """
    descartar_corrida(organizacion_id=cuenta.organizacion_id, cuenta_id=cuenta.pk)
    ahora = timezone.now()
    with transaction.atomic():
        for importacion in Importacion.objects.select_for_update().filter(
            cuenta=cuenta, origen=Importacion.Origen.CORREO, estado=Importacion.Estado.PROCESANDO,
        ):
            importacion.estado = Importacion.Estado.FALLIDA
            importacion.terminada_en = ahora
            importacion.anotar_error("cuenta_desconectada", "La cuenta se desconectó mientras se leía su correo.")
            importacion.save()
