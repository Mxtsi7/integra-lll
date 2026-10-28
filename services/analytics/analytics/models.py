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


# ═══════════════════════════════════════════════════════════════════
# Uso por periodo (FE-28) y puntaje de bajo uso (FE-29)
# ═══════════════════════════════════════════════════════════════════
#
# Esto es una PROYECCIÓN DE LECTURA. La fuente de verdad del uso es
# `RegistroUso` en el esquema de `subscriptions`, y ningún servicio consulta
# el esquema de otro (ADR-002). Así que el uso llega acá por eventos y se
# guarda copiado, para poder responder sin preguntarle a nadie.
#
# Una sola fuente de ESCRITURA: estas tablas las escribe únicamente el
# consumidor de eventos. No hay POST que las toque. Si alguien pudiera
# escribir el agregado a mano, dejaría de coincidir con los registros fuente
# y el criterio de FE-28 se volvería incomprobable.


class SuscripcionObservada(ModeloTenant):
    """Desde cuándo Analytics sabe que esta suscripción existe (FE-28/FE-29).

    Parece de más y es la pieza que hace posible el criterio difícil de
    FE-29: **separar la falta de datos del uso cero**.

    Sin esta tabla, una suscripción sin ningún registro de uso es
    indistinguible entre dos casos muy distintos:

    · existe hace meses y nadie la usa  → bajo uso de verdad
    · se creó anteayer, o los eventos todavía no llegan → no sabemos

    Afirmar lo primero cuando pasa lo segundo es inventar un hecho. Con la
    fecha desde la que la observamos, la diferencia es comprobable.
    """

    suscripcion_id = models.UUIDField(
        verbose_name="Suscripción en el servicio de suscripciones",
        help_text="UUID suelto, no una FK: la tabla vive en otro esquema (ADR-002).",
    )

    nombre = models.CharField(
        max_length=120,
        blank=True,
        default="",
        verbose_name="Nombre con que se conoce",
        help_text="Copiado del evento, para no tener que preguntarlo al mostrar.",
    )

    observada_desde = models.DateField(
        verbose_name="Observada desde",
        help_text=(
            "La fecha del evento `suscripcion.creada`, no la de hoy: si se "
            "reprocesan los eventos, tiene que dar lo mismo. "
            "OJO: dice cuándo NACIÓ la suscripción, NO desde cuándo tenemos "
            "su uso. Para eso está la cobertura."
        ),
    )

    # ── La antigüedad NO es cobertura ────────────────────────────────
    # Esto salió de la revisión de la PR y es la corrección más importante
    # de FE-29: `observada_desde` sale del `ocurrido_en` del evento
    # `suscripcion.creada`. Si una creación de hace dos meses llega HOY —un
    # backfill, un replay, el consumidor que estuvo caído—, la cuenta de
    # días daba 56 y el puntaje afirmaba `bajo` con `uso_cero_real`, cuando
    # Analytics recién se enteró de que la suscripción existe y no sabe si
    # le falta el historial.
    #
    # Que el negocio sea viejo no demuestra que la proyección haya recibido
    # el periodo. Son dos cosas distintas y ahora se guardan por separado:
    # mientras no haya cobertura acreditada, la clasificación es `sin_datos`.
    #
    # Las llena quien pueda ACREDITAR la ingesta (ver `registrar_cobertura`).
    # Hoy nadie lo hace todavía, porque el consumidor de uso no está
    # cableado: la consecuencia correcta es que la API responda `sin_datos`,
    # no que invente un cero.
    cobertura_desde = models.DateField(
        null=True,
        blank=True,
        verbose_name="Uso acreditado desde",
        help_text="Primer día del periodo cuyo uso sabemos que llegó completo.",
    )

    cobertura_hasta = models.DateField(
        null=True,
        blank=True,
        verbose_name="Uso acreditado hasta",
        help_text=(
            "Último día del periodo acreditado. NULL = no hay cobertura "
            "acreditada, así que no se puede afirmar bajo uso."
        ),
    )

    class Meta(ModeloTenant.Meta):
        db_table = "suscripcion_observada"
        constraints = [
            models.UniqueConstraint(
                fields=["organizacion_id", "suscripcion_id"],
                name="suscripcion_observada_unica_por_tenant",
            ),
        ]
        verbose_name = "Suscripción observada"
        verbose_name_plural = "Suscripciones observadas"

    def __str__(self) -> str:
        return f"{self.nombre or self.suscripcion_id} desde {self.observada_desde}"


