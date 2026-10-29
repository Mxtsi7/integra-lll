"""
FE-07 — validar y recibir archivos CSV y cartolas (RF-05 / RF-19).

Los criterios de la tarjeta:
- archivo excedido o contenido incompatible se rechaza ANTES de procesar
- archivo válido devuelve id de importación y NO crea suscripciones

Y lo que hace que no sea un agujero: formatos admitidos explícitos, el
contenido se mira (la extensión no prueba nada), cuota de ingesta por
organización, el archivo se guarda temporalmente y se purga.
"""

import hashlib
import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors import archivos
from connectors.archivos import ArchivoRechazado, validar
from connectors.models import ArchivoImportacion, Importacion

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
USUARIO_A = "42"

RUTA = "/api/importaciones/archivos/"

CSV = (
    "fecha;descripcion;monto\n"
    "2026-10-01;NETFLIX.COM;9990\n"
    "2026-10-03;PAYPAL *SPOTIFY;4990\n"
).encode("utf-8")
PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n"


@pytest.fixture
def cliente():
    return APIClient()


def cabecera(org=ORG_A, usuario=USUARIO_A):
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


def subir(cliente, nombre="cartola.csv", contenido=CSV, *, headers=None):
    archivo = SimpleUploadedFile(nombre, contenido)
    return cliente.post(
        RUTA, {"archivo": archivo}, format="multipart",
        headers=headers if headers is not None else cabecera(),
    )


# ══════════════════════════════════════════════════════════════════════
# El camino feliz: id de importación, y nada más
# ══════════════════════════════════════════════════════════════════════


class TestArchivoValido:
    def test_un_csv_devuelve_la_importacion_pendiente(self, cliente):
        r = subir(cliente)
        assert r.status_code == status.HTTP_201_CREATED, r.data
        assert r.data["estado"] == "pendiente"
        assert r.data["origen"] == "csv"
        assert r.data["nombre_archivo"] == "cartola.csv"
        assert r.data["filas_totales"] == 2
        assert r.data["filas_procesadas"] == 0
        assert r.data["candidatos_detectados"] == 0
        assert r.data["candidatos_confirmados"] is False
        assert r.data["terminada"] is False
        assert Importacion.objects.get(pk=r.data["id"]).usuario_id == USUARIO_A

    def test_no_crea_suscripciones_ni_candidatos_ni_confirma_nada(self, cliente):
        """Lo único que nace es una importación pendiente: el job."""
        r = subir(cliente)
        importacion = Importacion.objects.get(pk=r.data["id"])
        assert Importacion.objects.count() == 1
        assert importacion.estado == Importacion.Estado.PENDIENTE
        assert importacion.candidatos_detectados == 0
        assert importacion.confirmada_en is None
        assert importacion.terminada_en is None

    def test_guarda_el_archivo_temporalmente_con_su_huella(self, cliente, settings):
        settings.IMPORTACION_DIAS_RETENCION = 7
        antes = timezone.now()
        r = subir(cliente)
        archivo = ArchivoImportacion.objects.get(importacion_id=r.data["id"])
        assert bytes(archivo.contenido) == CSV
        assert archivo.formato == "csv"
        assert archivo.tamano == len(CSV)
        assert archivo.sha256 == hashlib.sha256(CSV).hexdigest()
        assert str(archivo.organizacion_id) == str(ORG_A)
        assert antes + timedelta(days=7) <= archivo.vence_en <= timezone.now() + timedelta(days=7)

    def test_una_cartola_pdf_tambien_se_acepta(self, cliente):
        r = subir(cliente, "cartola-octubre.pdf", PDF)
        assert r.status_code == status.HTTP_201_CREATED, r.data
        assert r.data["filas_totales"] is None, "un PDF no sabe sus filas hasta leerse"
        assert r.data["progreso"] is None
        assert ArchivoImportacion.objects.get().formato == "pdf"

    def test_el_nombre_se_guarda_sin_ruta(self, cliente):
        r = subir(cliente, "../../etc/passwd.csv")
        assert r.data["nombre_archivo"] == "passwd.csv"

    @pytest.mark.parametrize("separador", [",", ";", "\t", "|"])
    def test_acepta_los_separadores_habituales(self, cliente, separador):
        contenido = f"fecha{separador}monto\n2026-10-01{separador}9990\n".encode()
        assert subir(cliente, "c.csv", contenido).status_code == 201

    def test_acepta_latin_1_que_es_lo_que_exportan_los_bancos(self, cliente):
        contenido = "fecha;descripción;monto\n2026-10-01;Suscripción;9990\n".encode("latin-1")
        assert subir(cliente, "c.csv", contenido).status_code == 201

    def test_la_importacion_aparece_en_el_polling_de_fe08(self, cliente):
        r = subir(cliente)
        detalle = cliente.get(f"/api/importaciones/{r.data['id']}/", headers=cabecera())
        assert detalle.status_code == 200
        assert detalle.data["estado"] == "pendiente"


