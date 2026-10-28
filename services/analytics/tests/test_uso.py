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
from django.db import DataError, IntegrityError, connection

from shared.bloqueo import ESPACIOS

from analytics.uso import (
    Clasificacion,
    _bloquear_agregado,
    mes_siguiente,
    meses_hacia_atras,
    primer_dia,
    proyectar_uso,
    puntuar,
    puntuar_organizacion,
    recalcular_mes,
    registrar_cobertura,
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


def observar(*, org=ORG_A, susc=SUSC, desde=dt.date(2026, 1, 1), nombre="Netflix",
             cubierto=True, cubierto_hasta=dt.date(2026, 12, 31)):
    """Registra la suscripción y, por omisión, ACREDITA su cobertura.

    `cubierto=True` por omisión porque la mayoría de las pruebas miden la
    fórmula, no la cobertura, y sin acreditarla todas darían `sin_datos` — que
    es correcto pero no es lo que esas pruebas comprueban.

    Las pruebas de `TestCobertura` la pasan en False a propósito: ahí lo que
    se mide es justamente qué pasa SIN cobertura acreditada.
    """
    fila = registrar_suscripcion(
        organizacion_id=org, suscripcion_id=susc, observada_desde=desde, nombre=nombre
    )
    if cubierto:
        registrar_cobertura(
            organizacion_id=org, suscripcion_id=susc,
            desde=desde, hasta=cubierto_hasta,
        )
        fila.refresh_from_db()
    return fila


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


# ══════════════════════════════════════════════════════════════════════
# Las correcciones de la revisión de #110
# ══════════════════════════════════════════════════════════════════════


class TestUnidadTransaccional:
    """El registro y el agregado entran juntos o no entra ninguno.

    Antes el atomic cerraba después de insertar y el recálculo quedaba afuera.
    Si el recálculo fallaba, el registro quedaba guardado SIN agregado, y la
    reentrega del mismo evento devolvía False por la restricción única **sin
    reparar el mes**: esos minutos no se agregaban nunca más.
    """

    def test_si_falla_el_recalculo_no_queda_el_registro_suelto(self, monkeypatch):
        import analytics.uso as modulo

        def explotar(**_kw):
            raise RuntimeError("se cayó el recálculo")

        monkeypatch.setattr(modulo, "recalcular_mes", explotar)
        with pytest.raises(RuntimeError):
            proyectar(dt.date(2026, 10, 3), 40)

        assert not UsoProyectado.objects.exists()
        assert not UsoMensual.objects.exists()

    def test_tras_el_fallo_la_reentrega_SI_repara_el_mes(self, monkeypatch):
        """Lo que de verdad importa: que el evento se pueda volver a aplicar."""
        import analytics.uso as modulo

        registro = uuid.uuid4()

        def explotar(**_kw):
            raise RuntimeError("se cayó")

        monkeypatch.setattr(modulo, "recalcular_mes", explotar)
        with pytest.raises(RuntimeError):
            proyectar(dt.date(2026, 10, 3), 40, registro=registro)

        monkeypatch.undo()
        assert proyectar(dt.date(2026, 10, 3), 40, registro=registro) is True
        assert mensual().minutos == 40

    def test_un_IntegrityError_de_OTRA_cosa_no_se_toma_como_reproceso(self):
        """Un IntegrityError no prueba por sí solo que sea el mismo evento.

        Acá se fuerza uno distinto —un minutos negativo contra el
        PositiveIntegerField— y tiene que SUBIR, no devolver False en silencio.
        """
        with pytest.raises((IntegrityError, ValueError, DataError)):
            proyectar_uso(
                organizacion_id=ORG_A,
                suscripcion_id=SUSC,
                evento_id=uuid.uuid4(),
                fecha=dt.date(2026, 10, 3),
                minutos=-1,
            )


@pytest.fixture
def solo_postgres():
    """Salta la prueba si la base no es PostgreSQL, comprobándolo EN TIEMPO DE
    EJECUCIÓN.

    Con `@pytest.mark.skipif(connection.vendor != ...)` no sirve: el decorador
    se evalúa al IMPORTAR el módulo, y el `django_db_setup` del conftest cambia
    la base a SQLite después. Resultado: las pruebas de PostgreSQL se
    ejecutaban igual contra SQLite y fallaban.
    """
    if connection.vendor != "postgresql":
        pytest.skip("los advisory locks son de PostgreSQL; en SQLite es un no-op")


class TestBloqueoDelAgregado:
    """El lock se toma ANTES del SUM; si no, dos recálculos se pisan.

    ⚠️ La carrera en sí **no la cubre esta suite**: en SQLite no hay advisory
    locks y las escrituras se serializan igual, así que el intercalado no se
    puede reproducir acá. Hay que verificarlo contra PostgreSQL. Lo que sí se
    fija es el contrato del lock, para que nadie lo saque de la transacción.
    """

    def test_exige_estar_dentro_de_una_transaccion(self, monkeypatch):
        """Un `pg_advisory_xact_lock` fuera de un atomic se suelta al tiro y
        no protege nada. Mejor reventar que dar una falsa sensación.

        La guarda se prueba simulando la conexión: pytest-django envuelve cada
        prueba en una transacción, así que `in_atomic_block` es verdadero
        siempre y no se puede llegar al caso de otra forma.
        """
        import analytics.uso as modulo

        class FueraDeTransaccion:
            in_atomic_block = False

        monkeypatch.setattr(
            modulo.transaction, "get_connection", lambda *_a, **_k: FueraDeTransaccion()
        )
        with pytest.raises(RuntimeError, match="transacción"):
            _bloquear_agregado(ORG_A, SUSC, OCTUBRE)

    def test_dentro_de_una_transaccion_no_revienta(self):
        from django.db import transaction

        with transaction.atomic():
            _bloquear_agregado(ORG_A, SUSC, OCTUBRE)

    def test_en_postgres_el_lock_QUEDA_TOMADO(self, solo_postgres):
        """Que la función no reviente no prueba que el lock exista.

        Acá se mira `pg_locks` de verdad: tiene que aparecer un lock advisory
        del espacio de FE-28 tomado por esta sesión. Es determinístico, a
        diferencia de una carrera con hilos, que sería intermitente.

        Esta prueba **solo corre contra PostgreSQL**. Es la que habría cazado
        el `NameError: hashlib` que la suite en SQLite no vio, porque en
        SQLite la función sale antes de llegar al hash.
        """
        from django.db import transaction

        with transaction.atomic():
            _bloquear_agregado(ORG_A, SUSC, OCTUBRE)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM pg_locks "
                    "WHERE locktype = 'advisory' AND classid = %s "
                    "AND pid = pg_backend_pid()",
                    [ESPACIOS["uso_mensual"]],
                )
                assert cursor.fetchone()[0] == 1

    def test_en_postgres_el_lock_se_suelta_al_cerrar_la_transaccion(self, solo_postgres):
        """Es `_xact_`: si no se soltara, la conexión quedaría reteniéndolo."""
        from django.db import transaction

        with transaction.atomic():
            _bloquear_agregado(ORG_A, SUSC, OCTUBRE)
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM pg_locks "
                "WHERE locktype = 'advisory' AND classid = %s AND pid = pg_backend_pid()",
                [ESPACIOS["uso_mensual"]],
            )
            # pytest-django envuelve la prueba en su propia transacción, así
            # que el atomic de arriba es un savepoint y el lock sigue hasta el
            # final; lo que se comprueba es que no se acumule más de uno.
            assert cursor.fetchone()[0] <= 1

    def test_en_postgres_claves_distintas_dan_locks_distintos(self, solo_postgres):
        """Si todas las claves colapsaran en una, se serializaría el servicio
        entero en vez de un (tenant, suscripcion, mes)."""
        from django.db import transaction

        with transaction.atomic():
            _bloquear_agregado(ORG_A, SUSC, OCTUBRE)
            _bloquear_agregado(ORG_A, OTRA, OCTUBRE)
            _bloquear_agregado(ORG_B, SUSC, OCTUBRE)
            _bloquear_agregado(ORG_A, SUSC, dt.date(2026, 9, 1))
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(DISTINCT objid) FROM pg_locks "
                    "WHERE locktype = 'advisory' AND classid = %s AND pid = pg_backend_pid()",
                    [ESPACIOS["uso_mensual"]],
                )
                assert cursor.fetchone()[0] == 4

    def test_recalcular_mes_lo_toma_siempre(self):
        """Si alguien saca el lock de `recalcular_mes`, esto falla."""
        import inspect

        fuente = inspect.getsource(recalcular_mes)
        assert "_bloquear_agregado(" in fuente
        # Y antes del SUM, no después.
        assert fuente.index("_bloquear_agregado(") < fuente.index("aggregate(")


