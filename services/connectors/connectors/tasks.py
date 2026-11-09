"""Tareas Celery de connectors.

Las ejecuta `connectors-worker` (`celery -A connectors_config worker --beat`)
y `autodiscover_tasks` las encuentra por vivir en este módulo.

── Qué hay acá ──────────────────────────────────────────────────────────────
    latido                            que beat programa y el worker ejecuta
    procesar_importacion              S3-FE-10: el archivo subido → candidatos
    rescatar_importaciones_estancadas  la red bajo el trapecio (ver abajo)

La lectura de correo (FE-13) todavía no existe; cuando llegue, va acá y se
programa en CELERY_BEAT_SCHEDULE (connectors_config/settings.py).

── Por qué el procesamiento es una tarea y no parte de la subida ────────────
`SubirArchivoView` tiene que contestar un 201 con el id de la importación de
inmediato: eso es lo que le permite al frontend mostrar el progreso y hacer
polling (FE-08). Leer el archivo adentro de la petición dejaría al navegador
esperando y haría inútil toda la máquina de estados de `Importacion`.

── La red bajo el trapecio ──────────────────────────────────────────────────
El broker es Redis, y Redis no es durable: si el worker se cae con la tarea
tomada, el mensaje se pierde. Sin nada más, esa importación se queda
`pendiente` o `procesando` para siempre, y el criterio de la tarjeta es
justamente que el estado "refleje inicio y final del procesamiento". Un
estado que no avanza nunca no refleja nada, y el frontend hace polling eterno.

Por eso `rescatar_importaciones_estancadas` corre cada tanto:

    `pendiente` hace rato   → se vuelve a encolar (la tarea es idempotente)
    `procesando` hace mucho → se marca `fallida`, que es un final honesto

── Reprocesar no duplica ────────────────────────────────────────────────────
Un candidato de CSV se identifica por `<sha256 del archivo>:<número de fila>`
y la tabla tiene una unicidad sobre (organización, origen, identificador). Dos
corridas de la misma importación escriben las mismas filas, no el doble.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import transaction
from django.utils import timezone

from . import archivos, csv_candidatos
from .models import ArchivoImportacion, CobroCandidato, Importacion

log = logging.getLogger(__name__)

# ── Códigos de error propios de esta etapa ───────────────────────────
# Estables, como los del parser: el frontend decide por ellos. Los de una
# fila los pone `csv_candidatos`; estos son los del archivo o del trabajo.
ARCHIVO_NO_DISPONIBLE = "archivo_no_disponible"
FORMATO_SIN_LECTOR = "formato_sin_lector"
PROCESAMIENTO_INTERRUMPIDO = "procesamiento_interrumpido"

#: Cuántas importaciones atiende una pasada del rescate. Acotado para que una
#: cola acumulada no convierta un tick de beat en un trabajo de horas.
LOTE_DE_RESCATE = 50


def _orden_fecha_configurado() -> str | None:
    """Valida `IMPORTACION_ORDEN_FECHA` al cargar el módulo, no al usarlo.

    Un valor escrito de otra forma —`DMY`, `dia_primero`— no lanza nada en el
    parser: cae en la rama de "no se pudo desambiguar" y RECHAZA calladamente
    todas las filas con fecha ambigua. Un error de configuración que se
    manifiesta como "tu cartola está mala" es lo peor de los dos mundos, así
    que el worker no arranca con un valor que no existe.
    """
    valor = (getattr(settings, "IMPORTACION_ORDEN_FECHA", "") or "").strip()
    if not valor:
        return None
    if valor not in (csv_candidatos.ORDEN_DMY, csv_candidatos.ORDEN_MDY):
        raise ImproperlyConfigured(
            f"IMPORTACION_ORDEN_FECHA={valor!r} no existe. Usa "
            f"{csv_candidatos.ORDEN_DMY!r}, {csv_candidatos.ORDEN_MDY!r}, o déjalo "
            "vacío para que se deduzca del archivo."
        )
    return valor


def _moneda_configurada() -> str | None:
    """Valida `IMPORTACION_MONEDA_POR_DEFECTO` igual que el orden de fecha.

    Una moneda que el parser no conoce rechaza cada fila que no traiga columna
    de moneda, con un error que apunta a la fila y no a la configuración.
    """
    valor = (getattr(settings, "IMPORTACION_MONEDA_POR_DEFECTO", "") or "").strip().upper()
    if not valor:
        return None
    if valor not in csv_candidatos.DECIMALES_POR_MONEDA:
        admitidas = ", ".join(sorted(csv_candidatos.DECIMALES_POR_MONEDA))
        raise ImproperlyConfigured(
            f"IMPORTACION_MONEDA_POR_DEFECTO={valor!r} no está entre las "
            f"admitidas: {admitidas}."
        )
    return valor


ORDEN_FECHA = _orden_fecha_configurado()
MONEDA_POR_DEFECTO = _moneda_configurada()


@shared_task
def latido():
    """Tarea básica de prueba: confirma que beat programa y worker ejecuta."""
    ahora = timezone.localtime()
    log.info("latido de %s a las %s", settings.SERVICE_NAME, ahora.strftime("%H:%M:%S"))
    return {"servicio": settings.SERVICE_NAME, "latido": ahora.isoformat()}


# ═══════════════════════════════════════════════════════════════════
# S3-FE-10 — del archivo subido a los candidatos
# ═══════════════════════════════════════════════════════════════════


def _cerrada_por_otro(importacion: Importacion, codigo: str) -> dict:
    """Lo que se devuelve cuando el cierre lo gano otra corrida."""
    importacion.refresh_from_db()
    log.info(
        "importación %s ya la cerró otra corrida (%s); %s no se publica",
        importacion.pk,
        importacion.estado,
        codigo,
    )
    return {
        "importacion": str(importacion.pk),
        "estado": importacion.estado,
        "repetida": True,
    }


def _terminar_mal(importacion: Importacion, codigo: str, mensaje: str) -> dict:
    """Deja la importación `fallida` con un único error que explica por qué.

    ── El motivo y el estado terminal se escriben JUNTOS ───────────────────
    Y condicionados al estado que esta instancia cree vigente, con el CAS en
    el WHERE. Antes eran dos pasos —guardar el motivo y después mover el
    estado— y eso dejaba pisar un cierre ajeno: el rescate marcaba
    `procesamiento_interrumpido` y el worker que seguía vivo le escribía
    encima su propio motivo sobre una importación que ya no era suya. Lo
    encontró la revisión de #147.

    Si el CAS no gana, acá no se toca nada: ni el estado, ni los errores.

    Los errores se reemplazan en vez de sumarse: si esto es un reintento, los
    de la corrida anterior ya no describen el estado actual, y dejarlos haría
    que `errores_totales` creciera en cada pasada.
    """
    desde = importacion.estado
    if Importacion.Estado.FALLIDA not in Importacion.TRANSICIONES.get(desde, set()):
        # Terminal, o un estado del que no se puede fallar: no hay nada que
        # cerrar y pisarlo seria justamente el error que esto evita.
        return _cerrada_por_otro(importacion, codigo)

    importacion.errores = []
    importacion.errores_totales = 0
    importacion.anotar_error(codigo, mensaje)
    ahora = timezone.now()

    with transaction.atomic():
        cambiadas = Importacion.objects.filter(pk=importacion.pk, estado=desde).update(
            estado=Importacion.Estado.FALLIDA,
            terminada_en=ahora,
            actualizado_en=ahora,
            errores=importacion.errores,
            errores_totales=importacion.errores_totales,
        )

    if not cambiadas:
        return _cerrada_por_otro(importacion, codigo)

    importacion.estado = Importacion.Estado.FALLIDA
    importacion.terminada_en = ahora
    log.warning("importación %s fallida: %s", importacion.pk, codigo)
    return {"importacion": str(importacion.pk), "estado": importacion.estado, "codigo": codigo}


@shared_task
def procesar_importacion(importacion_id: str) -> dict:
    """Lee el CSV de una importación y guarda sus candidatos (S3-FE-10).

    Es el cable entre FE-07 (que recibió y validó el archivo) y S3-FE-11/12/13
    (que saben leerlo). No crea ni toca ninguna suscripción: deja candidatos
    `propuesto` para que S3-FE-14 los muestre y una persona decida.

    Idempotente a propósito: se puede volver a encolar sin revisar nada.
    """
    try:
        importacion = Importacion.objects.get(pk=importacion_id)
    except (Importacion.DoesNotExist, ValidationError, ValueError):
        # Puede pasar de verdad: el rescate reencola, y entremedio alguien
        # pudo borrar la importación. No es un fallo del que valga reintentar.
        log.warning("importación %s ya no existe; no hay nada que procesar", importacion_id)
        return {"importacion": str(importacion_id), "estado": "inexistente"}

    if importacion.terminada:
        # `completada` y `fallida` son terminales y estables (FE-08). Una
        # reentrega del mismo mensaje no las vuelve a mover.
        return {"importacion": str(importacion.pk), "estado": importacion.estado, "repetida": True}

    if not importacion.avanzar_a(Importacion.Estado.PROCESANDO):
        # La guarda de `avanzar_a` va en el WHERE: si devolvió False, otra
        # corrida se la llevó. Dos workers leyendo el mismo archivo no se
        # corrompen —la unicidad los protege— pero es trabajo tirado.
        log.info("importación %s ya la tomó otra corrida (%s)", importacion.pk, importacion.estado)
        return {"importacion": str(importacion.pk), "estado": importacion.estado, "repetida": True}

    try:
        archivo = importacion.archivo
    except ArchivoImportacion.DoesNotExist:
        # Lo normal es que esto sea la purga: `ArchivoImportacion` es
        # almacenamiento TEMPORAL y se borra a los IMPORTACION_DIAS_RETENCION
        # días. Una importación que estuvo `pendiente` más que eso ya no tiene
        # de dónde leer.
        return _terminar_mal(
            importacion,
            ARCHIVO_NO_DISPONIBLE,
            "El archivo ya no está guardado: se venció su retención temporal. "
            "Vuelve a subirlo.",
        )

    if archivo.formato != ArchivoImportacion.Formato.CSV:
        # La cartola PDF se admite al subir (FE-07) pero todavía no hay quién
        # la lea. Decirlo con un código propio es mejor que dejarla
        # `pendiente` para siempre, que es lo que parece un sistema colgado.
        return _terminar_mal(
            importacion,
            FORMATO_SIN_LECTOR,
            f"Todavía no se puede leer un archivo {archivo.formato.upper()}; "
            "por ahora solo CSV.",
        )

    # `BinaryField` devuelve `memoryview` en PostgreSQL y `bytes` en SQLite.
    contenido = bytes(archivo.contenido)

    # ── Se vuelve a validar, y a propósito ──────────────────────────────
    # El separador lo detectó la validación de FE-07 y NO quedó guardado en
    # `ArchivoImportacion`. Volver a pasar por `archivos.validar` lo recupera
    # con exactamente el mismo criterio —es una función pura sobre los mismos
    # bytes, así que da el mismo resultado— y de paso comprueba que lo que se
    # va a leer sigue siendo un CSV. Adivinarlo de nuevo acá con otra regla
    # sería la forma más fácil de leer el archivo distinto de como se validó.
    #
    # El tope de tamaño es el del propio archivo y no el de settings: la cuota
    # de tamaño ya se aplicó al subir, y si alguien bajó el máximo entremedio,
    # un archivo que entró legítimamente no tiene por qué fallar recién ahora.
    try:
        validado = archivos.validar(
            importacion.nombre_archivo or f"cartola.{archivo.formato}",
            contenido,
            tamano_maximo=archivo.tamano,
        )
    except archivos.ArchivoRechazado as exc:
        return _terminar_mal(importacion, exc.codigo, exc.mensaje)

    try:
        resultado = csv_candidatos.leer(
            contenido,
            separador=validado.separador,
            organizacion_id=str(importacion.organizacion_id),
            sha256=archivo.sha256,
            orden_fecha=ORDEN_FECHA,
            moneda_por_defecto=MONEDA_POR_DEFECTO,
        )
    except csv_candidatos.CsvInvalido as exc:
        # Lo único que lanza `leer` son problemas del archivo COMPLETO: falta
        # una columna obligatoria, no hay cabecera, o el orden de fecha se
        # contradice. Ahí no hay filas que rescatar.
        return _terminar_mal(importacion, exc.codigo, exc.mensaje)

    filas = [
        CobroCandidato.desde_candidato(candidato, importacion=importacion)
        for candidato in resultado.candidatos
    ]

    # Los errores se arman en memoria con `anotar_error`, que es quien sabe
    # cuántos se guardan (`MAXIMO_ERRORES`) y cuántos se cuentan.
    importacion.errores = []
    importacion.errores_totales = 0
    for error in resultado.errores:
        importacion.anotar_error(error.codigo, error.mensaje, fila=error.fila)

    ahora = timezone.now()
    # ── Todo junto, o nada ──────────────────────────────────────────────
    # El cierre se RECLAMA primero, con el CAS en el WHERE, y dentro de la
    # misma transacción que inserta los candidatos. Dos cosas a la vez:
    #
    #   · si otra corrida ya cerró la importación —el rescate, típicamente—
    #     el UPDATE afecta 0 filas y acá no se escribe nada: ni candidatos,
    #     ni contadores, ni errores, ni estado. Antes el worker tardío
    #     publicaba igual y dejaba una terminal mentirosa: FALLIDA con 2
    #     candidatos, `errores=[]` y el motivo del rescate borrado. Lo
    #     encontró la revisión de #147.
    #   · y el UPDATE deja la fila bloqueada hasta el commit, así que nadie
    #     se mete entre el cierre y la inserción.
    #
    # `filas_totales` se vuelve a fijar porque la subida lo estimó contando
    # líneas no vacías y el lector sabe el número de verdad: una glosa con un
    # salto de línea entre comillas ocupa dos líneas y una sola fila.
    with transaction.atomic():
        cerrada = Importacion.objects.filter(
            pk=importacion.pk, estado=Importacion.Estado.PROCESANDO
        ).update(
            estado=Importacion.Estado.COMPLETADA,
            terminada_en=ahora,
            actualizado_en=ahora,
            errores=importacion.errores,
            errores_totales=importacion.errores_totales,
            filas_totales=resultado.filas_totales,
            filas_procesadas=resultado.filas_totales,
            candidatos_detectados=len(filas),
        )
        if cerrada:
            # `ignore_conflicts`: la unicidad de (organización, origen,
            # identificador) es lo que hace idempotente a esta tarea. Un
            # reintento choca con sus propias filas y no las duplica.
            CobroCandidato.objects.bulk_create(filas, ignore_conflicts=True)
            # Y se cuenta de verdad: `bulk_create` con `ignore_conflicts` no
            # dice cuántas insertó, y en un reintento las de la corrida
            # anterior ya estaban. Lo que la persona tiene que ver es cuántos
            # candidatos EXISTEN, no cuántos se intentaron.
            guardados = CobroCandidato.objects.filter(importacion=importacion).count()
            if guardados != len(filas):
                Importacion.objects.filter(pk=importacion.pk).update(
                    candidatos_detectados=guardados
                )

    if not cerrada:
        return _cerrada_por_otro(importacion, "completada")

    importacion.estado = Importacion.Estado.COMPLETADA
    importacion.terminada_en = ahora
    importacion.filas_totales = resultado.filas_totales
    importacion.filas_procesadas = resultado.filas_totales
    importacion.candidatos_detectados = guardados

    log.info(
        "importación %s completada: %s candidatos, %s errores de %s filas",
        importacion.pk,
        guardados,
        importacion.errores_totales,
        resultado.filas_totales,
    )
    return {
        "importacion": str(importacion.pk),
        "estado": importacion.estado,
        "candidatos": guardados,
        "errores": importacion.errores_totales,
        "filas": resultado.filas_totales,
    }


@shared_task
def rescatar_importaciones_estancadas() -> dict:
    """Vuelve a encolar lo que quedó `pendiente` y cierra lo que quedó colgado.

    Ver "La red bajo el trapecio" arriba: con un broker que no es durable,
    esto es lo que impide que una importación se quede sin final.
    """
    ahora = timezone.now()

    espera = timedelta(minutes=int(settings.IMPORTACION_REENCOLAR_TRAS_MINUTOS))
    # Solo las de CSV: una importación de correo (FE-13) también nace
    # `pendiente` y no la procesa esta tarea. Mandársela sería leer un archivo
    # que no existe.
    pendientes = list(
        Importacion.objects.filter(
            estado=Importacion.Estado.PENDIENTE,
            origen=Importacion.Origen.CSV,
            creado_en__lte=ahora - espera,
        ).values_list("id", flat=True)[:LOTE_DE_RESCATE]
    )
    for identificador in pendientes:
        procesar_importacion.delay(str(identificador))

    limite = timedelta(minutes=int(settings.IMPORTACION_ESTANCADA_TRAS_MINUTOS))
    estancadas = 0
    for importacion in Importacion.objects.filter(
        estado=Importacion.Estado.PROCESANDO,
        actualizado_en__lte=ahora - limite,
    )[:LOTE_DE_RESCATE]:
        # `_terminar_mal` escribe el motivo y el estado JUNTOS, con el CAS
        # en el WHERE, así que si el worker original está vivo y la cierra
        # primero, acá no se toca nada. Perder un rescate es barato;
        # corromper el resultado de una importación que sí terminó, no.
        if _terminar_mal(
            importacion,
            PROCESAMIENTO_INTERRUMPIDO,
            "El procesamiento se interrumpió y no terminó. Vuelve a subir el archivo.",
        ).get("repetida"):
            continue
        estancadas += 1

    if pendientes or estancadas:
        log.info(
            "rescate de importaciones: %s reencoladas, %s marcadas fallidas",
            len(pendientes),
            estancadas,
        )
    return {"reencoladas": len(pendientes), "fallidas": estancadas}
