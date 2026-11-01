"""
FE-07 + MX-07 — la limpieza de la organización también borra los archivos.

Los archivos de importación son cartolas. La limpieza de connectors los borra
de forma explícita, antes que su importación, y no por cascada: un archivo de
OTRA organización colgado de una importación propia es un dato inconsistente
y tiene que bloquear con 409, no desaparecer sin aviso.
"""

import hashlib
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from connectors.models import ArchivoImportacion, Importacion

@pytest.mark.django_db
class TestLimpiezaDeLaOrganizacion:
    def _archivo(self, org, importacion_org=None):
        importacion = Importacion.objects.create(
            organizacion_id=importacion_org or org, usuario_id="42",
            origen=Importacion.Origen.CSV, nombre_archivo="cartola.csv",
        )
        datos = b"a;b\n1;2\n"
        return ArchivoImportacion.objects.create(
            importacion=importacion, organizacion_id=org, formato="csv",
            tamano=len(datos), sha256=hashlib.sha256(datos).hexdigest(),
            contenido=datos, vence_en=timezone.now() + timedelta(days=7),
        )

    def test_borra_los_archivos_de_la_organizacion_y_no_los_de_otra(self, monkeypatch):
        from tests.test_eliminacion import limpiar

        monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
        org, otra = uuid.uuid4(), uuid.uuid4()
        propio = self._archivo(org)
        ajeno = self._archivo(otra)
        assert limpiar(org).status_code == 204
        assert not ArchivoImportacion.objects.filter(pk=propio.pk).exists()
        assert ArchivoImportacion.objects.filter(pk=ajeno.pk).exists()

    def test_un_archivo_ajeno_colgado_de_una_importacion_propia_bloquea_con_409(
        self, monkeypatch
    ):
        """Dato inconsistente entre tenants: la cascada lo borraría sin aviso."""
        from shared.borrado.models import EstadoOrganizacion
        from tests.test_eliminacion import limpiar

        monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
        org, otra = uuid.uuid4(), uuid.uuid4()
        ajeno = self._archivo(otra, importacion_org=org)
        assert limpiar(org).status_code == 409
        assert ArchivoImportacion.objects.filter(pk=ajeno.pk).exists()
        assert Importacion.objects.filter(pk=ajeno.importacion_id).exists()
        assert not EstadoOrganizacion.objects.filter(organizacion_id=org, eliminada=True).exists()
