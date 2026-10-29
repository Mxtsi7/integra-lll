from django.db import migrations, models
from connectors.migraciones import AgregarCampoSiAusente


class Migration(migrations.Migration):
    dependencies = [("connectors", "0001_initial")]
    operations = [
        AgregarCampoSiAusente(
            model_name="cuentaconectada", name="revocado_en",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
