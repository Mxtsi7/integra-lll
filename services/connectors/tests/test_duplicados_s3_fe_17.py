"""S3-FE-17 — evitar duplicados al importar o confirmar nuevamente un candidato.

Los criterios de la tarjeta:
- repetir o confirmar en paralelo no duplica suscripciones ni cobros
- el mismo origen en organizaciones distintas permanece aislado

Lo que faltaba de verdad era la REIMPORTACIÓN. El identificador de una fila
era `<sha del archivo>:<fila>`, así que solo se deduplicaba al subir el mismo
archivo byte por byte. Lo normal es otra cosa: la cartola de octubre, y un mes
después la de octubre y noviembre. Archivos distintos, el mismo cobro del 1 de
octubre, dos candidatos y —al confirmarlos— dos órdenes de crear el mismo
cobro. Reproducido antes de cambiar nada.

Confirmar dos veces y en paralelo ya estaba cubierto por S3-FE-15 (una sola
orden por candidato, con dos conexiones a PostgreSQL en
`test_carrera_confirmar_rechazar_postgres.py`). Acá se prueba que esa garantía,
sumada a la de la reimportación, cierra el camino completo: archivo → orden.
"""

from datetime import date, timedelta
from decimal import Decimal
import hashlib
import uuid

import pytest
from django.utils import timezone

from connectors import confirmacion, csv_candidatos, tasks
from connectors.models import ArchivoImportacion, CobroCandidato, Importacion, OutboxEvento

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
NL = chr(10)


def archivo(*lineas: str) -> bytes:
    return (NL.join(lineas) + NL).encode("utf-8")


def subir(contenido: bytes, org=ORG_A) -> Importacion:
    importacion = Importacion.objects.create(
        organizacion_id=org,
        usuario_id="42",
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
    )
    ArchivoImportacion.objects.create(
        organizacion_id=org,
        importacion=importacion,
        formato="csv",
        tamano=len(contenido),
        sha256=hashlib.sha256(contenido).hexdigest(),
        contenido=contenido,
        vence_en=timezone.now() + timedelta(days=7),
    )
    tasks.procesar_importacion(str(importacion.pk))
    importacion.refresh_from_db()
    return importacion


OCTUBRE = archivo(
    "fecha;descripcion;monto",
    "2026-10-01;NETFLIX.COM;9990",
    "2026-10-03;PAYPAL *SPOTIFY;4990",
)
OCTUBRE_Y_NOVIEMBRE = archivo(
    "fecha;descripcion;monto",
    "2026-10-01;NETFLIX.COM;9990",
    "2026-10-03;PAYPAL *SPOTIFY;4990",
    "2026-11-01;NETFLIX.COM;9990",
    "2026-11-03;PAYPAL *SPOTIFY;4990",
)


def confirmar_todos(org=ORG_A):
    for candidato in CobroCandidato.objects.filter(organizacion_id=org):
        confirmacion.confirmar(candidato, por="42")


# ── La reimportación ────────────────────────────────────────────────────────


def test_dos_exportaciones_que_se_traslapan_proponen_cada_cobro_una_vez():
    """La reproducción: octubre, y después octubre + noviembre."""
    subir(OCTUBRE)
    segunda = subir(OCTUBRE_Y_NOVIEMBRE)

    fechas = sorted(CobroCandidato.objects.values_list("fecha", flat=True))
    assert fechas == [date(2026, 10, 1), date(2026, 10, 3), date(2026, 11, 1), date(2026, 11, 3)]
    # La segunda importación cuenta como nuevos solo los de noviembre.
    assert segunda.candidatos_detectados == 2
    assert segunda.filas_totales == 4 and segunda.errores_totales == 0


def test_del_archivo_a_la_orden_un_cobro_real_es_una_sola_orden():
    """El criterio completo: importar dos veces y confirmar todo lo que se
    propone no puede dejar dos órdenes para el mismo cobro."""
    subir(OCTUBRE)
    confirmar_todos()
    subir(OCTUBRE_Y_NOVIEMBRE)
    confirmar_todos()
    # Y volver a confirmar todo, por si acaso: el doble clic.
    confirmar_todos()

    fechas = sorted(OutboxEvento.objects.values_list("datos__fecha", flat=True))
    assert fechas == ["2026-10-01", "2026-10-03", "2026-11-01", "2026-11-03"]


