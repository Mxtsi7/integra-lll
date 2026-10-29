"""La validación del contrato, que ahora vive en `shared/events/validacion.py`.

Se movió al compartido cuando Notifications empezó a consumir (FE-24): la
validación la hacen los dos lados y el contrato es uno. La versión anterior
buscaba el esquema subiendo carpetas desde este archivo; la compartida lo
tiene al lado y lo resuelve contra `__file__`, que es más corto y no depende
de dónde quedó la raíz del repo.

Este archivo se conserva para no tocar los imports del servicio, que dicen
`from events.validacion import errores`. Solo reexporta.
"""

from shared.events.validacion import errores, validador


__all__ = ["errores", "validador"]
