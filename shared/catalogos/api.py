from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.views import APIView


class OpcionSerializer(serializers.Serializer):
    codigo = serializers.CharField()
    nombre = serializers.CharField()
    activo = serializers.BooleanField()
    orden = serializers.IntegerField()


PARAMETRO_INACTIVOS = OpenApiParameter(
    "incluir_inactivos", bool, description="Incluye opciones desactivadas para lectura histórica."
)


class ConsultaCatalogo(APIView):
    # El gateway valida el JWT; el servicio exige la identidad que propaga.
    authentication_classes = []

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not getattr(request, "usuario_id", None):
            raise PermissionDenied("Falta el contexto de usuario.")

    def opciones(self, modelo):
        valor = self.request.query_params.get("incluir_inactivos", "false")
        if valor not in ("true", "false"):
            raise ValidationError({"incluir_inactivos": "Usa true o false."})
        qs = modelo.objects.all()
        if valor != "true":
            qs = qs.filter(activo=True)
        return OpcionSerializer(qs, many=True).data
