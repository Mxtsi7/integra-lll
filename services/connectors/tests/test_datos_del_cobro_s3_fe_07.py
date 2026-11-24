"""S3-FE-07 — importe, moneda y fecha de los correos.

Criterios de la tarjeta:
- los ejemplos válidos conservan precisión;
- los campos ambiguos quedan señalados para revisión.

Los textos imitan recibos reales en español y en inglés. Lo que se espera de
cada uno se fijó corriendo el extractor y revisando la salida a mano
(13-11-2026); dos de esas corridas encontraron defectos que se corrigieron
antes de escribir las pruebas (el «Subtotal» que contaba como total y el `$`
que tapaba el código de moneda que venía después).
"""

import uuid
from datetime import date, datetime, timezone as tz
from decimal import Decimal

import pytest

from connectors import tipo_de_aviso
from connectors.datos_del_cobro import AMBIGUO, AUSENTE, CONFIRMADO, SUPUESTO, datos_de, leer_numero
from connectors.lectura_correo import MensajeCorreo

RECIBIDO = datetime(2026, 10, 3, 12, 0, tzinfo=tz.utc)

#: Las frases con que S3-FE-08 reconoce un cobro anunciado. Fuera quedan los
#: «recordatorio»: no dicen de qué es la fecha que traen, que puede ser la
#: del propio aviso («Recordatorio de pago — 28 de octubre de 2026»).
FRASES_QUE_ANUNCIAN_UN_COBRO = sorted(
    frase
    for tipo in (tipo_de_aviso.AVISO_DE_COBRO, tipo_de_aviso._PROXIMO_CICLO)
    for frase in tipo_de_aviso.EVIDENCIA[tipo]
    if "recordatorio" not in frase and "reminder" not in frase
)


def datos(texto, asunto=""):
    return datos_de(MensajeCorreo(
        cuenta_id=uuid.uuid4(), id_mensaje="1", id_hilo="", recibido_en=RECIBIDO, remitente="x",
        asunto=asunto, texto=texto,
    ))


def resumen(texto, asunto=""):
    d = datos(texto, asunto)
    return (d.importe.valor, d.importe.estado), (d.moneda.valor, d.moneda.estado), (d.fecha.valor, d.fecha.estado)


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — los ejemplos válidos conservan precisión
# ══════════════════════════════════════════════════════════════════════


