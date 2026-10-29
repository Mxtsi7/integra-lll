"""
Modelos del servicio de conectores (FE-01).

Una **cuenta conectada** es la autorización que una organización le da al
sistema para leer una fuente de cobros: su Gmail, su Outlook, o la carga
manual de cartolas en CSV.

Lo que hay que mirar acá son tres cosas:

1. **El tenant no es una clave foránea.** `organizacion_id` viene de
   ``ModeloTenant``: es un UUID suelto, porque la tabla de organizaciones
   vive en el esquema de ``auth`` y ningún servicio consulta el esquema de
   otro (ADR-002).

2. **Los tokens se guardan cifrados.** ``CampoCifrado`` (FE-06) cifra al
   guardar y descifra al leer. En la base queda un bloque Fernet, no el
   token. Y como el campo está registrado en el mapeo de DRF, un serializer
   con ``fields = "__all__"`` tampoco los devuelve.

3. **Una fila ilegible no rompe el listado.** Si una cuenta quedó cifrada
   con una clave que ya no está en ``CLAVES_CIFRADO``, leerla entrega
   ``SECRETO_ILEGIBLE`` en vez de reventar, y ``necesita_reautorizacion``
   la deja marcada para que el usuario vuelva a autorizar.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import timedelta

from django.db import models, transaction
from django.utils import timezone

from shared.cifrado import SECRETO_ILEGIBLE, CampoCifrado
from shared.tenant.base import ModeloTenant


class CuentaConectada(ModeloTenant):
    """Autorización de una organización sobre una fuente externa de cobros."""

    class Proveedor(models.TextChoices):
        GMAIL = "gmail", "Gmail"
        OUTLOOK = "outlook", "Outlook"
        CSV = "csv", "Carga de archivo CSV"

    class Estado(models.TextChoices):
        CONECTADA = "conectada", "Conectada"
        REQUIERE_REAUTORIZACION = "requiere_reautorizacion", "Requiere reautorización"
        DESCONECTADA = "desconectada", "Desconectada"
        ERROR = "error", "Con error"

    # ── identidad de la cuenta ───────────────────────────────────────

    proveedor = models.CharField(
        max_length=20,
        choices=Proveedor.choices,
        verbose_name="Proveedor",
    )

    # El correo o identificador con que el proveedor conoce la cuenta. Es lo
    # que el usuario reconoce en pantalla ("felipe@gmail.com"), y junto con
    # el proveedor forma la llave natural dentro de la organización.
    cuenta_externa = models.CharField(
        max_length=254,
        verbose_name="Cuenta en el proveedor",
    )

    estado = models.CharField(
        max_length=24,
        choices=Estado.choices,
        default=Estado.CONECTADA,
        verbose_name="Estado",
    )

    # ── credenciales (nunca en texto plano) ──────────────────────────

    access_token = CampoCifrado(
        null=True,
        blank=True,
        verbose_name="Token de acceso",
    )

    refresh_token = CampoCifrado(
        null=True,
        blank=True,
        verbose_name="Token de refresco",
    )

    token_expira_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Vencimiento del token de acceso",
    )

    # ── sincronización ───────────────────────────────────────────────

    ultima_sincronizacion = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Última sincronización correcta",
    )

    # Por qué quedó en `error` o `requiere_reautorizacion`. Texto para que lo
    # lea una persona; no se parsea. Nunca contiene el token (FE-14).
    detalle_del_estado = models.CharField(
        max_length=200,
        blank=True,
        default="",
        verbose_name="Detalle del estado",
    )

    # ⚠️ MISMO NOMBRE Y MISMO SIGNIFICADO que el campo que agrega #72
    # (migración `0002_cuenta_revocada`). Está así a propósito: dos campos
    # distintos para la misma idea serían un lío silencioso para siempre,
    # mientras que dos `AddField` con el mismo nombre son UN conflicto
    # visible que se resuelve borrando una línea al integrar. Si #72 entra
    # primero, se borra esta declaración y su AddField de acá.
    # ── La evidencia de revocación es de UNA concesión, no de la cuenta ──
    # Sin esto había dos agujeros, los dos encontrados en revisión:
    #
    # · Revocación confirmada → reconexión con credenciales nuevas → la
    #   nueva revocación falla. La cuenta conservaba la fecha ANTERIOR y
    #   `pendientes_de_revocar()` la excluía, así que las credenciales
    #   nuevas quedaban vivas con una revocación "acreditada" que no era
    #   de ellas. #72 habría tomado esa fecha como prueba.
    #
    # · Desconexión y reconexión a la vez: `revocar_y_desconectar` habla
    #   con el proveedor ANTES de guardar, y mientras espera un callback
    #   puede dejar tokens nuevos. Al volver, borraba los nuevos y
    #   acreditaba haberlos revocado, cuando revocó los viejos.
    #
    # El contador sube con cada juego de credenciales nuevo, y la
    # revocación solo se guarda si la versión no cambió mientras tanto.
    credenciales_version = models.PositiveIntegerField(
        default=0,
        verbose_name="Versión de las credenciales",
        help_text=(
            "Sube cada vez que se guardan tokens nuevos. `revocado_en` "
            "acredita la revocación de la versión que había al momento de "
            "pedirla, no de cualquiera posterior."
        ),
    )

    revocado_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Revocación confirmada por el proveedor",
        help_text=(
            "Se llena SOLO cuando el proveedor confirmó la revocación. "
            "Que no haya tokens guardados no demuestra que el acceso se "
            "haya revocado del otro lado: el token pudo seguir vivo hasta "
            "vencer. La limpieza coordinada de #72 exige este dato."
        ),
    )

    # ── comportamiento ───────────────────────────────────────────────

    # Los estados que por sí solos exigen volver a autorizar. Están acá y no
    # repetidos en la vista porque la propiedad y el filtro del listado TIENEN
    # que decir lo mismo: si no, una cuenta desaparece justo cuando se la busca.
    ESTADOS_QUE_EXIGEN_REAUTORIZAR = (
        Estado.REQUIERE_REAUTORIZACION,
        Estado.ERROR,
    )

    @classmethod
    def filtro_exigen_reautorizar(cls) -> models.Q:
        """La parte de `necesita_reautorizacion` que SÍ se puede consultar en SQL.

        El resto de la propiedad —que el token ya no descifre con las claves
        vigentes— no es una columna: depende de las claves que tenga el proceso
        en ese momento. No se puede expresar en un WHERE, y filtrar en Python
        después de paginar devolvería páginas incompletas con un `count` que no
        calza. Por eso, cuando se detecta un secreto ilegible, lo que
        corresponde es dejarlo asentado con `marcar_para_reautorizar()`: ahí el
        estado pasa a ser consultable y el filtro lo encuentra.
        """
        return models.Q(estado__in=cls.ESTADOS_QUE_EXIGEN_REAUTORIZAR)

    @property
    def necesita_reautorizacion(self) -> bool:
        """True si no se puede operar con esta cuenta sin que el usuario
        vuelva a autorizar: o el estado lo dice, o el token guardado ya no
        se puede descifrar con las claves vigentes."""
        if self.estado in self.ESTADOS_QUE_EXIGEN_REAUTORIZAR:
            return True
        return self.access_token is SECRETO_ILEGIBLE or self.refresh_token is SECRETO_ILEGIBLE

    def marcar_para_reautorizar(self, motivo: str = "") -> None:
        """Deja la cuenta pidiendo autorización de nuevo, sin tocar los
        tokens: pisarlos con basura perdería el dato original."""
        self.estado = self.Estado.REQUIERE_REAUTORIZACION
        self.detalle_del_estado = motivo[:200]
        self.save(update_fields=["estado", "detalle_del_estado", "actualizado_en"])

    # ── meta ─────────────────────────────────────────────────────────

    class Meta(ModeloTenant.Meta):
        db_table = "cuenta_conectada"
        constraints = [
            # Una organización conecta una vez cada cuenta de cada proveedor.
            # Va por organización y no global: dos organizaciones distintas
            # pueden conectar el mismo correo sin verse entre ellas.
            models.UniqueConstraint(
                fields=["organizacion_id", "proveedor", "cuenta_externa"],
                name="cuenta_conectada_unica_por_organizacion",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organizacion_id", "estado"],
                name="cuenta_conectada_org_estado",
            ),
        ]
        ordering = ["proveedor", "cuenta_externa"]
        verbose_name = "Cuenta conectada"
        verbose_name_plural = "Cuentas conectadas"

    def __str__(self) -> str:
        return f"{self.get_proveedor_display()}: {self.cuenta_externa} ({self.get_estado_display()})"


class AutorizacionPendiente(ModeloTenant):
    """Un flujo de OAuth empezado y todavía sin cerrar (FE-03 / FE-04).

    Nace cuando el usuario pide conectar una cuenta y muere cuando vuelve del
    proveedor (o cuando expira). Guarda las dos cosas que prueban que el
    callback que llega es el mismo flujo que se inició:

    · **`estado_oauth`** (el `state` de OAuth) — 43 caracteres de
      `secrets.token_urlsafe`. Viaja al proveedor y vuelve en la URL. Es lo
      que impide que alguien mande a un usuario un callback armado a mano.

    · **`verificador_pkce`** (RFC 7636) — se queda ACÁ. Al proveedor solo va
      su hash (`code_challenge`). Quien canjea el código tiene que mostrar el
      verificador, así que un código robado de la URL no sirve sin él.

    ── Por qué el state se guarda en la base y no firmado en una cookie ─────
    Porque el callback tiene que ser de **un solo uso**, y eso es un hecho
    compartido, no algo que se pueda deducir de un token firmado. Con una
    fila se marca `usada_en` en un UPDATE condicional y dos callbacks
    simultáneos con el mismo código no pueden ganar los dos.

    ── Por qué trae la organización ────────────────────────────────────────
    El callback llega como una redirección del navegador desde Google: ahí no
    hay cabecera `X-Organizacion-Id` que valga. La organización se deduce de
    ESTA fila, que se creó cuando sí había contexto. Es lo que cumple el
    criterio "éxito deja cuenta conectada del tenant correcto".
    """

    # 43 caracteres es lo que da token_urlsafe(32); 64 deja margen.
    estado_oauth = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        verbose_name="Parámetro state del flujo",
        help_text=(
            "Único a nivel global, no por organización: en el callback se "
            "busca por este valor ANTES de saber de qué organización es."
        ),
    )

    proveedor = models.CharField(
        max_length=20,
        choices=CuentaConectada.Proveedor.choices,
        verbose_name="Proveedor",
    )

    # Quién inició el flujo. FE-03 pide el state "vinculado a sesión", y sin
    # esto no lo estaba: bastaba con ser del mismo tenant para cerrar un
    # flujo ajeno. El state aleatorio y PKCE prueban que el flujo es
    # legítimo, no que vuelva la MISMA persona que lo abrió.
    #
    # Se guarda el valor crudo de la cabecera `X-Usuario-Id` que inyecta el
    # gateway, como texto: el id vive en el esquema de `auth` y acá no se
    # interpreta, solo se compara.
    usuario_id = models.CharField(
        max_length=64,
        verbose_name="Usuario que inició el flujo",
    )

    # Dos sesiones del MISMO usuario también son flujos distintos: con solo
    # `usuario_id`, el callback abierto en una pestaña cerraba el flujo
    # iniciado en otra. El gateway inyecta `X-Sesion-Id` desde el claim
    # `sid` del JWT (gateway/app/proxy.py), así que el dato ya llega.
    #
    # Admite vacío para los flujos abiertos antes de este campo: un token
    # viejo puede no traer `sid`. Cuando está vacío no se compara, y queda
    # dicho en el callback por qué.
    sesion_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        verbose_name="Sesión que inició el flujo",
    )

    # Secreto: va cifrado igual que los tokens (FE-06).
    verificador_pkce = CampoCifrado(
        verbose_name="Verificador PKCE",
    )

    # La URI que se le mandó al proveedor. Se guarda porque en el canje hay
    # que mandar exactamente la misma: si no calza, el proveedor rechaza.
    redirect_uri = models.URLField(
        max_length=300,
        verbose_name="Callback registrado en el proveedor",
    )

    # A dónde mandar el navegador DESPUÉS de cerrar el flujo. Validado contra
    # la lista blanca al crearse (ver vistas): acá ya llega limpio.
    retorno = models.URLField(
        max_length=300,
        blank=True,
        default="",
        verbose_name="Retorno del frontend",
    )

    expira_en = models.DateTimeField(
        verbose_name="Vence el",
    )

    # Null mientras no se use. No es un booleano a propósito: saber CUÁNDO se
    # usó sirve para investigar un intento de reuso.
    usada_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Usada el",
    )

    # ── comportamiento ───────────────────────────────────────────────

    #: Cuánto dura un flujo. Diez minutos alcanzan de sobra para elegir
    #: cuenta y aceptar, y dejan una ventana corta si el state se filtra.
    MINUTOS_DE_VIDA = 10

    @classmethod
    def abrir(cls, *, organizacion_id, usuario_id, proveedor: str,
              redirect_uri: str, retorno: str = "",
              sesion_id: str = "") -> tuple["AutorizacionPendiente", str]:
        """Crea el flujo y devuelve (fila, desafio_pkce).

        El verificador queda guardado cifrado; el desafío es lo único que sale
        de acá y es lo que se le manda al proveedor.
        """
        verificador = secrets.token_urlsafe(32)
        desafio = (
            base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest())
            .decode()
            .rstrip("=")  # el RFC pide base64url SIN relleno
        )
        fila = cls.objects.create(
            organizacion_id=organizacion_id,
            usuario_id=str(usuario_id),
            sesion_id=str(sesion_id or ""),
            proveedor=proveedor,
            estado_oauth=secrets.token_urlsafe(32),
            verificador_pkce=verificador,
            redirect_uri=redirect_uri,
            retorno=retorno,
            expira_en=timezone.now() + timedelta(minutes=cls.MINUTOS_DE_VIDA),
        )
        return fila, desafio

    @property
    def vigente(self) -> bool:
        """Sirve para canjear: ni usada ni vencida."""
        return self.usada_en is None and self.expira_en > timezone.now()

    def marcar_usada(self, *, cuando=None) -> bool:
        """Quema el flujo. True si ESTA llamada fue la que lo quemó.

        El UPDATE condicional es lo que hace el "un solo uso" de verdad:
        comprobar en Python y guardar después deja una ventana en la que dos
        callbacks con el mismo código pasan los dos. Acá gana uno solo, y el
        otro recibe False porque la base ya no tenía la fila sin usar.
        """
        ahora = cuando or timezone.now()
        cambiadas = type(self).objects.filter(
            pk=self.pk, usada_en__isnull=True
        ).update(usada_en=ahora, actualizado_en=ahora)
        if cambiadas:
            self.usada_en = ahora
        else:
            self.refresh_from_db()
        return bool(cambiadas)

    # ── meta ─────────────────────────────────────────────────────────

    class Meta(ModeloTenant.Meta):
        db_table = "autorizacion_pendiente"
        ordering = ["-creado_en"]
        indexes = [
            # Para la limpieza de las vencidas sin tocar el resto.
            models.Index(
                fields=["expira_en"],
                name="autorizacion_expira",
            ),
        ]
        verbose_name = "Autorización pendiente"
        verbose_name_plural = "Autorizaciones pendientes"

    def __str__(self) -> str:
        estado = "usada" if self.usada_en else ("vigente" if self.vigente else "vencida")
        return f"{self.get_proveedor_display()} ({estado})"


class Importacion(ModeloTenant):
    """Una carga de datos en curso y su progreso (FE-08 / RF-05 / RF-19).

    La pide una persona —sube un CSV, o conecta un correo— y después pregunta
    "¿cómo va?". Eso es lo que esta tabla contesta.

    ── Terminar el análisis NO es confirmar los candidatos ──────────────────
    Son dos hitos distintos y la tarjeta pide expresamente distinguirlos:

        `completada`  el archivo se leyó entero y los candidatos están listos
                      PARA QUE ALGUIEN LOS MIRE (FE-10 los previsualiza)
        confirmada    la persona aceptó esos candidatos y recién ahí se crean
                      o actualizan suscripciones (FE-11)

    Mezclarlos sería lo peor que puede pasar acá: una importación "completada"
    se leería como "ya se tocaron tus suscripciones", cuando todavía no se
    tocó nada. Por eso `confirmada_en` es un campo aparte y no un estado más
    de la máquina: una importación puede quedarse completada para siempre
    porque la persona miró los candidatos y decidió que no.

    ── El estado terminal no cambia ────────────────────────────────────────
    `completada` y `fallida` son finales. El criterio es "polling propio
    devuelve estado estable y terminal": si una importación pudiera volver a
    `procesando`, el frontend que dejó de preguntar se quedaría con una
    respuesta vieja para siempre. `avanzar_a` lo impide.
    """

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        PROCESANDO = "procesando", "Procesando"
        COMPLETADA = "completada", "Análisis completado"
        FALLIDA = "fallida", "Fallida"

    class Origen(models.TextChoices):
        CSV = "csv", "Archivo CSV o cartola"          # FE-07
        CORREO = "correo", "Lectura de correo"        # FE-13

    #: De dónde se puede pasar a dónde. Lo que no está acá no se puede.
    TRANSICIONES = {
        Estado.PENDIENTE: {Estado.PROCESANDO, Estado.FALLIDA},
        Estado.PROCESANDO: {Estado.COMPLETADA, Estado.FALLIDA},
        # Los dos finales no salen a ningún lado: son terminales.
        Estado.COMPLETADA: set(),
        Estado.FALLIDA: set(),
    }

    ESTADOS_TERMINALES = frozenset({Estado.COMPLETADA, Estado.FALLIDA})

    # ── quién la pidió ───────────────────────────────────────────────

    # El "owner" que pide la tarjeta. Una importación es de una persona, no de
    # la organización entera: quien la subió es quien espera su resultado.
    usuario_id = models.CharField(
        max_length=64,
        verbose_name="Quién la pidió",
        help_text=(
            "El valor crudo de `X-Usuario-Id` que inyecta el gateway. El id "
            "vive en el esquema de `auth` y acá no se interpreta (ADR-002)."
        ),
    )

    # ── de dónde salen los datos ─────────────────────────────────────

    origen = models.CharField(
        max_length=10,
        choices=Origen.choices,
        verbose_name="Origen",
    )

    cuenta = models.ForeignKey(
        CuentaConectada,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="importaciones",
        verbose_name="Cuenta conectada de origen",
        help_text=(
            "Solo para origen `correo`. SET_NULL y no CASCADE: si la cuenta "
            "se desconecta, la importación que ya ocurrió sigue siendo un "
            "hecho y su historial no se borra."
        ),
    )

    nombre_archivo = models.CharField(
        max_length=255,
        blank=True,
        default="",
        verbose_name="Nombre del archivo",
        help_text="Solo para origen `csv`. Para que la persona reconozca cuál es.",
    )

    # ── cómo va ──────────────────────────────────────────────────────

    estado = models.CharField(
        max_length=12,
        choices=Estado.choices,
        default=Estado.PENDIENTE,
        db_index=True,
        verbose_name="Estado",
    )

    filas_totales = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Filas por procesar",
        help_text=(
            "NULL mientras no se sepa. Una lectura de correo no sabe cuántos "
            "mensajes hay hasta que termina de pedirlos, y mentir un total "
            "haría que la barra de progreso retroceda."
        ),
    )

    filas_procesadas = models.PositiveIntegerField(
        default=0,
        verbose_name="Filas procesadas",
    )

    candidatos_detectados = models.PositiveIntegerField(
        default=0,
        verbose_name="Cobros candidatos detectados",
        help_text="Lo que FE-10 va a previsualizar. Todavía no se creó nada.",
    )

    # ── qué salió mal ────────────────────────────────────────────────

    errores = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Errores resumidos",
        help_text=(
            "Lista de {codigo, mensaje, fila}. RESUMIDOS a propósito: un CSV "
            "de 5.000 filas malas no puede devolver 5.000 errores en un "
            "polling. Se guardan los primeros `MAXIMO_ERRORES` y el conteo "
            "real va en `errores_totales`."
        ),
    )

    errores_totales = models.PositiveIntegerField(
        default=0,
        verbose_name="Errores en total",
        help_text="Cuántos hubo de verdad, aunque solo se guarden los primeros.",
    )

    #: Cuántos errores se guardan. Más que esto no ayuda a nadie a entender
    #: qué pasó, y una respuesta de polling tiene que caber en una pantalla.
    MAXIMO_ERRORES = 20

    # ── los dos hitos, separados ─────────────────────────────────────

    terminada_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Análisis terminado el",
        help_text="Cuándo quedó en un estado terminal (completada o fallida).",
    )

    confirmada_en = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Candidatos confirmados el",
        help_text=(
            "Cuándo la persona ACEPTÓ los candidatos (FE-11). Distinto de "
            "`terminada_en`: terminar el análisis no toca ninguna suscripción."
        ),
    )

    # ── comportamiento ───────────────────────────────────────────────

    @property
    def terminada(self) -> bool:
        return self.estado in self.ESTADOS_TERMINALES

    @property
    def progreso(self) -> int | None:
        """0–100, o None si todavía no se sabe cuántas filas hay.

        None y no 0: son cosas distintas y el frontend las muestra distinto
        (una barra indeterminada vs una barra vacía). Una terminal es 100
        aunque no se haya sabido el total.
        """
        if self.terminada:
            return 100
        if not self.filas_totales:
            return None
        return min(100, round(100 * self.filas_procesadas / self.filas_totales))

    def avanzar_a(self, estado: str, *, cuando=None) -> bool:
        """Mueve el estado si la transición existe. True si se movió.

        Devuelve False en vez de lanzar cuando ya estaba en ese estado: dos
        workers que reporten "procesando" no deberían romperse mutuamente.
        Lanza, en cambio, si la transición es IMPOSIBLE —de completada a
        procesando, por ejemplo—, porque eso es un error de programación y
        callarlo haría que el estado terminal dejara de ser estable.
        """
        if estado == self.estado:
            return False
        permitidos = self.TRANSICIONES.get(self.estado, set())
        if estado not in permitidos:
            raise ValueError(
                f"no se puede pasar de {self.estado!r} a {estado!r}; "
                f"desde {self.estado!r} solo se puede a {sorted(permitidos) or 'ningún estado'}"
            )
        ahora = cuando or timezone.now()
        valores = {"estado": estado, "actualizado_en": ahora}
        if estado in self.ESTADOS_TERMINALES:
            valores["terminada_en"] = ahora

        # ── La guarda va en el WHERE, no solo en memoria ───────────────────
        # La versión anterior comprobaba `self.estado` —lo que ESTA instancia
        # cree— y después hacía `save()`. Con dos instancias leídas de la
        # misma fila, las dos creen "procesando", las dos pasan la guarda y la
        # segunda pisa a la primera: una importación que ya había reportado
        # `completada` terminaba `fallida`. No hacen falta hilos; lo reprodujo
        # la revisión de la PR con dos instancias viejas.
        #
        # Con el estado esperado en el filtro, solo gana una. La otra recibe 0
        # filas, relee y devuelve False: no se movió, y el estado terminal
        # sigue siendo estable, que es el criterio de FE-08.
        with transaction.atomic():
            cambiadas = type(self).objects.filter(
                pk=self.pk, estado=self.estado
            ).update(**valores)

        if not cambiadas:
            # Otra instancia la movió primero. Se recarga para que el llamador
            # vea el estado real en vez de seguir con el suyo.
            self.refresh_from_db()
            return False

        self.estado = estado
        if "terminada_en" in valores:
            self.terminada_en = ahora
        return True

    def anotar_error(self, codigo: str, mensaje: str, fila: int | None = None) -> None:
        """Suma un error. Guarda los primeros y cuenta todos.

        No guarda: el llamador decide cuándo persistir, porque anotar fila por
        fila haría un UPDATE por error.
        """
        self.errores_totales += 1
        if len(self.errores) < self.MAXIMO_ERRORES:
            self.errores.append(
                {"codigo": codigo, "mensaje": mensaje[:200], "fila": fila}
            )

    def confirmar_candidatos(self, *, cuando=None) -> bool:
        """Marca que la persona aceptó los candidatos (lo usará FE-11).

        Solo desde `completada`: confirmar candidatos de una importación que
        falló, o que todavía corre, no significa nada.
        """
        if self.estado != self.Estado.COMPLETADA:
            raise ValueError(
                f"solo se confirman los candidatos de una importación "
                f"completada; esta está en {self.estado!r}"
            )
        ahora = cuando or timezone.now()
        # Misma idea que `avanzar_a`: la condición va en el WHERE. Comprobar
        # `self.confirmada_en` en memoria dejaba que una reentrega del mismo
        # evento moviera la fecha de confirmación.
        with transaction.atomic():
            cambiadas = type(self).objects.filter(
                pk=self.pk,
                estado=self.Estado.COMPLETADA,
                confirmada_en__isnull=True,
            ).update(confirmada_en=ahora, actualizado_en=ahora)

        if not cambiadas:
            self.refresh_from_db()
            return False

        self.confirmada_en = ahora
        return True

    class Meta(ModeloTenant.Meta):
        db_table = "importacion"
        ordering = ["-creado_en"]
        indexes = [
            models.Index(
                fields=["organizacion_id", "-creado_en"],
                name="importacion_org_creado",
            ),
        ]
        verbose_name = "Importación"
        verbose_name_plural = "Importaciones"

    def __str__(self) -> str:
        return f"{self.get_origen_display()} · {self.get_estado_display()}"
