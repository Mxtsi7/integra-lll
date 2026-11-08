"""S3-FE-01, S3-FE-11, S3-FE-12 y S3-FE-13 — leer un CSV y sacar candidatos.

Una prueba por criterio de aceptación de cada tarjeta, más los casos que
rompen de verdad una cartola real: separadores decimales al revés, fechas
que solo se entienden mirando el archivo entero, y el `$` solo.

Todo es función pura sobre bytes: sin base, sin red y sin API.
"""

from datetime import date
from decimal import Decimal

import pytest

from connectors import csv_candidatos as cc
from connectors.candidatos import (
    ORIGEN_CORREO,
    ORIGEN_CSV,
    Candidato,
    EstadoCandidato,
    TipoMensaje,
)

SHA = "a" * 64
ORG = "11111111-1111-1111-1111-111111111111"


def archivo(*lineas: str, separador: str = ";") -> bytes:
    return (chr(10).join(lineas) + chr(10)).encode("utf-8")


def leer(*lineas: str, **extra) -> cc.ResultadoLectura:
    """Lee un CSV de prueba declarando CLP por omisión.

    Una cartola chilena no trae columna de moneda, y el módulo se niega a
    suponerla: quien importa tiene que declararla. Las pruebas de ESE
    comportamiento están aparte, sobre `detectar_moneda`; acá se declara para
    que cada prueba falle solo por lo que está probando.
    """
    extra.setdefault("moneda_por_defecto", "CLP")
    return cc.leer(
        archivo(*lineas),
        separador=";",
        organizacion_id=ORG,
        sha256=SHA,
        **extra,
    )


# ══════════════════════════════════════════════════════════════════════
# S3-FE-11 — la cabecera se informa a nivel de archivo
# ══════════════════════════════════════════════════════════════════════


def test_falta_una_columna_obligatoria_y_el_error_es_del_archivo():
    with pytest.raises(cc.CsvInvalido) as e:
        leer("Fecha;Glosa", "13/04/2026;Netflix")
    assert e.value.codigo == cc.FALTAN_COLUMNAS
    # El mensaje tiene que decir cuál falta: "archivo inválido" no deja
    # arreglar nada.
    assert "monto" in e.value.mensaje


def test_la_cabecera_vacia_se_rechaza_entera():
    with pytest.raises(cc.CsvInvalido) as e:
        leer(";;", "13/04/2026;Netflix;5990")
    assert e.value.codigo == cc.CABECERA_VACIA


@pytest.mark.parametrize(
    "cabecera",
    [
        "Fecha;Descripcion;Monto",
        "FECHA;GLOSA;IMPORTE",
        "Fecha Movimiento;Detalle;Cargo",
        "  fecha  ;  Descripción  ;  Valor  ",
        "Date;Description;Amount",
    ],
)
def test_reconoce_como_llama_cada_banco_a_lo_mismo(cabecera):
    resultado = leer(cabecera, "13/04/2026;Netflix;5990")
    assert resultado.filas_validas == 1


def test_una_fila_mas_corta_que_la_cabecera_no_se_rellena_sola():
    resultado = leer("Fecha;Glosa;Monto", "13/04/2026;Netflix")
    assert resultado.filas_validas == 0
    assert resultado.errores[0].codigo == cc.FILA_INCOMPLETA


def test_una_fila_invalida_conserva_su_numero_y_su_motivo():
    resultado = leer(
        "Fecha;Glosa;Monto",
        "13/04/2026;Netflix;5990",
        "no es fecha;Spotify;3990",
    )
    assert [e.fila for e in resultado.errores] == [3]
    assert resultado.errores[0].codigo == cc.FECHA_INVALIDA
    assert "no es fecha" in resultado.errores[0].mensaje


