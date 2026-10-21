"""Modelos del servicio de suscripciones – Sprint 1."""

from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import Max
from django.utils import timezone

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

    class EventoEstado(models.TextChoices):
        FIN_PRUEBA = "fin_prueba", "Fin de prueba"
        FALLO_COBRO_INICIAL = "fallo_cobro_inicial", "Fallo de cobro inicial"
        CANCELACION_USUARIO = "cancelacion_usuario", "Cancelación solicitada"
        FALLO_COBRO = "fallo_cobro", "Fallo de cobro recurrente"
        COBRO_REGULARIZADO = "cobro_regularizado", "Cobro regularizado"
        CONFIRMACION_USUARIO = "confirmacion_usuario", "Vigencia confirmada"
        SIN_COBROS_60_DIAS = "sin_cobros_60_dias", "60 días sin cobros"
        SIN_RESPUESTA_30_DIAS = "sin_respuesta_30_dias", "30 días sin respuesta"
        SIN_USO_45_DIAS = "sin_uso_45_dias", "Más de 45 días sin uso"
        USO_REGISTRADO = "uso_registrado", "Uso registrado"
        COBRO_NUEVO_DETECTADO = "cobro_nuevo_detectado", "Cobro nuevo detectado"

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

    activo = models.BooleanField(
        default=True,
        verbose_name="Activa",
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

    ultima_actividad = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Última actividad",
    )

    TRANSICIONES_ESTADO = {
        EventoEstado.FIN_PRUEBA: (
            (Estado.PRUEBA,),
            Estado.ACTIVO,
        ),
        EventoEstado.FALLO_COBRO_INICIAL: (
            (Estado.PRUEBA,),
            Estado.POR_CONFIRMAR,
        ),
        EventoEstado.CANCELACION_USUARIO: (
            (Estado.PRUEBA, Estado.ACTIVO, Estado.POR_CONFIRMAR, Estado.FANTASMA),
            Estado.CANCELADO,
        ),
        EventoEstado.FALLO_COBRO: (
            (Estado.ACTIVO,),
            Estado.POR_CONFIRMAR,
        ),
        EventoEstado.COBRO_REGULARIZADO: (
            (Estado.POR_CONFIRMAR,),
            Estado.ACTIVO,
        ),
        EventoEstado.CONFIRMACION_USUARIO: (
            (Estado.POR_CONFIRMAR,),
            Estado.ACTIVO,
        ),
        EventoEstado.SIN_COBROS_60_DIAS: (
            (Estado.ACTIVO,),
            Estado.POR_CONFIRMAR,
        ),
        EventoEstado.SIN_RESPUESTA_30_DIAS: (
            (Estado.POR_CONFIRMAR,),
            Estado.CANCELADO,
        ),
        EventoEstado.SIN_USO_45_DIAS: (
            (Estado.ACTIVO, Estado.POR_CONFIRMAR),
            Estado.FANTASMA,
        ),
        EventoEstado.USO_REGISTRADO: (
            (Estado.FANTASMA,),
            Estado.ACTIVO,
        ),
        EventoEstado.COBRO_NUEVO_DETECTADO: (
            tuple(Estado.values),
            Estado.ACTIVO,
        ),
    }

    def _fecha_ultimo_cobro(self):
        fecha = self.cobros.aggregate(fecha=Max("fecha"))["fecha"]
        return fecha or timezone.localtime(self.creado_en).date()

    def _validar_tiempo_transicion(self, evento: str) -> None:
        hoy = timezone.localdate()

        if evento == self.EventoEstado.FIN_PRUEBA:
            if self.fin_prueba is None or self.fin_prueba > hoy:
                raise ValidationError(
                    "La prueba solo puede finalizar en o después de fin_prueba."
                )

        if evento == self.EventoEstado.SIN_COBROS_60_DIAS:
            dias_sin_cobro = (hoy - self._fecha_ultimo_cobro()).days
            if dias_sin_cobro < 60:
                raise ValidationError(
                    "Se requieren 60 días consecutivos sin cobros registrados."
                )

        if evento == self.EventoEstado.SIN_RESPUESTA_30_DIAS:
            ultima_transicion = (
                self.transiciones_estado.filter(
                    estado_nuevo=self.Estado.POR_CONFIRMAR
                )
                .order_by("-ocurrido_en")
                .first()
            )
            desde_confirmacion = (
                timezone.localtime(ultima_transicion.ocurrido_en).date()
                if ultima_transicion
                else timezone.localtime(self.creado_en).date()
            )
            dias_en_confirmacion = (hoy - desde_confirmacion).days
            dias_sin_cobro = (hoy - self._fecha_ultimo_cobro()).days
            if dias_en_confirmacion < 30 or dias_sin_cobro < 90:
                raise ValidationError(
                    "Se requieren 30 días en por_confirmar y 90 días sin cobros."
                )

        if evento == self.EventoEstado.SIN_USO_45_DIAS:
            fecha_uso = self.usos.aggregate(fecha=Max("fecha"))["fecha"]
            ultima_confirmacion = (
                self.transiciones_estado.filter(
                    evento=self.EventoEstado.CONFIRMACION_USUARIO
                )
                .order_by("-ocurrido_en")
                .first()
            )
            fechas_actividad = [
                fecha
                for fecha in (
                    fecha_uso,
                    timezone.localtime(self.ultima_actividad).date()
                    if self.ultima_actividad
                    else None,
                    timezone.localtime(ultima_confirmacion.ocurrido_en).date()
                    if ultima_confirmacion
                    else None,
                )
                if fecha is not None
            ]
            ultima_actividad = max(
                fechas_actividad or [timezone.localtime(self.creado_en).date()]
            )
            if (hoy - ultima_actividad).days <= 45:
                raise ValidationError(
                    "Se requieren más de 45 días consecutivos sin uso ni confirmación."
                )

    def transicionar(
        self,
        evento: str,
        *,
        actor_id=None,
        actor_rol: str = "sistema",
        correlation_id=None,
    ) -> "TransicionEstado":
        """Valida y audita una transición de estado bajo bloqueo de fila."""
        try:
            evento = self.EventoEstado(evento)
        except (TypeError, ValueError) as exc:
            raise ValidationError({"evento": "Evento de estado desconocido."}) from exc

        if evento not in self.TRANSICIONES_ESTADO:
            raise ValidationError({"evento": "Evento de estado desconocido."})

        with transaction.atomic():
            suscripcion = type(self).objects.select_for_update().get(pk=self.pk)
            if not suscripcion.activo:
                raise ValidationError(
                    "Una suscripción desactivada no admite transiciones de estado."
                )

            estados_origen, estado_destino = self.TRANSICIONES_ESTADO[evento]
            if suscripcion.estado not in estados_origen:
                raise ValidationError(
                    {
                        "estado": (
                            f"El evento {evento} no está permitido desde "
                            f"{suscripcion.estado}."
                        )
                    }
                )

            suscripcion._validar_tiempo_transicion(evento)
            estado_anterior = suscripcion.estado
            suscripcion.estado = estado_destino
            suscripcion.save(update_fields=("estado", "actualizado_en"))
            transicion = TransicionEstado.objects.create(
                organizacion_id=suscripcion.organizacion_id,
                suscripcion=suscripcion,
                evento=evento,
                estado_anterior=estado_anterior,
                estado_nuevo=estado_destino,
                actor_id=actor_id,
                actor_rol=actor_rol,
            )
            from events.outbox import registrar_estado_cambiado

            registrar_estado_cambiado(
                suscripcion,
                estado_anterior=estado_anterior,
                evento_estado=evento,
                correlation_id=correlation_id,
            )

        self.estado = estado_destino
        self.actualizado_en = suscripcion.actualizado_en
        return transicion

    def registrar_uso(
        self,
        minutos: int | Decimal,
        fecha=None,
        *,
        actor_id=None,
        actor_rol: str = "sistema",
        correlation_id=None,
    ) -> "RegistroUso":
        """Registra minutos de uso, actualiza ultima_actividad, horas_uso_mes, reactiva estado si era fantasma y persiste el registro histórico."""
        with transaction.atomic():
            suscripcion = type(self).objects.select_for_update().get(pk=self.pk)
            if not suscripcion.activo:
                raise ValidationError(
                    "Una suscripción desactivada no admite registros de uso."
                )

            if fecha is None:
                fecha = timezone.localdate()

            suscripcion.ultima_actividad = timezone.now()
            fecha_actual = timezone.localdate()
            if (fecha.year, fecha.month) == (fecha_actual.year, fecha_actual.month):
                horas = (Decimal(str(minutos)) / Decimal("60")).quantize(Decimal("0.01"))
                if suscripcion.horas_uso_mes is None:
                    suscripcion.horas_uso_mes = Decimal("0.00")
                suscripcion.horas_uso_mes += horas

            if suscripcion.estado == self.Estado.FANTASMA:
                suscripcion.transicionar(
                    self.EventoEstado.USO_REGISTRADO,
                    actor_id=actor_id,
                    actor_rol=actor_rol,
                    correlation_id=correlation_id,
                )

            suscripcion.save(
                update_fields=("ultima_actividad", "horas_uso_mes", "actualizado_en")
            )

            self.estado = suscripcion.estado
            self.ultima_actividad = suscripcion.ultima_actividad
            self.horas_uso_mes = suscripcion.horas_uso_mes
            self.actualizado_en = suscripcion.actualizado_en

            return RegistroUso.objects.create(
                organizacion_id=suscripcion.organizacion_id,
                suscripcion=suscripcion,
                fecha=fecha,
                minutos=int(minutos),
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
        ordering = ["-fecha_proximo_cobro", "id"]
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


class RegistroUso(ModeloTenant):
    """Registro histórico de uso de una suscripción en una fecha determinada (CU-23 / RF-04 / RF-15)."""

    suscripcion = models.ForeignKey(
        Subscription,
        on_delete=models.CASCADE,
        related_name="usos",
        verbose_name="Suscripción",
    )

    fecha = models.DateField(verbose_name="Fecha de uso")

    minutos = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
        verbose_name="Minutos de uso",
    )

    class Meta(ModeloTenant.Meta):
        db_table = "registro_uso"
        ordering = ["-fecha", "-creado_en"]
        indexes = [
            models.Index(fields=["organizacion_id", "-fecha"]),
            models.Index(fields=["suscripcion", "-fecha"]),
        ]
        verbose_name = "Registro de uso"
        verbose_name_plural = "Registros de uso"

    def __str__(self) -> str:
        return f"{self.suscripcion.nombre} - {self.fecha}: {self.minutos} min"