class TestEjemplosValidos:
    def test_recibo_chileno(self):
        assert resumen("Plan Estándar\nTotal: CLP 9.990\nFecha de cobro: 1 de octubre de 2026") == (
            (Decimal("9990"), CONFIRMADO), ("CLP", CONFIRMADO), (date(2026, 10, 1), CONFIRMADO))

    def test_recibo_en_ingles(self):
        texto = "Premium Individual  US$ 12.99\nTotal charged: US$12.99\nBilling date: October 1, 2026"
        assert resumen(texto) == (
            (Decimal("12.99"), CONFIRMADO), ("USD", CONFIRMADO), (date(2026, 10, 1), CONFIRMADO))

    def test_euros_con_coma_decimal_y_fecha_iso(self):
        assert resumen("Importe: 12,50 EUR\nFecha de pago: 2026-10-01") == (
            (Decimal("12.50"), CONFIRMADO), ("EUR", CONFIRMADO), (date(2026, 10, 1), CONFIRMADO))

    def test_la_precision_es_exacta(self):
        d = datos("Total: 1.234,56 EUR")
        assert d.importe.valor == Decimal("1234.56")
        assert isinstance(d.importe.valor, Decimal)
        assert str(d.importe.valor) == "1234.56"

    def test_subtotal_e_iva_no_compiten_con_el_total(self):
        texto = "Subtotal: $8.395\nIVA: $1.595\nTotal: $9.990 CLP\nFecha: 15/10/2026"
        assert resumen(texto) == (
            (Decimal("9990"), CONFIRMADO), ("CLP", CONFIRMADO), (date(2026, 10, 15), CONFIRMADO))

    def test_el_codigo_despues_del_signo_dice_la_moneda(self):
        assert resumen("Total: $9.990 CLP")[1] == ("CLP", CONFIRMADO)

    def test_el_total_gana_a_una_linea_de_detalle(self):
        texto = "Premium  US$ 12.99\nTax US$ 1.04\nTotal US$ 14.03"
        assert resumen(texto)[0] == (Decimal("14.03"), CONFIRMADO)

    def test_un_solo_monto_sin_etiqueta(self):
        assert resumen("Gracias por tu pago de CLP 4.990")[0] == (Decimal("4990"), CONFIRMADO)

    def test_el_mismo_total_repetido_no_es_ambiguo(self):
        assert resumen("Total: CLP 9.990\nTotal pagado: CLP 9.990")[0] == (Decimal("9990"), CONFIRMADO)

    @pytest.mark.parametrize("texto, fecha", [
        ("Fecha: 15/10/2026", date(2026, 10, 15)),
        ("Fecha: 10/15/2026", date(2026, 10, 15)),
        ("Fecha: 01/01/2026", date(2026, 1, 1)),
        ("Date: Oct 1, 2026", date(2026, 10, 1)),
        ("Date: 1 Oct 2026", date(2026, 10, 1)),
        ("Fecha: 1 de septiembre de 2026", date(2026, 9, 1)),
        ("Fecha: 2026-02-28", date(2026, 2, 28)),
    ])
    def test_fechas_que_no_dejan_dudas(self, texto, fecha):
        assert resumen(texto)[2] == (fecha, CONFIRMADO)

    def test_la_fecha_etiquetada_gana_a_otra_del_texto(self):
        texto = "Tu próximo cobro será el 2026-11-01\nFecha de cobro: 2026-10-01"
        assert resumen(texto)[2] == (date(2026, 10, 1), CONFIRMADO)

    def test_el_asunto_tambien_cuenta(self):
        assert resumen("", asunto="Recibo por CLP 3.990")[0] == (Decimal("3990"), CONFIRMADO)

    def test_las_etiquetas_se_comparan_como_palabra(self):
        """«activación» contiene «iva», y no por eso el cargo es un impuesto."""
        assert resumen("Cargo por activación: CLP 2.000")[0] == (Decimal("2000"), CONFIRMADO)

    def test_cuenta_la_etiqueta_mas_cercana_al_monto(self):
        assert resumen("Descuento aplicado, total: CLP 8.990")[0] == (Decimal("8990"), CONFIRMADO)

    def test_el_fragmento_queda_para_la_evidencia(self):
        d = datos("Hola\nTotal: CLP 9.990\nChao")
        assert d.importe.fragmento == "Total: CLP 9.990"


class TestLeerNumero:
    @pytest.mark.parametrize("texto, valor, decimales", [
        ("9.990", Decimal("9990"), 0), ("9,990", Decimal("9990"), 0), ("9990", Decimal("9990"), 0),
        ("12.99", Decimal("12.99"), 2), ("12,5", Decimal("12.5"), 1), ("1.234,56", Decimal("1234.56"), 2),
        ("1,234.56", Decimal("1234.56"), 2), ("1.234.567", Decimal("1234567"), 0),
        ("1 234", Decimal("1234"), 0), ("1 234,50", Decimal("1234.50"), 2),
    ])
    def test_validos(self, texto, valor, decimales):
        assert leer_numero(texto) == (valor, decimales)

    @pytest.mark.parametrize("texto", [
        "1.2.3", "1.234.56", "12.34.567", "1,234,56", "1.23,456", "1234.567.890", "1,2345",
        "1.234,567",  # miles con dos signos distintos
    ])
    def test_mal_agrupados(self, texto):
        assert leer_numero(texto) is None


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — los campos ambiguos quedan señalados para revisión
# ══════════════════════════════════════════════════════════════════════


