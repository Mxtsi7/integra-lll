from app.models import Pais
from shared.catalogos.comando import ComandoCatalogo


class Command(ComandoCatalogo):
    modelos = {"paises": Pais}
    migracion_inicial = "app.migrations.0006_catalogo_paises"
