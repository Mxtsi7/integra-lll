import uuid

import pytest
from rest_framework.test import APIClient

from shared.borrado.models import EstadoOrganizacion
from shared.eliminacion import cabeceras_eliminacion


def limpiar(org):
    operacion = uuid.uuid4()
    firma = cabeceras_eliminacion("analytics", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/", {"operacion_id": str(operacion)}, format="json",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in firma.items()},
    )


def recomendacion(org):
    from django.utils import timezone
    from analytics.models import RecomendacionConsolidacion

    return RecomendacionConsolidacion.objects.create(
        id=uuid.uuid4(), organizacion_id=org, evento_origen_id=uuid.uuid4(),
        correlation_id=uuid.uuid4(), ocurrido_en=timezone.now(),
        categoria="streaming", suscripcion_id=uuid.uuid4(),
        suscripcion_nombre="Servicio", motivo="Solapamiento", ahorro_estimado="1000",
        moneda="CLP", evidencia_id="catalogo:1", evidencia_url="https://example.com/1",
        evidencia_descripcion="Funciones compartidas",
    )


@pytest.mark.django_db
def test_limpieza_incluye_proyecciones_y_descartes_sin_tocar_otro_tenant(monkeypatch):
    from django.utils import timezone
    from analytics.models import (
        CoberturaUso, RecomendacionConsolidacion, RecomendacionDescartada,
        SuscripcionObservada, UmbralAhorro, UsoMensual, UsoProyectado,
    )

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    hoy = timezone.localdate()
    umbral = UmbralAhorro.objects.create(moneda="CLP", monto="1000")
    for tenant in (org, otra):
        susc = uuid.uuid4()
        SuscripcionObservada.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, observada_desde=hoy,
        )
        CoberturaUso.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, desde=hoy, hasta=hoy,
        )
        UsoProyectado.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, evento_id=uuid.uuid4(),
            fecha=hoy, minutos=30,
        )
        UsoMensual.objects.create(
            organizacion_id=tenant, suscripcion_id=susc, mes=hoy.replace(day=1), minutos=30,
        )
        RecomendacionDescartada.objects.create(
            organizacion_id=tenant, recomendacion=recomendacion(tenant), descartado_por=42,
        )
    for _ in range(2):
        assert limpiar(org).status_code == 204
    for modelo in (
        SuscripcionObservada, CoberturaUso, UsoProyectado, UsoMensual,
        RecomendacionConsolidacion, RecomendacionDescartada,
    ):
        assert not modelo.objects.filter(organizacion_id=org).exists()
        assert modelo.objects.filter(organizacion_id=otra).count() == 1
    assert UmbralAhorro.objects.filter(pk=umbral.pk).exists()


@pytest.mark.django_db
def test_descarte_ajeno_bloquea_limpieza_y_revierte_marca(monkeypatch):
    from analytics.models import RecomendacionConsolidacion, RecomendacionDescartada

    monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
    org, otra = uuid.uuid4(), uuid.uuid4()
    rec = recomendacion(org)
    descarte = RecomendacionDescartada.objects.create(
        organizacion_id=otra, recomendacion=rec,
    )
    assert limpiar(org).status_code == 409
    assert RecomendacionConsolidacion.objects.filter(pk=rec.pk).exists()
    assert RecomendacionDescartada.objects.filter(pk=descarte.pk).exists()
    assert not EstadoOrganizacion.objects.filter(organizacion_id=org, eliminada=True).exists()


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
