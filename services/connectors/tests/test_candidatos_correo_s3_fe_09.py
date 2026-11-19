"""S3-FE-09 — generar candidatos de correo conservando la evidencia del mensaje.

Criterios de la tarjeta:
- el candidato es trazable y queda pendiente;
- no se almacena contenido innecesario ni se ejecuta confirmación automática.

Y lo que piden S3-FE-07 y S3-FE-08 de quien los use: lo que no está
confirmado no se inventa. Un correo incierto o sin datos queda como error de
la importación, con su motivo, igual que una fila mala de un CSV.

Los correos de aquí son de ejemplo, escritos para cada caso; no salen de una
cuenta real.
"""

import json
import uuid
from datetime import date, datetime, timezone as tz
from decimal import Decimal
from pathlib import Path

import pytest
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from jsonschema import Draft202012Validator, FormatChecker
from rest_framework.test import APIClient

from connectors import candidatos_correo
from connectors.candidatos_correo import ImportacionNoDisponible, guardar_pagina, leer
from connectors.lectura_correo import MensajeCorreo, MensajeOmitido, PaginaDeMensajes, html_a_texto
from connectors.models import CobroCandidato, CuentaConectada, Importacion, OutboxEvento
from connectors.origen_correo import identificador_de, identificador_del_proveedor
from connectors.serializers import CobroCandidatoSerializer

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
RECIBIDO = datetime(2026, 10, 2, 13, 30, tzinfo=tz.utc)
NETFLIX = "Netflix <info@account.netflix.com>"
CONTRATOS = Path(__file__).resolve().parents[3] / "docs" / "contratos"

#: Una línea del cuerpo que no es ningún dato del cobro. No puede aparecer en
#: nada de lo que se guarda.
LINEA_PRIVADA = "Tu código de verificación es K7Q-PRIVADO-829341"

RECIBO = (
    "Hola, gracias por tu pago.\n"
    "Fecha de cobro: 1 de octubre de 2026\n"
    "Plan Estándar\n"
    "Total: CLP 9.990\n"
    "Tu próximo cobro será el 1 de noviembre de 2026.\n"
    + LINEA_PRIVADA
)


@pytest.fixture(autouse=True)
def _claves(claves):
    """Las cuentas guardan su token cifrado (FE-06)."""


def crear_cuenta(org=ORG_A, proveedor="gmail", correo="persona@gmail.com"):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=correo,
        access_token="ya29.token-de-prueba", estado=CuentaConectada.Estado.CONECTADA,
    )


def crear_importacion(cuenta, *, estado=Importacion.Estado.PROCESANDO, org=None):
    return Importacion.objects.create(
        organizacion_id=org or cuenta.organizacion_id, usuario_id="42",
        origen=Importacion.Origen.CORREO, cuenta=cuenta, estado=estado,
    )


@pytest.fixture
def cuenta():
    return crear_cuenta()


@pytest.fixture
def importacion(cuenta):
    return crear_importacion(cuenta)


def mensaje(cuenta, *, asunto="Tu recibo de Netflix", texto=RECIBO, remitente=NETFLIX, id_mensaje="18c2f0a1",
            message_id=None, recibido_en=RECIBIDO, texto_truncado=False):
    return MensajeCorreo(
        cuenta_id=cuenta.pk, id_mensaje=id_mensaje, id_hilo="hilo-1", recibido_en=recibido_en,
        remitente=remitente, asunto=asunto, texto=texto, texto_truncado=texto_truncado,
        proveedor_correo=cuenta.proveedor,
        message_id=f"{id_mensaje}@correo.example.test" if message_id is None else message_id,
    )


def pagina(*mensajes, omitidos=()):
    return PaginaDeMensajes(mensajes=tuple(mensajes), siguiente_pagina=None, omitidos=tuple(omitidos))


def el_unico_candidato():
    (candidato,) = CobroCandidato.objects.all()
    return candidato


# ══════════════════════════════════════════════════════════════════════
# Criterio 1 — el candidato es trazable y queda pendiente
# ══════════════════════════════════════════════════════════════════════


