import uuid

from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import BaseUserManager, PermissionsMixin
from django.db import models
from django.core.validators import RegexValidator
from shared.catalogos.models import OpcionCatalogo
from django.db.models.functions import Lower

from shared.tenant.base import ModeloBase


class Organizacion(ModeloBase):
    nombre = models.CharField(max_length=100)

    class Meta(ModeloBase.Meta):
        db_table = "organizacion"
        verbose_name = "Organización"
        verbose_name_plural = "Organizaciones"

    def __str__(self) -> str:
        return self.nombre


class UserManager(BaseUserManager):
    def get_by_natural_key(self, email):
        return self.get(**{f"{self.model.USERNAME_FIELD}__iexact": email})

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("El usuario debe tener un correo electrónico")

        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("El superusuario debe tener is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("El superusuario debe tener is_superuser=True.")
        if extra_fields.get("is_active") is not True:
            raise ValueError("El superusuario debe tener is_active=True.")

        return self.create_user(email=email, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Rol(models.TextChoices):
        TITULAR = "titular", "Titular"
        INTEGRANTE = "integrante", "Integrante"

    email = models.EmailField(unique=True)
    nombre = models.CharField(max_length=150)
    consentimiento_en = models.DateTimeField(null=True, blank=True)
    correo_verificado_en = models.DateTimeField(null=True, blank=True)

    organizacion = models.ForeignKey(
        Organizacion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="usuarios",
    )
    rol = models.CharField(
        max_length=20,
        choices=Rol.choices,
        null=True,
        blank=True,
    )

    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["nombre"]

    class Meta:
        constraints = [models.UniqueConstraint(Lower("email"), name="usuario_email_unico_sin_mayusculas")]

    def __str__(self) -> str:
        return self.email


class TokenRecuperacionUsado(models.Model):
    """Huella de un enlace consumido; nunca almacena el token ni la identidad."""

    huella = models.CharField(max_length=64, primary_key=True)
    usado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "token_recuperacion_usado"


class Pais(OpcionCatalogo):
    codigo = models.CharField(max_length=2, unique=True, validators=[RegexValidator(r"^[A-Z]{2}$")])

    class Meta(OpcionCatalogo.Meta):
        db_table = "pais"


class Sesion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sesiones")
    refresh_jti = models.CharField(max_length=64)
    vence_en = models.DateTimeField()
    revocada = models.BooleanField(default=False)

    class Meta:
        db_table = "sesion"


class Plan(models.Model):
    codigo = models.CharField(max_length=20, primary_key=True, choices=[("free", "Gratuito"), ("premium", "Premium")])
    nombre = models.CharField(max_length=60)
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    moneda = models.CharField(max_length=3, default="CLP")
    periodo = models.CharField(max_length=10, default="mensual", choices=[("mensual", "Mensual")])
    precio_demo = models.BooleanField(default=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = "plan"
        constraints = [models.CheckConstraint(condition=models.Q(precio__gte=0), name="plan_precio_no_negativo")]


class Contratacion(ModeloBase):
    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        EXITOSA = "exitosa", "Exitosa"
        CANCELADA = "cancelada", "Cancelada"
        FALLIDA = "fallida", "Fallida"

    organizacion = models.ForeignKey(Organizacion, on_delete=models.CASCADE, related_name="contrataciones")
    solicitante = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT)
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.PENDIENTE)
    clave_idempotencia = models.UUIDField()
    importe = models.DecimalField(max_digits=10, decimal_places=2)
    moneda = models.CharField(max_length=3)
    precio_demo = models.BooleanField(default=True)
    vigente_desde = models.DateTimeField(null=True, blank=True)
    vigente_hasta = models.DateTimeField(null=True, blank=True)

    class Meta(ModeloBase.Meta):
        db_table = "contratacion"
        constraints = [
            models.UniqueConstraint(fields=["organizacion", "clave_idempotencia"], name="contratacion_clave_por_org"),
            models.UniqueConstraint(fields=["organizacion", "plan"], condition=models.Q(estado="pendiente"), name="contratacion_pendiente_unica"),
            models.CheckConstraint(condition=models.Q(importe__gte=0), name="contratacion_importe_no_negativo"),
            models.CheckConstraint(condition=(models.Q(vigente_desde__isnull=True, vigente_hasta__isnull=True) | models.Q(vigente_desde__isnull=False, vigente_hasta__isnull=False, vigente_hasta__gt=models.F("vigente_desde"))), name="contratacion_periodo_valido"),
        ]


class EventoPago(ModeloBase):
    id = models.UUIDField(primary_key=True)
    contratacion = models.ForeignKey(Contratacion, on_delete=models.CASCADE, related_name="eventos_pago")
    huella = models.CharField(max_length=64)
    estado = models.CharField(max_length=10, choices=Contratacion.Estado.choices)
    aplicado = models.BooleanField(default=False)

    class Meta(ModeloBase.Meta):
        db_table = "evento_pago"


class SolicitudVerificacionCorreo(ModeloBase):
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name="verificaciones_correo")
    huella = models.CharField(max_length=64, unique=True)
    correo = models.EmailField()
    correo_anterior = models.EmailField()
    credenciales = models.CharField(max_length=64)
    vence_en = models.DateTimeField()
    consumido_en = models.DateTimeField(null=True, blank=True)
    invalidado_en = models.DateTimeField(null=True, blank=True)

    class Meta(ModeloBase.Meta):
        db_table = "solicitud_verificacion_correo"


class IdentidadGoogle(models.Model):
    usuario = models.OneToOneField(User, on_delete=models.CASCADE, related_name="identidad_google")
    subject = models.CharField(max_length=255, unique=True)

    class Meta:
        db_table = "identidad_google"


class IntentoGoogle(models.Model):
    """Huellas efímeras; no persiste ID tokens ni secretos del navegador."""

    huella = models.CharField(max_length=64, primary_key=True)
    navegador = models.CharField(max_length=64)
    vence_en = models.DateTimeField(db_index=True)

    class Meta:
        db_table = "intento_google"


class EliminacionOrganizacion(models.Model):
    """Outbox durable sin claves foráneas a usuarios eliminados ni secretos."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizacion_id = models.UUIDField(unique=True)
    pendientes = models.JSONField(default=list)
    creado_en = models.DateTimeField(auto_now_add=True)
    completado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "eliminacion_organizacion"


class EliminacionUsuario(models.Model):
    """Limpieza personal durable, independiente de la vida del User."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizacion_id = models.UUIDField()
    usuario_id = models.PositiveBigIntegerField()
    pendientes = models.JSONField(default=list)
    creado_en = models.DateTimeField(auto_now_add=True)
    completado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "eliminacion_usuario"


class ConsentimientoDisociado(models.Model):
    """Evidencia mínima de consentimiento, sin vínculo a una persona o tenant."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    consentimiento_en = models.DateTimeField()
    eliminado_en = models.DateTimeField()
    retener_hasta = models.DateTimeField(db_index=True)

    class Meta:
        db_table = "consentimiento_disociado"
