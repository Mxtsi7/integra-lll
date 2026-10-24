from django.db import migrations


def sembrar(apps, schema_editor):
    Plan = apps.get_model("app", "Plan")
    for codigo, nombre, precio in [("free", "Gratuito", "0.00"), ("premium", "Premium", "4990.00")]:
        Plan.objects.using(schema_editor.connection.alias).get_or_create(codigo=codigo, defaults={
            "nombre": nombre, "precio": precio, "moneda": "CLP", "periodo": "mensual", "precio_demo": True,
        })


class Migration(migrations.Migration):
    dependencies = [("app", "0009_planes_contratacion")]
    operations = [migrations.RunPython(sembrar, migrations.RunPython.noop)]
