"""MX-24: límites reutilizables; no envía documentos ni llama a un proveedor por sí solo."""
import asyncio
from copy import deepcopy
from datetime import timedelta
import inspect
import hashlib
import hmac
from math import isfinite
from threading import BoundedSemaphore
from uuid import UUID
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import DatabaseError, close_old_connections, connection, transaction
from django.db.models import Sum
from django.utils import timezone
from shared.ia.politica import ProveedorNoConfigurado

from .models import CupoIngesta, DocumentoIngesta, IntentoPDF, ConsumoMensualIA


class CuotaAgotada(Exception):
    pass


class DocumentoEnProceso(Exception):
    pass


def bloquear_usuario(usuario):
    # Contador por usuario incluso si cambia de organización; sin FK a Auth.
    # SQLite (tests locales) no tiene advisory locks: el aislamiento entre
    # organizaciones no depende de este lock, sólo la serialización del cupo.
    if connection.vendor != "postgresql":
        return
    llave = int.from_bytes(hashlib.sha256(f"analytics:ia:{usuario}".encode()).digest()[:8], "big", signed=True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [llave])


def identidad(organizacion_id, usuario_id):
    organizacion_id = UUID(str(organizacion_id))
    texto = str(usuario_id)
    if not texto.isascii() or not texto.isdigit() or len(texto) > 19 or not 0 < int(texto) <= 2**63-1:
        raise ValueError("Identidad interna inválida")
    return organizacion_id, int(texto)


@transaction.atomic
def reservar(organizacion_id, usuario_id, documento_id, limite, ttl, huella_pdf):
    org, usuario = identidad(organizacion_id, usuario_id)
    documento_id = UUID(str(documento_id))
    if not isinstance(huella_pdf, str) or len(huella_pdf) != 64 or any(c not in "0123456789abcdef" for c in huella_pdf):
        raise ValueError("Falta la huella SHA-256 del PDF")
    bloquear_usuario(usuario)
    cupo, _ = CupoIngesta.objects.get_or_create(organizacion_id=org, usuario_id=usuario)
    cupo = CupoIngesta.objects.select_for_update().get(pk=cupo.pk)
    ahora = timezone.now()
    cupo.documentos.filter(estado="reservado", vence_en__lte=ahora).delete()
    anterior = cupo.documentos.filter(clave=documento_id).first()
    if anterior:
        if anterior.estado == "completo":
            return None
        raise DocumentoEnProceso
    huella = hmac.new(settings.SECRET_KEY.encode(), f"pdf:{usuario}:{huella_pdf}".encode(), hashlib.sha256).hexdigest()
    dia = timezone.localdate()
    intentos = IntentoPDF.objects.filter(cupo__usuario_id=usuario, huella=huella, dia=dia).aggregate(total=Sum("intentos"))["total"] or 0
    if intentos >= limite:
        raise CuotaAgotada
    registro, _ = IntentoPDF.objects.get_or_create(cupo=cupo, huella=huella, dia=dia)
    registro.intentos += 1
    registro.save(update_fields=["intentos"])
    return DocumentoIngesta.objects.create(cupo=cupo, clave=documento_id, vence_en=ahora + timedelta(seconds=ttl)).pk


