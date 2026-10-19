"""
Rotación de claves: re-cifrar con la clave vigente lo que se cifró con una
clave anterior.

Procedimiento completo (ver README.md):

1. Generar una clave nueva y ponerla **primera** en ``CLAVES_CIFRADO``,
   dejando la vieja después: ``CLAVES_CIFRADO=nueva,vieja``.
2. Redesplegar. Desde ahora todo lo nuevo se cifra con ``nueva``; lo viejo
   sigue legible porque ``vieja`` todavía está en la lista.
3. Correr ``rotar_claves(Modelo.objects.all(), ["access_token", ...])``.
4. Quitar ``vieja`` de la variable y redesplegar.

Si se quita la clave vieja antes del paso 3, las filas viejas quedan
``SECRETO_ILEGIBLE`` y hay que pedir a esas cuentas que reautoricen.
"""

from __future__ import annotations

from .campos import SecretoIlegible


def rotar_claves(queryset, campos, tamano_lote: int = 200) -> dict:
    """Re-cifra, con la primera clave de ``CLAVES_CIFRADO``, las filas de
    ``queryset`` cuyos ``campos`` se cifraron con una clave anterior.

    No toca las filas que ya están con la clave vigente ni las que son
    ilegibles (esas se cuentan y se informan, no se sobrescriben).

    Devuelve ``{"revisadas": n, "rotadas": n, "ilegibles": n}``.
    """
    campos = list(campos)
    revisadas = rotadas = ilegibles = 0

    for objeto in queryset.iterator(chunk_size=tamano_lote):
        revisadas += 1
        pendientes = []
        tiene_ilegible = False

        for campo in campos:
            valor = getattr(objeto, campo)
            if valor is None:
                continue
            if isinstance(valor, SecretoIlegible):
                tiene_ilegible = True
                continue
            if not getattr(valor, "cifrado_con_clave_actual", False):
                pendientes.append(campo)

        if tiene_ilegible:
            ilegibles += 1
        if pendientes:
            # save() pasa por get_prep_value, que cifra con la clave vigente.
            objeto.save(update_fields=pendientes)
            rotadas += 1

    return {"revisadas": revisadas, "rotadas": rotadas, "ilegibles": ilegibles}
