"""Modelos del servicio de suscripciones – Sprint 1."""

from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models

from shared.tenant.base import ModeloBase, ModeloTenant


class Subscription(ModeloTenant):
    """Suscripción recurrente perteneciente a una organización (ADR-002 / RF-06 / RF-13)."""

    # ── choices ──────────────────────────────────────────────────────

    class Frecuencia(models.TextChoices):
        MENSUAL = "mensual", "Mensual"
        ANUAL = "anual", "Anual"

    class Estado(models.TextChoices):
        PRUEBA = "prueba", "Prueba"
        ACTIVO = "activo", "Activo"
        POR_CONFIRMAR = "por_confirmar", "Por confirmar"
        CANCELADO = "cancelado", "Cancelado"
        FANTASMA = "fantasma", "Fantasma"

    class Moneda(models.TextChoices):
        CLP = "CLP", "Peso chileno"
        USD = "USD", "Dólar estadounidense"

    class Categoria(models.TextChoices):
        STREAMING = "streaming", "Streaming"
        MUSICA = "musica", "Música"
        PRODUCTIVIDAD = "productividad", "Productividad"
        NUBE = "nube", "Nube"
        JUEGOS = "juegos", "Juegos"
        EDUCACION = "educacion", "Educación"
        SALUD = "salud", "Salud"
        NOTICIAS = "noticias", "Noticias"
        IA = "ia", "Inteligencia Artificial"
        OTRO = "otro", "Otro"

    # ── campos ───────────────────────────────────────────────────────

    nombre = models.CharField(
        max_length=100,
        verbose_name="Nombre de la suscripción",
    )

    monto = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        verbose_name="Monto",
    )

    moneda = models.CharField(
        max_length=3,
        choices=Moneda.choices,
        default=Moneda.CLP,
        verbose_name="Moneda",
    )

    frecuencia = models.CharField(
        max_length=20,
        choices=Frecuencia.choices,
        verbose_name="Frecuencia de cobro",
    )

    fecha_proximo_cobro = models.DateField(
        verbose_name="Fecha del próximo cobro",
    )

    categoria = models.CharField(
        max_length=20,
        choices=Categoria.choices,
        default=Categoria.OTRO,
        verbose_name="Categoría",
    )

    # El glosario define la suscripción como el contrato entre una organización
    # y un proveedor. Queda opcional: las suscripciones que ya existen se
    # cargaron a mano, sin catálogo, y siguen siendo válidas.
    proveedor = models.ForeignKey(
        "Proveedor",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="suscripciones",
        verbose_name="Proveedor",
    )

    estado = models.CharField(
        max_length=20,
        choices=Estado.choices,
        default=Estado.ACTIVO,
        verbose_name="Estado",
    )

    fin_prueba = models.DateField(
        null=True,
        blank=True,
        verbose_name="Fin de período de prueba",
    )

    horas_uso_mes = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
        verbose_name="Horas de uso en el mes",
    )

    # ── meta ─────────────────────────────────────────────────────────

    class Meta(ModeloTenant.Meta):
        db_table = "subscription"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(monto__gt=Decimal("0")),
                name="subscription_monto_positivo",
            ),
        ]
        ordering = ["-fecha_proximo_cobro"]
        verbose_name = "Suscripción"
        verbose_name_plural = "Suscripciones"

    def __str__(self) -> str:
        return f"{self.nombre} ({self.get_frecuencia_display()}) – {self.monto} {self.moneda}"


class Proveedor(ModeloBase):
    """Empresa que presta un servicio por suscripción: Netflix, Spotify, un gimnasio.

    Es un **catálogo global**: Netflix es Netflix para todas las organizaciones.
    Por eso hereda de `ModeloBase` y no de `ModeloTenant`, o sea no lleva
    `organizacion_id` (ver `docs/glosario.md`).
    """

    nombre = models.CharField(
        max_length=100,
        unique=True,
        verbose_name="Nombre del proveedor",
    )

    categoria = models.CharField(
        max_length=20,
        choices=Subscription.Categoria.choices,
        default=Subscription.Categoria.OTRO,
        verbose_name="Categoría",
    )

    sitio_web = models.URLField(blank=True, verbose_name="Sitio web")

    class Meta(ModeloBase.Meta):
        db_table = "proveedor"
        ordering = ["nombre"]
        verbose_name = "Proveedor"
        verbose_name_plural = "Proveedores"

    def __str__(self) -> str:
        return self.nombre


class Cobro(ModeloTenant):
    """Un pago concreto y YA OCURRIDO de una suscripción.

    No confundir con el `monto` de la suscripción, que es el valor *esperado*
    del próximo cobro. La diferencia entre los dos es justamente lo que permite
    detectar un alza de precio: por eso el cobro guarda su propio monto y no
    se calcula desde la suscripción.
    """

    suscripcion = models.ForeignKey(
        Subscription,
        on_delete=models.CASCADE,
        related_name="cobros",
        verbose_name="Suscripción",
    )

    monto = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        verbose_name="Monto cobrado",
    )

    moneda = models.CharField(
        max_length=3,
        choices=Subscription.Moneda.choices,
        default=Subscription.Moneda.CLP,
        verbose_name="Moneda",
    )

    fecha = models.DateField(verbose_name="Fecha del cobro")

    class Meta(ModeloTenant.Meta):
        db_table = "cobro"
        ordering = ["-fecha"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(monto__gt=Decimal("0")),
                name="cobro_monto_positivo",
            ),
        ]
        indexes = [
            models.Index(fields=["organizacion_id", "-fecha"]),
            models.Index(fields=["suscripcion", "-fecha"]),
        ]
        verbose_name = "Cobro"
        verbose_name_plural = "Cobros"

    def __str__(self) -> str:
        return f"{self.suscripcion.nombre}: {self.monto} {self.moneda} el {self.fecha}"

    @property
    def hubo_alza(self) -> bool:
        """True si se cobró más de lo que la suscripción decía esperar."""
        return self.monto > self.suscripcion.monto