class TestAmbiguos:
    def test_el_signo_pesos_solo_no_dice_la_moneda(self):
        d = datos("Total: $9.990")
        assert (d.importe.valor, d.importe.estado) == (Decimal("9990"), CONFIRMADO)
        assert (d.moneda.valor, d.moneda.estado) == (None, AMBIGUO)
        assert ("moneda", "el monto viene con `$` solo: pueden ser pesos o dólares") in d.para_revision

    def test_dia_y_mes_intercambiables(self):
        d = datos("Fecha: 01/10/2026")
        assert (d.fecha.valor, d.fecha.estado) == (None, AMBIGUO)
        assert "2026-01-10" in d.fecha.motivo and "2026-10-01" in d.fecha.motivo

    def test_dos_totales_distintos(self):
        d = datos("Total: CLP 9.990\nTotal: CLP 10.990")
        assert (d.importe.valor, d.importe.estado) == (None, AMBIGUO)
        assert "9990" in d.importe.motivo and "10990" in d.importe.motivo

    def test_montos_en_dos_monedas(self):
        d = datos("Total: US$ 12.99\nTotal: CLP 12.990")
        assert d.moneda.estado == AMBIGUO and "CLP" in d.moneda.motivo and "USD" in d.moneda.motivo

    def test_dos_fechas_etiquetadas_distintas(self):
        d = datos("Fecha de compra: 2026-10-01\nFecha de cobro: 2026-10-02")
        assert (d.fecha.valor, d.fecha.estado) == (None, AMBIGUO)

    def test_centavos_en_una_moneda_sin_centavos(self):
        d = datos("Total: CLP 9.990,50")
        assert d.importe.estado == AMBIGUO and "CLP" in d.importe.motivo

    def test_solo_subtotales_o_impuestos(self):
        d = datos("IVA: CLP 1.595")
        assert (d.importe.valor, d.importe.estado) == (None, AMBIGUO)

    def test_sin_fecha_se_supone_la_de_recepcion_y_se_avisa(self):
        d = datos("Total: CLP 9.990")
        assert (d.fecha.valor, d.fecha.estado) == (date(2026, 10, 3), SUPUESTO)
        assert d.para_revision == (("fecha", d.fecha.motivo),)

    def test_sin_monto_queda_ausente(self):
        d = datos("Gracias por tu compra")
        assert (d.importe.estado, d.moneda.estado) == (AUSENTE, AUSENTE)
        assert [c for c, _ in d.para_revision] == ["importe", "moneda", "fecha"]

    def test_todo_confirmado_no_pide_revision(self):
        assert datos("Total: CLP 9.990\nFecha: 2026-10-01").para_revision == ()


class TestLoQueNoEsUnMonto:
    def test_un_numero_sin_moneda_no_es_un_monto(self):
        assert datos("Pedido 12345, 3 productos").importe.estado == AUSENTE

    def test_el_espacio_comun_no_agrupa_miles(self):
        assert resumen("Recibimos tu pago de $10 100 productos")[0] == (Decimal("10"), CONFIRMADO)

    def test_una_palabra_que_contiene_date_no_es_etiqueta(self):
        """«Update» contiene «date»: no hace que la fecha suelta pase por
        etiquetada por delante de la que sí lo está."""
        texto = "Update: 2026-11-05\nFecha de cobro: 2026-10-01"
        assert resumen(texto)[2] == (date(2026, 10, 1), CONFIRMADO)

    @pytest.mark.parametrize("texto", ["XCLP 9.990", "Pedido 9.990 CLPX", "Ref EURO 12,50"])
    def test_un_codigo_dentro_de_una_palabra_no_es_moneda(self, texto):
        assert datos(texto).importe.estado == AUSENTE

    def test_fecha_imposible_no_cuenta(self):
        assert resumen("Fecha: 31/02/2026\nTotal: CLP 1.000")[2] == (date(2026, 10, 3), SUPUESTO)

    @pytest.mark.parametrize("texto", ["Total: CLP 0", "Total: CLP 9.999.999.999.999.999"])
    def test_cero_o_fuera_de_rango(self, texto):
        assert datos(texto).importe.estado == AUSENTE


# ══════════════════════════════════════════════════════════════════════
# Revisión de #184
# ══════════════════════════════════════════════════════════════════════


class TestNegativos:
    @pytest.mark.parametrize("texto", [
        "Total: -9.990 CLP",
        "Total: -$9.990 CLP",
        "Total: $-9.990 CLP",
        "Total: CLP -9.990",
        "Total: CLP \u22129.990",
        "Total: \u22129.990 CLP",
        "Total: (CLP 9.990)",
        # Segunda revisión de #184: el código DESPUÉS del número es parte del
        # monto, y el paréntesis cierra después del código.
        "Total: ($9.990 CLP)",
        "Total: ( $9.990 CLP )",
        "Total: ($ 9.990 CLP)",
    ])
    def test_un_total_negativo_no_se_confirma_como_cobro(self, texto):
        d = datos(texto, asunto="Tu recibo")
        assert d.importe.estado == AMBIGUO
        assert d.importe.valor == Decimal("-9990")
        assert "negativo" in d.importe.motivo
        assert "importe" in [c for c, _ in d.para_revision]

    @pytest.mark.parametrize("texto", [
        "Total: CLP 9.990", "Plan 1-2 personas: CLP 9.990", "Total: CLP 9.990 (IVA incluido)", "Total (CLP 9.990 con IVA)",
        "Total: $9.990 CLP", "Total: ($9.990 CLP con IVA)",
    ])
    def test_controles_positivos(self, texto):
        assert resumen(texto)[0] == (Decimal("9990"), CONFIRMADO)


