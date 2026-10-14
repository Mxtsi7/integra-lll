"""
Cifrado en reposo de secretos (FE-06, RN-SEG-001).

Para guardar tokens OAuth de los conectores (y cualquier otro secreto) sin
que queden legibles en la base. Lo usa cualquier servicio: se monta como
``shared/`` igual que ``shared/tenant``.

Uso típico en un modelo::

    from shared.cifrado import CampoCifrado

    class CuentaConectada(ModeloTenant):
        access_token = CampoCifrado(null=True, blank=True)

En el serializer no hay que hacer nada: importar este paquete registra
``CampoCifrado`` en el mapeo de ``ModelSerializer``, así que el token entra
pero nunca sale, incluso con ``fields = "__all__"``. Declararlo sirve solo
para afinarlo::

    from shared.cifrado import CampoSecretoSerializer

    class CuentaConectadaSerializer(serializers.ModelSerializer):
        access_token = CampoSecretoSerializer(required=False)

Las claves viven en la variable de entorno ``CLAVES_CIFRADO`` (ver README.md
de esta carpeta). Requiere el paquete ``cryptography``.
"""

from .campos import SECRETO_ILEGIBLE, CampoCifrado, SecretoIlegible, TextoDescifrado
from .cifrador import (
    VARIABLE_DE_ENTORNO,
    Cifrador,
    CifradoNoConfigurado,
    ClaveDeCifradoInvalida,
    ErrorDeCifrado,
    generar_clave,
    obtener_cifrador,
    redactar,
    reiniciar_cifrador,
)
from .rotacion import rotar_claves
from .serializers import CampoSecretoSerializer

__all__ = [
    "VARIABLE_DE_ENTORNO",
    "CampoCifrado",
    "CampoSecretoSerializer",
    "Cifrador",
    "CifradoNoConfigurado",
    "ClaveDeCifradoInvalida",
    "ErrorDeCifrado",
    "SECRETO_ILEGIBLE",
    "SecretoIlegible",
    "TextoDescifrado",
    "generar_clave",
    "obtener_cifrador",
    "redactar",
    "reiniciar_cifrador",
    "rotar_claves",
]
