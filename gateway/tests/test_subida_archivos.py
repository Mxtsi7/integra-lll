"""
El gateway y la subida de archivos de FE-07.

`request.body` lanza `RequestDataTooBig` cuando CONTENT_LENGTH supera
`DATA_UPLOAD_MAX_MEMORY_SIZE`, que por omisión son 2,5 MB. Como el gateway no
lo cambiaba, un archivo de 3 MB —válido para el servicio, que admite 5 MB—
moría acá con un 400 genérico sin `codigo`, y uno de 6 MB tampoco recibía el
`413 archivo_excedido` documentado.

Las pruebas de FE-07 no lo veían porque llamaban a Connectors directamente.
Estas pasan por el gateway, que es por donde pasa el frontend.
"""

import io
import uuid
from unittest.mock import patch

import pytest
from django.test import Client

from app.proxy import MARGEN_MULTIPART, RUTA_SUBIDA

from .test_gateway import con_token, token  # los helpers que ya existen


cliente = Client()

MAXIMO = 5 * 1024 * 1024  # el mismo que IMPORTACION_TAMANO_MAXIMO_BYTES


def multipart(tamano: int) -> tuple[bytes, str]:
    """Un cuerpo multipart con un archivo de `tamano` bytes.

    Se arma a mano y no con el `Client`, porque hace falta controlar el
    Content-Length exacto para probar el tope.
    """
    frontera = "----prueba" + uuid.uuid4().hex
    cabeza = (
        f"--{frontera}\r\n"
        'Content-Disposition: form-data; name="archivo"; filename="cartola.csv"\r\n'
        "Content-Type: text/csv\r\n\r\n"
    ).encode()
    cola = f"\r\n--{frontera}--\r\n".encode()
    relleno = b"a" * max(0, tamano - len(cabeza) - len(cola))
    return cabeza + relleno + cola, f"multipart/form-data; boundary={frontera}"


def subir(cuerpo: bytes, tipo: str, *, largo=None):
    extra = dict(con_token(token()))
    if largo is not None:
        extra["CONTENT_LENGTH"] = str(largo)
    return cliente.post(RUTA_SUBIDA, data=cuerpo, content_type=tipo, **extra)


@pytest.fixture
def servicio():
    """Doble de Connectors: responde 201 y deja ver qué le llegó."""
    llamadas = []

    class Respuesta:
        status_code = 201
        content = b'{"id": "abc"}'
        headers = {"Content-Type": "application/json"}

    def falso(metodo, destino, **kw):
        llamadas.append({"destino": destino, "largo": len(kw.get("data") or b"")})
        return Respuesta()

    with patch("app.proxy.requests.request", side_effect=falso):
        yield llamadas


class TestTopeDeSubida:
    def test_un_archivo_de_3MB_LLEGA_al_servicio(self, servicio):
        """El caso de la revisión: válido para el servicio, lo mataba el
        gateway con un 400 genérico."""
        cuerpo, tipo = multipart(3 * 1024 * 1024)
        respuesta = subir(cuerpo, tipo, largo=len(cuerpo))

        assert respuesta.status_code == 201, respuesta.content[:200]
        assert len(servicio) == 1, "no llego al servicio"
        assert servicio[0]["largo"] == len(cuerpo), "llego truncado"

    def test_un_archivo_de_6MB_recibe_413_con_codigo(self, servicio):
        cuerpo, tipo = multipart(6 * 1024 * 1024)
        respuesta = subir(cuerpo, tipo, largo=len(cuerpo))

        assert respuesta.status_code == 413
        cuerpo_json = respuesta.json()
        assert cuerpo_json["codigo"] == "archivo_excedido"
        assert "archivo" in cuerpo_json

    def test_el_de_6MB_NO_llega_al_servicio(self, servicio):
        """Se corta antes de leer el cuerpo: no se gasta red ni memoria."""
        cuerpo, tipo = multipart(6 * 1024 * 1024)
        subir(cuerpo, tipo, largo=len(cuerpo))
        assert servicio == []

    def test_justo_en_el_tope_pasa(self, servicio):
        cuerpo, tipo = multipart(MAXIMO + MARGEN_MULTIPART - 1024)
        assert subir(cuerpo, tipo, largo=len(cuerpo)).status_code == 201

    def test_un_byte_sobre_el_tope_se_rechaza(self, servicio):
        cuerpo, tipo = multipart(64)
        respuesta = subir(cuerpo, tipo, largo=MAXIMO + MARGEN_MULTIPART + 1)
        assert respuesta.status_code == 413
        assert respuesta.json()["codigo"] == "archivo_excedido"
        assert servicio == []

    def test_la_respuesta_lleva_el_correlation_id(self):
        cuerpo, tipo = multipart(6 * 1024 * 1024)
        respuesta = subir(cuerpo, tipo, largo=len(cuerpo))
        assert respuesta["X-Correlation-ID"]

    def test_la_forma_del_413_es_la_MISMA_que_la_del_servicio(self):
        """Connectors devuelve {"codigo", "archivo"}. Si acá devolviéramos
        {"detalle"}, el frontend tendría que mirar dos formas para el mismo
        caso según quién lo rechazó."""
        cuerpo, tipo = multipart(6 * 1024 * 1024)
        datos = subir(cuerpo, tipo, largo=len(cuerpo)).json()
        assert set(datos) == {"codigo", "archivo"}


class TestSinContentLength:
    def test_sin_content_length_se_rechaza_sin_leer(self, servicio):
        """Sin saber cuánto va a llegar no se puede acotar la lectura, y leer
        sin tope es justo lo que esto evita."""
        cuerpo, tipo = multipart(1024)
        respuesta = cliente.post(
            RUTA_SUBIDA, data=cuerpo, content_type=tipo,
            CONTENT_LENGTH="", **con_token(token()),
        )
        assert respuesta.status_code == 411
        assert respuesta.json()["codigo"] == "largo_requerido"
        assert servicio == []

    def test_un_content_length_que_no_es_numero_se_rechaza(self, servicio):
        cuerpo, tipo = multipart(1024)
        respuesta = cliente.post(
            RUTA_SUBIDA, data=cuerpo, content_type=tipo,
            CONTENT_LENGTH="muchos", **con_token(token()),
        )
        assert respuesta.status_code == 411
        assert servicio == []


class TestLasDemasRutas:
    """El límite global sigue valiendo fuera de la ruta de subida."""

    def test_una_ruta_normal_sigue_con_el_limite_por_omision(self, servicio):
        """3 MB a /api/suscripciones/ pasa del límite global y se rechaza.

        Lo que cambia es que ahora sale como un 413 con `codigo` en vez de un
        400 genérico de Django sin forma.
        """
        grande = b"x" * (3 * 1024 * 1024)
        respuesta = cliente.post(
            "/api/suscripciones/", data=grande, content_type="application/json",
            **con_token(token()),
        )
        assert respuesta.status_code == 413
        assert respuesta.json()["codigo"] == "archivo_excedido"
        assert servicio == []

    def test_una_peticion_normal_y_chica_sigue_pasando(self, servicio):
        respuesta = cliente.post(
            "/api/suscripciones/", data=b'{"nombre": "Netflix"}',
            content_type="application/json", **con_token(token()),
        )
        assert respuesta.status_code == 201
        assert len(servicio) == 1

    def test_un_GET_sin_cuerpo_sigue_pasando(self, servicio):
        respuesta = cliente.get("/api/suscripciones/", **con_token(token()))
        assert respuesta.status_code == 201
        assert len(servicio) == 1
