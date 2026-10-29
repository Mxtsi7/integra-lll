from datetime import datetime, timedelta, timezone as zona
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone
from redis.exceptions import ConnectionError

from app.models import ConsentimientoDisociado, EliminacionUsuario, Organizacion, User
from tests.test_eliminacion import eliminar, usuario

pytestmark = pytest.mark.django_db


def consentir(user, fecha):
    user.consentimiento_en = fecha
    user.save(update_fields=["consentimiento_en"])


def test_integrante_conserva_solo_su_evidencia_disociada():
    org = Organizacion.objects.create(nombre="Compartida")
    titular = usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    fecha = timezone.now() - timedelta(days=30)
    consentir(titular, fecha - timedelta(days=1))
    consentir(integrante, fecha)
    assert eliminar(integrante).status_code == 204
    assert list(ConsentimientoDisociado.objects.values_list("consentimiento_en", flat=True)) == [fecha]
    assert User.objects.filter(pk=titular.pk).exists()


def test_ultimo_titular_conserva_fechas_no_nulas_de_todos_los_afectados():
    org = Organizacion.objects.create(nombre="Eliminar")
    titular = usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    usuario(org, "sin-fecha@test.cl", User.Rol.INTEGRANTE)
    fecha = timezone.now() - timedelta(days=30)
    consentir(titular, fecha)
    consentir(integrante, fecha - timedelta(days=2))
    assert eliminar(titular, confirmacion_organizacion="ELIMINAR").status_code == 202
    assert set(ConsentimientoDisociado.objects.values_list("consentimiento_en", flat=True)) == {
        fecha, fecha - timedelta(days=2),
    }
    assert not User.objects.filter(organizacion=org).exists()
    # La evidencia no conserva campos que permitan enlazarla con usuario/tenant.
    assert {campo.name for campo in ConsentimientoDisociado._meta.fields} == {
        "id", "consentimiento_en", "eliminado_en", "retener_hasta",
    }
    assert all(registro.pk.version == 4 for registro in ConsentimientoDisociado.objects.all())


def test_retencion_seis_anos_calendario_desde_el_borrado_del_29_febrero():
    user = usuario(None)
    consentir(user, datetime(2023, 1, 1, tzinfo=zona.utc))
    eliminado = datetime(2024, 2, 29, 12, 30, tzinfo=zona.utc)
    with patch("app.eliminacion.timezone.now", return_value=eliminado):
        assert eliminar(user).status_code == 204
    evidencia = ConsentimientoDisociado.objects.get()
    assert evidencia.eliminado_en == datetime(2024, 2, 29, tzinfo=zona.utc)
    # Hasta el fin del 28 de febrero de 2030: nunca menos de seis años.
    assert evidencia.retener_hasta == datetime(2030, 3, 1, tzinfo=zona.utc)


def test_evidencia_guarda_solo_el_dia_y_no_se_cruza_con_la_operacion():
    """Con el instante exacto se volvía a vincular con la persona y la organización."""
    org = Organizacion.objects.create(nombre="Compartida")
    usuario(org)
    integrante = usuario(org, "integrante@test.cl", User.Rol.INTEGRANTE)
    consentir(integrante, datetime(2026, 1, 5, 9, 15, tzinfo=zona.utc))
    instante = datetime(2026, 10, 29, 18, 42, 7, 123456, tzinfo=zona.utc)
    with patch("app.eliminacion.timezone.now", return_value=instante):
        assert eliminar(integrante).status_code == 204
    operacion = EliminacionUsuario.objects.get(usuario_id=integrante.pk)
    assert operacion.creado_en == instante
    evidencia = ConsentimientoDisociado.objects.get()
    assert evidencia.eliminado_en == datetime(2026, 10, 29, tzinfo=zona.utc)
    assert evidencia.retener_hasta == datetime(2032, 10, 30, tzinfo=zona.utc)
    assert not ConsentimientoDisociado.objects.filter(eliminado_en=operacion.creado_en).exists()


def test_fallo_redis_conserva_usuario_sin_archivo_parcial():
    user = usuario(None)
    consentir(user, timezone.now())
    with patch("app.eliminacion.caches") as caches_mock:
        caches_mock.__getitem__.return_value.delete.side_effect = ConnectionError()
        assert eliminar(user).status_code == 503
    assert User.objects.filter(pk=user.pk).exists()
    assert not ConsentimientoDisociado.objects.exists()


def test_worker_purga_solo_evidencias_que_alcanzaron_la_retencion():
    ahora = timezone.now()
    for vencimiento in (ahora - timedelta(seconds=1), ahora, ahora + timedelta(days=1)):
        ConsentimientoDisociado.objects.create(
            consentimiento_en=ahora - timedelta(days=3000), eliminado_en=ahora - timedelta(days=2200),
            retener_hasta=vencimiento,
        )
    with patch("app.management.commands.procesar_eliminaciones.timezone.now", return_value=ahora):
        call_command("procesar_eliminaciones", verbosity=0)
    assert list(ConsentimientoDisociado.objects.values_list("retener_hasta", flat=True)) == [ahora + timedelta(days=1)]


def test_fallo_al_borrar_revierte_tambien_la_copia_de_evidencia():
    user = usuario(None)
    consentir(user, timezone.now())
    with patch("django.db.models.query.QuerySet.delete", side_effect=RuntimeError("fallo simulado")):
        with pytest.raises(RuntimeError):
            eliminar(user)
    assert User.objects.filter(pk=user.pk).exists()
    assert not ConsentimientoDisociado.objects.exists()
