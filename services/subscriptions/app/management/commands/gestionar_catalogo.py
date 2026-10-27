from app.models import Moneda, CategoriaSuscripcion
from shared.catalogos.comando import ComandoCatalogo


class Command(ComandoCatalogo):
    modelos = {"monedas": Moneda, "categorias": CategoriaSuscripcion}
    migracion_inicial = "app.migrations.0007_catalogos"