# ══════════════════════════════════════════════════════════════════════
# Lo que se rechaza antes de procesar
# ══════════════════════════════════════════════════════════════════════


class TestRechazos:
    def test_un_archivo_excedido_se_rechaza_con_413_y_no_crea_nada(self, cliente, settings):
        settings.IMPORTACION_TAMANO_MAXIMO_BYTES = 64
        contenido = b"fecha;monto\n" + b"2026-10-01;9990\n" * 10
        r = subir(cliente, "grande.csv", contenido)
        assert r.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        assert r.data["codigo"] == archivos.ARCHIVO_EXCEDIDO
        assert not Importacion.objects.exists() and not ArchivoImportacion.objects.exists()

    @pytest.mark.parametrize("nombre", ["cartola.xlsx", "cartola.txt", "virus.exe", "sin_extension", "cartola.csv.zip"])
    def test_un_formato_no_admitido_se_rechaza_por_extension(self, cliente, nombre):
        r = subir(cliente, nombre, CSV)
        assert r.status_code == 400
        assert r.data["codigo"] == archivos.FORMATO_NO_ADMITIDO
        assert ".csv" in r.data["archivo"] and ".pdf" in r.data["archivo"]

    def test_un_csv_que_es_un_pdf_por_dentro_se_rechaza(self, cliente):
        """Y se rechaza POR SER un PDF, no por casualidad: un PDF con comas
        adentro pasaría la comprobación de columnas si no se mirara la firma."""
        pdf_con_comas = b"%PDF-1.7\n1 0 obj, << /Type, /Catalog >>, endobj\n2 0 obj, x, y\n%%EOF\n"
        r = subir(cliente, "cartola.csv", pdf_con_comas)
        assert r.status_code == 400 and r.data["codigo"] == archivos.CONTENIDO_INCOMPATIBLE
        assert "es un PDF" in r.data["archivo"]

    def test_un_pdf_que_es_texto_por_dentro_se_rechaza(self, cliente):
        r = subir(cliente, "cartola.pdf", CSV)
        assert r.status_code == 400 and r.data["codigo"] == archivos.CONTENIDO_INCOMPATIBLE

    @pytest.mark.parametrize("contenido, motivo", [
        (b"solo una columna\n9990\n", "una sola columna"),
        (b"fecha;monto\n", "al menos una fila"),
        (b"\n\n", "al menos una fila"),
        (b"fecha;monto\n\x00\x01\x02", "bytes nulos"),
    ])
    def test_un_csv_que_no_es_una_tabla_se_rechaza(self, cliente, contenido, motivo):
        r = subir(cliente, "c.csv", contenido)
        assert r.status_code == 400, r.data
        assert r.data["codigo"] == archivos.CONTENIDO_INCOMPATIBLE
        assert motivo in r.data["archivo"]

    def test_un_archivo_vacio_se_rechaza(self, cliente):
        r = subir(cliente, "c.csv", b"")
        assert r.status_code == 400 and r.data["codigo"] == archivos.ARCHIVO_VACIO

    def test_sin_archivo_es_una_peticion_mal_armada(self, cliente):
        r = cliente.post(RUTA, {}, format="multipart", headers=cabecera())
        assert r.status_code == 400 and r.data["codigo"] == "falta_archivo"

    def test_ningun_rechazo_deja_rastro(self, cliente):
        subir(cliente, "cartola.xlsx", CSV)
        subir(cliente, "cartola.csv", PDF)
        subir(cliente, "c.csv", b"")
        assert not Importacion.objects.exists() and not ArchivoImportacion.objects.exists()


