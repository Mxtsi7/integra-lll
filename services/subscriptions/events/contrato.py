"""El contrato de transporte, que ahora vive en `shared/events/contrato.py`.

Se movió al compartido cuando Notifications empezó a consumir (FE-24): con
dos servicios hablando, una copia por servicio es la forma segura de que el
publicador y el consumidor terminen enlazados a claves distintas, y eso no
falla, simplemente no entrega nada nunca.

Este archivo se conserva para no tocar los imports de todo el servicio, que
dicen `from events.contrato import ...`. No agrega nada: lo único que hace es
reexportar, así que no hay una segunda definición que pueda divergir.
"""

from shared.events.contrato import EXCHANGE, routing_key


__all__ = ["EXCHANGE", "routing_key"]
