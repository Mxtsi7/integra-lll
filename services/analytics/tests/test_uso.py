"""
FE-28 — uso por periodo, y FE-29 — puntaje de bajo uso.

Los criterios que tienen que quedar demostrados:

FE-28
- el agregado coincide con los registros fuente del periodo
- **reprocesar no duplica minutos**

FE-29
- el mismo conjunto produce el mismo puntaje
- **sin datos suficientes no se afirma bajo uso como hecho**

Los dos que están en negrita son los que de verdad cuestan, y cada uno tiene
su propia sección.
"""

import datetime as dt
import uuid

import pytest

from analytics.models import SuscripcionObservada, UsoMensual, UsoProyectado
from analytics.uso import (
    Clasificacion,
    mes_siguiente,
    meses_hacia_atras,
    primer_dia,
    proyectar_uso,
    puntuar,
    puntuar_organizacion,
    recalcular_mes,
    registrar_suscripcion,
)

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
SUSC = uuid.UUID("33333333-3333-3333-3333-333333333333")
OTRA = uuid.UUID("44444444-4444-4444-4444-444444444444")

OCTUBRE = dt.date(2026, 10, 1)
FIN_OCTUBRE = dt.date(2026, 10, 31)


def proyectar(fecha, minutos, *, org=ORG_A, susc=SUSC, registro=None):
    return proyectar_uso(
        organizacion_id=org,
        suscripcion_id=susc,
        evento_id=registro or uuid.uuid4(),
        fecha=fecha,
        minutos=minutos,
    )


def observar(*, org=ORG_A, susc=SUSC, desde=dt.date(2026, 1, 1), nombre="Netflix"):
    return registrar_suscripcion(
        organizacion_id=org, suscripcion_id=susc, observada_desde=desde, nombre=nombre
    )


def mensual(*, org=ORG_A, susc=SUSC, mes=OCTUBRE):
    return UsoMensual.objects.get(organizacion_id=org, suscripcion_id=susc, mes=mes)


# ══════════════════════════════════════════════════════════════════════
# Aritmética de meses — donde se esconden los errores de un día
# ══════════════════════════════════════════════════════════════════════


class TestMeses:
    def test_mes_siguiente_cruza_el_año(self):
        assert mes_siguiente(dt.date(2026, 12, 1)) == dt.date(2027, 1, 1)

    def test_mes_siguiente_de_enero_largo(self):
        """Sumar 31 días a un 31 de enero se salta febrero."""
        assert mes_siguiente(dt.date(2026, 1, 1)) == dt.date(2026, 2, 1)

    def test_la_ventana_va_del_mas_viejo_al_mas_nuevo(self):
        assert meses_hacia_atras(dt.date(2026, 3, 1), 3) == [
            dt.date(2026, 1, 1),
            dt.date(2026, 2, 1),
            dt.date(2026, 3, 1),
        ]

    def test_la_ventana_cruza_el_año_hacia_atras(self):
        assert meses_hacia_atras(dt.date(2026, 2, 1), 4) == [
            dt.date(2025, 11, 1),
            dt.date(2025, 12, 1),
            dt.date(2026, 1, 1),
            dt.date(2026, 2, 1),
        ]

    def test_primer_dia_normaliza(self):
        assert primer_dia(dt.date(2026, 10, 27)) == OCTUBRE


# ══════════════════════════════════════════════════════════════════════
# FE-28 — el agregado coincide con los registros
# ══════════════════════════════════════════════════════════════════════


