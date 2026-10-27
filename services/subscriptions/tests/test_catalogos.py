from datetime import date
from io import StringIO
import uuid

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APIClient

from app.models import CategoriaSuscripcion, Cobro, Moneda, Proveedor, Subscription
from app.serializers import SubscriptionSerializer

pytestmark = pytest.mark.django_db


def payload(**extra):
    return dict(nombre="Servicio", monto="1000", moneda="CLP", categoria="otro",
                frecuencia="mensual", fecha_proximo_cobro="2026-10-10", **extra)


def crear():
    return Subscription.objects.create(organizacion_id=uuid.uuid4(), **payload())


def test_catalogos_globales_autenticados_ordenados_y_solo_lectura():
    cliente = APIClient()
    url = "/api/catalogos/suscripciones/"
    assert cliente.get(url).status_code == 403
    cliente.credentials(HTTP_X_USUARIO_ID=str(uuid.uuid4()))
    respuesta = cliente.get(url)
    assert respuesta.status_code == 200
    assert [o["codigo"] for o in respuesta.data["monedas"]] == ["CLP", "USD"]
    assert len(respuesta.data["categorias"]) == 10
    assert respuesta.data["frecuencias"] == [
        {"codigo": "mensual", "nombre": "Mensual"}, {"codigo": "anual", "nombre": "Anual"},
    ]
    assert respuesta.data["predeterminados"]["categoria"] == "otro"
    assert "organizacion_id" not in respuesta.data["categorias"][0]
    assert cliente.post(url, {}, format="json").status_code == 405
    assert cliente.get(url + "?incluir_inactivos=si").status_code == 400


def test_una_categoria_nueva_funciona_sin_cambiar_el_serializer():
    call_command("gestionar_catalogo", "categorias", "hogar", nombre="Hogar", orden=1, stdout=StringIO())
    data = payload()
    data["categoria"] = "HOGAR"
    serializer = SubscriptionSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    sub = serializer.save(organizacion_id=uuid.uuid4())
    assert sub.categoria == "hogar"
    assert serializer.data["categoria"] == "hogar"
    assert sub.get_categoria_display() == "Hogar"


@pytest.mark.parametrize("campo,codigo", [("moneda", "EUR"), ("categoria", "desconocida")])
def test_codigos_desconocidos_rechazados_por_api_y_orm(campo, codigo):
    data = payload()
    data[campo] = codigo
    serializer = SubscriptionSerializer(data=data)
    assert not serializer.is_valid()
    assert campo in serializer.errors
    with pytest.raises(ValidationError):
        Subscription.objects.create(organizacion_id=uuid.uuid4(), **data)


@pytest.mark.parametrize("cambios,campo", [
    ({"categoria": "desconocida"}, "categoria"),
    ({"estado": "cancelado"}, "estado"),
    ({"estado": "prueba"}, "fin_prueba"),
])
def test_creacion_valida_catalogos_y_reglas_de_estado(cambios, campo):
    data = payload()
    data.update(cambios)
    serializer = SubscriptionSerializer(data=data)
    assert not serializer.is_valid()
    assert campo in serializer.errors


@pytest.mark.parametrize("partial", [True, False])
def test_inactivo_se_conserva_pero_no_se_asigna(partial):
    sub = crear()
    call_command("gestionar_catalogo", "categorias", "otro", desactivar=True, stdout=StringIO())
    data = payload()
    data["nombre"] = "Nombre actualizado"
    serializer = SubscriptionSerializer(sub, data=data if not partial else {"nombre": "Actualizado", "categoria": "otro"}, partial=partial)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    nuevo = SubscriptionSerializer(data=payload())
    assert not nuevo.is_valid()
    assert "categoria" in nuevo.errors
    with pytest.raises(ValidationError):
        crear()
    cliente = APIClient()
    cliente.credentials(HTTP_X_USUARIO_ID="usuario")
    assert "otro" not in [o["codigo"] for o in cliente.get("/api/catalogos/suscripciones/").data["categorias"]]
    historico = cliente.get("/api/catalogos/suscripciones/?incluir_inactivos=true").data
    assert next(o for o in historico["categorias"] if o["codigo"] == "otro")["activo"] is False


def test_proveedores_y_cobros_validan_catalogo_y_conservan_historicos():
    sub = crear()
    proveedor = Proveedor.objects.create(nombre="Netflix", categoria="streaming")
    cobro = Cobro.objects.create(organizacion_id=sub.organizacion_id, suscripcion=sub, monto=10, fecha=date.today())
    call_command("gestionar_catalogo", "monedas", "CLP", desactivar=True, stdout=StringIO())
    cobro.monto = 20
    cobro.save()
    with pytest.raises(ValidationError):
        Cobro.objects.create(organizacion_id=sub.organizacion_id, suscripcion=sub, monto=10, fecha=date.today())
    proveedor.categoria = "no_existe"
    with pytest.raises(ValidationError):
        proveedor.save()


def test_carga_idempotente_no_pisa_nombre_orden_ni_desactivacion():
    call_command("gestionar_catalogo", "categorias", "musica", nombre="Audio", orden=3, desactivar=True, stdout=StringIO())
    call_command("gestionar_catalogo", cargar_iniciales=True, stdout=StringIO())
    call_command("gestionar_catalogo", cargar_iniciales=True, stdout=StringIO())
    opcion = CategoriaSuscripcion.objects.get(codigo="musica")
    assert (opcion.nombre, opcion.orden, opcion.activo) == ("Audio", 3, False)
    assert CategoriaSuscripcion.objects.count() == 10
    assert Moneda.objects.count() == 2
    opcion.codigo = "audio"
    with pytest.raises(ValidationError):
        opcion.save()
    with pytest.raises(ValidationError):
        opcion.delete()
    with pytest.raises(ValidationError):
        CategoriaSuscripcion.objects.filter(codigo="musica").delete()
    with pytest.raises(ValidationError):
        CategoriaSuscripcion.objects.filter(codigo="musica").update(codigo="audio")


@pytest.mark.django_db(transaction=True)
def test_migracion_preserva_datos_y_detecta_codigos_sin_catalogo():
    anterior = ("app", "0006_subscription_activo")
    destino = ("app", "0007_catalogos")
    executor = MigrationExecutor(connection)
    hojas = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([anterior])
        modelos = executor.loader.project_state([anterior]).apps
        historico = modelos.get_model("app", "Subscription").objects.create(
            organizacion_id=uuid.uuid4(), **payload()
        )
        executor = MigrationExecutor(connection)
        executor.migrate([destino])
        actual = Subscription.objects.get(pk=historico.pk)
        assert (actual.moneda, actual.categoria) == ("CLP", "otro")
        actual.nombre = "Sigue funcionando"
        actual.save()
        # SQL/actualizaciones masivas se usan aquí únicamente para simular datos legacy.
        Subscription.objects.filter(pk=actual.pk).update(categoria="legacy")
        MigrationExecutor(connection).migrate([anterior])
        with pytest.raises(RuntimeError, match="legacy"):
            MigrationExecutor(connection).migrate([destino])
        modelos.get_model("app", "Subscription").objects.filter(pk=actual.pk).update(categoria="otro")
    finally:
        # Restaurar incluso si falla una aserción en el diagnóstico.
        modelos.get_model("app", "Subscription").objects.filter(categoria="legacy").update(categoria="otro")
        MigrationExecutor(connection).migrate(hojas)