class TransicionEstado(ModeloTenant):
    """Registro inmutable de cada evento que cambia el estado de una suscripción."""

    suscripcion = models.ForeignKey(
        Subscription,
        on_delete=models.CASCADE,
        related_name="transiciones_estado",
        verbose_name="Suscripción",
    )
    evento = models.CharField(
        max_length=40,
        choices=Subscription.EventoEstado.choices,
        verbose_name="Evento autorizado",
    )
    estado_anterior = models.CharField(
        max_length=20,
        choices=Subscription.Estado.choices,
        verbose_name="Estado anterior",
    )
    estado_nuevo = models.CharField(
        max_length=20,
        choices=Subscription.Estado.choices,
        verbose_name="Estado nuevo",
    )
    actor_id = models.UUIDField(null=True, blank=True, verbose_name="Actor")
    actor_rol = models.CharField(max_length=20, blank=True, verbose_name="Rol del actor")
    ocurrido_en = models.DateTimeField(auto_now_add=True, verbose_name="Ocurrido en")

    class Meta(ModeloTenant.Meta):
        db_table = "subscription_state_transition"
        ordering = ["ocurrido_en", "id"]
        indexes = [
            models.Index(fields=["organizacion_id", "suscripcion", "ocurrido_en"]),
        ]
        verbose_name = "Transición de estado"
        verbose_name_plural = "Transiciones de estado"


class OutboxEvento(ModeloTenant):
    """Evento durable pendiente de publicación después del commit de dominio."""

    evento = models.CharField(max_length=40)
    version = models.PositiveSmallIntegerField(default=2)
    ocurrido_en = models.DateTimeField(default=timezone.now)
    correlation_id = models.UUIDField()
    datos = models.JSONField()
    publicado_en = models.DateTimeField(null=True, blank=True)
    intentos = models.PositiveIntegerField(default=0)
    siguiente_intento = models.DateTimeField(default=timezone.now)
    ultimo_error = models.CharField(max_length=100, blank=True)

    class Meta(ModeloTenant.Meta):
        db_table = "subscription_event_outbox"
        ordering = ["creado_en", "id"]
        indexes = [
            models.Index(
                fields=["publicado_en", "siguiente_intento"],
                name="sub_outbox_pending_idx",
            ),
        ]
        verbose_name = "Evento pendiente"
        verbose_name_plural = "Eventos pendientes"
