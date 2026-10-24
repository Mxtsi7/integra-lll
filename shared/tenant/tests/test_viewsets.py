"""
Los dos ViewSets de tenant: que expongan los verbos que prometen.

Esto existe por un error real. `SoloLecturaTenantViewSet` heredaba de
`(TenantViewSet, ReadOnlyModelViewSet)`, que parece lo natural y no funciona:
`TenantViewSet` es un `ModelViewSet`, así que `CreateModelMixin` queda primero
en el MRO y el router seguía aceptando POST, PUT y DELETE. Una clase llamada
"solo lectura" que dejaba escribir es peor que no tenerla, porque nadie la
revisa dos veces.

Se descubrió cuando una prueba de conectores esperaba 405 en un POST y
recibió un 201, con la fila creada.
"""

import pytest

from shared.tenant.base import MezclaTenant, SoloLecturaTenantViewSet, TenantViewSet

ESCRITURA = ("create", "update", "partial_update", "destroy")
LECTURA = ("list", "retrieve")


@pytest.mark.parametrize("verbo", ESCRITURA)
def test_el_de_solo_lectura_no_expone_escritura(verbo):
    assert not hasattr(SoloLecturaTenantViewSet, verbo), (
        f"SoloLecturaTenantViewSet expone {verbo}(): el router va a aceptar "
        "escrituras en un recurso declarado de solo lectura"
    )


@pytest.mark.parametrize("verbo", LECTURA)
def test_el_de_solo_lectura_si_expone_lectura(verbo):
    assert hasattr(SoloLecturaTenantViewSet, verbo)


@pytest.mark.parametrize("verbo", ESCRITURA + LECTURA)
def test_el_completo_expone_las_cinco_operaciones(verbo):
    assert hasattr(TenantViewSet, verbo)


@pytest.mark.parametrize("clase", [TenantViewSet, SoloLecturaTenantViewSet])
def test_los_dos_filtran_por_organizacion(clase):
    """El aislamiento no puede perderse al elegir uno u otro."""
    assert clase.get_queryset is MezclaTenant.get_queryset
