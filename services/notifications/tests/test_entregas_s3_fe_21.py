"""
S3-FE-21 — conectar el envío real de alertas y registrar entrega o error.

Los criterios de la tarjeta:
- una entrega tiene evidencia del proveedor o un error explícito;
- no se declara entregada solo por encolarla.

Y lo que pide el alcance: reintentos controlados, respeto de preferencias,
cuota y horario de descanso.

── Qué es doble y qué no ────────────────────────────────────────────────────
· El correo se manda con el backend de Django. En la mayoría de las pruebas
  es `locmem` (un buzón en memoria que pytest-django pone solo): no entrega
  nada, y la evidencia lo dice (`backend` = locmem).
· `TestSMTP` usa el backend SMTP DE VERDAD contra `ServidorSMTP`, un
  servidor local de prueba que responde lo que se le pida.
· El push no tiene proveedor. Donde se prueba la política del push se usa
  `DobleDePush`, que se declara como doble y no entrega nada.

Las de dos conexiones a PostgreSQL están en `test_carrera_entregas_postgres.py`.
"""

import datetime as dt
import smtplib
import uuid
import zoneinfo
from io import StringIO

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError

from notifications import canales, entregas
from notifications.canales import ErrorDeEnvio, clasificar_smtp
from notifications.generador import generar
from notifications.models import (
    Alerta,
    EntregaAlerta,
    PreferenciaNotificacion,
)
from notifications.politica_envio import PUSH, Politica, cuando_enviar, dia_local
from tests.directorio_falso import DIRECTORIO
from tests.smtp_de_prueba import ServidorSMTP, puerto_cerrado
from tests.test_generador import HOY, vigilada

pytestmark = pytest.mark.django_db

ORG = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTRA = uuid.UUID("22222222-2222-2222-2222-222222222222")
SANTIAGO = zoneinfo.ZoneInfo("America/Santiago")
Estado = EntregaAlerta.Estado


def a_las(hora, minuto=0, *, dia=21, mes=11) -> dt.datetime:
    """Un instante de noviembre de 2026 en Santiago (UTC-3 por el horario de verano)."""
    return dt.datetime(2026, mes, dia, hora, minuto, tzinfo=SANTIAGO)


def persona(usuario="42", *, org=ORG, correo="ana@ejemplo.cl", **preferencias):
    preferencia = PreferenciaNotificacion.objects.create(
        organizacion_id=org, usuario_id=usuario, **preferencias,
    )
    if correo:
        DIRECTORIO.agregar(org, usuario, correo)
    return preferencia


def nueva_alerta(*, org=ORG, tipo=Alerta.Tipo.PROXIMO_COBRO, ahora=None) -> Alerta:
    alerta = Alerta.objects.create(
        organizacion_id=org, tipo=tipo,
        titulo="Netflix se cobra en 3 días",
        mensaje="El cobro de 9.990 CLP de Netflix está programado para el 24-11-2026.",
        evento_id=uuid.uuid4(),
    )
    entregas.planificar(alerta, ahora=ahora or a_las(9))
    return alerta


def la_entrega(canal="email", usuario="42") -> EntregaAlerta:
    return EntregaAlerta.objects.get(usuario_id=usuario, canal=canal)


class DobleDePush:
    """DOBLE DE PRUEBA, no un proveedor de push: anota lo que se le pide y
    contesta como si lo hubieran aceptado. Solo existe para probar la
    política del push (descanso, cuota), que no tiene proveedor real."""

    nombre = "push"

    def __init__(self):
        self.enviados = []

    def destino(self, organizacion_id, usuario_id):
        return f"dispositivo-de-prueba-{usuario_id}"

    def message_id(self, entrega_id):
        return f"push-de-prueba-{entrega_id}"

    def validar(self, envio):
        pass

    def enviar(self, envio):
        self.enviados.append(envio)
        return {"doble": "push de prueba, no entrega nada"}


@pytest.fixture(autouse=True)
def remitente(settings):
    """El remitente fijo: el Message-ID toma su dominio."""
    settings.DEFAULT_FROM_EMAIL = "no-responder@ejemplo.cl"


@pytest.fixture
def push(monkeypatch, settings):
    """Habilita el push con el doble. Sin esto, push no está disponible."""
    doble = DobleDePush()
    monkeypatch.setitem(canales.CANALES, "push", doble)
    settings.CANALES_HABILITADOS = ["email", "push", "in_app"]
    return doble


# ══════════════════════════════════════════════════════════════════════
# A quién: la planificación respeta las preferencias
# ══════════════════════════════════════════════════════════════════════


class TestPlanificar:
    def test_una_entrega_por_persona_y_canal_encendido(self):
        persona("42", por_push=True)
        persona("43", correo="beto@ejemplo.cl")
        alerta = nueva_alerta()
        assert sorted(alerta.entregas.values_list("usuario_id", "canal")) == [
            ("42", "email"), ("42", "push"), ("43", "email"),
        ]

    def test_in_app_no_tiene_fila_porque_la_alerta_ya_es_esa_entrega(self):
        persona("42", por_email=False, por_push=False, en_la_app=True)
        assert nueva_alerta().entregas.count() == 0

    def test_con_el_correo_apagado_no_planifica_correo(self):
        persona("42", por_email=False)
        assert not nueva_alerta().entregas.exists()

    def test_con_el_tipo_apagado_no_planifica_nada(self):
        persona("42", avisar_proximo_cobro=False, por_push=True)
        assert not nueva_alerta().entregas.exists()

    def test_el_tipo_apagado_no_afecta_a_otro_tipo(self):
        persona("42", avisar_proximo_cobro=False)
        assert nueva_alerta(tipo=Alerta.Tipo.FIN_PRUEBA).entregas.count() == 1

    def test_no_mezcla_organizaciones(self):
        persona("42", org=OTRA)
        assert not nueva_alerta(org=ORG).entregas.exists()

    def test_una_organizacion_sin_preferencias_no_tiene_a_quien_escribirle(self):
        assert not nueva_alerta().entregas.exists()

    def test_planificar_dos_veces_no_duplica(self):
        persona("42")
        alerta = nueva_alerta()
        assert entregas.planificar(alerta, ahora=a_las(9)) == 1
        assert EntregaAlerta.objects.count() == 1

    def test_nace_pendiente_y_sin_nada_que_parezca_entregada(self):
        """Criterio 2: planificar (encolar) no es entregar."""
        persona("42")
        nueva_alerta()
        entrega = la_entrega()
        assert entrega.estado == Estado.PENDIENTE
        assert entrega.aceptada_en is None
        assert entrega.evidencia == {}
        assert entrega.intentos == 0


def sin_fila(usuario="42", *, org=ORG, correo="ana@ejemplo.cl"):
    """Una persona de la organización (auth la conoce) que nunca abrió
    Ajustes: no tiene fila de preferencias. Es lo normal para quien no las
    cambió."""
    DIRECTORIO.agregar(org, usuario, correo)


def se_va(usuario, *, org=ORG):
    """Deja la organización: auth ya no la entrega (S3-FE-21)."""
    DIRECTORIO.quitar(org, usuario)


