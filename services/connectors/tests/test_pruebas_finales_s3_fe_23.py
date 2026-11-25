"""S3-FE-23 — pruebas finales de punta a punta del lado de connectors.

Las pruebas de cada tarjeta prueban su pieza. Estas recorren el camino
completo, con los módulos REALES encadenados:

    Google (HTTP falso) ─▶ lector_gmail ─▶ lectura_programada ─▶ candidatos_correo
                                                                      │
    archivo CSV ─▶ procesar_importacion ─▶ csv_candidatos ────────────┤
                                                                      ▼
                                                 CobroCandidato ─▶ confirmacion ─▶ OutboxEvento

Qué es un doble y qué es real:
- DOBLE: solo `requests.get` de `lector_gmail` (el `GoogleFalso` de
  `test_lector_gmail.py`, con respuestas copiadas de la API de Gmail). No hay
  una cuenta de Google real en estas pruebas.
- REAL: todo lo demás, incluida la base, la tarea de importación del CSV y la
  API de desconexión.

Los casos llevan el número del doc 34 (`docs/flujos/felipe-orellana/`), que
tiene los pasos, el entorno y el resultado esperado y obtenido de cada uno.
La confirmación en PARALELO y las carreras de la lectura se prueban con dos
conexiones a PostgreSQL en sus propios archivos (el doc dice cuáles).
"""

import uuid
from datetime import date, datetime, timedelta, timezone as tz

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from connectors import confirmacion, proveedores
from connectors.lectura_programada import cuentas_para_leer, leer_cuenta
from connectors.models import AvanceDeLectura, CobroCandidato, CuentaConectada, Importacion, OutboxEvento
from tests.test_duplicados_s3_fe_17 import archivo, subir
from tests.test_lector_gmail import GoogleFalso, _Respuesta, error_google, parte

pytestmark = pytest.mark.django_db

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
AHORA = datetime(2026, 11, 24, 12, 0, tzinfo=tz.utc)
NL = chr(10)
RECIBO = NL.join(["Hola, gracias por tu pago.", "Fecha de cobro: 1 de octubre de 2026", "Total: CLP 9.990", ""])
#: 02-10-2026 13:30 UTC: el día después del cobro que dice el recibo.
LLEGO_2_OCT_2026 = "1790947800000"
#: 01-10-2025: un año ANTES del cobro que dice el recibo.
LLEGO_1_OCT_2025 = "1759325400000"


@pytest.fixture(autouse=True)
def _claves(claves):
    """Las cuentas guardan su token cifrado."""


@pytest.fixture
def google(monkeypatch):
    return GoogleFalso(monkeypatch)


def gmail():
    return CuentaConectada.objects.create(
        organizacion_id=ORG, proveedor="gmail", cuenta_externa="prueba@gmail.com", estado="conectada",
        access_token="ya29.token-de-prueba", refresh_token="1//refresco",
        token_expira_en=timezone.now() + timedelta(minutes=50),
    )


def correo(id_mensaje, texto, *, remitente="Netflix <info@account.netflix.com>",
           asunto="Tu recibo de Netflix", llego=LLEGO_2_OCT_2026):
    """Un mensaje como lo devuelve `messages.get?format=full`."""
    return {
        "id": id_mensaje, "threadId": id_mensaje, "internalDate": llego,
        "payload": {
            "partId": "", "mimeType": "multipart/alternative", "filename": "",
            "headers": [
                {"name": "From", "value": remitente},
                {"name": "Subject", "value": asunto},
                {"name": "Message-ID", "value": f"<{id_mensaje}@correo.example.test>"},
            ],
            "body": {"size": 0},
            "parts": [parte("text/plain", texto)],
        },
    }


BOLETIN = correo("m2", "Novedades de la semana, sin cobros.", remitente="Boletín <news@tienda.example>",
                 asunto="Boletín semanal")


def confirmar_todos():
    return [confirmacion.confirmar(c, por="42") for c in CobroCandidato.objects.order_by("fecha", "pk")]


# ══════════════════════════════════════════════════════════════════════
# Caso 1 — un correo autorizado termina en un candidato con su evidencia
# ══════════════════════════════════════════════════════════════════════