# ══════════════════════════════════════════════════════════════════════
# Cuota de ingesta y aislamiento
# ══════════════════════════════════════════════════════════════════════


class TestCuota:
    def test_la_organizacion_tiene_un_maximo_diario(self, cliente, settings):
        settings.IMPORTACION_CUOTA_DIARIA = 2
        assert subir(cliente).status_code == 201
        assert subir(cliente).status_code == 201
        r = subir(cliente)
        assert r.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert r.data["codigo"] == "cuota_excedida"
        assert Importacion.objects.count() == 2

    def test_la_cuota_es_por_organizacion(self, cliente, settings):
        settings.IMPORTACION_CUOTA_DIARIA = 1
        assert subir(cliente).status_code == 201
        assert subir(cliente).status_code == 429
        assert subir(cliente, headers=cabecera(org=ORG_B)).status_code == 201

    def test_la_cuota_es_de_hoy_no_de_siempre(self, cliente, settings):
        settings.IMPORTACION_CUOTA_DIARIA = 1
        r = subir(cliente)
        Importacion.objects.filter(pk=r.data["id"]).update(
            creado_en=timezone.now() - timedelta(days=1, hours=1)
        )
        assert subir(cliente).status_code == 201

    def test_las_importaciones_de_correo_no_consumen_la_cuota_de_archivos(self, cliente, settings):
        settings.IMPORTACION_CUOTA_DIARIA = 1
        Importacion.objects.create(
            organizacion_id=ORG_A, usuario_id=USUARIO_A,
            origen=Importacion.Origen.CORREO,
        )
        assert subir(cliente).status_code == 201

    def test_la_cuota_se_cuenta_con_el_lock_tomado(self):
        """Si alguien saca el lock, dos subidas simultáneas pasan las dos."""
        import inspect

        from connectors import views

        fuente = inspect.getsource(views.SubirArchivoView.post)
        assert 'bloquear("cuota_importacion"' in fuente
        assert fuente.index("bloquear(") < fuente.index(".count()")


class TestAislamiento:
    def test_sin_contexto_de_organizacion_se_rechaza(self, cliente):
        r = subir(cliente, headers={"X-Usuario-Id": USUARIO_A})
        assert r.status_code == 403
        assert not Importacion.objects.exists()

    def test_sin_usuario_se_rechaza(self, cliente):
        """La importación es de una persona (`?mias=true` de FE-08)."""
        r = subir(cliente, headers={"X-Organizacion-Id": str(ORG_A)})
        assert r.status_code == 403

    def test_el_archivo_queda_en_la_organizacion_que_lo_subio(self, cliente):
        subir(cliente)
        subir(cliente, headers=cabecera(org=ORG_B))
        assert ArchivoImportacion.objects.filter(organizacion_id=ORG_A).count() == 1
        assert ArchivoImportacion.objects.filter(organizacion_id=ORG_B).count() == 1

    def test_otra_organizacion_no_ve_la_importacion_creada(self, cliente):
        r = subir(cliente)
        ajena = cliente.get(f"/api/importaciones/{r.data['id']}/", headers=cabecera(org=ORG_B))
        assert ajena.status_code == 404


