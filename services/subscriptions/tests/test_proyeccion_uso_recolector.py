"""La proyección conserva milisegundos y une fuentes sin tocar uso manual."""
import copy
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from pathlib import Path
from uuid import uuid4

import pytest
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from app.models import ProyeccionUsoRecolector, RegistroUso, Subscription

EJEMPLO = json.loads((Path(__file__).resolve().parents[3] /
    'docs/contratos/uso-recolectores-v1.ejemplos.json').read_text())['eventos_uso'][0]['evento']


@pytest.fixture
def destino(db, settings):
    settings.USO_VERIFICAR_CONSENTIMIENTO = lambda **contexto: True
    settings.USO_PERSISTIR_EVENTO = 'app.uso_recolectores.persistencia.persistir'
    return Subscription.objects.create(organizacion_id=uuid4(), nombre='Servicio',
        monto='1000', moneda='CLP', frecuencia='mensual', categoria='streaming',
        fecha_proximo_cobro='2026-11-20')


def evento_con_tramo(inicio, fin, recolector_id=None):
    evento = copy.deepcopy(EJEMPLO)
    evento['event_id'] = str(uuid4())
    evento['recolector_id'] = str(recolector_id or uuid4())
    evento['inicio'] = inicio.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    evento['fin'] = fin.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    evento['tramos_actividad'] = [{'inicio': evento['inicio'], 'fin': evento['fin']}]
    evento['duracion_ms'] = (fin - inicio) // timedelta(milliseconds=1)
    return evento


def enviar(destino, evento):
    return APIClient().post(
        f'/api/suscripciones/{destino.id}/uso/recolector/', evento, format='json',
        headers={'X-Organizacion-Id': str(destino.organizacion_id), 'X-Usuario-Id': '42'},
    )


def intervalo(segundos_desde_inicio, duracion_segundos):
    inicio = datetime(2026, 11, 9, 12, tzinfo=timezone.utc) + timedelta(seconds=segundos_desde_inicio)
    return inicio, inicio + timedelta(seconds=duracion_segundos)


def test_dos_fuentes_de_30_segundos_forman_un_minuto(destino):
    assert connection.vendor == 'postgresql'
    inicio, fin = intervalo(0, 30)
    primer_evento = evento_con_tramo(inicio, fin)
    assert enviar(destino, primer_evento).status_code == 201
    proyeccion = ProyeccionUsoRecolector.objects.get()
    assert proyeccion.duracion_union_ms == 30000
    assert proyeccion.duracion_union_ms % 60000 == 30000
    assert proyeccion.registro_uso is None

    inicio, fin = intervalo(30, 30)
    assert enviar(destino, evento_con_tramo(inicio, fin)).status_code == 201
    proyeccion.refresh_from_db()
    proyeccion.registro_uso.refresh_from_db()
    assert proyeccion.duracion_union_ms == 60000
    assert proyeccion.registro_uso.minutos == 1
    assert proyeccion.registro_uso.duracion_ms == 60000


@pytest.mark.parametrize(('inicio_segundo', 'duracion', 'total_esperado_ms'), [
    (60, 120, 180000),
    (20, 30, 50000),
])
def test_union_temporal_no_suma_solapamientos(destino, inicio_segundo, duracion, total_esperado_ms):
    inicio, fin = intervalo(0, 30 if total_esperado_ms == 50000 else 120)
    assert enviar(destino, evento_con_tramo(inicio, fin)).status_code == 201
    inicio, fin = intervalo(inicio_segundo, duracion)
    assert enviar(destino, evento_con_tramo(inicio, fin)).status_code == 201
    proyeccion = ProyeccionUsoRecolector.objects.get()
    assert proyeccion.duracion_union_ms == total_esperado_ms


def test_uso_recolector_se_agrega_sin_modificar_registro_manual(destino):
    manual = RegistroUso.objects.create(organizacion_id=destino.organizacion_id,
        suscripcion=destino, fecha='2026-11-09', minutos=5)
    inicio, fin = intervalo(0, 120)
    assert enviar(destino, evento_con_tramo(inicio, fin)).status_code == 201
    manual.refresh_from_db()
    recolector = RegistroUso.objects.get(origen='recolector')
    destino.refresh_from_db()
    assert manual.minutos == 5 and manual.origen == 'manual'
    assert recolector.minutos == 2
    assert destino.horas_uso_mes == Decimal('0.12')


@pytest.mark.django_db(transaction=True)
def test_eventos_distintos_simultaneos_no_pierden_el_residuo(destino):
    assert connection.vendor == 'postgresql', 'esta carrera debe correr en PostgreSQL'
    primer_inicio, primer_fin = intervalo(0, 30)
    segundo_inicio, segundo_fin = intervalo(30, 30)
    eventos = [evento_con_tramo(primer_inicio, primer_fin),
        evento_con_tramo(segundo_inicio, segundo_fin)]
    barrera = Barrier(2)

    def recibir(evento):
        close_old_connections()
        try:
            barrera.wait(timeout=5)
            return enviar(destino, evento).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as ejecutores:
        codigos = list(ejecutores.map(recibir, eventos))
    proyeccion = ProyeccionUsoRecolector.objects.get()
    registro = RegistroUso.objects.get(origen='recolector')
    assert codigos == [201, 201]
    assert proyeccion.duracion_union_ms == 60000
    assert registro.minutos == 1