class TestAgregado:
    def test_suma_los_minutos_del_mes(self):
        proyectar(dt.date(2026, 10, 3), 40)
        proyectar(dt.date(2026, 10, 9), 25)
        assert mensual().minutos == 65

    def test_cuenta_los_dias_distintos_con_uso(self):
        """300 minutos en un día no es lo mismo que 10 al día por 30 días."""
        proyectar(dt.date(2026, 10, 3), 10)
        proyectar(dt.date(2026, 10, 3), 15)  # el mismo día, otro registro
        proyectar(dt.date(2026, 10, 4), 5)
        fila = mensual()
        assert fila.minutos == 30
        assert fila.dias_con_uso == 2

    def test_guarda_el_ultimo_dia_con_uso(self):
        proyectar(dt.date(2026, 10, 3), 10)
        proyectar(dt.date(2026, 10, 21), 10)
        assert mensual().ultimo_uso == dt.date(2026, 10, 21)

    def test_no_mezcla_meses(self):
        proyectar(dt.date(2026, 9, 30), 100)
        proyectar(dt.date(2026, 10, 1), 7)
        assert mensual(mes=dt.date(2026, 9, 1)).minutos == 100
        assert mensual(mes=OCTUBRE).minutos == 7

    def test_el_ultimo_dia_del_mes_cae_en_su_mes(self):
        """Un error de un día acá manda el uso al mes siguiente."""
        proyectar(dt.date(2026, 10, 31), 42)
        assert mensual(mes=OCTUBRE).minutos == 42
        assert not UsoMensual.objects.filter(mes=dt.date(2026, 11, 1)).exists()

    def test_diciembre_no_se_desborda_al_año_siguiente(self):
        proyectar(dt.date(2026, 12, 31), 5)
        assert mensual(mes=dt.date(2026, 12, 1)).minutos == 5

    def test_no_mezcla_organizaciones(self):
        proyectar(dt.date(2026, 10, 3), 10, org=ORG_A)
        proyectar(dt.date(2026, 10, 3), 999, org=ORG_B)
        assert mensual(org=ORG_A).minutos == 10
        assert mensual(org=ORG_B).minutos == 999

    def test_no_mezcla_suscripciones(self):
        proyectar(dt.date(2026, 10, 3), 10, susc=SUSC)
        proyectar(dt.date(2026, 10, 3), 77, susc=OTRA)
        assert mensual(susc=SUSC).minutos == 10
        assert mensual(susc=OTRA).minutos == 77

    def test_el_agregado_coincide_con_la_suma_de_los_registros(self):
        """El criterio textual de FE-28, comprobado contra la fuente."""
        for dia, minutos in [(2, 11), (5, 23), (5, 4), (17, 60), (28, 1)]:
            proyectar(dt.date(2026, 10, dia), minutos)

        de_la_fuente = sum(
            UsoProyectado.objects.filter(
                organizacion_id=ORG_A, suscripcion_id=SUSC, fecha__gte=OCTUBRE,
                fecha__lt=dt.date(2026, 11, 1),
            ).values_list("minutos", flat=True)
        )
        assert mensual().minutos == de_la_fuente == 99

    def test_recalcular_a_mano_da_lo_mismo(self):
        """El agregado es una función pura de los registros: recalcularlo no mueve nada."""
        proyectar(dt.date(2026, 10, 3), 40)
        antes = mensual().minutos
        recalcular_mes(organizacion_id=ORG_A, suscripcion_id=SUSC, mes=OCTUBRE)
        assert mensual().minutos == antes

    def test_un_mes_sin_registros_queda_en_cero_no_ausente(self):
        recalcular_mes(organizacion_id=ORG_A, suscripcion_id=SUSC, mes=OCTUBRE)
        fila = mensual()
        assert fila.minutos == 0
        assert fila.dias_con_uso == 0
        assert fila.ultimo_uso is None


# ══════════════════════════════════════════════════════════════════════
# FE-28 — reprocesar no duplica minutos
# ══════════════════════════════════════════════════════════════════════


