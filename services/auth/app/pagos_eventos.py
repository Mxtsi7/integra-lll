"""Confirmación del proveedor mock; la redirección del navegador no concede plan."""
from hashlib import sha256
from decimal import Decimal
import hmac
import json
import time
from django.conf import settings
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from .models import Contratacion, EventoPago, Organizacion
from .planes import transicionar


class ConflictoPago(APIException):
    status_code = 409


class PagoNoDisponible(APIException):
    status_code = 503


def comprobar_mock():
    if not settings.PAGOS_MOCK_HABILITADO or len(settings.PAGOS_WEBHOOK_SECRET) < 32:
        raise PagoNoDisponible("El proveedor mock de pagos no está habilitado/configurado.")


def firma_pago(cuerpo, instante):
    return hmac.new(settings.PAGOS_WEBHOOK_SECRET.encode(), str(instante).encode() + b"." + cuerpo, sha256).hexdigest()


class EventoPagoSerializer(serializers.Serializer):
    evento_id = serializers.UUIDField()
    contratacion_id = serializers.UUIDField()
    organizacion_id = serializers.UUIDField()
    estado = serializers.ChoiceField(choices=["exitosa", "cancelada", "fallida"])
    importe = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.00"))
    moneda = serializers.CharField(min_length=3, max_length=3)


def recibir_pago(cuerpo, firma, instante):
    comprobar_mock()
    if len(cuerpo) > 8192:
        raise ValidationError("Evento de pago demasiado grande.")
    try:
        segundos = int(instante)
        if abs(time.time() - segundos) > 300 or not hmac.compare_digest(firma, firma_pago(cuerpo, instante)):
            raise ValueError
    except (TypeError, ValueError):
        raise PermissionDenied("Firma o instante de pago inválido.") from None
    try:
        datos = json.loads(cuerpo)
    except (ValueError, UnicodeDecodeError):
        raise ValidationError("Evento de pago inválido.") from None
    entrada = EventoPagoSerializer(data=datos)
    entrada.is_valid(raise_exception=True)
    return aplicar_pago(entrada)


@transaction.atomic
def aplicar_pago(entrada):
    datos = entrada.validated_data
    contrato = get_object_or_404(Contratacion, pk=datos["contratacion_id"])
    Organizacion.objects.select_for_update().get(pk=contrato.organizacion_id)
    contrato = Contratacion.objects.select_for_update().get(pk=contrato.pk)
    if (contrato.organizacion_id != datos["organizacion_id"] or contrato.importe != datos["importe"]
            or contrato.moneda != datos["moneda"] or not contrato.precio_demo):
        raise ValidationError("El evento no coincide con la intención de pago.")
    huella = sha256(json.dumps(entrada.data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    anterior = EventoPago.objects.filter(pk=datos["evento_id"]).first()
    if anterior:
        if anterior.huella != huella:
            raise ConflictoPago("Identificador de evento reutilizado con otros datos.")
        return contrato, True, anterior.aplicado
    valido = (contrato.estado == "pendiente" or contrato.estado == datos["estado"]
              or contrato.estado == "exitosa" and datos["estado"] == "cancelada")
    aplicado = valido and contrato.estado != datos["estado"]
    if valido:
        contrato = transicionar(contrato.pk, datos["estado"])
    try:
        with transaction.atomic():
            EventoPago.objects.create(id=datos["evento_id"], contratacion=contrato, huella=huella, estado=datos["estado"], aplicado=aplicado)
    except IntegrityError:
        raise ConflictoPago("Identificador de evento reutilizado concurrentemente.") from None
    return contrato, False, aplicado
