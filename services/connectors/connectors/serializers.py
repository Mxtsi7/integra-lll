"""
Serializers del servicio de conectores (FE-01).

Los tokens entran por acá y no salen nunca. Hay dos capas, a propósito:

1. **Los campos se listan explícitos** y los tokens no están en la lista. Es
   lo que se lee al revisar el archivo: queda a la vista qué se expone.
2. **Y si alguien los agrega igual**, ``CampoCifrado`` está registrado en el
   mapeo de ``ModelSerializer`` (FE-06), así que DRF los construye
   ``write_only`` solo. La protección no depende de esta lista.

La segunda capa es la que vale: la primera se puede romper editando una
línea sin darse cuenta.
"""

from urllib.parse import urlsplit

from django.conf import settings
from rest_framework import serializers

from shared.cifrado import CampoSecretoSerializer

from . import proveedores
from .models import CobroCandidato, CuentaConectada, Importacion


class CuentaConectadaSerializer(serializers.ModelSerializer):
    """Lo que ve el usuario de una cuenta conectada."""

    # Declarados para poder recibirlos en el alta sin que sean obligatorios.
    # Salen `write_only` por el propio campo, no por esta declaración.
    access_token = CampoSecretoSerializer(required=False, allow_blank=True)
    refresh_token = CampoSecretoSerializer(required=False, allow_blank=True)

    necesita_reautorizacion = serializers.BooleanField(read_only=True)
    proveedor_legible = serializers.CharField(source="get_proveedor_display", read_only=True)
    estado_legible = serializers.CharField(source="get_estado_display", read_only=True)

    class Meta:
        model = CuentaConectada
        fields = (
            "id",
            "proveedor",
            "proveedor_legible",
            "cuenta_externa",
            "estado",
            "estado_legible",
            "detalle_del_estado",
            "necesita_reautorizacion",
            "token_expira_en",
            "ultima_sincronizacion",
            "creado_en",
            "actualizado_en",
            # Entran, no salen:
            "access_token",
            "refresh_token",
        )
        read_only_fields = (
            "id",
            "estado",
            "detalle_del_estado",
            "ultima_sincronizacion",
            "creado_en",
            "actualizado_en",
        )


# ── OAuth (FE-03 / FE-04) ────────────────────────────────────────────


class IniciarAutorizacionSerializer(serializers.Serializer):
    """Lo que manda el frontend para empezar a conectar una cuenta (FE-03).

    No es un ModelSerializer a propósito: lo que el cliente puede elegir son
    dos cosas (con qué proveedor y a dónde volver), no los campos de la fila.
    El state, el PKCE y el vencimiento los pone el servidor; si viniera algo
    de eso en el cuerpo, el flujo dejaría de probar nada.
    """

    proveedor = serializers.ChoiceField(
        choices=CuentaConectada.Proveedor.choices,
        help_text="gmail u outlook. El csv no usa OAuth.",
    )
    retorno = serializers.URLField(
        required=False,
        allow_blank=True,
        default="",
        help_text=(
            "A dónde mandar el navegador al terminar. Tiene que estar en "
            "OAUTH_RETORNOS_PERMITIDOS; cualquier otra cosa se rechaza."
        ),
    )

    def validate_proveedor(self, valor: str) -> str:
        """El CSV es un proveedor válido del modelo pero no tiene OAuth."""
        if valor not in proveedores.CONFIGURACIONES:
            raise serializers.ValidationError(
                f"{valor} no usa OAuth: no hay a quién pedirle permiso."
            )
        return valor

    def validate_retorno(self, valor: str) -> str:
        """Lista blanca, no validación de forma.

        Este es el criterio "no admite retorno arbitrario". Un `URLField`
        comprueba que sea una URL, no que sea NUESTRA URL: sin esta lista, un
        atacante arma un inicio con `retorno=https://su-sitio/` y se lleva al
        usuario —con lo que venga en la URL— apenas cierra el flujo.

        Se compara el origen completo, no `startswith`: con prefijos,
        `https://ojoalgasto.cl.malo.com` pasa por empezar igual.
        """
        if not valor:
            return valor
        permitidos = getattr(settings, "OAUTH_RETORNOS_PERMITIDOS", [])
        partes = urlsplit(valor)
        origen = f"{partes.scheme}://{partes.netloc}"
        if origen not in permitidos:
            raise serializers.ValidationError(
                "Ese retorno no está permitido."
            )
        return valor


