import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("app", "0005_token_recuperacion_usado")]
    operations = [migrations.CreateModel(
        name="Sesion",
        fields=[
            ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ("refresh_jti", models.CharField(max_length=64)),
            ("vence_en", models.DateTimeField()),
            ("revocada", models.BooleanField(default=False)),
            ("usuario", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                         related_name="sesiones", to=settings.AUTH_USER_MODEL)),
        ],
        options={"db_table": "sesion"},
    )]