class TestCandidatoTrazableYPendiente:
    def test_un_recibo_queda_propuesto_con_sus_datos_exactos(self, importacion, cuenta):
        resultado = guardar_pagina(importacion, pagina(mensaje(cuenta)))

        candidato = el_unico_candidato()
        assert candidato.estado == CobroCandidato.Estado.PROPUESTO
        assert candidato.decidido_en is None and candidato.decidido_por == ""
        assert candidato.importacion_id == importacion.pk
        assert candidato.organizacion_id == ORG_A
        assert candidato.origen == CobroCandidato.Origen.CORREO
        assert candidato.tipo_mensaje == CobroCandidato.TipoMensaje.COBRO_REALIZADO
        assert (candidato.servicio, candidato.servicio_resultado) == ("Netflix", "reconocido")
        assert candidato.importe == Decimal("9990") and candidato.moneda == "CLP"
        # La del cobro, no la del próximo ciclo ni la de recepción.
        assert candidato.fecha == date(2026, 10, 1)
        assert (resultado.candidatos_nuevos, resultado.ya_guardados) == (1, 0)
        importacion.refresh_from_db()
        assert (importacion.candidatos_detectados, importacion.filas_procesadas) == (1, 1)

    def test_la_evidencia_enlaza_el_mensaje_fuente(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta)))

        assert el_unico_candidato().evidencia == {
            "proveedor_correo": "gmail",
            "cuenta_id": str(cuenta.pk),
            "id_mensaje": "18c2f0a1",
            "message_id": "18c2f0a1@correo.example.test",
            "recibido_en": "2026-10-02T13:30:00+00:00",
            "remitente": "info@account.netflix.com",
            "asunto": "Tu recibo de Netflix",
            "servicio_fuente": "nombre del remitente",
            "servicio_regla": "alias 'netflix'",
            "tipo_motivo": "lo dice el asunto",
            "tipo_evidencia": "asunto: cobro_realizado: recibo; cuerpo: proximo_ciclo: proximo cobro; "
                              "cuerpo: cobro_realizado: gracias por tu pago",
            "importe_fragmento": "Total: CLP 9.990",
            "fecha_fragmento": "Fecha de cobro: 1 de octubre de 2026",
            "fecha_origen": "texto",
        }

    def test_el_identificador_es_el_del_message_id(self, importacion, cuenta):
        leido = mensaje(cuenta, message_id="CAF1x2@mail.netflix.com")
        guardar_pagina(importacion, pagina(leido))

        candidato = el_unico_candidato()
        assert candidato.identificador_origen == identificador_de(leido)
        assert candidato.identificador_origen.startswith("mid:")
        # El hash es para que quepa en el campo; el Message-ID va entero aquí.
        assert candidato.evidencia["message_id"] == "CAF1x2@mail.netflix.com"

    def test_sin_message_id_se_identifica_por_el_buzon(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta, message_id="", id_mensaje="18c2sin")))

        candidato = el_unico_candidato()
        assert candidato.identificador_origen == identificador_del_proveedor("gmail", cuenta.pk, "18c2sin")
        assert "message_id" not in candidato.evidencia
        assert candidato.evidencia["id_mensaje"] == "18c2sin"

    def test_un_aviso_lleva_la_fecha_del_cobro_anunciado(self, importacion, cuenta):
        aviso = mensaje(
            cuenta, remitente="Spotify <no-reply@spotify.com>", asunto="Tu suscripción se renovará pronto",
            texto="Te cobraremos USD 10.99 el 5 de noviembre de 2026.",
        )
        guardar_pagina(importacion, pagina(aviso))

        candidato = el_unico_candidato()
        assert candidato.tipo_mensaje == CobroCandidato.TipoMensaje.AVISO_DE_COBRO
        assert candidato.fecha == date(2026, 11, 5)
        assert (candidato.importe, candidato.moneda) == (Decimal("10.99"), "USD")
        assert candidato.evidencia["fecha_origen"] == "cobro_anunciado"
        assert candidato.evidencia["fecha_fragmento"] == "Te cobraremos USD 10.99 el 5 de noviembre de 2026."

    def test_un_aviso_reconocido_por_otra_frase_de_s3_fe_08_tambien_lleva_su_fecha(self, importacion, cuenta):
        """El aviso usa solo la fecha anunciada: la frase con que S3-FE-08 lo
        reconoce tiene que marcarla en S3-FE-07."""
        aviso = mensaje(cuenta, asunto="Tu suscripción a Netflix",
                        texto="Realizaremos el cobro de CLP 9.990 el 5 de noviembre de 2026.")
        guardar_pagina(importacion, pagina(aviso))

        candidato = el_unico_candidato()
        assert candidato.tipo_mensaje == CobroCandidato.TipoMensaje.AVISO_DE_COBRO
        assert (candidato.fecha, candidato.evidencia["fecha_origen"]) == (date(2026, 11, 5), "cobro_anunciado")

    @pytest.mark.parametrize(("dia", "es_candidato"), [(3, True), (4, False)], ids=["dia-siguiente", "dos-dias-despues"])
    def test_un_dia_de_holgura_para_la_zona_del_servicio(self, importacion, cuenta, dia, es_candidato):
        """Llegó el 2 de octubre (hora de Chile). Un recibo fechado el 3 puede
        venir de un servicio con la hora adelantada; uno fechado el 4, no."""
        texto = f"Gracias por tu pago.\nFecha de cobro: {dia} de octubre de 2026\nTotal: CLP 9.990"
        guardar_pagina(importacion, pagina(mensaje(cuenta, texto=texto)))

        importacion.refresh_from_db()
        if es_candidato:
            assert el_unico_candidato().fecha == date(2026, 10, dia)
            assert importacion.errores == []
        else:
            assert not CobroCandidato.objects.exists()
            (error,) = importacion.errores
            assert error["codigo"] == "fecha_no_indicada"
            assert "la fecha del correo (2026-10-04) es posterior a su llegada (2026-10-02)" in error["mensaje"]

    def test_un_pago_fallido_queda_como_pago_fallido(self, importacion, cuenta):
        fallo = mensaje(cuenta, asunto="Problema con tu pago",
                        texto="No pudimos procesar tu pago de CLP 9.990 del 1 de octubre de 2026.")
        guardar_pagina(importacion, pagina(fallo))

        candidato = el_unico_candidato()
        assert candidato.tipo_mensaje == CobroCandidato.TipoMensaje.PAGO_FALLIDO
        assert candidato.fecha == date(2026, 10, 1)

    def test_un_recibo_sin_fecha_usa_la_de_recepcion_y_lo_declara(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta, texto="Gracias por tu pago.\nTotal: CLP 9.990")))

        candidato = el_unico_candidato()
        assert candidato.fecha == RECIBIDO.date()
        assert candidato.evidencia["fecha_origen"] == "recepcion"
        assert candidato.evidencia["fecha_motivo"] == "el correo no dice la fecha del cobro: se usó el día en que llegó"
        assert "fecha_fragmento" not in candidato.evidencia

    @pytest.mark.parametrize(("recibido", "dia_en_chile"), [
        (datetime(2026, 11, 1, 2, 30, tzinfo=tz.utc), date(2026, 10, 31)),  # horario de verano, UTC-3
        (datetime(2026, 7, 1, 3, 30, tzinfo=tz.utc), date(2026, 6, 30)),  # horario de invierno, UTC-4
    ], ids=["verano", "invierno"])
    def test_el_dia_de_recepcion_es_el_de_chile_y_no_el_de_utc(
        self, importacion, cuenta, settings, recibido, dia_en_chile,
    ):
        """Los lectores entregan la hora en UTC. Un recibo de las 23:30 del 31
        en Santiago no es del 1 (otro mes), y el error tiene que decir el día
        que la persona ve en su buzón (revisión de S3-FE-09)."""
        settings.TIME_ZONE = "America/Santiago"
        sin_fecha = mensaje(cuenta, id_mensaje="sin-fecha", texto="Gracias por tu pago.\nTotal: CLP 9.990",
                            recibido_en=recibido)
        dudoso = mensaje(cuenta, id_mensaje="dudoso", asunto="Tu recibo", texto="Total: $9.990", recibido_en=recibido)

        guardar_pagina(importacion, pagina(sin_fecha, dudoso))

        candidato = el_unico_candidato()
        assert (candidato.fecha, candidato.evidencia["fecha_origen"]) == (dia_en_chile, "recepcion")
        importacion.refresh_from_db()
        (error,) = importacion.errores
        assert f", recibido el {dia_en_chile.isoformat()}: " in error["mensaje"]

    def test_un_recibo_no_toma_la_fecha_del_proximo_ciclo(self, importacion, cuenta):
        texto = "Gracias por tu pago.\nTotal: CLP 9.990\nTu próximo cobro será el 1 de noviembre de 2026."
        guardar_pagina(importacion, pagina(mensaje(cuenta, texto=texto)))

        candidato = el_unico_candidato()
        assert candidato.fecha == RECIBIDO.date()
        assert candidato.evidencia["fecha_origen"] == "recepcion"

    def test_un_servicio_ambiguo_queda_sin_proveedor(self, importacion, cuenta):
        apple = mensaje(cuenta, remitente="Apple <no_reply@email.apple.com>", asunto="Tu recibo de Apple",
                        texto="Total: USD 2.99\nFecha: 2026-10-01")
        guardar_pagina(importacion, pagina(apple))

        candidato = el_unico_candidato()
        assert candidato.servicio is None
        assert candidato.servicio_resultado == "ambiguo"
        assert candidato.servicio_texto == "Apple"

    def test_el_ejemplo_de_correo_del_contrato_sale_del_productor_real(self, cuenta):
        """El ejemplo de S3-MX-25 se armó a mano con `Candidato`. Aquí sale
        de un correo, por las tres piezas de lectura, y tiene que coincidir."""
        esquema = json.loads((CONTRATOS / "candidatos-v1.schema.json").read_text(encoding="utf-8"))
        validador = Draft202012Validator(esquema, format_checker=FormatChecker())
        ejemplo = json.loads((CONTRATOS / "candidatos-v1.ejemplos.json").read_text(encoding="utf-8"))[1]
        aviso = mensaje(
            cuenta, remitente="Netflix <facturas@example.test>", asunto="Tu próximo cobro",
            message_id="aviso-2026-04-13@example.test",
            texto="CLP 5.990\nPróximo cobro: 13 de abril de 2026",
        )

        lectura = leer(pagina(aviso), organizacion_id=ejemplo["organizacion_id"], cuenta_id=cuenta.pk,
                       proveedor_correo="gmail")

        (candidato,) = lectura.candidatos
        real = candidato.como_json()
        validador.validate(real)
        assert {k: v for k, v in real.items() if k != "evidencia"} == {
            k: v for k, v in ejemplo.items() if k != "evidencia"
        }
        assert ejemplo["evidencia"].items() <= real["evidencia"].items()

    def test_la_vista_previa_los_muestra_con_la_misma_forma(self, importacion, cuenta):
        dudoso = mensaje(cuenta, id_mensaje="dudoso", asunto="Tu recibo", texto="Total: $9.990\nFecha: 2026-10-01")
        guardar_pagina(importacion, pagina(mensaje(cuenta), dudoso))
        cliente = APIClient()
        cabecera = {"X-Organizacion-Id": str(ORG_A), "X-Usuario-Id": "42"}

        lista = cliente.get("/api/candidatos/", {"importacion": str(importacion.pk), "origen": "correo"},
                            headers=cabecera).json()
        detalle = cliente.get(f"/api/importaciones/{importacion.pk}/", headers=cabecera).json()

        (candidato,) = lista["results"]
        assert set(candidato) == set(CobroCandidatoSerializer.Meta.fields)
        assert (candidato["origen"], candidato["importe"], candidato["fecha"]) == ("correo", "9990.00", "2026-10-01")
        assert candidato["evidencia"]["message_id"] == "18c2f0a1@correo.example.test"
        assert detalle["candidatos_detectados"] == 1
        assert detalle["errores_totales"] == 1
        (error,) = detalle["errores"]
        assert error["codigo"] == "moneda_ambigua"
        assert error["fila"] is None

    def test_el_error_dice_cual_es_el_correo(self, importacion, cuenta):
        dudoso = mensaje(cuenta, asunto="Tu recibo", texto="Total: $9.990\nFecha: 2026-10-01")
        guardar_pagina(importacion, pagina(dudoso))

        importacion.refresh_from_db()
        assert importacion.errores == [{
            "codigo": "moneda_ambigua",
            "mensaje": "«Tu recibo» de info@account.netflix.com, recibido el 2026-10-02: "
                       "el monto viene con `$` solo: pueden ser pesos o dólares",
            "fila": None,
            "identificador_origen": identificador_de(dudoso),
        }]


