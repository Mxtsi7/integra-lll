"""Lee una página de una cuenta de Gmail conectada (S3-FE-02).

    python manage.py leer_gmail --organizacion <uuid> --cuenta <id>
    python manage.py leer_gmail --organizacion <uuid> --cuenta <id> --limite 5 --desde 2026-10-01
    python manage.py leer_gmail ... --pagina <siguiente_pagina de la corrida anterior>

Sirve para comprobar la lectura contra una cuenta de prueba real sin esperar
a que exista la tarea programada (S3-FE-03). No guarda nada.

── Qué muestra y qué no ────────────────────────────────────────────────────
De cada mensaje: identificador, fecha de recepción, remitente, asunto y el
LARGO del texto. El texto no se imprime: la salida de este comando termina
pegada en una PR o en una captura, y el cuerpo de un correo no tiene por qué
estar ahí.
"""

from datetime import datetime, timezone as tz

from django.core.management.base import BaseCommand, CommandError

from connectors import lector_gmail
from connectors.lectura_correo import LIMITE_POR_DEFECTO, ErrorDeLectura, FiltroCorreos
from connectors.renovacion import leer_con_renovacion


def _fecha(texto: str) -> datetime:
    try:
        return datetime.strptime(texto, "%Y-%m-%d").replace(tzinfo=tz.utc)
    except ValueError:
        raise CommandError(f"fecha no válida, se espera AAAA-MM-DD: {texto!r}") from None


class Command(BaseCommand):
    help = "Lee una página de mensajes de una cuenta de Gmail conectada, sin guardar nada."

    #: El comando de Outlook (S3-FE-04) es este mismo con otro lector.
    lector = lector_gmail

    def add_arguments(self, parser):
        parser.add_argument("--organizacion", required=True, help="UUID de la organización dueña de la cuenta.")
        parser.add_argument("--cuenta", required=True, help="UUID de la cuenta conectada.")
        parser.add_argument("--limite", type=int, default=LIMITE_POR_DEFECTO)
        parser.add_argument("--pagina", default=None, help="El `siguiente_pagina` de una corrida anterior.")
        parser.add_argument("--desde", type=_fecha, default=None, help="AAAA-MM-DD, en UTC.")
        parser.add_argument("--hasta", type=_fecha, default=None, help="AAAA-MM-DD, en UTC, exclusivo.")
        parser.add_argument("--todos", action="store_true",
                            help="No filtrar por palabras de cobro (por omisión sí se filtra).")

    def handle(self, *args, **opciones):
        filtro = FiltroCorreos(desde=opciones["desde"], hasta=opciones["hasta"], solo_cobros=not opciones["todos"])
        try:
            # Con renovación (S3-FE-19): una cuenta conectada hace más de una
            # hora tiene el token de acceso vencido.
            pagina = leer_con_renovacion(
                self.lector,
                organizacion_id=opciones["organizacion"],
                cuenta_id=opciones["cuenta"],
                filtro=filtro,
                pagina=opciones["pagina"],
                limite=opciones["limite"],
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        except ErrorDeLectura as exc:
            raise CommandError(f"[{exc.codigo}] {exc}") from None

        for mensaje in pagina.mensajes:
            self.stdout.write(
                f"{mensaje.id_mensaje}  {mensaje.recibido_en:%Y-%m-%d %H:%M}Z  "
                f"{mensaje.remitente[:50]:50}  {mensaje.asunto[:60]:60}  "
                f"{len(mensaje.texto)} car.{' (cortado)' if mensaje.texto_truncado else ''}"
            )
        for omitido in pagina.omitidos:
            self.stdout.write(f"omitido {omitido.id_mensaje}: {omitido.motivo}")
        self.stdout.write(
            f"{len(pagina.mensajes)} mensajes, {len(pagina.omitidos)} omitidos. "
            f"Siguiente página: {pagina.siguiente_pagina or '(no hay)'}"
        )
