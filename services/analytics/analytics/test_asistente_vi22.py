"""VI-22 / VI-24: asistente Premium, aislamiento de tenant y degradación."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from analytics.models import (
    ConsumoMensualIA,
    CupoIngesta,
    SuscripcionObservada,
    UsoMensual,
)
from analytics.test_recommendation_api import crear_recomendacion

ORG = "11111111-1111-4111-8111-111111111111"
OTRA_ORG = "22222222-2222-4222-8222-222222222222"
USUARIO = "42"

CABECERAS = {
    "HTTP_X_ORGANIZACION_ID": ORG,
    "HTTP_X_USUARIO_ID": USUARIO,
    "HTTP_X_PLAN": "premium",
}


def pedir(client, **extra):
    cabeceras = {**CABECERAS, **extra}
    return client.post(
        "/api/asistente/",
        data={"mensaje": "¿Qué reviso primero?"},
        content_type="application/json",
        **cabeceras,
    )


def crear_uso(organizacion_id=ORG, *, nombre=None, minutos=120):
    suscripcion_id = uuid4()
    if nombre is not None:
        SuscripcionObservada.objects.create(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            nombre=nombre,
            observada_desde=date(2026, 1, 1),
        )
    return UsoMensual.objects.create(
        organizacion_id=organizacion_id,
        suscripcion_id=suscripcion_id,
        mes=date(2026, 10, 1),
        minutos=minutos,
        dias_con_uso=3,
        ultimo_uso=date(2026, 10, 20),
    )


class AutorizacionAsistenteTests(TestCase):
    def test_sin_plan_premium_no_llega_al_proveedor(self):
        with patch("analytics.views.consultar_proveedor") as proveedor:
            respuesta = self.client.post(
                "/api/asistente/",
                data={},
                content_type="application/json",
                HTTP_X_ORGANIZACION_ID=ORG,
                HTTP_X_USUARIO_ID=USUARIO,
            )

        self.assertEqual(respuesta.status_code, 403)
        proveedor.assert_not_called()

    def test_plan_free_no_llega_al_proveedor(self):
        with patch("analytics.views.consultar_proveedor") as proveedor:
            respuesta = pedir(self.client, HTTP_X_PLAN="free")

        self.assertEqual(respuesta.status_code, 403)
        proveedor.assert_not_called()

    def test_sin_organizacion_es_403(self):
        respuesta = self.client.post(
            "/api/asistente/",
            data={},
            content_type="application/json",
            HTTP_X_USUARIO_ID=USUARIO,
            HTTP_X_PLAN="premium",
        )

        self.assertEqual(respuesta.status_code, 403)

    def test_sin_usuario_es_403(self):
        respuesta = self.client.post(
            "/api/asistente/",
            data={},
            content_type="application/json",
            HTTP_X_ORGANIZACION_ID=ORG,
            HTTP_X_PLAN="premium",
        )

        self.assertEqual(respuesta.status_code, 403)


class ContextoAsistenteTests(TestCase):
    @override_settings(ANTHROPIC_API_KEY="")
    def test_solo_ve_datos_de_su_tenant_y_sin_identificadores(self):
        crear_uso(nombre="Servicio Propio")
        crear_uso(OTRA_ORG, nombre="Servicio Ajeno", minutos=999)
        crear_recomendacion(organizacion_id=ORG)
        crear_recomendacion(organizacion_id=OTRA_ORG, ahorro="777.00")

        with patch(
            "analytics.views.consultar_proveedor",
            return_value={"respuesta": "resumen"},
        ):
            respuesta = pedir(self.client)

        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.json()["datos"]
        self.assertTrue(datos["uso_mensual"])
        self.assertTrue(datos["recomendaciones"])
        texto = str(datos)
        self.assertIn("Servicio Propio", texto)
        self.assertNotIn("Servicio Ajeno", texto)
        self.assertNotIn("'minutos': 999", texto)
        self.assertNotIn("777", texto)
        self.assertNotIn(ORG, texto)
        self.assertNotIn(OTRA_ORG, texto)
        for fila in datos["uso_mensual"]:
            self.assertEqual(
                set(fila), {"servicio", "mes", "minutos", "dias_con_uso"}
            )
        for fila in datos["recomendaciones"]:
            self.assertEqual(
                set(fila),
                {"servicio", "ahorro_estimado", "moneda", "motivo"},
            )


class RespuestaAsistenteTests(TestCase):
    def test_ok_cuando_el_proveedor_responde(self):
        crear_uso(nombre="Streaming")

        with patch(
            "analytics.views.consultar_proveedor",
            return_value={"respuesta": "Revisa el streaming."},
        ) as proveedor:
            respuesta = pedir(self.client)

        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()
        self.assertEqual(cuerpo["estado"], "ok")
        self.assertIsNone(cuerpo["motivo"])
        self.assertEqual(cuerpo["respuesta"], "Revisa el streaming.")
        proveedor.assert_called_once()
        _, kwargs = proveedor.call_args
        self.assertLessEqual(kwargs["timeout"], 3.5)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_sin_clave_degrada_con_resumen_local(self):
        crear_uso(nombre="Streaming")

        respuesta = pedir(self.client)

        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()
        self.assertEqual(cuerpo["estado"], "degradado")
        self.assertEqual(cuerpo["motivo"], "no_configurado")
        self.assertIn("resumen con IA no está disponible", cuerpo["respuesta"])

    def test_timeout_degrada_sin_500(self):
        with patch(
            "analytics.views.consultar_proveedor",
            side_effect=TimeoutError("lento"),
        ):
            respuesta = pedir(self.client)

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["motivo"], "timeout")

    def test_proveedor_caido_degrada_sin_500(self):
        with patch(
            "analytics.views.consultar_proveedor",
            side_effect=RuntimeError("boom"),
        ):
            respuesta = pedir(self.client)

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["motivo"], "proveedor_no_disponible")

    def test_cuota_agotada_degrada_y_no_llama_al_proveedor(self):
        cupo = CupoIngesta.objects.create(
            organizacion_id=ORG, usuario_id=int(USUARIO)
        )
        mes = timezone.localdate().replace(day=1)
        ConsumoMensualIA.objects.create(cupo=cupo, mes=mes, llamadas=200)

        with patch("analytics.views.consultar_proveedor") as proveedor:
            respuesta = pedir(self.client)

        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()
        self.assertEqual(cuerpo["estado"], "degradado")
        self.assertEqual(cuerpo["motivo"], "cuota_agotada")
        proveedor.assert_not_called()

    def test_la_cuota_se_descuenta_en_cada_llamada_exitosa(self):
        with patch(
            "analytics.views.consultar_proveedor",
            return_value={"respuesta": "ok"},
        ):
            pedir(self.client)
            pedir(self.client)

        consumo = ConsumoMensualIA.objects.get(cupo__usuario_id=int(USUARIO))
        self.assertEqual(consumo.llamadas, 2)


class SanitizacionTests(TestCase):
    def test_recorta_control_y_espacios(self):
        from analytics.asistente import sanear_texto

        self.assertEqual(sanear_texto("  hola\x00\n   mundo  "), "hola mundo")
        self.assertEqual(sanear_texto("x" * 500, limite=10), "x" * 10)
        self.assertEqual(sanear_texto(None), "")

    def test_resumen_local_suma_ahorros_por_moneda(self):
        from analytics.asistente import resumen_local

        resumen = resumen_local(
            {
                "uso_mensual": [{"minutos": 100}],
                "recomendaciones": [
                    {"moneda": "CLP", "ahorro_estimado": "1000.00"},
                    {"moneda": "CLP", "ahorro_estimado": "500.00"},
                ],
            }
        )

        self.assertIn("1500.00 CLP", resumen)
        self.assertIn("100 minutos", resumen)
