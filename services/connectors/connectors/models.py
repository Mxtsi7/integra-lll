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

from django.db import models

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