class TestPersonasSinFilaDePreferencias:
    """La fila de preferencias nace con el primer GET de Ajustes. Quien no
    abrió Ajustes tiene las de omisión (correo encendido): son las que la
    pantalla le muestra como suyas, y RF-09 dice que el correo siempre está."""

    def test_recibe_por_correo_con_las_de_omision(self):
        sin_fila("42")
        assert list(nueva_alerta().entregas.values_list("usuario_id", "canal")) == [("42", "email")]

    def test_las_de_omision_no_piden_push(self):
        sin_fila("42")
        assert not nueva_alerta().entregas.filter(canal="push").exists()

    def test_no_se_le_crea_fila_al_planificar(self):
        """Las de omisión se usan sin guardarse: la fila sigue siendo de la
        persona, que la crea cuando abre Ajustes."""
        sin_fila("42")
        nueva_alerta()
        assert not PreferenciaNotificacion.objects.exists()

    def test_la_fila_guardada_manda_sobre_la_omision(self):
        persona("42", por_email=False)
        assert not nueva_alerta().entregas.exists()

    def test_no_mezcla_organizaciones(self):
        sin_fila("42", org=OTRA)
        assert not nueva_alerta(org=ORG).entregas.exists()

    def test_desde_el_generador_tambien(self, mailoutbox):
        """El escenario de la revisión: dirección conocida, sin fila, un cobro
        en 2 días. Antes: 1 alerta y 0 entregas."""
        sin_fila("42")
        vigilada(cobro=HOY.date() + dt.timedelta(days=2))
        assert len(generar(ahora=HOY).creadas) == 1
        assert list(EntregaAlerta.objects.values_list("usuario_id", "canal")) == [("42", "email")]
        assert entregas.despachar(ahora=HOY)[entregas.ACEPTADA] == 1
        assert [correo.to for correo in mailoutbox] == [["ana@ejemplo.cl"]]

    def test_su_ventana_por_omision_cuenta_para_el_generador(self):
        """Otra persona pidió 7 días y esta no guardó nada (3 por omisión).
        Con un cobro a 3 días hay que generar el aviso de 3: si el generador
        solo mirara las filas guardadas, solo existiría la ventana de 7."""
        persona("43", correo="beto@ejemplo.cl", dias_anticipacion=7)
        sin_fila("42")
        vigilada(cobro=HOY.date() + dt.timedelta(days=3))
        generar(ahora=HOY - dt.timedelta(days=4))       # faltan 7: avisa la de 7
        generar(ahora=HOY)                              # faltan 3: avisa la de 3
        assert sorted(Alerta.objects.values_list("datos__anticipacion_dias", flat=True)) == [3, 7]


class TestAnticipacionDeCadaPersona:
    """La alerta de cobro es de la organización y lleva la ventana más
    cercana que pidió alguien; el correo es de cada persona y respeta SU
    anticipación. A pide 3 días y B pide 7."""

    def personas(self):
        persona("A", correo="a@ejemplo.cl", dias_anticipacion=3)
        persona("B", correo="b@ejemplo.cl", dias_anticipacion=7)

    def entregas_de(self, dias):
        return sorted(
            EntregaAlerta.objects.filter(alerta__datos__anticipacion_dias=dias)
            .values_list("usuario_id", "canal")
        )

    def test_la_ventana_de_otra_persona_no_le_escribe(self, mailoutbox):
        """El escenario de la revisión: antes salían correos a A y a B."""
        self.personas()
        vigilada(cobro=HOY.date() + dt.timedelta(days=7))
        generar(ahora=HOY)
        assert self.entregas_de(7) == [("B", "email")]
        entregas.despachar(ahora=HOY)
        assert [correo.to for correo in mailoutbox] == [["b@ejemplo.cl"]]

    def test_cada_una_recibe_un_solo_aviso_por_cobro(self, mailoutbox):
        """A los 3 días sale la ventana de A. B ya recibió la suya: no otra."""
        self.personas()
        vigilada(cobro=HOY.date() + dt.timedelta(days=7))
        generar(ahora=HOY)
        entregas.despachar(ahora=HOY)
        cuatro_dias_despues = HOY + dt.timedelta(days=4)
        generar(ahora=cuatro_dias_despues)
        assert self.entregas_de(3) == [("A", "email")]
        entregas.despachar(ahora=cuatro_dias_despues)
        assert sorted(correo.to[0] for correo in mailoutbox) == ["a@ejemplo.cl", "b@ejemplo.cl"]

    def test_si_su_ventana_no_alcanzo_a_generarse_recibe_la_siguiente(self):
        """Una suscripción creada a 2 días del cobro: solo existe la ventana
        de 3. B pidió 7 y ya está dentro: es su primer aviso, le toca."""
        self.personas()
        vigilada(cobro=HOY.date() + dt.timedelta(days=2))
        generar(ahora=HOY)
        assert self.entregas_de(3) == [("A", "email"), ("B", "email")]

    def test_otro_cobro_de_la_misma_suscripcion_es_otro_aviso(self):
        self.personas()
        suscripcion = vigilada(cobro=HOY.date() + dt.timedelta(days=7))
        generar(ahora=HOY)
        suscripcion.proximo_cobro = HOY.date() + dt.timedelta(days=37)
        suscripcion.save()
        generar(ahora=HOY + dt.timedelta(days=30))
        assert sorted(EntregaAlerta.objects.values_list("usuario_id", flat=True)) == ["B", "B"]

    def test_si_achica_la_anticipacion_antes_del_envio_se_descarta_y_recibe_la_suya(self, mailoutbox):
        self.personas()
        vigilada(cobro=HOY.date() + dt.timedelta(days=7))
        generar(ahora=HOY)
        PreferenciaNotificacion.objects.filter(usuario_id="B").update(dias_anticipacion=3)
        entregas.despachar(ahora=HOY)
        entrega = la_entrega(usuario="B")
        assert (entrega.estado, entrega.motivo) == (Estado.DESCARTADA, entregas.MOTIVO_FUERA_DE_ANTICIPACION)
        assert mailoutbox == []

        cuatro_dias_despues = HOY + dt.timedelta(days=4)
        generar(ahora=cuatro_dias_despues)
        assert self.entregas_de(3) == [("A", "email"), ("B", "email")]

    def test_el_fin_de_prueba_no_depende_de_la_anticipacion(self):
        """FE-18 avisa a las 48 y 24 h a todos: no hay anticipación por persona."""
        persona("A", correo="a@ejemplo.cl", dias_anticipacion=30)
        vigilada(estado="prueba", fin_prueba=HOY.date() + dt.timedelta(days=2))
        generar(ahora=HOY)
        assert list(EntregaAlerta.objects.values_list("alerta__tipo", "usuario_id")) == [
            (Alerta.Tipo.FIN_PRUEBA, "A"),
        ]


