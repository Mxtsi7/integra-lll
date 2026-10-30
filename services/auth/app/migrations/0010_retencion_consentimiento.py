import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("app", "0007_eliminacion_organizacion")]
    operations = [
        migrations.CreateModel(
            name="ConsentimientoDisociado",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("consentimiento_en", models.DateTimeField()),
                ("eliminado_en", models.DateTimeField()),
                ("retener_hasta", models.DateTimeField(db_index=True)),
            ],
            options={"db_table": "consentimiento_disociado"},
        ),
    ]