def test_el_numero_de_fila_sobrevive_a_un_salto_de_linea_entre_comillas():
    # La glosa de la fila 2 ocupa dos líneas del archivo, así que el error de
    # la siguiente está en la línea 4, no en la 3.
    contenido = (
        'Fecha;Glosa;Monto' + chr(10)
        + '13/04/2026;"Netflix' + chr(10) + 'plan dúo";5990' + chr(10)
        + 'no es fecha;Spotify;3990' + chr(10)
    ).encode("utf-8")
    resultado = cc.leer(contenido, separador=";", organizacion_id=ORG, sha256=SHA, moneda_por_defecto="CLP")
    assert resultado.filas_validas == 1
    assert [e.fila for e in resultado.errores] == [4]


# ══════════════════════════════════════════════════════════════════════
# S3-FE-12 — valores canónicos
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "texto, moneda, esperado",
    [
        ("1234.56", "USD", Decimal("1234.56")),
        ("1.234,56", "USD", Decimal("1234.56")),   # es: punto de miles
        ("1,234.56", "USD", Decimal("1234.56")),   # en: coma de miles
        ("1234,5", "USD", Decimal("1234.5")),
        ("1.500", "CLP", Decimal("1500")),         # tres dígitos: miles
        ("1,500", "CLP", Decimal("1500")),
        ("5990", "CLP", Decimal("5990")),
        ("US$ 10.50", "USD", Decimal("10.50")),
        ("(1.500)", "CLP", Decimal("1500")),       # paréntesis = negativo
        ("-1.500", "CLP", Decimal("1500")),
        ("1.234.567", "CLP", Decimal("1234567")),
    ],
)
def test_los_casos_conocidos_dan_valores_canonicos(texto, moneda, esperado):
    assert cc.convertir_importe(texto, moneda) == esperado


def test_el_peso_chileno_no_admite_centavos():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.convertir_importe("1500,50", "CLP")
    assert e.value.codigo == cc.IMPORTE_INVALIDO
    assert "centavos" in e.value.mensaje


def test_un_monto_en_cero_no_es_un_cobro():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.convertir_importe("0", "CLP")
    assert e.value.codigo == cc.IMPORTE_CERO


@pytest.mark.parametrize("texto", ["", "   ", "abc", "1.2.3,4,5"])
def test_un_monto_que_no_se_entiende_se_rechaza(texto):
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.convertir_importe(texto, "CLP")
    assert e.value.codigo == cc.IMPORTE_INVALIDO


def test_la_fecha_iso_no_necesita_saber_nada_del_archivo():
    assert cc.convertir_fecha("2026-04-03", None) == date(2026, 4, 3)


def test_un_dia_mayor_que_doce_desambigua_la_fecha_sola():
    assert cc.convertir_fecha("13/04/2026", None) == date(2026, 4, 13)
    assert cc.convertir_fecha("04/13/2026", None) == date(2026, 4, 13)


def test_una_fecha_ambigua_se_rechaza_con_motivo():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.convertir_fecha("03/04/2026", None)
    assert e.value.codigo == cc.FECHA_AMBIGUA
    assert "día/mes o mes/día" in e.value.mensaje


def test_la_misma_fecha_ambigua_se_lee_segun_el_orden_declarado():
    assert cc.convertir_fecha("03/04/2026", cc.ORDEN_DMY) == date(2026, 4, 3)
    assert cc.convertir_fecha("03/04/2026", cc.ORDEN_MDY) == date(2026, 3, 4)


def test_una_fecha_que_no_existe_se_rechaza():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.convertir_fecha("31/02/2026", cc.ORDEN_DMY)
    assert e.value.codigo == cc.FECHA_INVALIDA


def test_una_sola_fila_con_dia_mayor_que_doce_desambigua_el_archivo_entero():
    resultado = leer(
        "Fecha;Glosa;Monto",
        "03/04/2026;Netflix;5990",   # sola seria ambigua
        "25/04/2026;Spotify;3990",   # esta fija el orden en dia/mes
    )
    assert resultado.errores == ()
    assert [c.fecha for c in resultado.candidatos] == [date(2026, 4, 3), date(2026, 4, 25)]


