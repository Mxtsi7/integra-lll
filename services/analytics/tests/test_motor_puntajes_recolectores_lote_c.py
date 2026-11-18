from datetime import date

from analytics.motor_puntajes_recolectores import (
    ACCION_RECOMENDAR_CANCELACION,
    ACCION_RECOMENDAR_REDUCCION,
    ACCION_SIN_RECOMENDACION_AUTOMATICA,
    CERTEZA_ALTA,
    CERTEZA_INSUFICIENTE,
    CLASIFICACION_CERO_OBSERVADO,
    CLASIFICACION_DATOS_INSUFICIENTES,
    CLASIFICACION_USO_POSITIVO,
    COBERTURA_COMPLETA,
    COBERTURA_PARCIAL,
    COBERTURA_SIN_MEDICION,
    ESTADO_ACTIVO,
    ESTADO_PAUSADO,
    ESTADO_REVOCADO,
    ESTADO_SIN_PERMISO,
    EvidenciaUsoVentana,
    calcular_puntaje_aprovechamiento,
    evaluar_regla_recomendacion,
)


def test_uso_positivo_30_segundos_no_es_cero_ni_inactividad():
    evidencia = EvidenciaUsoVentana(
        suscripcion_id="sub-30s",
        duracion_positiva_ms=30000,
        cobertura_predominante=COBERTURA_COMPLETA,
        estado_predominante=ESTADO_ACTIVO,
        existe_observacion_completa_activa=True,
        existe_brecha_de_medicion=False,
        fecha_ultima_actividad_positiva=date(2026, 11, 10),
        minutos_enteros_proyectados=0,  # proyección a minutos enteros puede ser 0
    )

    resultado = calcular_puntaje_aprovechamiento(evidencia)

    assert resultado.clasificacion_uso == CLASIFICACION_USO_POSITIVO
    assert resultado.duracion_positiva_ms == 30000
    assert resultado.minutos_enteros_proyectados == 0
    assert resultado.puntaje_aprovechamiento > 0
    assert resultado.certeza == CERTEZA_ALTA
    assert resultado.permite_penalizacion_por_bajo_uso is False

    regla = evaluar_regla_recomendacion(resultado)
    assert regla.accion == ACCION_SIN_RECOMENDACION_AUTOMATICA
    assert regla.penalizacion_aplicada is False


def test_cero_observado_solo_con_cobertura_completa_activa_y_sin_actividad():
    evidencia = EvidenciaUsoVentana(
        suscripcion_id="sub-cero-observado",
        duracion_positiva_ms=0,
        cobertura_predominante=COBERTURA_COMPLETA,
        estado_predominante=ESTADO_ACTIVO,
        existe_observacion_completa_activa=True,
        existe_brecha_de_medicion=False,
        fecha_ultima_actividad_positiva=None,
        minutos_enteros_proyectados=0,
    )

    resultado = calcular_puntaje_aprovechamiento(evidencia)

    assert resultado.clasificacion_uso == CLASIFICACION_CERO_OBSERVADO
    assert resultado.certeza == CERTEZA_ALTA
    assert resultado.cobertura == COBERTURA_COMPLETA
    assert resultado.puntaje_aprovechamiento == 0
    assert resultado.permite_penalizacion_por_bajo_uso is True

    regla = evaluar_regla_recomendacion(resultado)
    assert regla.accion == ACCION_RECOMENDAR_CANCELACION
    assert regla.penalizacion_aplicada is True


def test_cobertura_parcial_sin_actividad_no_penaliza():
    evidencia = EvidenciaUsoVentana(
        suscripcion_id="sub-parcial",
        duracion_positiva_ms=0,
        cobertura_predominante=COBERTURA_PARCIAL,
        estado_predominante=ESTADO_ACTIVO,
        existe_observacion_completa_activa=False,
        existe_brecha_de_medicion=True,
        fecha_ultima_actividad_positiva=None,
        minutos_enteros_proyectados=0,
    )

    resultado = calcular_puntaje_aprovechamiento(evidencia)

    assert resultado.clasificacion_uso == CLASIFICACION_DATOS_INSUFICIENTES
    assert resultado.certeza == CERTEZA_INSUFICIENTE
    assert resultado.cobertura == COBERTURA_PARCIAL
    assert resultado.permite_penalizacion_por_bajo_uso is False

    regla = evaluar_regla_recomendacion(resultado)
    assert regla.accion == ACCION_SIN_RECOMENDACION_AUTOMATICA
    assert regla.penalizacion_aplicada is False


