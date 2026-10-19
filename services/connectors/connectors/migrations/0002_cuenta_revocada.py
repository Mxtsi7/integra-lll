from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("connectors", "0001_initial")]
    operations = [
        migrations.AddField(
            model_name="cuentaconectada", name="revocado_en",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