class AutorizacionIniciadaSerializer(serializers.Serializer):
    """La respuesta de FE-03. Lo que Andrea necesita para AN-15/AN-09."""

    url_autorizacion = serializers.URLField(
        help_text="A acá hay que mandar al usuario (redirect o window.open)."
    )
    estado_oauth = serializers.CharField(
        help_text=(
            "El `state`. El frontend NO necesita guardarlo: vuelve en la URL "
            "del callback y el servidor lo reconoce. Se devuelve para poder "
            "mostrarlo en pruebas y para correlacionar en los logs."
        )
    )
    expira_en = serializers.DateTimeField(
        help_text="Pasado esto hay que volver a empezar."
    )


class CallbackAutorizacionSerializer(serializers.Serializer):
    """Lo que vuelve del proveedor (FE-04), reenviado por el frontend.

    `codigo` y `error` son los dos desenlaces posibles y son excluyentes:
    o el usuario aceptó y hay código, o canceló y hay error. Que falten los
    dos es una petición mal armada.
    """

    estado_oauth = serializers.CharField(max_length=64)
    codigo = serializers.CharField(required=False, allow_blank=True, default="")
    error = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=120,
        help_text="Lo que manda el proveedor si el usuario cancela (access_denied).",
    )

    def validate(self, datos: dict) -> dict:
        if not datos.get("codigo") and not datos.get("error"):
            raise serializers.ValidationError(
                "Falta `codigo` (el usuario aceptó) o `error` (canceló)."
            )
        return datos


# ── Importaciones (FE-08) ────────────────────────────────────────────


class ImportacionSerializer(serializers.ModelSerializer):
    """El progreso de una importación, tal como lo consulta CH-27.

    Solo lectura entera: una importación no se edita desde afuera, nace del
    proceso que la ejecuta (FE-07 para CSV, FE-13 para correo).
    """

    estado_legible = serializers.CharField(source="get_estado_display", read_only=True)
    origen_legible = serializers.CharField(source="get_origen_display", read_only=True)
    progreso = serializers.IntegerField(
        read_only=True,
        allow_null=True,
        help_text=(
            "0 a 100, o null si todavía no se sabe cuántas filas hay. null y "
            "0 son cosas distintas: una barra indeterminada no es una vacía."
        ),
    )
    terminada = serializers.BooleanField(
        read_only=True,
        help_text="Si el estado ya es terminal. Un estado terminal no cambia.",
    )
    candidatos_confirmados = serializers.SerializerMethodField(
        help_text=(
            "Si la persona ACEPTÓ los candidatos (FE-11). OJO: distinto de "
            "`terminada`. Una importación terminada NO tocó ninguna "
            "suscripción todavía."
        )
    )

    class Meta:
        model = Importacion
        fields = (
            "id",
            "origen",
            "origen_legible",
            "nombre_archivo",
            "cuenta",
            "estado",
            "estado_legible",
            "terminada",
            "progreso",
            "filas_totales",
            "filas_procesadas",
            "candidatos_detectados",
            "candidatos_confirmados",
            "errores",
            "errores_totales",
            "terminada_en",
            "confirmada_en",
            "creado_en",
            "actualizado_en",
        )
        read_only_fields = fields

    def get_candidatos_confirmados(self, obj) -> bool:
        return obj.confirmada_en is not None


# ── Subida de archivos (FE-07) ───────────────────────────────────────


class SubidaArchivoSerializer(serializers.Serializer):
    """Lo que manda el cliente para importar: un archivo, y nada más.

    No es un ModelSerializer: la importación la crea el servidor con lo que
    valida del archivo (nombre, filas, formato). Si el cliente pudiera mandar
    `estado` o `filas_totales`, inventaría una importación.
    """

    archivo = serializers.FileField(
        help_text="Un .csv o un .pdf (cartola). Tamaño máximo en IMPORTACION_TAMANO_MAXIMO_BYTES.",
    )


class ArchivoRechazadoSerializer(serializers.Serializer):
    """La forma del 400/413 cuando el archivo no sirve."""

    codigo = serializers.CharField(
        help_text="formato_no_admitido | archivo_vacio | archivo_excedido | contenido_incompatible"
    )
    archivo = serializers.CharField(help_text="Qué pasó, para mostrarlo tal cual.")


