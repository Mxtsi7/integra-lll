import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("app", "0009_identidad_google")]
    operations = [
        migrations.CreateModel(
            name="EliminacionOrganizacion",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("organizacion_id", models.UUIDField(unique=True)),
                ("pendientes", models.JSONField(default=list)),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                ("completado_en", models.DateTimeField(blank=True, null=True)),
            ],
            options={"db_table": "eliminacion_organizacion"},
        ),
    ]