def test_un_archivo_que_se_contradice_en_el_orden_de_fecha_no_se_lee():
    with pytest.raises(cc.CsvInvalido) as e:
        leer(
            "Fecha;Glosa;Monto",
            "25/04/2026;Netflix;5990",   # solo se explica como dia/mes
            "04/25/2026;Spotify;3990",   # solo se explica como mes/dia
        )
    assert e.value.codigo == cc.ORDEN_FECHA_INCONSISTENTE


def test_el_peso_solo_es_ambiguo_y_no_se_adivina():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.detectar_moneda("$ 1.500", "", None)
    assert e.value.codigo == cc.MONEDA_AMBIGUA


def test_la_columna_de_moneda_manda_sobre_el_simbolo():
    assert cc.detectar_moneda("$ 1.500", "USD", "CLP") == "USD"


def test_el_simbolo_manda_sobre_el_valor_por_omision():
    assert cc.detectar_moneda("US$ 10", "", "CLP") == "USD"


def test_sin_moneda_por_ningun_lado_la_fila_se_rechaza():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.detectar_moneda("1500", "", None)
    assert e.value.codigo == cc.MONEDA_NO_INDICADA


def test_una_moneda_inventada_se_rechaza():
    with pytest.raises(cc._ErrorDeCampo) as e:
        cc.detectar_moneda("1500", "XYZ", None)
    assert e.value.codigo == cc.MONEDA_DESCONOCIDA


# ══════════════════════════════════════════════════════════════════════
# S3-FE-13 — los errores no se llevan las filas buenas
# ══════════════════════════════════════════════════════════════════════


def test_un_csv_mixto_entrega_validos_y_rechazos_trazables():
    resultado = leer(
        "Fecha;Glosa;Monto;Moneda",
        "13/04/2026;NETFLIX.COM 1234 SANTIAGO CL;5990;CLP",
        "14/04/2026;;3990;CLP",                      # sin descripcion
        "no es fecha;Spotify;3990;CLP",              # fecha ilegible
        "16/04/2026;Disney Plus;no es monto;CLP",    # monto ilegible
        "17/04/2026;Spotify;3990;CLP",
    )
    assert resultado.filas_totales == 5
    assert resultado.filas_validas == 2
    assert [e.fila for e in resultado.errores] == [3, 4, 5]
    assert [e.codigo for e in resultado.errores] == [
        cc.DESCRIPCION_VACIA,
        cc.FECHA_INVALIDA,
        cc.IMPORTE_INVALIDO,
    ]


def test_no_se_pierde_una_fila_valida_por_un_error_de_otra():
    resultado = leer(
        "Fecha;Glosa;Monto;Moneda",
        "13/04/2026;Netflix;no es monto;CLP",
        "14/04/2026;Spotify;3990;CLP",
    )
    assert resultado.filas_validas == 1
    assert resultado.candidatos[0].servicio_texto == "Spotify"
    assert resultado.hubo_errores


def test_los_errores_salen_con_las_tres_claves_que_guarda_importacion():
    resultado = leer("Fecha;Glosa;Monto;Moneda", "x;Netflix;5990;CLP")
    assert set(resultado.errores[0].como_json()) == {"fila", "codigo", "mensaje"}


def test_las_lineas_en_blanco_no_cuentan_como_filas():
    resultado = leer(
        "Fecha;Glosa;Monto;Moneda",
        "13/04/2026;Netflix;5990;CLP",
        "",
        "14/04/2026;Spotify;3990;CLP",
    )
    assert resultado.filas_totales == 2
    assert resultado.errores == ()


# ══════════════════════════════════════════════════════════════════════
# S3-FE-01 — el candidato común
# ══════════════════════════════════════════════════════════════════════


def test_el_candidato_de_csv_reutiliza_el_catalogo_de_proveedores():
    # Es el punto de no duplicar FE-12: la glosa cruda del banco tiene que
    # resolverse al nombre canónico sin que este módulo sepa de proveedores.
    resultado = leer("Fecha;Glosa;Monto;Moneda", "13/04/2026;NETFLIX.COM 1234 SANTIAGO CL;5990;CLP")
    candidato = resultado.candidatos[0]
    assert candidato.servicio == "Netflix"
    assert candidato.servicio_texto == "NETFLIX.COM 1234 SANTIAGO CL"
    assert candidato.servicio_resultado == "reconocido"


