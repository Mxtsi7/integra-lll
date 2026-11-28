"""La migración del acuse no cambia el sentido de los candidatos existentes."""

from datetime import date
from decimal import Decimal
import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from connectors.models import CobroCandidato

ANTERIOR = ("connectors", "0012_lectura_programada")
DESTINO = ("connectors", "0013_candidato_aplicado_en")


@pytest.mark.django_db(transaction=True)
def test_las_filas_existentes_quedan_pendientes_y_no_fingen_un_acuse():
    executor = MigrationExecutor(connection)
    hojas = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([ANTERIOR])
        modelos = executor.loader.project_state([ANTERIOR]).apps
        importacion_vieja = modelos.get_model("connectors", "Importacion").objects.create(
            organizacion_id=uuid.uuid4(),
            usuario_id=42,
            origen="csv",
            nombre_archivo="cartola.csv",
        )
        candidato_viejo = modelos.get_model(
            "connectors", "CobroCandidato"
        ).objects.create(
            organizacion_id=importacion_vieja.organizacion_id,
            importacion=importacion_vieja,
            origen="csv",
            identificador_origen="sha256:3",
            servicio="Netflix",
            servicio_texto="NETFLIX.COM",
            servicio_resultado="reconocido",
            importe=Decimal("9990.00"),
            moneda="CLP",
            fecha=date(2026, 10, 1),
            tipo_mensaje="cobro_realizado",
            estado="confirmado",
            evidencia={"fila": "3"},
        )

        executor = MigrationExecutor(connection)
        executor.migrate([DESTINO])

        actual = CobroCandidato.objects.get(pk=candidato_viejo.pk)
        assert actual.estado == CobroCandidato.Estado.CONFIRMADO
        assert actual.aplicado_en is None
    finally:
        MigrationExecutor(connection).migrate(hojas)
