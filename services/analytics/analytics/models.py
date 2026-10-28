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
