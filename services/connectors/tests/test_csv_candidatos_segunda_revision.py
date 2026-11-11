"""Segunda revisión de #147 — cuatro casos reproducidos con API y worker reales.

Los cuatro tienen la misma forma: el archivo trae algo que no se entiende y
el lector, en vez de rechazar ESA fila, o se la inventa o se lleva puestas
las buenas.

    1. columnas de más            se guardaba un monto truncado
    2. fecha con basura           se aceptaba por su principio
    3. importe fuera de rango     reventaba al insertar y se perdía el lote
    4. celda gigante              el lector lanzaba y la tarea moría

Todo es función pura sobre bytes, igual que `test_csv_candidatos.py`. Lo que
pasa después —que la importación termine y las filas buenas queden guardadas—
está en `test_procesar_importacion.py`.
"""

from datetime import date
from decimal import Decimal

import pytest

from connectors import csv_candidatos as cc

SHA = "a" * 64
ORG = "11111111-1111-1111-1111-111111111111"


def archivo(*lineas: str) -> bytes:
    return (chr(10).join(lineas) + chr(10)).encode("utf-8")


def leer(*lineas: str, separador: str = ";", **extra) -> cc.ResultadoLectura:
    extra.setdefault("moneda_por_defecto", "CLP")
    return cc.leer(
        archivo(*lineas), separador=separador, organizacion_id=ORG, sha256=SHA, **extra
    )


# ── 1. Columnas de más ──────────────────────────────────────────────────────


def test_un_monto_partido_por_el_separador_no_se_guarda_truncado():
    """`USD,1234,56` bajo las columnas moneda y monto: el separador del
    archivo es la coma y el monto traía coma decimal sin comillas. La fila
    tiene una celda más que la cabecera. Antes la sobrante se ignoraba y se
    guardaban 1.234,00 USD sin un solo error."""
    r = leer(
        "fecha,descripcion,moneda,monto",
        "2026-10-01,Spotify,CLP,4990",
        "2026-10-02,Netflix,USD,1234,56",
        separador=",",
    )
    assert [c.servicio_texto for c in r.candidatos] == ["Spotify"]
    assert [(e.fila, e.codigo) for e in r.errores] == [(3, cc.COLUMNAS_SOBRANTES)]
    assert "5" in r.errores[0].mensaje and "4" in r.errores[0].mensaje


def test_una_glosa_con_el_separador_sin_comillas_tampoco_se_adivina():
    """La celda sobrante no siempre cae al final del monto: una glosa con
    coma corre TODAS las columnas siguientes. Adivinar cuál sobra es inventar."""
    r = leer(
        "fecha,descripcion,monto,moneda",
        "2026-10-02,Netflix, plan premium,9990,CLP",
        separador=",",
    )
    assert r.candidatos == ()
    assert [e.codigo for e in r.errores] == [cc.COLUMNAS_SOBRANTES]


def test_una_glosa_con_el_separador_entre_comillas_si_se_lee():
    """Con comillas no hay columna de más: es una sola celda."""
    r = leer(
        "fecha,descripcion,monto,moneda",
        '2026-10-02,"Netflix, plan premium",9990,CLP',
        separador=",",
    )
    assert r.errores == ()
    assert r.candidatos[0].servicio_texto == "Netflix, plan premium"


def test_un_separador_final_de_adorno_no_es_una_columna_de_mas():
    """Más de un banco exporta cada línea terminada en el separador. Esas
    celdas vacías al final no traen datos y no hay nada que perder."""
    r = leer(
        "Fecha;Glosa;Monto;",
        "13/04/2026;Netflix;9990;",
        "14/04/2026;Spotify;4990;;",
    )
    assert r.errores == ()
    assert [c.importe for c in r.candidatos] == [Decimal("9990"), Decimal("4990")]


def test_una_celda_de_mas_con_contenido_se_rechaza_aunque_venga_tras_vacias():
    r = leer("Fecha;Glosa;Monto", "13/04/2026;Netflix;9990;;algo")
    assert r.candidatos == ()
    assert [e.codigo for e in r.errores] == [cc.COLUMNAS_SOBRANTES]


