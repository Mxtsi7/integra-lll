import pytest

from app.serializers import UserSerializer


@pytest.mark.django_db
def test_user_serializer_creates_user_and_hides_password():
    serializer = UserSerializer(
        data={
            "email": "usuario@example.com",
            "nombre": "Usuario de Prueba",   # ← agregado
            "password": "ClaveSegura123",
        }
    )

    assert serializer.is_valid(), serializer.errors

    user = serializer.save()

    assert user.email == "usuario@example.com"
    assert user.nombre == "Usuario de Prueba"
    assert user.check_password("ClaveSegura123")

    response_data = UserSerializer(user).data

    assert response_data["email"] == "usuario@example.com"
    assert response_data["nombre"] == "Usuario de Prueba"
    assert "password" not in response_data