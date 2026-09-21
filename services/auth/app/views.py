from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from .serializers import UserSerializer


class RegisterView(APIView):
    authentication_classes = []   
    permission_classes = []

    def post(self, request):
        serializer = UserSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = serializer.save()
        return Response(
            {"id": user.id, "email": user.email, "nombre": user.nombre},
            status=status.HTTP_201_CREATED,
        )