# ── 2. La fecha se valida ENTERA ────────────────────────────────────────────


@pytest.mark.parametrize("texto", [
    "2026-10-02basura",
    "2026-10-02 basura",
    "2026-10-02T25:00:00",      # hora imposible
    "2026-10-02T10:61:00",      # minuto imposible
    "2026-10-02X10:30:00",
    "2026-10-0210:30",
    "2026-13-02",               # mes imposible con forma ISO
    "2026-02-30",               # día que no existe
    "13//10//2026",
    "13/10//2026",
    "13/-10/2026",
    "13/10-2026",               # separadores distintos
    "13/10/2026x",
    "/13/10/2026",
    "13/10/20261",
    "13/10/202",
    "113/10/2026",
])
def test_una_fecha_con_basura_no_se_acepta_por_su_principio(texto):
    """`2026-10-02basura` se guardaba como 2 de octubre porque solo se miraban
    los primeros diez caracteres, y `13//10//2026` porque las partes vacías
    entre separadores se descartaban."""
    r = leer("Fecha;Glosa;Monto", f"{texto};Netflix;9990", orden_fecha=cc.ORDEN_DMY)
    assert r.candidatos == ()
    assert [e.codigo for e in r.errores] == [cc.FECHA_INVALIDA]
    assert texto in r.errores[0].mensaje


@pytest.mark.parametrize("texto, esperada", [
    ("2026-10-02", date(2026, 10, 2)),
    ("2026-10-02 10:30:00", date(2026, 10, 2)),
    ("2026-10-02T10:30:00", date(2026, 10, 2)),
    ("2026-10-02T10:30", date(2026, 10, 2)),
    ("2026-10-02T10:30:00.123", date(2026, 10, 2)),
    ("2026-10-02T10:30:00Z", date(2026, 10, 2)),
    ("2026-10-02T10:30:00-03:00", date(2026, 10, 2)),
    ("2026/10/02", date(2026, 10, 2)),
    ("13/10/2026", date(2026, 10, 13)),
    ("13-10-2026", date(2026, 10, 13)),
    ("13.10.2026", date(2026, 10, 13)),
    ("3/4/26", date(2026, 4, 3)),
    ("  13/10/2026  ", date(2026, 10, 13)),
])
def test_las_fechas_que_si_se_entienden_se_siguen_entendiendo(texto, esperada):
    """La validación completa no puede costar un formato que antes servía."""
    assert cc.convertir_fecha(texto, cc.ORDEN_DMY) == esperada


