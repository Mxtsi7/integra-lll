"""S3-FE-09 — de los correos leídos a candidatos guardados, con su evidencia.

Junta las tres piezas que leen un correo sin guardar nada, y guarda lo que
sale:

    S3-FE-06  `origen_correo`    ¿quién es el mensaje? ¿de qué servicio habla?
    S3-FE-07  `datos_del_cobro`  ¿cuánto, en qué moneda y cuándo?
    S3-FE-08  `tipo_de_aviso`    ¿se cobró, se va a cobrar o falló el pago?

Son dos funciones, en el mismo orden que el CSV (`csv_candidatos.leer` y la
tarea de S3-FE-10):

    leer(pagina, ...)                     candidatos y errores; no toca la base
    guardar_pagina(importacion, pagina)   los deja guardados, sin duplicar

El resultado tiene la MISMA forma que el del CSV, para que la vista previa
(S3-FE-14) lo muestre sin cambios: los candidatos en `cobro_candidato`, todos
`propuesto`; los mensajes que no se pudieron usar, en `Importacion.errores`,
con `fila` en `null` porque un correo no tiene fila.

── Lo que no está confirmado no se inventa ─────────────────────────────────
Es la regla de S3-FE-07 y S3-FE-08, y la del lector de CSV: lo ambiguo se
señala, no se adivina. Un correo da un candidato solo si se sabe qué clase de
mensaje es y si el importe y la moneda se leyeron sin dudas. Si no, queda
como error con su motivo, que es la forma que ya tiene "para revisión" en una
importación:

    tipo incierto                     tipo_incierto
    importe ambiguo o negativo        importe_ambiguo
    sin importe                       importe_no_encontrado
    `$` solo, o dos monedas           moneda_ambigua
    fecha con dos lecturas            fecha_ambigua
    aviso o fallo sin fecha           fecha_no_indicada
    la lista lo nombró y no se leyó   mensaje_omitido

La fecha depende del tipo, como dice el contrato común (S3-MX-25,
`docs/contratos/candidatos-v1.md`): en un aviso es la del cobro ANUNCIADO
(`fecha_proximo_cobro` de S3-FE-07); en un recibo o un fallo, la del texto.
Un recibo que no trae fecha usa la de recepción, y lo declara en la evidencia
(`fecha_origen = "recepcion"` y el motivo), que es lo que el contrato permite
para un recibo. Un aviso sin fecha no: el día en que llegó no es el día en
que se va a cobrar.

El servicio es la excepción, también como en el CSV: un servicio ambiguo o
desconocido NO impide el candidato. Queda con `servicio = None` y el texto
original, y la confirmación (S3-FE-15) no lo deja pasar sin resolverlo.

Un correo que no habla de ningún cobro —sin una sola frase de S3-FE-08 y sin
un monto— no es un candidato ni un problema: se descarta y se cuenta. El
filtro de los lectores es amplio a propósito ("uno que sobra lo descarta
S3-FE-08", `lectura_correo.PALABRAS_DE_COBRO`). Si trae un monto, en cambio,
queda como `tipo_incierto`: puede ser un cobro escrito de otra forma.

── La evidencia ────────────────────────────────────────────────────────────
Lo mínimo para encontrar el correo y entender cada dato sin volver a leerlo:
de qué buzón y cuenta salió, su Message-ID y el `id` del proveedor, cuándo
llegó, remitente y asunto, y el pedazo de texto alrededor de cada dato
(«Total: CLP 9.990»): la ventana de S3-FE-07, que no cruza su frase y no pasa
de 30 caracteres antes y 20 después. Nunca la línea entera —un HTML de un
párrafo es una sola línea—, ni el cuerpo, ni adjuntos, ni nada de la
autorización. Todo pasa por `_acotado`: sin caracteres de control y con un
largo máximo.

── No confirma nada ─────────────────────────────────────────────────────────
No crea suscripciones ni cobros, no escribe en el outbox y no mueve la
importación de estado. Abrir y cerrar la importación es de quien orquesta la
lectura periódica (junto con S3-FE-18 y S3-FE-20).
"""

from __future__ import annotations

