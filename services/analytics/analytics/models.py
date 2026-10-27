from django.db import models
from shared.tenant.base import ModeloTenant, ModeloBase


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
