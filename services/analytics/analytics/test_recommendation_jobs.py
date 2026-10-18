from datetime import date

from django.test import SimpleTestCase

from analytics.jobs import (
    generar_recomendaciones_consolidacion,
    procesar_evento_solapamiento,
)
from analytics.event_consumer import procesar_mensaje


HOY = date(2026, 10, 17)
CORTE = date(2026, 9, 2)
ORG = "11111111-1111-4111-8111-111111111111"
OTRA_ORG = "22222222-2222-4222-8222-222222222222"
EVENTO_ID = "33333333-3333-4333-8333-333333333333"
CORRELACION_ID = "44444444-4444-4444-8444-444444444444"
SUBSCRIPCION_1_ID = "55555555-5555-4555-8555-555555555555"
SUBSCRIPCION_2_ID = "66666666-6666-4666-8666-666666666666"


def suscripcion(
    identificador,
    nombre,
    *,
    monto="9990.00",
    frecuencia="mensual",
    ultimo_uso=None,
    categoria="streaming",
    estado="activo",
    activa=True,
    observada_desde="2026-07-01",
    moneda="CLP",
):
    return {
        "id": identificador,
        "organizacion_id": ORG,
        "nombre": nombre,
        "categoria": categoria,
        "estado": estado,
        "activa": activa,
        "monto": monto,
        "moneda": moneda,
        "frecuencia": frecuencia,
        "uso_observado_desde": observada_desde,
        "ultimo_uso": ultimo_uso,
    }


def solapamiento(*ids, categoria="streaming", url="https://catalogo.example/overlap/1"):
    return {
        "evidencia_id": "catalogo:overlap:1",
        "categoria": categoria,
        "suscripcion_ids": list(ids),
        "evidencia_url": url,
        "evidencia_descripcion": "La fuente documenta funciones compartidas.",
    }


def evento_solapamiento(*, version=2, organizacion_id=ORG):
    primera = suscripcion(
        SUBSCRIPCION_1_ID,
        "Servicio A",
        ultimo_uso="2026-08-01",
    )
    segunda = suscripcion(
        SUBSCRIPCION_2_ID,
        "Servicio B",
        ultimo_uso="2026-10-01",
    )
    primera["organizacion_id"] = organizacion_id
    segunda["organizacion_id"] = organizacion_id
    return {
        "evento": "solapamiento.detectado",
        "version": version,
        "id": EVENTO_ID,
        "ocurrido_en": "2026-10-17T12:00:00Z",
        "correlation_id": CORRELACION_ID,
        "organizacion_id": organizacion_id,
        "datos": {
            "suscripcion_ids": [SUBSCRIPCION_1_ID, SUBSCRIPCION_2_ID],
            "categoria": "streaming",
            "evidencia_id": "catalogo:overlap:1",
            "evidencia_url": "https://catalogo.example/overlap/1",
            "evidencia_descripcion": "La fuente documenta funciones compartidas.",
            "suscripciones": [primera, segunda],
        },
    }


class CanalFalso:
    def __init__(self):
        self.publicados = []
        self.confirmados = []
        self.rechazados = []

    def basic_publish(self, **kwargs):
        self.publicados.append(kwargs)
        return True

    def basic_ack(self, *, delivery_tag):
        self.confirmados.append(delivery_tag)

    def basic_nack(self, *, delivery_tag, requeue):
        self.rechazados.append((delivery_tag, requeue))