import dataclasses
import logging
from datetime import date

from django.db import transaction
from django.utils import timezone

from . import csv_candidatos
from .candidatos import ORIGEN_CORREO, Candidato
from .datos_del_cobro import AMBIGUO, AUSENTE, SUPUESTO, Campo, DatosDelCobro, datos_de
from .lectura_correo import MensajeCorreo, PaginaDeMensajes
from .models import CobroCandidato, CuentaConectada, Importacion
from .origen_correo import OrigenDelMensaje, identificador_del_proveedor, origen_de
from .tipo_de_aviso import AVISO_DE_COBRO, COBRO_REALIZADO, Clasificacion, clasificar

log = logging.getLogger(__name__)

# ── Códigos de error ─────────────────────────────────────────────────────
# Estables: el frontend decide por ellos. Los que significan lo mismo que en
# el CSV son los del CSV, para que la web no tenga dos códigos para una regla.
TIPO_INCIERTO = "tipo_incierto"
IMPORTE_AMBIGUO = "importe_ambiguo"
IMPORTE_NO_ENCONTRADO = "importe_no_encontrado"
MONEDA_AMBIGUA = csv_candidatos.MONEDA_AMBIGUA
MONEDA_NO_INDICADA = csv_candidatos.MONEDA_NO_INDICADA
FECHA_AMBIGUA = csv_candidatos.FECHA_AMBIGUA
FECHA_NO_INDICADA = "fecha_no_indicada"
MENSAJE_OMITIDO = "mensaje_omitido"

# ── De dónde salió la fecha (evidencia["fecha_origen"]) ──────────────────
FECHA_DEL_TEXTO = "texto"
FECHA_DEL_COBRO_ANUNCIADO = "cobro_anunciado"
#: El valor que fija el contrato común (S3-MX-25) para un recibo sin fecha.
FECHA_DE_RECEPCION = "recepcion"

# ── Topes de la evidencia ────────────────────────────────────────────────
#: Lo que se muestra de un asunto y de cada fragmento. Los fragmentos ya
#: salen de S3-FE-07 como una ventana corta (`datos_del_cobro._ventana`);
#: se acotan igual por si cambia.
LARGO_TEXTO = 200
#: Una dirección de correo no pasa de 254 (RFC 5321).
LARGO_DIRECCION = 254
#: El `id` de Outlook llega a 512 (ver `lector_outlook`).
LARGO_ID_PROVEEDOR = 512
#: RFC 5322: una línea no pasa de 998 caracteres.
LARGO_MESSAGE_ID = 998
#: Las explicaciones (regla del servicio, motivo, frases de S3-FE-08).
LARGO_EXPLICACION = 300
#: Lo que se muestra de un asunto o un remitente en el mensaje de un error,
#: que entero no pasa de 200 (`Importacion.anotar_error`).
LARGO_EN_ERROR = 60


class ImportacionNoDisponible(Exception):
    """La importación no puede recibir mensajes: no existe, no es de correo,
    no está `procesando` o su cuenta no es de su organización.

    Se LANZA, no se devuelve: quien lee la cuenta (S3-FE-03/05) mueve su
    cursor solo si guardar terminó bien. Si esto devolviera algo normal, el
    cursor avanzaría sobre mensajes que nadie guardó.
    """


@dataclasses.dataclass(frozen=True)
class ErrorDeMensaje:
    """Un mensaje que no da candidato, con su motivo. Es la `ErrorFila` del
    correo: en vez de número de fila lleva la identidad del mensaje."""

    identificador_origen: str
    codigo: str
    mensaje: str


@dataclasses.dataclass(frozen=True)
class LecturaDeCorreos:
    candidatos: tuple[Candidato, ...]
    errores: tuple[ErrorDeMensaje, ...]
    #: Mensajes que no hablan de ningún cobro. Ver la cabecera del módulo.
    descartados: int
    #: Mensajes y omitidos de la página, contando repetidos.
    mensajes: int


