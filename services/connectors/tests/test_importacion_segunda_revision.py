"""Segunda revisión de #147, vista desde la importación.

`test_csv_candidatos_segunda_revision.py` prueba que el lector rechaza la fila.
Acá se prueba lo que le importa a quien subió el archivo: que la importación
TERMINA, que la fila buena queda guardada y que el error dice cuál fue la mala.
Los cuatro casos dejaban antes un monto equivocado o ninguna fila.
"""

from datetime import date, timedelta
from decimal import Decimal
import hashlib
import uuid

import pytest
from django.utils import timezone

from connectors import csv_candidatos, tasks
from connectors.models import ArchivoImportacion, CobroCandidato, Importacion

pytestmark = pytest.mark.django_db

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")


def procesar(*lineas: str) -> Importacion:
    contenido = (chr(10).join(lineas) + chr(10)).encode("utf-8")
    importacion = Importacion.objects.create(
        organizacion_id=ORG,
        usuario_id="42",
        origen=Importacion.Origen.CSV,
        nombre_archivo="cartola.csv",
        filas_totales=len(lineas) - 1,
    )
    ArchivoImportacion.objects.create(
        organizacion_id=ORG,
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


def guardados(importacion):
    return list(
        CobroCandidato.objects.filter(importacion=importacion)
        .order_by("fecha")
        .values_list("servicio_texto", "importe", "moneda", "fecha")
    )


def test_el_monto_partido_por_el_separador_no_llega_a_la_base():
    importacion = procesar(
        "fecha,descripcion,moneda,monto",
        "2026-10-01,SPOTIFY,CLP,4990",
        "2026-10-02,NETFLIX.COM,USD,1234,56",
    )
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert guardados(importacion) == [("SPOTIFY", Decimal("4990.00"), "CLP", date(2026, 10, 1))]
    # Lo que no puede existir: 1.234,00 USD guardados como si la cartola lo dijera.
    assert not CobroCandidato.objects.filter(moneda="USD").exists()
    assert [(e["fila"], e["codigo"]) for e in importacion.errores] == [
        (3, csv_candidatos.COLUMNAS_SOBRANTES)
    ]


def test_la_fecha_con_basura_no_llega_a_la_base():
    importacion = procesar(
        "fecha;descripcion;monto",
        "2026-10-01;SPOTIFY;4990",
        "2026-10-02basura;NETFLIX.COM;9990",
    )
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert [fila[0] for fila in guardados(importacion)] == ["SPOTIFY"]
    assert [(e["fila"], e["codigo"]) for e in importacion.errores] == [
        (3, csv_candidatos.FECHA_INVALIDA)
    ]


def test_una_fecha_mal_escrita_no_bota_el_archivo_entero():
    """Antes terminaba FALLIDA con `orden_fecha_inconsistente` y cero filas."""
    importacion = procesar(
        "fecha;descripcion;monto",
        "13//10//2026;NETFLIX.COM;9990",
        "10/13/2026;SPOTIFY;4990",
    )
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert guardados(importacion) == [("SPOTIFY", Decimal("4990.00"), "CLP", date(2026, 10, 13))]
    assert [e["codigo"] for e in importacion.errores] == [csv_candidatos.FECHA_INVALIDA]


def test_el_importe_fuera_de_rango_no_se_lleva_la_fila_valida():
    """El caso reproducido: la subida respondía 201, el `bulk_create` revertía
    el lote por la fila que no cabía y la válida se perdía con ella."""
    importacion = procesar(
        "fecha;descripcion;monto",
        "2026-10-01;NETFLIX.COM;9990",
        "2026-10-02;ERROR DEL BANCO;1.000.000.000.000",
    )
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert importacion.candidatos_detectados == 1
    assert [fila[0] for fila in guardados(importacion)] == ["NETFLIX.COM"]
    assert [(e["fila"], e["codigo"]) for e in importacion.errores] == [
        (3, csv_candidatos.IMPORTE_FUERA_DE_RANGO)
    ]


def test_el_importe_mas_grande_que_cabe_si_se_guarda():
    """El borde del lector y el de la columna son el mismo: lo que el lector
    acepta, la base lo guarda. En PostgreSQL un dígito más revienta."""
    importacion = procesar(
        "fecha;descripcion;monto;moneda",
        "2026-10-01;COMPRA GRANDE;999999999999,99;USD",
    )
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert guardados(importacion) == [
        ("COMPRA GRANDE", Decimal("999999999999.99"), "USD", date(2026, 10, 1))
    ]


def test_la_celda_gigante_no_deja_la_importacion_esperando_al_rescate():
    """El lector lanzaba `csv.Error` sin que nadie lo atrapara: la tarea moría,
    la importación se quedaba en `procesando` hasta el rescate y la fila
    válida no se guardaba nunca."""
    importacion = procesar(
        "fecha;descripcion;monto",
        "2026-10-01;NETFLIX.COM;9990",
        "2026-10-02;" + "N" * 131_073 + ";4990",
        "2026-10-03;SPOTIFY;4990",
    )
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert [fila[0] for fila in guardados(importacion)] == ["NETFLIX.COM", "SPOTIFY"]
    assert importacion.filas_totales == 3
    assert [(e["fila"], e["codigo"]) for e in importacion.errores] == [
        (3, csv_candidatos.CELDA_DEMASIADO_LARGA)
    ]
    # El error se guarda con la importación: no puede arrastrar la celda.
    assert len(importacion.errores[0]["mensaje"]) < 300
