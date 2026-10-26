import uuid

import pytest
from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion


@pytest.mark.django_db
def test_ack_analytics_persiste_marca_sin_cupos(monkeypatch):
    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, operacion = uuid.uuid4(), uuid.uuid4()
    firma = cabeceras_eliminacion("analytics", org, operacion)
    respuesta = APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )
    assert respuesta.status_code == 204
    assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada

@pytest.mark.django_db
def test_limpieza_cupos_ia_es_idempotente_y_conserva_otro_tenant(monkeypatch):
    from datetime import timedelta
    from django.utils import timezone
    from analytics.models import (
        ConsumoMensualIA, CupoIngesta, DocumentoIngesta, IntentoPDF,
    )

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra, operacion = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    ajenos = {}
    for tenant in (org, otra):
        cupo = CupoIngesta.objects.create(organizacion_id=tenant, usuario_id=42)
        documento = DocumentoIngesta.objects.create(
            cupo=cupo, clave=uuid.uuid4(),
            vence_en=timezone.now() + timedelta(minutes=5),
        )
        intento = IntentoPDF.objects.create(
            cupo=cupo, huella="a" * 64, dia=timezone.localdate(), intentos=2,
        )
        consumo = ConsumoMensualIA.objects.create(
            cupo=cupo, mes=timezone.localdate().replace(day=1), llamadas=3,
        )
        if tenant == otra:
            ajenos = {
                CupoIngesta: cupo.pk, DocumentoIngesta: documento.pk,
                IntentoPDF: intento.pk, ConsumoMensualIA: consumo.pk,
            }

    for _ in range(2):
        firma = cabeceras_eliminacion("analytics", org, operacion)
        respuesta = APIClient().delete(
            f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)},
            format="json",
            **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
        )
        assert respuesta.status_code == 204
        assert EstadoOrganizacion.objects.get(organizacion_id=org).eliminada
        assert not CupoIngesta.objects.filter(organizacion_id=org).exists()
        for modelo, pk in ajenos.items():
            assert modelo.objects.count() == 1
            assert modelo.objects.filter(pk=pk).exists()
