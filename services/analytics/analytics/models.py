from decimal import Decimal

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from shared.tenant.base import ModeloTenant, ModeloBase

MONEDA_ISO_4217 = RegexValidator(
    r"^[A-Z]{3}$",
    "La moneda debe ser un código ISO de tres letras mayúsculas.",
)

ESTADO_RECOMENDACION_VIGENTE = "vigente"
ESTADO_RECOMENDACION_DESCARTADA = "descartada"
ESTADOS_RECOMENDACION = [
    (ESTADO_RECOMENDACION_VIGENTE, "Vigente"),
    (ESTADO_RECOMENDACION_DESCARTADA, "Descartada"),
]
# Identidad de negocio del hallazgo, independiente del id de entrega del evento.
CAMPOS_IDENTIDAD_RECOMENDACION = (
    "organizacion_id",
    "tipo",
    "suscripcion_id",
    "evidencia_id",
)


class CupoIngesta(ModeloTenant):
    usuario_id = models.PositiveBigIntegerField()

    class Meta(ModeloTenant.Meta):
        db_table = "cupo_ingesta"
        constraints = [models.UniqueConstraint(fields=["organizacion_id", "usuario_id"], name="cupo_ingesta_usuario_tenant")]


class DocumentoIngesta(ModeloBase):
    cupo = models.ForeignKey(CupoIngesta, on_delete=models.CASCADE, related_name="documentos")
    clave = models.UUIDField()
    estado = models.CharField(max_length=10, default="reservado", choices=[("reservado", "Reservado"), ("completo", "Completo")])
    vence_en = models.DateTimeField()

    class Meta(ModeloBase.Meta):
        db_table = "documento_ingesta"
        constraints = [models.UniqueConstraint(fields=["cupo", "clave"], name="documento_ingesta_clave_unica")]


class IntentoPDF(models.Model):
    cupo = models.ForeignKey(CupoIngesta, on_delete=models.CASCADE)
    huella = models.CharField(max_length=64)
    dia = models.DateField()
    intentos = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "intento_pdf"
        constraints = [models.UniqueConstraint(fields=["cupo", "huella", "dia"], name="intento_pdf_dia_unico")]


class ConsumoMensualIA(models.Model):
    cupo = models.ForeignKey(CupoIngesta, on_delete=models.CASCADE)
    mes = models.DateField()
    llamadas = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "consumo_mensual_ia"
        constraints = [models.UniqueConstraint(fields=["cupo", "mes"], name="consumo_ia_mes_unico")]


class RecomendacionConsolidacion(ModeloTenant):
    """Recomendación emitida por VI-20, persistida para su consulta y descarte.

    El ``id`` es el identificador determinista del evento
    ``recomendacion.consolidacion_generada``: un replay del mismo evento reusa
    la misma fila en vez de duplicarla. El ``estado`` pertenece a la
    recomendación (no a la suscripción) y VI-18 podrá cambiarlo sin perder el
    resto del registro.

    La identidad de negocio es ``(organizacion_id, tipo, suscripcion_id,
    evidencia_id)``. Un nuevo snapshot del mismo hallazgo actualiza esta fila
    en vez de crear otra vigente; una evidencia distinta sí es otro hallazgo.
    ``ocurrido_en_origen`` conserva la fecha del snapshot para que una entrega
    fuera de orden no reemplace datos más recientes.
    """

    id = models.UUIDField(primary_key=True, editable=False)
    evento_origen_id = models.UUIDField(db_index=True)
    correlation_id = models.UUIDField()
    ocurrido_en = models.DateTimeField()
    ocurrido_en_origen = models.DateTimeField(default=timezone.now)

    tipo = models.CharField(max_length=40, default="consolidacion_categoria")
    categoria = models.CharField(max_length=40)
    suscripcion_id = models.UUIDField(db_index=True)
    suscripcion_nombre = models.CharField(max_length=200)
    suscripciones_relacionadas = models.JSONField(default=list)

    motivo = models.TextField()
    ahorro_estimado = models.DecimalField(max_digits=14, decimal_places=2)
    moneda = models.CharField(max_length=3, validators=[MONEDA_ISO_4217])
    base_calculo = models.CharField(max_length=200, blank=True)

    evidencia_id = models.CharField(max_length=200)
    evidencia_url = models.URLField(max_length=500)
    evidencia_descripcion = models.TextField()

    estado = models.CharField(
        max_length=10,
        choices=ESTADOS_RECOMENDACION,
        default=ESTADO_RECOMENDACION_VIGENTE,
    )

    class Meta(ModeloTenant.Meta):
        db_table = "recomendacion_consolidacion"
        indexes = ModeloTenant.Meta.indexes + [
            models.Index(
                fields=["organizacion_id", "moneda", "estado"],
                name="rec_org_moneda_estado",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(ahorro_estimado__gt=0),
                name="recomendacion_ahorro_positivo",
            ),
            models.UniqueConstraint(
                fields=CAMPOS_IDENTIDAD_RECOMENDACION,
                name="recomendacion_hallazgo_unico",
            ),
        ]


class UmbralAhorro(ModeloBase):
    """Catálogo global de RN-REC-001: ahorro mínimo por moneda.

    No se cargan valores semilla. Si una moneda no tiene una fila activa, el
    listado no puede aplicar la regla y debe informar la indisponibilidad en
    lugar de inventar un umbral.
    """

    moneda = models.CharField(
        max_length=3,
        unique=True,
        validators=[MONEDA_ISO_4217],
    )
    monto = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    activo = models.BooleanField(default=True)

    class Meta(ModeloBase.Meta):
        db_table = "umbral_ahorro"
        constraints = [
            models.CheckConstraint(
                condition=Q(monto__gt=0),
                name="umbral_ahorro_monto_positivo",
            ),
        ]

    def save(self, *args, **kwargs):
        # La regla compara códigos ISO en mayúsculas; normalizar acá evita que
        # una carga manual en minúsculas deje la moneda sin configuración.
        from analytics.reglas import normalizar_moneda

        self.moneda = normalizar_moneda(self.moneda)
        super().save(*args, **kwargs)