def test_recolector_pausado_no_penaliza():
    evidencia = EvidenciaUsoVentana(
        suscripcion_id="sub-pausado",
        duracion_positiva_ms=0,
        cobertura_predominante=COBERTURA_COMPLETA,
        estado_predominante=ESTADO_PAUSADO,
        existe_observacion_completa_activa=False,
        existe_brecha_de_medicion=True,
        fecha_ultima_actividad_positiva=None,
        minutos_enteros_proyectados=0,
    )

    resultado = calcular_puntaje_aprovechamiento(evidencia)

    assert resultado.clasificacion_uso == CLASIFICACION_DATOS_INSUFICIENTES
    assert resultado.certeza == CERTEZA_INSUFICIENTE
    assert resultado.permite_penalizacion_por_bajo_uso is False

    regla = evaluar_regla_recomendacion(resultado)
    assert regla.accion == ACCION_SIN_RECOMENDACION_AUTOMATICA
    assert regla.penalizacion_aplicada is False


def test_sin_medicion_no_penaliza():
    evidencia = EvidenciaUsoVentana(
        suscripcion_id="sub-sin-medicion",
        duracion_positiva_ms=0,
        cobertura_predominante=COBERTURA_SIN_MEDICION,
        estado_predominante=ESTADO_ACTIVO,
        existe_observacion_completa_activa=False,
        existe_brecha_de_medicion=True,
        fecha_ultima_actividad_positiva=None,
        minutos_enteros_proyectados=0,
    )

    resultado = calcular_puntaje_aprovechamiento(evidencia)

    assert resultado.clasificacion_uso == CLASIFICACION_DATOS_INSUFICIENTES
    assert resultado.certeza == CERTEZA_INSUFICIENTE
    assert resultado.cobertura == COBERTURA_SIN_MEDICION
    assert resultado.permite_penalizacion_por_bajo_uso is False


def test_sin_permiso_y_revocado_no_penalizan():
    for estado in (ESTADO_SIN_PERMISO, ESTADO_REVOCADO):
        evidencia = EvidenciaUsoVentana(
            suscripcion_id=f"sub-{estado}",
            duracion_positiva_ms=0,
            cobertura_predominante=COBERTURA_COMPLETA,
            estado_predominante=estado,
            existe_observacion_completa_activa=False,
            existe_brecha_de_medicion=True,
            fecha_ultima_actividad_positiva=None,
            minutos_enteros_proyectados=0,
        )
        resultado = calcular_puntaje_aprovechamiento(evidencia)
        assert resultado.clasificacion_uso == CLASIFICACION_DATOS_INSUFICIENTES
        assert resultado.permite_penalizacion_por_bajo_uso is False
        regla = evaluar_regla_recomendacion(resultado)
        assert regla.accion == ACCION_SIN_RECOMENDACION_AUTOMATICA
        assert regla.penalizacion_aplicada is False


def test_brecha_explicita_bloquea_recomendacion_de_reduccion():
    evidencia = EvidenciaUsoVentana(
        suscripcion_id="sub-brecha",
        duracion_positiva_ms=120000,
        cobertura_predominante=COBERTURA_COMPLETA,
        estado_predominante=ESTADO_ACTIVO,
        existe_observacion_completa_activa=True,
        existe_brecha_de_medicion=True,
        fecha_ultima_actividad_positiva=date(2026, 11, 10),
        minutos_enteros_proyectados=2,
    )

    resultado = calcular_puntaje_aprovechamiento(evidencia)

    assert resultado.clasificacion_uso == CLASIFICACION_USO_POSITIVO
    assert resultado.permite_penalizacion_por_bajo_uso is False

    regla = evaluar_regla_recomendacion(resultado)
    assert regla.accion == ACCION_SIN_RECOMENDACION_AUTOMATICA
    assert regla.penalizacion_aplicada is False
