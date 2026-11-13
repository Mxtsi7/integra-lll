"""S3-FE-10 — conectar el archivo CSV cargado con el parser existente.

Los dos criterios de la tarjeta:
- un archivo aceptado llega al parser REAL
- el estado de la importación refleja inicio y final del procesamiento

Y lo que hace que no sea un agujero: reprocesar no duplica, un archivo que ya
no está no deja la importación colgada, un PDF no se queda `pendiente` para
siempre, y una configuración mala se cae al arrancar y no fila por fila.
"""

import hashlib
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors import csv_candidatos, tasks
from connectors.models import ArchivoImportacion, CobroCandidato, Importacion

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
USUARIO = "42"

RUTA = "/api/importaciones/archivos/"

#: Dos cobros que se leen sin ambigüedad: fecha ISO y montos en pesos.
CSV = (
    "fecha;descripcion;monto\n"
    "2026-10-01;NETFLIX.COM;9990\n"
    "2026-10-03;PAYPAL *SPOTIFY;4990\n"
).encode("utf-8")

#: La de arriba más una fila que no se puede leer: el monto no es un número.
CSV_CON_FILA_MALA = (
    "fecha;descripcion;monto\n"
    "2026-10-01;NETFLIX.COM;9990\n"
    "2026-10-02;ALGO RARO;no es un monto\n"
    "2026-10-03;PAYPAL *SPOTIFY;4990\n"
).encode("utf-8")

#: Sin columna de monto: le falta una obligatoria, así que no hay nada que leer.
CSV_SIN_MONTO = ("fecha;descripcion\n2026-10-01;NETFLIX.COM\n").encode("utf-8")

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n"


def crear_importacion(contenido=CSV, *, formato="csv", nombre="cartola.csv", org=ORG_A):
    """Una importación `pendiente` con su archivo, como la deja FE-07."""
    importacion = Importacion.objects.create(
        organizacion_id=org,
        usuario_id=USUARIO,
        origen=Importacion.Origen.CSV,
        nombre_archivo=nombre,
        filas_totales=contenido.count(b"\n") - 1,
    )
    ArchivoImportacion.objects.create(
        organizacion_id=org,
        importacion=importacion,
        formato=formato,
        tamano=len(contenido),
        sha256=hashlib.sha256(contenido).hexdigest(),
        contenido=contenido,
        vence_en=timezone.now() + timedelta(days=7),
    )
    return importacion


def envejecer(importacion, *, creado=None, actualizado=None):
    """Mueve las fechas hacia atrás con un UPDATE.

    `auto_now_add` y `auto_now` pisan cualquier valor que se les pase a
    `save()`; un `queryset.update()` no pasa por ahí.
    """
    valores = {}
    if creado is not None:
        valores["creado_en"] = creado
    if actualizado is not None:
        valores["actualizado_en"] = actualizado
    Importacion.objects.filter(pk=importacion.pk).update(**valores)


# ══════════════════════════════════════════════════════════════════════
# Criterio 1: un archivo aceptado llega al parser real
# ══════════════════════════════════════════════════════════════════════


