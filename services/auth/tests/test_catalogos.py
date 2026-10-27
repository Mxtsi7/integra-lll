from io import StringIO
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient
from app.models import Pais

pytestmark = pytest.mark.django_db


def test_paises_cobertura_traduccion_autenticacion_y_solo_lectura():
    call_command("gestionar_catalogo", cargar_iniciales=True, stdout=StringIO())
    assert Pais.objects.count() == 249
    assert Pais.objects.get(codigo="CL").nombre == "Chile"
    assert "España" == Pais.objects.get(codigo="ES").nombre
    cliente = APIClient()
    url = "/api/catalogos/paises/"
    assert cliente.get(url).status_code == 403
    cliente.credentials(HTTP_X_USUARIO_ID="usuario")
    respuesta = cliente.get(url)
    assert respuesta.status_code == 200
    assert len(respuesta.data) == 249
    assert len({o["codigo"] for o in respuesta.data}) == 249
    assert cliente.post(url, {}, format="json").status_code == 405


def test_carga_paises_no_sobrescribe_cambios_y_oculta_inactivos():
    call_command("gestionar_catalogo", cargar_iniciales=True, stdout=StringIO())
    call_command("gestionar_catalogo", "paises", "CL", nombre="Chile editado", desactivar=True, stdout=StringIO())
    call_command("gestionar_catalogo", cargar_iniciales=True, stdout=StringIO())
    assert Pais.objects.count() == 249
    assert Pais.objects.get(codigo="CL").nombre == "Chile editado"
    cliente = APIClient()
    cliente.credentials(HTTP_X_USUARIO_ID="usuario")
    assert "CL" not in [o["codigo"] for o in cliente.get("/api/catalogos/paises/").data]
    assert "CL" in [o["codigo"] for o in cliente.get("/api/catalogos/paises/?incluir_inactivos=true").data]
