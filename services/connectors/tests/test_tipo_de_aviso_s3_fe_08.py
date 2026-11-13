"""S3-FE-08 — recibo pagado, aviso de cobro futuro o pago fallido.

Criterios de la tarjeta:
- un aviso futuro o un fallo no se registra como pago realizado;
- los casos inciertos quedan para revisión.

Los correos imitan los reales en español y en inglés. Cada resultado se fijó
corriendo el clasificador y revisando la salida a mano (13-11-2026); esa
corrida encontró un caso que se corrigió antes de escribir las pruebas («fue
rechazado» no contaba como fallo).
"""

import uuid
from datetime import datetime, timezone as tz

import pytest

from connectors.lectura_correo import MensajeCorreo
from connectors.tipo_de_aviso import AVISO_DE_COBRO, COBRO_REALIZADO, PAGO_FALLIDO, clasificar


def tipo(asunto, texto=""):
    return clasificar(MensajeCorreo(
        cuenta_id=uuid.uuid4(), id_mensaje="1", id_hilo="", recibido_en=datetime(2026, 10, 1, tzinfo=tz.utc),
        remitente="x", asunto=asunto, texto=texto,
    ))


# ══════════════════════════════════════════════════════════════════════
# Lo que sí se reconoce
# ══════════════════════════════════════════════════════════════════════


class TestRecibos:
    @pytest.mark.parametrize("asunto, texto", [
        ("Tu recibo de Netflix", "Total: CLP 9.990"),
        ("Your receipt from Spotify", "Total charged US$ 12.99"),
        ("Netflix", "Hemos recibido tu pago. Gracias."),
        ("Comprobante de pago", ""),
        ("Payment confirmation", "Thank you for your payment."),
    ])
    def test_un_recibo_es_un_cobro_realizado(self, asunto, texto):
        assert tipo(asunto, texto).tipo == COBRO_REALIZADO

    @pytest.mark.parametrize("asunto, texto", [
        ("Tu recibo de Netflix", "Total: CLP 9.990. Tu próximo cobro será el 1 de noviembre."),
        ("Your receipt from Spotify", "Total charged US$ 12.99. Your subscription renews on Nov 1, 2026."),
        ("Recibo", "Next billing date: November 1, 2026"),
        # El asunto no decide: deciden los dos juntos, y la mención del
        # próximo ciclo no contradice al cobro.
        ("Netflix", "Gracias por tu pago. Tu próximo cobro será el 1 de noviembre."),
    ])
    def test_un_recibo_que_menciona_el_proximo_ciclo_sigue_siendo_recibo(self, asunto, texto):
        resultado = tipo(asunto, texto)
        assert resultado.tipo == COBRO_REALIZADO


class TestAvisos:
    @pytest.mark.parametrize("asunto, texto", [
        ("Upcoming payment", "You will be charged US$ 12.99 on Nov 1."),
        ("Recordatorio de pago", "Se cobrará CLP 9.990 el 1 de noviembre."),
        ("Tu prueba gratuita termina pronto", "Después te cobraremos CLP 4.990 al mes."),
        ("Tu suscripción se renovará pronto", "Te enviaremos el recibo cuando se cobre. Se cobrará CLP 9.990."),
        ("Netflix", "Tu próximo cobro será el 1 de noviembre."),
    ])
    def test_un_aviso_es_un_aviso(self, asunto, texto):
        assert tipo(asunto, texto).tipo == AVISO_DE_COBRO


class TestFallos:
    @pytest.mark.parametrize("asunto, texto", [
        ("Problema con tu pago", "No pudimos procesar tu pago."),
        ("Your card was declined", "We could not process your payment of US$ 12.99"),
        ("Netflix", "Tu tarjeta rechazada: actualiza tu método de pago."),
        ("Payment failed", ""),
    ])
    def test_un_fallo_es_un_fallo(self, asunto, texto):
        assert tipo(asunto, texto).tipo == PAGO_FALLIDO

    def test_un_fallo_con_nuevo_intento_sigue_siendo_fallo(self):
        resultado = tipo("Netflix", "No pudimos procesar tu pago. Lo intentaremos de nuevo; tu próximo cobro será el 5.")
        assert resultado.tipo == PAGO_FALLIDO


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — un aviso o un fallo no se registra como pago realizado
# ══════════════════════════════════════════════════════════════════════


class TestNuncaUnCobroInventado:
    def test_un_aviso_que_dice_recibo_no_es_un_recibo(self):
        """El asunto dice «recibo» pero el cuerpo anuncia un cobro futuro."""
        resultado = tipo("Tu recibo estará disponible pronto", "Se cobrará CLP 9.990 el 1 de noviembre.")
        assert resultado.tipo != COBRO_REALIZADO
        assert resultado.incierto

    def test_un_recibo_cuyo_cuerpo_dice_que_fallo(self):
        resultado = tipo("Tu recibo de Netflix", "Tu pago fue rechazado.")
        assert resultado.incierto
        assert "falló" in resultado.motivo

    def test_un_fallo_recuperado_queda_para_revision(self):
        resultado = tipo("Netflix", "Tu pago anterior fue rechazado. Hemos recibido tu pago.")
        assert resultado.incierto

    def test_cobro_y_aviso_en_el_cuerpo_queda_para_revision(self):
        resultado = tipo("Netflix", "Gracias por tu pago. Además, se cobrará CLP 2.000 el 5.")
        assert resultado.incierto


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — los casos inciertos quedan para revisión
# ══════════════════════════════════════════════════════════════════════


class TestInciertos:
    @pytest.mark.parametrize("asunto, texto", [
        ("Ofertas de la semana", "Descuentos en tecnología"),
        ("Recibirás tu pedido mañana", "Gracias por comprar"),
        ("Hola", ""),
    ])
    def test_sin_evidencia_no_se_adivina(self, asunto, texto):
        resultado = tipo(asunto, texto)
        assert resultado.incierto and resultado.tipo is None
        assert resultado.motivo

    def test_un_asunto_que_se_contradice_mira_todo_junto(self):
        resultado = tipo("Recibo y recordatorio de pago", "")
        assert resultado.incierto


class TestComoSeCompara:
    def test_recibo_no_calza_dentro_de_recibiras(self):
        assert tipo("Recibirás novedades", "").incierto

    def test_se_compara_como_palabra_entera(self):
        """Un boletín que habla de «recibos» en general no es un recibo."""
        assert tipo("Novedades", "Ahora puedes descargar tus recibos desde la app.").incierto

    def test_sin_tildes_y_sin_mayusculas(self):
        assert tipo("PRÓXIMO COBRO", "").tipo == AVISO_DE_COBRO
        assert tipo("Proximo cobro", "").tipo == AVISO_DE_COBRO

    def test_la_evidencia_dice_que_se_encontro_y_donde(self):
        resultado = tipo("Tu recibo de Netflix", "Tu próximo cobro será el 1 de noviembre.")
        assert "asunto: cobro_realizado: recibo" in resultado.evidencia
        assert "cuerpo: proximo_ciclo: proximo cobro" in resultado.evidencia

    def test_los_tipos_son_los_del_contrato(self):
        """`candidatos.TipoMensaje` (#147) usa estos mismos textos."""
        assert (COBRO_REALIZADO, AVISO_DE_COBRO, PAGO_FALLIDO) == ("cobro_realizado", "aviso_de_cobro", "pago_fallido")
