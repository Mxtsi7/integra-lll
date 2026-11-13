"""El candidato de cobro, común a CSV y a correo (S3-FE-01).

Un **candidato** es un cobro que creemos haber encontrado y que todavía no es
nada: no existe suscripción, no existe cobro, no se tocó la cuenta de nadie.
Alguien lo va a mirar (S3-FE-14 lo previsualiza) y recién ahí se confirma
(S3-FE-15) o se rechaza (S3-FE-16).

── Por qué uno solo y no uno por origen ────────────────────────────────────
Un CSV y un correo llegan distintos: una fila de cartola trae fecha, glosa y
monto; un correo trae asunto, cuerpo y remitente. Pero lo que sale de los dos
tiene que ser **lo mismo**, porque de ahí en adelante el camino es compartido:
la vista previa, la confirmación, la detección de duplicados y la creación de
suscripciones no deberían preguntar de dónde vino.

Si cada origen tuviera su forma, esa pregunta aparecería en cada paso y cada
regla nueva habría que escribirla dos veces. El criterio de la tarjeta es
justamente ese: «correo y CSV generan ejemplos compatibles».

── Lo que un candidato tiene que poder contestar ───────────────────────────
    ¿de dónde salió?      `origen` + `identificador_origen`
    ¿de quién es?         `organizacion_id`
    ¿a quién se le paga?  `servicio` (y el texto original, siempre)
    ¿cuánto y en qué?     `importe` + `moneda`
    ¿cuándo?              `fecha`
    ¿qué clase de aviso?  `tipo_mensaje`
    ¿en qué va?           `estado`
    ¿cómo lo compruebo?   `evidencia`

── Dos decisiones que conviene no deshacer ─────────────────────────────────
**El importe es `Decimal`, nunca `float`.** `0.1 + 0.2` en binario no da
`0.3`, y esto es plata de otra persona. Entra como `Decimal` y sale como
`Decimal`; quien lo serialice lo convierte a texto, no a `float`.

**El texto original del servicio se conserva aunque se haya reconocido.**
`servicio` puede quedar en `None` si el nombre era ambiguo o desconocido
(`normalizacion.py` decide eso), y en ese caso lo único que hay para mostrarle
a la persona es lo que decía la cartola. Inventar un proveedor sería peor que
no asignar ninguno.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from types import MappingProxyType
from typing import Mapping

# ── De dónde salió ───────────────────────────────────────────────────
# Coinciden con `Importacion.Origen` a propósito: es el mismo concepto y
# duplicar los literales haría que se separaran con el tiempo.
ORIGEN_CSV = "csv"
ORIGEN_CORREO = "correo"
ORIGENES = (ORIGEN_CSV, ORIGEN_CORREO)


class TipoMensaje:
    """Qué clase de cobro es. Mezclarlos cobraría de más (S3-FE-08).

    Un recibo dice «te cobramos»; un aviso dice «te vamos a cobrar»; un fallo
    dice «no pudimos cobrarte». Tratar los tres como lo mismo inventaría un
    cobro que no ocurrió, o lo contaría dos veces cuando después llegue el
    recibo del aviso.
    """

    COBRO_REALIZADO = "cobro_realizado"
    AVISO_DE_COBRO = "aviso_de_cobro"
    PAGO_FALLIDO = "pago_fallido"

    TODOS = (COBRO_REALIZADO, AVISO_DE_COBRO, PAGO_FALLIDO)


class EstadoCandidato:
    """En qué va. `PROPUESTO` es el único que nace de un archivo o un correo.

    Los otros dos los pone una persona al revisar la vista previa. Un
    candidato nunca pasa solo de `PROPUESTO`: si algo lo moviera sin que
    nadie lo mirara, dejaría de ser un candidato y sería un cobro creado a
    espaldas de su dueño.
    """

    PROPUESTO = "propuesto"
    CONFIRMADO = "confirmado"
    RECHAZADO = "rechazado"

    TODOS = (PROPUESTO, CONFIRMADO, RECHAZADO)


_SIN_EVIDENCIA: Mapping[str, str] = MappingProxyType({})


@dataclass(frozen=True)
class Candidato:
    """Un cobro propuesto. Inmutable: lo que se leyó no se edita después.

    Si hay que corregir algo, se vuelve a leer el origen. Un candidato que se
    puede modificar deja de ser evidencia de lo que decía el archivo.
    """

    origen: str
    #: Identifica la fuente **dentro** de su origen, y tiene que ser estable:
    #: el mismo hecho leído dos veces produce el mismo identificador. Es lo
    #: que le permite a S3-FE-17 saber que ya vio esto. En CSV es la huella
    #: del cobro (`csv_candidatos.huella_csv`), que coincide también entre
    #: dos exportaciones que se traslapan; en correo, el Message-ID. El
    #: archivo y la fila exactos quedan en `evidencia`.
    identificador_origen: str

    organizacion_id: str

    #: El nombre canónico del proveedor, o `None` si no se pudo resolver sin
    #: inventar. `servicio_texto` sigue estando siempre.
    servicio: str | None
    servicio_texto: str
    #: `reconocido`, `ambiguo` o `desconocido`, tal como los devuelve
    #: `normalizacion.normalizar`. Se guarda para que la vista previa pueda
    #: mostrar por qué un candidato no tiene proveedor asignado.
    servicio_resultado: str

    importe: Decimal
    #: Código ISO 4217 en mayúsculas: CLP, USD, EUR. Nunca un símbolo: `$` no
    #: distingue pesos de dólares y esa confusión vale 900 veces el monto.
    moneda: str
    fecha: date

    tipo_mensaje: str
    estado: str = EstadoCandidato.PROPUESTO

    #: Lo mínimo para que una persona pueda comprobar de dónde salió esto sin
    #: volver al archivo: en CSV, la línea tal cual venía y su número; en
    #: correo, asunto y remitente. Es un mapa de texto a texto para que
    #: cada origen aporte lo suyo sin cambiar esta clase.
    evidencia: Mapping[str, str] = field(default=_SIN_EVIDENCIA)

    def __post_init__(self) -> None:
        if self.origen not in ORIGENES:
            raise ValueError(f"Origen desconocido: {self.origen!r}")
        if self.tipo_mensaje not in TipoMensaje.TODOS:
            raise ValueError(f"Tipo de mensaje desconocido: {self.tipo_mensaje!r}")
        if self.estado not in EstadoCandidato.TODOS:
            raise ValueError(f"Estado desconocido: {self.estado!r}")
        if not isinstance(self.importe, Decimal):
            # Explícito y temprano: un float que llegue hasta acá se arrastra
            # hasta la base y después nadie sabe de dónde salió el centavo.
            raise TypeError("El importe debe ser Decimal, no float ni str.")
        if not self.identificador_origen:
            raise ValueError("Un candidato sin identificador de origen no se puede deduplicar.")

    @property
    def servicio_para_revision(self) -> bool:
        """`True` cuando hay que mostrarlo sin proveedor asignado."""
        return self.servicio is None

    def clave_deduplicacion(self) -> tuple[str, str, str]:
        """Lo que hace que dos lecturas del mismo hecho sean el mismo hecho.

        La usa S3-FE-17. Va por `identificador_origen` y no por
        (servicio, importe, fecha): dos cobros iguales el mismo día son
        posibles —dos licencias del mismo plan— y colapsarlos perdería uno.
        """
        return (self.organizacion_id, self.origen, self.identificador_origen)

    def como_json(self) -> dict:
        """Forma serializable. El importe va como **texto**, no como número.

        En JSON un decimal se convierte en `float` del lado de quien lo lee, y
        ahí se pierde la exactitud que se cuidó todo el camino.
        """
        return {
            "origen": self.origen,
            "identificador_origen": self.identificador_origen,
            "organizacion_id": self.organizacion_id,
            "servicio": self.servicio,
            "servicio_texto": self.servicio_texto,
            "servicio_resultado": self.servicio_resultado,
            "importe": str(self.importe),
            "moneda": self.moneda,
            "fecha": self.fecha.isoformat(),
            "tipo_mensaje": self.tipo_mensaje,
            "estado": self.estado,
            "evidencia": dict(self.evidencia),
        }
