"""MX-24: límites reutilizables; no envía documentos ni llama a un proveedor por sí solo."""
import asyncio
from copy import deepcopy
from datetime import timedelta
import inspect
from math import isfinite
from threading import BoundedSemaphore
from uuid import UUID
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import DatabaseError, close_old_connections, transaction
from django.utils import timezone
from .models import CupoIngesta, DocumentoIngesta


class CuotaAgotada(Exception):
    pass


class DocumentoEnProceso(Exception):
    pass


def identidad(organizacion_id, usuario_id):
    organizacion_id = UUID(str(organizacion_id))
    texto = str(usuario_id)
    if not texto.isascii() or not texto.isdigit() or len(texto) > 19 or not 0 < int(texto) <= 2**63-1:
        raise ValueError("Identidad interna inválida")
    return organizacion_id, int(texto)


@transaction.atomic
def reservar(organizacion_id, usuario_id, documento_id, limite, ttl):
    org, usuario = identidad(organizacion_id, usuario_id)
    documento_id = UUID(str(documento_id))
    cupo, _ = CupoIngesta.objects.get_or_create(organizacion_id=org, usuario_id=usuario)
    cupo = CupoIngesta.objects.select_for_update().get(pk=cupo.pk)
    ahora = timezone.now()
    cupo.documentos.filter(estado="reservado", vence_en__lte=ahora).delete()
    anterior = cupo.documentos.filter(clave=documento_id).first()
    if anterior:
        if anterior.estado == "completo":
            return None
        raise DocumentoEnProceso
    if cupo.documentos.count() >= limite:
        raise CuotaAgotada
    return DocumentoIngesta.objects.create(cupo=cupo, clave=documento_id, vence_en=ahora + timedelta(seconds=ttl)).pk


def cerrar_reserva(reserva_id, completo):
    if completo:
        return DocumentoIngesta.objects.filter(pk=reserva_id, estado="reservado", vence_en__gt=timezone.now()).update(estado="completo") == 1
    DocumentoIngesta.objects.filter(pk=reserva_id, estado="reservado").delete()
    return False


def purgar_cuotas_organizacion(organizacion_id):
    """Hook para el consumidor de eliminación MX-07; no hay FK hacia Auth."""
    CupoIngesta.objects.filter(organizacion_id=UUID(str(organizacion_id))).delete()


async def en_bd(funcion, *args):
    def ejecutar():
        try:
            return funcion(*args)
        finally:
            close_old_connections()
    return await sync_to_async(ejecutar, thread_sensitive=True)()


class PoliticaIA:
    def __init__(self, *, timeout=None, max_documentos=None, simultaneas=None):
        self.timeout = timeout if timeout is not None else settings.IA_TIMEOUT_SEGUNDOS
        self.max_documentos = max_documentos if max_documentos is not None else settings.IA_MAX_DOCUMENTOS_USUARIO
        cantidad = simultaneas if simultaneas is not None else settings.IA_MAX_LLAMADAS_SIMULTANEAS
        if not isfinite(self.timeout) or self.timeout <= 0 or type(self.max_documentos) is not int or self.max_documentos < 1 or type(cantidad) is not int or cantidad < 1:
            raise ValueError("Los límites IA deben ser positivos")
        self._plazas = BoundedSemaphore(cantidad)

    def degradar(self, datos, motivo, *, estado="degradado"):
        return {"estado": estado, "motivo": motivo, "datos": deepcopy(datos)}

    async def ejecutar(self, proveedor, datos_calculados):
        """Proveedor async recibe timeout y debe usar I/O cancelable, sin retries ocultos."""
        if not inspect.iscoroutinefunction(proveedor):
            raise TypeError("El proveedor debe ser async y no bloquear el event loop")
        if not self._plazas.acquire(blocking=False):
            return self.degradar(datos_calculados, "capacidad")
        try:
            try:
                datos = await asyncio.wait_for(proveedor(self.timeout), timeout=self.timeout)
                if not isinstance(datos, dict):
                    return self.degradar(datos_calculados, "respuesta_invalida")
                return {"estado": "ok", "motivo": None, "datos": datos}
            except TimeoutError:
                return self.degradar(datos_calculados, "timeout")
            except Exception:
                return self.degradar(datos_calculados, "proveedor_no_disponible")
        finally:
            self._plazas.release()

    async def procesar_documento(self, organizacion_id, usuario_id, documento_id, proveedor, datos_calculados):
        if not inspect.iscoroutinefunction(proveedor):
            raise TypeError("El proveedor debe ser async")
        try:
            reserva = await en_bd(reservar, organizacion_id, usuario_id, documento_id, self.max_documentos, max(60, self.timeout*2))
        except CuotaAgotada:
            return self.degradar(datos_calculados, "cuota_agotada")
        except DocumentoEnProceso:
            return self.degradar(datos_calculados, "documento_en_proceso")
        except DatabaseError:
            return self.degradar(datos_calculados, "cuota_no_disponible")
        if reserva is None:
            return self.degradar(datos_calculados, "documento_ya_procesado", estado="ya_procesado")
        completo = False
        try:
            resultado = await self.ejecutar(proveedor, datos_calculados)
            if resultado["estado"] == "ok":
                completo = await en_bd(cerrar_reserva, reserva, True)
                if not completo:
                    return self.degradar(datos_calculados, "reserva_vencida")
            return resultado
        except DatabaseError:
            return self.degradar(datos_calculados, "cuota_no_disponible")
        finally:
            if not completo:
                try:
                    await en_bd(cerrar_reserva, reserva, False)
                except DatabaseError:
                    pass  # La reserva vence; no se ejecuta otro proveedor sin comprobar cuota.