class TestReproceso:
    """RabbitMQ garantiza *al menos una* entrega. El reproceso no es una
    hipótesis: pasa cada vez que un consumidor muere entre el trabajo y el ack."""

    def test_el_mismo_registro_dos_veces_no_suma_dos_veces(self):
        registro = uuid.uuid4()
        assert proyectar(dt.date(2026, 10, 3), 40, registro=registro) is True
        assert proyectar(dt.date(2026, 10, 3), 40, registro=registro) is False
        assert mensual().minutos == 40
        assert UsoProyectado.objects.count() == 1

    def test_reprocesar_la_tanda_completa_no_cambia_nada(self):
        tanda = [(uuid.uuid4(), dt.date(2026, 10, d), m) for d, m in [(2, 11), (5, 23), (17, 60)]]
        for registro, fecha, minutos in tanda:
            proyectar(fecha, minutos, registro=registro)
        primera_vez = mensual().minutos

        for registro, fecha, minutos in tanda:
            proyectar(fecha, minutos, registro=registro)
        assert mensual().minutos == primera_vez == 94

    def test_un_reproceso_con_otros_minutos_no_pisa_el_original(self):
        """La fuente de verdad es Subscriptions. Si un evento repetido llega
        con otro valor, el que manda es el que ya se aplicó: pisarlo dejaría
        el agregado dependiendo del orden de llegada."""
        registro = uuid.uuid4()
        proyectar(dt.date(2026, 10, 3), 40, registro=registro)
        proyectar(dt.date(2026, 10, 3), 999, registro=registro)
        assert mensual().minutos == 40

    def test_despues_de_un_reproceso_se_puede_seguir_escribiendo(self):
        """Regresión: sin el atomic() anidado, el IntegrityError deja la
        transacción rota y lo que viene después muere con 'current transaction
        is aborted'."""
        registro = uuid.uuid4()
        proyectar(dt.date(2026, 10, 3), 40, registro=registro)
        proyectar(dt.date(2026, 10, 3), 40, registro=registro)  # choca
        assert proyectar(dt.date(2026, 10, 4), 5) is True
        assert mensual().minutos == 45

    def test_registrar_la_suscripcion_es_idempotente(self):
        observar(desde=dt.date(2026, 1, 1))
        observar(desde=dt.date(2026, 1, 1))
        assert SuscripcionObservada.objects.count() == 1

    def test_reprocesar_no_mueve_la_fecha_de_observacion_hacia_adelante(self):
        """Si la moviera, una suscripción vieja parecería recién creada y su
        bajo uso dejaría de poder afirmarse."""
        observar(desde=dt.date(2026, 1, 1))
        observar(desde=dt.date(2026, 10, 20))
        fila = SuscripcionObservada.objects.get()
        assert fila.observada_desde == dt.date(2026, 1, 1)


# ══════════════════════════════════════════════════════════════════════
# FE-28 — datos tardíos
# ══════════════════════════════════════════════════════════════════════


class TestDatosTardios:
    def test_un_registro_viejo_recalcula_su_propio_mes(self):
        proyectar(dt.date(2026, 10, 3), 40)
        # Llega en octubre un uso de marzo.
        proyectar(dt.date(2026, 3, 12), 15)
        assert mensual(mes=dt.date(2026, 3, 1)).minutos == 15
        assert mensual(mes=OCTUBRE).minutos == 40

    def test_un_registro_tardio_no_toca_los_otros_meses(self):
        proyectar(dt.date(2026, 9, 1), 10)
        proyectar(dt.date(2026, 10, 1), 20)
        proyectar(dt.date(2026, 9, 15), 5)  # tardío, de septiembre
        assert mensual(mes=dt.date(2026, 9, 1)).minutos == 15
        assert mensual(mes=OCTUBRE).minutos == 20


# ══════════════════════════════════════════════════════════════════════
# FE-29 — el mismo conjunto produce el mismo puntaje
# ══════════════════════════════════════════════════════════════════════


class TestDeterminismo:
    def test_dos_llamadas_seguidas_dan_lo_mismo(self):
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 3), 90)
        uno = puntuar(organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE)
        otro = puntuar(organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE)
        assert uno == otro

    def test_el_puntaje_no_depende_del_dia_en_que_se_calcula(self):
        """`mes_final` y `hasta` son parámetros, nunca date.today() adentro."""
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 3), 90)
        uno = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        otro = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert uno.puntaje == otro.puntaje
        assert uno.evidencia == otro.evidencia

    def test_no_escribe_nada(self):
        """El puntaje es una función pura: cambiar la fórmula no toca los datos."""
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 3), 90)
        antes = (UsoMensual.objects.count(), UsoProyectado.objects.count())
        puntuar(organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE)
        assert (UsoMensual.objects.count(), UsoProyectado.objects.count()) == antes