class TestDesdeElGenerador:
    def test_la_alerta_nueva_trae_sus_entregas_y_no_manda_nada(self, mailoutbox):
        persona("42")
        vigilada(cobro=dt.date(2026, 11, 22))
        resultado = generar(ahora=HOY)
        assert len(resultado.creadas) == 1
        entrega = la_entrega()
        assert entrega.alerta == resultado.creadas[0]
        assert entrega.estado == Estado.PENDIENTE
        assert entrega.proximo_intento_en == HOY
        assert mailoutbox == []

    def test_la_segunda_corrida_no_planifica_otra_vez(self):
        persona("42")
        vigilada(cobro=dt.date(2026, 11, 22))
        generar(ahora=HOY)
        generar(ahora=HOY + dt.timedelta(hours=3))
        assert EntregaAlerta.objects.count() == 1

    def test_si_planificar_falla_no_queda_la_alerta_sola(self, monkeypatch):
        """Misma transacción: o quedan las dos o ninguna."""
        persona("42")
        vigilada(cobro=dt.date(2026, 11, 22))

        def falla(alerta, *, ahora=None):
            raise RuntimeError("se cayó la planificación")

        monkeypatch.setattr(entregas, "planificar", falla)
        with pytest.raises(RuntimeError):
            generar(ahora=HOY)
        assert not Alerta.objects.exists()


# ══════════════════════════════════════════════════════════════════════
# Criterio 1: evidencia del proveedor o error explícito
# ══════════════════════════════════════════════════════════════════════


class TestCorreoAceptado:
    def test_aceptada_con_evidencia(self, mailoutbox):
        persona("42")
        nueva_alerta()
        resumen = entregas.despachar(ahora=a_las(10))
        assert resumen[entregas.ACEPTADA] == 1

        entrega = la_entrega()
        assert entrega.estado == Estado.ACEPTADA
        assert entrega.aceptada_en == a_las(10)
        assert entrega.intentos == 1
        assert entrega.destino == "ana@ejemplo.cl"
        assert entrega.message_id == f"<alerta-{entrega.pk}@ejemplo.cl>"
        assert entrega.evidencia == {
            "message_id": entrega.message_id,
            "backend": "django.core.mail.backends.locmem.EmailBackend",
        }
        assert entrega.codigo_error == ""

    def test_el_correo_lleva_el_message_id_de_la_evidencia(self, mailoutbox):
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        [correo] = mailoutbox
        assert correo.to == ["ana@ejemplo.cl"]
        assert correo.subject == "Netflix se cobra en 3 días · Ojo al Gasto"
        assert "9.990 CLP" in correo.body
        assert correo.message()["Message-ID"] == la_entrega().message_id

    def test_el_message_id_usa_el_dominio_del_remitente(self, settings, mailoutbox):
        settings.DEFAULT_FROM_EMAIL = "avisos@ojoalgasto.cl"
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega()
        assert entrega.message_id == f"<alerta-{entrega.pk}@ojoalgasto.cl>"
        assert mailoutbox[0].from_email == "avisos@ojoalgasto.cl"

    def test_el_message_id_sale_bien_formado_con_un_remitente_con_nombre(self, settings, mailoutbox):
        """Antes: «<alerta-…@ojoalgasto.cl>>», con el «>» del nombre visible."""
        settings.DEFAULT_FROM_EMAIL = "Ojo al Gasto <no-responder@ojoalgasto.cl>"
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega()
        assert entrega.message_id == f"<alerta-{entrega.pk}@ojoalgasto.cl>"
        assert mailoutbox[0].message()["Message-ID"] == entrega.message_id

    def test_aceptada_no_se_vuelve_a_mandar(self, mailoutbox):
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        resumen = entregas.despachar(ahora=a_las(11))
        assert resumen.conteo == {}
        assert len(mailoutbox) == 1


class TestErrorExplicito:
    def test_sin_direccion_conocida_falla_con_codigo_y_sin_mandar(self, mailoutbox):
        """Se planificó cuando era parte de la organización, y al mandar auth
        ya no la entrega (la sacaron, o se desactivó)."""
        persona("42")
        nueva_alerta()
        se_va("42")
        assert entregas.despachar(ahora=a_las(10))[entregas.FALLIDA] == 1
        entrega = la_entrega()
        assert (entrega.estado, entrega.codigo_error) == (Estado.FALLIDA, "sin_direccion")
        assert entrega.intentos == 0, "no se habló con ningún proveedor"
        assert mailoutbox == []

    def test_una_direccion_que_no_es_correo_falla_sin_mandar(self, mailoutbox):
        persona("42", correo="esto no es un correo")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega()
        assert (entrega.estado, entrega.codigo_error) == (Estado.FALLIDA, "direccion_invalida")
        assert "esto no es" not in entrega.detalle_error
        assert mailoutbox == []

    def test_el_push_no_tiene_proveedor_y_lo_dice(self, mailoutbox):
        persona("42", por_email=False, por_push=True)
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega("push")
        assert (entrega.estado, entrega.codigo_error) == (Estado.FALLIDA, "canal_no_disponible")
        assert entrega.aceptada_en is None and entrega.evidencia == {}

    def test_habilitar_push_por_configuracion_no_inventa_un_proveedor(self, settings):
        settings.CANALES_HABILITADOS = ["email", "push", "in_app"]
        persona("42", por_email=False, por_push=True)
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        assert la_entrega("push").codigo_error == "canal_no_disponible"

    def test_sin_el_correo_habilitado_tampoco_se_manda(self, settings, mailoutbox):
        settings.CANALES_HABILITADOS = ["in_app"]
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        assert la_entrega().codigo_error == "canal_no_disponible"
        assert mailoutbox == []

    def test_un_titulo_con_salto_de_linea_sale_en_una_linea(self, mailoutbox):
        """El nombre de la suscripción no se limpia de saltos de línea. Antes:
        BadHeaderError, 5 reintentos como «inesperado» y agotada."""
        persona("42")
        alerta = nueva_alerta()
        Alerta.objects.filter(pk=alerta.pk).update(titulo="Netflix\nse cobra\r\nen 3 días")
        assert entregas.despachar(ahora=a_las(10))[entregas.ACEPTADA] == 1
        assert mailoutbox[0].subject == "Netflix se cobra en 3 días · Ojo al Gasto"

    def test_un_encabezado_invalido_falla_sin_gastar_intento(self, monkeypatch, mailoutbox):
        """Determinístico: repetirlo da lo mismo. Se descubre antes de
        reclamar, sin abrir la conexión con el servidor."""
        persona("42")
        nueva_alerta()
        real = entregas._envio

        def con_salto(entrega, destino):
            envio = real(entrega, destino)
            return canales.Envio(envio.destino, "Netflix\nse cobra", envio.cuerpo, envio.message_id)

        monkeypatch.setattr(entregas, "_envio", con_salto)
        assert entregas.despachar(ahora=a_las(10))[entregas.FALLIDA] == 1
        entrega = la_entrega()
        assert (entrega.estado, entrega.codigo_error, entrega.intentos) == (
            Estado.FALLIDA, "mensaje_invalido", 0)
        assert mailoutbox == []
        assert entregas.despachar(ahora=a_las(20)).conteo == {}

    def test_el_canal_tampoco_lo_reintenta_si_llega_a_mandarlo(self, mailoutbox):
        envio = canales.Envio("ana@ejemplo.cl", "Netflix\nse cobra", "cuerpo", "<alerta-x@ejemplo.cl>")
        with pytest.raises(ErrorDeEnvio) as error:
            canales.CanalCorreo().enviar(envio)
        assert (error.value.codigo, error.value.permanente) == ("mensaje_invalido", True)
        assert mailoutbox == []

    def test_un_error_permanente_no_se_reintenta(self, monkeypatch, mailoutbox):
        persona("42")
        nueva_alerta()
        monkeypatch.setattr(canales.CanalCorreo, "enviar", lambda self, envio: (_ for _ in ()).throw(
            ErrorDeEnvio("smtp_550", "550 5.1.1 no existe", permanente=True)))
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega()
        assert (entrega.estado, entrega.codigo_error, entrega.intentos) == (Estado.FALLIDA, "smtp_550", 1)
        assert entregas.despachar(ahora=a_las(20)).conteo == {}

    def test_ninguna_queda_sin_evidencia_ni_error(self, monkeypatch, push, mailoutbox):
        """El criterio dicho al revés: después de una corrida, ninguna fila
        terminada queda muda."""
        persona("42")                                   # aceptada
        persona("43", correo="beto@ejemplo.cl")         # sin dirección al mandar
        persona("44", correo="otra@ejemplo.cl")         # transitorio
        nueva_alerta()
        se_va("43")
        real = canales.CanalCorreo.enviar

        def enviar(self, envio):
            if envio.destino == "otra@ejemplo.cl":
                raise ErrorDeEnvio("smtp_451", "451 intente más tarde", permanente=False)
            return real(self, envio)

        monkeypatch.setattr(canales.CanalCorreo, "enviar", enviar)
        entregas.despachar(ahora=a_las(10))
        for entrega in EntregaAlerta.objects.all():
            if entrega.estado == Estado.ACEPTADA:
                assert entrega.aceptada_en and entrega.evidencia["message_id"]
            else:
                assert entrega.codigo_error, f"{entrega} sin código"
                assert entrega.aceptada_en is None
        assert sorted(EntregaAlerta.objects.values_list("estado", flat=True)) == [
            Estado.ACEPTADA, Estado.FALLIDA, Estado.REINTENTO,
        ]


