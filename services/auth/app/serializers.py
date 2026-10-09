from django.utils import timezone
from rest_framework import serializers
<<<<<<< HEAD
from django.db import transaction
from .models import User, Organizacion


=======
from rest_framework.exceptions import ErrorDetail
from django.db import transaction
from .models import User, Organizacion
from .validators import MENSAJE_POLITICA_CONTRASENA, validador_contrasena


def campo_contrasena() -> serializers.CharField:
    """Campo DRF con la política RF-01.1.

    Fija ``write_only``, ``trim_whitespace=False``, ``style`` password,
    el validador central y el mensaje único (también para campo omitido
    o vacío). Sin parámetros: todos los flujos deben usar exactamente
    este campo para no divergir.
    """
    return serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        style={"input_type": "password"},
        validators=[validador_contrasena],
        error_messages={
            "blank": MENSAJE_POLITICA_CONTRASENA,
            "required": MENSAJE_POLITICA_CONTRASENA,
        },
    )


def _fijar_contrasena(user: User, nueva: str) -> User:
    """Única vía de persistencia de claves: hashea y guarda solo el hash."""
    user.set_password(nueva)
    user.save(update_fields=["password"])
    return user

>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2

class MiembroSerializer(serializers.ModelSerializer):
    """Miembro activo de una organización (respuesta de GET /api/organizacion/)."""
    correo = serializers.EmailField(source="email", read_only=True)

    class Meta:
        model = User
        fields = ("id", "nombre", "correo", "rol")
        read_only_fields = fields


class UserSerializer(serializers.ModelSerializer):
<<<<<<< HEAD
=======
    # Declarado explícito (no extra_kwargs) para fijar trim_whitespace=False,
    # style password y el validador centralizado en un solo lugar.
    password = campo_contrasena()

>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2
    class Meta:
        model = User
        fields = ("id", "email", "nombre", "password")
        extra_kwargs = {
<<<<<<< HEAD
            "password": {"write_only": True, "min_length": 8},
=======
>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2
            "id": {"read_only": True},
        }

    def create(self, validated_data):
<<<<<<< HEAD
=======
        # create_user -> set_password -> solo se persiste el hash.
>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2
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


<<<<<<< HEAD
class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
=======
class PasswordResetConfirmSerializer(serializers.Serializer):
    """Fija la nueva contraseña en un flujo de recuperación (RF-01.4).

    Estado MX-30: preparado para integración futura. Hoy no existe
    vista ni ruta de recuperación en este servicio, por lo que este
    serializer no está cableado a ningún endpoint.

    Precondiciones del futuro llamador: debe verificar ANTES de usarlo
    la identidad del solicitante y el enlace (expiración 60 min, un solo
    uso, TC-61), y entregar el usuario verificado como ``instance``.
    Este serializer solo aplica la política RF-01.1 al valor recibido
    y lo guarda hasheado; no valida tokens.

    Usa el ciclo de vida estándar de DRF: ``update()`` persiste y el
    ``save()`` heredado aporta sus precondiciones (``is_valid()`` previo
    y sin errores). No sobrescribir ``save()`` es lo que garantiza que
    ninguna llamada inválida llegue a ``set_password()``.

    Uso::

        s = PasswordResetConfirmSerializer(usuario, data={"new_password": "..."})
        s.is_valid(raise_exception=True)
        s.save()  # -> user.set_password(...) + save; devuelve el usuario
    """

    new_password = campo_contrasena()

    def update(self, instance, validated_data):
        return _fijar_contrasena(instance, validated_data["new_password"])


class PasswordChangeSerializer(serializers.Serializer):
    """Cambio de contraseña con usuario autenticado (RF-01.5, TC-64).

    Estado MX-30: preparado para integración futura. Hoy no existe
    vista ni ruta de cambio en este servicio, por lo que este serializer
    no está cableado a ningún endpoint.

    Precondición del futuro llamador: entregar el usuario autenticado
    como ``instance``. La clave actual (``old_password``) solo se verifica
    con ``check_password`` contra ese mismo usuario y no se le aplica la
    política de composición; la nueva (``new_password``) sí debe cumplir
    RF-01.1. Como validación y persistencia operan sobre ``instance``, el
    usuario modificado es siempre el que se verificó.

    ``old_password`` y ``new_password`` son obligatorios también cuando
    ``partial=True``: un cambio sin ``old_password`` omitiría la
    verificación de identidad (TC-65).

    Usa el ciclo de vida estándar de DRF: ``update()`` persiste y el
    ``save()`` heredado aporta sus precondiciones (``is_valid()`` previo
    y sin errores). No sobrescribir ``save()`` es lo que garantiza que
    ninguna llamada inválida llegue a ``set_password()``.

    Uso::

        s = PasswordChangeSerializer(
            request.user,
            data={"old_password": "...", "new_password": "Nueva12345"},
        )
        s.is_valid(raise_exception=True)
        s.save()  # verifica la actual, hashea la nueva; devuelve el usuario
    """

    old_password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        style={"input_type": "password"},
    )
    new_password = campo_contrasena()

    def validate_old_password(self, value):
        user = self.instance
        if user is None or not user.check_password(value):
            raise serializers.ValidationError("La contraseña actual no es correcta.")
        return value

    def validate(self, attrs):
        # `validate_<campo>` no se ejecuta para campos omitidos con
        # partial=True; exigir ambos aquí impide cambiar la clave sin
        # verificar la actual. Mismo mensaje y código que con campo omitido
        # sin partial: nada nuevo que traducir en los clientes.
        errores = {}
        if "old_password" not in attrs:
            errores["old_password"] = ErrorDetail(
                self.fields["old_password"].error_messages["required"],
                code="required",
            )
        if "new_password" not in attrs:
            errores["new_password"] = ErrorDetail(
                MENSAJE_POLITICA_CONTRASENA, code="required"
            )
        if errores:
            raise serializers.ValidationError(errores)
        return attrs

    def update(self, instance, validated_data):
        return _fijar_contrasena(instance, validated_data["new_password"])


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    # Login NO aplica la política: solo autentica. Un mensaje genérico
    # evita revelar si falló el correo o la clave (TC-02).
>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2
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
<<<<<<< HEAD








#:v
=======
>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2