@dataclasses.dataclass(frozen=True)
class ResultadoDeGuardado:
    mensajes: int
    #: Candidatos que esta página agregó a la importación.
    candidatos_nuevos: int
    #: Candidatos de la página que ya estaban guardados, en esta importación
    #: o en otra de la misma organización: no se duplicaron.
    ya_guardados: int
    errores_nuevos: int
    descartados: int


class _ParaRevision(Exception):
    """Interno: un dato no está confirmado. `leer` lo vuelve `ErrorDeMensaje`."""

    def __init__(self, codigo: str, motivo: str):
        super().__init__(motivo)
        self.codigo = codigo
        self.motivo = motivo


# ══════════════════════════════════════════════════════════════════════
# Leer: de los mensajes a candidatos y errores, sin tocar la base
# ══════════════════════════════════════════════════════════════════════


def _acotado(texto, largo: int) -> str:
    """Una línea, sin caracteres de control y con tope.

    Un asunto o un fragmento puede traer saltos de línea, tabuladores o
    caracteres invisibles; en la evidencia tienen que ser una línea legible.
    """
    visibles = "".join(c if c.isprintable() else " " for c in str(texto or ""))
    compacto = " ".join(visibles.split())
    if len(compacto) <= largo:
        return compacto
    return compacto[: largo - 1] + "…"


def _importe(datos: DatosDelCobro):
    campo = datos.importe
    if campo.confirmado:
        return campo.valor
    if campo.estado == AUSENTE:
        raise _ParaRevision(IMPORTE_NO_ENCONTRADO, campo.motivo)
    # Ambiguo: dos totales, solo subtotales, centavos en CLP o un negativo.
    raise _ParaRevision(IMPORTE_AMBIGUO, campo.motivo)


def _moneda(datos: DatosDelCobro) -> str:
    campo = datos.moneda
    if campo.confirmado:
        return campo.valor
    if campo.estado == AUSENTE:
        raise _ParaRevision(MONEDA_NO_INDICADA, campo.motivo)
    raise _ParaRevision(MONEDA_AMBIGUA, campo.motivo)


def _fecha(datos: DatosDelCobro, tipo: str) -> tuple[date, str, Campo]:
    """(fecha, de dónde salió, el campo de S3-FE-07 que la dio).

    Un aviso habla de un cobro que todavía no ocurre: su fecha es la del cobro
    anunciado. Un recibo o un fallo hablan de algo que ya pasó: su fecha es la
    del texto, nunca la del próximo ciclo.
    """
    if tipo == AVISO_DE_COBRO:
        anunciada = datos.fecha_proximo_cobro
        if anunciada.confirmado:
            return anunciada.valor, FECHA_DEL_COBRO_ANUNCIADO, anunciada
        if anunciada.estado == AMBIGUO:
            raise _ParaRevision(FECHA_AMBIGUA, anunciada.motivo)
    fecha = datos.fecha
    if fecha.confirmado:
        return fecha.valor, FECHA_DEL_TEXTO, fecha
    if fecha.estado == AMBIGUO:
        raise _ParaRevision(FECHA_AMBIGUA, fecha.motivo)
    if fecha.estado == SUPUESTO and tipo == COBRO_REALIZADO:
        return fecha.valor, FECHA_DE_RECEPCION, fecha
    if tipo == AVISO_DE_COBRO:
        raise _ParaRevision(FECHA_NO_INDICADA, "el aviso no dice cuándo se va a cobrar")
    raise _ParaRevision(FECHA_NO_INDICADA, "el correo no dice cuándo se intentó el cobro")


def _servicio_texto(mensaje: MensajeCorreo, origen: OrigenDelMensaje) -> str:
    """El texto del que salió el servicio (nombre o dominio del remitente, o
    el asunto), que es lo que la web muestra cuando no se reconoció. Si no
    salió de ninguno, el asunto; si tampoco hay asunto, el remitente."""
    texto = origen.servicio.original or mensaje.asunto or origen.remitente
    return _acotado(texto, 300)