# ══════════════════════════════════════════════════════════════════════
# Criterio 2: no se declara entregada sin la aceptación
# ══════════════════════════════════════════════════════════════════════


class TestNoEntregadaSinAceptacion:
    def test_si_el_backend_no_confirma_no_es_aceptada(self, monkeypatch):
        persona("42")
        nueva_alerta()
        monkeypatch.setattr("django.core.mail.EmailMessage.send", lambda self, fail_silently=False: 0)
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega()
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "sin_confirmacion")
        assert entrega.aceptada_en is None

    @pytest.mark.parametrize("backend", [
        "django.core.mail.backends.dummy.EmailBackend",
        "django.core.mail.backends.console.EmailBackend",
        "django.core.mail.backends.filebased.EmailBackend",
    ])
    def test_un_backend_sin_proveedor_no_despacha_ni_toca_la_entrega(self, settings, backend):
        """Con estos `send()` devuelve 1 sin que salga nada. Antes: aceptada
        «por el proveedor», sin proveedor, y nunca se reintentaba."""
        settings.EMAIL_BACKEND = backend
        persona("42")
        nueva_alerta()
        with pytest.raises(ImproperlyConfigured, match="no entrega a ningún proveedor"):
            entregas.despachar(ahora=a_las(10))
        entrega = la_entrega()
        assert (entrega.estado, entrega.intentos, entrega.evidencia) == (Estado.PENDIENTE, 0, {})

    def test_el_buzon_en_memoria_no_es_proveedor_fuera_de_las_pruebas(self, settings, mailoutbox):
        settings.EMAIL_BACKENDS_CON_PROVEEDOR = ["django.core.mail.backends.smtp.EmailBackend"]
        persona("42")
        nueva_alerta()
        with pytest.raises(ImproperlyConfigured):
            entregas.despachar(ahora=a_las(10))
        assert la_entrega().estado == Estado.PENDIENTE
        assert mailoutbox == []

    def test_por_omision_solo_smtp_es_proveedor(self):
        """El valor de los settings, no el que las pruebas amplían."""
        from notifications_config import settings as configuracion

        assert configuracion.EMAIL_BACKENDS_CON_PROVEEDOR == ["django.core.mail.backends.smtp.EmailBackend"]

    def test_atender_una_sola_tampoco_la_da_por_aceptada(self, settings):
        """La barrera está también en el reclamo, no solo al empezar la corrida."""
        settings.EMAIL_BACKEND = "django.core.mail.backends.dummy.EmailBackend"
        persona("42")
        nueva_alerta()
        with pytest.raises(ImproperlyConfigured):
            entregas.atender(la_entrega().pk, ahora=a_las(10))
        assert (la_entrega().estado, la_entrega().intentos) == (Estado.PENDIENTE, 0)

    def test_mientras_se_manda_no_es_aceptada(self, monkeypatch):
        persona("42")
        nueva_alerta()
        vista = {}

        def enviar(self, envio):
            vista["estado"] = la_entrega().estado
            vista["aceptada_en"] = la_entrega().aceptada_en
            return {"message_id": envio.message_id, "backend": "prueba"}

        monkeypatch.setattr(canales.CanalCorreo, "enviar", enviar)
        entregas.despachar(ahora=a_las(10))
        assert vista == {"estado": Estado.ENVIANDO, "aceptada_en": None}
        assert la_entrega().estado == Estado.ACEPTADA

    def test_un_error_no_clasificado_no_es_aceptada_y_la_corrida_sigue(self, monkeypatch, mailoutbox):
        persona("42")
        persona("43", correo="beto@ejemplo.cl")
        nueva_alerta()
        real = canales.CanalCorreo.enviar

        def enviar(self, envio):
            if envio.destino == "ana@ejemplo.cl":
                raise KeyError("un error de programación")
            return real(self, envio)

        monkeypatch.setattr(canales.CanalCorreo, "enviar", enviar)
        resumen = entregas.despachar(ahora=a_las(10))
        assert resumen[entregas.REINTENTO] == 1 and resumen[entregas.ACEPTADA] == 1
        ana = la_entrega(usuario="42")
        assert (ana.estado, ana.codigo_error, ana.detalle_error) == (Estado.REINTENTO, "inesperado", "KeyError")
        assert [c.to for c in mailoutbox] == [["beto@ejemplo.cl"]]


# ══════════════════════════════════════════════════════════════════════
# Reintentos: espera progresiva, tope y agotamiento observable
# ══════════════════════════════════════════════════════════════════════


def falla_siempre(monkeypatch, codigo="smtp_451"):
    intentos = []

    def enviar(self, envio):
        intentos.append(envio.message_id)
        raise ErrorDeEnvio(codigo, "451 4.7.0 intente más tarde", permanente=False)

    monkeypatch.setattr(canales.CanalCorreo, "enviar", enviar)
    return intentos


