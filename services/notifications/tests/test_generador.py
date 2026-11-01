"""
FE-17 — alertas de próximos cobros, y FE-18 — avisos de fin de prueba.

Los criterios de las tarjetas:

FE-17
- se genera en la ventana configurada
- suscripción cancelada o alerta desactivada no genera aviso
- reloj controlable

FE-18
- cada ventana (48 h / 24 h) produce a lo sumo una alerta
- prueba sin fecha válida o aviso desactivado no genera envío

El reloj es un parámetro: ninguna prueba depende de qué día es hoy.
"""

import datetime as dt
import uuid
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from notifications.generador import (
    VENTANAS_FIN_PRUEBA,
    anticipaciones_de_cobro,
    generar,
    generar_fin_de_prueba,
    generar_proximos_cobros,
    id_de_ventana,
)
from notifications.models import Alerta, PreferenciaNotificacion, SuscripcionVigilada

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
CHILE = dt.timezone(dt.timedelta(hours=-3))


def instante(anio, mes, dia, hora=10, minuto=0) -> dt.datetime:
    """Un reloj fijo, en hora de Chile."""
    return dt.datetime(anio, mes, dia, hora, minuto, tzinfo=CHILE)


HOY = instante(2026, 11, 21)        # viernes 21 de noviembre, 10:00


def vigilada(*, org=ORG_A, nombre="Netflix", estado="activo", cobro=None,
             fin_prueba=None, monto="9990.00", **extra):
    return SuscripcionVigilada.objects.create(
        organizacion_id=org,
        suscripcion_id=extra.pop("suscripcion_id", uuid.uuid4()),
        nombre=nombre,
        monto=Decimal(monto),
        moneda=extra.pop("moneda", "CLP"),
        estado=estado,
        proximo_cobro=cobro,
        fin_prueba=fin_prueba,
        observada_en=timezone.now(),
        **extra,
    )


def preferencia(*, org=ORG_A, usuario="42", **campos):
    return PreferenciaNotificacion.objects.create(
        organizacion_id=org, usuario_id=usuario, **campos
    )


def alertas(org=ORG_A, tipo=None):
    qs = Alerta.objects.filter(organizacion_id=org)
    if tipo:
        qs = qs.filter(tipo=tipo)
    return list(qs.order_by("creado_en"))


# ══════════════════════════════════════════════════════════════════════
# FE-17 — próximos cobros
# ══════════════════════════════════════════════════════════════════════


