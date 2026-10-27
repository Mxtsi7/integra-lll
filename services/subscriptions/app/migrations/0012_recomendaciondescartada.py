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
                ("id", models.UUIDField(primary_key=True, serialize=False, editable=False)),
                ("organizacion_id", models.UUIDField(db_index=True, editable=False)),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                ("actualizado_en", models.DateTimeField(auto_now=True)),
                ("suscripcion", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="recomendaciones_descartadas",
                    to="app.subscription",
                )),
            ],
            options={
                "db_table": "recomendacion_descartada",
                "ordering": ["-creado_en"],
                "verbose_name": "Recomendación descartada",
                "indexes": [models.Index(fields=["organizacion_id", "-creado_en"], name="recomendac_organiz_8d319b_idx")],
                "constraints": [models.UniqueConstraint(
                    fields=("organizacion_id", "suscripcion"),
                    name="recomendacion_descartada_unica_tenant_sub",
                )],
            },
        ),
    ]
