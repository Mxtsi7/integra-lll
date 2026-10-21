from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from .contexto import usuario_del_contexto
from .models import Plan
from .planes import plan_vigente


def features_para(plan):
    return {"asistente_financiero": plan == "premium", "recomendaciones_automaticas": plan == "premium"}


class PermisosPlanSerializer(serializers.Serializer):
    plan = serializers.ChoiceField(choices=["free", "premium"])
    features = serializers.DictField(child=serializers.BooleanField())


class PlanSerializer(serializers.ModelSerializer):
    features = serializers.SerializerMethodField()

    def get_features(self, plan) -> dict[str, bool]:
        return features_para(plan.codigo)

    class Meta:
        model = Plan
        fields = ("codigo", "nombre", "precio", "moneda", "periodo", "precio_demo", "features")
        read_only_fields = fields


class PermisosPlanView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Planes"], responses={200: PermisosPlanSerializer, 403: None, 404: None})
    def get(self, request):
        usuario = usuario_del_contexto(request)
        plan = plan_vigente(usuario.organizacion_id)
        return Response({"plan": plan, "features": features_para(plan)})


class PlanesView(APIView):
    authentication_classes = permission_classes = []

    @extend_schema(tags=["Planes"], responses={200: PlanSerializer(many=True), 403: None, 404: None})
    def get(self, request):
        usuario_del_contexto(request)
        return Response(PlanSerializer(Plan.objects.filter(activo=True).order_by("precio", "codigo"), many=True).data)
