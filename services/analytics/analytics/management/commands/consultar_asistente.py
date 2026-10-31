"""VI-24: cliente de línea de comandos del asistente.

Llama al endpoint de Analytics a través del gateway, con el mismo wrapper que
usa cualquier app. No habla con Anthropic ni conoce su API key: si el backend
no está, devuelve un error controlado y un código de salida distinto de cero.

Ejemplos:

    python manage.py consultar_asistente --token "$ACCESS" \
        --url http://localhost:8000/api --mensaje "¿Qué reviso primero?"

    ASISTENTE_TOKEN=... python manage.py consultar_asistente
"""

import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from shared.ia.cliente import ClienteAsistente, ErrorAsistente
from shared.ia.politica import TIMEOUT_MAXIMO_SEGUNDOS


class Command(BaseCommand):
    help = "Consulta el asistente financiero (endpoint de Analytics vía gateway)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--url",
            default=getattr(settings, "ASISTENTE_URL", "http://localhost:8000/api"),
            help="URL pública del gateway, sin /asistente/ (default: ASISTENTE_URL).",
        )
        parser.add_argument(
            "--token",
            default=os.environ.get("ASISTENTE_TOKEN", ""),
            help="Access token del usuario Premium (default: ASISTENTE_TOKEN).",
        )
        parser.add_argument(
            "--mensaje",
            default="",
            help="Pregunta para el asistente (opcional).",
        )
        parser.add_argument(
            "--timeout",
            type=float,
            default=TIMEOUT_MAXIMO_SEGUNDOS,
            help=f"Timeout en segundos (máx. {TIMEOUT_MAXIMO_SEGUNDOS}).",
        )

    def handle(self, *args, **options):
        if not options["token"]:
            raise CommandError(
                "Falta el access token: usa --token o la variable ASISTENTE_TOKEN."
            )

        try:
            cliente = ClienteAsistente(
                options["url"],
                options["token"],
                timeout=options["timeout"],
            )
            resultado = cliente.consultar(options["mensaje"])
        except (ValueError, ErrorAsistente) as exc:
            codigo = getattr(exc, "codigo", "configuracion")
            raise CommandError(f"[{codigo}] {exc}") from exc

        self.stdout.write(f"estado: {resultado['estado']}")
        if resultado.get("motivo"):
            self.stdout.write(f"motivo: {resultado['motivo']}")
        self.stdout.write(resultado.get("respuesta", ""))
