from datetime import datetime

from django.db import migrations, models


def completar_instantes(apps, schema_editor):
    modelo_evento = apps.get_model('app', 'EventoUsoRecibido')
    alias = schema_editor.connection.alias
    for evento in modelo_evento.objects.using(alias).only('id', 'cuerpo').iterator(chunk_size=500):
        inicio = datetime.fromisoformat(evento.cuerpo['inicio'].replace('Z', '+00:00'))
        fin = datetime.fromisoformat(evento.cuerpo['fin'].replace('Z', '+00:00'))
        modelo_evento.objects.using(alias).filter(pk=evento.pk).update(inicio=inicio, fin=fin)


class Migration(migrations.Migration):
    dependencies = [('app', '0019_eventousorecibido_uso_rx_proyeccion_dia_idx')]

    operations = [
        migrations.AddField(
            model_name='eventousorecibido', name='inicio',
            field=models.DateTimeField(null=True),
        ),
        migrations.AddField(
            model_name='eventousorecibido', name='fin',
            field=models.DateTimeField(null=True),
        ),
        migrations.RunPython(completar_instantes, migrations.RunPython.noop),
        migrations.AlterField(model_name='eventousorecibido', name='inicio', field=models.DateTimeField()),
        migrations.AlterField(model_name='eventousorecibido', name='fin', field=models.DateTimeField()),
        migrations.AddIndex(
            model_name='eventousorecibido',
            index=models.Index(
                fields=['organizacion_id', 'usuario_id', 'suscripcion', 'fecha_local', 'recolector_id', 'inicio'],
                name='uso_rx_lectura_cobertura_idx',
            ),
        ),
    ]
