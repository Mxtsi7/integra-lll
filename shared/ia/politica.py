"""Política común de IA (VI-24).

Un solo lugar para el timeout y las cuotas que comparten el servicio que
llama al proveedor y el cliente que consume el endpoint del asistente. Si
estos números se cambian acá, cambian en los dos lados; no se puede subir el
timeout desde el cliente para saltarse el límite del servidor.
"""

# RN-24: el proveedor no puede tardar más que esto.
TIMEOUT_MAXIMO_SEGUNDOS = 3.5
# RN-25: tres intentos del mismo PDF por día y usuario.
MAX_INTENTOS_PDF_DIA = 3
# RNF-20: control inicial de costo por usuario y mes.
MAX_LLAMADAS_MES = 200
# Límite operativo de llamadas simultáneas por proceso.
MAX_LLAMADAS_SIMULTANEAS = 4


class ProveedorNoConfigurado(Exception):
    """No hay credencial o SDK del proveedor: se degrada, no se rompe."""


class LimiteIAExcedido(Exception):
    """El pedido supera un límite de la política (timeout o cuota)."""


def validar_timeout(valor: float) -> float:
    """Devuelve el timeout si respeta el máximo; si no, ValueError."""
    if not isinstance(valor, (int, float)) or valor <= 0 or valor > TIMEOUT_MAXIMO_SEGUNDOS:
        raise ValueError(
            f"El timeout debe ser mayor que 0 y no superar {TIMEOUT_MAXIMO_SEGUNDOS} s."
        )
    return float(valor)