def test_subir_el_mismo_archivo_otra_vez_no_propone_nada_nuevo():
    subir(OCTUBRE)
    segunda = subir(OCTUBRE)

    assert CobroCandidato.objects.count() == 2
    # Lo que la vista previa necesita para explicar el "0 nuevos": todas las
    # filas se leyeron bien y ninguna era nueva.
    assert (segunda.filas_totales, segunda.candidatos_detectados, segunda.errores_totales) == (2, 0, 0)


@pytest.mark.parametrize("variante", [
    "2026-10-01;netflix.com;9990",          # mayúsculas
    "2026-10-01;  NETFLIX.COM  ;9990",      # espacios alrededor
    "2026-10-01;NETFLIX.COM;9.990",         # separador de miles
    "01/10/2026;NETFLIX.COM;9990",          # otro formato de fecha, mismo día
])
def test_la_misma_fila_escrita_distinto_sigue_siendo_el_mismo_cobro(variante):
    """Bancos y exportaciones distintas escriben el mismo cobro de formas
    distintas. Lo que se compara es lo que el lector entendió, no el texto."""
    subir(archivo("fecha;descripcion;monto", "2026-10-01;NETFLIX.COM;9990"))
    subir(archivo("fecha;descripcion;monto", variante), )

    assert CobroCandidato.objects.count() == 1


def test_el_mismo_monto_con_otra_cantidad_de_decimales_es_el_mismo_cobro():
    """`12.5` y `12.50` son el mismo importe: `Decimal` los distingue al
    escribirlos como texto, la huella no."""
    subir(archivo("fecha;descripcion;monto;moneda", "2026-10-01;SPOTIFY;12.5;USD"))
    subir(archivo("fecha;descripcion;monto;moneda", "2026-10-01;SPOTIFY;12.50;USD"))

    assert CobroCandidato.objects.count() == 1


def test_una_glosa_distinta_son_dos_candidatos():
    """Ante la duda se propone de más: un candidato sobrante se rechaza con un
    clic, uno perdido no se ve nunca."""
    subir(archivo("fecha;descripcion;monto", "2026-10-01;NETFLIX.COM;9990"))
    subir(archivo("fecha;descripcion;monto", "2026-10-01;NETFLIX.CL;9990"))

    assert CobroCandidato.objects.count() == 2


@pytest.mark.parametrize("cambio", [
    "2026-10-02;NETFLIX.COM;9990",   # otro día
    "2026-10-01;NETFLIX.COM;9991",   # otro monto
])
def test_otro_dia_u_otro_monto_es_otro_cobro(cambio):
    subir(archivo("fecha;descripcion;monto", "2026-10-01;NETFLIX.COM;9990"))
    subir(archivo("fecha;descripcion;monto", cambio))

    assert CobroCandidato.objects.count() == 2


def test_otra_moneda_es_otro_cobro():
    subir(archivo("fecha;descripcion;monto;moneda", "2026-10-01;NETFLIX.COM;9990;CLP"))
    subir(archivo("fecha;descripcion;monto;moneda", "2026-10-01;NETFLIX.COM;9990;USD"))

    assert CobroCandidato.objects.count() == 2


# ── Dos cobros iguales el mismo día ─────────────────────────────────────────


def test_dos_cobros_iguales_en_el_mismo_archivo_son_dos():
    """Dos licencias del mismo plan, cobradas el mismo día. Colapsarlas
    perdería una: la huella cuenta la ocurrencia dentro del archivo."""
    importacion = subir(archivo(
        "fecha;descripcion;monto",
        "2026-10-01;NETFLIX.COM;9990",
        "2026-10-01;NETFLIX.COM;9990",
    ))
    assert importacion.candidatos_detectados == 2


def test_el_segundo_cobro_igual_que_aparece_despues_entra_como_nuevo():
    """La primera exportación se hizo antes del segundo cobro del día; la
    segunda trae los dos. El primero coincide y el segundo es nuevo."""
    subir(archivo("fecha;descripcion;monto", "2026-10-01;NETFLIX.COM;9990"))
    segunda = subir(archivo(
        "fecha;descripcion;monto",
        "2026-10-01;NETFLIX.COM;9990",
        "2026-10-01;NETFLIX.COM;9990",
    ))
    assert CobroCandidato.objects.count() == 2
    assert segunda.candidatos_detectados == 1


def test_la_ocurrencia_cuenta_aunque_haya_otras_filas_entre_medio():
    importacion = subir(archivo(
        "fecha;descripcion;monto",
        "2026-10-01;NETFLIX.COM;9990",
        "2026-10-01;PAYPAL *SPOTIFY;4990",
        "2026-10-01;NETFLIX.COM;9990",
    ))
    assert importacion.candidatos_detectados == 3


