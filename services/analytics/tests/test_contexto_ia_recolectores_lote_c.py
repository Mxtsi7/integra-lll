from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest

from analytics.asistente import construir_contexto, resumen_local
from analytics.consultas_uso_recolectores import (
    ConsultaUsoRecolectoresError,
    SuscripcionActivaConGasto,
    UsoRecolectadoSuscripcion,
)
from analytics.contexto_ia_uso import SuscripcionActivaContexto, agrupar_gastos_por_moneda, construir_contexto_ia_puro
from analytics.sanitizacion_ia import construir_payload_asistente


pytestmark = pytest.mark.django_db


def test_gastos_agrupados_estrictamente_por_moneda_sin_mezclar_divisas():
    suscripciones = [
        SuscripcionActivaContexto("s1", "Netflix", "activo", "CLP", "9990.00"),
        SuscripcionActivaContexto("s2", "Spotify", "activo", "CLP", "4550.00"),
        SuscripcionActivaContexto("s3", "Adobe", "activo", "USD", "20.00"),
        SuscripcionActivaContexto("s4", "AWS", "activo", "USD", "5.50"),
    ]

    gastos = agrupar_gastos_por_moneda(suscripciones)

    assert [(g.moneda, g.total_mensual_texto, g.cantidad_suscripciones_activas) for g in gastos] == [
        ("CLP", "14540.00", 2),
        ("USD", "25.50", 2),
    ]
    monedas = {g.moneda for g in gastos}
    assert monedas == {"CLP", "USD"}


def test_sanitizacion_contexto_recolectores_no_expone_ids_ni_secretos_y_aliaza_nombres():
    contexto = {
        "suscripciones_activas": [
            {
                "nombre": "Netflix de Ana",
                "estado": "activo",
                "moneda": "CLP",
                "monto_mensual": "9990.00",
                "suscripcion_id": "11111111-1111-4111-8111-111111111111",
                "correo": "ana@example.com",
                "token": "secreto",
            }
        ],
        "gastos_mensuales_por_moneda": [
            {"moneda": "CLP", "total_mensual_texto": "9990.00", "cantidad_suscripciones_activas": 1}
        ],
        "uso_recolectores": {
            "disponible": True,
            "motivo_no_disponible": None,
            "periodicidad": "mensual",
            "nota_semantica": "30 s es uso positivo.",
            "registros": [
                {
                    "nombre": "Netflix de Ana",
                    "duracion_positiva_ms": 30000,
                    "unidad_duracion": "ms",
                    "minutos_enteros_proyectados": 0,
                    "unidad_minutos_enteros": "min",
                    "cobertura": "completa",
                    "certeza": "alta",
                    "clasificacion_uso": "uso_positivo_confirmado",
                    "fecha_ultima_actividad_positiva": "2026-11-10",
                    "suscripcion_id": "11111111-1111-4111-8111-111111111111",
                    "api_key": "no-debe-salir",
                }
            ],
        },
    }

    payload = construir_payload_asistente(contexto, "¿Cuánto uso y gasto tengo ana@example.com?")
    datos = payload["datos"]
    texto = str(payload)

    assert "Netflix de Ana" not in texto
    assert "ana@example.com" not in texto
    assert "secreto" not in texto
    assert "no-debe-salir" not in texto
    assert "11111111-1111-4111-8111-111111111111" not in texto

    suscripcion = datos["suscripciones_activas"][0]
    assert suscripcion["nombre"].startswith("servicio_")
    assert "suscripcion_id" not in suscripcion
    assert suscripcion["moneda"] == "CLP"

    registro = datos["uso_recolectores"]["registros"][0]
    assert registro["nombre"].startswith("servicio_")
    assert registro["duracion_positiva_ms"] == 30000
    assert registro["minutos_enteros_proyectados"] == 0
    assert registro["unidad_duracion"] == "ms"
    assert registro["cobertura"] == "completa"
    assert registro["fecha_ultima_actividad_positiva"] == "2026-11-10"
    assert "suscripcion_id" not in registro
    assert "api_key" not in registro

    assert datos["gastos_mensuales_por_moneda"] == [
        {"moneda": "CLP", "total_mensual_texto": "9990.00", "cantidad_suscripciones_activas": 1}
    ]