class UsoProyectado(ModeloTenant):
    """Un registro de uso de Subscriptions, copiado acá (FE-28).

    ── Esta tabla ES la idempotencia ───────────────────────────────────────
    `evento_id` es único: es el `id` del sobre, que el catálogo designa para
    descartar duplicados. Reprocesar un evento ya aplicado choca con la
    restricción y no suma nada. Es el criterio "reprocesar no duplica
    minutos", y se cumple en la base, no en un `if` que alguien pueda sacar.

    RabbitMQ garantiza *al menos una* entrega, así que el reproceso no es una
    hipótesis: pasa cada vez que un consumidor muere entre el trabajo y el ack.

    La alternativa —ir sumando minutos sobre el agregado— se descartó: cada
    redelivery lo inflaba y no había forma de volver atrás, porque el
    agregado ya no se podía reconstruir desde ningún lado.
    """

    evento_id = models.UUIDField(
        unique=True,
        verbose_name="Id del evento que lo trajo",
        help_text=(
            "El campo `id` del sobre, que el catálogo designa para descartar "
            "duplicados (regla 1). Único a nivel global, no por organización. "
            "Si algún día la carga de `uso.registrado` trae el id del "
            "registro de origen, esa llave sería más fuerte que esta: dos "
            "publicaciones distintas del MISMO uso tienen ids de sobre "
            "distintos y esta llave no las uniría."
        ),
    )

    suscripcion_id = models.UUIDField(
        db_index=True,
        verbose_name="Suscripción",
    )

    fecha = models.DateField(verbose_name="Fecha del uso")

    minutos = models.PositiveIntegerField(verbose_name="Minutos de uso")

    class Meta(ModeloTenant.Meta):
        db_table = "uso_proyectado"
        ordering = ["-fecha"]
        indexes = [
            models.Index(
                fields=["organizacion_id", "suscripcion_id", "fecha"],
                name="uso_proyectado_org_susc_fecha",
            ),
        ]
        verbose_name = "Uso proyectado"
        verbose_name_plural = "Usos proyectados"

    def __str__(self) -> str:
        return f"{self.suscripcion_id} el {self.fecha}: {self.minutos} min"


class UsoMensual(ModeloTenant):
    """El agregado mensual por suscripción (FE-28).

    No se acumula: se **recalcula** desde `UsoProyectado` cada vez que llega
    un registro del mes. Es más trabajo por evento y a cambio el agregado es
    una función pura de los registros, así que siempre coincide con ellos —el
    primer criterio de FE-28— y los datos tardíos no necesitan nada especial:
    un registro de marzo que llega en octubre recalcula marzo y ya.
    """

    suscripcion_id = models.UUIDField(verbose_name="Suscripción")

    mes = models.DateField(
        verbose_name="Mes (día 1)",
        help_text="Siempre el día 1. Se guarda como fecha y no como texto para poder ordenar y comparar.",
    )

    minutos = models.PositiveIntegerField(default=0, verbose_name="Minutos en el mes")

    dias_con_uso = models.PositiveIntegerField(
        default=0,
        verbose_name="Días con uso",
        help_text="Cuántos días distintos tuvieron uso. 300 minutos en un día no es lo mismo que 10 al día.",
    )

    ultimo_uso = models.DateField(
        null=True,
        blank=True,
        verbose_name="Último día con uso del mes",
    )

    class Meta(ModeloTenant.Meta):
        db_table = "uso_mensual"
        ordering = ["-mes", "suscripcion_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["organizacion_id", "suscripcion_id", "mes"],
                name="uso_mensual_unico_por_tenant_suscripcion_mes",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organizacion_id", "-mes"],
                name="uso_mensual_org_mes",
            ),
        ]
        verbose_name = "Uso mensual"
        verbose_name_plural = "Usos mensuales"

    def __str__(self) -> str:
        return f"{self.suscripcion_id} {self.mes:%Y-%m}: {self.minutos} min"


class RecomendacionConsolidacion(ModeloTenant):
    """Recomendación emitida por VI-20, persistida para su consulta y descarte.

    El ``id`` es el identificador determinista del evento que creó la fila: un
    replay del mismo evento reusa la misma fila en vez de duplicarla. La
    identidad de negocio es ``(organizacion_id, tipo, suscripcion_id,
    evidencia_id)``; un nuevo snapshot del mismo hallazgo actualiza esta fila
    conservando el ``id``, para que el descarte temporal de VI-18 siga
    apuntando al mismo hallazgo. Una evidencia distinta sí es otro hallazgo.
    ``ocurrido_en_origen`` conserva la fecha del snapshot para que una entrega
    fuera de orden no reemplace datos más recientes. El descarte es una
    preferencia temporal en ``RecomendacionDescartada``, no un cambio de
    ``estado``.
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


DIAS_VIGENCIA_DESCARTE_DEFAULT = 30
DIAS_VIGENCIA_DESCARTE_MAX = 365


class RecomendacionDescartada(ModeloTenant):
    """Descarte de una recomendación con vigencia y actor (VI-18).

    El descarte es una preferencia de la organización, no un cambio de estado
    de la recomendación: mientras ``vigente_hasta`` esté en el futuro la
    recomendación se excluye del listado y, al expirar, vuelve a mostrarse sin
    perder el registro de quién la descartó ni por qué.
    """

    recomendacion = models.ForeignKey(
        RecomendacionConsolidacion,
        on_delete=models.CASCADE,
        related_name="descartes",
        verbose_name="Recomendación",
    )
    motivo = models.CharField(
        max_length=200,
        blank=True,
        default="",
        verbose_name="Motivo del descarte",
    )
    descartado_por = models.BigIntegerField(
        null=True,
        blank=True,
        verbose_name="Usuario que descartó",
    )
    vigente_hasta = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Vigente hasta",
    )

    class Meta(ModeloTenant.Meta):
        db_table = "recomendacion_descartada"
        constraints = [
            models.UniqueConstraint(
                fields=["organizacion_id", "recomendacion"],
                name="recomendacion_descartada_unica_org_rec",
            ),
        ]
        verbose_name = "Recomendación descartada"
        verbose_name_plural = "Recomendaciones descartadas"

    def __str__(self) -> str:
        return f"Descarte de {self.recomendacion_id} (Org: {self.organizacion_id})"
