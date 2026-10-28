"""Reintenta las revocaciones que el proveedor nunca confirmó (FE-05).

    python manage.py reintentar_revocaciones            # en seco
    python manage.py reintentar_revocaciones --aplicar

Las cuentas que se desconectaron sin que el proveedor confirmara conservan su
token cifrado justamente para esto. Sin este comando, "pendiente" sería un
estado del que no se sale nunca.

── Por qué corre en seco por omisión ────────────────────────────────────────
Habla con un servicio externo y borra credenciales cuando le contestan que sí.
Que el modo por omisión sea mirar y no tocar es lo mismo que hace
`rotar-clave-postgres.sh`, por la misma razón.

── Qué NO hace ──────────────────────────────────────────────────────────────
No reintenta para siempre ni se rinde solo: no hay contador de intentos. Si
un proveedor nunca confirma, la cuenta se queda en la lista y aparece en cada
corrida, que es información y no un problema escondido. Cuando haga falta un
límite, el lugar es `revocacion.pendientes_de_revocar`.
"""

from django.core.management.base import BaseCommand

from connectors.models import CuentaConectada
from connectors.revocacion import pendientes_de_revocar, revocar_y_desconectar


class Command(BaseCommand):
    help = "Reintenta revocar en el proveedor las cuentas desconectadas sin confirmar."

    def add_arguments(self, parser):
        parser.add_argument(
            "--aplicar",
            action="store_true",
            help="Sin esto solo muestra qué haría.",
        )
        parser.add_argument(
            "--organizacion",
            default=None,
            help="Limitar a una organización (UUID).",
        )

    def handle(self, *args, **opciones):
        pendientes = list(pendientes_de_revocar(opciones["organizacion"]))
        if not pendientes:
            self.stdout.write("No hay revocaciones pendientes.")
            return

        self.stdout.write(f"{len(pendientes)} cuenta(s) con revocación pendiente:")
        for cuenta in pendientes:
            self.stdout.write(f"  · {cuenta.proveedor}: {cuenta.cuenta_externa}")

        if not opciones["aplicar"]:
            self.stdout.write(
                self.style.WARNING("Modo ensayo. Para reintentar de verdad: --aplicar")
            )
            return

        confirmadas = 0
        for pendiente in pendientes:
            # ── Se vuelve a leer antes de cada intento ──────────────────────
            # La lista se materializó al principio y puede quedar vieja: basta
            # con que alguien reconecte una cuenta en el intervalo. Releerla
            # hace que `revocar_y_desconectar` vea la versión actual de las
            # credenciales y su escritura condicional funcione.
            cuenta = CuentaConectada.objects.filter(pk=pendiente.pk).first()
            if cuenta is None or cuenta.revocado_en is not None:
                self.stdout.write(f"  ya no aplica: {pendiente.cuenta_externa}")
                continue

            resultado = revocar_y_desconectar(cuenta)
            if resultado.confirmada:
                confirmadas += 1
                self.stdout.write(
                    self.style.SUCCESS(f"  confirmada: {cuenta.cuenta_externa}")
                )
            elif resultado.reconectada_mientras_tanto:
                self.stdout.write(
                    f"  se reconectó mientras tanto, no se tocó: {cuenta.cuenta_externa}"
                )
            elif resultado.ilegible:
                self.stdout.write(
                    f"  credenciales ilegibles (¿falta la clave?): {cuenta.cuenta_externa}"
                )
            else:
                self.stdout.write(f"  sigue pendiente: {cuenta.cuenta_externa}")

        self.stdout.write(
            f"Confirmadas {confirmadas} de {len(pendientes)}; "
            f"las demás conservan su token para el próximo intento."
        )
