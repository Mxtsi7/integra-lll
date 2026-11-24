from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .contexto import usuario_del_contexto
from .models import Sesion


LIMITE_PREDETERMINADO = 20
LIMITE_MAXIMO = 100
OFFSET_MAXIMO = 2**31 - 1


class PaginacionHistorialSerializer(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=LIMITE_MAXIMO, default=LIMITE_PREDETERMINADO)
    offset = serializers.IntegerField(min_value=0, max_value=OFFSET_MAXIMO, default=0)


class AccesoSerializer(serializers.Serializer):
    iniciada_en = serializers.DateTimeField()
    metodo = serializers.ChoiceField(choices=Sesion.Metodo.choices)


class HistorialAccesosView(APIView):
    @extend_schema(operation={
        "operationId": "usuarios_me_historial_accesos_retrieve",
        "summary": "Consultar el historial de inicios de sesión propios",
        "tags": ["Auth"],
        "parameters": [
            {
                "name": "limit",
                "in": "query",
                "schema": {
                    "type": "integer", "minimum": 1,
                    "maximum": LIMITE_MAXIMO, "default": LIMITE_PREDETERMINADO,
                },
            },
            {
                "name": "offset",
                "in": "query",
                "schema": {"type": "integer", "minimum": 0, "maximum": OFFSET_MAXIMO, "default": 0},
            },
        ],
        "responses": {
            "200": {
                "description": "Inicios de sesión en orden del más reciente al más antiguo.",
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "required": ["resultados", "siguiente_offset"],
                            "properties": {
                                "resultados": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "required": ["iniciada_en", "metodo"],
                                        "properties": {
                                            "iniciada_en": {"type": "string", "format": "date-time"},
                                            "metodo": {"type": "string", "enum": Sesion.Metodo.values},
                                        },
                                    },
                                },
                                "siguiente_offset": {"type": "integer", "minimum": 0, "nullable": True},
                            },
                        },
                    },
                },
            },
            "400": {"description": "Paginación inválida."},
            "403": {"description": "Contexto de usuario u organización inválido."},
            "404": {"description": "El usuario del contexto no existe o está inactivo."},
        },
    })
    def get(self, request):
        usuario = usuario_del_contexto(request)
        parametros = PaginacionHistorialSerializer(data=request.query_params)
        parametros.is_valid(raise_exception=True)
        limite = parametros.validated_data["limit"]
        inicio = parametros.validated_data["offset"]
        fin = inicio + limite
        accesos = list(
            usuario.sesiones.filter(iniciada_en__isnull=False)
            .order_by("-iniciada_en", "-id")
            .values("iniciada_en", "metodo")[inicio:fin + 1]
        )
        return Response(
            {
                "resultados": AccesoSerializer(accesos[:limite], many=True).data,
                "siguiente_offset": fin if len(accesos) > limite else None,
            },
            headers={"Cache-Control": "private, no-store"},
        )
