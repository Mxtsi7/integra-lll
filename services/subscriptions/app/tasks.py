"""Tareas de despacho de eventos persistidos en el outbox."""

from celery import shared_task

from events.despacho import despachar_pendientes


@shared_task(name="app.tasks.despachar_eventos_pendientes")
def despachar_eventos_pendientes() -> dict[str, int]:
    return despachar_pendientes()
