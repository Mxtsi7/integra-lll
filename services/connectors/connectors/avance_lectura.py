"""S3-FE-03 / S3-FE-05 — guardar hasta dónde se leyó cada cuenta de correo.

    leer_siguiente_lote(lector_gmail | lector_outlook, organizacion_id=..., cuenta_id=..., procesar=...)

Lee UNA página de la cuenta, se la entrega a `procesar` y, solo si `procesar`
terminó bien, guarda hasta dónde se llegó. Lo mismo para Gmail (FE-03) y
Outlook (FE-05): lo que cambia entre los dos (un `pageToken` o una
`@odata.nextLink`) lo resuelve cada lector.

── Corridas y marca de agua ────────────────────────────────────────────────
Los proveedores listan del más nuevo al más viejo. Si la marca avanzara con
cada página, un fallo a mitad de camino dejaría sin leer lo que quedaba más
atrás. Por eso la lectura va en **corridas**:

1. Una corrida nueva fija su tope, `corrida_hasta` = ahora, y cubre lo
   recibido entre `leido_hasta` (menos un solape) y ese tope.
2. Cada página procesada guarda la página siguiente (`pagina`).
3. Cuando no hay más páginas, la corrida termina: `leido_hasta` pasa a ser
   el tope, y la página se limpia.

Reanudar después de un fallo retoma desde la última página guardada: no se
pierde nada. Y como la corrida tiene tope, no se relee para siempre: lo que
llegue después lo toma la corrida siguiente.

La primera corrida de una cuenta mira `VENTANA_INICIAL` hacia atrás, no el
buzón entero.

Que no haya página siguiente tiene que querer decir que se agotó la ventana:
es lo único que adelanta la marca. Por eso ningún lector puede terminar antes
sin avisar. Outlook enumera la ventana por fecha en vez de buscar con
`$search`, que Graph corta en 1000 resultados, y ninguno de los dos recorta
una página (revisión de #189, P1).

── Procesar y guardar, juntos ──────────────────────────────────────────────
`procesar(pagina_de_mensajes)` corre dentro de la misma transacción que
mueve el cursor. Si falla, la transacción se revierte, el cursor no se mueve
y la próxima vez se lee la misma página. «Tras procesar de forma segura el
lote» es eso: el cursor nunca queda por delante de lo procesado.

── Una página que el proveedor ya no acepta (FE-05) ────────────────────────
Un `pageToken` o una `@odata.nextLink` pueden vencer. Si el proveedor la
rechaza (`CursorRechazado`, y solo eso), la corrida vuelve a su **primera**
página con el mismo tope: se releen mensajes ya vistos, pero no se pierde
ninguno, y no se borra nada. Que releer no duplique es de la llave única de
candidatos (organización, origen, identificador), que en correo es el
Message-ID (S3-FE-06). Se cuenta en `reinicios_por_pagina_invalida`.

Cualquier otro error con una página guardada —un JSON ilegible, una lista
mal formada, el detalle de un mensaje que no se pudo leer, una página que el
lector no reconoce (`ValueError`)— sale tal cual, con el avance intacto y sin
contar un reinicio. Antes se reiniciaba con cualquier `ErrorDelProveedor`, y
una página buena que fallaba por otra cosa se cambiaba por la primera una y
otra vez, respondiendo éxito (revisión de #189, P2).

Una corrida se reinicia **una vez** como mucho (`reiniciada_en_corrida`). Si
el proveedor vuelve a rechazar una página en la misma corrida, sale
`cursor_rechazado_otra_vez` sin procesar ni guardar nada. Antes solo se
cortaba el ciclo de un paso (abajo): con la tercera página rechazada siempre,
la corrida volvía al inicio cada dos llamadas, para siempre, respondiendo
éxito (revisión de #189, ronda 3). La marca se limpia al terminar la corrida.

Si al reiniciar el proveedor entrega como página siguiente la misma que
acaba de rechazar, reiniciar no lleva a ninguna parte: no se procesa ni se
guarda nada y sale `reinicio_sin_avance`.

── Una cuenta detenida ─────────────────────────────────────────────────────
Esos dos errores, y uno del lector con la página guardada, dejan la cuenta
detenida: cada llamada vuelve a fallar igual y nada se mueve. Se saca con
`descartar_corrida`, que olvida la corrida a medias y deja la marca donde
estaba: la siguiente empieza desde `leido_hasta`, relee lo que la descartada
ya había procesado (la llave única no lo duplica) y no pierde nada.

── Dos workers con la misma cuenta ─────────────────────────────────────────
El cursor se lee al empezar y se vuelve a mirar, con la fila tomada, antes de
procesar. Si otro worker lo movió mientras tanto, esta página ya no es la que
toca: no se procesa ni se mueve nada.

Lo que NO hace: reintentar con espera (S3-FE-18) ni dejar de leer una cuenta
desconectada a mitad de camino (S3-FE-20). Un error de la cuenta o del
proveedor sale tal cual, con el cursor intacto.
"""

from __future__ import annotations

import dataclasses
from datetime import timedelta
from typing import Callable

from django.db import transaction
from django.utils import timezone

from .lectura_correo import CursorRechazado, ErrorDelProveedor, FiltroCorreos, PaginaDeMensajes
from .models import AvanceDeLectura, CuentaConectada
from .renovacion import leer_con_renovacion

#: Hasta dónde mira la primera corrida de una cuenta.
VENTANA_INICIAL = timedelta(days=90)

#: Cuánto antes de `leido_hasta` empieza la corrida siguiente. Gmail filtra
#: por segundos y un correo puede quedar registrado con un instante distinto
#: del que se vio al listar: un poco de solape relee unos pocos mensajes (que
#: la llave única no duplica) en vez de perder alguno en el borde.
SOLAPE = timedelta(minutes=10)


