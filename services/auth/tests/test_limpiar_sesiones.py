from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command, CommandError
from django.utils import timezone

from app.models import Sesion, User


@pytest.mark.django_db
def test_limpieza_retiene_sesiones_vigentes_y_gracia_y_admite_dry_run():
    usuario = User.objects.create_user(email="limpieza@example.test", password="Clave123", nombre="Limpieza")
    ahora = timezone.now()
    sesiones = [Sesion.objects.create(usuario=usuario, refresh_jti=str(indice), vence_en=ahora + timedelta(days=dias), revocada=revocada)
                for indice, (dias, revocada) in enumerate([(1, False), (-1, False), (-8, False), (-8, True)])]
    salida = StringIO()
    with patch("app.management.commands.limpiar_sesiones.timezone.now", return_value=ahora):
        call_command("limpiar_sesiones", dry_run=True, stdout=salida)
        assert "2" in salida.getvalue()
        assert Sesion.objects.count() == 4
        call_command("limpiar_sesiones", stdout=StringIO())
    assert set(Sesion.objects.values_list("id", flat=True)) == {sesiones[0].pk, sesiones[1].pk}
    assert User.objects.filter(pk=usuario.pk).exists()


@pytest.mark.django_db
def test_limpieza_sin_retencion_no_borra_sesion_vigente():
    usuario = User.objects.create_user(email="limpieza@example.test", password="Clave123", nombre="Limpieza")
    vigente = Sesion.objects.create(usuario=usuario, refresh_jti="vigente", vence_en=timezone.now() + timedelta(days=1))
    Sesion.objects.create(usuario=usuario, refresh_jti="vencida", vence_en=timezone.now() - timedelta(seconds=1))
    call_command("limpiar_sesiones", dias_retencion=0, stdout=StringIO())
    assert list(Sesion.objects.values_list("id", flat=True)) == [vigente.pk]


def test_limpieza_rechaza_retencion_negativa():
    with pytest.raises(CommandError, match="mayor o igual"):
        call_command("limpiar_sesiones", dias_retencion=-1)
