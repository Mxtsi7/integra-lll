"""Confirmar un candidato: la decisión, en una sola transacción (S3-FE-15).

Confirmar es lo único de todo este camino que mueve plata. Hasta acá nada
tocó nada: FE-07 recibió un archivo, S3-FE-10 lo leyó, S3-FE-14 lo mostró y
S3-FE-16 descartó lo que no servía. Esto es el "sí".

── Qué significa "crear o actualizar suscripciones y cobros" desde acá ──────
Esas dos tablas viven en `subscriptions` y este servicio no conoce su esquema
(ADR-002). Así que la confirmación cruza una frontera de servicio, y una
transacción no cruza fronteras: no existe un commit que deje el candidato
confirmado y la suscripción creada a la vez.

Lo que sí se puede hacer en una sola transacción es dejar **el candidato
confirmado y la orden de crear, los dos o ninguno**:

    candidato: propuesto → confirmado, con quién y cuándo
    outbox:    una fila con todo lo que hay que crear

Eso es el criterio "confirmar es atómico según el contrato". Después de un
commit no existe un candidato confirmado sin su orden, ni una orden sin su
candidato; y si algo revienta, no queda nada a medias.

── La decisión viaja RESUELTA, no se re-deduce ──────────────────────────────
El sobre lleva `crear_cobro` ya decidido. Quien lo drene no vuelve a mirar el
tipo de mensaje para adivinar si hubo un pago: si esa regla viviera en los dos
lados, se separarían, y el día que se separen el síntoma es un cobro inventado
en la cuenta de alguien.

    cobro_realizado   suscripción + COBRO      ya pasó
    aviso_de_cobro    suscripción, sin cobro   "te vamos a cobrar": no pasó
    pago_fallido      suscripción, sin cobro   no se pudo cobrar: no pasó

El criterio de la tarjeta es exactamente ese: «aviso futuro no genera un pago
realizado». Un aviso que se contara como cobro lo contaría dos veces cuando
después llegue el recibo de verdad, y haría cuadrar mal el presupuesto.

── Lo que falta, dicho sin adornos ─────────────────────────────────────────
No hay publicador en connectors. Las filas del outbox se acumulan durables
hasta que exista quien las drene y un consumidor en `subscriptions` que las
aplique. Esta tarjeta deja la orden escrita y el contrato fijo; no finge que
la suscripción ya existe.
"""

from __future__ import annotations

import uuid

from django.db import transaction
from django.utils import timezone

from .models import CobroCandidato, OutboxEvento

#: El nombre y la versión del evento. Son contrato: quien lo consuma compara
#: contra estos dos valores, así que cambiarlos es cambiar el contrato y
#: necesita una versión nueva, no una edición.
EVENTO = "candidato.confirmado"
VERSION = 1

#: Qué tipo de mensaje significa que la plata ya salió. Es la regla del
#: criterio «aviso futuro no genera un pago realizado», escrita UNA vez.
CREA_COBRO = {
    CobroCandidato.TipoMensaje.COBRO_REALIZADO: True,
    CobroCandidato.TipoMensaje.AVISO_DE_COBRO: False,
    CobroCandidato.TipoMensaje.PAGO_FALLIDO: False,
}

# ── Por qué no se confirma ───────────────────────────────────────────
# Códigos estables: el frontend decide por ellos (S3-CH-08 muestra el
# resultado candidato por candidato).
CANDIDATO_RECHAZADO = "candidato_rechazado"
SERVICIO_SIN_RESOLVER = "servicio_sin_resolver"
TIPO_SIN_REGLA = "tipo_sin_regla"