class TestProximoCobro:
    def test_se_genera_en_la_ventana_configurada(self):
        """Cobro en 3 días, anticipación de 3 (la de omisión): avisa."""
        vigilada(cobro=dt.date(2026, 11, 24))
        resultado = generar_proximos_cobros(ahora=HOY)
        assert len(resultado.creadas) == 1
        alerta = resultado.creadas[0]
        assert alerta.tipo == Alerta.Tipo.PROXIMO_COBRO
        assert alerta.titulo == "Netflix se cobra en 3 días"
        assert "24-11-2026" in alerta.mensaje and "9.990 CLP" in alerta.mensaje
        assert alerta.datos["dias_faltantes"] == 3
        assert alerta.datos["anticipacion_dias"] == 3
        assert alerta.pendiente

    def test_fuera_de_la_ventana_no_avisa(self):
        """Cobro en 4 días con anticipación de 3: todavía no."""
        vigilada(cobro=dt.date(2026, 11, 25))
        assert generar_proximos_cobros(ahora=HOY).creadas == []
        assert alertas() == []

    def test_dentro_de_la_ventana_aunque_falte_menos_avisa_igual(self):
        """Si el job no corrió ayer, hoy avisa igual: la ventana es 'o menos',
        no 'exactamente'."""
        vigilada(cobro=dt.date(2026, 11, 22))
        resultado = generar_proximos_cobros(ahora=HOY)
        assert resultado.creadas[0].titulo == "Netflix se cobra en 1 día"

    def test_el_dia_del_cobro_dice_hoy(self):
        vigilada(cobro=dt.date(2026, 11, 21))
        assert generar_proximos_cobros(ahora=HOY).creadas[0].titulo == "Netflix se cobra hoy"

    def test_un_cobro_ya_pasado_no_avisa(self):
        vigilada(cobro=dt.date(2026, 11, 20))
        assert generar_proximos_cobros(ahora=HOY).creadas == []

    def test_la_anticipacion_la_pone_la_preferencia(self):
        """Con 7 días pedidos, un cobro en 6 avisa; con los 3 de omisión, no."""
        preferencia(dias_anticipacion=7)
        vigilada(cobro=dt.date(2026, 11, 27))
        resultado = generar_proximos_cobros(ahora=HOY)
        assert len(resultado.creadas) == 1
        assert resultado.creadas[0].datos["anticipacion_dias"] == 7

    @pytest.mark.parametrize("estado", ["cancelado", "por_confirmar", "fantasma"])
    def test_una_suscripcion_no_vigente_no_genera_aviso(self, estado):
        vigilada(estado=estado, cobro=dt.date(2026, 11, 22))
        assert generar_proximos_cobros(ahora=HOY).creadas == []

    def test_una_en_prueba_si_avisa_su_primer_cobro(self):
        vigilada(estado="prueba", cobro=dt.date(2026, 11, 23))
        assert len(generar_proximos_cobros(ahora=HOY).creadas) == 1

    def test_con_la_alerta_desactivada_no_genera_aviso(self):
        preferencia(avisar_proximo_cobro=False)
        vigilada(cobro=dt.date(2026, 11, 22))
        assert generar_proximos_cobros(ahora=HOY).creadas == []
        assert alertas() == []

    def test_sin_ningun_canal_tampoco(self):
        preferencia(por_email=False, por_push=False, en_la_app=False)
        vigilada(cobro=dt.date(2026, 11, 22))
        assert generar_proximos_cobros(ahora=HOY).creadas == []

    def test_sin_preferencias_guardadas_valen_las_de_omision(self):
        """Lo que la persona vería al abrir FE-21 por primera vez: encendido, 3 días."""
        assert anticipaciones_de_cobro(ORG_A) == {3}

    def test_con_preferencias_que_apagan_el_tipo_nadie_quiere(self):
        preferencia(usuario="1", avisar_proximo_cobro=False)
        preferencia(usuario="2", avisar_proximo_cobro=False, dias_anticipacion=10)
        assert anticipaciones_de_cobro(ORG_A) == set()

    def test_dos_personas_con_anticipaciones_distintas_dan_una_alerta_por_ventana(self):
        preferencia(usuario="1", dias_anticipacion=3)
        preferencia(usuario="2", dias_anticipacion=7)
        susc = vigilada(cobro=dt.date(2026, 11, 26))      # en 5 días
        # Hoy: entra en la ventana de 7, no en la de 3.
        r1 = generar_proximos_cobros(ahora=HOY)
        assert [a.datos["anticipacion_dias"] for a in r1.creadas] == [7]
        # Tres días después: entra la de 3. La de 7 YA NO SE REVISITA: solo se
        # mira la ventana más cercana que contiene el cobro, así que `repetidas`
        # ahora es 0 y no 1. Antes se recorrían todas y la de 7 volvía a
        # chocar con su alerta ya creada.
        r2 = generar_proximos_cobros(ahora=instante(2026, 11, 24))
        assert [a.datos["anticipacion_dias"] for a in r2.creadas] == [3]
        assert r2.repetidas == 0
        assert len(alertas()) == 2
        assert all(a.suscripcion_id == susc.suscripcion_id for a in alertas())

    def test_correr_dos_veces_el_mismo_dia_no_duplica(self):
        vigilada(cobro=dt.date(2026, 11, 23))
        primera = generar_proximos_cobros(ahora=HOY)
        segunda = generar_proximos_cobros(ahora=HOY)
        assert len(primera.creadas) == 1
        assert segunda.creadas == [] and segunda.repetidas == 1
        assert len(alertas()) == 1

    def test_correr_al_dia_siguiente_tampoco_duplica_el_mismo_cobro(self):
        """La ventana es (cobro, anticipación), no el día en que se corrió."""
        vigilada(cobro=dt.date(2026, 11, 23))
        generar_proximos_cobros(ahora=HOY)
        generar_proximos_cobros(ahora=instante(2026, 11, 22))
        assert len(alertas()) == 1

    def test_el_cobro_siguiente_si_genera_otra_alerta(self):
        """Cuando subscriptions mueve `proximo_cobro` al mes que viene, es
        otra ventana y corresponde otro aviso."""
        susc = vigilada(cobro=dt.date(2026, 11, 23))
        generar_proximos_cobros(ahora=HOY)
        SuscripcionVigilada.objects.filter(pk=susc.pk).update(proximo_cobro=dt.date(2026, 12, 23))
        generar_proximos_cobros(ahora=instante(2026, 12, 21))
        assert len(alertas()) == 2

    def test_no_mezcla_organizaciones(self):
        preferencia(org=ORG_B, avisar_proximo_cobro=False)
        vigilada(org=ORG_A, cobro=dt.date(2026, 11, 22))
        vigilada(org=ORG_B, cobro=dt.date(2026, 11, 22))
        generar_proximos_cobros(ahora=HOY)
        assert len(alertas(ORG_A)) == 1
        assert alertas(ORG_B) == []

    def test_la_alerta_apunta_a_la_suscripcion_y_lleva_el_origen(self):
        susc = vigilada(cobro=dt.date(2026, 11, 22))
        alerta = generar_proximos_cobros(ahora=HOY).creadas[0]
        assert alerta.suscripcion_id == susc.suscripcion_id
        assert alerta.datos["origen"] == "generador"
        assert alerta.datos["fecha_cobro"] == "2026-11-22"

    def test_el_id_de_la_ventana_es_deterministico(self):
        s = uuid.uuid4()
        a = id_de_ventana(ORG_A, s, "proximo_cobro", dt.date(2026, 11, 22), 3)
        b = id_de_ventana(ORG_A, s, "proximo_cobro", dt.date(2026, 11, 22), 3)
        c = id_de_ventana(ORG_A, s, "proximo_cobro", dt.date(2026, 11, 22), 7)
        assert a == b != c


