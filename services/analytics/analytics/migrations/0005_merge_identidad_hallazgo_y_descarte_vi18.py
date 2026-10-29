# Une las hojas de migraciones de Analytics al integrar #105 con VI-18.
# Se conserva 0004_identidad_hallazgo_recomendacion tal como se publicó en #105
# y 0004_recomendaciondescartada_vi18 tal como se publicó en VI-18.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('analytics', '0004_identidad_hallazgo_recomendacion'),
        ('analytics', '0004_recomendaciondescartada_vi18'),
    ]

    operations = []
