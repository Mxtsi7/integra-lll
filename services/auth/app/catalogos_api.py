from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from app.models import Pais
from shared.catalogos.api import ConsultaCatalogo, OpcionSerializer, PARAMETRO_INACTIVOS


class PaisesView(ConsultaCatalogo):
    @extend_schema(parameters=[PARAMETRO_INACTIVOS], responses=OpcionSerializer(many=True))
    def get(self, request):
        return Response(self.opciones(Pais))