@dataclasses.dataclass(frozen=True)
class ResultadoDeLote:
    mensajes: int
    #: La corrida terminó con esta página: la marca de agua avanzó.
    corrida_terminada: bool = False
    #: El proveedor rechazó la página guardada y la corrida volvió al inicio.
    reiniciada: bool = False
    #: Otro worker movió el cursor mientras se leía: no se procesó nada.
    descartado: bool = False


def _avance(organizacion_id, cuenta_id) -> AvanceDeLectura:
    """El avance de la cuenta, creado si no existe. La cuenta se busca con la
    organización: un avance ajeno no se crea ni se toca."""
    cuenta = CuentaConectada.objects.get(pk=cuenta_id, organizacion_id=organizacion_id)
    avance, _ = AvanceDeLectura.objects.get_or_create(
        cuenta=cuenta, defaults={"organizacion_id": cuenta.organizacion_id},
    )
    return avance


def _filtro(avance: AvanceDeLectura, tope) -> FiltroCorreos:
    desde = (avance.leido_hasta - SOLAPE) if avance.leido_hasta else (tope - VENTANA_INICIAL)
    return FiltroCorreos(desde=desde, hasta=tope)


def leer_siguiente_lote(
    lector,
    *,
    organizacion_id,
    cuenta_id,
    procesar: Callable[[PaginaDeMensajes], None],
    limite: int | None = None,
    ahora=None,
) -> ResultadoDeLote:
    """Lee la página que toca, la procesa y guarda el avance. Ver el módulo."""
    with transaction.atomic():
        avance = _avance(organizacion_id, cuenta_id)
        avance = AvanceDeLectura.objects.select_for_update().get(pk=avance.pk)
        if avance.corrida_hasta is None:
            avance.corrida_hasta = ahora or timezone.now()
            avance.pagina = ""
            avance.save(update_fields=["corrida_hasta", "pagina", "actualizado_en"])
        visto = (avance.corrida_hasta, avance.pagina)

    filtro = _filtro(avance, avance.corrida_hasta)
    lectura = {"filtro": filtro, "pagina": avance.pagina or None}
    if limite is not None:
        lectura["limite"] = limite

    reiniciada = False
    try:
        pagina = leer_con_renovacion(lector, organizacion_id=organizacion_id, cuenta_id=cuenta_id, **lectura)
    except CursorRechazado as rechazo:
        if not avance.pagina:
            # Sin página guardada no hay cursor que culpar: el error es otro.
            raise
        if avance.reiniciada_en_corrida:
            # Reiniciar otra vez llevaría de nuevo hasta una página que el
            # proveedor rechaza: la corrida no terminaría nunca.
            raise ErrorDelProveedor(
                "El proveedor rechazó otra página de una corrida que ya se reinició una vez.",
                codigo="cursor_rechazado_otra_vez",
            ) from rechazo
        # El proveedor rechazó la página guardada. Se vuelve al inicio de la
        # MISMA corrida.
        lectura["pagina"] = None
        pagina = leer_con_renovacion(lector, organizacion_id=organizacion_id, cuenta_id=cuenta_id, **lectura)
        if pagina.siguiente_pagina == avance.pagina:
            raise ErrorDelProveedor(
                "El proveedor entrega como página siguiente la misma que acaba de rechazar: reiniciar no avanza.",
                codigo="reinicio_sin_avance",
            ) from rechazo
        reiniciada = True

    with transaction.atomic():
        actual = AvanceDeLectura.objects.select_for_update().get(pk=avance.pk)
        if (actual.corrida_hasta, actual.pagina) != visto:
            return ResultadoDeLote(mensajes=0, descartado=True)

        procesar(pagina)

        campos = ["pagina", "reiniciada_en_corrida", "actualizado_en"]
        if reiniciada:
            actual.reinicios_por_pagina_invalida += 1
            actual.reiniciada_en_corrida = True
            campos.append("reinicios_por_pagina_invalida")
        if pagina.siguiente_pagina:
            actual.pagina = pagina.siguiente_pagina
            actual.save(update_fields=campos)
            return ResultadoDeLote(mensajes=len(pagina.mensajes), reiniciada=reiniciada)

        actual.leido_hasta = actual.corrida_hasta
        actual.corrida_hasta = None
        actual.pagina = ""
        actual.reiniciada_en_corrida = False
        actual.corridas_completadas += 1
        actual.save(update_fields=[*campos, "leido_hasta", "corrida_hasta", "corridas_completadas"])
        return ResultadoDeLote(mensajes=len(pagina.mensajes), corrida_terminada=True, reiniciada=reiniciada)


def descartar_corrida(*, organizacion_id, cuenta_id) -> bool:
    """Olvida la corrida a medias de la cuenta, para sacarla de un error que
    se repite (ver «Una cuenta detenida» en el módulo y el documento 29).

    La marca `leido_hasta` y los contadores no se tocan: la próxima llamada
    abre una corrida nueva desde la marca. Devuelve si había una corrida que
    descartar. La fila se toma como en `leer_siguiente_lote`: un worker que
    leyó el cursor antes de esto descarta su página al ver que cambió.
    """
    with transaction.atomic():
        avance = (
            AvanceDeLectura.objects.select_for_update()
            .filter(cuenta_id=cuenta_id, organizacion_id=organizacion_id)
            .first()
        )
        if avance is None or avance.corrida_hasta is None:
            return False
        avance.corrida_hasta = None
        avance.pagina = ""
        avance.reiniciada_en_corrida = False
        avance.save(update_fields=["corrida_hasta", "pagina", "reiniciada_en_corrida", "actualizado_en"])
        return True
