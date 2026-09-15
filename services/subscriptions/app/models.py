"""Modelos del servicio de suscripciones – Sprint 1."""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from decimal import Decimal


class Subscription(models.Model):
    """Suscripción recurrente asociada a un usuario."""

    # ── choices ──────────────────────────────────────────────────────

    class Ciclo(models.TextChoices):
        MENSUAL = "MENSUAL", "Mensual"
        ANUAL = "ANUAL", "Anual"

    class Estado(models.TextChoices):
        ACTIVO = "ACTIVO", "Activo"
        INACTIVO = "INACTIVO", "Inactivo"

    class Moneda(models.TextChoices):
        CLP = "CLP", "Peso chileno"

    # ── campos ───────────────────────────────────────────────────────

    nombre = models.CharField(
        max_length=100,
        verbose_name="Nombre de la suscripción",
    )

    monto = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        verbose_name="Monto",
    )

    moneda = models.CharField(
        max_length=3,
        choices=Moneda.choices,
        default=Moneda.CLP,
        verbose_name="Moneda",
    )

    ciclo = models.CharField(
        max_length=20,
        choices=Ciclo.choices,
        verbose_name="Ciclo de cobro",
    )

    fecha_cobro = models.DateField(
        verbose_name="Fecha de cobro",
    )

    estado = models.CharField(
        max_length=20,
        choices=Estado.choices,
        verbose_name="Estado",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subscriptions",
        verbose_name="Usuario",
    )

    # ── meta ─────────────────────────────────────────────────────────

    class Meta:
        db_table = "subscription"
        constraints = [
            models.CheckConstraint(
                check=models.Q(monto__gt=Decimal("0")),
                name="subscription_monto_positivo",
            ),
        ]
        ordering = ["-fecha_cobro"]
        verbose_name = "Suscripción"
        verbose_name_plural = "Suscripciones"

    def __str__(self) -> str:
        return f"{self.nombre} ({self.get_ciclo_display()}) – {self.monto} {self.moneda}"
