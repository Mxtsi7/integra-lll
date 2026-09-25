import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app", "0004_alter_user_managers_alter_user_groups_and_more"),
    ]

    operations = [
        # 1. Crear la tabla Organizacion
        migrations.CreateModel(
            name="Organizacion",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("creado_en", models.DateTimeField(auto_now_add=True)),
                ("actualizado_en", models.DateTimeField(auto_now=True)),
                ("nombre", models.CharField(max_length=100)),
            ],
            options={
                "verbose_name": "Organización",
                "verbose_name_plural": "Organizaciones",
                "db_table": "organizacion",
                "ordering": ["-creado_en"],
            },
        ),
        # 2. Actualizar el estado de Django:
        #    - quitar el UUIDField suelto "organizacion_id"
        #    - agregar el ForeignKey "organizacion"
        #    Sin tocar la columna física (ya existe y se llama igual).
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(
                    model_name="user",
                    name="organizacion_id",
                ),
                migrations.AddField(
                    model_name="user",
                    name="organizacion",
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="usuarios",
                        to="app.organizacion",
                    ),
                ),
            ],
            database_operations=[
                # Solo agregamos la restricción de clave foránea.
                # La columna organizacion_id ya existe; no la borramos ni la recreamos.
                migrations.RunSQL(
                    sql="""
                        ALTER TABLE app_user
                        ADD CONSTRAINT app_user_organizacion_id_fk
                        FOREIGN KEY (organizacion_id)
                        REFERENCES organizacion (id)
                        DEFERRABLE INITIALLY DEFERRED;
                    """,
                    reverse_sql="""
                        ALTER TABLE app_user
                        DROP CONSTRAINT IF EXISTS app_user_organizacion_id_fk;
                    """,
                ),
            ],
        ),
    ]