def _evidencia(
    mensaje: MensajeCorreo,
    origen: OrigenDelMensaje,
    clasificacion: Clasificacion,
    datos: DatosDelCobro,
    fecha_origen: str,
    campo_fecha: Campo,
) -> dict[str, str]:
    """Lo mínimo para encontrar el correo y entender cada dato. Las claves
    vacías no se guardan: un correo sin Message-ID no lleva `message_id`."""
    evidencia = {
        "proveedor_correo": mensaje.proveedor_correo,
        "cuenta_id": str(mensaje.cuenta_id),
        "id_mensaje": _acotado(mensaje.id_mensaje, LARGO_ID_PROVEEDOR),
        "message_id": _acotado(mensaje.message_id, LARGO_MESSAGE_ID),
        "recibido_en": mensaje.recibido_en.isoformat(),
        "remitente": _acotado(origen.remitente, LARGO_DIRECCION),
        "asunto": _acotado(mensaje.asunto, LARGO_TEXTO),
        "servicio_fuente": origen.fuente,
        "servicio_regla": _acotado(origen.servicio.regla, LARGO_EXPLICACION),
        "tipo_motivo": _acotado(clasificacion.motivo, LARGO_EXPLICACION),
        "tipo_evidencia": _acotado("; ".join(clasificacion.evidencia), LARGO_EXPLICACION),
        # La moneda sale del mismo monto que el importe (S3-FE-07 los lee
        # juntos), así que un fragmento alcanza para los dos.
        "importe_fragmento": _acotado(datos.importe.fragmento, LARGO_TEXTO),
        "fecha_fragmento": _acotado(campo_fecha.fragmento, LARGO_TEXTO),
        "fecha_origen": fecha_origen,
    }
    if fecha_origen == FECHA_DE_RECEPCION:
        evidencia["fecha_motivo"] = _acotado(campo_fecha.motivo, LARGO_EXPLICACION)
    if mensaje.texto_truncado:
        evidencia["texto_truncado"] = "el texto del correo se cortó al leerlo; lo que venía después no se miró"
    return {clave: valor for clave, valor in evidencia.items() if valor}


def _candidato_de(mensaje: MensajeCorreo, origen: OrigenDelMensaje, *, organizacion_id: str) -> Candidato | None:
    """El candidato del mensaje, `None` si no habla de ningún cobro, o
    `_ParaRevision` si habla de uno pero algo no está confirmado."""
    clasificacion = clasificar(mensaje)
    datos = datos_de(mensaje)
    if clasificacion.incierto:
        if not clasificacion.evidencia and datos.importe.estado == AUSENTE:
            return None
        raise _ParaRevision(TIPO_INCIERTO, clasificacion.motivo)
    importe = _importe(datos)
    moneda = _moneda(datos)
    fecha, fecha_origen, campo_fecha = _fecha(datos, clasificacion.tipo)
    servicio = origen.servicio
    return Candidato(
        origen=ORIGEN_CORREO,
        identificador_origen=origen.identificador_origen,
        organizacion_id=organizacion_id,
        # Solo el reconocido. Un ambiguo («Apple») o una sugerencia del
        # asunto queda sin proveedor, como en el CSV: inventarlo es peor.
        servicio=servicio.proveedor if servicio.reconocido else None,
        servicio_texto=_servicio_texto(mensaje, origen),
        servicio_resultado=servicio.resultado,
        importe=importe,
        moneda=moneda,
        fecha=fecha,
        tipo_mensaje=clasificacion.tipo,
        evidencia=_evidencia(mensaje, origen, clasificacion, datos, fecha_origen, campo_fecha),
    )


def _descripcion(mensaje: MensajeCorreo, origen: OrigenDelMensaje) -> str:
    """Cómo encuentra la persona el correo en su buzón."""
    asunto = _acotado(mensaje.asunto, LARGO_EN_ERROR) or "(sin asunto)"
    remitente = _acotado(origen.remitente, LARGO_EN_ERROR) or "remitente desconocido"
    return f"«{asunto}» de {remitente}, recibido el {mensaje.recibido_en.date().isoformat()}"