def test_subir_un_csv_termina_con_candidatos_guardados(settings, django_capture_on_commit_callbacks):
    """De punta a punta: POST del archivo y candidatos en la base.

    Sin dobles: corre `SubirArchivoView`, el encolado, la tarea y el parser de
    verdad. Es el criterio "un archivo aceptado llega al parser real", y la
    única forma de comprobarlo es que lo que quede en la base venga del
    archivo que se subió.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True
    cliente = APIClient()

    with django_capture_on_commit_callbacks(execute=True):
        respuesta = cliente.post(
            RUTA,
            {"archivo": SimpleUploadedFile("cartola.csv", CSV)},
            format="multipart",
            headers={"X-Organizacion-Id": str(ORG_A), "X-Usuario-Id": USUARIO},
        )

    assert respuesta.status_code == status.HTTP_201_CREATED
    importacion = Importacion.objects.get(pk=respuesta.data["id"])
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert importacion.candidatos_detectados == 2

    glosas = sorted(c.servicio_texto for c in importacion.candidatos.all())
    assert glosas == ["NETFLIX.COM", "PAYPAL *SPOTIFY"]


def test_la_respuesta_de_la_subida_sigue_siendo_pendiente(settings):
    """El 201 contesta antes de procesar: es lo que permite el polling.

    Si la subida devolviera `completada`, el progreso de FE-08 no tendría
    nada que mostrar y la petición duraría lo que dure el archivo.
    """
    cliente = APIClient()
    respuesta = cliente.post(
        RUTA,
        {"archivo": SimpleUploadedFile("cartola.csv", CSV)},
        format="multipart",
        headers={"X-Organizacion-Id": str(ORG_A), "X-Usuario-Id": USUARIO},
    )
    assert respuesta.status_code == status.HTTP_201_CREATED
    assert respuesta.data["estado"] == Importacion.Estado.PENDIENTE


def test_el_broker_caido_no_rompe_la_subida(monkeypatch, django_capture_on_commit_callbacks):
    """Si no se puede encolar, el 201 se mantiene y queda para el rescate.

    La importación YA está creada cuando corre el encolado. Lanzar ahí le
    daría un 500 a la persona por algo que sí se guardó, y volvería a subir
    el mismo archivo.
    """

    def explotar(*_args, **_kwargs):
        raise RuntimeError("no hay broker")

    monkeypatch.setattr(tasks.procesar_importacion, "delay", explotar)
    cliente = APIClient()

    with django_capture_on_commit_callbacks(execute=True):
        respuesta = cliente.post(
            RUTA,
            {"archivo": SimpleUploadedFile("cartola.csv", CSV)},
            format="multipart",
            headers={"X-Organizacion-Id": str(ORG_A), "X-Usuario-Id": USUARIO},
        )

    assert respuesta.status_code == status.HTTP_201_CREATED
    importacion = Importacion.objects.get(pk=respuesta.data["id"])
    assert importacion.estado == Importacion.Estado.PENDIENTE


# ══════════════════════════════════════════════════════════════════════
# Criterio 2: el estado refleja inicio y final
# ══════════════════════════════════════════════════════════════════════


def test_termina_completada_con_sus_numeros():
    importacion = crear_importacion()

    resultado = tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert importacion.terminada is True
    assert importacion.terminada_en is not None
    assert importacion.filas_procesadas == 2
    assert importacion.filas_totales == 2
    assert importacion.progreso == 100
    assert resultado["candidatos"] == 2


def test_el_estado_y_los_contadores_se_escriben_en_la_misma_operacion(monkeypatch):
    """Quien vea `completada` tiene que ver ya los candidatos contados.

    Con dos escrituras separadas, un polling con la suerte justa leería una
    importación terminada con cero candidatos, y ese estado es terminal: no
    vuelve a cambiar para corregirse.

    Se espía el momento de insertar los candidatos, que ocurre DESPUÉS de
    reclamar el cierre y dentro de la misma transacción. Si alguien volviera
    a partirlo en dos pasos, acá faltaría uno de los dos datos.
    """
    importacion = crear_importacion()
    visto = {}
    original = CobroCandidato.objects.bulk_create

    def espiar(filas, **extra):
        visto.update(
            Importacion.objects.values("estado", "candidatos_detectados").get(
                pk=importacion.pk
            )
        )
        return original(filas, **extra)

    monkeypatch.setattr(CobroCandidato.objects, "bulk_create", espiar)

    tasks.procesar_importacion(str(importacion.pk))

    assert visto == {"estado": Importacion.Estado.COMPLETADA, "candidatos_detectados": 2}


def test_una_fila_mala_no_bota_el_archivo():
    """S3-FE-13 visto desde la importación: 2 candidatos y 1 error anotado."""
    importacion = crear_importacion(CSV_CON_FILA_MALA)

    tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert importacion.candidatos_detectados == 2
    assert importacion.errores_totales == 1
    error = importacion.errores[0]
    assert error["codigo"] == csv_candidatos.IMPORTE_INVALIDO
    # La fila 3 del archivo, contando la cabecera: el número que la persona ve.
    assert error["fila"] == 3


def test_falta_una_columna_obligatoria_y_queda_fallida():
    importacion = crear_importacion(CSV_SIN_MONTO)

    tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.FALLIDA
    assert importacion.errores[0]["codigo"] == csv_candidatos.FALTAN_COLUMNAS
    assert importacion.candidatos.count() == 0


def test_un_pdf_no_se_queda_pendiente_para_siempre():
    """Se admite al subir (FE-07) pero todavía no hay quién lo lea."""
    importacion = crear_importacion(PDF, formato="pdf", nombre="cartola.pdf")

    tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.FALLIDA
    assert importacion.errores[0]["codigo"] == tasks.FORMATO_SIN_LECTOR


def test_el_archivo_purgado_deja_un_error_que_se_entiende():
    """`ArchivoImportacion` es temporal: la purga pudo borrarlo antes."""
    importacion = crear_importacion()
    importacion.archivo.delete()

    tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.FALLIDA
    assert importacion.errores[0]["codigo"] == tasks.ARCHIVO_NO_DISPONIBLE


def test_una_importacion_que_ya_no_existe_no_revienta():
    """El rescate reencola; entremedio la importación pudo borrarse."""
    resultado = tasks.procesar_importacion(str(uuid.uuid4()))
    assert resultado["estado"] == "inexistente"


def test_un_id_que_no_es_uuid_tampoco_revienta():
    resultado = tasks.procesar_importacion("no soy un uuid")
    assert resultado["estado"] == "inexistente"


# ══════════════════════════════════════════════════════════════════════
# Lo que queda guardado
# ══════════════════════════════════════════════════════════════════════


def test_el_candidato_conserva_importe_moneda_y_fecha():
    importacion = crear_importacion()

    tasks.procesar_importacion(str(importacion.pk))

    candidato = importacion.candidatos.get(servicio_texto="NETFLIX.COM")
    assert candidato.importe == Decimal("9990")
    assert isinstance(candidato.importe, Decimal)
    assert candidato.moneda == "CLP"
    assert candidato.fecha == date(2026, 10, 1)
    # Y el catálogo de proveedores de FE-12 también pasa por este cable:
    # "NETFLIX.COM" no es un nombre, es una glosa de cartola.
    assert candidato.servicio == "Netflix"
    assert candidato.servicio_resultado == "reconocido"


def test_el_candidato_nace_propuesto():
    """Guardar un candidato NO es confirmarlo: no se tocó ninguna suscripción."""
    importacion = crear_importacion()

    tasks.procesar_importacion(str(importacion.pk))

    estados = {c.estado for c in importacion.candidatos.all()}
    assert estados == {CobroCandidato.Estado.PROPUESTO}
    importacion.refresh_from_db()
    assert importacion.confirmada_en is None


def test_el_candidato_hereda_la_organizacion_de_la_importacion():
    """El aislamiento de RF-26: un candidato de otra organización ni se ve."""
    de_a = crear_importacion(org=ORG_A)
    de_b = crear_importacion(org=ORG_B)

    tasks.procesar_importacion(str(de_a.pk))
    tasks.procesar_importacion(str(de_b.pk))

    assert CobroCandidato.objects.filter(organizacion_id=ORG_A).count() == 2
    assert CobroCandidato.objects.filter(organizacion_id=ORG_B).count() == 2


def test_el_identificador_es_el_sha_del_archivo_y_la_fila():
    """Es lo que hace estable la deduplicación de S3-FE-17."""
    importacion = crear_importacion()
    sha = importacion.archivo.sha256

    tasks.procesar_importacion(str(importacion.pk))

    identificadores = sorted(c.identificador_origen for c in importacion.candidatos.all())
    assert identificadores == [f"{sha}:2", f"{sha}:3"]


def test_la_evidencia_guarda_la_glosa_original():
    importacion = crear_importacion()

    tasks.procesar_importacion(str(importacion.pk))

    candidato = importacion.candidatos.get(servicio_texto="PAYPAL *SPOTIFY")
    assert candidato.evidencia == {"fila": "3", "descripcion_original": "PAYPAL *SPOTIFY"}


# ══════════════════════════════════════════════════════════════════════
# Reprocesar no duplica ni vuelve a mover un estado terminal
# ══════════════════════════════════════════════════════════════════════


def test_una_importacion_terminal_no_se_reprocesa():
    importacion = crear_importacion()
    tasks.procesar_importacion(str(importacion.pk))

    resultado = tasks.procesar_importacion(str(importacion.pk))

    assert resultado["repetida"] is True
    assert resultado["estado"] == Importacion.Estado.COMPLETADA


def test_reprocesar_la_misma_importacion_no_duplica_candidatos():
    """Forzado a mano: así se ve lo que haría una reentrega del mensaje.

    Se devuelve el estado a `pendiente` con un UPDATE —`avanzar_a` no lo
    permite, y está bien que no lo permita— para que la tarea vuelva a leer
    el mismo archivo entero.
    """
    importacion = crear_importacion()
    tasks.procesar_importacion(str(importacion.pk))
    assert CobroCandidato.objects.count() == 2

    Importacion.objects.filter(pk=importacion.pk).update(
        estado=Importacion.Estado.PENDIENTE, terminada_en=None
    )
    tasks.procesar_importacion(str(importacion.pk))

    assert CobroCandidato.objects.count() == 2
    importacion.refresh_from_db()
    assert importacion.candidatos_detectados == 2
    # Y los errores no se acumulan entre corridas.
    assert importacion.errores_totales == 0


def test_dos_archivos_distintos_con_la_misma_fila_si_son_dos_candidatos():
    """La unicidad es por archivo: el sha entra en el identificador.

    Dos cartolas distintas pueden traer el mismo cobro en la misma línea y
    siguen siendo dos lecturas distintas.
    """
    primera = crear_importacion(CSV)
    otro_contenido = CSV.replace(b"NETFLIX.COM", b"NETFLIX.CL")
    segunda = crear_importacion(otro_contenido)

    tasks.procesar_importacion(str(primera.pk))
    tasks.procesar_importacion(str(segunda.pk))

    assert CobroCandidato.objects.count() == 4


# ══════════════════════════════════════════════════════════════════════
# El rescate: que ningún estado se quede sin final
# ══════════════════════════════════════════════════════════════════════


@pytest.fixture
def encoladas(monkeypatch):
    """Registra lo que el rescate manda al worker, sin broker."""
    vistas = []
    monkeypatch.setattr(
        tasks.procesar_importacion, "delay", lambda identificador: vistas.append(identificador)
    )
    return vistas


def test_el_rescate_reencola_una_pendiente_vieja(encoladas, settings):
    importacion = crear_importacion()
    envejecer(
        importacion,
        creado=timezone.now()
        - timedelta(minutes=settings.IMPORTACION_REENCOLAR_TRAS_MINUTOS + 1),
    )

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["reencoladas"] == 1
    assert encoladas == [str(importacion.pk)]


def test_el_rescate_no_toca_una_pendiente_recien_subida(encoladas):
    """La tarea original puede venir en camino: reencolar sería trabajo doble."""
    crear_importacion()

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["reencoladas"] == 0
    assert encoladas == []


def test_el_rescate_no_reencola_importaciones_de_correo(encoladas, settings):
    """Una importación de correo no tiene archivo: mandarla sería leer nada."""
    importacion = Importacion.objects.create(
        organizacion_id=ORG_A,
        usuario_id=USUARIO,
        origen=Importacion.Origen.CORREO,
    )
    envejecer(
        importacion,
        creado=timezone.now()
        - timedelta(minutes=settings.IMPORTACION_REENCOLAR_TRAS_MINUTOS + 1),
    )

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["reencoladas"] == 0
    assert encoladas == []


def test_el_rescate_cierra_una_procesando_estancada(encoladas, settings):
    """Un worker que murió a mitad deja un estado que no avanza nunca."""
    importacion = crear_importacion()
    importacion.avanzar_a(Importacion.Estado.PROCESANDO)
    envejecer(
        importacion,
        actualizado=timezone.now()
        - timedelta(minutes=settings.IMPORTACION_ESTANCADA_TRAS_MINUTOS + 1),
    )

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["fallidas"] == 1
    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.FALLIDA
    assert importacion.errores[0]["codigo"] == tasks.PROCESAMIENTO_INTERRUMPIDO


def test_el_rescate_no_mata_una_procesando_que_recien_empezo(encoladas):
    """Marcar `fallida` es irreversible: no se mata trabajo en curso."""
    importacion = crear_importacion()
    importacion.avanzar_a(Importacion.Estado.PROCESANDO)

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["fallidas"] == 0
    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.PROCESANDO


# ══════════════════════════════════════════════════════════════════════
# La configuración se valida al arrancar, no fila por fila
# ══════════════════════════════════════════════════════════════════════


def test_un_orden_de_fecha_que_no_existe_no_arranca(settings):
    """`DMY` en mayúsculas rechazaría cada fecha ambigua sin decir por qué."""
    settings.IMPORTACION_ORDEN_FECHA = "DMY"
    with pytest.raises(ImproperlyConfigured):
        tasks._orden_fecha_configurado()


def test_el_orden_de_fecha_vacio_significa_deducirlo(settings):
    settings.IMPORTACION_ORDEN_FECHA = ""
    assert tasks._orden_fecha_configurado() is None


def test_un_orden_de_fecha_valido_se_usa(settings):
    settings.IMPORTACION_ORDEN_FECHA = csv_candidatos.ORDEN_DMY
    assert tasks._orden_fecha_configurado() == csv_candidatos.ORDEN_DMY


def test_una_moneda_desconocida_no_arranca(settings):
    settings.IMPORTACION_MONEDA_POR_DEFECTO = "CLPS"
    with pytest.raises(ImproperlyConfigured):
        tasks._moneda_configurada()


def test_la_moneda_por_defecto_se_normaliza_a_mayusculas(settings):
    settings.IMPORTACION_MONEDA_POR_DEFECTO = "clp"
    assert tasks._moneda_configurada() == "CLP"


def test_el_rescate_no_pisa_una_que_justo_termino_bien(settings, monkeypatch):
    """La carrera al revés: el worker cierra mientras el rescate decide.

    Si el motivo se escribiera antes de reclamar el estado, una importación
    que SÍ terminó bien quedaría con el error de "se interrumpió" y sin sus
    errores de verdad. El punto de inyección es `anotar_error`, que corre
    entre leer el estado y el UPDATE condicionado.
    """
    importacion = crear_importacion()
    importacion.avanzar_a(Importacion.Estado.PROCESANDO)
    Importacion.objects.filter(pk=importacion.pk).update(
        errores=[{"codigo": csv_candidatos.IMPORTE_INVALIDO, "mensaje": "la fila 3", "fila": 3}],
        errores_totales=1,
    )
    envejecer(
        importacion,
        actualizado=timezone.now()
        - timedelta(minutes=settings.IMPORTACION_ESTANCADA_TRAS_MINUTOS + 1),
    )

    original = Importacion.anotar_error

    def el_worker_gana(self, codigo, mensaje, fila=None):
        if codigo == tasks.PROCESAMIENTO_INTERRUMPIDO:
            # El worker original la cierra justo antes de que el rescate
            # alcance a reclamar la transición.
            Importacion.objects.filter(pk=self.pk).update(
                estado=Importacion.Estado.COMPLETADA, terminada_en=timezone.now()
            )
        return original(self, codigo, mensaje, fila)

    monkeypatch.setattr(Importacion, "anotar_error", el_worker_gana)

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["fallidas"] == 0
    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert importacion.errores_totales == 1
    assert importacion.errores[0]["codigo"] == csv_candidatos.IMPORTE_INVALIDO


# ══════════════════════════════════════════════════════════════════════
# El worker tardío contra el cierre ajeno (revisión de #147)
# ══════════════════════════════════════════════════════════════════════


def _envejecer_y_rescatar(importacion, settings):
    """Simula que pasó el plazo y el rescate corre AHORA.

    Es el intercalado de la revisión: el parser está a medio camino y el
    rescate decide que la importación se quedó colgada.
    """
    envejecer(
        importacion,
        actualizado=timezone.now()
        - timedelta(minutes=settings.IMPORTACION_ESTANCADA_TRAS_MINUTOS + 1),
    )
    return tasks.rescatar_importaciones_estancadas()


def test_el_worker_tardio_no_pisa_el_cierre_del_rescate(monkeypatch, settings):
    """El rescate cierra la importación mientras el parser todavía corre.

    Reproducción de la revisión de #147: el worker seguía después y escribía
    candidatos, contadores y `errores=[]` sobre una importación ya FALLIDA,
    borrando el motivo `procesamiento_interrumpido`. Quedaba una terminal
    mentirosa: FALLIDA con 2 candidatos y sin errores.

    Lo que tiene que pasar: el worker descubre que perdió y no toca nada.
    """
    importacion = crear_importacion()
    rescate = {}
    original = csv_candidatos.leer

    def leer_y_que_entre_el_rescate(*args, **extra):
        resultado = original(*args, **extra)
        # Acá adentro, con el parseo ya hecho y nada publicado todavía.
        rescate.update(_envejecer_y_rescatar(importacion, settings))
        return resultado

    monkeypatch.setattr(csv_candidatos, "leer", leer_y_que_entre_el_rescate)

    salida = tasks.procesar_importacion(str(importacion.pk))

    assert rescate["fallidas"] == 1
    importacion.refresh_from_db()
    # El estado y el motivo del rescate quedan intactos.
    assert importacion.estado == Importacion.Estado.FALLIDA
    assert importacion.errores_totales == 1
    assert importacion.errores[0]["codigo"] == tasks.PROCESAMIENTO_INTERRUMPIDO
    # Y no se publicó NADA del parseo.
    assert importacion.candidatos_detectados == 0
    assert CobroCandidato.objects.count() == 0
    # Lo que devuelve la tarea tampoco puede decir que completó.
    assert salida["estado"] == Importacion.Estado.FALLIDA
    assert salida.get("repetida") is True


def test_el_worker_tardio_tampoco_pisa_con_un_error_de_archivo(monkeypatch, settings):
    """El mismo intercalado por el camino de fallo, que usa `_terminar_mal`.

    Un CSV sin columna obligatoria termina en `_terminar_mal`, que también
    escribía el motivo sin comprobar quién tenía la importación.
    """
    importacion = crear_importacion(CSV_SIN_MONTO)
    original = csv_candidatos.leer

    def leer_y_que_entre_el_rescate(*args, **extra):
        try:
            return original(*args, **extra)
        finally:
            _envejecer_y_rescatar(importacion, settings)

    monkeypatch.setattr(csv_candidatos, "leer", leer_y_que_entre_el_rescate)

    tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.FALLIDA
    # El motivo es el del rescate, que ganó, y no el del archivo.
    assert importacion.errores_totales == 1
    assert importacion.errores[0]["codigo"] == tasks.PROCESAMIENTO_INTERRUMPIDO


def test_si_la_publicacion_falla_no_queda_nada_a_medias(monkeypatch):
    """Todo junto o nada: candidatos, contadores y estado terminal.

    Si el `bulk_create` revienta, la importación no puede quedar
    `completada` con cero candidatos ni con el contador puesto.
    """
    importacion = crear_importacion()

    def reventar(*_args, **_extra):
        raise RuntimeError("se cayó la base a mitad de la inserción")

    monkeypatch.setattr(CobroCandidato.objects, "bulk_create", reventar)

    with pytest.raises(RuntimeError):
        tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.PROCESANDO
    assert importacion.candidatos_detectados == 0
    assert CobroCandidato.objects.count() == 0