# ══════════════════════════════════════════════════════════════════════
# Lo incierto o incompleto no se inventa (S3-FE-07 y S3-FE-08)
# ══════════════════════════════════════════════════════════════════════


INCIERTOS = [
    pytest.param("Netflix", "Tu pago anterior fue rechazado. Hemos recibido tu pago de CLP 9.990 el 1 de octubre de 2026.",
                 "tipo_incierto", id="cobro-y-fallo"),
    pytest.param("Ofertas de la semana", "Notebook a solo CLP 299.990", "tipo_incierto", id="monto-sin-tipo"),
    pytest.param("Tu recibo", "Total: CLP 9.990\nTotal: CLP 10.990\nFecha: 2026-10-01", "importe_ambiguo",
                 id="dos-totales"),
    pytest.param("Tu recibo", "Total: -9.990 CLP\nFecha: 2026-10-01", "importe_ambiguo", id="negativo"),
    pytest.param("Tu recibo", "Gracias por tu pago.", "importe_no_encontrado", id="sin-monto"),
    pytest.param("Tu recibo", "Total: $9.990\nFecha: 2026-10-01", "moneda_ambigua", id="peso-o-dolar"),
    pytest.param("Tu recibo", "Total: CLP 9.990\nFecha: 01/10/2026", "fecha_ambigua", id="dia-o-mes"),
    pytest.param("Recordatorio de pago", "Te cobraremos CLP 9.990 pronto.", "fecha_no_indicada", id="aviso-sin-fecha"),
    pytest.param("Problema con tu pago", "No pudimos procesar tu pago de CLP 9.990.", "fecha_no_indicada",
                 id="fallo-sin-fecha"),
    # La fecha del propio aviso no es la del cobro anunciado (revisión de S3-FE-09).
    pytest.param("Recordatorio de pago", "Fecha: 28 de octubre de 2026\nTe cobraremos CLP 9.990 pronto.",
                 "fecha_no_indicada", id="aviso-con-la-fecha-del-aviso"),
    # Ni la del reintento ni una posterior a la llegada son la de lo que ya pasó.
    pytest.param("Problema con tu pago",
                 "No pudimos procesar tu pago de CLP 9.990.\nLo intentaremos de nuevo el 5 de noviembre de 2026.",
                 "fecha_no_indicada", id="fallo-con-la-fecha-del-reintento"),
    pytest.param("Problema con tu pago",
                 "No pudimos procesar tu pago de CLP 9.990.\nTu tarjeta será cargada el 5 de noviembre de 2026.",
                 "fecha_no_indicada", id="fallo-con-fecha-posterior-a-la-llegada"),
    pytest.param("Tu recibo",
                 "Gracias por tu pago de CLP 9.990.\nTu plan está activo hasta el 30 de noviembre de 2026.",
                 "fecha_no_indicada", id="recibo-con-fecha-posterior-a-la-llegada"),
]