# ── Candidatos de cobro (S3-FE-14) ───────────────────────────────────


class CobroCandidatoSerializer(serializers.ModelSerializer):
    """Un cobro propuesto, tal como lo lista la vista previa (S3-CH-04).

    Solo lectura entera. Un candidato no se edita desde afuera: lo escribe el
    lector que leyó su origen, y lo único que una persona puede hacerle es
    confirmarlo o rechazarlo, que son S3-FE-15 y S3-FE-16 y tienen sus
    propias rutas. Un `PATCH` acá dejaría cambiar el importe de un cobro que
    se presenta como evidencia de lo que decía la cartola.

    ── El importe sale como TEXTO ───────────────────────────────────────────
    DRF serializa `DecimalField` como cadena porque `COERCE_DECIMAL_TO_STRING`
    viene en `True`, y acá eso NO es un detalle: en JSON un número decimal lo
    lee el otro lado como `float` y se pierde la exactitud que se cuidó desde
    el parser. Si alguien pone esa opción en `False`, este contrato cambia sin
    que nadie lo note; hay una prueba que lo fija.
    """

    origen_legible = serializers.CharField(source="get_origen_display", read_only=True)
    estado_legible = serializers.CharField(source="get_estado_display", read_only=True)
    tipo_mensaje_legible = serializers.CharField(
        source="get_tipo_mensaje_display", read_only=True
    )
    aplicacion = serializers.SerializerMethodField(
        help_text=(
            "Si lo confirmado ya existe en Suscripciones. `null` mientras el "
            "candidato no está confirmado; `pendiente` cuando lo está: la "
            "orden de crear quedó guardada, pero todavía NO hay suscripción "
            "ni cobro creados."
        )
    )

    # ── «Confirmado» no es «aplicado» ───────────────────────────────────
    # Confirmar deja el candidato confirmado y una orden durable en el
    # outbox, los dos o ninguno. Lo que NO hace es crear la suscripción ni el
    # cobro: eso pasa en `subscriptions`, cuando alguien publique y consuma
    # esa orden, y hoy no hay ni publicador ni consumidor.
    #
    # Sin este campo la interfaz solo ve `estado="confirmado"` y no tiene
    # cómo saber que del otro lado todavía no existe nada: mostraría como
    # hecho algo que está en cola. Lo pidieron las dos revisiones de #159.
    #
    # Hoy vale `pendiente` para todo confirmado, y es la verdad: ninguna
    # orden se ha aplicado nunca. El valor `aplicada` llega con el
    # consumidor, que es quien puede afirmarlo; inventarlo acá sería dar por
    # creada una suscripción que nadie creó.
    APLICACION_PENDIENTE = "pendiente"

    def get_aplicacion(self, candidato) -> str | None:
        if candidato.estado == CobroCandidato.Estado.CONFIRMADO:
            return self.APLICACION_PENDIENTE
        return None

    class Meta:
        model = CobroCandidato
        fields = (
            "id",
            "importacion",
            "origen",
            "origen_legible",
            # El identificador estable que pide S3-CH-04 para que recargar no
            # duplique: es el mismo para el mismo hecho leído dos veces.
            "identificador_origen",
            "servicio",
            "servicio_texto",
            "servicio_resultado",
            "importe",
            "moneda",
            "fecha",
            "tipo_mensaje",
            "tipo_mensaje_legible",
            "estado",
            "estado_legible",
            # Quién decidió y cuándo (S3-FE-16). `null` mientras está
            # `propuesto`; una vez decidido no se mueve, aunque lleguen más
            # peticiones.
            "decidido_en",
            "decidido_por",
            "aplicacion",
            "evidencia",
            "creado_en",
        )
        read_only_fields = fields


class CandidatoYaConfirmadoSerializer(serializers.Serializer):
    """La forma del 409 al intentar rechazar un candidato ya confirmado."""

    codigo = serializers.CharField(help_text="candidato_ya_confirmado")
    detail = serializers.CharField(help_text="Qué pasó, para mostrarlo tal cual.")


class ConfirmacionRechazadaSerializer(serializers.Serializer):
    """La forma del 409 cuando un candidato no se puede confirmar."""

    codigo = serializers.CharField(
        help_text="candidato_rechazado | servicio_sin_resolver | tipo_sin_regla"
    )
    detail = serializers.CharField(help_text="Qué pasó, para mostrarlo tal cual.")
