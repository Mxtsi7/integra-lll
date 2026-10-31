"""Un lock de PostgreSQL sobre una CLAVE, no sobre una fila.

── Para qué ────────────────────────────────────────────────────────────────
Para el patrón "leer un agregado y escribirlo": `SUM(...)` y después
`update_or_create(...)`. Envolverlo en un `atomic()` agrupa las escrituras
pero **no serializa la lectura**. Con el nivel de aislamiento habitual de
PostgreSQL (read committed) dos recálculos se intercalan así:

    A: SUM = 100
    B: inserta 20, recalcula, guarda 120
    A: guarda sus 100, que ya estaban viejos

y queda la fuente en 120 con el agregado en 100. Lo encontraron dos
revisiones de PR, en dos servicios distintos, por separado: pasó en el
resumen por moneda de Subscriptions y en el uso mensual de Analytics.

El lock se toma **antes** del SUM, así que el segundo recálculo espera y
vuelve a leer la fuente ya completa.

── Por qué advisory y no `select_for_update` ───────────────────────────────
La fila del agregado puede no existir todavía: la primera vez no hay nada que
bloquear, y bloquear la fila después del SUM no resuelve la carrera. El
advisory lock es sobre una CLAVE, exista la fila o no.

Es de transacción (`_xact_`), así que se suelta solo al terminar; por eso
estas funciones exigen estar dentro de un `atomic()` y lo comprueban en vez
de dar una falsa sensación de protección.

── En SQLite no hace nada ──────────────────────────────────────────────────
Y no hace falta: serializa las escrituras de por sí. Pero significa que **la
carrera no la cubre una suite que corra en SQLite**; hay que verificarla
contra PostgreSQL. Las pruebas que miran `pg_locks` se saltan solas cuando el
motor no es Postgres.

── Espacios ────────────────────────────────────────────────────────────────
El primer entero del lock identifica a qué "familia" pertenece la clave, para
que dos usos distintos no choquen por casualidad. Cada servicio declara el
suyo en `ESPACIOS`; agregar uno nuevo es agregar una línea acá, y así se ve
de una vez quién usa qué.
"""

from __future__ import annotations

import hashlib

from django.db import connection, transaction


#: Familias de locks. El número no significa nada por sí solo; lo único que
#: importa es que sean distintos entre sí.
ESPACIOS = {
    "uso_mensual": 28,        # analytics · FE-28, por (tenant, suscripción, mes)
    "resumen_organizacion": 29,  # subscriptions · por organización
    "cobertura_uso": 30,      # analytics · FE-29, por (tenant, suscripción)
    "cuota_importacion": 31,  # connectors · FE-07, por organización
}


def _clave_estable(partes: tuple) -> int:
    """Un int4 derivado de las partes, igual en cualquier proceso.

    Con el `hash()` de Python no sirve: cambia entre procesos por
    PYTHONHASHSEED, así que dos workers tomarían llaves distintas para la
    misma clave y el lock no serializaría nada.
    """
    semilla = "|".join(str(p) for p in partes).encode()
    return int.from_bytes(hashlib.sha256(semilla).digest()[:4], "big") - 2**31


def bloquear(espacio: str, *partes) -> None:
    """Toma el lock de `partes` dentro del espacio dado. Exige un atomic().

    No hace nada fuera de PostgreSQL. Lanza si no hay transacción: un
    `pg_advisory_xact_lock` sin transacción se suelta al instante y no
    protege nada, así que es mejor reventar.
    """
    if espacio not in ESPACIOS:
        raise KeyError(
            f"espacio de locks desconocido: {espacio!r}. "
            f"Declaralo en shared/bloqueo.ESPACIOS: {sorted(ESPACIOS)}"
        )
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "el lock es de transacción: hay que llamarlo dentro de un "
            "atomic() o no protege nada"
        )
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s, %s)",
            [ESPACIOS[espacio], _clave_estable(partes)],
        )
