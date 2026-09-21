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
        # create_user ya llama a set_password → hash
        return User.objects.create_user(**validated_data)

    def to_representation(self, instance):
        # Garantiza que la respuesta NUNCA lleve password ni hash
        data = super().to_representation(instance)
        data.pop("password", None)
        return data