def leer(pagina: PaginaDeMensajes, *, organizacion_id: str, cuenta_id, proveedor_correo: str) -> LecturaDeCorreos:
    """Los candidatos y los errores de una página. No toca la base.

    Si dos mensajes de la página son el mismo correo (el mismo Message-ID en
    dos carpetas), cuenta el primero: es un solo correo y un solo cobro.

    `cuenta_id` y `proveedor_correo` son de la cuenta que se leyó: con ellos
    se identifica un mensaje omitido, que no trae más que su `id`.
    """
    candidatos: list[Candidato] = []
    errores: list[ErrorDeMensaje] = []
    vistos: set[str] = set()
    descartados = 0

    for mensaje in pagina.mensajes:
        origen = origen_de(mensaje)
        if origen.identificador_origen in vistos:
            continue
        vistos.add(origen.identificador_origen)
        try:
            candidato = _candidato_de(mensaje, origen, organizacion_id=organizacion_id)
        except _ParaRevision as para_revision:
            errores.append(ErrorDeMensaje(
                identificador_origen=origen.identificador_origen,
                codigo=para_revision.codigo,
                mensaje=f"{_descripcion(mensaje, origen)}: {para_revision.motivo}",
            ))
            continue
        if candidato is None:
            descartados += 1
        else:
            candidatos.append(candidato)

    for omitido in pagina.omitidos:
        identificador = identificador_del_proveedor(proveedor_correo, cuenta_id, omitido.id_mensaje)
        if identificador in vistos:
            continue
        vistos.add(identificador)
        errores.append(ErrorDeMensaje(
            identificador_origen=identificador,
            codigo=MENSAJE_OMITIDO,
            mensaje=f"Un correo de la lista no se pudo leer: {_acotado(omitido.motivo, 120)}",
        ))

    return LecturaDeCorreos(
        candidatos=tuple(candidatos),
        errores=tuple(errores),
        descartados=descartados,
        mensajes=len(pagina.mensajes) + len(pagina.omitidos),
    )


# ══════════════════════════════════════════════════════════════════════
# Guardar: una página dentro de su importación, sin duplicar
# ══════════════════════════════════════════════════════════════════════


def _proveedor_de_la_cuenta(importacion: Importacion) -> str:
    """El proveedor de la cuenta de la importación, si es de su organización."""
    if importacion.origen != Importacion.Origen.CORREO or importacion.cuenta_id is None:
        raise ImportacionNoDisponible(f"la importación {importacion.pk} no es una lectura de correo con su cuenta")
    proveedor = (
        CuentaConectada.objects.filter(pk=importacion.cuenta_id, organizacion_id=importacion.organizacion_id)
        .values_list("proveedor", flat=True)
        .first()
    )
    if proveedor not in (CuentaConectada.Proveedor.GMAIL, CuentaConectada.Proveedor.OUTLOOK):
        raise ImportacionNoDisponible(
            f"la cuenta de la importación {importacion.pk} no es un buzón de esta organización"
        )
    return proveedor


def _exigir_mensajes_de_la_cuenta(pagina: PaginaDeMensajes, cuenta_id, proveedor: str) -> None:
    """Un mensaje de otra cuenta es un error de programación, y guardarlo
    podría dejar el correo de una organización en otra. No se guarda nada."""
    for mensaje in pagina.mensajes:
        if mensaje.cuenta_id != cuenta_id or mensaje.proveedor_correo != proveedor:
            raise ValueError(
                f"la página trae un mensaje de otra cuenta ({mensaje.proveedor_correo}); "
                "no se guarda nada de ella"
            )