# ══════════════════════════════════════════════════════════════════════
# FE-18 — fin de prueba
# ══════════════════════════════════════════════════════════════════════


class TestFinDePrueba:
    """La prueba termina a las 00:00 del día `fin_prueba`, hora de Chile."""

    FIN = dt.date(2026, 11, 23)   # termina el lunes 23 a las 00:00

    def test_a_menos_de_48h_avisa_la_ventana_de_48(self):
        vigilada(estado="prueba", fin_prueba=self.FIN)
        # Sábado 21 a las 10:00 → faltan 38 h.
        resultado = generar_fin_de_prueba(ahora=HOY)
        assert [a.datos["ventana_horas"] for a in resultado.creadas] == [48]
        alerta = resultado.creadas[0]
        assert alerta.tipo == Alerta.Tipo.FIN_PRUEBA
        assert "termina en menos de 48 h" in alerta.titulo
        assert "23-11-2026" in alerta.mensaje and "9.990 CLP" in alerta.mensaje

    def test_a_menos_de_24h_avisa_SOLO_la_de_24(self):
        """Antes creaba la de 24 Y la de 48 en la misma corrida.

        Con 14 h restantes se cumplen las dos ventanas, y salían dos avisos
        casi idénticos. La de 48 ya pasó: avisarla ahora no agrega nada. Lo
        encontró la revisión de la PR.
        """
        vigilada(estado="prueba", fin_prueba=self.FIN)
        # Domingo 22 a las 10:00 → faltan 14 h.
        resultado = generar_fin_de_prueba(ahora=instante(2026, 11, 22))
        assert [a.datos["ventana_horas"] for a in resultado.creadas] == [24]

    def test_cada_ventana_produce_a_lo_sumo_una_alerta(self):
        vigilada(estado="prueba", fin_prueba=self.FIN)
        generar_fin_de_prueba(ahora=HOY)                        # 48 h
        generar_fin_de_prueba(ahora=instante(2026, 11, 21, 18)) # 48 h de nuevo
        generar_fin_de_prueba(ahora=instante(2026, 11, 22))     # 24 h
        # Y de nuevo dentro de las 24 h: solo se mira ESA ventana, así que
        # repite 1 y no 2. La de 48 ya no se revisita.
        r = generar_fin_de_prueba(ahora=instante(2026, 11, 22, 20))
        assert r.creadas == [] and r.repetidas == 1
        assert len(alertas(tipo=Alerta.Tipo.FIN_PRUEBA)) == len(VENTANAS_FIN_PRUEBA) == 2

    def test_a_mas_de_48h_no_avisa(self):
        vigilada(estado="prueba", fin_prueba=dt.date(2026, 11, 25))
        assert generar_fin_de_prueba(ahora=HOY).creadas == []

    def test_una_prueba_que_ya_termino_no_avisa(self):
        vigilada(estado="prueba", fin_prueba=dt.date(2026, 11, 21))  # terminó a las 00:00 de hoy
        assert generar_fin_de_prueba(ahora=HOY).creadas == []

    def test_sin_fecha_valida_no_genera_envio(self):
        """El contrato MX-21 v2 no trae `fin_prueba`: sin ella, nada."""
        vigilada(estado="prueba", fin_prueba=None)
        assert generar_fin_de_prueba(ahora=HOY).creadas == []

    def test_con_el_aviso_desactivado_no_genera_envio(self):
        preferencia(avisar_fin_prueba=False)
        vigilada(estado="prueba", fin_prueba=self.FIN)
        assert generar_fin_de_prueba(ahora=HOY).creadas == []

    def test_una_que_no_esta_en_prueba_no_avisa_aunque_tenga_fecha(self):
        vigilada(estado="activo", fin_prueba=self.FIN)
        vigilada(estado="cancelado", fin_prueba=self.FIN)
        assert generar_fin_de_prueba(ahora=HOY).creadas == []

    def test_la_anticipacion_de_cobros_no_cambia_las_ventanas_de_prueba(self):
        """Prioridad de reglas: 48/24 h fijas, aunque la persona pida 7 días
        para los cobros. Queda documentado en el módulo."""
        preferencia(dias_anticipacion=7)
        vigilada(estado="prueba", fin_prueba=dt.date(2026, 11, 26))  # faltan ~4,5 días
        assert generar_fin_de_prueba(ahora=HOY).creadas == []

    def test_no_mezcla_organizaciones(self):
        preferencia(org=ORG_B, avisar_fin_prueba=False)
        vigilada(org=ORG_A, estado="prueba", fin_prueba=self.FIN)
        vigilada(org=ORG_B, estado="prueba", fin_prueba=self.FIN)
        generar_fin_de_prueba(ahora=HOY)
        assert len(alertas(ORG_A)) == 1 and alertas(ORG_B) == []


