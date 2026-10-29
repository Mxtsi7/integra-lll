"""Encolar las entregas de una alerta recién creada (FE-24 / MX-21).

Una alerta es de la organización (así está modelado FE-16), pero
`alerta.activada` exige `usuario_id`: es un evento de **entrega**, no de
creación. Así que una alerta produce una fila de outbox por cada persona de
la organización que quiere ese tipo de aviso por algún canal. Dos personas
con el aviso encendido son dos entregas del mismo hecho, con ids distintos y
el mismo `correlation_id`.

── La pertenencia al tenant se comprueba acá ───────────────────────────────
MX-21 lo pide explícitamente: «FE-24 valida la pertenencia de usuario y
suscripción al tenant antes de generar/entregar la alerta». No hace falta
preguntarle a Auth, y de hecho no se puede (ADR-002: ningún servicio consulta
el esquema de otro). La comprobación sale de dónde viven los datos:

    la persona      `PreferenciaNotificacion` es `ModeloTenant`, así que
                    filtrar por `organizacion_id` ES la comprobación. Una
                    preferencia de otra organización no aparece en la
                    consulta, así que nunca puede recibir esta alerta.

    la suscripción  `SuscripcionVigilada` también lo es, y la alerta se crea
                    a partir de la fila de la proyección de ESA organización.

Un UUID de organización válido no autoriza por sí solo —eso también lo dice
MX-21—, y por eso el aislamiento no depende de que el productor mande el
tenant correcto: depende de que las tablas sean del tenant.

── Por qué una preferencia con id no numérico no entrega ───────────────────
`PreferenciaNotificacion.usuario_id` es texto: guarda el valor crudo de la
cabecera `X-Usuario-Id` que inyecta el gateway, sin interpretarlo. El
contrato, en cambio, exige un entero positivo de 1 a 9223372036854775807,
coherente con `auth.User.id`.

Cuando no se puede convertir, la entrega **no se encola** y queda un aviso en
el log. La alternativa sería publicar un `usuario_id` inválido, que el
consumidor de entregas rechazaría a la cola de fallos de todas formas: mejor
no publicarlo y que se vea de qué preferencia viene.

── Sin preferencias guardadas no hay entregas, y está bien ─────────────────
El generador avisa igual (crea la alerta con las preferencias de omisión,
para que la campana de FE-20 la muestre), pero una entrega necesita una
persona concreta y un `usuario_id`. Una organización que nunca abrió la
pantalla de FE-21 no tiene ninguna fila, así que no hay a quién entregarle:
la alerta existe en la aplicación y no se publica a ningún canal externo. Es
lo correcto, no una omisión.
"""

from __future__ import annotations

import logging
import uuid

from .models import Alerta, AlertaPorEntregar, PreferenciaNotificacion

log = logging.getLogger(__name__)

#: El techo que pide el esquema para `usuario_id` (el de un BigAutoField).
MAX_USUARIO_ID = 9223372036854775807


def _usuario_entero(preferencia: PreferenciaNotificacion) -> int | None:
    """El `usuario_id` de la preferencia como entero del contrato, o None."""
    crudo = (preferencia.usuario_id or "").strip()
    try:
        numero = int(crudo)
    except ValueError:
        log.warning(
            "preferencia %s tiene usuario_id %r, que no es un entero: no se "
            "le encola la entrega (MX-21 exige un entero positivo)",
            preferencia.pk, crudo,
        )
        return None
    if not 1 <= numero <= MAX_USUARIO_ID:
        log.warning(
            "preferencia %s tiene usuario_id %s, fuera del rango del contrato",
            preferencia.pk, numero,
        )
        return None
    return numero


def destinatarios(organizacion_id, tipo: str) -> list[int]:
    """Los `usuario_id` de la organización que quieren este tipo de aviso.

    Filtrar por `organizacion_id` es la comprobación de pertenencia: una
    preferencia de otra organización no entra en la consulta.
    """
    elegidos = []
    for preferencia in PreferenciaNotificacion.objects.filter(
        organizacion_id=organizacion_id
    ).order_by("usuario_id"):
        if not (preferencia.quiere(tipo) and preferencia.canales_elegidos()):
            continue
        numero = _usuario_entero(preferencia)
        if numero is not None:
            elegidos.append(numero)
    return elegidos


def encolar(alerta: Alerta, *, programada_para, correlation_id=None) -> int:
    """Deja una fila de outbox por destinatario. Devuelve cuántas quedaron.

    Se llama DENTRO de la transacción que crea la alerta: o quedan las dos
    cosas o ninguna. Publicar se hace después, desde `publicar_alertas`.

    `programada_para` es el instante en que la alerta venció, no «ahora»: el
    contrato exige `programada_para <= ocurrido_en`, y `ocurrido_en` lo pone
    el publicador al mandarla. Pasar el comienzo de la ventana (por ejemplo,
    las 00:00 del día en que empiezan los 3 días de anticipación) cumple la
    desigualdad y además dice algo cierto: cuándo correspondía avisar.

    `bulk_create` con `ignore_conflicts`: si el generador ya había encolado
    estas entregas, la restricción `(alerta, usuario_id)` las descarta sin
    reventar. Un segundo pase no duplica avisos.

    Se devuelve un CONTEO consultado y no la lista que se pasó a
    `bulk_create`: con `ignore_conflicts`, `bulk_create` devuelve los objetos
    aunque la base los haya descartado, y en varios motores sin asignarles
    clave. Devolver esa lista diría "encolé 3" cuando la base guardó 0.
    """
    correlacion = correlation_id or uuid.uuid4()
    filas = [
        AlertaPorEntregar(
            organizacion_id=alerta.organizacion_id,
            alerta=alerta,
            usuario_id=usuario_id,
            correlation_id=correlacion,
            programada_para=programada_para,
        )
        for usuario_id in destinatarios(alerta.organizacion_id, alerta.tipo)
    ]
    if not filas:
        log.info(
            "la alerta %s no tiene destinatarios con usuario_id válido: queda "
            "en la aplicación y no se publica",
            alerta.pk,
        )
        return 0
    AlertaPorEntregar.objects.bulk_create(filas, ignore_conflicts=True)
    return AlertaPorEntregar.objects.filter(alerta=alerta).count()