# ── Lo que ya se decidió no se vuelve a proponer ────────────────────────────


def test_un_rechazado_no_vuelve_a_aparecer_al_reimportar():
    """Era la preocupación de S3-FE-16: rechazar no borra la fila, para que
    releer el origen no la proponga de nuevo. Ahora vale también para un
    archivo DISTINTO que trae el mismo cobro."""
    subir(OCTUBRE)
    netflix = CobroCandidato.objects.get(fecha=date(2026, 10, 1))
    assert netflix.rechazar(por="42")

    subir(OCTUBRE_Y_NOVIEMBRE)

    del_1_de_octubre = CobroCandidato.objects.filter(fecha=date(2026, 10, 1))
    assert del_1_de_octubre.count() == 1
    assert del_1_de_octubre.get().estado == CobroCandidato.Estado.RECHAZADO


def test_un_confirmado_no_deja_otra_orden_al_reimportar():
    subir(OCTUBRE)
    confirmar_todos()
    ordenes_antes = OutboxEvento.objects.count()

    subir(OCTUBRE)
    confirmar_todos()

    assert OutboxEvento.objects.count() == ordenes_antes == 2


# ── Aislamiento entre organizaciones ────────────────────────────────────────


def test_el_mismo_archivo_en_dos_organizaciones_son_cobros_de_cada_una():
    """La huella no lleva la organización: la restricción única de la base sí
    (`candidato_unico_por_origen` es organización + origen + identificador).
    Que A ya tenga el cobro no puede esconderlo de B."""
    de_a = subir(OCTUBRE, org=ORG_A)
    de_b = subir(OCTUBRE, org=ORG_B)

    assert de_a.candidatos_detectados == de_b.candidatos_detectados == 2
    assert CobroCandidato.objects.filter(organizacion_id=ORG_A).count() == 2
    assert CobroCandidato.objects.filter(organizacion_id=ORG_B).count() == 2

    confirmar_todos(ORG_A)
    confirmar_todos(ORG_B)
    assert OutboxEvento.objects.filter(organizacion_id=ORG_A).count() == 2
    assert OutboxEvento.objects.filter(organizacion_id=ORG_B).count() == 2


def test_decidir_en_una_organizacion_no_toca_la_otra():
    subir(OCTUBRE, org=ORG_A)
    subir(OCTUBRE, org=ORG_B)
    CobroCandidato.objects.get(organizacion_id=ORG_A, fecha=date(2026, 10, 1)).rechazar(por="42")

    de_b = CobroCandidato.objects.get(organizacion_id=ORG_B, fecha=date(2026, 10, 1))
    assert de_b.estado == CobroCandidato.Estado.PROPUESTO


# ── La huella ───────────────────────────────────────────────────────────────


def test_la_huella_es_estable_y_cabe_en_la_columna():
    datos = ("2026-10-01", "9990.00", "CLP", "netflix.com")
    primera = csv_candidatos.huella_csv(datos, 1)
    assert primera == csv_candidatos.huella_csv(datos, 1)
    assert primera != csv_candidatos.huella_csv(datos, 2)
    assert primera.startswith(csv_candidatos.PREFIJO_HUELLA_CSV)
    assert len(primera) <= CobroCandidato._meta.get_field("identificador_origen").max_length


def test_los_campos_de_la_huella_no_se_confunden_entre_si():
    """Con un separador que no aparece en los datos, mover texto de un campo
    al otro no puede dar la misma huella."""
    assert csv_candidatos.huella_csv(("2026-10-01", "1.00", "CLP", "a b"), 1) != \
        csv_candidatos.huella_csv(("2026-10-01", "1.00", "CLP a", "b"), 1)


def test_la_evidencia_conserva_el_archivo_y_la_fila_de_cada_lectura():
    """El candidato que sobrevive es el de la primera lectura, con SU archivo
    y SU fila: la procedencia no se pierde por haber deduplicado."""
    primera = subir(OCTUBRE)
    subir(OCTUBRE_Y_NOVIEMBRE)

    netflix = CobroCandidato.objects.get(fecha=date(2026, 10, 1))
    assert netflix.importacion_id == primera.pk
    assert netflix.evidencia["archivo_sha256"] == primera.archivo.sha256
    assert netflix.evidencia["fila"] == "2"
    assert netflix.importe == Decimal("9990")
