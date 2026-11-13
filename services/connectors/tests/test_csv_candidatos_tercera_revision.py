"""Tercera revisión de #147 — dos regresiones que introdujo la corrección anterior.

    1. Para no morir con una celda gigante, el lector atrapaba el error de
       `csv` y seguía leyendo. Pero después de ese error el lector retoma en
       la línea física siguiente, que puede ser TEXTO DE LA MISMA CELDA si
       venía entre comillas con saltos de línea: una línea interna con forma
       de cobro se guardaba como un candidato que la cartola nunca tuvo.

    2. Las filas rechazadas por estructura (columnas de más, celda demasiado
       larga) seguían votando en la inferencia del orden de fecha, y una de
       ellas podía contradecir a la única válida y botar el archivo entero.

Las dos reproducidas por la revisión con `archivos.validar` y `leer` reales.
"""

import csv
import threading
from datetime import date
from decimal import Decimal

import pytest

from connectors import csv_candidatos as cc

SHA = "a" * 64
ORG = "11111111-1111-1111-1111-111111111111"
NL = chr(10)


def leer(*lineas: str, **extra) -> cc.ResultadoLectura:
    extra.setdefault("moneda_por_defecto", "CLP")
    return cc.leer(
        (NL.join(lineas) + NL).encode("utf-8"),
        separador=";", organizacion_id=ORG, sha256=SHA, **extra,
    )


# ── 1. El registro CSV se respeta entero ────────────────────────────────────


def test_el_texto_de_una_glosa_rechazada_no_se_vuelve_un_candidato():
    """La reproducción de la revisión: Spotify válido, una glosa de 131.073
    caracteres entre comillas que contiene la línea `2026-10-02;Inventado;8888`,
    Netflix válido. Salían Spotify, Inventado/8888 y Netflix, y cinco filas."""
    glosa = "N" * 131_073 + NL + "2026-10-02;Inventado;8888" + NL + "fin de la glosa"
    r = leer(
        "fecha;descripcion;monto",
        "2026-10-01;Spotify;4990",
        f'2026-10-02;"{glosa}";9990',
        "2026-10-03;Netflix;8990",
    )
    assert [(c.servicio_texto, c.importe) for c in r.candidatos] == [
        ("Spotify", Decimal("4990")),
        ("Netflix", Decimal("8990")),
    ]
    # Un único rechazo, el de la fila que traía la celda; nada inventado.
    assert [e.codigo for e in r.errores] == [cc.CELDA_DEMASIADO_LARGA]
    assert r.filas_totales == 3
    assert "Inventado" not in str(r)


def test_la_fila_siguiente_a_una_celda_multilinea_conserva_su_numero():
    """El número de fila es el del archivo. Si el registro gigante ocupa las
    líneas 3 a 5, Netflix está en la 6 y el error apunta al registro."""
    glosa = "N" * 131_073 + NL + "segunda linea" + NL + "tercera linea"
    r = leer(
        "fecha;descripcion;monto",
        "2026-10-01;Spotify;4990",
        f'2026-10-02;"{glosa}";9990',
        "2026-10-03;Netflix;8990",
    )
    assert r.candidatos[1].evidencia["fila"] == "6"
    assert [e.fila for e in r.errores] == [5]


def test_muchas_lineas_internas_con_forma_de_cobro_tampoco_se_cuelan():
    """No es un caso de una sola línea: lo que se respeta es el registro."""
    internas = NL.join(f"2026-10-{dia:02d};Inventado {dia};{dia}000" for dia in range(1, 21))
    glosa = "N" * 131_073 + NL + internas
    r = leer(
        "fecha;descripcion;monto",
        f'2026-10-02;"{glosa}";9990',
        "2026-10-03;Netflix;8990",
    )
    assert [c.servicio_texto for c in r.candidatos] == ["Netflix"]
    assert len(r.errores) == 1 and r.filas_totales == 2


def test_una_glosa_multilinea_de_tamano_normal_se_sigue_leyendo():
    """Lo que no puede romperse: una glosa entre comillas con salto de línea
    y texto con forma de cobro es UNA celda, y se guarda como tal."""
    glosa = "Netflix" + NL + "2026-10-02;Inventado;8888"
    r = leer("fecha;descripcion;monto", f'2026-10-02;"{glosa}";9990')
    assert r.errores == ()
    assert [(c.servicio_texto, c.importe) for c in r.candidatos] == [(glosa, Decimal("9990"))]


