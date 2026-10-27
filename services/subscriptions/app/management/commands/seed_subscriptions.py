"""Crea suscripciones de ejemplo para una organización de demostración."""

import os
import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from app.models import Subscription


class Command(BaseCommand):
    help = "Crea cinco suscripciones de ejemplo para una organización"

    def add_arguments(self, parser):
        parser.add_argument(
            "--organizacion-id",
            default=os.environ.get("SEED_ORGANIZACION_ID"),
            help="UUID de la organización demo (o define SEED_ORGANIZACION_ID)",
        )

    def handle(self, *args, organizacion_id=None, **options):
        if not organizacion_id:
            raise CommandError(
                "Indica --organizacion-id o define SEED_ORGANIZACION_ID."
            )

        try:
            organizacion_id = uuid.UUID(str(organizacion_id))
        except (TypeError, ValueError) as error:
            raise CommandError(
                f"UUID de organización inválido: {organizacion_id}"
            ) from error

        hoy = timezone.localdate()
        ejemplos = (
            {
                "nombre": "Netflix",
                "monto": Decimal("8990.00"),
                "moneda": 'CLP',
                "frecuencia": Subscription.Frecuencia.MENSUAL,
                "fecha_proximo_cobro": hoy + timedelta(days=2),
                "categoria": 'streaming',
                "estado": Subscription.Estado.ACTIVO,
            },
            {
                "nombre": "Spotify",
                "monto": Decimal("4990.00"),
                "moneda": 'CLP',
                "frecuencia": Subscription.Frecuencia.MENSUAL,
                "fecha_proximo_cobro": hoy + timedelta(days=7),
                "categoria": 'musica',
                "estado": Subscription.Estado.ACTIVO,
            },
            {
                "nombre": "HBO Max",
                "monto": Decimal("9.99"),
                "moneda": 'USD',
                "frecuencia": Subscription.Frecuencia.MENSUAL,
                "fecha_proximo_cobro": hoy + timedelta(days=12),
                "categoria": 'streaming',
                "estado": Subscription.Estado.PRUEBA,
                "fin_prueba": hoy + timedelta(days=5),
            },
            {
                "nombre": "iCloud",
                "monto": Decimal("2990.00"),
                "moneda": 'CLP',
                "frecuencia": Subscription.Frecuencia.MENSUAL,
                "fecha_proximo_cobro": hoy + timedelta(days=18),
                "categoria": 'nube',
                "estado": Subscription.Estado.POR_CONFIRMAR,
            },
            {
                "nombre": "Gimnasio",
                "monto": Decimal("24990.00"),
                "moneda": 'CLP',
                "frecuencia": Subscription.Frecuencia.MENSUAL,
                "fecha_proximo_cobro": hoy + timedelta(days=24),
                "categoria": 'salud',
                "estado": Subscription.Estado.CANCELADO,
            },
        )

        creadas = 0
        with transaction.atomic():
            for ejemplo in ejemplos:
                _, creada = Subscription.objects.get_or_create(
                    organizacion_id=organizacion_id,
                    nombre=ejemplo["nombre"],
                    defaults=ejemplo,
                )
                creadas += int(creada)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seed de suscripciones: {creadas} creadas, "
                f"{len(ejemplos) - creadas} ya existentes para {organizacion_id}."
            )
        )
