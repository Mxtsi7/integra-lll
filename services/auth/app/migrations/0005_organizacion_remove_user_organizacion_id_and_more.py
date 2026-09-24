from django.db import migrations, models
import django.db.models.deletion
import uuid   # si hace falta


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0003_user_estado_consistente'),   # o la que realmente sea la anterior
        # puede aparecer también dependencia de 'auth' si Django la puso
    ]

    operations = [
        migrations.CreateModel(
            name='Organizacion',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('creado_en', models.DateTimeField(auto_now_add=True)),
                ('actualizado_en', models.DateTimeField(auto_now=True)),
                ('nombre', models.CharField(max_length=100)),
            ],
            options={
                'verbose_name': 'Organización',
                'verbose_name_plural': 'Organizaciones',
                'db_table': 'organizacion',
                'ordering': ['-creado_en'],
            },
        ),
        # NO hay RemoveField de organizacion_id
        migrations.AddField(
            model_name='user',
            name='organizacion',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='usuarios',
                to='app.organizacion',
            ),
        ),
    ]