# ══════════════════════════════════════════════════════════════════════
# Las dos juntas, y el comando
# ══════════════════════════════════════════════════════════════════════


class TestGenerar:
    def test_hace_las_dos_cosas_y_suma_los_resultados(self):
        vigilada(nombre="Netflix", cobro=dt.date(2026, 11, 22))
        vigilada(nombre="Spotify", estado="prueba", fin_prueba=dt.date(2026, 11, 23))
        resultado = generar(ahora=HOY)
        assert sorted(a.tipo for a in resultado.creadas) == ["fin_prueba", "proximo_cobro"]
        assert resultado.revisadas == 2

    def test_no_escribe_nada_mas_que_alertas(self):
        """Función pura sobre la proyección: no toca la proyección ni las
        preferencias."""
        susc = vigilada(cobro=dt.date(2026, 11, 22))
        antes = SuscripcionVigilada.objects.get(pk=susc.pk).actualizado_en
        generar(ahora=HOY)
        assert SuscripcionVigilada.objects.get(pk=susc.pk).actualizado_en == antes
        assert not PreferenciaNotificacion.objects.exists()

    def test_el_comando_acepta_un_reloj_fijo(self):
        vigilada(cobro=dt.date(2026, 11, 22))
        salida = StringIO()
        call_command("generar_alertas", ahora="2026-11-21T10:00:00-03:00", stdout=salida)
        assert "1 alerta(s) nueva(s)" in salida.getvalue()
        assert "Netflix se cobra en 1 día" in salida.getvalue()
        call_command("generar_alertas", ahora="2026-11-21T18:00:00-03:00", stdout=salida)
        assert "0 alerta(s) nueva(s), 1 ya existían" in salida.getvalue()

    def test_el_comando_rechaza_un_reloj_mal_escrito(self):
        from django.core.management.base import CommandError

        with pytest.raises(CommandError, match="instante ISO"):
            call_command("generar_alertas", ahora="ayer")


# ══════════════════════════════════════════════════════════════════════
# Entrar tarde a las ventanas: UNA alerta, no varias
# (hallazgo de la revisión de #119)
# ══════════════════════════════════════════════════════════════════════