class TestCorteTemporal:
    """No se cuentan días que todavía no ocurrieron."""

    def test_el_mes_en_curso_no_cuenta_los_dias_que_faltan(self):
        """La reproducción de la revisión: reloj en el 2 de octubre, la
        suscripción observada desde el 1. Antes respondía `dias_observados=30`
        y `bajo`; o sea daba por observado un mes que recién empezaba."""
        observar(desde=dt.date(2026, 10, 1))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=dt.date(2026, 10, 2),
        )
        assert resultado.evidencia["dias_observados"] == 1
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert resultado.evidencia["uso_cero_real"] is False

    def test_un_uso_posterior_al_corte_no_entra(self):
        """La otra reproducción: con `hasta` el 2 de octubre, una fila del
        día 20 seguía sumando porque se leía todo UsoMensual."""
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 20), 500)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=dt.date(2026, 10, 2),
        )
        assert resultado.minutos_totales == 0
        octubre = [m for m in resultado.evidencia["meses"] if m["mes"] == "2026-10"][0]
        assert octubre["minutos"] == 0
        assert octubre["mes_en_curso"] is True
        assert octubre["contado_hasta"] == "2026-10-02"

    def test_un_uso_anterior_al_corte_si_entra(self):
        """El corte no puede tragarse lo que sí ocurrió."""
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 10, 1), 30)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=dt.date(2026, 10, 2),
        )
        assert resultado.minutos_totales == 30

    def test_el_corte_no_puede_pasar_del_mes_pedido(self):
        """Pedir marzo en octubre no puede contar abril a octubre como
        observados: `hasta` se recorta al último día del mes pedido."""
        observar(desde=dt.date(2026, 1, 1))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            mes_final=dt.date(2026, 3, 1), hasta=dt.date(2026, 10, 27),
        )
        assert resultado.evidencia["medido_hasta"] == "2026-03-31"
        assert resultado.evidencia["mes_en_curso"] is False

    def test_un_mes_cerrado_no_cambia_por_pasar_hoy(self):
        """Para un mes ya cerrado, pasar la fecha de hoy da lo mismo que no
        pasarla: es lo que hace que la vista pueda pasarla siempre."""
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 9, 10), 90)
        sin_corte = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            mes_final=dt.date(2026, 9, 1),
        )
        con_corte = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            mes_final=dt.date(2026, 9, 1), hasta=dt.date(2026, 10, 27),
        )
        assert sin_corte == con_corte

    def test_con_el_mes_del_corte_todos_los_de_la_ventana_ya_empezaron(self):
        observar(desde=dt.date(2026, 1, 1))
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=dt.date(2026, 10, 2),
        )
        # Agosto, septiembre y octubre ya empezaron al 2 de octubre.
        assert resultado.evidencia["meses_observados_en_la_ventana"] == 3

    def test_un_mes_final_ADELANTE_del_corte_no_promedia_meses_que_no_pasaron(self):
        """El caso que de verdad ejercita el recorte de `meses_observados`.

        La vista rechaza un mes futuro, pero `puntuar` se puede llamar directo
        —Recommendations lo hace— y ahí el recorte es lo único que impide
        dividir los minutos entre meses que nunca ocurrieron.

        Ventana de noviembre: septiembre, octubre y noviembre. Con el corte el
        2 de octubre, noviembre NO empezó: el divisor tiene que ser 2, no 3.
        """
        observar(desde=dt.date(2026, 1, 1))
        proyectar(dt.date(2026, 9, 10), 120)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            mes_final=dt.date(2026, 11, 1), hasta=dt.date(2026, 10, 2),
        )
        assert resultado.evidencia["meses_observados_en_la_ventana"] == 2
        assert resultado.meses_evaluados == 2
        assert resultado.minutos_por_mes == 60.0   # 120 / 2, no 120 / 3

    def test_recalcular_mes_tambien_respeta_el_corte(self):
        """Hace falta para poder reconstruir el agregado de un mes en curso."""
        proyectar(dt.date(2026, 10, 1), 10)
        proyectar(dt.date(2026, 10, 20), 500)
        recalcular_mes(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes=OCTUBRE,
            hasta=dt.date(2026, 10, 2),
        )
        assert mensual().minutos == 10

    def test_sin_corte_recalcular_cuenta_el_mes_completo(self):
        proyectar(dt.date(2026, 10, 1), 10)
        proyectar(dt.date(2026, 10, 20), 500)
        recalcular_mes(organizacion_id=ORG_A, suscripcion_id=SUSC, mes=OCTUBRE)
        assert mensual().minutos == 510