def test_un_nombre_que_no_se_reconoce_queda_para_revision_sin_inventar():
    resultado = leer("Fecha;Glosa;Monto;Moneda", "13/04/2026;PAGO LOCAL 4412;5990;CLP")
    candidato = resultado.candidatos[0]
    assert candidato.servicio is None
    assert candidato.servicio_para_revision
    assert candidato.servicio_texto == "PAGO LOCAL 4412"


def test_el_identificador_de_origen_no_cambia_al_releer_el_mismo_archivo():
    lineas = ("Fecha;Glosa;Monto;Moneda", "13/04/2026;Netflix;5990;CLP")
    primero = leer(*lineas).candidatos[0]
    segundo = leer(*lineas).candidatos[0]
    assert primero.identificador_origen == segundo.identificador_origen
    assert primero.clave_deduplicacion() == segundo.clave_deduplicacion()


def test_dos_filas_del_mismo_archivo_no_comparten_identificador():
    resultado = leer(
        "Fecha;Glosa;Monto;Moneda",
        "13/04/2026;Netflix;5990;CLP",
        "13/04/2026;Netflix;5990;CLP",   # el mismo cobro dos veces: son dos
    )
    identificadores = {c.identificador_origen for c in resultado.candidatos}
    assert len(identificadores) == 2


def test_correo_y_csv_producen_la_misma_forma():
    # El criterio de S3-FE-01. Un candidato de correo se arma a mano, como lo
    # hará S3-FE-09, y tiene que serializar con exactamente las mismas claves.
    del_csv = leer("Fecha;Glosa;Monto;Moneda", "13/04/2026;Netflix;5990;CLP").candidatos[0]
    del_correo = Candidato(
        origen=ORIGEN_CORREO,
        identificador_origen="<abc123@mail.netflix.com>",
        organizacion_id=ORG,
        servicio="Netflix",
        servicio_texto="Netflix",
        servicio_resultado="reconocido",
        importe=Decimal("5990"),
        moneda="CLP",
        fecha=date(2026, 4, 13),
        tipo_mensaje=TipoMensaje.AVISO_DE_COBRO,
        evidencia={"asunto": "Tu próximo cobro", "remitente": "info@netflix.com"},
    )
    assert set(del_csv.como_json()) == set(del_correo.como_json())
    assert del_csv.estado == del_correo.estado == EstadoCandidato.PROPUESTO


def test_el_importe_viaja_como_texto_y_no_como_numero():
    # Un Decimal serializado a float pierde exactitud, y esto es plata ajena.
    candidato = leer("Fecha;Glosa;Monto;Moneda", "13/04/2026;Netflix;5990,90;USD").candidatos[0]
    assert candidato.como_json()["importe"] == "5990.90"
    assert isinstance(candidato.como_json()["importe"], str)


def test_un_importe_float_no_entra_al_candidato():
    with pytest.raises(TypeError):
        Candidato(
            origen=ORIGEN_CSV,
            identificador_origen="x:2",
            organizacion_id=ORG,
            servicio=None,
            servicio_texto="x",
            servicio_resultado="desconocido",
            importe=5990.90,
            moneda="CLP",
            fecha=date(2026, 4, 13),
            tipo_mensaje=TipoMensaje.COBRO_REALIZADO,
        )


def test_una_cartola_en_latin1_se_lee_igual_que_al_validarla():
    # El mismo archivo pasó la validación de FE-07 decodificado en Latin-1.
    contenido = ("Fecha;Glosa;Monto;Moneda" + chr(10) + "13/04/2026;Telefón;5990;CLP" + chr(10)).encode("latin-1")
    resultado = cc.leer(contenido, separador=";", organizacion_id=ORG, sha256=SHA)
    assert resultado.filas_validas == 1
    assert "Telef" in resultado.candidatos[0].servicio_texto