def test_una_fecha_mal_escrita_no_vota_por_el_orden_del_archivo():
    """`13//10//2026` votaba por día/mes. Junto a un `10/13/2026` legítimo
    —que solo se explica como mes/día— el archivo entero moría con
    `orden_fecha_inconsistente`: una fila mal escrita se llevaba las buenas."""
    r = leer(
        "Fecha;Glosa;Monto",
        "13//10//2026;Netflix;9990",
        "10/13/2026;Spotify;4990",
        "04/05/2026;Disney;7990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [(2, cc.FECHA_INVALIDA)]
    # La única fila que demuestra un orden es la válida: mes/día.
    assert [c.fecha for c in r.candidatos] == [date(2026, 10, 13), date(2026, 4, 5)]


@pytest.mark.parametrize("texto", ["13//10//2026", "13/10/2026x", "13/10-2026", "2026-10-02basura"])
def test_detectar_orden_ignora_lo_que_no_es_una_fecha_completa(texto):
    assert cc.detectar_orden_fecha([texto]) is None


# ── 3. El importe cabe en la columna ────────────────────────────────────────


def test_un_importe_que_no_cabe_en_la_columna_se_rechaza_en_su_fila():
    """Un billón de pesos pasaba el lector y reventaba al insertar: la subida
    respondía 201, el lote entero se revertía y la fila válida de al lado se
    perdía con él."""
    r = leer(
        "Fecha;Glosa;Monto",
        "13/04/2026;Netflix;9990",
        "14/04/2026;Error del banco;1.000.000.000.000",
    )
    assert [c.importe for c in r.candidatos] == [Decimal("9990")]
    assert [(e.fila, e.codigo) for e in r.errores] == [(3, cc.IMPORTE_FUERA_DE_RANGO)]


@pytest.mark.parametrize("texto, moneda, cabe", [
    ("999.999.999.999", "CLP", True),
    ("1.000.000.000.000", "CLP", False),
    ("999999999999,99", "USD", True),
    ("1000000000000,00", "USD", False),
    ("9" * 40, "CLP", False),
])
def test_el_borde_del_rango_es_el_de_la_columna(texto, moneda, cabe):
    if cabe:
        assert cc.convertir_importe(texto, moneda) <= cc.IMPORTE_MAXIMO
    else:
        with pytest.raises(cc._ErrorDeCampo) as e:
            cc.convertir_importe(texto, moneda)
        assert e.value.codigo == cc.IMPORTE_FUERA_DE_RANGO


def test_el_maximo_del_lector_es_el_de_la_columna_del_modelo():
    """El número vive en el lector, que no importa Django, y la columna en el
    modelo. Si alguien cambia uno sin el otro, esta prueba lo dice: un lector
    más permisivo que la columna es justo el defecto que se corrigió."""
    from connectors.models import CobroCandidato

    campo = CobroCandidato._meta.get_field("importe")
    enteros = campo.max_digits - campo.decimal_places
    maximo = Decimal("9" * enteros + "." + "9" * campo.decimal_places)
    assert cc.IMPORTE_MAXIMO == maximo


# ── 4. Una celda más larga de lo que el lector acepta ───────────────────────


def test_una_celda_gigante_se_rechaza_en_su_fila_y_las_demas_se_leen():
    """131.073 caracteres en una celda caben en el tamaño de archivo permitido,
    pero el lector de CSV corta en 131.072 con un error que nadie atrapaba:
    la tarea moría, la importación esperaba al rescate y la fila válida se
    perdía. El comportamiento del lector está comprobado contra el de verdad:
    lanza en esa línea y sigue leyendo bien la siguiente."""
    gigante = "N" * 131_073
    r = leer(
        "Fecha;Glosa;Monto",
        "13/04/2026;Spotify;4990",
        f"14/04/2026;{gigante};9990",
        "15/04/2026;Netflix;8990",
    )
    assert [c.servicio_texto for c in r.candidatos] == ["Spotify", "Netflix"]
    assert [(e.fila, e.codigo) for e in r.errores] == [(3, cc.CELDA_DEMASIADO_LARGA)]
    assert r.filas_totales == 3
    # El número de fila de la que viene DESPUÉS no se corrió.
    assert r.candidatos[1].evidencia["fila"] == "4"
    # El mensaje no puede arrastrar la celda: es justo lo que no cabía.
    assert len(r.errores[0].mensaje) < 300


def test_una_celda_larga_pero_legible_se_rechaza_con_el_mismo_error():
    """El límite es nuestro y es uno solo: no depende de en qué punto exacto
    se rinde el lector de CSV."""
    larga = "N" * (cc.LARGO_MAXIMO_CELDA + 1)
    justa = "N" * cc.LARGO_MAXIMO_CELDA
    r = leer(
        "Fecha;Glosa;Monto",
        f"13/04/2026;{larga};4990",
        f"14/04/2026;{justa};9990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [(2, cc.CELDA_DEMASIADO_LARGA)]
    assert len(r.candidatos) == 1
    assert len(r.errores[0].mensaje) < 300


def test_el_limite_propio_queda_por_debajo_del_del_lector():
    """Si el nuestro fuera mayor, entre los dos habría una franja donde quien
    decide es el lector, y con su mensaje."""
    import csv

    assert cc.LARGO_MAXIMO_CELDA < csv.field_size_limit()


def test_una_cabecera_ilegible_es_un_error_del_archivo():
    """Si lo que no se puede leer es la cabecera, no hay filas que rescatar."""
    gigante = "N" * 131_073
    with pytest.raises(cc.CsvInvalido) as e:
        leer(f"Fecha;{gigante};Monto", "13/04/2026;Netflix;9990")
    assert e.value.codigo == cc.CABECERA_ILEGIBLE
