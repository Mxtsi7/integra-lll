"""Contratos que connectors cruza con Suscripciones.

Los nombres salen de `shared/events/catalogo.md`. Están acá, y no copiados en
cada archivo, para que el publicador y el consumidor usen la MISMA definición.
"""

EXCHANGE = "suscripciones"

# Ida: connectors publica la orden de aplicar un candidato confirmado.
EVENTO = "candidato.confirmado"
VERSION = 1
COLA = "subscriptions.confirmaciones"
EXCHANGE_FALLIDOS = "suscripciones.confirmaciones.fallidos"
COLA_FALLIDOS = "subscriptions.confirmaciones.fallidos"

# Vuelta: Suscripciones publica el acuse; connectors lo consume aquí.
EVENTO_APLICADO = "candidato.aplicado"
VERSION_APLICADO = 1
COLA_APLICACIONES = "connectors.aplicaciones"
EXCHANGE_FALLIDOS_APLICACIONES = "suscripciones.aplicaciones.fallidos"
COLA_FALLIDOS_APLICACIONES = "connectors.aplicaciones.fallidos"


def routing_key(evento) -> str:
    """Clave exacta de este contrato. Igual a la de MX-21: `{evento}.v{n}`."""
    return f"{evento.evento}.v{evento.version}"
