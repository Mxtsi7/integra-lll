"""Publica al broker las alertas pendientes de entrega (FE-24).

    python manage.py publicar_alertas            # un pase y termina
    python manage.py publicar_alertas --seguir   # un pase cada 10 s

Es el despachador del outbox: lee `AlertaPorEntregar` sin `publicado_en` y
manda cada una como `alerta.activada.v2`. Un pase corre junto al generador
(`generar_alertas`) en el cron; `--seguir` es para desarrollo, para ver las
entregas salir sin esperar al cron.

── Por qué un proceso aparte y no publicar al crear la alerta ──────────────
Si el generador publicara dentro de su transacción y el commit después
fallara, el evento ya estaría afuera anunciando una alerta que no existe. Y si
publicara justo después del commit, un corte entre las dos cosas perdería el
evento sin dejar rastro. Con el outbox la fila queda escrita con la alerta y
publicar es un paso reintentable: el peor caso es que salga dos veces con el
mismo `id`, y el inbox del consumidor lo descarta.

── No se rinde solo ────────────────────────────────────────────────────────
No hay límite de intentos. Una entrega que falla queda con `intentos` y
`ultimo_error` y vuelve a aparecer en el próximo pase, que es información y no
un problema escondido. Cuando haga falta un tope, el lugar es
`publicador.publicar_pendientes`.
"""

import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from events.publicador import publicar_pendientes

#: Cada cuánto vuelve a mirar con `--seguir`. Corto porque una entrega que ya
#: venció no gana nada esperando, y largo para no castigar al broker con una
#: conexión por segundo cuando no hay nada.
PAUSA = 10


class Command(BaseCommand):
    help = "Publica las alertas pendientes de entrega como `alerta.activada.v2`."

    def add_arguments(self, parser):
        parser.add_argument(
            "--seguir",
            action="store_true",
            help=f"No termina: repite el pase cada {PAUSA} s.",
        )
        parser.add_argument(
            "--limite",
            type=int,
            default=None,
            help="Cuántas entregas publicar por pase.",
        )

    def handle(self, *args, **opciones):
        while True:
            close_old_connections()
            extra = {} if opciones["limite"] is None else {"limite": opciones["limite"]}
            resumen = publicar_pendientes(**extra)
            if resumen["pendientes"]:
                estilo = (
                    self.style.WARNING if resumen["fallidas"] else self.style.SUCCESS
                )
                self.stdout.write(
                    estilo(
                        f"publicadas {resumen['publicadas']} de "
                        f"{resumen['pendientes']}; fallidas {resumen['fallidas']}"
                    )
                )
            elif not opciones["seguir"]:
                self.stdout.write("no hay entregas pendientes")

            if not opciones["seguir"]:
                return
            time.sleep(PAUSA)