# ══════════════════════════════════════════════════════════════════════
# FE-29 — la antigüedad NO es cobertura
# (el hallazgo de la segunda revisión de #111)
# ══════════════════════════════════════════════════════════════════════


class TestCobertura:
    """Que la suscripción sea vieja no prueba que tengamos su uso.

    `observada_desde` sale del `ocurrido_en` de `suscripcion.creada`. Si una
    creación de hace dos meses llega HOY —backfill, replay, el consumidor
    caído—, la cuenta de días daba 56 y el puntaje afirmaba `bajo` con
    `uso_cero_real`, cuando Analytics recién se enteró de que existe.

    Es el criterio de FE-29: «sin datos suficientes no se afirma bajo uso como
    hecho».
    """

    def test_una_creacion_VIEJA_recibida_hoy_es_sin_datos(self):
        """La reproducción de la revisión, exacta: creada el 01-09, puntuada
        al 27-10, sin cobertura acreditada. Antes: 56 días y `bajo`."""
        observar(desde=dt.date(2026, 9, 1), cubierto=False)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=dt.date(2026, 10, 27),
        )
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert resultado.evidencia["uso_cero_real"] is False
        assert "No hay cobertura acreditada" in resultado.evidencia["motivo"]
        # Los días sí se informan, pero no deciden.
        assert resultado.evidencia["dias_observados"] == 56

    def test_sin_cobertura_no_se_afirma_uso_cero_real(self):
        observar(desde=dt.date(2026, 1, 1), cubierto=False)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert resultado.evidencia["uso_cero_real"] is False
        assert resultado.evidencia["cobertura_hasta"] is None

    def test_con_cobertura_del_periodo_y_cero_minutos_SI_es_bajo(self):
        """El cero de verdad: sabemos que el periodo llegó completo y no hubo
        un solo minuto. Ahí sí se puede afirmar."""
        observar(desde=dt.date(2026, 1, 1), cubierto=True)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.BAJO
        assert resultado.evidencia["uso_cero_real"] is True

    def test_un_backfill_INCOMPLETO_al_principio_es_sin_datos(self):
        """Acreditado desde septiembre, pero la ventana empieza en agosto."""
        observar(desde=dt.date(2026, 1, 1), cubierto=False)
        registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 9, 1), hasta=FIN_OCTUBRE,
        )
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert "Cobertura incompleta" in resultado.evidencia["motivo"]
        assert resultado.evidencia["cobertura_necesaria_desde"] == "2026-08-01"

    def test_una_ingesta_ATRASADA_al_final_es_sin_datos(self):
        """Acreditado hasta el 10 de octubre, pero el corte es el 31."""
        observar(desde=dt.date(2026, 1, 1), cubierto=False)
        registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 1, 1), hasta=dt.date(2026, 10, 10),
        )
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.SIN_DATOS
        assert "Cobertura incompleta" in resultado.evidencia["motivo"]

    def test_la_cobertura_justa_alcanza(self):
        """Ni un día de más: acreditado exactamente el periodo que hace falta."""
        observar(desde=dt.date(2026, 1, 1), cubierto=False)
        registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 8, 1), hasta=FIN_OCTUBRE,
        )
        proyectar(dt.date(2026, 10, 3), 30)
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        assert resultado.clasificacion == Clasificacion.BAJO
        assert resultado.minutos_totales == 30

    def test_para_una_suscripcion_NUEVA_basta_cubrir_desde_que_nacio(self):
        """La ventana son 3 meses, pero no se puede exigir cobertura de meses
        en los que la suscripción no existía."""
        observar(desde=dt.date(2026, 10, 1), cubierto=False)
        registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 10, 1), hasta=FIN_OCTUBRE,
        )
        resultado = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        )
        # Ya no es "sin cobertura"; cae en el mínimo de días de observación.
        assert "cobertura" not in resultado.evidencia["motivo"].lower()

    def test_la_cobertura_se_extiende_nunca_se_encoge(self):
        """Acreditar menos de lo que ya se sabía no es información nueva."""
        observar(desde=dt.date(2026, 1, 1), cubierto=False)
        registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 1, 1), hasta=dt.date(2026, 10, 31),
        )
        registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 6, 1), hasta=dt.date(2026, 9, 1),
        )
        fila = SuscripcionObservada.objects.get()
        assert fila.cobertura_desde == dt.date(2026, 1, 1)
        assert fila.cobertura_hasta == dt.date(2026, 10, 31)

    def test_la_cobertura_de_una_suscripcion_desconocida_no_crea_nada(self):
        """No se acredita cobertura de algo que no sabemos que existe."""
        assert registrar_cobertura(
            organizacion_id=ORG_A, suscripcion_id=SUSC,
            desde=dt.date(2026, 1, 1), hasta=FIN_OCTUBRE,
        ) is None
        assert not SuscripcionObservada.objects.exists()

    def test_la_evidencia_dice_que_periodo_haria_falta(self):
        """Sin esto, quien reciba `sin_datos` no sabe qué le falta."""
        observar(desde=dt.date(2026, 1, 1), cubierto=False)
        evidencia = puntuar(
            organizacion_id=ORG_A, suscripcion_id=SUSC, mes_final=OCTUBRE,
            hasta=FIN_OCTUBRE,
        ).evidencia
        assert evidencia["cobertura_necesaria_desde"] == "2026-08-01"
        assert evidencia["medido_hasta"] == "2026-10-31"
        assert evidencia["cobertura_hasta"] is None

    def test_el_listado_no_afirma_bajo_uso_sin_cobertura(self):
        """La API pública es lo que consume VI-17: no puede afirmar un cero
        sobre una proyección sin cobertura."""
        observar(susc=SUSC, nombre="Sin cobertura", desde=dt.date(2026, 1, 1),
                 cubierto=False)
        observar(susc=OTRA, nombre="Con cobertura", desde=dt.date(2026, 1, 1),
                 cubierto=True)

        puntajes = puntuar_organizacion(
            organizacion_id=ORG_A, mes_final=OCTUBRE, hasta=FIN_OCTUBRE
        )
        por_id = {p.suscripcion_id: p for p in puntajes}
        assert por_id[str(SUSC)].clasificacion == Clasificacion.SIN_DATOS
        assert por_id[str(SUSC)].evidencia["uso_cero_real"] is False
        # La que sí tiene cobertura sigue pudiendo afirmarlo.
        assert por_id[str(OTRA)].clasificacion == Clasificacion.BAJO
        assert por_id[str(OTRA)].evidencia["uso_cero_real"] is True
