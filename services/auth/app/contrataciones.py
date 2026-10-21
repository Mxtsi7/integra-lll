import json
import time
from urllib.parse import urlencode, urlsplit
from uuid import uuid5
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils.html import format_html
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from .contexto import usuario_del_contexto
from .models import Contratacion, Organizacion, Plan
from .pagos_eventos import ConflictoPago, EventoPagoSerializer, PagoNoDisponible, comprobar_mock, firma_pago, recibir_pago
from .planes import transicionar


def url_configurada(valor, *, origen=False):
    try:
        url = urlsplit(valor)
    except ValueError:
        raise PagoNoDisponible("Configuración de URL de pagos inválida.") from None
    if (url.username or url.password or url.fragment or not url.hostname
            or url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1"))
            or origen and (url.path not in ("", "/") or url.query)):
        raise PagoNoDisponible("Configuración de URL de pagos inválida.")
    return valor.rstrip("/")


def url_retorno(contrato):
    base = url_configurada(settings.PAGOS_URL_RETORNO)
    return base + ("&" if "?" in base else "?") + urlencode({"contratacion_id": str(contrato.pk)})


class SolicitudContratacionSerializer(serializers.Serializer):
    plan_codigo = serializers.ChoiceField(choices=["premium"])
    clave_idempotencia = serializers.UUIDField()

    def validate(self, attrs):
        if set(self.initial_data) - {"plan_codigo", "clave_idempotencia"}:
            raise ValidationError("Solo se aceptan plan_codigo y clave_idempotencia.")
        return attrs


class ContratacionSerializer(serializers.ModelSerializer):
    url_checkout = serializers.SerializerMethodField()
    url_retorno = serializers.SerializerMethodField()

    def get_url_checkout(self, contrato) -> str:
        token = signing.dumps({"id": str(contrato.pk)}, key=settings.PAGOS_WEBHOOK_SECRET, salt="pago-mock")
        return url_configurada(settings.PAGOS_URL_PUBLICA, origen=True) + "/api/pagos/mock/?" + urlencode({"token": token})

    def get_url_retorno(self, contrato) -> str:
        return url_retorno(contrato)

    class Meta:
        model = Contratacion
        fields = ("id", "estado", "plan_id", "importe", "moneda", "precio_demo", "vigente_desde", "vigente_hasta", "url_checkout", "url_retorno")
        read_only_fields = fields


class ContratacionesView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Contratación"], request=SolicitudContratacionSerializer,
                   responses={200: ContratacionSerializer, 201: ContratacionSerializer, 400: None, 403: None, 409: None, 503: None})
    @transaction.atomic
    def post(self, request):
        comprobar_mock()
        entrada = SolicitudContratacionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        usuario = usuario_del_contexto(request, bloquear=True)
        if not usuario.organizacion_id or usuario.rol != "titular":
            raise PermissionDenied("Solo un titular puede contratar para su organización.")
        Organizacion.objects.select_for_update().get(pk=usuario.organizacion_id)
        datos = entrada.validated_data
        contrato = Contratacion.objects.filter(organizacion_id=usuario.organizacion_id, clave_idempotencia=datos["clave_idempotencia"]).first()
        if contrato:
            if contrato.plan_id != datos["plan_codigo"]:
                raise ConflictoPago("Clave de idempotencia reutilizada.")
            return Response(ContratacionSerializer(contrato).data)
        if Contratacion.objects.filter(organizacion_id=usuario.organizacion_id, estado="pendiente", plan_id=datos["plan_codigo"]).exists():
            raise ConflictoPago("Ya hay una contratación pendiente para ese plan.")
        plan = get_object_or_404(Plan, codigo=datos["plan_codigo"], activo=True)
        if not plan.precio_demo:
            raise PagoNoDisponible("No hay una pasarela real configurada para este precio.")
        contrato = Contratacion.objects.create(organizacion=usuario.organizacion, solicitante=usuario, plan=plan,
            clave_idempotencia=datos["clave_idempotencia"], importe=plan.precio, moneda=plan.moneda, precio_demo=plan.precio_demo)
        return Response(ContratacionSerializer(contrato).data, status=201)