class ConfirmacionRechazada(ValueError):
    """No se puede confirmar este candidato. `codigo` es estable."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


def _sobre(candidato: CobroCandidato, *, crear_cobro: bool) -> dict:
    """Todo lo que el receptor necesita para crear sin preguntar nada.

    Va completo a propósito: un sobre que solo lleve el id obligaría al
    consumidor a consultar el esquema de otro servicio, que es justo lo que
    ADR-002 prohíbe.
    """
    return {
        "candidato_id": str(candidato.id),
        "importacion_id": str(candidato.importacion_id),
        "origen": candidato.origen,
        "identificador_origen": candidato.identificador_origen,
        "servicio": candidato.servicio,
        "servicio_texto": candidato.servicio_texto,
        # El importe va como TEXTO. En JSON un decimal lo lee el otro lado
        # como float y ahí se pierde la exactitud que se cuidó desde el
        # parser; y esto es, literalmente, plata de otra persona.
        #
        # OJO con el formato: la columna es NUMERIC(14,2), así que SIEMPRE
        # trae dos decimales, también en pesos. `9990` sale `"9990.00"`.
        # Comprobado igual en PostgreSQL y en SQLite. Es exacto, pero quien
        # lo consuma no puede suponer que un CLP viene sin decimales.
        "importe": str(candidato.importe),
        "moneda": candidato.moneda,
        "fecha": candidato.fecha.isoformat(),
        "tipo_mensaje": candidato.tipo_mensaje,
        #: La decisión, ya tomada. Ver el docstring del módulo.
        "crear_cobro": crear_cobro,
        "decidido_por": candidato.decidido_por,
        "evidencia": dict(candidato.evidencia),
    }


def confirmar(candidato: CobroCandidato, *, por: str = "", cuando=None) -> bool:
    """Confirma el candidato y deja la orden de crear. `True` si cambió algo.

    Idempotente: confirmar de nuevo devuelve `False`, **no** mueve
    `decidido_en` ni `decidido_por` y **no** agrega otra fila al outbox. Es el
    criterio de S3-CH-08: «repetir la acción no crea cobros dobles».

    Lanza `ConfirmacionRechazada` si el candidato no se puede confirmar.
    """
    if candidato.estado == CobroCandidato.Estado.RECHAZADO:
        raise ConfirmacionRechazada(
            CANDIDATO_RECHAZADO,
            "El candidato está rechazado: para confirmarlo hay que volver a "
            "importar el archivo.",
        )

    if candidato.estado == CobroCandidato.Estado.CONFIRMADO:
        # Ya estaba. Ni se toca la decisión ni se escribe otra orden.
        return False

    if not candidato.servicio:
        # Sin proveedor resuelto no se puede crear ni emparejar una
        # suscripción sin inventar su nombre: lo único que hay es la glosa de
        # la cartola, y una suscripción llamada "PAYPAL *SPOTIFY" no es un
        # dato, es basura con forma de dato. `servicio_resultado` dice si fue
        # ambiguo o desconocido.
        raise ConfirmacionRechazada(
            SERVICIO_SIN_RESOLVER,
            "No se reconoció el proveedor de este cobro "
            f"({candidato.servicio_resultado}): hay que resolverlo antes de "
            "confirmarlo.",
        )

    if candidato.tipo_mensaje not in CREA_COBRO:
        # No debería pasar: el tipo lo valida el dataclass al nacer. Pero si
        # algún día se agrega un tipo y nadie toca esta tabla, es mejor no
        # confirmar que decidir por omisión si hubo un pago o no.
        raise ConfirmacionRechazada(
            TIPO_SIN_REGLA,
            f"No hay regla para el tipo de mensaje {candidato.tipo_mensaje!r}.",
        )

    crear_cobro = CREA_COBRO[candidato.tipo_mensaje]
    ahora = cuando or timezone.now()

    with transaction.atomic():
        # La guarda va en el WHERE: dos peticiones simultáneas leen las dos
        # `propuesto`, y sin el filtro las dos escribirían su decisión y las
        # dos dejarían una orden. Dos órdenes son dos cobros.
        cambiadas = CobroCandidato.objects.filter(
            pk=candidato.pk, estado=CobroCandidato.Estado.PROPUESTO
        ).update(
            estado=CobroCandidato.Estado.CONFIRMADO,
            decidido_en=ahora,
            decidido_por=por,
            actualizado_en=ahora,
        )
        if cambiadas:
            # Se relee para que el sobre lleve la decisión ya escrita y no la
            # que esta instancia tenía en memoria.
            candidato.refresh_from_db()
            OutboxEvento.objects.create(
                organizacion_id=candidato.organizacion_id,
                evento=EVENTO,
                version=VERSION,
                ocurrido_en=ahora,
                correlation_id=uuid.uuid4(),
                datos=_sobre(candidato, crear_cobro=crear_cobro),
            )

    # ── Sin `set_rollback`, a propósito ─────────────────────────────────
    # Cuando el UPDATE afecta 0 filas no hay nada escrito que deshacer, y
    # marcar la transacción para rollback deja el bloque inutilizable: el
    # `refresh_from_db` de abajo moría con TransactionManagementError. Lo
    # encontró la prueba de la carrera, no la revisión.
    if not cambiadas:
        # Otra petición decidió primero. QUÉ decidió no se supone: se lee.
        #
        # Antes esto devolvía `False` siempre, dando por hecho que la otra era
        # una confirmación. Pero la que ganó puede ser un RECHAZO, y entonces
        # la vista respondía 200 con el candidato en `rechazado` y ninguna
        # orden: un "confirmado" que no confirmó nada. Reproducido con dos
        # conexiones a PostgreSQL por las dos revisiones de #159.
        candidato.refresh_from_db()
        if candidato.estado == CobroCandidato.Estado.RECHAZADO:
            raise ConfirmacionRechazada(
                CANDIDATO_RECHAZADO,
                "El candidato se rechazó mientras se confirmaba: para "
                "confirmarlo hay que volver a importar el archivo.",
            )
        # Ganó otra confirmación: la orden la escribió ella, una sola vez.
        return False

    return True
