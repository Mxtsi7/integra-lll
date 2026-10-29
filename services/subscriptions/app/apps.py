from django.apps import AppConfig


class SuscripcionesConfig(AppConfig):
    name = "app"
    verbose_name = "Suscripciones"

    def ready(self) -> None:
        # Registra la detección de anomalías de VI-19 al crear un cobro.
        from app import signals  # noqa: F401