class TestCaso1CorreoAutorizado:
    def test_un_recibo_termina_en_un_candidato_y_un_boletin_no(self, google):
        c = gmail()
        google.con_mensajes(correo("m1", RECIBO), BOLETIN)

        resultado = leer_cuenta(c.pk, ahora=AHORA)

        assert (resultado["paginas"], resultado["mensajes"]) == (1, 2)
        (candidato,) = CobroCandidato.objects.all()
        assert (candidato.origen, candidato.estado, candidato.servicio_texto, str(candidato.importe),
                candidato.moneda, candidato.fecha) == ("correo", "propuesto", "Netflix", "9990.00", "CLP",
                                                       date(2026, 10, 1))
        assert candidato.evidencia["message_id"] == "m1@correo.example.test"
        importacion = Importacion.objects.get(pk=resultado["importacion"])
        assert (importacion.estado, importacion.candidatos_detectados, importacion.errores_totales) == (
            "completada", 1, 0)
        assert AvanceDeLectura.objects.get(cuenta=c).estado_lectura == "al_dia"
        # Leer no confirma nada: no hay órdenes hasta que alguien decide.
        assert not OutboxEvento.objects.exists()

    def test_un_recibo_que_no_cuadra_queda_como_error_trazable(self, google):
        """El recibo dice que cobró el 1-10-2026, pero llegó el 1-10-2025."""
        c = gmail()
        google.con_mensajes(correo("m1", RECIBO, llego=LLEGO_1_OCT_2025))

        resultado = leer_cuenta(c.pk, ahora=AHORA)

        assert not CobroCandidato.objects.exists()
        (error,) = Importacion.objects.get(pk=resultado["importacion"]).errores
        assert error["codigo"] == "fecha_no_indicada"
        assert error["identificador_origen"].startswith("mid:")

    def test_leer_otra_vez_el_mismo_correo_no_lo_duplica(self, google):
        c = gmail()
        google.con_mensajes(correo("m1", RECIBO), BOLETIN)
        leer_cuenta(c.pk, ahora=AHORA)
        leer_cuenta(c.pk, ahora=AHORA + timedelta(minutes=15))
        assert CobroCandidato.objects.count() == 1


# ══════════════════════════════════════════════════════════════════════
# Caso 2 — un CSV mixto
# ══════════════════════════════════════════════════════════════════════


MIXTO = archivo(
    "Fecha;Glosa;Monto;Moneda",
    "13/10/2026;NETFLIX.COM 1234 SANTIAGO CL;9990;CLP",
    "14/10/2026;;3990;CLP",
    "no es fecha;Spotify;3990;CLP",
    "16/10/2026;Disney Plus;no es monto;CLP",
    "17/10/2026;PAYPAL *SPOTIFY;4990;CLP",
    "17/10/2026;PAYPAL *SPOTIFY;4990;CLP",
)


class TestCaso2CsvMixto:
    def test_entrega_los_validos_y_cada_rechazo_con_su_fila_y_motivo(self):
        importacion = subir(MIXTO)

        assert (importacion.estado, importacion.filas_totales, importacion.candidatos_detectados,
                importacion.errores_totales) == ("completada", 6, 3, 3)
        assert [(e["fila"], e["codigo"]) for e in importacion.errores] == [
            (3, "descripcion_vacia"), (4, "fecha_invalida"), (5, "importe_invalido"),
        ]
        # Dos cobros iguales en el mismo archivo son dos cobros (S3-FE-17).
        assert sorted(CobroCandidato.objects.values_list("fecha", "importe")) == [
            (date(2026, 10, 13), 9990), (date(2026, 10, 17), 4990), (date(2026, 10, 17), 4990),
        ]

    def test_si_todas_las_fechas_son_ambiguas_no_adivina(self):
        """01/10 puede ser 1 de octubre o 10 de enero. Sin un día mayor que
        12 en el archivo, no se adivina: cada fila sale con su motivo."""
        importacion = subir(archivo(
            "Fecha;Glosa;Monto;Moneda",
            "01/10/2026;NETFLIX.COM;9990;CLP",
            "05/10/2026;PAYPAL *SPOTIFY;4990;CLP",
        ))
        assert importacion.candidatos_detectados == 0
        assert [(e["fila"], e["codigo"]) for e in importacion.errores] == [
            (2, "fecha_ambigua"), (3, "fecha_ambigua")]

    def test_volver_a_subirlo_y_confirmar_otra_vez_no_deja_ordenes_de_mas(self):
        subir(MIXTO)
        confirmar_todos()
        segunda = subir(MIXTO)
        confirmar_todos()

        assert segunda.candidatos_detectados == 0
        assert OutboxEvento.objects.count() == 3


# ══════════════════════════════════════════════════════════════════════
# Caso 3 — confirmar dos veces deja una sola orden
# ══════════════════════════════════════════════════════════════════════


