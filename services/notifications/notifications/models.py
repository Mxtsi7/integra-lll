"""Modelos del servicio de notificaciones — FE-16."""

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Value
from django.db.models.functions import Coalesce
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

    # ── marcas de lectura ────────────────────────────────────────────
    #
    # Las dos se hacen con un UPDATE condicionado por el estado actual EN LA
    # BASE, no comparando `self.lectura` en memoria. La versión anterior hacía
    # `if self.lectura != PENDIENTE: return` y después un save sin condición:
    # con dos instancias cargadas en paralelo, la segunda pisaba a la primera.
    # Marcar una revisada y después leída desde otra instancia dejaba la fila
    # en `leida` con `revisada_en` ya informado, un estado que no existe.
    #
    # `filter(...).update(...)` devuelve cuántas filas cambió: 0 significa que
    # otra escritura llegó antes, y entonces no se toca nada.

    def marcar_leida(self, *, cuando=None) -> bool:
        """Pendiente → leída. Devuelve si esta llamada fue la que la cambió.

        Idempotente: si ya estaba leída o revisada, no mueve ninguna fecha.
        """
        ahora = cuando or timezone.now()
        cambiadas = type(self).objects.filter(
            pk=self.pk, lectura=self.Lectura.PENDIENTE
        ).update(lectura=self.Lectura.LEIDA, leida_en=ahora, actualizado_en=ahora)
        if cambiadas:
            self.lectura = self.Lectura.LEIDA
            self.leida_en = ahora
        else:
            # Otra escritura ganó: se recarga para no seguir con datos viejos.
            self.refresh_from_db()
        return bool(cambiadas)

    def marcar_revisada(self, *, cuando=None) -> bool:
        """Descarta la alerta sin tocar la suscripción (RF-07).

        Si estaba pendiente, también queda leída: no tendría sentido una
        alerta revisada que la campana sigue contando como sin ver. La fecha
        de lectura original se conserva con `Coalesce`: solo se rellena si
        estaba vacía.
        """
        ahora = cuando or timezone.now()
        cambiadas = (
            type(self)
            .objects.filter(pk=self.pk)
            .exclude(lectura=self.Lectura.REVISADA)
            .update(
                lectura=self.Lectura.REVISADA,
                revisada_en=ahora,
                leida_en=Coalesce("leida_en", Value(ahora)),
                actualizado_en=ahora,
            )
        )
        self.refresh_from_db()
        return bool(cambiadas)

    # ── meta ─────────────────────────────────────────────────────────

    class Meta(ModeloTenant.Meta):
        db_table = "alerta"
        # `id` como desempate, no solo `-creado_en`. Dos alertas creadas en el
        # mismo instante —que es lo normal cuando las genera un consumidor en
        # lote— no tenían orden total, así que páginas consecutivas podían
        # repetir una fila y saltarse otra. El paginador confía en que el orden
        # sea determinista entre consultas.
        ordering = ["-creado_en", "-id"]
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


class UsuarioEliminado(ModeloTenant):
    """Marca mínima que impide recrear preferencias con solicitudes en vuelo."""

    usuario_id = models.CharField(max_length=64)

    class Meta:
        db_table = "usuario_eliminado"
        constraints = [models.UniqueConstraint(
            fields=["organizacion_id", "usuario_id"], name="usuario_eliminado_tenant",
        )]