class TestLoInciertoNoSeInventa:
    @pytest.mark.parametrize(("asunto", "texto", "codigo"), INCIERTOS)
    def test_queda_como_error_y_no_como_candidato(self, importacion, cuenta, asunto, texto, codigo):
        resultado = guardar_pagina(importacion, pagina(mensaje(cuenta, asunto=asunto, texto=texto)))

        assert not CobroCandidato.objects.exists()
        importacion.refresh_from_db()
        assert [error["codigo"] for error in importacion.errores] == [codigo]
        assert importacion.errores_totales == 1
        assert (resultado.candidatos_nuevos, resultado.errores_nuevos) == (0, 1)

    def test_un_correo_que_no_habla_de_cobros_se_descarta_sin_error(self, importacion, cuenta):
        boletin = mensaje(cuenta, remitente="Falabella <ofertas@falabella.com>", asunto="Ofertas de la semana",
                          texto="Descuentos en tecnología.")
        resultado = guardar_pagina(importacion, pagina(boletin))

        assert not CobroCandidato.objects.exists()
        importacion.refresh_from_db()
        assert (importacion.errores, importacion.errores_totales) == ([], 0)
        # Descartado no es perdido: se contó.
        assert importacion.filas_procesadas == 1
        assert resultado.descartados == 1

    def test_un_mensaje_omitido_por_el_lector_queda_como_error(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(omitidos=[MensajeOmitido("18c2borrado", "el mensaje ya no existe")]))

        importacion.refresh_from_db()
        assert importacion.errores == [{
            "codigo": "mensaje_omitido",
            "mensaje": "Un correo de la lista no se pudo leer: el mensaje ya no existe",
            "fila": None,
            "identificador_origen": identificador_del_proveedor("gmail", cuenta.pk, "18c2borrado"),
        }]
        assert importacion.filas_procesadas == 1

    def test_omitidos_de_outlook_con_el_mismo_prefijo_son_distintos(self):
        """Los `id` de Graph de un buzón comparten el buzón y la carpeta, más
        de 64 caracteres. Antes el lector los recortaba a 64 y S3-FE-09 los
        juntaba en uno; en la página siguiente ya no anotaba ninguno. Que el
        lector entregue el `id` entero lo prueba `test_lector_outlook`; aquí,
        que con el `id` entero cada omitido cuenta, también entre páginas."""
        outlook = crear_cuenta(proveedor="outlook", correo="persona@empresa.cl")
        de_outlook = crear_importacion(outlook)
        prefijo = "AAMkADExNzI0ZmE5LTQ2NjctNGQ3Mi1hNjkzLWQ0ZTljZjE4NDMzOABGAAAAAADXtV2rRb4ZT5O8ZH8Qb7lkBwBdA5FtjN0QR4m0b0vd6Euz"

        def omitido(fin):
            return MensajeOmitido(f"{prefijo}AAAAAAEMAAB{fin}AAA=", "la fecha no es válida")

        primera = guardar_pagina(de_outlook, pagina(omitidos=[omitido("lsA"), omitido("ltA"), omitido("luA")]))
        segunda = guardar_pagina(de_outlook, pagina(omitidos=[omitido("lvA")]))

        de_outlook.refresh_from_db()
        assert (primera.errores_nuevos, segunda.errores_nuevos) == (3, 1)
        assert de_outlook.errores_totales == 4
        assert len({error["identificador_origen"] for error in de_outlook.errores}) == 4

    def test_un_omitido_sin_identificador_se_anota_y_no_tumba_la_pagina(self, importacion, cuenta):
        """Antes lanzaba `ValueError`: dentro de la lectura por cursor la
        página se releía para siempre y el buzón quedaba detenido."""
        sin_id = [MensajeOmitido("", "identificador no válido"), MensajeOmitido("", "identificador no válido")]
        resultado = guardar_pagina(importacion, pagina(mensaje(cuenta), omitidos=sin_id))

        assert el_unico_candidato().importe == Decimal("9990")
        importacion.refresh_from_db()
        assert [error["codigo"] for error in importacion.errores] == ["mensaje_omitido", "mensaje_omitido"]
        assert all("identificador_origen" not in error for error in importacion.errores)
        assert (resultado.errores_nuevos, importacion.filas_procesadas) == (2, 3)

    def test_una_pagina_mezclada_guarda_lo_bueno_y_anota_lo_malo(self, importacion, cuenta):
        bueno = mensaje(cuenta, id_mensaje="bueno")
        malo = mensaje(cuenta, id_mensaje="malo", asunto="Tu recibo", texto="Total: CLP 9.990\nFecha: 01/10/2026")
        boletin = mensaje(cuenta, id_mensaje="boletin", asunto="Novedades", texto="Nuevos estrenos.")

        resultado = guardar_pagina(importacion, pagina(bueno, malo, boletin))

        assert el_unico_candidato().evidencia["id_mensaje"] == "bueno"
        importacion.refresh_from_db()
        assert (importacion.filas_procesadas, importacion.candidatos_detectados, importacion.errores_totales) == (3, 1, 1)
        assert (resultado.candidatos_nuevos, resultado.errores_nuevos, resultado.descartados) == (1, 1, 1)