# ══════════════════════════════════════════════════════════════════════
# Almacenamiento temporal: se purga
# ══════════════════════════════════════════════════════════════════════


class TestPurga:
    def test_borra_los_vencidos_y_conserva_la_importacion(self, cliente):
        r1 = subir(cliente, "vieja.csv")
        r2 = subir(cliente, "nueva.csv")
        ArchivoImportacion.objects.filter(importacion_id=r1.data["id"]).update(
            vence_en=timezone.now() - timedelta(minutes=1)
        )
        salida = StringIO()
        call_command("purgar_archivos_importacion", aplicar=True, stdout=salida)
        assert "Borrados 1" in salida.getvalue()
        assert not ArchivoImportacion.objects.filter(importacion_id=r1.data["id"]).exists()
        assert ArchivoImportacion.objects.filter(importacion_id=r2.data["id"]).exists()
        # La importación de la vieja sigue: lo que sobra es el archivo.
        assert Importacion.objects.filter(pk=r1.data["id"]).exists()

    def test_en_seco_no_borra_nada(self, cliente):
        r = subir(cliente)
        ArchivoImportacion.objects.update(vence_en=timezone.now() - timedelta(minutes=1))
        salida = StringIO()
        call_command("purgar_archivos_importacion", stdout=salida)
        assert "1 archivo(s) vencido(s)" in salida.getvalue()
        assert ArchivoImportacion.objects.filter(importacion_id=r.data["id"]).exists()


# ══════════════════════════════════════════════════════════════════════
# La validación, sin API
# ══════════════════════════════════════════════════════════════════════


class TestValidar:
    def test_el_orden_es_barato_primero(self):
        """Un .exe de 2 GB no se lee: la extensión se rechaza antes del tamaño,
        y el tamaño antes del contenido."""
        with pytest.raises(ArchivoRechazado) as exc:
            validar("x.exe", b"%PDF-", tamano_maximo=1)
        assert exc.value.codigo == archivos.FORMATO_NO_ADMITIDO
        with pytest.raises(ArchivoRechazado) as exc:
            validar("x.csv", b"no es tabla pero es grande", tamano_maximo=5)
        assert exc.value.codigo == archivos.ARCHIVO_EXCEDIDO

    def test_el_resultado_trae_lo_que_fe09_necesita(self):
        v = validar("Cartola.CSV", CSV, tamano_maximo=10_000)
        assert v.formato == "csv" and v.separador == ";" and v.filas == 2
        assert v.sha256 == hashlib.sha256(CSV).hexdigest()
        assert v.nombre == "Cartola.CSV"

    def test_el_pdf_no_estima_filas(self):
        v = validar("c.pdf", PDF, tamano_maximo=10_000)
        assert v.filas is None and v.separador is None

    def test_la_extension_se_compara_sin_mayusculas(self):
        assert validar("C.PDF", PDF, tamano_maximo=10_000).formato == "pdf"

    def test_las_lineas_vacias_no_cuentan_como_filas(self):
        contenido = b"fecha;monto\n\n2026-10-01;9990\n\n\n"
        assert validar("c.csv", contenido, tamano_maximo=10_000).filas == 1

    @pytest.mark.parametrize("nombre, esperado", [
        ("../../etc/passwd.csv", "passwd.csv"),
        ("C:\\\\Users\\\\x\\\\cartola.csv", "cartola.csv"),
        ("  cartola.csv  ", "cartola.csv"),
        ("carpeta/sub/cartola.pdf", "cartola.pdf"),
    ])
    def test_el_nombre_se_limpia_aca_no_solo_en_django(self, nombre, esperado):
        """Django ya recorta la ruta al recibir el multipart; esto es la
        segunda capa, para quien llame a `validar` desde FE-09 o un comando."""
        assert archivos.nombre_seguro(nombre) == esperado
        contenido = PDF if esperado.endswith(".pdf") else CSV
        assert validar(nombre, contenido, tamano_maximo=10_000).nombre == esperado
