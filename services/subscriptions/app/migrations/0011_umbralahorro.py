"""Migración: crea la tabla umbral_ahorro (VI-21 / RN-REC-001)."""

import uuid
from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0010_unir_catalogos_presupuesto_outbox"),
    ]

    operations = [
        migrations.CreateModel(
            name="UmbralAhorro",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                ("actualizado_en", models.DateTimeField(auto_now=True)),
                (
                    "moneda",
                    models.CharField(
                        max_length=3,
                        unique=True,
                        validators=[
                            django.core.validators.RegexValidator(r"^[A-Z]{3}$")
                        ],
                        verbose_name="Moneda (ISO 4217)",
                    ),
                ),
                (
                    "monto",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=10,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0.01"))
                        ],
                        verbose_name="Ahorro mínimo para mostrar la recomendación",
                    ),
                ),
                (
                    "activo",
                    models.BooleanField(default=True, verbose_name="Activo"),
                ),
            ],
            options={
                "verbose_name": "Umbral de ahorro",
                "verbose_name_plural": "Umbrales de ahorro",
                "db_table": "umbral_ahorro",
                "ordering": ["moneda"],
                "abstract": False,
            },
        ),
    ]
