from django.db.models.signals import pre_migrate


def crear_esquema(sender, using, **kwargs):
    from django.conf import settings
    from django.db import connections
    conexion = connections[using]
    with conexion.cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS " + conexion.ops.quote_name(settings.ESQUEMA_BD))


pre_migrate.connect(crear_esquema, dispatch_uid="crear-esquema-analytics-pruebas")
