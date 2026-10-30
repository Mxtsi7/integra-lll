import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from connectors.models import CuentaConectada, Importacion
from shared.borrado.models import EstadoOrganizacion

PUBLICADA = ("connectors", "0003_autorizacion_y_revocacion")
DE_ESTA_PR = ("borrado", "0001_initial")


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("origen", ["0002_importaciones", "0003_autorizacion_y_revocacion"])
def test_migraciones_publicadas_conservan_datos(origen, claves):
    # Una base de main: connectors en una migración publicada y sin `borrado`.
    anterior = [("connectors", origen), ("borrado", None)]
    destino = MigrationExecutor(connection).loader.graph.leaf_nodes()
    try:
        executor = MigrationExecutor(connection)
        executor.migrate([("connectors", "0001_initial"), ("borrado", None)])
        executor = MigrationExecutor(connection)
        executor.migrate(anterior)
        apps = executor.loader.project_state([("connectors", origen)]).apps
        cuenta = apps.get_model("connectors", "CuentaConectada").objects.create(
            organizacion_id=uuid.uuid4(), proveedor="gmail", cuenta_externa="p@gmail.com",
            access_token="ya29.token", refresh_token="1//refresh",
        )
        revocado = None
        if origen != "0002_importaciones":
            revocado = timezone.now()
            cuenta.revocado_en = revocado
            cuenta.save(update_fields=["revocado_en"])
        importacion = apps.get_model("connectors", "Importacion").objects.create(
            organizacion_id=cuenta.organizacion_id, usuario_id="42",
            origen="correo", cuenta_id=cuenta.pk,
        )

        # Desde main solo se aplica la migración de esta PR; desde 0002,
        # además la publicada que le sigue. Ninguna publicada cambia.
        executor = MigrationExecutor(connection)
        plan = [(migracion.app_label, migracion.name) for migracion, _ in executor.migration_plan(destino)]
        esperado = [DE_ESTA_PR] if origen == PUBLICADA[1] else [PUBLICADA, DE_ESTA_PR]
        assert sorted(plan) == sorted(esperado)
        executor.migrate(destino)

        actualizada = CuentaConectada.objects.get(pk=cuenta.pk)
        assert actualizada.cuenta_externa == "p@gmail.com"
        assert actualizada.revocado_en == revocado
        # Los tokens cifrados antes de migrar se siguen descifrando.
        assert actualizada.access_token == "ya29.token"
        assert actualizada.refresh_token == "1//refresh"
        assert Importacion.objects.get(pk=importacion.pk).cuenta_id == cuenta.pk
        # La marca de borrado ya existe en el esquema de connectors.
        EstadoOrganizacion.objects.create(organizacion_id=cuenta.organizacion_id)
    finally:
        MigrationExecutor(connection).migrate(destino)
