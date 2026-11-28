"""Limpieza de conexiones que no rompe la transacción del llamador.

`django.db.close_old_connections()` cierra la conexión cuando `autocommit`
no coincide con `AUTOCOMMIT` o cuando la conexión quedó marcada como
defectuosa. En un consumidor largo eso es deseable, pero si quien llama tiene
una transacción abierta --los tests `django_db`, un `atomic()` del productor--
cerrarla deja a todos los que siguen usando esa misma conexión con un psycopg
en estado BAD.

Este helper solo cierra cuando NO hay un bloque atómico abierto. En el
consumidor real no lo hay: la conexión muerta o vieja se suelta igual.
"""

from django.db import connections


def close_old_connections():
    """Cierra conexiones obsoletas sin tocar una transacción en curso."""
    for conexion in connections.all():
        if not conexion.in_atomic_block:
            conexion.close_if_unusable_or_obsolete()