class TestFechaDelProximoCiclo:
    def test_un_recibo_que_solo_trae_la_siguiente_fecha_no_la_confirma_como_la_del_cobro(self):
        d = datos("Total: CLP 9.990\nNext billing date: November 1, 2026")
        assert (d.fecha.valor, d.fecha.estado) == (date(2026, 10, 3), SUPUESTO)
        assert "próximo cobro" in d.fecha.motivo
        assert (d.fecha_proximo_cobro.valor, d.fecha_proximo_cobro.estado) == (date(2026, 11, 1), CONFIRMADO)

    def test_con_fecha_actual_y_siguiente_cada_una_en_su_lugar(self):
        d = datos("Total: CLP 9.990\nFecha de cobro: 2026-10-01\nTu próximo cobro será el 2026-11-01")
        assert (d.fecha.valor, d.fecha.estado) == (date(2026, 10, 1), CONFIRMADO)
        assert d.fecha_proximo_cobro.valor == date(2026, 11, 1)

    @pytest.mark.parametrize("texto", [
        "Se cobrará CLP 9.990 el 2026-11-01",
        "You will be charged US$ 12.99 on November 1, 2026",
        "Your subscription renews on Nov 1, 2026",
        "Próxima facturación: 2026-11-01",
    ])
    def test_un_aviso_deja_la_fecha_futura_como_proximo_cobro(self, texto):
        d = datos(texto)
        assert d.fecha.estado == SUPUESTO
        assert d.fecha_proximo_cobro.valor == date(2026, 11, 1)

    def test_la_fecha_del_proximo_cobro_no_pide_revision(self):
        d = datos("Total: CLP 9.990\nFecha de cobro: 2026-10-01\nNext billing date: November 1, 2026")
        assert d.para_revision == ()

    def test_sin_fecha_del_proximo_cobro_queda_ausente(self):
        assert datos("Total: CLP 9.990").fecha_proximo_cobro.estado == AUSENTE

    @pytest.mark.parametrize("frase", FRASES_QUE_ANUNCIAN_UN_COBRO)
    def test_cada_frase_de_aviso_de_s3_fe_08_marca_su_fecha(self, frase):
        """S3-FE-09 toma la fecha de un aviso SOLO de `fecha_proximo_cobro`:
        si FE-08 reconoce el aviso por una frase que FE-07 no marca, el aviso
        se queda sin fecha (revisión de S3-FE-09)."""
        d = datos(f"{frase.capitalize()} el 2026-11-05")
        assert (d.fecha_proximo_cobro.valor, d.fecha_proximo_cobro.estado) == (date(2026, 11, 5), CONFIRMADO)
        assert d.fecha.estado == SUPUESTO

    @pytest.mark.parametrize("texto", [
        "Lo intentaremos de nuevo el 5 de noviembre de 2026.",
        "Volveremos a intentar el cobro el 5 de noviembre de 2026.",
        "Reintentaremos el pago el 5 de noviembre de 2026.",
        "Próximo intento: 5 de noviembre de 2026",
        "We'll retry your payment on November 5, 2026",
    ])
    def test_el_reintento_de_un_pago_fallido_no_es_la_fecha_del_intento(self, texto):
        d = datos("No pudimos procesar tu pago de CLP 9.990.\n" + texto)
        assert d.fecha.estado == SUPUESTO
        assert d.fecha_proximo_cobro.valor == date(2026, 11, 5)


