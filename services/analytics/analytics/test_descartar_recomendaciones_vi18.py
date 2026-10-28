"""Pruebas de aceptación de VI-18 sobre el listado definitivo de Analytics.

Escenarios cubiertos:
- listado definitivo antes del descarte;
- descarte con ownership A/B;
- repetición idempotente;
- exclusión durante la vigencia y reaparición al expirar;
- entradas inválidas (pk no UUID, UUID inexistente, días fuera de rango);
- contrato rico: motivo, actor y vigencia.
"""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone

from analytics.models import (
    ESTADO_RECOMENDACION_VIGENTE,
    RecomendacionConsolidacion,
    RecomendacionDescartada,
    UmbralAhorro,
)

ORG = "11111111-1111-4111-8111-111111111111"
OTRA_ORG = "22222222-2222-4222-8222-222222222222"
USUARIO = "42"

URL_LISTA = "/api/recomendaciones/"


def crear_recomendacion(*, organizacion_id=ORG, moneda="CLP", ahorro="9990.00"):
    return RecomendacionConsolidacion.objects.create(
        id=uuid4(),
        organizacion_id=organizacion_id,
        evento_origen_id=uuid4(),
        correlation_id=uuid4(),
        ocurrido_en=timezone.now(),
        categoria="streaming",
        suscripcion_id=uuid4(),
        suscripcion_nombre="Servicio A",
        suscripciones_relacionadas=[{"id": str(uuid4()), "nombre": "Servicio B"}],
        motivo="Posible consolidación a revisar en streaming.",
        ahorro_estimado=Decimal(ahorro),
        moneda=moneda,
        base_calculo=f"monto recurrente {ahorro} {moneda} mensual",
        evidencia_id="catalogo:overlap:1",
        evidencia_url="https://catalogo.example/overlap/1",
        evidencia_descripcion="La fuente documenta funciones compartidas.",
        estado=ESTADO_RECOMENDACION_VIGENTE,
    )