@transaction.atomic
def consumir_llamada(organizacion_id, usuario_id, limite):
    org, usuario = identidad(organizacion_id, usuario_id)
    bloquear_usuario(usuario)
    cupo, _ = CupoIngesta.objects.get_or_create(organizacion_id=org, usuario_id=usuario)
    mes = timezone.localdate().replace(day=1)
    llamadas = ConsumoMensualIA.objects.filter(cupo__usuario_id=usuario, mes=mes).aggregate(total=Sum("llamadas"))["total"] or 0
    if llamadas >= limite:
        raise CuotaAgotada
    consumo, _ = ConsumoMensualIA.objects.get_or_create(cupo=cupo, mes=mes)
    consumo.llamadas += 1
    consumo.save(update_fields=["llamadas"])


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
    def __init__(self, *, timeout=None, max_intentos_pdf=None, max_llamadas_mes=None, simultaneas=None):
        self.timeout = timeout if timeout is not None else settings.IA_TIMEOUT_SEGUNDOS
        self.max_intentos_pdf = max_intentos_pdf if max_intentos_pdf is not None else settings.IA_MAX_INTENTOS_PDF_DIA
        self.max_llamadas_mes = max_llamadas_mes if max_llamadas_mes is not None else settings.IA_MAX_LLAMADAS_MES
        cantidad = simultaneas if simultaneas is not None else settings.IA_MAX_LLAMADAS_SIMULTANEAS
        if (not isfinite(self.timeout) or self.timeout <= 0 or self.timeout > 3.5
                or any(type(n) is not int or n < 1 for n in (self.max_intentos_pdf, self.max_llamadas_mes, cantidad))
                or self.max_intentos_pdf > 3 or self.max_llamadas_mes > 200):
            raise ValueError("Los límites IA deben ser positivos")
        self._plazas = BoundedSemaphore(cantidad)

    def degradar(self, datos, motivo, *, estado="degradado"):
        return {"estado": estado, "motivo": motivo, "datos": deepcopy(datos)}

    async def ejecutar(self, proveedor, datos_calculados, *, organizacion_id, usuario_id):
        """Proveedor async recibe timeout y debe usar I/O cancelable, sin retries ocultos."""
        if not inspect.iscoroutinefunction(proveedor):
            raise TypeError("El proveedor debe ser async y no bloquear el event loop")
        if not self._plazas.acquire(blocking=False):
            return self.degradar(datos_calculados, "capacidad")
        try:
            try:
                await en_bd(consumir_llamada, organizacion_id, usuario_id, self.max_llamadas_mes)
            except CuotaAgotada:
                return self.degradar(datos_calculados, "cuota_agotada")
            except DatabaseError:
                return self.degradar(datos_calculados, "cuota_no_disponible")
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

    def ejecutar_sync(self, proveedor, datos_calculados, *, organizacion_id, usuario_id):
        """Variante síncrona para vistas Django y scripts (VI-22 / VI-24).

        Aplica la misma cuota, concurrencia y degradación que `ejecutar`, pero
        no cambia de hilo: en SQLite en memoria (tests) y en transacciones
        abiertas por la vista, `sync_to_async` estrenaría otra conexión. El
        proveedor recibe el timeout y debe respetarlo en su I/O.
        """
        if not callable(proveedor):
            raise TypeError("El proveedor debe ser una función síncrona")
        if not self._plazas.acquire(blocking=False):
            return self.degradar(datos_calculados, "capacidad")
        try:
            try:
                consumir_llamada(organizacion_id, usuario_id, self.max_llamadas_mes)
            except CuotaAgotada:
                return self.degradar(datos_calculados, "cuota_agotada")
            except DatabaseError:
                return self.degradar(datos_calculados, "cuota_no_disponible")
            try:
                datos = proveedor(self.timeout)
                if not isinstance(datos, dict):
                    return self.degradar(datos_calculados, "respuesta_invalida")
                return {"estado": "ok", "motivo": None, "datos": datos}
            except ProveedorNoConfigurado:
                return self.degradar(datos_calculados, "no_configurado")
            except TimeoutError:
                return self.degradar(datos_calculados, "timeout")
            except Exception:
                return self.degradar(datos_calculados, "proveedor_no_disponible")
        finally:
            self._plazas.release()

    async def procesar_documento(self, organizacion_id, usuario_id, documento_id, proveedor, datos_calculados, *, huella_pdf):
        if not inspect.iscoroutinefunction(proveedor):
            raise TypeError("El proveedor debe ser async")
        try:
            reserva = await en_bd(reservar, organizacion_id, usuario_id, documento_id, self.max_intentos_pdf, max(60, self.timeout*2), huella_pdf)
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
            resultado = await self.ejecutar(proveedor, datos_calculados, organizacion_id=organizacion_id, usuario_id=usuario_id)
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
