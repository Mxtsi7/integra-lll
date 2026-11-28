"""Contrato del evento que connectors publica hacia Suscripciones.

Los nombres salen de `shared/events/catalogo.md`. Están acá, y no copiados en
cada archivo, para que el publicador y la topología usen la MISMA definición.
"""

EXCHANGE = "suscripciones"
EVENTO = "candidato.confirmado"
VERSION = 1
COLA = "subscriptions.confirmaciones"
EXCHANGE_FALLIDOS = "suscripciones.confirmaciones.fallidos"
COLA_FALLIDOS = "subscriptions.confirmaciones.fallidos"


def routing_key(evento) -> str:
    """Clave exacta de este contrato. Igual a la de MX-21: `{evento}.v{n}`."""
    return f"{evento.evento}.v{evento.version}"