# ══════════════════════════════════════════════════════════════════════
# Criterio 2 — nada innecesario guardado, nada confirmado solo
# ══════════════════════════════════════════════════════════════════════


def todo_lo_guardado() -> str:
    """Cada valor de cada candidato y de cada importación, como texto."""
    filas = list(CobroCandidato.objects.values()) + list(Importacion.objects.values())
    return json.dumps(filas, default=str, ensure_ascii=False)


class TestNadaInnecesarioNiConfirmado:
    def test_no_guarda_el_cuerpo_del_correo(self, importacion, cuenta):
        dudoso = mensaje(cuenta, id_mensaje="dudoso", asunto="Tu recibo",
                         texto="Total: $9.990\nFecha: 2026-10-01\n" + LINEA_PRIVADA)
        guardar_pagina(importacion, pagina(mensaje(cuenta), dudoso))

        guardado = todo_lo_guardado()
        assert "K7Q-PRIVADO" not in guardado
        assert "Plan Estándar" not in guardado
        assert CobroCandidato.objects.count() == 1 and importacion.errores_totales == 1

    @pytest.mark.parametrize("texto", [
        # Lo que deja `html_a_texto` de un HTML de un solo párrafo: una línea.
        html_a_texto("<p>Hola Juan Pérez, gracias por tu pago de CLP 9.990 del 1 de octubre de 2026 "
                     "con la tarjeta terminada en 4242.</p>"),
        "Gracias por tu pago. Hola Juan Pérez, RUT 12.345.678-9, tarjeta terminada en 4242, "
        "dirección Los Aromos 123. Detalle del plan… Total: CLP 9.990",
    ], ids=["html-de-un-parrafo", "texto-de-un-parrafo"])
    def test_un_cuerpo_de_una_sola_linea_no_se_guarda_entero(self, importacion, cuenta, texto):
        """Antes el fragmento eran los primeros 200 caracteres de la línea:
        con el HTML, el cuerpo entero; con el texto, el RUT, la tarjeta y la
        dirección, pero no el monto (revisión de S3-FE-09)."""
        guardar_pagina(importacion, pagina(mensaje(cuenta, texto=texto)))

        candidato = el_unico_candidato()
        assert candidato.importe == Decimal("9990")
        assert "CLP 9.990" in candidato.evidencia["importe_fragmento"]
        # Frases enteras: «4242» solo puede aparecer por azar en un UUID o en
        # los microsegundos de una fecha (2 de cada 300 guardados, medido).
        guardado = todo_lo_guardado()
        for privado in ("Juan Pérez", "terminada en 4242", "12.345.678-9", "Los Aromos"):
            assert privado not in guardado, privado
        for fragmento in (candidato.evidencia["importe_fragmento"], candidato.evidencia.get("fecha_fragmento", "")):
            assert "4242" not in fragmento and "Juan" not in fragmento, fragmento

    def test_la_evidencia_es_de_una_linea_y_acotada(self, importacion, cuenta):
        asunto = "Tu recibo\n\tde\x00 Netflix " + "x" * 5000
        guardar_pagina(importacion, pagina(mensaje(cuenta, asunto=asunto)))

        candidato = el_unico_candidato()
        assert candidato.evidencia["asunto"].startswith("Tu recibo de Netflix x")
        assert len(candidato.evidencia["asunto"]) == candidatos_correo.LARGO_TEXTO
        for valor in candidato.evidencia.values():
            assert valor.isprintable(), valor
        assert len(json.dumps(candidato.evidencia)) < 3_000

    def test_el_mensaje_de_un_error_tambien_es_acotado(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta, asunto="Tu recibo\n" + "y" * 5000,
                                                   texto="Total: $9.990\nFecha: 2026-10-01")))

        importacion.refresh_from_db()
        (error,) = importacion.errores
        assert "\n" not in error["mensaje"]
        assert error["mensaje"].startswith("«Tu recibo yyyy")
        assert len(error["mensaje"]) <= 200

    def test_con_asunto_y_remitente_largos_el_motivo_va_entero(self, importacion, cuenta):
        """Antes el mensaje se cortaba en 200 por el final, y lo que se
        perdía era el motivo: «…y ninguno se distin» (revisión de S3-FE-09)."""
        largo = mensaje(
            cuenta, asunto="Tu recibo mensual de Netflix: detalle de los cargos del plan Premium de octubre",
            remitente="Netflix <notificaciones-facturacion@mailer.account.netflix.com>",
            texto="Total: CLP 9.990\nTotal: CLP 10.990\nFecha: 2026-10-01",
        )
        guardar_pagina(importacion, pagina(largo))

        importacion.refresh_from_db()
        (error,) = importacion.errores
        assert error["mensaje"].startswith("«Tu recibo mensual")
        assert ", recibido el 2026-10-02: " in error["mensaje"]
        assert error["mensaje"].endswith(": hay 2 montos posibles (9990, 10990) y ninguno se distingue")
        assert len(error["mensaje"]) <= Importacion.LARGO_MENSAJE_DE_ERROR

    def test_un_motivo_larguisimo_tambien_cabe(self, importacion, cuenta):
        totales = "\n".join(f"Total: CLP {monto}.990" for monto in range(10, 40))
        guardar_pagina(importacion, pagina(mensaje(cuenta, asunto="Tu recibo " + "z" * 300, texto=totales)))

        importacion.refresh_from_db()
        (error,) = importacion.errores
        assert error["codigo"] == "importe_ambiguo"
        assert len(error["mensaje"]) <= Importacion.LARGO_MENSAJE_DE_ERROR
        # Lo que dice cuál es el correo sigue ahí, y el motivo termina acotado, no cortado por anotar_error.
        assert ", recibido el 2026-10-02: hay 30 montos posibles" in error["mensaje"]
        assert error["mensaje"].endswith("…")

    def test_no_confirma_ni_deja_ordenes_ni_cierra_la_importacion(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta)))

        assert not OutboxEvento.objects.exists()
        candidato = el_unico_candidato()
        assert candidato.estado == CobroCandidato.Estado.PROPUESTO and candidato.decidido_en is None
        importacion.refresh_from_db()
        assert importacion.estado == Importacion.Estado.PROCESANDO
        assert importacion.confirmada_en is None and importacion.terminada_en is None

    def test_avisa_si_el_texto_venia_cortado(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta, texto_truncado=True)))

        assert "se cortó" in el_unico_candidato().evidencia["texto_truncado"]

    def test_leer_no_toca_la_base(self, cuenta, django_assert_num_queries):
        leido = mensaje(cuenta)
        with django_assert_num_queries(0):
            lectura = leer(pagina(leido), organizacion_id=str(ORG_A), cuenta_id=cuenta.pk, proveedor_correo="gmail")
        assert len(lectura.candidatos) == 1

    def test_las_consultas_no_crecen_con_la_pagina(self, cuenta):
        """Una página de 1 y una de 30 hacen las mismas consultas: nada se
        busca mensaje por mensaje."""
        def consultas(cantidad, importacion):
            mensajes = [mensaje(cuenta, id_mensaje=f"n{cantidad}-{i}") for i in range(cantidad)]
            with CaptureQueriesContext(connection) as capturadas:
                guardar_pagina(importacion, pagina(*mensajes))
            return len(capturadas)

        assert consultas(1, crear_importacion(cuenta)) == consultas(30, crear_importacion(cuenta))
        assert CobroCandidato.objects.count() == 31


