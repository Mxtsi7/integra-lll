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


def test_los_numeros_estan_escritos_antes_del_estado_terminal(monkeypatch):
    """Quien vea `completada` tiene que ver ya los candidatos contados.

    Al revés —estado primero, números después— un polling con la suerte justa
    leería una importación terminada con cero candidatos, y ese estado es
    terminal: no vuelve a cambiar para corregirse.

    Se espía el momento exacto de la transición y se lee la BASE, no la
    instancia en memoria: comprobar el resultado al final no distingue un
    orden del otro.
    """
    visto_al_cerrar = {}
    original = Importacion.avanzar_a

    def espiar(self, estado, **extra):
        # Solo la PRIMERA vez: si se anotara en cada llamada, una segunda
        # transición (aunque no mueva nada) pisaría la observación y la
        # prueba pasaría igual con el orden al revés. Pasó.
        if estado == Importacion.Estado.COMPLETADA and not visto_al_cerrar:
            visto_al_cerrar["candidatos"] = Importacion.objects.values_list(
                "candidatos_detectados", flat=True
            ).get(pk=self.pk)
            visto_al_cerrar["filas"] = CobroCandidato.objects.filter(importacion=self).count()
        return original(self, estado, **extra)

    monkeypatch.setattr(Importacion, "avanzar_a", espiar)

    tasks.procesar_importacion(str(crear_importacion().pk))

    assert visto_al_cerrar == {"candidatos": 2, "filas": 2}


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
    """La carrera entre el rescate y el worker que todavía estaba vivo.

    El rescate ve una `procesando` vieja, pero el worker que la tenía la
    cierra en el mismo instante. Si el motivo se escribiera antes de mover el
    estado, una importación que SÍ terminó bien quedaría con el error de
    "se interrumpió" y sin sus errores de verdad.
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

    original = Importacion.avanzar_a

    def el_worker_gana(self, estado, **extra):
        if estado == Importacion.Estado.FALLIDA:
            # El worker original la cierra justo antes de que el rescate
            # alcance a mover nada.
            Importacion.objects.filter(pk=self.pk).update(
                estado=Importacion.Estado.COMPLETADA, terminada_en=timezone.now()
            )
        return original(self, estado, **extra)

    monkeypatch.setattr(Importacion, "avanzar_a", el_worker_gana)

    resultado = tasks.rescatar_importaciones_estancadas()

    assert resultado["fallidas"] == 0
    importacion.refresh_from_db()
    assert importacion.estado == Importacion.Estado.COMPLETADA
    assert importacion.errores_totales == 1
    assert importacion.errores[0]["codigo"] == csv_candidatos.IMPORTE_INVALIDO
