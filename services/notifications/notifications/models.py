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


class SuscripcionVigilada(ModeloTenant):
    """Lo que notifications sabe de cada suscripción, copiado de los eventos (FE-17 / FE-18).

    ── Por qué una copia y no una consulta ──────────────────────────────────
    Para avisar "Netflix se cobra en 3 días" hay que saber cuándo se cobra
    Netflix, y eso vive en el esquema de `subscriptions`, que ningún otro
    servicio consulta (ADR-002). El dato llega por los eventos del catálogo
    (`suscripcion.creada`, `.actualizada`, `.estado_cambiado`) y se guarda
    acá: es una PROYECCIÓN de lectura, igual que la de uso en analytics.

    La escribe únicamente `proyeccion.aplicar()` a partir de un sobre. No hay
    POST que la toque: si alguien pudiera escribirla a mano dejaría de
    coincidir con la fuente y las alertas avisarían fechas inventadas.

    ── Qué pasa con la fecha de fin de prueba ──────────────────────────────
    El contrato MX-21 v2 NO la trae: `$defs/suscripcion` tiene
    `proximo_cobro` pero no `fin_prueba`, aunque `Subscription` sí la tiene.
    Se guarda si el sobre la trae (`datos.fin_prueba`, una extensión que hay
    que acordar con VI-26) y queda en NULL si no. Sin fecha no hay aviso de
    fin de prueba: es el criterio de FE-18, "prueba sin fecha válida no
    genera envío", y es mejor que adivinarla desde `proximo_cobro`.
    """

    suscripcion_id = models.UUIDField(
        verbose_name="Suscripción",
        help_text="UUID suelto, no FK: vive en el esquema de subscriptions (ADR-002).",
    )
    nombre = models.CharField(max_length=120, blank=True, default="")
    monto = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    moneda = models.CharField(max_length=3, default="CLP")
    ciclo = models.CharField(max_length=10, default="mensual")
    proximo_cobro = models.DateField(
        null=True,
        blank=True,
        verbose_name="Próximo cobro",
    )
    estado = models.CharField(
        max_length=20,
        verbose_name="Estado en subscriptions",
        help_text="Tal como viene en el evento: prueba, activo, por_confirmar, cancelado, fantasma.",
    )
    fin_prueba = models.DateField(
        null=True,
        blank=True,
        verbose_name="Fin del período de prueba",
        help_text="Solo si el evento la trae. NULL = no se sabe, y no se avisa.",
    )
    observada_en = models.DateTimeField(
        verbose_name="Fecha del último evento aplicado",
        help_text=(
            "El `ocurrido_en` del evento más reciente que se aplicó. Un evento "
            "más viejo que llega después (reentrega, fuera de orden) no pisa "
            "datos más nuevos."
        ),
    )

    #: Los estados en que una suscripción puede generar un aviso de cobro.
    ESTADOS_VIGENTES = ("activo", "prueba")

    @property
    def vigente(self) -> bool:
        return self.estado in self.ESTADOS_VIGENTES

    class Meta(ModeloTenant.Meta):
        db_table = "suscripcion_vigilada"
        constraints = [
            models.UniqueConstraint(
                fields=["organizacion_id", "suscripcion_id"],
                name="suscripcion_vigilada_unica_por_tenant",
            ),
        ]
        indexes = ModeloTenant.Meta.indexes + [
            # El generador recorre las vigentes por fecha de cobro.
            models.Index(
                fields=["estado", "proximo_cobro"],
                name="vigilada_estado_cobro",
            ),
        ]
        verbose_name = "Suscripción vigilada"
        verbose_name_plural = "Suscripciones vigiladas"

    def __str__(self) -> str:
        return f"{self.nombre or self.suscripcion_id} ({self.estado}, cobra {self.proximo_cobro})"


class EventoRecibido(ModeloTenant):
    """El inbox del consumidor de RabbitMQ (FE-24 / MX-21).

    RabbitMQ entrega **al menos una vez**: un ack perdido, un reinicio en
    medio del trabajo o un replay traen el mismo mensaje otra vez, con el
    mismo `id`. MX-21 pide unicidad `(consumidor, organizacion_id, id)` y que
    el efecto se guarde en la MISMA transacción que esta fila.

    ── Por qué el INSERT y no un SELECT previo ─────────────────────────────
    La tentación es `if EventoRecibido.objects.filter(...).exists(): return`.
    Eso no deduplica nada: con dos consumidores (o uno reconectado mientras el
    otro trabaja) los dos hacen el SELECT, los dos lo ven vacío, y los dos
    hacen el efecto. La única garantía real es la restricción única: se
    INSERTA y, si choca, el mensaje ya se procesó. El guardia vive en la base,
    no en memoria.

    ── Por qué `consumidor` ────────────────────────────────────────────────
    Un mismo evento puede llegar a dos colas con efectos distintos. Sin esa
    columna, el inbox de una cola haría que la otra diera su mensaje por
    procesado y no hiciera nada nunca.

    No se expira: MX-21 dice explícitamente que no se acorte la ventana de
    replay sin acordarla. Cuando haga falta purgar, es una tarea aparte con
    una ventana decidida, no un borrado silencioso acá.
    """

    #: Qué cola lo procesó. Los valores los fija `events.topologia`.
    consumidor = models.CharField(
        max_length=40,
        verbose_name="Consumidor",
        help_text="El nombre de la cola que procesó el mensaje.",
    )
    evento_id = models.UUIDField(
        verbose_name="Id del evento",
        help_text=(
            "El `id` del sobre, que el catálogo designa para descartar "
            "duplicados. Nace una vez por hecho: reintentos y reentregas "
            "conservan el mismo."
        ),
    )
    evento = models.CharField(
        max_length=60,
        verbose_name="Nombre del evento",
        help_text="Para poder mirar el inbox sin volver a leer el cuerpo.",
    )
    ocurrido_en = models.DateTimeField(
        verbose_name="Ocurrido en",
        help_text=(
            "Cuándo pasó el hecho, según el productor. Distinto de "
            "`creado_en`, que es cuándo lo procesamos: la diferencia entre "
            "los dos es el retraso real de la cola."
        ),
    )
    hubo_efecto = models.BooleanField(
        default=True,
        verbose_name="Hubo efecto",
        help_text=(
            "False cuando el sobre era válido pero no cambió nada (un evento "
            "más viejo que la proyección). Se registra igual para no volver a "
            "procesarlo, y la bandera distingue 'no hizo falta' de 'se hizo'."
        ),
    )

    class Meta(ModeloTenant.Meta):
        db_table = "evento_recibido"
        constraints = [
            models.UniqueConstraint(
                fields=["consumidor", "organizacion_id", "evento_id"],
                name="evento_recibido_unico_por_consumidor",
            ),
        ]
        verbose_name = "Evento recibido"
        verbose_name_plural = "Eventos recibidos"

    def __str__(self) -> str:
        return f"{self.consumidor} <- {self.evento} ({self.evento_id})"