class TestReintentos:
    def test_espera_progresiva_hasta_agotarse(self, monkeypatch):
        persona("42")
        nueva_alerta()
        intentos = falla_siempre(monkeypatch)
        ahora = a_las(10)
        esperas = []
        for _ in range(entregas.MAX_INTENTOS - 1):
            entregas.despachar(ahora=ahora)
            entrega = la_entrega()
            assert entrega.estado == Estado.REINTENTO
            esperas.append(entrega.proximo_intento_en - ahora)
            ahora = entrega.proximo_intento_en
        assert esperas == list(entregas.ESPERAS_REINTENTO)
        assert esperas == sorted(esperas), "la espera no crece"

        resumen = entregas.despachar(ahora=ahora)
        assert resumen[entregas.AGOTADA] == 1
        entrega = la_entrega()
        assert (entrega.estado, entrega.intentos, entrega.codigo_error) == (
            Estado.AGOTADA, entregas.MAX_INTENTOS, "smtp_451")
        assert len(intentos) == entregas.MAX_INTENTOS
        assert entregas.despachar(ahora=ahora + dt.timedelta(days=1)).conteo == {}

    def test_antes_de_la_espera_no_se_reintenta(self, monkeypatch):
        persona("42")
        nueva_alerta()
        intentos = falla_siempre(monkeypatch)
        entregas.despachar(ahora=a_las(10))
        assert entregas.despachar(ahora=a_las(10) + dt.timedelta(seconds=59)).conteo == {}
        assert len(intentos) == 1

    def test_todos_los_intentos_llevan_el_mismo_message_id(self, monkeypatch):
        """La clave de idempotencia del canal: si un intento llegó y no lo
        supimos (un timeout), el repetido se puede reconocer."""
        persona("42")
        nueva_alerta()
        intentos = falla_siempre(monkeypatch)
        ahora = a_las(10)
        for _ in range(3):
            entregas.despachar(ahora=ahora)
            ahora = la_entrega().proximo_intento_en
        assert len(intentos) == 3 and len(set(intentos)) == 1

    def test_el_comando_muestra_las_agotadas_tambien_en_stderr(self, monkeypatch):
        persona("42")
        nueva_alerta()
        falla_siempre(monkeypatch)
        entrega = la_entrega()
        EntregaAlerta.objects.filter(pk=entrega.pk).update(
            estado=Estado.REINTENTO, intentos=entregas.MAX_INTENTOS - 1,
        )
        salida, errores = StringIO(), StringIO()
        call_command("despachar_alertas", ahora="2026-11-21T10:00:00-03:00", stdout=salida, stderr=errores)
        assert "1 agotada(s)" in salida.getvalue()
        assert f"entrega {entrega.pk} [email] agotada: smtp_451 (intento {entregas.MAX_INTENTOS})" in errores.getvalue()
        assert "ana@ejemplo.cl" not in salida.getvalue() + errores.getvalue()


class TestEstados:
    """En espera, saliendo o terminada: cada estado está en un solo grupo."""

    def test_los_grupos_cubren_todos_los_estados_sin_repetir(self):
        en_espera, terminales = set(EntregaAlerta.EN_ESPERA), set(EntregaAlerta.TERMINALES)
        assert not en_espera & terminales
        assert Estado.ENVIANDO not in en_espera | terminales
        assert en_espera | terminales | {Estado.ENVIANDO} == set(Estado)

    @pytest.mark.parametrize("estado", EntregaAlerta.TERMINALES)
    def test_de_un_estado_terminal_no_se_sale(self, estado, mailoutbox):
        persona("42")
        nueva_alerta()
        EntregaAlerta.objects.update(estado=estado, proximo_intento_en=a_las(9))
        assert not entregas.elegibles(a_las(10)).exists()
        assert entregas.despachar(ahora=a_las(10)).conteo == {}
        assert mailoutbox == []

    @pytest.mark.parametrize("estado", EntregaAlerta.EN_ESPERA)
    def test_uno_en_espera_se_intenta_cuando_llega_su_hora(self, estado):
        persona("42")
        nueva_alerta()
        EntregaAlerta.objects.update(estado=estado, proximo_intento_en=a_las(10))
        assert not entregas.elegibles(a_las(9, 59)).exists()
        assert entregas.elegibles(a_las(10)).count() == 1


class TestReclamoVencido:
    """El worker murió con la entrega en `enviando`."""

    def reclamada_por_un_muerto(self, *, intentos=1):
        persona("42")
        nueva_alerta()
        entrega = la_entrega()
        EntregaAlerta.objects.filter(pk=entrega.pk).update(
            estado=Estado.ENVIANDO, intentos=intentos, reclamo_id=uuid.uuid4(),
            reclamada_hasta=a_las(10), message_id="<alerta-anterior@ejemplo.cl>",
        )
        return entrega

    def test_antes_de_vencer_nadie_la_toma(self, mailoutbox):
        self.reclamada_por_un_muerto()
        assert entregas.despachar(ahora=a_las(9, 59)).conteo == {}
        assert mailoutbox == []

    def test_vencido_se_retoma_con_el_mismo_message_id(self, mailoutbox):
        self.reclamada_por_un_muerto()
        assert entregas.despachar(ahora=a_las(10))[entregas.ACEPTADA] == 1
        entrega = la_entrega()
        assert entrega.intentos == 2
        assert entrega.message_id == "<alerta-anterior@ejemplo.cl>"
        assert mailoutbox[0].message()["Message-ID"] == "<alerta-anterior@ejemplo.cl>"

    def test_vencido_en_el_ultimo_intento_queda_agotada(self, mailoutbox):
        self.reclamada_por_un_muerto(intentos=entregas.MAX_INTENTOS)
        assert entregas.despachar(ahora=a_las(10))[entregas.AGOTADA] == 1
        assert la_entrega().codigo_error == "sin_resultado"
        assert mailoutbox == []

    def test_el_resultado_de_un_reclamo_vencido_no_pisa_al_nuevo(self, mailoutbox):
        persona("42")
        nueva_alerta()
        viejo = entregas.reclamar(la_entrega().pk, ahora=a_las(10))
        # Venció y otro worker la retomó.
        nuevo = entregas.reclamar(viejo.entrega_id, ahora=a_las(10) + entregas.DURACION_RECLAMO)
        assert nuevo.reclamo_id != viejo.reclamo_id
        assert entregas.anotar_error(
            viejo, ErrorDeEnvio("conexion", "", permanente=False), ahora=a_las(10, 6),
        ) == entregas.TARDIA
        assert la_entrega().estado == Estado.ENVIANDO
        assert entregas.anotar_aceptada(nuevo, {"message_id": "x"}, ahora=a_las(10, 6)) == entregas.ACEPTADA


# ══════════════════════════════════════════════════════════════════════
# Preferencias al momento de mandar
# ══════════════════════════════════════════════════════════════════════


