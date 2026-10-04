from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0003_subscription_ultima_actividad'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='subscription',
            options={
                'ordering': ['-fecha_proximo_cobro', 'id'],
                'verbose_name': 'Suscripción',
                'verbose_name_plural': 'Suscripciones',
            },
        ),
    ]
