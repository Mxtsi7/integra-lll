from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0015_eliminacionusuario"),
    ]

    operations = [
        migrations.AddField(
            model_name="sesion",
            name="iniciada_en",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sesion",
            name="metodo",
            field=models.CharField(
                choices=[("local", "Contraseña"), ("google", "Google")],
                default="local",
                max_length=6,
            ),
        ),
        migrations.AddIndex(
            model_name="sesion",
            index=models.Index(
                fields=["usuario", "-iniciada_en", "-id"],
                name="sesion_historial_usuario_idx",
            ),
        ),
    ]
