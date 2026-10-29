from decimal import Decimal
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone

from analytics.models import (
    ESTADO_RECOMENDACION_DESCARTADA,
    ESTADO_RECOMENDACION_VIGENTE,
    RecomendacionConsolidacion,
    UmbralAhorro,
)
from analytics.reglas import umbral_minimo

ORG = "11111111-1111-4111-8111-111111111111"
OTRA_ORG = "22222222-2222-4222-8222-222222222222"


def crear_recomendacion(
    *,
    organizacion_id=ORG,
    moneda="CLP",
    ahorro="9990.00",
    estado=ESTADO_RECOMENDACION_VIGENTE,
):
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
        estado=estado,
    )


class UmbralAhorroTests(TestCase):
    def test_sin_configuracion_no_inventa_umbral(self):
        self.assertIsNone(umbral_minimo("CLP"))

    def test_configuracion_activa_define_el_umbral(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1500.00"))

        self.assertEqual(umbral_minimo("clp"), Decimal("1500.00"))

    def test_configuracion_inactiva_no_cuenta(self):
        UmbralAhorro.objects.create(
            moneda="CLP",
            monto=Decimal("1500.00"),
            activo=False,
        )

        self.assertIsNone(umbral_minimo("CLP"))

    def test_guarda_la_moneda_normalizada(self):
        umbral = UmbralAhorro.objects.create(moneda="usd", monto=Decimal("2.00"))

        umbral.refresh_from_db()
        self.assertEqual(umbral.moneda, "USD")


class ListadoRecomendacionesTests(TestCase):
    def _get(self, *, organizacion_id=ORG, query=""):
        return self.client.get(
            f"/api/recomendaciones/{query}",
            HTTP_X_ORGANIZACION_ID=str(organizacion_id),
        )

    def test_sin_contexto_de_organizacion_responde_403(self):
        respuesta = self.client.get("/api/recomendaciones/")

        self.assertEqual(respuesta.status_code, 403)

    def test_contexto_de_organizacion_invalido_responde_403(self):
        respuesta = self.client.get(
            "/api/recomendaciones/",
            HTTP_X_ORGANIZACION_ID="no-es-uuid",
        )

        self.assertEqual(respuesta.status_code, 403)

    def test_devuelve_el_contrato_que_espera_el_cliente_compartido(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))
        recomendacion = crear_recomendacion()

        respuesta = self._get()

        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.json()
        self.assertEqual(datos["total"], 1)
        self.assertEqual(datos["moneda"], None)
        self.assertTrue(datos["disponible"])
        self.assertIsNone(datos["motivo_sin_sugerencias"])
        self.assertEqual(datos["umbrales_no_configurados"], [])
        item = datos["results"][0]
        self.assertEqual(item["id"], str(recomendacion.id))
        self.assertEqual(item["suscripcion_id"], str(recomendacion.suscripcion_id))
        self.assertEqual(item["motivo"], recomendacion.motivo)
        self.assertEqual(item["ahorro_estimado"], 9990.0)
        self.assertEqual(item["moneda"], "CLP")
        self.assertEqual(item["estado"], ESTADO_RECOMENDACION_VIGENTE)
        self.assertEqual(item["evidencia"]["url"], "https://catalogo.example/overlap/1")

    def test_aisla_recomendaciones_de_otro_tenant(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))
        propia = crear_recomendacion()
        crear_recomendacion(organizacion_id=OTRA_ORG)

        respuesta = self._get()

        self.assertEqual(
            [item["id"] for item in respuesta.json()["results"]],
            [str(propia.id)],
        )

    def test_sin_umbral_no_devuelve_recomendaciones_y_explica_el_motivo(self):
        crear_recomendacion()

        respuesta = self._get()

        datos = respuesta.json()
        self.assertEqual(datos["results"], [])
        self.assertEqual(datos["total"], 0)
        self.assertFalse(datos["disponible"])
        self.assertIsNone(datos["umbral_aplicado"])
        self.assertEqual(datos["umbrales_no_configurados"], ["CLP"])
        self.assertIn("umbral", datos["motivo_sin_sugerencias"])
        self.assertIn("CLP", datos["motivo_sin_sugerencias"])

    def test_sin_datos_ni_configuracion_explica_la_falta_de_umbral(self):
        respuesta = self._get()

        datos = respuesta.json()
        self.assertEqual(datos["results"], [])
        self.assertFalse(datos["disponible"])
        self.assertEqual(datos["umbrales_no_configurados"], [])
        self.assertIn("umbral", datos["motivo_sin_sugerencias"])

    def test_filtra_por_umbral_inclusivo(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))
        crear_recomendacion(ahorro="999.99")
        incluida = crear_recomendacion(ahorro="1000.00")

        respuesta = self._get()

        self.assertEqual(
            [item["id"] for item in respuesta.json()["results"]],
            [str(incluida.id)],
        )
        self.assertTrue(respuesta.json()["disponible"])

    def test_filtra_por_moneda_normalizada(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))
        UmbralAhorro.objects.create(moneda="USD", monto=Decimal("1.00"))
        crear_recomendacion(moneda="CLP", ahorro="9990.00")
        en_dolares = crear_recomendacion(moneda="USD", ahorro="9.99")

        respuesta = self._get(query="?moneda=usd")

        datos = respuesta.json()
        self.assertEqual(datos["moneda"], "USD")
        self.assertEqual(datos["umbral_aplicado"], 1.0)
        self.assertEqual(
            [item["id"] for item in datos["results"]],
            [str(en_dolares.id)],
        )

    def test_moneda_filtrada_sin_umbral_se_informa_como_indisponible(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))
        crear_recomendacion(moneda="USD", ahorro="9.99")

        respuesta = self._get(query="?moneda=USD")

        datos = respuesta.json()
        self.assertEqual(datos["results"], [])
        self.assertFalse(datos["disponible"])
        self.assertEqual(datos["umbrales_no_configurados"], ["USD"])
        self.assertIn("USD", datos["motivo_sin_sugerencias"])

    def test_no_lista_recomendaciones_descartadas(self):
        UmbralAhorro.objects.create(moneda="CLP", monto=Decimal("1000.00"))
        crear_recomendacion(estado=ESTADO_RECOMENDACION_DESCARTADA)

        respuesta = self._get()

        self.assertEqual(respuesta.json()["results"], [])

    def test_moneda_invalida_responde_400(self):
        respuesta = self._get(query="?moneda=pesos")

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("moneda", respuesta.json())