class PreferenciaNotificacion(ModeloTenant):
    """Qué avisos quiere recibir una persona, y por dónde (FE-21 / RF-09).

    ── Por qué una fila por persona y no por organización ───────────────────
    Dos personas de la misma organización pueden querer cosas distintas: al
    contador le sirven los avisos de presupuesto y al que usa las cuentas le
    sirven los de fin de prueba. La llave es (organización, usuario), así que
    el aislamiento por tenant de `ModeloTenant` sigue aplicando y además nadie
    ve ni cambia las preferencias de otro.

    ── Por qué columnas y no un JSON ───────────────────────────────────────
    Los cinco tipos son un conjunto CERRADO que sale de los requisitos
    (`Alerta.Tipo`), y los canales también. Con columnas:

    · el esquema dice qué existe, y agregar un tipo es una migración que se
      ve en la revisión, no un string nuevo que aparece en producción;
    · el ORM valida el tipo del valor, en vez de aceptar
      `{"proximo_cobro": "quizás"}`;
    · un PATCH con una clave inventada se rechaza solo.

    Un JSON habría sido más corto y habría aceptado cualquier cosa.

    ── Los canales se piden aunque todavía no se entreguen ─────────────────
    `por_push` existe y se puede encender, pero hoy no hay quién entregue un
    push: eso es FE-22 y más. La preferencia se guarda igual —es lo que la
    persona quiere— y la API informa aparte qué canales están REALMENTE
    habilitados (`canales_disponibles`), para que el frontend no prometa algo
    que no va a llegar. Guardar la intención y poder cumplirla son dos cosas
    distintas y conviene no mezclarlas.
    """

    usuario_id = models.CharField(
        max_length=64,
        verbose_name="Usuario",
        help_text=(
            "El valor crudo de la cabecera `X-Usuario-Id` que inyecta el "
            "gateway. Acá no se interpreta, solo se compara: el id vive en el "
            "esquema de `auth` (ADR-002)."
        ),
    )

    # ── por dónde ────────────────────────────────────────────────────

    por_email = models.BooleanField(
        default=True,
        verbose_name="Avisar por correo",
    )

    por_push = models.BooleanField(
        default=False,
        verbose_name="Avisar por push",
        help_text=(
            "Apagado por omisión a propósito: todavía no hay quién entregue "
            "un push. Encenderlo guarda la intención; que llegue depende de "
            "que el canal exista (ver `CANALES_HABILITADOS`)."
        ),
    )

    en_la_app = models.BooleanField(
        default=True,
        verbose_name="Mostrar dentro de la aplicación",
        help_text="El listado de alertas (FE-19). Siempre entregable.",
    )

    # ── qué avisos ───────────────────────────────────────────────────
    # Uno por cada `Alerta.Tipo`. Si se agrega un tipo allá y no acá, la
    # prueba `test_hay_una_preferencia_por_cada_tipo_de_alerta` falla.

    avisar_proximo_cobro = models.BooleanField(
        default=True, verbose_name="Próximo cobro"
    )
    avisar_fin_prueba = models.BooleanField(
        default=True, verbose_name="Fin de prueba gratuita"
    )
    avisar_alza_tarifa = models.BooleanField(
        default=True, verbose_name="Alza de tarifa"
    )
    avisar_doble_cobro = models.BooleanField(
        default=True, verbose_name="Posible doble cobro"
    )
    avisar_presupuesto_excedido = models.BooleanField(
        default=True, verbose_name="Presupuesto excedido"
    )

    # ── cuándo ───────────────────────────────────────────────────────

    dias_anticipacion = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(1), MaxValueValidator(30)],
        verbose_name="Días de anticipación del aviso de cobro",
        help_text=(
            "Con cuántos días de anticipación avisar un cobro próximo. El "
            "mínimo es 1 (avisar el mismo día no da margen para cancelar) y "
            "el máximo 30 (más que eso es un mes completo y deja de ser un "
            "aviso). 3 por omisión."
        ),
    )

    #: Qué columna gobierna cada tipo de alerta. Está acá y no repartido por
    #: el código para que `debe_avisar` y el serializer digan lo mismo.
    CAMPO_POR_TIPO = {
        Alerta.Tipo.PROXIMO_COBRO: "avisar_proximo_cobro",
        Alerta.Tipo.FIN_PRUEBA: "avisar_fin_prueba",
        Alerta.Tipo.ALZA_TARIFA: "avisar_alza_tarifa",
        Alerta.Tipo.DOBLE_COBRO: "avisar_doble_cobro",
        Alerta.Tipo.PRESUPUESTO_EXCEDIDO: "avisar_presupuesto_excedido",
    }

    #: Igual para los canales.
    CAMPO_POR_CANAL = {
        "email": "por_email",
        "push": "por_push",
        "in_app": "en_la_app",
    }

    def quiere(self, tipo: str) -> bool:
        """¿Quiere recibir avisos de este tipo?"""
        campo = self.CAMPO_POR_TIPO.get(tipo)
        if campo is None:
            # Un tipo que no está en el mapa no se avisa: es más seguro no
            # mandar nada que mandar por un canal que nadie eligió.
            return False
        return getattr(self, campo)

    def canales_elegidos(self) -> list[str]:
        """Los canales encendidos, en orden estable."""
        return [
            canal
            for canal, campo in self.CAMPO_POR_CANAL.items()
            if getattr(self, campo)
        ]

    def debe_avisar(self, tipo: str, canal: str) -> bool:
        """La pregunta que hará FE-17/FE-18 antes de crear una alerta."""
        campo = self.CAMPO_POR_CANAL.get(canal)
        if campo is None:
            return False
        return self.quiere(tipo) and getattr(self, campo)

    class Meta(ModeloTenant.Meta):
        db_table = "preferencia_notificacion"
        constraints = [
            # Una sola fila por persona: las preferencias se reemplazan, no se
            # apilan.
            models.UniqueConstraint(
                fields=["organizacion_id", "usuario_id"],
                name="preferencia_unica_por_tenant_y_usuario",
            ),
        ]
        verbose_name = "Preferencia de notificación"
        verbose_name_plural = "Preferencias de notificación"

    def __str__(self) -> str:
        return f"{self.usuario_id}: {', '.join(self.canales_elegidos()) or 'sin canales'}"