class ContratacionDetalleView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Contratación"], responses={200: ContratacionSerializer, 403: None, 404: None})
    def get(self, request, pk):
        comprobar_mock()
        usuario = usuario_del_contexto(request)
        contrato = get_object_or_404(Contratacion, pk=pk, organizacion_id=usuario.organizacion_id)
        return Response(ContratacionSerializer(contrato).data)


class CancelarContratacionView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Contratación"], request=None, responses={200: ContratacionSerializer, 400: None, 403: None, 404: None})
    @transaction.atomic
    def post(self, request, pk):
        comprobar_mock()
        usuario = usuario_del_contexto(request, bloquear=True)
        if usuario.rol != "titular":
            raise PermissionDenied("Solo el titular puede cancelar la contratación.")
        contrato = get_object_or_404(Contratacion, pk=pk, organizacion_id=usuario.organizacion_id)
        return Response(ContratacionSerializer(transicionar(contrato.pk, "cancelada")).data)


class WebhookPagoView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Contratación"], request=EventoPagoSerializer,
        auth=[], parameters=[OpenApiParameter("X-Pagos-Firma", str, OpenApiParameter.HEADER, required=True),
                             OpenApiParameter("X-Pagos-Instante", int, OpenApiParameter.HEADER, required=True)],
        responses={200: dict, 400: None, 403: None, 404: None, 409: None, 503: None})
    def post(self, request):
        contrato, repetido, aplicado = recibir_pago(request.body, request.headers.get("X-Pagos-Firma", ""), request.headers.get("X-Pagos-Instante", ""))
        return Response({"id": str(contrato.pk), "estado": contrato.estado, "repetido": repetido, "aplicado": aplicado})


class RespuestaMockSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=1024)
    estado = serializers.ChoiceField(choices=["exitosa", "fallida", "cancelada"])


class CheckoutMockView(APIView):
    authentication_classes = permission_classes = []

    def contrato(self, token):
        comprobar_mock()
        try:
            datos = signing.loads(token, key=settings.PAGOS_WEBHOOK_SECRET, salt="pago-mock", max_age=900)
            return get_object_or_404(Contratacion, pk=datos["id"])
        except (signing.BadSignature, ValueError, TypeError, KeyError):
            raise PermissionDenied("El enlace de pago mock no es válido o venció.") from None

    @extend_schema(exclude=True)
    def get(self, request):
        token = request.query_params.get("token", "")
        contrato = self.contrato(token)
        html = format_html('<!doctype html><html lang="es"><meta charset="utf-8"><title>Pago de demostración</title><h1>Simulación de pago</h1><p>Sin cobros reales. Importe demo: {} {}</p><form method="post"><input type="hidden" name="token" value="{}"><select name="estado"><option value="exitosa">Simular aprobado</option><option value="fallida">Simular rechazado</option><option value="cancelada">Cancelar</option></select><button>Confirmar simulación</button></form></html>', contrato.importe, contrato.moneda, token)
        respuesta = HttpResponse(html)
        respuesta["Cache-Control"] = "no-store"
        respuesta["Referrer-Policy"] = "no-referrer"
        respuesta["Content-Security-Policy"] = "default-src 'none'; form-action 'self'; base-uri 'none'"
        return respuesta

    @extend_schema(exclude=True)
    def post(self, request):
        entrada = RespuestaMockSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        contrato = self.contrato(datos["token"])
        evento = {"evento_id": str(uuid5(contrato.pk, datos["estado"])), "contratacion_id": str(contrato.pk),
            "organizacion_id": str(contrato.organizacion_id), "estado": datos["estado"], "importe": str(contrato.importe), "moneda": contrato.moneda}
        cuerpo = json.dumps(evento).encode()
        instante = str(int(time.time()))
        recibir_pago(cuerpo, firma_pago(cuerpo, instante), instante)
        respuesta = HttpResponseRedirect(url_retorno(contrato))
        respuesta.status_code = 303
        respuesta["Cache-Control"] = "no-store"
        return respuesta
