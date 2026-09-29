"""Deja un usuario de demostración con credenciales conocidas.

Es idempotente: correrlo dos veces no duplica al usuario ni le cambia la
clave. Las credenciales salen del entorno (SEED_CORREO, SEED_CLAVE,
SEED_NOMBRE) o, si no están, de los valores de ejemplo de abajo, que son
de desarrollo y no se usan en producción: el entrypoint solo llama a este
comando cuando SEED_DEMO=1.

La clave se guarda hasheada porque pasa por create_user(); nunca se
escribe en texto plano dentro de un get_or_create.
"""

import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from app.models import Organizacion, User

CORREO_POR_DEFECTO = "demo@ojoalgasto.cl"
CLAVE_POR_DEFECTO = "Demo-2026-ojo"
NOMBRE_POR_DEFECTO = "Usuario Demo"


class Command(BaseCommand):
    help = "Crea, una sola vez, el usuario de demostración para desarrollo"

    def add_arguments(self, parser):
        parser.add_argument(
            "--correo",
            default=os.environ.get("SEED_CORREO", CORREO_POR_DEFECTO),
        )
        parser.add_argument(
            "--clave",
            default=os.environ.get("SEED_CLAVE", CLAVE_POR_DEFECTO),
        )
        parser.add_argument(
            "--nombre",
            default=os.environ.get("SEED_NOMBRE", NOMBRE_POR_DEFECTO),
        )

    def handle(self, *args, correo, clave, nombre, **opciones):
        correo = User.objects.normalize_email(correo)

        if User.objects.filter(email__iexact=correo).exists():
            self.stdout.write(f"seed: {correo} ya existía, no se toca")
            return

        # Con su propia organización, igual que cualquiera que se registre por
        # la web. Sin esto el token sale sin `organizacion_id`, el gateway no
        # inyecta la cabecera y `subscriptions` responde 403: el usuario de
        # demostración serviría para entrar y para nada más.
        with transaction.atomic():
            organizacion = Organizacion.objects.create(nombre=f"Hogar de {nombre}")
            User.objects.create_user(
                email=correo,
                password=clave,
                nombre=nombre,
                consentimiento_en=timezone.now(),
                organizacion=organizacion,
                rol=User.Rol.TITULAR,
            )
        self.stdout.write(
            self.style.SUCCESS(f"seed: usuario {correo} creado, titular de «{organizacion.nombre}»")
        )
