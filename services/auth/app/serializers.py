from django.utils import timezone
from rest_framework import serializers
from django.db import transaction
from .models import User, Organizacion



class MiembroSerializer(serializers.ModelSerializer):
    """Miembro activo de una organización (respuesta de GET /api/organizacion/)."""
    correo = serializers.EmailField(source="email", read_only=True)

    class Meta:
        model = User
        fields = ("id", "nombre", "correo", "rol")
        read_only_fields = fields


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
    codigo_organizacion = serializers.UUIDField(
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ("acepta_datos", "codigo_organizacion")

    def validate_acepta_datos(self, value):
        if value is not True:
            raise serializers.ValidationError(
                "Debes aceptar el tratamiento de tus datos."
            )
        return value

    def validate_codigo_organizacion(self, value):
        """Si se envía un código, debe existir la organización."""
        if value is None:
            return value
        if not Organizacion.objects.filter(id=value).exists():
            raise serializers.ValidationError(
                "El código de organización no es válido."
            )
        return value

    def create(self, validated_data):
        validated_data.pop("acepta_datos", None)
        codigo = validated_data.pop("codigo_organizacion", None)

        with transaction.atomic():
            if codigo:
                # Unirse a organización existente → integrante
                organizacion = Organizacion.objects.get(id=codigo)
                rol = User.Rol.INTEGRANTE
            else:
                # Crear organización propia → titular
                nombre = validated_data.get("nombre", "usuario")
                organizacion = Organizacion.objects.create(
                    nombre=f"Hogar de {nombre}"
                )
                rol = User.Rol.TITULAR

            return User.objects.create_user(
                consentimiento_en=timezone.now(),
                organizacion=organizacion,
                rol=rol,
                **validated_data,
            )


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        return User.objects.normalize_email(value)


class UsuarioActualSerializer(serializers.ModelSerializer):
    """Lo que /api/usuarios/me/ le entrega a la web.

    Usa `correo` y no `email` porque es el nombre que ya devuelve el login
    (LoginView) y el que espera el tipo `Usuario` del frontend; tener los dos
    nombres para el mismo dato en el mismo servicio era lo que obligaba a la
    web a adivinar cuál venía.

    Incluye `rol` y `organizacion_id` porque la pantalla de Perfil los
    muestra. El JWT ya los lleva como claims, pero la web no decodifica el
    token: los pide por la API.
    """

    correo = serializers.EmailField(source="email", read_only=True)
    # Declarado a mano para que salga como texto y no como objeto UUID:
    # si se deja que lo deduzca ModelSerializer queda un ReadOnlyField crudo.
    organizacion_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "nombre", "correo", "rol", "organizacion_id")
        # `correo` y `organizacion_id` van declarados arriba, no pueden repetirse aca.
        read_only_fields = ("id", "nombre", "rol")


class OrganizacionDetalleSerializer(serializers.Serializer):
    """Esquema de respuesta de GET /api/organizacion/."""

    id = serializers.UUIDField(help_text="Identificador de la organización")
    nombre = serializers.CharField(help_text="Nombre del hogar / organización")
    miembros = MiembroSerializer(many=True, help_text="Miembros activos")
    mi_rol = serializers.ChoiceField(
        choices=["titular", "integrante"],
        help_text="Rol del usuario que hace la petición",
    )
    