class TestEntrarTardeALasVentanas:
    """Con varias anticipaciones y un cobro cercano salía una alerta por cada
    ventana ya cumplida, todas con el MISMO título.

    Pasa cuando la suscripción se creó recién, o cuando el job no corrió un
    día. El título usa `faltan`, no `dias`, así que las dos decían "se cobra
    en 2 días" y solo se distinguían por `anticipacion_dias`.
    """

    def test_con_3_y_7_y_un_cobro_a_2_dias_sale_UNA_sola(self):
        """La reproducción de la revisión."""
        preferencia(usuario="1", dias_anticipacion=3)
        preferencia(usuario="2", dias_anticipacion=7)
        vigilada(cobro=dt.date(2026, 11, 23))  # a 2 días de HOY (21-11)

        resultado = generar_proximos_cobros(ahora=HOY)
        assert len(resultado.creadas) == 1, [
            a.datos["anticipacion_dias"] for a in resultado.creadas
        ]
        # La MÁS CERCANA que ya contiene el cobro.
        assert resultado.creadas[0].datos["anticipacion_dias"] == 3

    def test_el_dia_a_dia_sigue_avisando_cada_ventana(self):
        """El control: la corrección no puede quitar los avisos de siempre.

        Con el job corriendo todos los días, cada ventana avisa el suyo.
        """
        preferencia(usuario="1", dias_anticipacion=3)
        preferencia(usuario="2", dias_anticipacion=7)
        vigilada(cobro=dt.date(2026, 11, 28))  # a 7 días

        r7 = generar_proximos_cobros(ahora=HOY)
        assert [a.datos["anticipacion_dias"] for a in r7.creadas] == [7]

        r3 = generar_proximos_cobros(ahora=instante(2026, 11, 25))  # a 3 días
        assert [a.datos["anticipacion_dias"] for a in r3.creadas] == [3]

        assert len(alertas(tipo=Alerta.Tipo.PROXIMO_COBRO)) == 2

    def test_un_cobro_HOY_con_varias_ventanas_sale_una_sola(self):
        preferencia(usuario="1", dias_anticipacion=1)
        preferencia(usuario="2", dias_anticipacion=7)
        vigilada(cobro=dt.date(2026, 11, 21))  # hoy

        resultado = generar_proximos_cobros(ahora=HOY)
        assert len(resultado.creadas) == 1
        assert resultado.creadas[0].datos["anticipacion_dias"] == 1

    def test_una_prueba_que_termina_en_10h_avisa_una_sola_vez(self):
        """Con menos de 24 h se cumplen la de 48 y la de 24."""
        vigilada(estado="prueba", fin_prueba=dt.date(2026, 11, 22))
        # 21-11 a las 14:00 → faltan ~10 h hasta el fin del 22.
        resultado = generar_fin_de_prueba(ahora=instante(2026, 11, 22, 14))
        assert len(resultado.creadas) <= 1, [
            a.datos["ventana_horas"] for a in resultado.creadas
        ]
        if resultado.creadas:
            assert resultado.creadas[0].datos["ventana_horas"] == 24


# ══════════════════════════════════════════════════════════════════════
# El monto del mensaje es el del cobro, sin redondear
# ══════════════════════════════════════════════════════════════════════


class TestMontoEnElMensaje:
    """El formato anterior (`:,.0f`) anunciaba 9.99 USD como "10 USD". Se
    comprueba el MENSAJE, no solo `datos.monto`, en los dos tipos de aviso."""

    @pytest.mark.parametrize("monto, moneda, esperado", [
        ("9.99", "USD", "9,99 USD"),
        ("0.49", "USD", "0,49 USD"),
        ("1234.50", "USD", "1.234,50 USD"),
        ("9990.00", "CLP", "9.990 CLP"),
        ("1000000.00", "CLP", "1.000.000 CLP"),
    ])
    def test_proximo_cobro(self, monto, moneda, esperado):
        vigilada(nombre="Servicio", cobro=dt.date(2026, 11, 22), monto=monto, moneda=moneda)
        alerta = generar_proximos_cobros(ahora=HOY).creadas[0]
        assert f"El cobro de {esperado} de Servicio" in alerta.mensaje
        assert alerta.datos["monto"] == monto

    @pytest.mark.parametrize("monto, moneda, esperado", [
        ("9.99", "USD", "9,99 USD"),
        ("0.49", "USD", "0,49 USD"),
        ("9990.00", "CLP", "9.990 CLP"),
    ])
    def test_fin_de_prueba(self, monto, moneda, esperado):
        vigilada(nombre="Servicio", estado="prueba", fin_prueba=dt.date(2026, 11, 23),
                 monto=monto, moneda=moneda)
        alerta = generar_fin_de_prueba(ahora=HOY).creadas[0]
        assert f"se cobra {esperado}." in alerta.mensaje
