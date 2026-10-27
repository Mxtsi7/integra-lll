"""Prueba el publicador de producción contra RabbitMQ real, sin dobles."""
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pika
from django.conf import settings

settings.configure(RABBITMQ_URL=os.environ["RABBITMQ_URL"])
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/subscriptions"))
from events.publicador import publicar


def main():
    conexion = pika.BlockingConnection(pika.URLParameters(settings.RABBITMQ_URL))
    try:
        canal = conexion.channel()
        canal.exchange_declare(exchange="suscripciones", exchange_type="topic", durable=True)
        cola = canal.queue_declare(queue="", exclusive=True).method.queue
        ruta = "suscripcion.creada.v2"
        canal.queue_bind(queue=cola, exchange="suscripciones", routing_key=ruta)
        evento = SimpleNamespace(id=uuid4(), correlation_id=uuid4(), organizacion_id=uuid4(),
            evento="suscripcion.creada", version=2, ocurrido_en=datetime.now(timezone.utc),
            datos={"suscripcion_id": str(uuid4()), "proveedor_id": None, "nombre": "Prueba",
                   "monto": "1000.00", "moneda": "CLP", "ciclo": "mensual",
                   "proximo_cobro": "2026-11-01", "estado": "activo"})
        assert publicar(evento) is None
        entrega, propiedades, cuerpo = canal.basic_get(queue=cola, auto_ack=True)
        assert entrega is not None
        assert propiedades.message_id == str(evento.id)
        assert json.loads(cuerpo)["organizacion_id"] == str(evento.organizacion_id)
        # Una ruta única sin consumidores debe devolver UnroutableError.
        evento.evento = f"prueba.sin_ruta.{uuid4()}"
        try:
            publicar(evento)
        except pika.exceptions.UnroutableError:
            pass
        else:
            raise AssertionError("El broker debía rechazar la ruta sin consumidores")
        print("Publicación confirmada y rechazo obligatorio verificados con RabbitMQ real")
    finally:
        conexion.close()


if __name__ == "__main__":
    main()
