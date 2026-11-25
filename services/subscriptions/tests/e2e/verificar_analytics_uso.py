"""Ejecuta el código real de Analytics sobre la base del E2E.

Lo invoca la suite ``S3-VI-23`` como proceso separado para no mezclar los
settings de ``subscriptions`` con los de ``analytics``. No imprime secretos:
sólo el resultado agregado que la suite compara con el contrato.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

SERVICIO_ANALYTICS = Path(__file__).resolve().parents[3] / "analytics"
sys.path.insert(0, str(SERVICIO_ANALYTICS))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "analytics_config.settings")

import django  # noqa: E402

django.setup()

from analytics.asistente import construir_contexto, resumen_local  # noqa: E402
from analytics.consultas_uso_recolectores import (  # noqa: E402
    construir_evidencias_ventana,
    obtener_uso_recolectado_mensual,
)
from analytics.motor_puntajes_recolectores import (  # noqa: E402
    calcular_puntajes_y_recomendaciones,
)


def main() -> None:
    parametros = json.loads(os.environ["E2E_ANALYTICS_PARAMETROS"])
    organizacion_id = str(parametros["organizacion_id"])
    anio = int(parametros["anio"])
    mes = int(parametros["mes"])
    suscripcion_ids = [str(valor) for valor in parametros["suscripcion_ids"]]

    uso = obtener_uso_recolectado_mensual(
        organizacion_id, anio, mes, suscripcion_ids=suscripcion_ids
    )
    puntajes = calcular_puntajes_y_recomendaciones(construir_evidencias_ventana(uso))
    contexto = construir_contexto(organizacion_id)
    uso_recolectores = contexto.get("uso_recolectores") or {}

    salida = {
        "uso": {
            suscripcion_id: {
                "duracion_positiva_ms": item.duracion_positiva_ms,
                "minutos_enteros_proyectados": item.minutos_enteros_proyectados,
                "cobertura_predominante": item.cobertura_predominante,
                "estado_predominante": item.estado_predominante,
                "existe_brecha_de_medicion": item.existe_brecha_de_medicion,
            }
            for suscripcion_id, item in uso.items()
        },
        "puntajes": puntajes,
        "gastos": contexto.get("gastos_estimados_mensuales_por_moneda") or [],
        "registros": uso_recolectores.get("registros") or [],
        "consulta_uso_disponible": uso_recolectores.get("disponible"),
        "resumen": resumen_local(contexto),
    }
    print(json.dumps(salida, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