# ══════════════════════════════════════════════════════════════════════
# FE-29 — falta de datos ≠ uso cero
# ══════════════════════════════════════════════════════════════════════


class TestSinDatos:
    """El criterio difícil: sin datos suficientes NO se afirma bajo uso."""

    def test_una_suscripcion_desconocida_es_sin_datos_no_bajo(self):
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE
        )
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert resultado.clasificacion != Clasificacion.BAJO
        assert resultado.evidencia["uso_cero_real"] is False
        assert "no se puede distinguir" in resultado.evidencia["motivo"]

    def test_recien_observada_y_sin_uso_es_sin_datos(self):
        """Se creó hace tres días. No se usó. No se puede concluir nada."""
        observar(desde=dt.date(2026, 10, 28))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=dt.date(2026, 10, 31),
        )
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert resultado.evidencia["dias_observados"] == 3
        assert resultado.evidencia["uso_cero_real"] is False

    def test_observada_hace_rato_y_sin_uso_SI_es_bajo(self):
        """Acá sí se puede afirmar: lleva meses y no registró un minuto."""
        observar(desde=dt.date(2026, 1, 1))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.BAJO
        assert resultado.evidencia["uso_cero_real"] is True
        assert resultado.minutos_totales == 0

    def test_el_umbral_de_observacion_es_configurable(self, settings):
        settings.UMBRAL_DIAS_OBSERVACION = 200
        observar(desde=dt.date(2026, 1, 1))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        # 303 días observados, pero el umbral ahora pide 200... sigue alcanzando.
        assert resultado.clasificacion == Clasificacion.BAJO
        settings.UMBRAL_DIAS_OBSERVACION = 400
        assert (
            puntuar(
                organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
                hasta=FIN_OCTUBRE,
            ).clasificacion
            == Clasificacion.SIN_DATOS
        )

    def test_sin_datos_devuelve_puntaje_cero_pero_hay_que_mirar_la_clasificacion(self):
        """Un consumidor que mire solo el número concluiría bajo uso. Por eso
        la clasificación es lo que manda, y la evidencia dice el motivo."""
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE
        )
        assert resultado.puntaje == 0
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert resultado.evidencia["motivo"]


# ══════════════════════════════════════════════════════════════════════
# FE-29 — la fórmula
# ══════════════════════════════════════════════════════════════════════


