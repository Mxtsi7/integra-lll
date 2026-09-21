from django.db.models.signals import pre_migrate


def crear_esquema_del_servicio(sender, using, **kwargs):
    from django.conf import settings
    from django.db import connections

    with connections[using].cursor() as cursor:
        cursor.execute(
            f'CREATE SCHEMA IF NOT EXISTS "{settings.ESQUEMA_BD}"'
        )


pre_migrate.connect(
    crear_esquema_del_servicio,
    dispatch_uid="crear-esquema-del-servicio",
)
