"""S3-FE-14 — exponer candidatos y errores para la vista previa.

Los criterios de la tarjeta:
- Chris puede listar ambos orígenes y errores reales
- una organización no consulta resultados de otra

Y lo que hace que no sea un agujero: es solo lectura (confirmar y rechazar son
S3-FE-15 y S3-FE-16, con sus propias rutas), el importe viaja como texto, un
filtro mal escrito es un 400 y no un 500, y el orden es estable para que la
paginación no repita ni se salte filas.
"""

import hashlib
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors import tasks
from connectors.models import ArchivoImportacion, CobroCandidato, Importacion

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
USUARIO = "42"

RUTA = "/api/candidatos/"
RUTA_SUBIDA = "/api/importaciones/archivos/"

CSV = (
    "fecha;descripcion;monto\n"
    "2026-10-01;NETFLIX.COM;9990\n"
    "2026-10-03;PAYPAL *SPOTIFY;4990\n"
).encode("utf-8")

#: La de arriba con una fila que no se puede leer: el monto no es un número.
CSV_MIXTO = (
    "fecha;descripcion;monto\n"
    "2026-10-01;NETFLIX.COM;9990\n"
    "2026-10-02;ALGO RARO;no es un monto\n"
    "2026-10-03;PAYPAL *SPOTIFY;4990\n"
).encode("utf-8")


@pytest.fixture
def cliente():
    return APIClient()


def cabecera(org=ORG_A, usuario=USUARIO):
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


def crear_importacion(*, org=ORG_A, origen=Importacion.Origen.CSV, contenido=None):
    importacion = Importacion.objects.create(
        organizacion_id=org,
        usuario_id=USUARIO,
        origen=origen,
        nombre_archivo="cartola.csv" if origen == Importacion.Origen.CSV else "",
    )
    if contenido is not None:
        ArchivoImportacion.objects.create(
            organizacion_id=org,
            importacion=importacion,
            formato="csv",
            tamano=len(contenido),
            sha256=hashlib.sha256(contenido).hexdigest(),
            contenido=contenido,
            vence_en=timezone.now() + timedelta(days=7),
        )
    return importacion


def crear_candidato(
    importacion,
    *,
    origen=CobroCandidato.Origen.CSV,
    identificador="abc:2",
    servicio="Netflix",
    importe="9990",
    fecha=date(2026, 10, 1),
    estado=CobroCandidato.Estado.PROPUESTO,
):
    return CobroCandidato.objects.create(
        organizacion_id=importacion.organizacion_id,
        importacion=importacion,
        origen=origen,
        identificador_origen=identificador,
        servicio=servicio,
        servicio_texto="NETFLIX.COM",
        servicio_resultado="reconocido",
        importe=Decimal(importe),
        moneda="CLP",
        fecha=fecha,
        tipo_mensaje=CobroCandidato.TipoMensaje.COBRO_REALIZADO,
        estado=estado,
        evidencia={"fila": "2", "descripcion_original": "NETFLIX.COM"},
    )


# ══════════════════════════════════════════════════════════════════════
# Criterio 1: listar los dos orígenes, con datos reales
# ══════════════════════════════════════════════════════════════════════


