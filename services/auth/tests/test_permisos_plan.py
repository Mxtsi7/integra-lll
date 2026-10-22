from uuid import uuid4
import pytest
from rest_framework.test import APIClient
from app.models import Contratacion, Organizacion, User
from app.planes import transicionar

pytestmark = pytest.mark.django_db


@pytest.fixture
def contexto(settings):
    settings.PBKDF2_ITERACIONES = 1000
    org = Organizacion.objects.create(nombre="Demo planes")
    usuario = User.objects.create_user(email="permisos@example.test", password="Clave123", nombre="Demo", organizacion=org, rol="titular")
    return usuario, {"HTTP_X_USUARIO_ID": str(usuario.pk), "HTTP_X_ORGANIZACION_ID": str(org.pk)}


def test_catalogo_es_decimal_demo_y_sin_efectos(contexto):
    usuario, cabeceras = contexto
    cliente = APIClient()
    datos = cliente.get("/api/planes/", **cabeceras).data
    assert [(p["codigo"], p["precio"]) for p in datos] == [("free", "0.00"), ("premium", "4990.00")]
    assert all(p["precio_demo"] and p["moneda"] == "CLP" for p in datos)
    assert not Contratacion.objects.exists()
    assert cliente.get("/api/usuarios/me/", **cabeceras).data["plan"] == "free"


def test_permisos_son_la_misma_fuente_que_perfil(contexto):
    usuario, cabeceras = contexto
    cliente = APIClient()
    for pagar in [False, True]:
        if pagar:
            contrato = Contratacion.objects.create(organizacion=usuario.organizacion, plan_id="premium", clave_idempotencia=uuid4(), importe="4990.00", moneda="CLP")
            transicionar(contrato.pk, "exitosa")
        permisos = cliente.get("/api/usuarios/me/permisos/", **cabeceras).data
        assert permisos["plan"] == cliente.get("/api/usuarios/me/", **cabeceras).data["plan"]
        assert permisos["features"] == {"asistente_financiero": pagar, "recomendaciones_automaticas": pagar}


@pytest.mark.parametrize("ruta", ["/api/planes/", "/api/usuarios/me/permisos/"])
def test_no_se_puede_fingir_otro_tenant(contexto, ruta):
    _, cabeceras = contexto
    assert APIClient().get(ruta).status_code == 403
    assert APIClient().get(ruta, **{**cabeceras, "HTTP_X_ORGANIZACION_ID": str(uuid4())}).status_code == 403