class TestPreferenciasAlMandar:
    def test_si_apaga_el_correo_despues_de_planificar_se_descarta(self, mailoutbox):
        preferencia = persona("42")
        nueva_alerta()
        PreferenciaNotificacion.objects.filter(pk=preferencia.pk).update(por_email=False)
        assert entregas.despachar(ahora=a_las(10))[entregas.DESCARTADA] == 1
        entrega = la_entrega()
        assert (entrega.estado, entrega.motivo) == (Estado.DESCARTADA, "preferencia_apagada")
        assert mailoutbox == []

    def test_si_apaga_el_tipo_despues_de_planificar_se_descarta(self, mailoutbox):
        preferencia = persona("42")
        nueva_alerta()
        PreferenciaNotificacion.objects.filter(pk=preferencia.pk).update(avisar_proximo_cobro=False)
        entregas.despachar(ahora=a_las(10))
        assert la_entrega().estado == Estado.DESCARTADA
        assert mailoutbox == []

    def test_sin_fila_al_mandar_valen_las_de_omision(self, mailoutbox):
        """Mismo criterio que al planificar: sin fila no es "lo apagó"."""
        preferencia = persona("42")
        nueva_alerta()
        preferencia.delete()
        assert entregas.despachar(ahora=a_las(10))[entregas.ACEPTADA] == 1
        assert [correo.to for correo in mailoutbox] == [["ana@ejemplo.cl"]]

    def test_sin_fila_el_push_se_descarta_por_la_omision_y_no_por_apagado(self, push):
        preferencia = persona("42", por_push=True)
        nueva_alerta()
        preferencia.delete()
        entregas.despachar(ahora=a_las(10))
        entrega = la_entrega("push")
        assert (entrega.estado, entrega.motivo) == (Estado.DESCARTADA, entregas.MOTIVO_POR_OMISION)
        assert push.enviados == []

    def test_sin_fila_ni_direccion_falla_explicita(self, mailoutbox):
        preferencia = persona("42")
        nueva_alerta()
        preferencia.delete()
        se_va("42")
        entregas.despachar(ahora=a_las(10))
        assert (la_entrega().estado, la_entrega().codigo_error) == (Estado.FALLIDA, "sin_direccion")
        assert mailoutbox == []

    def test_lo_que_quiere_otra_persona_no_cambia_lo_suyo(self, mailoutbox):
        persona("42")
        otra = persona("43", correo="beto@ejemplo.cl")
        nueva_alerta()
        PreferenciaNotificacion.objects.filter(pk=otra.pk).update(por_email=False)
        entregas.despachar(ahora=a_las(10))
        assert la_entrega(usuario="42").estado == Estado.ACEPTADA
        assert la_entrega(usuario="43").estado == Estado.DESCARTADA


# ══════════════════════════════════════════════════════════════════════
# Horario de descanso y cuota diaria (RN-08 / RN-09, solo push)
# ══════════════════════════════════════════════════════════════════════


class TestDescansoDelPush:
    def test_durante_el_descanso_no_se_manda_y_se_difiere_a_las_9(self, push):
        persona("42", por_email=False, por_push=True)
        nueva_alerta(ahora=a_las(23))
        assert entregas.despachar(ahora=a_las(23))[entregas.DIFERIDA] == 1
        entrega = la_entrega("push")
        assert (entrega.estado, entrega.motivo) == (Estado.DIFERIDA, "descanso")
        assert entrega.proximo_intento_en == a_las(9, dia=22)
        assert entrega.intentos == 0, "diferir no es un intento"
        assert push.enviados == []

    def test_lo_diferido_no_se_pierde_y_sale_a_las_9(self, push):
        persona("42", por_email=False, por_push=True)
        nueva_alerta(ahora=a_las(23))
        entregas.despachar(ahora=a_las(23))
        assert entregas.despachar(ahora=a_las(8, 59, dia=22)).conteo == {}
        assert entregas.despachar(ahora=a_las(9, dia=22))[entregas.ACEPTADA] == 1
        assert len(push.enviados) == 1

    def test_de_madrugada_sale_el_mismo_dia_a_las_9(self, push):
        persona("42", por_email=False, por_push=True)
        nueva_alerta(ahora=a_las(3))
        entregas.despachar(ahora=a_las(3))
        assert la_entrega("push").proximo_intento_en == a_las(9)

    @pytest.mark.parametrize("hora,minuto,diferida", [
        (21, 59, False), (22, 0, True), (7, 59, True), (8, 0, False),
    ])
    def test_los_bordes_de_la_franja(self, push, hora, minuto, diferida):
        persona("42", por_email=False, por_push=True)
        nueva_alerta(ahora=a_las(hora, minuto))
        entregas.despachar(ahora=a_las(hora, minuto))
        assert (la_entrega("push").estado == Estado.DIFERIDA) is diferida

    def test_el_correo_no_tiene_descanso(self, push, mailoutbox):
        persona("42", por_push=True)
        nueva_alerta(ahora=a_las(23))
        entregas.despachar(ahora=a_las(23))
        assert la_entrega("email").estado == Estado.ACEPTADA
        assert la_entrega("push").estado == Estado.DIFERIDA


class TestCuotaDelPush:
    def aceptadas(self, *instantes, usuario="42"):
        for instante in instantes:
            alerta = nueva_alerta(ahora=instante)
            EntregaAlerta.objects.filter(alerta=alerta, canal="push", usuario_id=usuario).update(
                estado=Estado.ACEPTADA, aceptada_en=instante,
            )

    def test_la_tercera_del_dia_se_difiere_a_manana(self, push):
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10), a_las(12))
        alerta = nueva_alerta(ahora=a_las(15))
        assert entregas.despachar(ahora=a_las(15))[entregas.DIFERIDA] == 1
        entrega = alerta.entregas.get()
        assert (entrega.estado, entrega.motivo) == (Estado.DIFERIDA, "cuota_diaria")
        assert entrega.proximo_intento_en == a_las(9, dia=22)
        assert push.enviados == []

    def test_la_segunda_del_dia_si_sale(self, push):
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10))
        nueva_alerta(ahora=a_las(15))
        assert entregas.despachar(ahora=a_las(15))[entregas.ACEPTADA] == 1

    def test_el_cambio_de_dia_en_utc_no_reinicia_el_contador(self, push):
        """El criterio de FE-22. A las 21:30 de Santiago ya son las 00:30 del
        día siguiente en UTC: contar por día UTC dejaría salir la tercera."""
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10), a_las(20))
        alerta = nueva_alerta(ahora=a_las(21, 30))
        assert a_las(21, 30).astimezone(dt.timezone.utc).day == 22
        entregas.despachar(ahora=a_las(21, 30))
        assert alerta.entregas.get().motivo == "cuota_diaria"

    def test_al_dia_siguiente_local_si_sale(self, push):
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10), a_las(20))
        alerta = nueva_alerta(ahora=a_las(21, 30))
        entregas.despachar(ahora=a_las(21, 30))
        entregas.despachar(ahora=a_las(9, dia=22))
        assert alerta.entregas.get().estado == Estado.ACEPTADA

    def test_las_de_ayer_no_cuentan(self, push):
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10, dia=20), a_las(20, dia=20))
        nueva_alerta(ahora=a_las(10))
        assert entregas.despachar(ahora=a_las(10))[entregas.ACEPTADA] == 1

    def test_la_cuota_es_de_cada_persona(self, push):
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10), a_las(12), usuario="42")
        persona("43", por_email=False, por_push=True, correo="beto@ejemplo.cl")
        alerta = nueva_alerta(ahora=a_las(15))
        entregas.despachar(ahora=a_las(15))
        assert alerta.entregas.get(usuario_id="43").estado == Estado.ACEPTADA
        assert alerta.entregas.get(usuario_id="42").estado == Estado.DIFERIDA

    def test_las_que_estan_saliendo_cuentan_para_la_cuota(self, push):
        """Una reclamada que todavía no informa resultado puede salir: si no
        contara, un segundo worker mandaría la tercera del día."""
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10))
        saliendo = nueva_alerta(ahora=a_las(15)).entregas.get()
        otra = nueva_alerta(ahora=a_las(15)).entregas.get()
        assert isinstance(entregas.reclamar(saliendo.pk, ahora=a_las(15)), entregas.Reclamo)
        assert entregas.atender(otra.pk, ahora=a_las(15)) == entregas.DIFERIDA
        otra.refresh_from_db()
        assert otra.motivo == "cuota_diaria"

    def test_un_reclamo_vencido_no_cuenta_para_la_cuota(self, push):
        persona("42", por_email=False, por_push=True)
        self.aceptadas(a_las(10))
        muerta = nueva_alerta(ahora=a_las(15)).entregas.get()
        otra = nueva_alerta(ahora=a_las(15)).entregas.get()
        entregas.reclamar(muerta.pk, ahora=a_las(15))
        vencido = a_las(15) + entregas.DURACION_RECLAMO
        assert entregas.atender(otra.pk, ahora=vencido) == entregas.ACEPTADA

    def test_el_correo_no_tiene_cuota(self, mailoutbox):
        persona("42")
        for hora in (10, 11, 12, 13):
            nueva_alerta(ahora=a_las(hora))
        assert entregas.despachar(ahora=a_las(14))[entregas.ACEPTADA] == 4


