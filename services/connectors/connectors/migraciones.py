"""Compatibilidad del campo compartido por las ramas MX-07 y FE-05."""

from django.core.exceptions import FieldDoesNotExist
from django.db import migrations


class AgregarCampoSiAusente(migrations.AddField):
    """Conserva la columna y sus datos si otra rama ya la creó."""

    def _existe(self, schema_editor, model):
        with schema_editor.connection.cursor() as cursor:
            columnas = schema_editor.connection.introspection.get_table_description(
                cursor, model._meta.db_table,
            )
        return model._meta.get_field(self.name).column in {col.name for col in columnas}

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if self.allow_migrate_model(schema_editor.connection.alias, model) and not self._existe(schema_editor, model):
            super().database_forwards(app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        anterior = to_state.apps.get_model(app_label, self.model_name)
        try:
            anterior._meta.get_field(self.name)
        except FieldDoesNotExist:
            model = from_state.apps.get_model(app_label, self.model_name)
            if self.allow_migrate_model(schema_editor.connection.alias, model) and self._existe(schema_editor, model):
                super().database_backwards(app_label, schema_editor, from_state, to_state)
