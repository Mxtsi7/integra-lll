from unittest.mock import patch

from django.db import DatabaseError
from django.test import TestCase


class HealthCheckTests(TestCase):
    def test_health_returns_service_status(self):
        response = self.client.get("/health/")

        self.assertEqual(response.status_code, 200)
        datos = response.json()
        self.assertEqual(datos["status"], "ok")
        self.assertEqual(datos["service"], "analytics")
        self.assertIn("esquema", datos)

    def test_health_no_declara_sano_sin_base(self):
        with patch(
            "analytics.views.connection.cursor",
            side_effect=DatabaseError("sin base"),
        ):
            response = self.client.get("/health/")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(), {"status": "error", "service": "analytics"}
        )