def test_leer_deja_el_limite_del_lector_como_lo_encontro():
    """El tope de `csv` es estado global del proceso. Se sube mientras se lee
    —para que el registro llegue entero— y se devuelve, también si la lectura
    termina con un error del archivo."""
    antes = csv.field_size_limit()
    leer("fecha;descripcion;monto", "2026-10-02;" + "N" * 200_000 + ";9990")
    assert csv.field_size_limit() == antes
    with pytest.raises(cc.CsvInvalido):
        leer("fecha;" + "N" * 200_000)   # falta una columna obligatoria
    assert csv.field_size_limit() == antes


def test_dos_lecturas_simultaneas_no_se_pisan_el_limite(monkeypatch):
    """El cruce que rompe, forzado paso a paso y sin depender de la suerte:

        A entra a leer y sube el tope        (se detiene en su primera fila)
        B intenta entrar a leer su archivo
        A termina y DEVUELVE el tope chico
        B lee su celda gigante

    Sin el candado, B ya estaba adentro cuando A devolvió el tope: su celda
    vuelve a pasar el límite a mitad de registro y el archivo muere. Además
    B, al terminar, "devuelve" el tope alto que encontró, y queda así para
    todo el proceso. Con el candado B espera a que A termine.

    Probado quitando el candado: una versión que solo lanzaba hilos a la vez
    pasaba igual, porque nunca llegaban a cruzarse.
    """
    antes = csv.field_size_limit()
    real = csv.reader
    adentro = {"A": threading.Event(), "B": threading.Event()}
    soltar = {"A": threading.Event(), "B": threading.Event()}

    def lector_con_pausa(*args, **extra):
        filas = real(*args, **extra)
        nombre = threading.current_thread().name

        class Lector:
            line_num = 0
            pausado = False

            def __iter__(self):
                return self

            def __next__(self):
                if not self.pausado:
                    # Ya adentro de la lectura, con el tope subido.
                    self.pausado = True
                    adentro[nombre].set()
                    assert soltar[nombre].wait(15), f"nadie soltó a {nombre}"
                fila = next(filas)
                self.line_num = filas.line_num
                return fila

        return Lector()

    monkeypatch.setattr(cc.csv, "reader", lector_con_pausa)
    resultados, errores = {}, {}

    def trabajo():
        nombre = threading.current_thread().name
        try:
            glosa = "N" * 140_000 + NL + "2026-10-02;Inventado;8888"
            r = leer(
                "fecha;descripcion;monto",
                f'2026-10-02;"{glosa}";9990',
                "2026-10-03;Netflix;8990",
            )
            resultados[nombre] = [c.servicio_texto for c in r.candidatos]
        except BaseException as exc:  # noqa: BLE001
            errores[nombre] = exc

    a = threading.Thread(target=trabajo, name="A", daemon=True)
    b = threading.Thread(target=trabajo, name="B", daemon=True)
    a.start()
    assert adentro["A"].wait(15), "A no llegó a leer"
    b.start()
    # Con el candado, B no entra todavía; sin él, entra enseguida. Se le da
    # un momento para que, si puede entrar, entre: es lo que hace daño.
    adentro["B"].wait(1.0)
    soltar["A"].set()
    a.join(15)
    assert not a.is_alive()
    assert adentro["B"].wait(15), "B no llegó a leer"
    soltar["B"].set()
    b.join(15)
    assert not b.is_alive()

    assert errores == {}
    assert resultados == {"A": ["Netflix"], "B": ["Netflix"]}
    assert csv.field_size_limit() == antes


def test_si_el_lector_falla_por_otra_causa_el_archivo_no_se_lee_a_medias(monkeypatch):
    """Con el tope subido, `csv` ya no falla por tamaño. Si falla por otra
    cosa, no se sabe dónde termina el registro: seguir es lo que inventó el
    cobro. Se rechaza el archivo con un error que lo dice."""
    real = csv.reader

    def lector_que_falla(*args, **extra):
        filas = real(*args, **extra)

        class Lector:
            line_num = 0

            def __iter__(self):
                return self

            def __next__(self):
                fila = next(filas)
                self.line_num = filas.line_num
                if self.line_num == 3:
                    raise csv.Error("fallo del lector")
                return fila

        return Lector()

    monkeypatch.setattr(cc.csv, "reader", lector_que_falla)
    with pytest.raises(cc.CsvInvalido) as e:
        leer(
            "fecha;descripcion;monto",
            "2026-10-01;Spotify;4990",
            "2026-10-02;Rota;1",
            "2026-10-03;Netflix;8990",
        )
    assert e.value.codigo == cc.CSV_ILEGIBLE
    assert "3" in str(e.value)