def test_la_lista_trae_los_dos_origenes_juntos(cliente):
    """Es lo que pide S3-CH-04: una lista común de correo y CSV."""
    de_archivo = crear_importacion()
    de_correo = crear_importacion(origen=Importacion.Origen.CORREO)
    crear_candidato(de_archivo, origen=CobroCandidato.Origen.CSV, identificador="sha:2")
    crear_candidato(
        de_correo,
        origen=CobroCandidato.Origen.CORREO,
        identificador="<mensaje@spotify.com>",
    )

    respuesta = cliente.get(RUTA, headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.data["count"] == 2
    assert {c["origen"] for c in respuesta.data["results"]} == {"csv", "correo"}


def test_de_punta_a_punta_subir_un_csv_y_listar_sus_candidatos(
    cliente, settings, django_capture_on_commit_callbacks
):
    """Sin dobles: sube el archivo, corre la tarea y lista por la API.

    Es el criterio "Chris puede listar ... datos reales". Con candidatos
    creados a mano la prueba pasaría igual aunque el cable estuviera cortado.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True

    with django_capture_on_commit_callbacks(execute=True):
        subida = cliente.post(
            RUTA_SUBIDA,
            {"archivo": SimpleUploadedFile("cartola.csv", CSV)},
            format="multipart",
            headers=cabecera(),
        )
    assert subida.status_code == status.HTTP_201_CREATED

    respuesta = cliente.get(RUTA, headers=cabecera())

    assert respuesta.data["count"] == 2
    glosas = sorted(c["servicio_texto"] for c in respuesta.data["results"])
    assert glosas == ["NETFLIX.COM", "PAYPAL *SPOTIFY"]


def test_los_errores_de_fila_se_consultan_en_la_importacion(
    cliente, settings, django_capture_on_commit_callbacks
):
    """La otra mitad del criterio: los errores reales, con fila y motivo.

    No tienen ruta propia a propósito: un error de fila no es un candidato
    —no tiene servicio, ni importe, ni fecha— y ya viaja en el detalle de la
    importación. Esta prueba fija ese contrato, que es el que usa S3-CH-06.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True

    with django_capture_on_commit_callbacks(execute=True):
        subida = cliente.post(
            RUTA_SUBIDA,
            {"archivo": SimpleUploadedFile("cartola.csv", CSV_MIXTO)},
            format="multipart",
            headers=cabecera(),
        )

    detalle = cliente.get(f"/api/importaciones/{subida.data['id']}/", headers=cabecera())

    assert detalle.data["estado"] == Importacion.Estado.COMPLETADA
    assert detalle.data["errores_totales"] == 1
    error = detalle.data["errores"][0]
    assert error["fila"] == 3
    assert error["codigo"] == "importe_invalido"
    # Y las filas válidas no se perdieron: es el criterio de S3-CH-06.
    assert detalle.data["candidatos_detectados"] == 2
    assert cliente.get(RUTA, headers=cabecera()).data["count"] == 2


# ══════════════════════════════════════════════════════════════════════
# Criterio 2: una organización no consulta resultados de otra
# ══════════════════════════════════════════════════════════════════════


def test_no_se_ven_los_candidatos_de_otra_organizacion(cliente):
    mio = crear_candidato(crear_importacion(org=ORG_A), identificador="mio:2")
    crear_candidato(crear_importacion(org=ORG_B), identificador="ajeno:2")

    respuesta = cliente.get(RUTA, headers=cabecera(org=ORG_A))

    assert respuesta.data["count"] == 1
    assert respuesta.data["results"][0]["id"] == str(mio.id)


def test_el_detalle_de_un_candidato_ajeno_es_404_y_no_403(cliente):
    """404 y no 403: un 403 confirmaría que ese id es de alguien."""
    ajeno = crear_candidato(crear_importacion(org=ORG_B), identificador="ajeno:2")

    respuesta = cliente.get(f"{RUTA}{ajeno.id}/", headers=cabecera(org=ORG_A))

    assert respuesta.status_code == status.HTTP_404_NOT_FOUND


def test_filtrar_por_una_importacion_ajena_no_filtra_datos(cliente):
    """El filtro no puede ser una puerta: se aplica DESPUÉS del aislamiento."""
    ajena = crear_importacion(org=ORG_B)
    crear_candidato(ajena, identificador="ajeno:2")

    respuesta = cliente.get(RUTA, {"importacion": str(ajena.id)}, headers=cabecera(org=ORG_A))

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.data["count"] == 0


def test_sin_cabecera_de_organizacion_no_se_entrega_nada(cliente):
    crear_candidato(crear_importacion())

    respuesta = cliente.get(RUTA, headers={})

    assert respuesta.status_code == status.HTTP_403_FORBIDDEN


# ══════════════════════════════════════════════════════════════════════
# Los filtros
# ══════════════════════════════════════════════════════════════════════


def test_filtrar_por_origen(cliente):
    crear_candidato(crear_importacion(), identificador="csv:2")
    crear_candidato(
        crear_importacion(origen=Importacion.Origen.CORREO),
        origen=CobroCandidato.Origen.CORREO,
        identificador="<x@y>",
    )

    respuesta = cliente.get(RUTA, {"origen": "correo"}, headers=cabecera())

    assert respuesta.data["count"] == 1
    assert respuesta.data["results"][0]["origen"] == "correo"


def test_filtrar_por_estado(cliente):
    importacion = crear_importacion()
    crear_candidato(importacion, identificador="a:2")
    crear_candidato(
        importacion, identificador="a:3", estado=CobroCandidato.Estado.RECHAZADO
    )

    respuesta = cliente.get(RUTA, {"estado": "rechazado"}, headers=cabecera())

    assert respuesta.data["count"] == 1
    assert respuesta.data["results"][0]["estado"] == "rechazado"


def test_filtrar_por_importacion(cliente):
    """Lo que necesita S3-CH-06: las filas válidas de UN archivo."""
    primera = crear_importacion()
    segunda = crear_importacion()
    crear_candidato(primera, identificador="primera:2")
    crear_candidato(segunda, identificador="segunda:2")

    respuesta = cliente.get(RUTA, {"importacion": str(primera.id)}, headers=cabecera())

    cuerpo = respuesta.json()
    assert cuerpo["count"] == 1
    assert cuerpo["results"][0]["importacion"] == str(primera.id)


@pytest.mark.parametrize(
    "parametros,campo",
    [
        ({"origen": "whatsapp"}, "origen"),
        ({"estado": "aprobado"}, "estado"),
        ({"importacion": "no-soy-un-uuid"}, "importacion"),
    ],
)
def test_un_filtro_mal_escrito_es_400_y_dice_cual(cliente, parametros, campo):
    """Un 500 por un parámetro que escribió el cliente es un error nuestro."""
    respuesta = cliente.get(RUTA, parametros, headers=cabecera())

    assert respuesta.status_code == status.HTTP_400_BAD_REQUEST
    assert campo in respuesta.data


def test_un_filtro_colgado_no_hace_desaparecer_el_detalle(cliente):
    """`retrieve` pasa por el mismo `get_queryset`: filtrar ahí da un 404 raro."""
    candidato = crear_candidato(crear_importacion())

    respuesta = cliente.get(f"{RUTA}{candidato.id}/?origen=whatsapp", headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.data["id"] == str(candidato.id)


# ══════════════════════════════════════════════════════════════════════
# El contrato: lo que el frontend puede dar por hecho
# ══════════════════════════════════════════════════════════════════════
#
# Estas pruebas miran `respuesta.json()` y NO `respuesta.data`, porque lo que
# recibe el frontend es el JSON renderizado. En `.data` todavía hay objetos de
# Python: `importacion` viene como `UUID(...)` y no como texto, así que una
# comparación contra una cadena falla aunque el contrato esté bien. Ya pasó
# acá mismo al escribir estas pruebas.


def test_el_importe_viaja_como_texto(cliente):
    """En JSON un decimal se vuelve `float` del otro lado y se pierde.

    Lo decide `COERCE_DECIMAL_TO_STRING`, que viene en `True` por omisión. Si
    alguien lo pone en `False`, este contrato cambia sin que nadie lo note y
    esta prueba es la que avisa.
    """
    crear_candidato(crear_importacion(), importe="9990.50")

    respuesta = cliente.get(RUTA, headers=cabecera())

    importe = respuesta.json()["results"][0]["importe"]
    assert isinstance(importe, str)
    assert importe == "9990.50"


def test_los_campos_expuestos_son_exactamente_estos(cliente):
    """El contrato que valida el receptor. Agregar o quitar uno es romperlo."""
    crear_candidato(crear_importacion())

    respuesta = cliente.get(RUTA, headers=cabecera())

    assert set(respuesta.json()["results"][0]) == {
        "id",
        "importacion",
        "origen",
        "origen_legible",
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
        "evidencia",
        "creado_en",
    }


def test_el_identificador_de_origen_es_estable_entre_dos_consultas(cliente):
    """Es con lo que S3-CH-04 evita duplicar al recargar."""
    crear_candidato(crear_importacion(), identificador="sha256abc:7")

    primera = cliente.get(RUTA, headers=cabecera()).json()["results"][0]
    segunda = cliente.get(RUTA, headers=cabecera()).json()["results"][0]

    assert primera["identificador_origen"] == segunda["identificador_origen"] == "sha256abc:7"
    assert primera["id"] == segunda["id"]


def test_el_servicio_sin_reconocer_viaja_como_null_y_la_glosa_queda(cliente):
    """Inventar un proveedor sería peor que no asignar ninguno."""
    candidato = crear_candidato(crear_importacion(), servicio=None)
    CobroCandidato.objects.filter(pk=candidato.pk).update(servicio_resultado="desconocido")

    fila = cliente.get(RUTA, headers=cabecera()).json()["results"][0]

    assert fila["servicio"] is None
    assert fila["servicio_texto"] == "NETFLIX.COM"
    assert fila["servicio_resultado"] == "desconocido"


def test_el_orden_es_cronologico_y_estable(cliente):
    """La paginación necesita un orden estable o repite y se salta filas."""
    importacion = crear_importacion()
    crear_candidato(importacion, identificador="a:4", fecha=date(2026, 10, 9))
    crear_candidato(importacion, identificador="a:2", fecha=date(2026, 10, 1))
    crear_candidato(importacion, identificador="a:3", fecha=date(2026, 10, 5))

    fechas = [c["fecha"] for c in cliente.get(RUTA, headers=cabecera()).json()["results"]]

    assert fechas == ["2026-10-01", "2026-10-05", "2026-10-09"]


def test_la_lista_viene_paginada(cliente):
    importacion = crear_importacion()
    for numero in range(3):
        crear_candidato(importacion, identificador=f"a:{numero}")

    cuerpo = cliente.get(RUTA, {"page_size": 2}, headers=cabecera()).json()

    assert cuerpo["count"] == 3
    assert len(cuerpo["results"]) == 2
    assert cuerpo["next"] is not None


def test_la_lista_vacia_es_200_y_no_404(cliente):
    """S3-CH-04 tiene que poder dibujar el estado vacío."""
    respuesta = cliente.get(RUTA, headers=cabecera())

    assert respuesta.status_code == status.HTTP_200_OK
    assert respuesta.data["count"] == 0
    assert respuesta.data["results"] == []


# ══════════════════════════════════════════════════════════════════════
# Solo lectura
# ══════════════════════════════════════════════════════════════════════


def test_no_se_puede_crear_un_candidato_desde_afuera(cliente):
    """Un POST abierto dejaría inventar un cobro que nadie leyó."""
    respuesta = cliente.post(RUTA, {}, format="json", headers=cabecera())

    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


@pytest.mark.parametrize("metodo", ["patch", "put", "delete"])
def test_no_se_puede_editar_ni_borrar_un_candidato(cliente, metodo):
    """Confirmar y rechazar son S3-FE-15 y S3-FE-16, con sus propias rutas.

    Dejar un PATCH acá permitiría cambiarle el importe a un candidato que se
    presenta como evidencia de lo que decía la cartola.
    """
    candidato = crear_candidato(crear_importacion())

    respuesta = getattr(cliente, metodo)(
        f"{RUTA}{candidato.id}/", {}, format="json", headers=cabecera()
    )

    assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_el_candidato_de_una_importacion_borrada_se_va_con_ella(cliente):
    """CASCADE: una propuesta sin procedencia no se puede comprobar."""
    importacion = crear_importacion()
    crear_candidato(importacion)

    importacion.delete()

    assert cliente.get(RUTA, headers=cabecera()).data["count"] == 0


def test_la_tarea_y_la_api_cuentan_lo_mismo(cliente):
    """`candidatos_detectados` de la importación y lo que lista la API."""
    importacion = crear_importacion(contenido=CSV)

    tasks.procesar_importacion(str(importacion.pk))

    importacion.refresh_from_db()
    listados = cliente.get(RUTA, {"importacion": str(importacion.id)}, headers=cabecera())
    assert importacion.candidatos_detectados == listados.data["count"] == 2


def test_el_desempate_del_orden_va_por_creado_en(cliente):
    """Tres filas del mismo día: sin desempate la paginación se desordena.

    `Meta.ordering` es `["fecha", "creado_en"]`. Con solo `fecha`, PostgreSQL
    puede devolver los empates en cualquier orden entre dos consultas, y la
    página 2 repetiría una fila que ya salió en la página 1.
    """
    importacion = crear_importacion()
    mismo_dia = date(2026, 10, 1)
    primero = crear_candidato(importacion, identificador="a:2", fecha=mismo_dia)
    segundo = crear_candidato(importacion, identificador="a:3", fecha=mismo_dia)
    tercero = crear_candidato(importacion, identificador="a:4", fecha=mismo_dia)

    # Fechas de creación explícitas y separadas: `auto_now_add` las deja a
    # microsegundos y dos podrían empatar según el reloj de la máquina.
    base = timezone.now() - timedelta(hours=3)
    for numero, candidato in enumerate([tercero, primero, segundo]):
        CobroCandidato.objects.filter(pk=candidato.pk).update(
            creado_en=base + timedelta(minutes=numero)
        )

    listados = cliente.get(RUTA, headers=cabecera()).json()["results"]

    assert [c["identificador_origen"] for c in listados] == ["a:4", "a:2", "a:3"]