# ══════════════════════════════════════════════════════════════════════
# Idempotencia y aislamiento
# ══════════════════════════════════════════════════════════════════════


class TestIdempotencia:
    def test_guardar_dos_veces_la_misma_pagina_no_duplica(self, importacion, cuenta):
        dudoso = mensaje(cuenta, id_mensaje="dudoso", asunto="Tu recibo", texto="Total: $9.990\nFecha: 2026-10-01")
        misma = pagina(mensaje(cuenta), dudoso)

        guardar_pagina(importacion, misma)
        segunda = guardar_pagina(importacion, misma)

        assert CobroCandidato.objects.count() == 1
        importacion.refresh_from_db()
        assert len(importacion.errores) == 1 and importacion.errores_totales == 1
        assert importacion.candidatos_detectados == 1
        assert (segunda.candidatos_nuevos, segunda.ya_guardados, segunda.errores_nuevos) == (0, 1, 0)

    def test_el_mismo_correo_en_dos_cuentas_de_la_organizacion_es_un_candidato(self, importacion, cuenta):
        """Un recibo con copia a Gmail y a Outlook es un solo cobro."""
        outlook = crear_cuenta(proveedor="outlook", correo="persona@empresa.cl")
        otra = crear_importacion(outlook)
        en_gmail = mensaje(cuenta, id_mensaje="18c2", message_id="recibo-1@netflix.com")
        en_outlook = mensaje(outlook, id_mensaje="AAMkAGUAAAwTW09AAA=", message_id="recibo-1@netflix.com")

        guardar_pagina(importacion, pagina(en_gmail))
        resultado = guardar_pagina(otra, pagina(en_outlook))

        assert el_unico_candidato().importacion_id == importacion.pk
        otra.refresh_from_db()
        assert otra.candidatos_detectados == 0
        assert (resultado.candidatos_nuevos, resultado.ya_guardados) == (0, 1)

    def test_el_mismo_correo_dos_veces_en_la_pagina_cuenta_una(self, importacion, cuenta):
        primero = mensaje(cuenta, id_mensaje="en-recibidos", message_id="recibo-1@netflix.com")
        copia = mensaje(cuenta, id_mensaje="en-otra-carpeta", message_id="recibo-1@netflix.com")

        lectura = leer(pagina(primero, copia), organizacion_id=str(ORG_A), cuenta_id=cuenta.pk,
                       proveedor_correo="gmail")
        resultado = guardar_pagina(importacion, pagina(primero, copia))

        assert [c.evidencia["id_mensaje"] for c in lectura.candidatos] == ["en-recibidos"]
        assert el_unico_candidato().evidencia["id_mensaje"] == "en-recibidos"
        # La copia no es un candidato "que ya estaba": es el mismo correo.
        assert (resultado.candidatos_nuevos, resultado.ya_guardados) == (1, 0)

    def test_un_candidato_rechazado_no_se_vuelve_a_proponer(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta)))
        el_unico_candidato().rechazar(por="42")

        guardar_pagina(importacion, pagina(mensaje(cuenta)))

        assert el_unico_candidato().estado == CobroCandidato.Estado.RECHAZADO

    def test_el_mismo_message_id_en_otra_organizacion_es_otro_candidato(self, importacion, cuenta):
        ajena = crear_cuenta(org=ORG_B, correo="otra@gmail.com")
        de_la_otra = crear_importacion(ajena)

        guardar_pagina(importacion, pagina(mensaje(cuenta, message_id="recibo-1@netflix.com")))
        guardar_pagina(de_la_otra, pagina(mensaje(ajena, message_id="recibo-1@netflix.com")))

        assert sorted(CobroCandidato.objects.values_list("organizacion_id", flat=True)) == [ORG_A, ORG_B]

    def test_las_paginas_de_una_importacion_se_suman(self, importacion, cuenta):
        guardar_pagina(importacion, pagina(mensaje(cuenta, id_mensaje="p1")))
        guardar_pagina(importacion, pagina(
            mensaje(cuenta, id_mensaje="p2"),
            mensaje(cuenta, id_mensaje="p2-dudoso", asunto="Tu recibo", texto="Total: $9.990\nFecha: 2026-10-01"),
        ))

        importacion.refresh_from_db()
        assert (importacion.filas_procesadas, importacion.candidatos_detectados, importacion.errores_totales) == (3, 2, 1)
        assert importacion.progreso is None, "una lectura de correo no sabe su total hasta que termina"


