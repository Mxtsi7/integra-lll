import pytest
from django.core.management import call_command

from app.models import Organizacion, User


@pytest.mark.django_db
def test_seed_crea_el_usuario_demo_con_clave_hasheada_y_consentimiento():
    call_command("seed", correo="demo@test.cl", clave="ClaveDemo123", nombre="Demo")

    usuario = User.objects.get(email="demo@test.cl")

    assert usuario.nombre == "Demo"
    assert usuario.check_password("ClaveDemo123")
    assert usuario.password != "ClaveDemo123"
    assert usuario.consentimiento_en is not None
    assert usuario.is_active
    assert not usuario.is_staff


@pytest.mark.django_db
def test_seed_deja_al_usuario_como_titular_de_su_organizacion():
    """Sin organización el token sale sin `organizacion_id` y todo lo que
    dependa de una organización responde 403."""
    call_command("seed", correo="demo@test.cl", clave="ClaveDemo123", nombre="Demo")

    usuario = User.objects.get(email="demo@test.cl")

    assert usuario.organizacion is not None
    assert usuario.organizacion.nombre == "Hogar de Demo"
    assert usuario.rol == User.Rol.TITULAR


@pytest.mark.django_db
def test_seed_no_crea_una_organizacion_de_mas_al_repetirse():
    call_command("seed", correo="demo@test.cl", clave="ClaveDemo123", nombre="Demo")
    call_command("seed", correo="demo@test.cl", clave="ClaveDemo123", nombre="Demo")

    assert Organizacion.objects.count() == 1


@pytest.mark.django_db
def test_seed_es_idempotente_no_duplica_ni_cambia_la_clave():
    call_command("seed", correo="demo@test.cl", clave="ClaveDemo123")
    call_command("seed", correo="demo@test.cl", clave="OtraClave999")

    assert User.objects.filter(email="demo@test.cl").count() == 1
    assert User.objects.get(email="demo@test.cl").check_password("ClaveDemo123")


@pytest.mark.django_db
def test_seed_no_duplica_aunque_cambie_el_uso_de_mayusculas():
    call_command("seed", correo="demo@test.cl", clave="ClaveDemo123")
    call_command("seed", correo="DEMO@TEST.CL", clave="ClaveDemo123")

    assert User.objects.count() == 1
    assert User.objects.get().email == "demo@test.cl"


@pytest.mark.django_db
def test_seed_lee_las_credenciales_del_entorno(monkeypatch):
    monkeypatch.setenv("SEED_CORREO", "otra@test.cl")
    monkeypatch.setenv("SEED_CLAVE", "ClaveDelEntorno1")
    monkeypatch.setenv("SEED_NOMBRE", "Del Entorno")

    call_command("seed")

    usuario = User.objects.get(email="otra@test.cl")
    assert usuario.nombre == "Del Entorno"
    assert usuario.check_password("ClaveDelEntorno1")