class TestPolitica:
    """La función pura, sin base."""

    nunca = staticmethod(lambda inicio, fin: 0)

    def test_franja_que_no_cruza_la_medianoche(self):
        siesta = Politica(descanso_desde=dt.time(14), descanso_hasta=dt.time(16))
        assert cuando_enviar(siesta, a_las(13, 59), SANTIAGO, self.nunca) is None
        espera = cuando_enviar(siesta, a_las(15), SANTIAGO, self.nunca)
        assert (espera.hasta, espera.motivo) == (a_las(16), "descanso")
        assert cuando_enviar(siesta, a_las(16), SANTIAGO, self.nunca) is None

    def test_sin_restricciones_no_cuenta_nada(self):
        def no_deberia_contar(inicio, fin):
            raise AssertionError("contó sin tener cuota")
        assert cuando_enviar(Politica(), a_las(23), SANTIAGO, no_deberia_contar) is None

    def test_el_dia_es_el_local(self):
        inicio, fin = dia_local(a_las(21, 30), SANTIAGO)
        assert (inicio, fin) == (a_las(0), a_las(0, dia=22))

    def test_cuota_sin_franja_sale_a_medianoche(self):
        politica = Politica(cuota_diaria=1)
        espera = cuando_enviar(politica, a_las(15), SANTIAGO, lambda inicio, fin: 1)
        assert espera.hasta == a_las(0, dia=22)

    def test_rn_08_y_rn_09(self):
        assert (PUSH.descanso_desde, PUSH.descanso_hasta, PUSH.reanudar_a, PUSH.cuota_diaria) == (
            dt.time(22), dt.time(8), dt.time(9), 2)

    @pytest.mark.parametrize("campos", [
        {"descanso_desde": dt.time(22)},
        {"descanso_desde": dt.time(22), "descanso_hasta": dt.time(22)},
        {"cuota_diaria": 0},
        {"descanso_desde": dt.time(22), "descanso_hasta": dt.time(8), "reanudar_a": dt.time(7)},
    ])
    def test_una_politica_imposible_se_rechaza(self, campos):
        with pytest.raises(ValueError):
            Politica(**campos)


# ══════════════════════════════════════════════════════════════════════
# SMTP de verdad contra un servidor local de prueba
# ══════════════════════════════════════════════════════════════════════