def test_contexto_ia_aisla_organizaciones_y_separa_gastos(monkeypatch):
    org_a = str(uuid4())
    org_b = str(uuid4())

    def fake_suscripciones(organizacion_id):
        if str(organizacion_id) == org_a:
            return [
                SuscripcionActivaConGasto("sub-a", "Servicio A", "1000.00", "CLP", "activo", True),
                SuscripcionActivaConGasto("sub-a2", "Servicio USD A", "10.00", "USD", "activo", True),
            ]
        if str(organizacion_id) == org_b:
            return [SuscripcionActivaConGasto("sub-b", "Servicio B", "9999.00", "EUR", "activo", True)]
        return []

    def fake_uso(organizacion_id, anio, mes, suscripcion_ids=None):
        if str(organizacion_id) == org_a:
            return {
                "sub-a": UsoRecolectadoSuscripcion("sub-a", 30000, 0, "completa", "activo", True, False, date(2026, 11, 10)),
            }
        if str(organizacion_id) == org_b:
            return {
                "sub-b": UsoRecolectadoSuscripcion("sub-b", 0, 0, "completa", "activo", True, False, None),
            }
        return {}

    monkeypatch.setattr("analytics.asistente.obtener_suscripciones_activas_con_gasto", fake_suscripciones)
    monkeypatch.setattr("analytics.asistente.obtener_uso_recolectado_mensual", fake_uso)

    contexto_a = construir_contexto(org_a)
    contexto_b = construir_contexto(org_b)

    texto_a = str(contexto_a)
    texto_b = str(contexto_b)

    assert "Servicio A" in texto_a
    assert "Servicio B" not in texto_a
    assert "9999.00" not in texto_a
    assert "EUR" not in {g["moneda"] for g in contexto_a["gastos_mensuales_por_moneda"]}

    assert "Servicio B" in texto_b
    assert "Servicio A" not in texto_b
    assert "1000.00" not in texto_b

    monedas_a = {(g["moneda"], g["total_mensual_texto"]) for g in contexto_a["gastos_mensuales_por_moneda"]}
    assert ("CLP", "1000.00") in monedas_a
    assert ("USD", "10.00") in monedas_a
    assert len(monedas_a) == 2

    registros_a = contexto_a["uso_recolectores"]["registros"]
    assert any(r["duracion_positiva_ms"] == 30000 and r["minutos_enteros_proyectados"] == 0 for r in registros_a)


def test_fallo_consulta_analytics_no_se_convierte_en_cero_minutos(monkeypatch):
    org = str(uuid4())

    monkeypatch.setattr(
        "analytics.asistente.obtener_suscripciones_activas_con_gasto",
        lambda organizacion_id: (_ for _ in ()).throw(ConsultaUsoRecolectoresError("fallo")),
    )
    monkeypatch.setattr(
        "analytics.asistente.obtener_uso_recolectado_mensual",
        lambda organizacion_id, anio, mes, suscripcion_ids=None: (_ for _ in ()).throw(ConsultaUsoRecolectoresError("fallo")),
    )

    contexto = construir_contexto(org)
    uso = contexto["uso_recolectores"]

    assert uso["disponible"] is False
    assert uso["registros"] == []
    assert contexto["suscripciones_activas_disponibles"] is False

    resumen = resumen_local(contexto).lower()
    assert ("no se puede" in resumen) or ("no está disponible" in resumen) or ("no esta disponible" in resumen)
    assert "afirm" in resumen or "consulta" in resumen


def test_contexto_puro_marca_indisponibilidad_sin_inventar_uso():
    contexto = construir_contexto_ia_puro(
        suscripciones_activas=[],
        usos_recolectados=[],
        consulta_uso_disponible=False,
        motivo_consulta_uso_no_disponible="consulta_analytics_no_disponible",
    )
    assert contexto["uso_recolectores"]["disponible"] is False
    assert contexto["uso_recolectores"]["registros"] == []
    assert contexto["uso_recolectores"]["motivo_no_disponible"] == "consulta_analytics_no_disponible"