"""Migración: crea la tabla recomendacion_descartada (VI-18)."""

import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0011_umbralahorro"),
    ]

    operations = [
        migrations.CreateModel(
            name="RecomendacionDescartada",
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
                ("organizacion_id", models.UUIDField(db_index=True)),
                (
                    "motivo",
                    models.CharField(
                        blank=True,
                        default="",
                        max_length=100,
                        verbose_name="Motivo del descarte",
                    ),
                ),
                (
                    "descartado_por",
                    models.BigIntegerField(
                        blank=True,
                        null=True,
                        verbose_name="Usuario que descartó",
                    ),
                ),
                (
                    "vigente_hasta",
                    models.DateTimeField(
                        blank=True,
                        null=True,
                        verbose_name="Vigente hasta",
                    ),
                ),
                (
                    "suscripcion",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="descartes_recomendacion",
                        to="app.subscription",
                        verbose_name="Suscripción",
                    ),
                ),
            ],
            options={
                "verbose_name": "Recomendación descartada",
                "verbose_name_plural": "Recomendaciones descartadas",
                "db_table": "recomendacion_descartada",
                "ordering": ["-creado_en"],
                "abstract": False,
                "indexes": [
                    models.Index(
                        fields=["organizacion_id", "-creado_en"],
                        name="recomendaci_organiz_18afe1_idx",
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("organizacion_id", "suscripcion"),
                        name="recomendacion_descartada_unica_org_sub",
                    )
                ],
            },
        ),
    ]