class TestAislamientoYGuardas:
    def test_un_mensaje_de_otra_cuenta_no_se_guarda(self, importacion, cuenta):
        otra = crear_cuenta(proveedor="gmail", correo="otra@gmail.com")
        with pytest.raises(ValueError, match="otra cuenta"):
            guardar_pagina(importacion, pagina(mensaje(cuenta, id_mensaje="mio"), mensaje(otra, id_mensaje="ajeno")))

        assert not CobroCandidato.objects.exists()
        importacion.refresh_from_db()
        assert importacion.filas_procesadas == 0

    @pytest.mark.parametrize("estado", [
        Importacion.Estado.PENDIENTE, Importacion.Estado.COMPLETADA, Importacion.Estado.FALLIDA,
    ])
    def test_una_importacion_que_no_esta_procesando_no_recibe_mensajes(self, cuenta, estado):
        importacion = crear_importacion(cuenta, estado=estado)
        with pytest.raises(ImportacionNoDisponible):
            guardar_pagina(importacion, pagina(mensaje(cuenta)))
        assert not CobroCandidato.objects.exists()

    def test_si_otra_corrida_la_cerro_no_se_escribe_nada(self, importacion, cuenta):
        """La instancia cree que sigue `procesando`; en la base, el rescate ya
        la marcó `fallida`. Lanza, para que el cursor no avance (S3-FE-03)."""
        Importacion.objects.filter(pk=importacion.pk).update(estado=Importacion.Estado.FALLIDA)

        with pytest.raises(ImportacionNoDisponible, match="fallida"):
            guardar_pagina(importacion, pagina(mensaje(cuenta)))

        assert not CobroCandidato.objects.exists()
        importacion.refresh_from_db()
        assert (importacion.filas_procesadas, importacion.errores) == (0, [])

    def test_una_importacion_de_csv_no_recibe_correos(self, cuenta):
        de_csv = Importacion.objects.create(organizacion_id=ORG_A, usuario_id="42", origen=Importacion.Origen.CSV,
                                            estado=Importacion.Estado.PROCESANDO)
        with pytest.raises(ImportacionNoDisponible):
            guardar_pagina(de_csv, pagina(mensaje(cuenta)))

    def test_una_cuenta_de_otra_organizacion_no_sirve(self):
        ajena = crear_cuenta(org=ORG_B, correo="otra@gmail.com")
        mal_armada = crear_importacion(ajena, org=ORG_A)
        with pytest.raises(ImportacionNoDisponible):
            guardar_pagina(mal_armada, pagina(mensaje(ajena)))
        assert not CobroCandidato.objects.exists()

    def test_lo_guardado_se_deshace_con_la_transaccion_de_quien_llama(self, importacion, cuenta):
        """La lectura por cursor (S3-FE-03/05) llama esto dentro de su
        transacción: si después falla al mover el cursor, no queda nada."""
        with pytest.raises(RuntimeError), transaction.atomic():
            guardar_pagina(importacion, pagina(mensaje(cuenta)))
            raise RuntimeError("falló al guardar el cursor")

        assert not CobroCandidato.objects.exists()
        importacion.refresh_from_db()
        assert importacion.filas_procesadas == 0


def test_el_respaldo_sin_message_id_es_el_mismo_de_s3_fe_06(cuenta):
    """El omitido se identifica con la misma regla que un mensaje sin
    Message-ID: el refactor no cambió la identidad."""
    sin_mid = mensaje(cuenta, message_id="", id_mensaje="18c2f0a1")
    assert identificador_de(sin_mid) == identificador_del_proveedor("gmail", cuenta.pk, "18c2f0a1")
    assert identificador_de(sin_mid).startswith("gmail:")
