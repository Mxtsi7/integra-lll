from django.utils import timezone
from rest_framework import serializers
from .models import User


class UserSerializer(serializers.ModelSerializer):
    acepta_datos = serializers.BooleanField(write_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "nombre", "password", "acepta_datos")
        extra_kwargs = {
            "password": {"write_only": True, "min_length": 8},
            "nombre": {"required": True, "allow_blank": False},
            "id": {"read_only": True},
        }

    def validate_acepta_datos(self, value):
        if not value:
            raise serializers.ValidationError("Debes aceptar el tratamiento de tus datos.")
        return value

    def create(self, validated_data):
        validated_data.pop("acepta_datos")
        return User.objects.create_user(
            consentimiento_en=timezone.now(),
            **validated_data,
        )