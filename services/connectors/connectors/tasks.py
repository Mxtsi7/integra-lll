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


def _terminar_mal(importacion: Importacion, codigo: str, mensaje: str) -> dict:
    """Deja la importación `fallida` con un único error que explica por qué.

    Los errores se reemplazan en vez de sumarse: si esto es un reintento, los
    de la corrida anterior ya no describen el estado actual, y dejarlos haría
    que `errores_totales` creciera en cada pasada.

    OJO: escribe el motivo ANTES de mover el estado, así que solo la puede
    llamar quien ya tiene la importación reclamada —`procesar_importacion`
    después de su `avanzar_a(procesando)`—. El rescate NO la usa para cerrar
    una estancada: ahí el worker original puede estar vivo, y hay que
    reclamar la transición primero (ver `rescatar_importaciones_estancadas`).
    """
    importacion.errores = []
    importacion.errores_totales = 0
    importacion.anotar_error(codigo, mensaje)
    importacion.save(update_fields=["errores", "errores_totales", "actualizado_en"])
    importacion.avanzar_a(Importacion.Estado.FALLIDA)
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
    with transaction.atomic():
        # `ignore_conflicts`: la unicidad de (organización, origen,
        # identificador) es lo que hace idempotente a esta tarea. Un reintento
        # choca con sus propias filas y no las duplica.
        CobroCandidato.objects.bulk_create(filas, ignore_conflicts=True)
        # Se cuenta con una consulta y no con el largo de `filas`:
        # `bulk_create` con `ignore_conflicts` no dice cuántas insertó de
        # verdad, y lo que la persona tiene que ver es cuántos candidatos
        # existen, no cuántos se intentaron.
        guardados = CobroCandidato.objects.filter(importacion=importacion).count()

        importacion.errores = []
        importacion.errores_totales = 0
        for error in resultado.errores:
            importacion.anotar_error(error.codigo, error.mensaje, fila=error.fila)

        # `filas_totales` se vuelve a fijar porque la subida lo estimó contando
        # líneas no vacías y el lector sabe el número de verdad: una glosa con
        # un salto de línea entre comillas ocupa dos líneas y una sola fila.
        importacion.filas_totales = resultado.filas_totales
        importacion.filas_procesadas = resultado.filas_totales
        importacion.candidatos_detectados = guardados
        importacion.save(
            update_fields=[
                "errores",
                "errores_totales",
                "filas_totales",
                "filas_procesadas",
                "candidatos_detectados",
                "actualizado_en",
            ]
        )

    # Al final, y fuera de la transacción: quien haga polling y vea
    # `completada` tiene que encontrar los números ya escritos. Al revés
    # vería un estado terminal con cero candidatos por un instante.
    importacion.avanzar_a(Importacion.Estado.COMPLETADA)

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
        # ── Primero se reclama la transición, después se escribe el motivo ──
        # Al revés —como hace `_terminar_mal`— se le pisarían los errores a
        # una importación que justo terminó bien: el worker que la tenía pudo
        # estar vivo y cerrándola en este instante. La guarda de `avanzar_a`
        # va en el WHERE, así que si devuelve False ganó él y acá no se toca
        # nada. Perder un rescate es barato; corromper el resultado de una
        # importación que sí terminó, no.
        if not importacion.avanzar_a(Importacion.Estado.FALLIDA):
            log.info("importación %s ya la cerró su worker; no se rescata", importacion.pk)
            continue
        importacion.errores = []
        importacion.errores_totales = 0
        importacion.anotar_error(
            PROCESAMIENTO_INTERRUMPIDO,
            "El procesamiento se interrumpió y no terminó. Vuelve a subir el archivo.",
        )
        importacion.save(update_fields=["errores", "errores_totales", "actualizado_en"])
        log.warning("importación %s rescatada como fallida: se quedó procesando", importacion.pk)
        estancadas += 1

    if pendientes or estancadas:
        log.info(
            "rescate de importaciones: %s reencoladas, %s marcadas fallidas",
            len(pendientes),
            estancadas,
        )
    return {"reencoladas": len(pendientes), "fallidas": estancadas}
