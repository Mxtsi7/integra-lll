from importlib import import_module
from types import SimpleNamespace

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test.utils import CaptureQueriesContext


@pytest.mark.django_db
def test_carga_masiva_conserva_ediciones_y_repone_ausentes():
    apps = MigrationExecutor(connection).loader.project_state([("app", "0006_catalogo_paises")]).apps
    Pais = apps.get_model("app", "Pais")
    Pais.objects.filter(codigo="CL").update(nombre="Nombre editado", activo=False)
    Pais.objects.filter(codigo="AR").delete()
    cargar = import_module("app.migrations.0006_catalogo_paises").cargar
    with CaptureQueriesContext(connection) as consultas:
        cargar(apps, SimpleNamespace(connection=connection))
        cargar(apps, SimpleNamespace(connection=connection))
    assert Pais.objects.count() == 249
    chile = Pais.objects.get(codigo="CL")
    assert chile.nombre == "Nombre editado" and not chile.activo
    assert Pais.objects.filter(codigo="AR").exists()
    assert not any(q["sql"].lstrip().upper().startswith("SELECT") for q in consultas)
