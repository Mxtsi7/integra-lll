"""Las filas que ya existían antes de aplicar candidatos no cambian de sentido."""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from app.models import Cobro, TrabajoDerivado

ANTERIOR = ("app", "0021_consentimiento_recolector")
DESTINO = ("app", "0022_aplicar_confirmaciones")


@pytest.mark.django_db(transaction=True)
def test_la_migracion_da_origen_manual_a_los_cobros_existentes():
    """Un cobro cargado a mano sigue siendo manual y no inventa candidato.

    Además deja el choice nuevo disponible: una reentrega necesita poder
    acreditar `candidato_aplicado` con el mismo `evento_id` del sobre.
    """
    executor = MigrationExecutor(connection)
    hojas = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([ANTERIOR])
        modelos = executor.loader.project_state([ANTERIOR]).apps
        suscripcion_vieja = modelos.get_model("app", "Subscription").objects.create(
            organizacion_id=uuid.uuid4(),
            nombre="Netflix",
            monto=Decimal("9990.00"),
            moneda="CLP",
            frecuencia="mensual",
            fecha_proximo_cobro=date(2026, 10, 1),
            categoria="streaming",
        )
        cobro_viejo = modelos.get_model("app", "Cobro").objects.create(
            organizacion_id=suscripcion_vieja.organizacion_id,
            suscripcion=suscripcion_vieja,
            monto=Decimal("9990.00"),
            moneda="CLP",
            fecha=date(2026, 10, 1),
        )

        executor = MigrationExecutor(connection)
        executor.migrate([DESTINO])

        actual = Cobro.objects.get(pk=cobro_viejo.pk)
        assert actual.origen == Cobro.Origen.MANUAL
        assert actual.candidato_id is None
        assert TrabajoDerivado.Trabajo.CANDIDATO_APLICADO == "candidato_aplicado"
        assert "candidato_aplicado" in dict(TrabajoDerivado.Trabajo.choices)
    finally:
        MigrationExecutor(connection).migrate(hojas)