class TestElDiaDeRecepcion:
    def test_es_el_de_chile_y_no_el_de_utc(self, settings):
        """02:30 UTC del 1 de noviembre son las 23:30 del 31 en Santiago."""
        settings.TIME_ZONE = "America/Santiago"
        d = datos_de(MensajeCorreo(
            cuenta_id=uuid.uuid4(), id_mensaje="1", id_hilo="", remitente="x", asunto="", texto="Total: CLP 9.990",
            recibido_en=datetime(2026, 11, 1, 2, 30, tzinfo=tz.utc),
        ))
        assert (d.fecha.valor, d.fecha.estado) == (date(2026, 10, 31), SUPUESTO)


class TestSignoPesosJuntoAOtraMoneda:
    @pytest.mark.parametrize("texto", ["Total: USD 10\nTotal: $10", "Total: USD 10\nTotal: $12"])
    def test_un_signo_solo_no_hereda_la_moneda_de_otro_total(self, texto):
        d = datos(texto)
        assert (d.moneda.valor, d.moneda.estado) == (None, AMBIGUO)
        assert "USD" in d.moneda.motivo

    def test_control_el_codigo_del_mismo_monto_si_vale(self):
        assert resumen("Total: $10 USD")[1] == ("USD", CONFIRMADO)


class TestParentesisConCodigoDespues:
    def test_el_caso_de_maxi_en_dolares(self):
        d = datos("Total: ($10 USD)", asunto="Tu recibo")
        assert (d.importe.valor, d.importe.estado) == (Decimal("-10"), AMBIGUO)
        assert (d.moneda.valor, d.moneda.estado) == ("USD", CONFIRMADO)
        assert "importe" in [c for c, _ in d.para_revision]

    def test_el_fragmento_es_el_de_la_linea(self):
        assert datos("Total: ($9.990 CLP)").importe.fragmento == "Total: ($9.990 CLP)"


class TestElFragmentoEsUnaVentana:
    """El fragmento es para la evidencia de S3-FE-09: el dato y un poco de lo
    que lo rodea, nunca la línea. Un HTML de un párrafo es una sola línea, y
    antes el fragmento eran sus primeros 200 caracteres (revisión de S3-FE-09)."""

    PARRAFO = ("Hola Juan Pérez, gracias por tu pago de CLP 9.990 del 1 de octubre de 2026 "
               "con la tarjeta terminada en 4242.")

    def test_una_linea_corta_queda_entera(self):
        d = datos("Fecha de cobro: 1 de octubre de 2026\nTotal: CLP 9.990")
        assert (d.importe.fragmento, d.fecha.fragmento) == ("Total: CLP 9.990", "Fecha de cobro: 1 de octubre de 2026")

    def test_en_un_parrafo_no_cruza_el_inciso_ni_corta_palabras(self):
        d = datos(self.PARRAFO)
        assert d.importe.fragmento == "gracias por tu pago de CLP 9.990 del 1 de octubre de"
        assert d.fecha.fragmento == "por tu pago de CLP 9.990 del 1 de octubre de 2026 con la tarjeta"

    def test_no_cruza_el_inciso_que_viene_despues_del_dato(self):
        d = datos("Total: CLP 9.990, RUT 12.345.678-9; Fecha de cobro: 2026-10-01. Juan Pérez")
        assert d.importe.fragmento == "Total: CLP 9.990"
        assert d.fecha.fragmento == "Fecha de cobro: 2026-10-01"

    def test_el_dato_siempre_esta_aunque_venga_al_final_de_una_linea_larga(self):
        relleno = "Detalle de tu plan y de tus beneficios del mes. " * 10
        d = datos(relleno + "Total: CLP 9.990")
        assert d.importe.fragmento == "Total: CLP 9.990"

    def test_el_punto_de_los_miles_no_corta(self):
        d = datos("Te cobraremos USD 1.234,50 el 5 de noviembre de 2026.")
        assert d.fecha_proximo_cobro.fragmento == "Te cobraremos USD 1.234,50 el 5 de noviembre de 2026."

    def test_tiene_tope(self):
        d = datos(("x" * 500) + " Total: CLP 9.990 " + ("y" * 500))
        assert d.importe.fragmento == "Total: CLP 9.990"
        d = datos(("palabra " * 60) + "CLP 9.990 " + ("otra " * 60))
        # 30 antes y 20 después, sin el pedazo de palabra que quedó en el borde.
        assert d.importe.fragmento == "palabra palabra palabra CLP 9.990 otra otra otra otra"
