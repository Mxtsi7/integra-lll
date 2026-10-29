import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("origen", ["0002_cuenta_revocada", "0002_importaciones", "0003_autorizacion_y_revocacion"])
def test_actualizar_desde_ambas_ramas_conserva_datos(origen):
    destino = [("connectors", "0004_unir_eliminacion_oauth")]
    anterior = [("connectors", origen)]
    executor = MigrationExecutor(connection)
    try:
        # Volver al ancestro común retira también la otra rama independiente.
        executor.migrate([("connectors", "0001_initial")])
        executor = MigrationExecutor(connection)
        executor.migrate(anterior)
        apps = executor.loader.project_state(anterior).apps
        cuenta = apps.get_model("connectors", "CuentaConectada").objects.create(
            organizacion_id=uuid.uuid4(), proveedor="csv", cuenta_externa="cartola",
        )
        revocado = None
        if origen != "0002_importaciones":
            revocado = timezone.now()
            cuenta.revocado_en = revocado
            cuenta.save(update_fields=["revocado_en"])
        if origen != "0002_cuenta_revocada":
            importacion = apps.get_model("connectors", "Importacion").objects.create(
                organizacion_id=cuenta.organizacion_id, usuario_id="42",
                origen="correo", cuenta_id=cuenta.pk,
            )
        executor = MigrationExecutor(connection)
        executor.migrate(destino)
        apps = executor.loader.project_state(destino).apps
        actualizada = apps.get_model("connectors", "CuentaConectada").objects.get(pk=cuenta.pk)
        assert actualizada.cuenta_externa == "cartola"
        assert actualizada.revocado_en == revocado
        if origen != "0002_cuenta_revocada":
            assert apps.get_model("connectors", "Importacion").objects.get(
                pk=importacion.pk,
            ).cuenta_id == cuenta.pk
    finally:
        MigrationExecutor(connection).migrate(destino)
