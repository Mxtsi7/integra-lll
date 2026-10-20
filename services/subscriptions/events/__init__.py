"""Eventos de dominio del servicio de suscripciones (ADR-003).

    trabajo.py      el trabajo derivado; no sabe nada de colas
    publicador.py   lo publica en RabbitMQ con el sobre del catálogo
    despacho.py     decide si se ejecuta en línea o se publica
    management/commands/consumir_eventos.py   el que lo consume

El contrato de los eventos vive en shared/events/catalogo.md.
"""