# ── 2. Solo vota una fila que se va a leer ──────────────────────────────────


def test_una_fila_con_columnas_de_mas_no_vota_por_el_orden():
    """La reproducción de la revisión. `13/04/2026;Spotify;4990;sobrante`
    votaba por día/mes antes de rechazarse, contradecía al `04/13/2026`
    válido y el archivo entero moría con `orden_fecha_inconsistente`."""
    r = leer(
        "Fecha;Glosa;Monto",
        "13/04/2026;Spotify;4990;sobrante",
        "04/13/2026;Netflix;9990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [(2, cc.COLUMNAS_SOBRANTES)]
    assert [(c.servicio_texto, c.fecha) for c in r.candidatos] == [("Netflix", date(2026, 4, 13))]


def test_una_fila_con_una_celda_demasiado_larga_tampoco_vota():
    glosa = "N" * (cc.LARGO_MAXIMO_CELDA + 1)
    r = leer(
        "Fecha;Glosa;Monto",
        f"13/04/2026;{glosa};4990",
        "04/13/2026;Netflix;9990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [(2, cc.CELDA_DEMASIADO_LARGA)]
    assert [c.fecha for c in r.candidatos] == [date(2026, 4, 13)]


def test_una_fila_incompleta_tampoco_vota():
    """Misma razón: si a la fila le faltan columnas, lo que hay en la posición
    de la fecha no tiene por qué ser la fecha."""
    r = leer(
        "Glosa;Fecha;Monto",
        "13/04/2026",                 # una sola celda: no alcanza
        "Netflix;04/13/2026;9990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [(2, cc.FILA_INCOMPLETA)]
    assert [c.fecha for c in r.candidatos] == [date(2026, 4, 13)]


def test_la_fila_rechazada_por_estructura_no_ayuda_a_las_ambiguas():
    """La otra cara, y es consecuencia buscada: una fila que no se va a leer
    tampoco puede DESEMPATAR a favor de nadie. Sin ella, `03/04/2026` no se
    sabe si es marzo o abril, y se dice."""
    r = leer(
        "Fecha;Glosa;Monto",
        "13/04/2026;Spotify;4990;sobrante",
        "03/04/2026;Netflix;9990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [
        (2, cc.COLUMNAS_SOBRANTES),
        (3, cc.FECHA_AMBIGUA),
    ]


def test_la_contradiccion_entre_filas_validas_sigue_botando_el_archivo():
    """Lo que la corrección tenía que conservar: si dos filas que SÍ se leen
    solo se explican con órdenes distintos, el archivo está mal entero."""
    with pytest.raises(cc.CsvInvalido) as e:
        leer(
            "Fecha;Glosa;Monto",
            "13/04/2026;Spotify;4990",
            "04/13/2026;Netflix;9990",
        )
    assert e.value.codigo == cc.ORDEN_FECHA_INCONSISTENTE


def test_una_fila_con_el_monto_malo_si_vota_porque_su_fecha_es_de_fiar():
    """El límite de la regla. Un monto que no se entiende no dice nada sobre
    la columna de fecha: la fila está bien armada y su fecha es evidencia del
    formato del archivo. Lo que se excluye es la fila cuya ESTRUCTURA falla,
    porque ahí no se sabe qué hay en cada columna."""
    r = leer(
        "Fecha;Glosa;Monto",
        "13/04/2026;Spotify;no es un monto",
        "03/04/2026;Netflix;9990",
    )
    assert [(e.fila, e.codigo) for e in r.errores] == [(2, cc.IMPORTE_INVALIDO)]
    # Gracias a la primera fila se sabe que el archivo es día/mes.
    assert [c.fecha for c in r.candidatos] == [date(2026, 4, 3)]
