from django.test import SimpleTestCase


class HealthCheckTests(SimpleTestCase):
    def test_health_returns_service_status(self):
        response = self.client.get("/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"status": "ok", "service": "notifications"},
        )
