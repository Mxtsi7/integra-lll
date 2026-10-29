"""MX-27: escenarios ficticios aislados, reproducibles e idempotentes."""
import json
from datetime import date, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from app.models import Subscription


def identificador(clave):
    return uuid5(NAMESPACE_URL, f"https://integra.example/demo/mx27/v1/{clave}")


def meses_anteriores(fecha):
    primero = fecha.replace(day=1)
    anterior = (primero - timedelta(days=1)).replace(day=1)
    return [(anterior - timedelta(days=1)).replace(day=1), anterior, primero]


class Command(BaseCommand):
    help = "Carga uso ficticio en dos tenants demo; devuelve sus UUID y escenarios como JSON."

    def add_arguments(self, parser):
        parser.add_argument("--fecha-ref", required=True, help="Corte reproducible YYYY-MM-DD (año >= 2000).")

    @transaction.atomic
    def handle(self, *args, fecha_ref, **options):
        try:
            corte = date.fromisoformat(fecha_ref)
            if corte.year < 2000 or corte.year > 9998:
                raise ValueError
        except (ValueError, TypeError) as exc:
            raise CommandError("--fecha-ref debe ser YYYY-MM-DD, entre los años 2000 y 9998.") from exc

        resultado = {"version": 1, "fecha_ref": corte.isoformat(), "organizaciones": []}
        for tenant in ("a", "b"):
            org = identificador(f"{corte}/organizacion/{tenant}")
            escenarios = {}
            for escenario in ("alto", "bajo", "sin_uso", "reciente"):
                sid = identificador(f"{corte}/{tenant}/{escenario}")
                suscripcion, creada = Subscription.objects.get_or_create(
                    id=sid,
                    defaults={
                        "organizacion_id": org,
                        "nombre": f"Demo MX-27 {escenario}",
                        "monto": Decimal("9000.00"),
                        "moneda": "CLP",
                        "frecuencia": Subscription.Frecuencia.MENSUAL,
                        "fecha_proximo_cobro": corte + timedelta(days=7),
                        "categoria": "streaming",
                        "estado": Subscription.Estado.ACTIVO,
                    },
                )
                # Serializa dos ejecuciones concurrentes sobre el mismo dataset.
                suscripcion = Subscription.objects.select_for_update().get(pk=sid)
                if (suscripcion.organizacion_id != org or
                        suscripcion.nombre != f"Demo MX-27 {escenario}" or not suscripcion.activo):
                    raise CommandError("El identificador demo está ocupado o fue desactivado; no se modifica.")
                registros = []
                if escenario == "alto":
                    for mes in meses_anteriores(corte):
                        registros.extend((mes + timedelta(days=d), 120) for d in range(min(10, (corte-mes).days+1)))
                elif escenario == "bajo":
                    registros = [(mes, 5) for mes in meses_anteriores(corte)]
                elif escenario == "reciente":
                    registros = [(corte, 45)]
                for fecha, minutos in registros:
                    existentes = suscripcion.usos.filter(fecha=fecha)
                    if existentes.exists():
                        if existentes.count() != 1 or existentes.get().minutos != minutos:
                            raise CommandError("El uso demo fue modificado; se revierte la carga para no sobrescribirlo.")
                        continue
                    suscripcion.registrar_uso(minutos, fecha=fecha, actor_rol="sistema")
                escenarios[escenario] = {"suscripcion_id": str(sid), "registros_esperados": len(registros)}
            resultado["organizaciones"].append({"organizacion_id": str(org), "escenarios": escenarios})
        self.stdout.write(json.dumps(resultado, ensure_ascii=False, sort_keys=True))