class TestCaso3ConfirmacionRepetida:
    def test_el_doble_clic_no_deja_dos_ordenes(self, google):
        """En secuencia. En paralelo, con dos conexiones a PostgreSQL:
        `test_carrera_confirmar_rechazar_postgres.py`."""
        c = gmail()
        google.con_mensajes(correo("m1", RECIBO))
        leer_cuenta(c.pk, ahora=AHORA)
        candidato = CobroCandidato.objects.get()

        assert [confirmacion.confirmar(candidato, por="42"), confirmacion.confirmar(candidato, por="42")] == [
            True, False]
        (orden,) = OutboxEvento.objects.all()
        assert orden.datos["candidato_id"] == str(candidato.pk)
        assert orden.datos["identificador_origen"] == candidato.identificador_origen

    def test_un_correo_confirmado_que_se_vuelve_a_leer_no_deja_otra_orden(self, google):
        c = gmail()
        google.con_mensajes(correo("m1", RECIBO))
        leer_cuenta(c.pk, ahora=AHORA)
        confirmar_todos()
        leer_cuenta(c.pk, ahora=AHORA + timedelta(minutes=15))
        confirmar_todos()
        assert OutboxEvento.objects.count() == 1


# ══════════════════════════════════════════════════════════════════════
# Caso 4 — un fallo temporal de Google se reintenta sin perder nada
# ══════════════════════════════════════════════════════════════════════


class TestCaso4FalloTemporal:
    def test_un_503_se_reintenta_una_sola_vez_y_termina_en_el_candidato(self, google):
        c = gmail()
        google.lista = _Respuesta(503, error_google(503, "backendError", "UNAVAILABLE"))

        primero = leer_cuenta(c.pk, ahora=AHORA)

        assert (primero["reintentar_en"], primero["error"]) == (60, "falla_del_proveedor")
        assert AvanceDeLectura.objects.get(cuenta=c).estado_lectura == "reintentando"
        # Mientras espera, ni el beat ni otra tarea la leen.
        assert cuentas_para_leer(AHORA + timedelta(seconds=30)) == []
        assert leer_cuenta(c.pk, ahora=AHORA + timedelta(seconds=30)) == {"omitida": "reintento_pendiente"}

        google.con_mensajes(correo("m1", RECIBO))
        segundo = leer_cuenta(c.pk, cadena=primero["cadena"], ahora=AHORA + timedelta(seconds=60))

        assert "reintentar_en" not in segundo
        assert CobroCandidato.objects.count() == 1
        avance = AvanceDeLectura.objects.get(cuenta=c)
        assert (avance.estado_lectura, avance.fallos_seguidos) == ("al_dia", 0)


# ══════════════════════════════════════════════════════════════════════
# Caso 5 — desconectar la cuenta detiene la lectura
# ══════════════════════════════════════════════════════════════════════


class TestCaso5Desconexion:
    def test_desconectar_desde_la_api_deja_de_leer_y_conserva_lo_ya_leido(self, google, monkeypatch):
        c = gmail()
        google.con_mensajes(correo("m1", RECIBO))
        leer_cuenta(c.pk, ahora=AHORA)
        monkeypatch.setattr(proveedores, "revocar", lambda *a, **k: True)

        respuesta = APIClient().delete(f"/api/conectores/{c.pk}/", headers={"X-Organizacion-Id": str(ORG)})

        assert respuesta.status_code == 200
        c.refresh_from_db()
        assert c.estado == "desconectada"
        assert cuentas_para_leer(AHORA + timedelta(hours=1)) == []
        pedidas = len(google.peticiones)
        assert leer_cuenta(c.pk, ahora=AHORA + timedelta(hours=1)) == {"omitida": "no_conectada"}
        assert len(google.peticiones) == pedidas
        assert CobroCandidato.objects.count() == 1


# ══════════════════════════════════════════════════════════════════════
# Hallazgo — el mismo cobro por correo y por CSV
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.xfail(strict=True, reason=(
    "Hallazgo de S3-FE-23 (doc 34): la unicidad es por origen, así que el mismo cobro leído en el "
    "recibo y en la cartola son dos candidatos y dos órdenes. Falta decidir cómo se reconoce."))
def test_el_mismo_cobro_por_correo_y_por_csv_deja_una_sola_orden(google):
    c = gmail()
    google.con_mensajes(correo("m1", RECIBO))
    leer_cuenta(c.pk, ahora=AHORA)
    subir(archivo("fecha;descripcion;monto;moneda", "2026-10-01;NETFLIX.COM;9990;CLP"))

    confirmar_todos()

    assert OutboxEvento.objects.count() == 1
