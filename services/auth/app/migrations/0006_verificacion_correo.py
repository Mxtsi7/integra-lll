import uuid

from django.conf import settings
from django.db import migrations, models
from django.db.models.functions import Lower
import django.db.models.deletion


def comprobar_correos_duplicados(apps, schema_editor):
    usuarios = apps.get_model("app", "User").objects.using(schema_editor.connection.alias)
    duplicados = usuarios.annotate(correo_normalizado=Lower("email")).values("correo_normalizado").annotate(total=models.Count("pk")).filter(total__gt=1)
    if duplicados.exists():
        raise RuntimeError("Existen correos duplicados sin distinguir mayúsculas. Revisar manualmente antes de aplicar 0006_verificacion_correo; no se modificaron datos.")


class Migration(migrations.Migration):
    dependencies = [("app", "0008_sesion")]

    operations = [
        migrations.RunPython(comprobar_correos_duplicados, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(Lower("email"), name="usuario_email_unico_sin_mayusculas"),
        ),
        migrations.AddField(
            model_name="user", name="correo_verificado_en",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="SolicitudVerificacionCorreo",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                ("actualizado_en", models.DateTimeField(auto_now=True)),
                ("huella", models.CharField(max_length=64, unique=True)),
                ("correo", models.EmailField(max_length=254)),
                ("correo_anterior", models.EmailField(max_length=254)),
                ("credenciales", models.CharField(max_length=64)),
                ("vence_en", models.DateTimeField()),
                ("consumido_en", models.DateTimeField(blank=True, null=True)),
                ("invalidado_en", models.DateTimeField(blank=True, null=True)),
                ("usuario", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="verificaciones_correo", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "solicitud_verificacion_correo", "ordering": ["-creado_en"], "abstract": False},
        ),
    ]