class TestFormula:
    def test_bajo_el_umbral_es_bajo_uso(self, settings):
        settings.UMBRAL_BAJO_USO_MINUTOS = 60
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 3), 30)  # 30 min en 3 meses = 10/mes
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.BAJO
        assert resultado.minutos_por_mes == 10.0

    def test_en_el_umbral_ya_no_es_bajo(self, settings):
        settings.UMBRAL_BAJO_USO_MINUTOS = 60
        observar(desde=dt.date(2026, 1, 1))
        for mes in (8, 9, 10):
            proyectar(dt.date(2026, mes, 3), 60)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.minutos_por_mes == 60.0
        assert resultado.clasificacion != Clasificacion.BAJO
        assert resultado.puntaje == 100

    def test_el_puntaje_se_recorta_en_cien(self, settings):
        settings.UMBRAL_BAJO_USO_MINUTOS = 60
        observar(desde=dt.date(2026, 1, 1))
        for mes in (8, 9, 10):
            proyectar(dt.date(2026, mes, 3), 6000)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.puntaje == 100
        assert resultado.clasificacion == Clasificacion.ALTO

    def test_el_umbral_de_minutos_es_configurable(self, settings):
        observar(desde=dt.date(2026, 1, 1))
        for mes in (8, 9, 10):
            proyectar(dt.date(2026, mes, 3), 60)

        settings.UMBRAL_BAJO_USO_MINUTOS = 30
        assert (
            puntuar(
                organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
                hasta=FIN_OCTUBRE,
            ).clasificacion
            != Clasificacion.BAJO
        )
        settings.UMBRAL_BAJO_USO_MINUTOS = 200
        assert (
            puntuar(
                organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
                hasta=FIN_OCTUBRE,
            ).clasificacion
            == Clasificacion.BAJO
        )

    def test_una_suscripcion_nueva_no_se_promedia_sobre_meses_que_no_vivio(self, settings):
        """Si se dividiera siempre por 3, una suscripción de un mes se vería a
        un tercio de lo que de verdad se usa."""
        settings.UMBRAL_BAJO_USO_MINUTOS = 60
        settings.UMBRAL_DIAS_OBSERVACION = 20
        observar(desde=dt.date(2026, 10, 1))
        proyectar(dt.date(2026, 10, 5), 90)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.meses_evaluados == 1
        assert resultado.minutos_por_mes == 90.0
        assert resultado.clasificacion != Clasificacion.BAJO

    def test_la_ventana_son_tres_meses(self, settings):
        settings.MESES_VENTANA_USO = 3
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 6, 3), 9999)  # fuera de la ventana
        proyectar(dt.date(2026, 10, 3), 30)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.minutos_totales == 30
        assert [m["mes"] for m in resultado.evidencia["meses"]] == [
            "2026-08", "2026-09", "2026-10",
        ]

    def test_la_evidencia_dice_el_umbral_que_se_uso(self, settings):
        """Sin esto, un puntaje viejo no se puede interpretar: no se sabe
        contra qué umbral se calculó."""
        settings.UMBRAL_BAJO_USO_MINUTOS = 45
        observar(desde=dt.date(2026, 1, 1))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.evidencia["umbral_minutos_al_mes"] == 45

    def test_la_evidencia_desglosa_mes_por_mes(self):
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 9, 3), 20)
        proyectar(dt.date(2026, 10, 3), 10)
        meses = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        ).evidencia["meses"]
        assert {m["mes"]: m["minutos"] for m in meses} == {
            "2026-08": 0, "2026-09": 20, "2026-10": 10,
        }


# ══════════════════════════════════════════════════════════════════════
# FE-29 — el listado por organización
# ══════════════════════════════════════════════════════════════════════


class TestListado:
    def test_incluye_las_que_no_tienen_ni_una_fila_de_uso(self):
        """Son justamente las que más interesan: por UsoMensual no saldrían."""
        observar(susc=SUSC, nombre="Usada", desde=dt.date(2026, 1, 1))
        observar(susc=OTRA, nombre="Sin usar", desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 3), 90, susc=SUSC)

        puntajes = puntuar_organizacion(
            organizacion_id=ORG_A, mes_final=OCTUBRE, hasta=FIN_OCTUBRE
        )
        assert len(puntajes) == 2
        por_id = {p.suscripcion_id: p for p in puntajes}
        assert por_id[str(OTRA)].evidencia["uso_cero_real"] is True

    def test_no_devuelve_las_de_otra_organizacion(self):
        observar(org=ORG_A, susc=SUSC, desde=dt.date(2026, 1, 1))
        observar(org=ORG_B, susc=OTRA, desde=dt.date(2026, 1, 1))
        puntajes = puntuar_organizacion(
            organizacion_id=ORG_A, mes_final=OCTUBRE, hasta=FIN_OCTUBRE
        )
        assert [p.suscripcion_id for p in puntajes] == [str(SUSC)]

    def test_sin_suscripciones_devuelve_lista_vacia(self):
        assert puntuar_organizacion(organizacion_id=ORG_A, mes_final=OCTUBRE) == []

    def test_el_resultado_se_puede_serializar(self):
        """Recommendations (VI-17) lo consume como JSON."""
        import json

        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 3), 90)
        puntaje = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        texto = json.dumps(puntaje.como_dict())
        assert json.loads(texto)["clasificacion"] == puntaje.clasificacion
