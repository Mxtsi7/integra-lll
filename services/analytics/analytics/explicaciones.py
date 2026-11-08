"""Explicación local de hechos persistidos, sin llamadas ni texto generado por IA."""


def explicar(recomendacion):
    completa = all(str(valor or "").strip() for valor in (
        recomendacion.motivo, recomendacion.base_calculo,
        recomendacion.evidencia_id, recomendacion.evidencia_descripcion,
    ))
    if completa:
        texto = (
            f"{recomendacion.motivo.strip()} "
            f"Ahorro estimado: {recomendacion.ahorro_estimado:.2f} {recomendacion.moneda}. "
            f"Base de cálculo: {recomendacion.base_calculo.strip()}. "
            f"Evidencia: {recomendacion.evidencia_descripcion.strip()} "
            "Es una estimación, no un ahorro confirmado."
        )
    else:
        texto = (
            "Esta recomendación no tiene motivo, base de cálculo o evidencia suficientes "
            "para justificar una estimación de ahorro. Revisa la información de origen."
        )
    return {
        "id": recomendacion.id,
        "suscripcion_id": recomendacion.suscripcion_id,
        "explicacion": texto,
        "fuente": "reglas",
        "estado": "disponible" if completa else "datos_insuficientes",
        "motivo": recomendacion.motivo if completa else None,
        "ahorro_estimado": recomendacion.ahorro_estimado if completa else None,
        "moneda": recomendacion.moneda,
        "base_calculo": recomendacion.base_calculo if completa else None,
        "evidencia": {
            "id": recomendacion.evidencia_id,
            "url": recomendacion.evidencia_url,
            "descripcion": recomendacion.evidencia_descripcion,
        } if completa else None,
        "uso": "no_evaluado",
        "advertencia_uso": "La consolidación se basa en solapamiento; no afirma bajo uso ni calcula un puntaje de actividad.",
    }
