"""Una fila de inbox publicada antes de 0007 conserva la deduplicación."""
import json

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from notifications.consumo import recibir
from notifications.models import EventoRecibido
from tests.test_proyeccion import sobre


@pytest.mark.django_db(transaction=True)
def test_migrar_inbox_existente_asigna_consumidor_y_no_reaplica():
    anterior = [('notifications', '0006_eventorecibido')]
    nueva = [('notifications', '0007_inbox_por_consumidor')]
    executor = MigrationExecutor(connection)
    executor.migrate(anterior)
    mensaje = sobre()
    try:
        modelo = executor.loader.project_state(anterior).apps.get_model('notifications', 'EventoRecibido')
        modelo.objects.create(organizacion_id=mensaje['organizacion_id'], evento_id=mensaje['id'])
    finally:
        MigrationExecutor(connection).migrate(nueva)
    fila = EventoRecibido.objects.get()
    assert fila.consumidor == 'suscripciones.v2'
    assert not recibir(json.dumps(mensaje).encode())
    assert EventoRecibido.objects.count() == 1