class ConsolidationRecommendationJobTests(SimpleTestCase):
    def test_same_category_alone_does_not_produce_recommendation(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion("s1", "Servicio A", ultimo_uso="2026-10-01"),
                suscripcion("s2", "Servicio B", ultimo_uso="2026-10-02"),
            ],
            solapamientos=[],
            fecha_referencia=HOY,
        )

        self.assertEqual(resultado, [])

    def test_explicit_evidence_and_observed_low_use_produce_explained_saving(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion("s1", "Servicio A", ultimo_uso="2026-08-01"),
                suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01"),
            ],
            solapamientos=[solapamiento("s1", "s2")],
            fecha_referencia=HOY,
        )

        self.assertEqual(len(resultado), 1)
        recomendacion = resultado[0]
        self.assertEqual(recomendacion["organizacion_id"], ORG)
        self.assertEqual(
            recomendacion["suscripcion_candidata"],
            {"id": "s1", "nombre": "Servicio A"},
        )
        self.assertEqual(
            recomendacion["suscripciones_relacionadas"],
            [{"id": "s2", "nombre": "Servicio B"}],
        )
        self.assertIn("Servicio A (s1)", recomendacion["motivo"])
        self.assertIn("Servicio B (s2)", recomendacion["motivo"])
        self.assertIn("no afirma equivalencia", recomendacion["motivo"])
        self.assertIn("calculado como monto recurrente", recomendacion["motivo"])
        self.assertEqual(
            recomendacion["ahorro_potencial"],
            {
                "monto_mensual": "9990.00",
                "moneda": "CLP",
                "base_calculo": "monto recurrente 9990.00 CLP mensual",
            },
        )
        self.assertEqual(
            recomendacion["evidencia"]["url"],
            "https://catalogo.example/overlap/1",
        )

    def test_annual_cost_is_divided_by_twelve(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion(
                    "s1",
                    "Servicio anual",
                    monto="120000.00",
                    frecuencia="anual",
                    ultimo_uso=None,
                ),
                suscripcion("s2", "Servicio usado", ultimo_uso="2026-10-01"),
            ],
            solapamientos=[solapamiento("s1", "s2")],
            fecha_referencia=HOY,
        )

        self.assertEqual(
            resultado[0]["ahorro_potencial"],
            {
                "monto_mensual": "10000.00",
                "moneda": "CLP",
                "base_calculo": "120000.00 CLP anual / 12",
            },
        )

    def test_recent_use_on_candidate_prevents_recommendation(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion("s1", "Servicio A", ultimo_uso=CORTE.isoformat()),
                suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01"),
            ],
            solapamientos=[solapamiento("s1", "s2")],
            fecha_referencia=HOY,
        )

        self.assertEqual(resultado, [])

    def test_incomplete_use_observation_does_not_claim_no_use(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion(
                    "s1",
                    "Servicio A",
                    ultimo_uso=None,
                    observada_desde="2026-10-01",
                ),
                suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01"),
            ],
            solapamientos=[solapamiento("s1", "s2")],
            fecha_referencia=HOY,
        )

        self.assertEqual(resultado, [])

    def test_other_category_and_cancelled_services_are_not_candidates(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion("s1", "Servicio A", ultimo_uso="2026-08-01"),
                suscripcion(
                    "s2",
                    "Servicio B",
                    ultimo_uso="2026-10-01",
                    estado="cancelado",
                ),
            ],
            solapamientos=[solapamiento("s1", "s2")],
            fecha_referencia=HOY,
        )
        self.assertEqual(resultado, [])

        resultado_otro = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion("s1", "Servicio A", ultimo_uso="2026-08-01", categoria="otro"),
                suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01", categoria="otro"),
            ],
            solapamientos=[solapamiento("s1", "s2", categoria="otro")],
            fecha_referencia=HOY,
        )
        self.assertEqual(resultado_otro, [])

    def test_savings_keep_each_currency_separate(self):
        resultado = generar_recomendaciones_consolidacion(
            organizacion_id=ORG,
            suscripciones=[
                suscripcion(
                    "s1",
                    "Servicio USD",
                    monto="9.99",
                    moneda="USD",
                    ultimo_uso="2026-08-01",
                ),
                suscripcion(
                    "s2",
                    "Servicio CLP",
                    monto="9990.00",
                    moneda="CLP",
                    ultimo_uso="2026-10-01",
                ),
            ],
            solapamientos=[solapamiento("s1", "s2")],
            fecha_referencia=HOY,
        )

        self.assertEqual(
            resultado[0]["ahorro_potencial"]["monto_mensual"],
            "9.99",
        )
        self.assertEqual(resultado[0]["ahorro_potencial"]["moneda"], "USD")
        self.assertNotIn("9990", resultado[0]["ahorro_potencial"]["base_calculo"])

    def test_overlapping_evidence_requires_https_link(self):
        with self.assertRaisesMessage(ValueError, "enlace HTTPS"):
            generar_recomendaciones_consolidacion(
                organizacion_id=ORG,
                suscripciones=[
                    suscripcion("s1", "Servicio A", ultimo_uso="2026-08-01"),
                    suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01"),
                ],
                solapamientos=[
                    solapamiento("s1", "s2", url="http://catalogo.example/overlap/1")
                ],
                fecha_referencia=HOY,
            )

    def test_evidence_cannot_reference_subscriptions_outside_snapshot(self):
        with self.assertRaisesMessage(ValueError, "fuera del snapshot"):
            generar_recomendaciones_consolidacion(
                organizacion_id=ORG,
                suscripciones=[
                    suscripcion("s1", "Servicio A", ultimo_uso="2026-08-01"),
                    suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01"),
                ],
                solapamientos=[solapamiento("s1", "s3")],
                fecha_referencia=HOY,
            )

    def test_job_rejects_subscriptions_from_another_organization(self):
        segunda = suscripcion("s2", "Servicio B", ultimo_uso="2026-10-01")
        segunda["organizacion_id"] = OTRA_ORG

        with self.assertRaisesMessage(ValueError, "no coincide con el tenant"):
            generar_recomendaciones_consolidacion(
                organizacion_id=ORG,
                suscripciones=[
                    suscripcion("s1", "Servicio A", ultimo_uso="2026-08-01"),
                    segunda,
                ],
                solapamientos=[solapamiento("s1", "s2")],
                fecha_referencia=HOY,
            )

    def test_event_v2_generates_correlated_recommendation_event(self):
        resultado = procesar_evento_solapamiento(
            evento_solapamiento(),
            fecha_referencia=HOY,
        )

        self.assertEqual(len(resultado), 1)
        generado = resultado[0]
        self.assertEqual(generado["evento"], "recomendacion.consolidacion_generada")
        self.assertEqual(generado["version"], 1)
        self.assertEqual(generado["correlation_id"], CORRELACION_ID)
        self.assertEqual(generado["organizacion_id"], ORG)
        self.assertEqual(generado["datos"]["evento_origen_id"], EVENTO_ID)
        self.assertEqual(
            generado["datos"]["suscripcion_candidata"]["id"],
            SUBSCRIPCION_1_ID,
        )
        self.assertEqual(
            generado["datos"]["evidencia"]["url"],
            "https://catalogo.example/overlap/1",
        )
        self.assertIn("base_calculo", generado["datos"]["ahorro_potencial"])

        repetido = procesar_evento_solapamiento(
            evento_solapamiento(),
            fecha_referencia=HOY,
        )
        self.assertEqual(generado["id"], repetido[0]["id"])

    def test_event_without_v2_evidence_contract_is_rejected(self):
        with self.assertRaisesMessage(ValueError, "versión 2"):
            procesar_evento_solapamiento(
                evento_solapamiento(version=1),
                fecha_referencia=HOY,
            )

    def test_event_requires_verified_snapshot_to_match_subscription_ids(self):
        evento = evento_solapamiento()
        evento["datos"]["suscripciones"].pop()

        with self.assertRaisesMessage(ValueError, "coincidir exactamente"):
            procesar_evento_solapamiento(evento, fecha_referencia=HOY)

    def test_event_requires_explicit_linked_overlap_evidence(self):
        evento = evento_solapamiento()
        evento["datos"]["evidencia_url"] = None

        with self.assertRaisesMessage(ValueError, "evidencia_url es obligatorio"):
            procesar_evento_solapamiento(evento, fecha_referencia=HOY)

    def test_event_requires_uuid_correlation_id(self):
        evento = evento_solapamiento()
        evento["correlation_id"] = "no-uuid"

        with self.assertRaisesMessage(ValueError, "correlation_id"):
            procesar_evento_solapamiento(evento, fecha_referencia=HOY)

    def test_rabbit_message_publishes_results_before_acknowledging_input(self):
        import json

        canal = CanalFalso()
        procesar_mensaje(
            canal,
            17,
            json.dumps(evento_solapamiento()).encode("utf-8"),
            fecha_referencia=HOY,
        )

        self.assertEqual(canal.confirmados, [17])
        self.assertEqual(canal.rechazados, [])
        self.assertEqual(len(canal.publicados), 1)
        self.assertTrue(canal.publicados[0]["mandatory"])
        publicado = json.loads(canal.publicados[0]["body"])
        self.assertEqual(
            publicado["evento"],
            "recomendacion.consolidacion_generada",
        )
        self.assertEqual(publicado["correlation_id"], CORRELACION_ID)

    def test_invalid_rabbit_message_is_dead_lettered(self):
        canal = CanalFalso()
        procesar_mensaje(canal, 18, b"not-json", fecha_referencia=HOY)

        self.assertEqual(canal.confirmados, [])
        self.assertEqual(canal.rechazados, [(18, False)])
        self.assertEqual(canal.publicados, [])
