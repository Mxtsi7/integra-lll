# Une las migraciones independientes de presupuestos y outbox.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("app", "0008_presupuesto"),
        ("app", "0008_outboxevento"),
    ]

    operations = []
