from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("app", "0006_verificacion_correo")]

    operations = [
        migrations.CreateModel(
            name="IdentidadGoogle",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("subject", models.CharField(max_length=255, unique=True)),
                ("usuario", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                                related_name="identidad_google", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "identidad_google"},
        ),
        migrations.CreateModel(
            name="IntentoGoogle",
            fields=[
                ("huella", models.CharField(max_length=64, primary_key=True, serialize=False)),
                ("navegador", models.CharField(max_length=64)),
                ("vence_en", models.DateTimeField(db_index=True)),
            ],
            options={"db_table": "intento_google"},
        ),
    ]