@pytest.fixture
def smtp(settings):
    """Backend SMTP real de Django, apuntado a un servidor local de prueba."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = "127.0.0.1"
    settings.EMAIL_HOST_USER = ""
    settings.EMAIL_HOST_PASSWORD = ""
    settings.EMAIL_USE_TLS = False
    settings.EMAIL_USE_SSL = False
    settings.EMAIL_TIMEOUT = 2

    def con(servidor):
        settings.EMAIL_PORT = servidor.puerto if isinstance(servidor, ServidorSMTP) else servidor
        persona("42")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        return la_entrega()
    return con


class TestSMTP:
    def test_250_es_aceptada_y_el_servidor_recibio_ese_message_id(self, smtp):
        with ServidorSMTP() as servidor:
            entrega = smtp(servidor)
        assert entrega.estado == Estado.ACEPTADA
        assert entrega.evidencia["backend"] == "django.core.mail.backends.smtp.EmailBackend"
        [crudo] = servidor.mensajes
        assert f"Message-ID: {entrega.message_id}".encode() in crudo

    def test_destinatario_rechazado_con_5xx_es_permanente(self, smtp):
        with ServidorSMTP(rcpt="550 5.1.1 el buzon no existe") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.FALLIDA, "smtp_550")
        assert "el buzon no existe" in entrega.detalle_error
        assert servidor.mensajes == []

    def test_destinatario_con_4xx_es_transitorio(self, smtp):
        with ServidorSMTP(rcpt="451 4.7.1 vuelve en un rato") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "smtp_451")
        assert entrega.proximo_intento_en == a_las(10) + entregas.ESPERAS_REINTENTO[0]

    def test_mensaje_rechazado_con_5xx_es_permanente(self, smtp):
        with ServidorSMTP(data="554 5.6.0 contenido rechazado") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.FALLIDA, "smtp_554")

    def test_mensaje_con_4xx_es_transitorio(self, smtp):
        with ServidorSMTP(data="452 4.3.1 sin espacio") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "smtp_452")

    def test_remitente_rechazado_es_de_la_configuracion_y_se_reintenta(self, smtp):
        with ServidorSMTP(mail="553 5.7.1 remitente no autorizado") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "smtp_553")

    def test_sin_servidor_es_transitorio(self, smtp, settings):
        # En Windows un puerto cerrado tarda ~2 s en rechazar: con un tope de
        # 2 s saldría como tiempo agotado, que también es transitorio.
        settings.EMAIL_TIMEOUT = 5
        entrega = smtp(puerto_cerrado())
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "conexion")

    def test_un_corte_despues_del_mensaje_no_se_da_por_entregado(self, smtp):
        """El servidor pudo haberlo procesado: no se sabe. Reintento."""
        with ServidorSMTP(al_terminar_data="cortar") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "conexion")
        assert entrega.aceptada_en is None

    def test_un_silencio_despues_del_mensaje_se_reintenta(self, smtp):
        """`smtplib` convierte el tiempo agotado esperando la respuesta en
        `SMTPServerDisconnected`: queda como conexión, con el motivo."""
        with ServidorSMTP(al_terminar_data="callar") as servidor:
            entrega = smtp(servidor)
        assert (entrega.estado, entrega.codigo_error) == (Estado.REINTENTO, "conexion")
        assert "timed out" in entrega.detalle_error
        assert entrega.aceptada_en is None


class TestClasificar:
    def test_destinatarios_mezclados_no_es_permanente(self):
        error = smtplib.SMTPRecipientsRefused({"a@x.cl": (550, b"no"), "b@x.cl": (451, b"luego")})
        assert clasificar_smtp(error).permanente is False

    def test_autenticacion_se_reintenta(self):
        error = smtplib.SMTPAuthenticationError(535, b"5.7.8 credenciales")
        resultado = clasificar_smtp(error)
        assert (resultado.codigo, resultado.permanente) == ("smtp_535", False)

    def test_lo_que_no_es_de_envio_no_se_disfraza(self):
        with pytest.raises(TypeError):
            clasificar_smtp(KeyError("x"))


# ══════════════════════════════════════════════════════════════════════
# El comando
# ══════════════════════════════════════════════════════════════════════


class TestComando:
    def test_informa_y_acepta_un_reloj_fijo(self, mailoutbox):
        persona("42")
        persona("43", correo="beto@ejemplo.cl")
        nueva_alerta()
        se_va("43")
        salida = StringIO()
        call_command("despachar_alertas", ahora="2026-11-21T10:00:00-03:00", stdout=salida)
        texto = salida.getvalue()
        assert texto.startswith("2026-11-21 10:00")
        assert "1 aceptada(s) por el proveedor, 1 fallida(s)." in texto
        assert "[email] fallida: sin_direccion (intento 0)" in texto
        assert "ana@ejemplo.cl" not in texto

    def test_sin_nada_lo_dice(self):
        salida = StringIO()
        call_command("despachar_alertas", stdout=salida)
        assert "nada que despachar" in salida.getvalue()

    def test_el_limite_acota_la_corrida_y_lo_demas_espera(self, mailoutbox):
        for usuario in ("42", "43", "44"):
            persona(usuario, correo=f"p{usuario}@ejemplo.cl")
        nueva_alerta()
        call_command("despachar_alertas", ahora="2026-11-21T10:00:00-03:00", limite=2, stdout=StringIO())
        assert len(mailoutbox) == 2
        call_command("despachar_alertas", ahora="2026-11-21T10:00:00-03:00", limite=2, stdout=StringIO())
        assert len(mailoutbox) == 3

    @pytest.mark.parametrize("opciones,mensaje", [
        ({"limite": 0}, "--limite"),
        ({"ahora": "ayer"}, "instante ISO"),
    ])
    def test_rechaza_opciones_mal_escritas(self, opciones, mensaje):
        with pytest.raises(CommandError, match=mensaje):
            call_command("despachar_alertas", **opciones)

    def test_con_un_backend_sin_proveedor_falla_y_no_escribe_el_correo(self, settings, capsys):
        """Con console, además, el correo completo quedaba en el log. La
        entrega ya es elegible con el reloj real: sin la barrera, saldría."""
        settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
        persona("42")
        nueva_alerta(ahora=dt.datetime.now(tz=SANTIAGO) - dt.timedelta(minutes=1))
        with pytest.raises(CommandError, match="no entrega a ningún proveedor"):
            call_command("despachar_alertas", stdout=StringIO())
        assert (la_entrega().estado, la_entrega().intentos) == (Estado.PENDIENTE, 0)
        salida = capsys.readouterr()
        assert "ana@ejemplo.cl" not in salida.out + salida.err

    def test_se_niega_aunque_no_haya_nada_que_despachar(self, settings):
        """La configuración se mira al empezar, no recién con la primera
        entrega: una corrida vacía con un backend falso también falla."""
        settings.EMAIL_BACKEND = "django.core.mail.backends.dummy.EmailBackend"
        with pytest.raises(CommandError, match="no entrega a ningún proveedor"):
            call_command("despachar_alertas", stdout=StringIO())

    def test_ahora_se_rechaza_con_un_proveedor_real(self, settings):
        """Con un `--ahora` pasado, el reclamo nacía vencido para el cron real
        y otro worker mandaba el mismo correo otra vez."""
        settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
        persona("42")
        nueva_alerta()
        with pytest.raises(CommandError, match="--ahora es solo para pruebas"):
            call_command("despachar_alertas", ahora="2026-11-21T10:00:00-03:00", stdout=StringIO())
        assert (la_entrega().estado, la_entrega().intentos) == (Estado.PENDIENTE, 0)

    def test_despachar_rechaza_un_limite_imposible(self):
        with pytest.raises(ValueError):
            entregas.despachar(limite=0)


# ══════════════════════════════════════════════════════════════════════
# Borrado: la dirección y el destino son datos de la persona
# ══════════════════════════════════════════════════════════════════════


def borrar_persona(org, usuario):
    from rest_framework.test import APIClient
    from shared.eliminacion import cabeceras_eliminacion

    operacion = uuid.uuid4()
    firma = cabeceras_eliminacion(f"notifications:usuario:{usuario}", org, operacion)
    return APIClient().delete(
        f"/internal/organizaciones/{org}/usuarios/{usuario}/", {"operacion_id": str(operacion)},
        format="json", **{f"HTTP_{k.upper().replace('-', '_')}": v for k, v in firma.items()},
    )


class TestBorrado:
    def test_la_limpieza_de_la_organizacion_se_lleva_las_entregas(self, monkeypatch, mailoutbox):
        from tests.test_eliminacion_proyeccion import SECRETO, limpiar

        monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", SECRETO)
        persona("42", org=ORG)
        persona("42", org=OTRA)
        nueva_alerta(org=ORG)
        nueva_alerta(org=OTRA)
        entregas.despachar(ahora=a_las(10))
        assert limpiar(ORG).status_code == 204
        assert not EntregaAlerta.objects.filter(organizacion_id=ORG).exists()
        assert EntregaAlerta.objects.filter(organizacion_id=OTRA).count() == 1

    def test_la_limpieza_de_una_persona_se_lleva_solo_lo_suyo(self, monkeypatch, mailoutbox):
        monkeypatch.setenv("ELIMINACION_INTERNA_SECRET", "secreto-solo-prueba")
        persona("42")
        persona("43", correo="beto@ejemplo.cl")
        nueva_alerta()
        entregas.despachar(ahora=a_las(10))
        assert la_entrega(usuario="42").destino == "ana@ejemplo.cl"

        assert borrar_persona(ORG, 42).status_code == 204
        assert not EntregaAlerta.objects.filter(usuario_id="42").exists()
        assert la_entrega(usuario="43").destino == "beto@ejemplo.cl"
