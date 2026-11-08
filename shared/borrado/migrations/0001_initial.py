from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="EstadoOrganizacion",
            fields=[
                ("organizacion_id", models.UUIDField(primary_key=True, serialize=False)),
                ("eliminada", models.BooleanField(default=False)),
                ("operacion_id", models.UUIDField(null=True)),
            ],
            options={"db_table": "estado_eliminacion_organizacion"},
        ),
    ]
