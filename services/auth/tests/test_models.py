from django.contrib.auth import get_user_model

import pytest


@pytest.mark.django_db
def test_create_user_normalizes_email_and_hashes_password():
    User = get_user_model()

    raw_email = "Usuario@EJEMPLO.COM"
    raw_password = "clave-secreta-123"

    user = User.objects.create_user(
        email=raw_email,
        password=raw_password,
    )

    assert user.email == "Usuario@ejemplo.com"
    assert user.password != raw_password
    assert user.check_password(raw_password)
