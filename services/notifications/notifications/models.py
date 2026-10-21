"""Modelos del servicio de notificaciones — FE-16."""

from django.db import models
from django.utils import timezone

from shared.tenant.base import ModeloTenant


class Alerta(ModeloTenant):
    """Un aviso dirigido a una organización, con su estado de lectura.

    Las alertas no se piden: nacen de que algo pasó. Hoy las crea quien tenga
    el dato a mano; cuando FE-24 conecte el consumidor de RabbitMQ, van a
    nacer de los eventos del catálogo (`shared/events/catalogo.md`).
    """

    class Tipo(models.TextChoices):
        # Los cinco tipos que piden los requisitos. RF-09 permite activarlos
        # o apagarlos por separado, así que conviene que sean valores y no
        # texto libre: una preferencia apunta a uno de estos.
        PROXIMO_COBRO = "proximo_cobro", "Próximo cobro"          # RF-09
        FIN_PRUEBA = "fin_prueba", "Fin de prueba gratuita"       # RF-09
        ALZA_TARIFA = "alza_tarifa", "Alza de tarifa"             # RF-07
        DOBLE_COBRO = "doble_cobro", "Posible doble cobro"        # RF-07
        PRESUPUESTO_EXCEDIDO = "presupuesto_excedido", "Presupuesto excedido"  # RF-13

    class Lectura(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        LEIDA = "leida", "Leída"
        # "Revisada" no es lo mismo que "leída": RF-07 dice que el usuario
        # puede descartar una anomalía sin que el estado de la suscripción
        # cambie. Verla y darla por resuelta son dos cosas distintas.
        REVISADA = "revisada", "Revisada"

    # ── qué avisa ────────────────────────────────────────────────────

    tipo = models.CharField(
        max_length=24,
        choices=Tipo.choices,
        verbose_name="Tipo de alerta",
    )
    titulo = models.CharField(
        max_length=120,
        verbose_name="Título",
    )
    mensaje = models.TextField(
        verbose_name="Mensaje",
    )

    # ── a qué se refiere ─────────────────────────────────────────────

    suscripcion_id = models.UUIDField(
        null=True,
        blank=True,
        verbose_name="Suscripción",
        help_text=(
            "UUID suelto, no una clave foránea: la suscripción vive en el "
            "esquema de subscriptions y ningún servicio consulta el de otro "
            "(ADR-002). Queda vacío en las alertas que no son de una "
            "suscripción, como el presupuesto excedido."
        ),
    )
    datos = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Datos del aviso",
        help_text=(
            "Lo propio de cada tipo: montos comparados en un alza, las dos "
            "fechas de un doble cobro, los días que faltan para un cobro. "
            "Va acá y no en columnas para no agregar una por cada tipo nuevo."
        ),
    )

    # ── de dónde salió ───────────────────────────────────────────────

    evento_id = models.UUIDField(
        null=True,
        blank=True,
        verbose_name="Evento de origen",
        help_text=(
            "El `id` del evento que la originó. La regla 1 del catálogo dice "
            "que los consumidores tienen que ser idempotentes, porque "
            "RabbitMQ entrega *al menos* una vez. Guardarlo con una "
            "restricción de unicidad convierte el segundo intento en un "
            "error de integridad en vez de una alerta duplicada."
        ),
    )

    # ── estado de lectura ────────────────────────────────────────────

    lectura = models.CharField(
        max_length=12,
        choices=Lectura.choices,
        default=Lectura.PENDIENTE,
        verbose_name="Estado de lectura",
    )
    leida_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Leída en",
    )
    revisada_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Revisada en",
    )

    # ── comportamiento ───────────────────────────────────────────────

    @property
    def pendiente(self) -> bool:
        """Lo que cuenta la campana del frontend (FE-20)."""
        return self.lectura == self.Lectura.PENDIENTE

    def marcar_leida(self, *, cuando=None) -> None:
        """Idempotente: volver a marcarla no mueve la fecha original."""
        if self.lectura != self.Lectura.PENDIENTE:
            return
        self.lectura = self.Lectura.LEIDA
        self.leida_en = cuando or timezone.now()
        self.save(update_fields=["lectura", "leida_en", "actualizado_en"])

    def marcar_revisada(self, *, cuando=None) -> None:
        """Descarta la alerta sin tocar la suscripción (RF-07).

        Si estaba pendiente, también queda leída: no tendría sentido una
        alerta revisada que la campana sigue contando como sin ver.
        """
        if self.lectura == self.Lectura.REVISADA:
            return
        ahora = cuando or timezone.now()
        if self.leida_en is None:
            self.leida_en = ahora
        self.lectura = self.Lectura.REVISADA
        self.revisada_en = ahora
        self.save(
            update_fields=["lectura", "leida_en", "revisada_en", "actualizado_en"]
        )

    # ── meta ─────────────────────────────────────────────────────────

    class Meta(ModeloTenant.Meta):
        db_table = "alerta"
        constraints = [
            # Un evento genera una alerta y nada más. Es lo que hace
            # idempotente al consumidor de FE-24 sin que tenga que llevar
            # una lista de ids ya vistos.
            models.UniqueConstraint(
                fields=["organizacion_id", "evento_id"],
                condition=models.Q(evento_id__isnull=False),
                name="alerta_unica_por_evento",
            ),
        ]
        indexes = ModeloTenant.Meta.indexes + [
            # El listado con filtro de FE-19 y el contador de FE-20.
            models.Index(
                fields=["organizacion_id", "lectura"],
                name="alerta_org_lectura",
            ),
        ]
        verbose_name = "Alerta"
        verbose_name_plural = "Alertas"

    def __str__(self) -> str:
        return f"{self.get_tipo_display()}: {self.titulo} ({self.get_lectura_display()})"
