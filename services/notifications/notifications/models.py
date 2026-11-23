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

    # ── S3-FE-22: un aviso que ya no corresponde ─────────────────────
    # Un próximo cobro o un fin de prueba se calculan con la suscripción de
    # ESE momento. Si después cambia la fecha o la suscripción se cancela, el
    # aviso viejo queda obsoleto: no se muestra en la campana ni sale por
    # correo. No se borra, para que se vea qué pasó.
    invalidada_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Obsoleta desde",
    )
    motivo_invalidacion = models.CharField(
        max_length=24,
        blank=True,
        default="",
        verbose_name="Por qué quedó obsoleta",
        help_text="cobro_cambiado, prueba_cambiada, no_vigente o prueba_terminada.",
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

    @classmethod
    def de_la_organizacion(cls, organizacion_id) -> list["PreferenciaNotificacion"]:
        """Las preferencias de cada persona conocida de la organización.

        La fila nace con el primer GET de `/preferencias-alertas/`, o sea,
        cuando alguien abre Ajustes. Quien nunca lo hizo no tiene fila, pero sí
        tiene preferencias: las de omisión, que son las que la pantalla le
        muestra como suyas. Por eso a esa persona se le devuelve una instancia
        SIN GUARDAR con los valores por omisión, en vez de dejarla fuera.

        "Conocida" es tener fila de preferencias o dirección de correo
        (`DireccionCorreo`). Si la fuente de direcciones cambia (ver su
        docstring), este es el único lugar que hay que tocar. La limpieza de
        la persona borra las dos cosas, así que una persona eliminada no
        vuelve a aparecer acá.

        Lo usan el generador (qué ventanas de aviso hay) y la planificación
        de entregas (a quién se le manda): los dos tienen que ver a las
        mismas personas con las mismas preferencias.
        """
        guardadas = list(cls.objects.filter(organizacion_id=organizacion_id).order_by("usuario_id"))
        con_fila = {preferencia.usuario_id for preferencia in guardadas}
        sin_fila = (
            DireccionCorreo.objects.filter(organizacion_id=organizacion_id)
            .exclude(usuario_id__in=con_fila)
            .order_by("usuario_id")
            .values_list("usuario_id", flat=True)
        )
        return guardadas + [
            cls(organizacion_id=organizacion_id, usuario_id=usuario_id) for usuario_id in sin_fila
        ]

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
    El contrato MX-21 v2 admite `datos.fin_prueba` como fecha opcional o null.
    Subscriptions la copia de `Subscription`; se guarda cuando el sobre la
    trae y queda en NULL si no. Sin fecha no hay aviso de
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
    """Inbox por consumidor FE-24; se borra con la organización."""
    consumidor = models.CharField(max_length=64, default='suscripciones.v2')
    evento_id = models.UUIDField()

    class Meta(ModeloTenant.Meta):
        db_table = 'evento_recibido'
        constraints = [models.UniqueConstraint(
            fields=['consumidor', 'organizacion_id', 'evento_id'], name='notifications_evento_unico',
        )]


class DireccionCorreo(ModeloTenant):
    """A qué dirección escribirle a cada persona (S3-FE-21).

    ── De dónde sale: NO HAY CONTRATO ACORDADO ──────────────────────────────
    El correo de una persona vive en el esquema de `auth` y ningún servicio
    consulta el de otro (ADR-002). Las dos fuentes posibles están abiertas:

    · `usuario.creado`. El catálogo (`shared/events/catalogo.md`, «Publica
      auth») lo describe con `usuario_id`, `email` y `rol`, escuchado por
      notifications, y esta tabla es la forma de lo que guardaría ese
      consumidor. Pero MX-21 (`docs/arquitectura/MX-21-contratos-rabbitmq.md`,
      «Transporte y tratamiento de fallos») dice «No transportar tokens,
      contraseñas, correos ni cuerpos de mensajes». Las dos reglas no pueden
      valer a la vez: es un conflicto, no un acuerdo.
    · Una consulta interna firmada a auth al momento de reclamar, como la de
      la limpieza (MX-07). No guarda correos acá ni choca con MX-21, pero
      auth no la expone.

    Lo deciden Maxi y quien lleve auth. Si gana la consulta, cambian
    `CanalCorreo.destino` y `PreferenciaNotificacion.de_la_organizacion`, y
    esta tabla se retira.

    HOY NADIE LA LLENA, fuera de las pruebas. Mientras tanto, una entrega por
    correo sin fila acá termina en `fallida` con `sin_direccion`: un error
    explícito, no un envío inventado ni una entrega dada por hecha. Por lo
    mismo, `despachar_alertas` no debe programarse antes de resolver esto:
    cada correo que tome quedaría fallido para siempre.

    Es dato personal: se borra con la persona (limpieza de usuario) y con la
    organización, igual que las preferencias.
    """

    usuario_id = models.CharField(
        max_length=64,
        verbose_name="Usuario",
        help_text="El mismo valor crudo que `PreferenciaNotificacion.usuario_id`.",
    )
    email = models.EmailField(verbose_name="Correo")

    class Meta(ModeloTenant.Meta):
        db_table = "direccion_correo"
        constraints = [
            models.UniqueConstraint(
                fields=["organizacion_id", "usuario_id"],
                name="direccion_correo_unica_por_usuario",
            ),
        ]
        verbose_name = "Dirección de correo"
        verbose_name_plural = "Direcciones de correo"


class EntregaAlerta(ModeloTenant):
    """Una alerta, una persona, un canal externo: qué pasó al mandarla (S3-FE-21).

    ── Qué cuenta como entregada ────────────────────────────────────────────
    Solo `aceptada`, y solo cuando el proveedor la aceptó: el servidor SMTP
    respondió 250 al mensaje. Crear la fila no es entregar ni encolar es
    entregar. `evidencia` guarda lo que respalda la aceptación y
    `codigo_error`/`detalle_error` el último fallo, con su código.

    ── Una fila por (alerta, persona, canal) ────────────────────────────────
    La restricción única es la idempotencia de la planificación: el mismo
    aviso no se planifica dos veces para la misma persona por el mismo canal.
    La de la ejecución la da el reclamo (`reclamo_id` + `reclamada_hasta`):
    dos workers no pueden tener la misma fila en `enviando` a la vez.

    `in_app` no tiene fila: la alerta misma es esa entrega (FE-19).
    """

    class Canal(models.TextChoices):
        EMAIL = "email", "Correo"
        PUSH = "push", "Push"

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        # Un worker la tomó y está hablando con el proveedor. Nadie más la
        # toma hasta `reclamada_hasta`; si el worker muere, vence y otro la
        # retoma (puede salir dos veces: ver `entregas.py`).
        ENVIANDO = "enviando", "Enviando"
        ACEPTADA = "aceptada", "Aceptada por el proveedor"
        # Horario de descanso o cuota diaria: no se pierde, sale en
        # `proximo_intento_en`. No gasta un intento: no se habló con nadie.
        DIFERIDA = "diferida", "Diferida"
        # Error transitorio: espera progresiva hasta `proximo_intento_en`.
        REINTENTO = "reintento", "En reintento"
        # Error permanente: repetirla da lo mismo.
        FALLIDA = "fallida", "Fallida"
        AGOTADA = "agotada", "Reintentos agotados"
        # Ya no corresponde mandarla: la persona apagó el aviso o el canal.
        DESCARTADA = "descartada", "Descartada"

    #: Las que esperan su `proximo_intento_en` para intentarse. Es el filtro
    #: de `entregas.elegibles()`, junto con las `enviando` de reclamo vencido.
    EN_ESPERA = (Estado.PENDIENTE, Estado.DIFERIDA, Estado.REINTENTO)
    #: Los estados de los que ya no se sale. Con `EN_ESPERA` y `ENVIANDO`
    #: cubren todos los estados sin repetir ninguno, y ninguno es elegible:
    #: lo exigen las pruebas, para que un estado nuevo no quede fuera de los
    #: dos grupos sin que nadie lo note.
    TERMINALES = (Estado.ACEPTADA, Estado.FALLIDA, Estado.AGOTADA, Estado.DESCARTADA)

    alerta = models.ForeignKey(
        Alerta,
        on_delete=models.CASCADE,
        related_name="entregas",
        verbose_name="Alerta",
    )
    usuario_id = models.CharField(
        max_length=64,
        verbose_name="Usuario",
        help_text="El mismo valor crudo que `PreferenciaNotificacion.usuario_id`.",
    )
    canal = models.CharField(max_length=8, choices=Canal.choices)
    estado = models.CharField(
        max_length=12,
        choices=Estado.choices,
        default=Estado.PENDIENTE,
    )
    motivo = models.CharField(
        max_length=24,
        blank=True,
        default="",
        help_text=(
            "Por qué quedó diferida o descartada: descanso, cuota_diaria, "
            "preferencia_apagada, preferencia_por_omision, fuera_de_anticipacion."
        ),
    )

    # ── intentos ─────────────────────────────────────────────────────
    intentos = models.PositiveSmallIntegerField(
        default=0,
        help_text="Veces que se reclamó para mandarla al proveedor. Diferirla o descartar un mensaje inválido no cuenta.",
    )
    proximo_intento_en = models.DateTimeField(
        help_text="Desde cuándo puede intentarse (pendiente, diferida o en reintento).",
    )
    ultimo_intento_en = models.DateTimeField(null=True, blank=True)
    reclamo_id = models.UUIDField(
        null=True,
        blank=True,
        help_text=(
            "Identifica el reclamo vigente. El resultado de un envío solo se "
            "anota si el reclamo sigue siendo el mismo: un worker cuyo reclamo "
            "venció no pisa lo que anotó el que lo retomó."
        ),
    )
    reclamada_hasta = models.DateTimeField(null=True, blank=True)

    # ── resultado ────────────────────────────────────────────────────
    destino = models.CharField(
        max_length=254,
        blank=True,
        default="",
        help_text="A dónde se mandó en el último intento. Dato personal: se borra con la persona.",
    )
    message_id = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text=(
            "El Message-ID del correo. Se fija en el primer intento y se "
            "repite en los siguientes: es la clave de idempotencia del canal."
        ),
    )
    aceptada_en = models.DateTimeField(null=True, blank=True)
    evidencia = models.JSONField(
        default=dict,
        blank=True,
        help_text="Lo que respalda la aceptación: Message-ID y backend que la aceptó.",
    )
    codigo_error = models.CharField(max_length=40, blank=True, default="")
    detalle_error = models.CharField(max_length=300, blank=True, default="")

    class Meta(ModeloTenant.Meta):
        db_table = "entrega_alerta"
        constraints = [
            models.UniqueConstraint(
                fields=["alerta", "usuario_id", "canal"],
                name="entrega_unica_por_alerta_usuario_y_canal",
            ),
        ]
        verbose_name = "Entrega de alerta"
        verbose_name_plural = "Entregas de alertas"

    def __str__(self) -> str:
        return f"{self.alerta_id} → {self.usuario_id} por {self.canal} ({self.estado})"