class DescartarRecomendacionesTests(TestCase):
    def setUp(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))

    def _get(self, *, organizacion_id=ORG):
        return self.client.get(
            URL_LISTA,
            HTTP_X_ORGANIZACION_ID=str(organizacion_id),
        )

    def _dismiss(self, recomendacion, *, organizacion_id=ORG, datos=None, usuario=USUARIO):
        cabeceras = {"HTTP_X_ORGANIZACION_ID": str(organizacion_id)}
        if usuario is not None:
            cabeceras["HTTP_X_USUARIO_ID"] = usuario
        return self.client.post(
            f"/api/recomendaciones/{recomendacion}/dismiss/",
            data=datos or {},
            content_type="application/json",
            **cabeceras,
        )

    def test_listado_definitivo_muestra_la_recomendacion(self):
        recomendacion = crear_recomendacion()

        respuesta = self._get()

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(
            [item["id"] for item in respuesta.json()["results"]],
            [str(recomendacion.id)],
        )

    def test_descarte_devuelve_contrato_rico_y_oculta_del_listado(self):
        recomendacion = crear_recomendacion()

        respuesta = self._dismiss(
            recomendacion.id,
            datos={"motivo": "ya la revisamos", "dias_vigencia": 10},
        )

        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.json()
        self.assertEqual(datos["recomendacion_id"], str(recomendacion.id))
        self.assertEqual(datos["suscripcion_id"], str(recomendacion.suscripcion_id))
        self.assertEqual(datos["motivo"], "ya la revisamos")
        self.assertEqual(datos["descartado_por"], int(USUARIO))
        self.assertEqual(datos["descartado"], True)
        self.assertIsNotNone(datos["vigente_hasta"])

        listado = self._get()
        self.assertEqual(listado.json()["results"], [])

    def test_ownership_a_no_puede_descartar_una_recomendacion_de_b(self):
        ajena = crear_recomendacion(organizacion_id=OTRA_ORG)

        respuesta = self._dismiss(ajena.id, organizacion_id=ORG)

        self.assertEqual(respuesta.status_code, 404)
        self.assertFalse(
            RecomendacionDescartada.objects.filter(recomendacion=ajena).exists()
        )
        self.assertEqual(
            [item["id"] for item in self._get(organizacion_id=OTRA_ORG).json()["results"]],
            [str(ajena.id)],
        )

    def test_descarte_de_a_no_oculta_recomendaciones_de_b(self):
        propia = crear_recomendacion(organizacion_id=ORG)
        ajena = crear_recomendacion(organizacion_id=OTRA_ORG)

        self.assertEqual(self._dismiss(propia.id).status_code, 200)

        self.assertEqual(self._get().json()["results"], [])
        self.assertEqual(
            [item["id"] for item in self._get(organizacion_id=OTRA_ORG).json()["results"]],
            [str(ajena.id)],
        )

    def test_repetir_el_descarte_es_idempotente(self):
        recomendacion = crear_recomendacion()

        primera = self._dismiss(recomendacion.id, datos={"dias_vigencia": 5})
        segunda = self._dismiss(recomendacion.id, datos={"dias_vigencia": 5})

        self.assertEqual(primera.status_code, 200)
        self.assertEqual(segunda.status_code, 200)
        self.assertEqual(primera.json()["id"], segunda.json()["id"])
        self.assertEqual(
            RecomendacionDescartada.objects.filter(
                organizacion_id=ORG,
                recomendacion=recomendacion,
            ).count(),
            1,
        )
        self.assertEqual(self._get().json()["results"], [])

    def test_durante_la_vigencia_se_excluye_y_al_expirar_reaparece(self):
        recomendacion = crear_recomendacion()
        descarte = RecomendacionDescartada.objects.create(
            organizacion_id=ORG,
            recomendacion=recomendacion,
            motivo="temporal",
            descartado_por=int(USUARIO),
            vigente_hasta=timezone.now() + timedelta(days=3),
        )

        self.assertEqual(self._get().json()["results"], [])

        descarte.vigente_hasta = timezone.now() - timedelta(seconds=1)
        descarte.save(update_fields=["vigente_hasta"])

        self.assertEqual(
            [item["id"] for item in self._get().json()["results"]],
            [str(recomendacion.id)],
        )

    def test_descarte_sin_vigencia_se_trata_como_indefinido(self):
        recomendacion = crear_recomendacion()
        RecomendacionDescartada.objects.create(
            organizacion_id=ORG,
            recomendacion=recomendacion,
            vigente_hasta=None,
        )

        self.assertEqual(self._get().json()["results"], [])

    def test_pk_no_uuid_responde_404_y_no_crea_descartes(self):
        respuesta = self.client.post(
            "/api/recomendaciones/no-es-un-uuid/dismiss/",
            data={},
            content_type="application/json",
            HTTP_X_ORGANIZACION_ID=ORG,
        )

        self.assertEqual(respuesta.status_code, 404)
        self.assertFalse(RecomendacionDescartada.objects.exists())

    def test_pk_uuid_inexistente_responde_404(self):
        respuesta = self._dismiss(uuid4())

        self.assertEqual(respuesta.status_code, 404)

    def test_dias_vigencia_cero_responde_400(self):
        recomendacion = crear_recomendacion()

        respuesta = self._dismiss(recomendacion.id, datos={"dias_vigencia": 0})

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("dias_vigencia", respuesta.json())

    def test_dias_vigencia_negativo_responde_400(self):
        recomendacion = crear_recomendacion()

        respuesta = self._dismiss(recomendacion.id, datos={"dias_vigencia": -1})

        self.assertEqual(respuesta.status_code, 400)

    def test_dias_vigencia_que_desborda_el_limite_responde_400(self):
        recomendacion = crear_recomendacion()

        respuesta = self._dismiss(recomendacion.id, datos={"dias_vigencia": 366})

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("dias_vigencia", respuesta.json())
        self.assertFalse(
            RecomendacionDescartada.objects.filter(recomendacion=recomendacion).exists()
        )

    def test_sin_contexto_de_organizacion_responde_403(self):
        recomendacion = crear_recomendacion()

        respuesta = self.client.post(
            f"/api/recomendaciones/{recomendacion.id}/dismiss/",
            data={},
            content_type="application/json",
        )

        self.assertEqual(respuesta.status_code, 403)

    def test_actor_no_numerico_no_rompe_el_descarte(self):
        recomendacion = crear_recomendacion()

        respuesta = self._dismiss(recomendacion.id, usuario="no-numerico")

        self.assertEqual(respuesta.status_code, 200)
        self.assertIsNone(respuesta.json()["descartado_por"])
