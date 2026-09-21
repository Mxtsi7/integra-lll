from django.utils import timezone
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "nombre", "password")
        extra_kwargs = {
            "password": {"write_only": True, "min_length": 8},
            "id": {"read_only": True},
        }

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class RegisterSerializer(UserSerializer):
    acepta_datos = serializers.BooleanField(write_only=True, required=True)

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ("acepta_datos",)

    def validate_acepta_datos(self, value):
        if value is not True:
            raise serializers.ValidationError(
                "Debes aceptar el tratamiento de tus datos."
            )
        return value

    def create(self, validated_data):
        validated_data.pop("acepta_datos", None)
        return User.objects.create_user(
            consentimiento_en=timezone.now(),
            **validated_data,
        )