def guardar_pagina(importacion: Importacion, pagina: PaginaDeMensajes, *, ahora=None) -> ResultadoDeGuardado:
    """Guarda los candidatos y los errores de una página en su importación.

    Pensada para ser el `procesar` de la lectura por cursor (S3-FE-03/05):
    corre dentro de su transacción, y si lanza, el cursor no se mueve.

    ── Idempotente ─────────────────────────────────────────────────────────
    Volver a guardar la misma página —el cursor se reinició, el solape entre
    corridas trae un correo otra vez, dos workers— no duplica nada:

    · un candidato choca con la unicidad de (organización, origen,
      identificador) de S3-FE-17, también si ya estaba bajo OTRA importación
      o si ya se rechazó;
    · un error no se anota dos veces: la entrada lleva la identidad del
      mensaje. Pasado el tope de `Importacion.MAXIMO_ERRORES` la lista ya no
      crece y la identidad de los que no entraron no queda guardada, así que
      un mensaje con error releído ahí suma otra vez en `errores_totales`.
      `filas_procesadas` también cuenta la relectura. Ver el documento 30.

    ── La importación, tomada ───────────────────────────────────────────────
    La fila de la importación se bloquea antes de escribir: los contadores y
    la lista de errores se leen y se escriben con ella tomada, así que dos
    páginas guardadas a la vez no se pisan. Y si mientras tanto otra corrida
    la cerró (el rescate de S3-FE-10 la marca `fallida`), no se escribe nada:
    `ImportacionNoDisponible`.

    No mueve el estado de la importación ni confirma nada.
    """
    proveedor = _proveedor_de_la_cuenta(importacion)
    _exigir_mensajes_de_la_cuenta(pagina, importacion.cuenta_id, proveedor)
    # El cálculo, fuera del bloqueo: no necesita la base y una página de 100
    # correos largos no tiene por qué tener tomada la importación.
    lectura = leer(
        pagina,
        organizacion_id=str(importacion.organizacion_id),
        cuenta_id=importacion.cuenta_id,
        proveedor_correo=proveedor,
    )
    ahora = ahora or timezone.now()

    with transaction.atomic():
        tomada = Importacion.objects.select_for_update().filter(pk=importacion.pk).first()
        if tomada is None or tomada.estado != Importacion.Estado.PROCESANDO:
            estado = tomada.estado if tomada else "inexistente"
            raise ImportacionNoDisponible(
                f"la importación {importacion.pk} está {estado}: no recibe más mensajes"
            )
        if (tomada.organizacion_id, tomada.cuenta_id, tomada.origen) != (
            importacion.organizacion_id, importacion.cuenta_id, importacion.origen,
        ):
            # Lo que se leyó se leyó para ESA cuenta y ESA organización.
            raise ImportacionNoDisponible(f"la importación {importacion.pk} cambió de cuenta mientras se leía")

        antes = CobroCandidato.objects.filter(importacion=tomada).count()
        CobroCandidato.guardar_sin_duplicar(
            [CobroCandidato.desde_candidato(candidato, importacion=tomada) for candidato in lectura.candidatos]
        )
        guardados = CobroCandidato.objects.filter(importacion=tomada).count()

        anotados = {error.get("identificador_origen") for error in tomada.errores if isinstance(error, dict)}
        errores_antes = tomada.errores_totales
        for error in lectura.errores:
            if error.identificador_origen in anotados:
                continue
            anotados.add(error.identificador_origen)
            tomada.anotar_error(error.codigo, error.mensaje, identificador_origen=error.identificador_origen)

        Importacion.objects.filter(pk=tomada.pk).update(
            filas_procesadas=tomada.filas_procesadas + lectura.mensajes,
            candidatos_detectados=guardados,
            errores=tomada.errores,
            errores_totales=tomada.errores_totales,
            actualizado_en=ahora,
        )

    # Quien llamó ve lo que quedó, como en la tarea del CSV.
    importacion.filas_procesadas = tomada.filas_procesadas + lectura.mensajes
    importacion.candidatos_detectados = guardados
    importacion.errores = tomada.errores
    importacion.errores_totales = tomada.errores_totales
    importacion.actualizado_en = ahora

    resultado = ResultadoDeGuardado(
        mensajes=lectura.mensajes,
        candidatos_nuevos=guardados - antes,
        ya_guardados=len(lectura.candidatos) - (guardados - antes),
        errores_nuevos=tomada.errores_totales - errores_antes,
        descartados=lectura.descartados,
    )
    # Solo números y el id: ni asuntos ni remitentes en los registros.
    log.info(
        "importación %s: %s mensajes, %s candidatos nuevos, %s ya guardados, %s errores nuevos, %s descartados",
        importacion.pk,
        resultado.mensajes,
        resultado.candidatos_nuevos,
        resultado.ya_guardados,
        resultado.errores_nuevos,
        resultado.descartados,
    )
    return resultado
