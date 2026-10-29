"""Señales del dominio de suscripciones.

La detección de anomalías de VI-19 se dispara al registrar un cobro, sin
importar si vino de una carga manual, una importación CSV/PDF o un comando.
La lógica vive en ``app.anomalias`` para poder invocarla también de forma
explícita (por ejemplo, al reprocesar un lote histórico).
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from app.models import Cobro


@receiver(
    post_save,
    sender=Cobro,
    dispatch_uid="subscriptions.detectar_anomalias_al_crear_cobro",
)
def detectar_anomalias_al_crear_cobro(sender, instance: Cobro, created: bool, raw: bool = False, **kwargs) -> None:
    if not created or raw:
        return

    # Import local: evita cargar el módulo de reglas durante la carga de la
    # app y mantiene el grafo de imports de modelos libre de dependencias.
    from app.anomalias import detectar_anomalias_cobro

    detectar_anomalias_cobro(instance)
