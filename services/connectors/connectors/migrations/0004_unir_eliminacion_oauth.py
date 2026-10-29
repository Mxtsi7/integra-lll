from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("connectors", "0002_cuenta_revocada"),
        ("connectors", "0003_autorizacion_y_revocacion"),
    ]
    operations = [
        migrations.AlterField(
            model_name="cuentaconectada", name="revocado_en",
            field=models.DateTimeField(
                blank=True, null=True,
                verbose_name="Revocación confirmada por el proveedor",
                help_text=(
                    "Se llena SOLO cuando el proveedor confirmó la revocación. "
                    "Que no haya tokens guardados no demuestra que el acceso se "
                    "haya revocado del otro lado: el token pudo seguir vivo hasta "
                    "vencer. La limpieza coordinada de #72 exige este dato."
                ),
            ),
        ),
    ]
