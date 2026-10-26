from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from app.models import CategoriaSuscripcion, Moneda, Subscription
from shared.catalogos.api import ConsultaCatalogo, OpcionSerializer, PARAMETRO_INACTIVOS


class FrecuenciaSerializer(serializers.Serializer):
    codigo = serializers.CharField()
    nombre = serializers.CharField()


class PredeterminadosSerializer(serializers.Serializer):
    moneda = serializers.CharField(allow_null=True)
    categoria = serializers.CharField(allow_null=True)
    frecuencia = serializers.CharField()


class CatalogosSerializer(serializers.Serializer):
    monedas = OpcionSerializer(many=True)
    categorias = OpcionSerializer(many=True)
    frecuencias = FrecuenciaSerializer(many=True)
    predeterminados = PredeterminadosSerializer()


class CatalogosSuscripcionesView(ConsultaCatalogo):
    @extend_schema(parameters=[PARAMETRO_INACTIVOS], responses=CatalogosSerializer)
    def get(self, request):
        monedas = self.opciones(Moneda)
        categorias = self.opciones(CategoriaSuscripcion)

        def predeterminado(opciones, preferido):
            activos = [o["codigo"] for o in opciones if o["activo"]]
            return preferido if preferido in activos else next(iter(activos), None)

        return Response({
            "monedas": monedas,
            "categorias": categorias,
            "frecuencias": [{"codigo": c, "nombre": n} for c, n in Subscription.Frecuencia.choices],
            "predeterminados": {
                "moneda": predeterminado(monedas, "CLP"),
                "categoria": predeterminado(categorias, "otro"),
                "frecuencia": Subscription.Frecuencia.MENSUAL,
            },
        })
