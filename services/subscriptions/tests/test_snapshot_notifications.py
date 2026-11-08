"""La extensión opcional fin_prueba llega a FE-18 sin inventar fechas."""
import datetime as dt
import uuid
from decimal import Decimal
from types import SimpleNamespace

from events.outbox import _snapshot


def test_snapshot_incluye_fin_prueba_real_o_null():
    suscripcion = SimpleNamespace(id=uuid.uuid4(), proveedor_id=None, nombre='Prueba',
        monto=Decimal('9990'), moneda='CLP', frecuencia='mensual',
        fecha_proximo_cobro=dt.date(2026, 11, 2), estado='prueba', fin_prueba=dt.date(2026, 11, 2))
    assert _snapshot(suscripcion)['fin_prueba'] == '2026-11-02'
    suscripcion.fin_prueba = None
    assert _snapshot(suscripcion)['fin_prueba'] is None