class AlertaPorEntregar(ModeloTenant):
    """El outbox de `alerta.activada` (FE-24 / MX-21).

    Una alerta creada no se publica en el acto: se deja acá, en la MISMA
    transacción que la alerta, y un proceso aparte (`publicar_alertas`) la
    manda al broker después del commit. Es el patrón outbox, por la misma
    razón que en Subscriptions: si se publicara dentro de la transacción y el
    commit fallara, el evento ya estaría afuera anunciando algo que no pasó;
    y si se publicara después sin dejar rastro, un corte entre el commit y el
    publish perdería el evento sin que nada avise.

    ── El `id` de la fila ES el `id` del evento ────────────────────────────
    `ModeloTenant` ya trae un UUID de clave primaria, así que no hace falta
    una segunda columna. Eso da gratis lo que pide el contrato: el `id` nace
    una vez y los reintentos conservan el mismo, porque reintentar es volver a
    publicar ESTA fila.

    ── Una fila por persona, no por alerta ─────────────────────────────────
    `alerta.activada` exige `usuario_id`, pero las alertas son de la
    organización (así está modelado FE-16). El evento es de ENTREGA: una fila
    por cada persona de la organización que quiere ese tipo de aviso por algún
    canal. Dos personas con el aviso encendido son dos entregas del mismo
    hecho, con ids distintos y el mismo `correlation_id`.
    """

    #: Lo que el contrato llama `evento` y `version`. Son constantes de
    #: clase y no columnas: esta tabla publica un solo tipo de evento, y
    #: `routing_key` las lee igual que las lee de una fila de Subscriptions.
    evento = "alerta.activada"
    version = 2

    alerta = models.ForeignKey(
        "Alerta",
        on_delete=models.CASCADE,
        related_name="entregas",
        verbose_name="Alerta",
    )
    usuario_id = models.BigIntegerField(
        validators=[MinValueValidator(1)],
        verbose_name="Usuario",
        help_text=(
            "Entero positivo, coherente con `auth.User.id` (BigAutoField), "
            "como exige MX-21 v2. OJO: `PreferenciaNotificacion.usuario_id` "
            "es texto (el valor crudo de la cabecera), asi que aca se "
            "convierte y una preferencia con un id no numerico NO produce "
            "entrega: publicar un `usuario_id` invalido rompe el contrato."
        ),
    )
    correlation_id = models.UUIDField(
        verbose_name="Correlación",
        help_text=(
            "Compartido por todas las entregas de la misma alerta. Un job sin "
            "petición HTTP genera la suya al empezar y la conserva durante "
            "sus reintentos."
        ),
    )
    programada_para = models.DateTimeField(
        verbose_name="Programada para",
        help_text=(
            "El instante de la alerta. El contrato exige "
            "`programada_para <= ocurrido_en`: se anuncia una alerta que YA "
            "venció, no una futura."
        ),
    )

    publicado_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Publicado en",
        help_text="NULL mientras sigue pendiente de publicar.",
    )
    intentos = models.PositiveSmallIntegerField(
        default=0,
        verbose_name="Intentos de publicación",
    )
    ultimo_error = models.TextField(
        blank=True,
        default="",
        verbose_name="Último error de publicación",
        help_text="Sin cuerpos ni secretos: el motivo y nada más.",
    )

    class Meta(ModeloTenant.Meta):
        db_table = "alerta_por_entregar"
        constraints = [
            # Una entrega por alerta y persona. Si el generador corre dos
            # veces, la alerta ya existe y no se vuelve a encolar; si algo
            # intentara encolar igual, choca acá en vez de duplicar el aviso.
            models.UniqueConstraint(
                fields=["alerta", "usuario_id"],
                name="entrega_unica_por_alerta_y_usuario",
            ),
        ]
        indexes = ModeloTenant.Meta.indexes + [
            # El despachador busca las pendientes, que son pocas entre muchas.
            models.Index(
                fields=["publicado_en"],
                condition=models.Q(publicado_en__isnull=True),
                name="entrega_pendiente",
            ),
        ]
        verbose_name = "Alerta por entregar"
        verbose_name_plural = "Alertas por entregar"

    def __str__(self) -> str:
        estado = "publicada" if self.publicado_en else "pendiente"
        return f"entrega de {self.alerta_id} a {self.usuario_id} ({estado})"
