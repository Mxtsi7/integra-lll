"""VI-24: el cliente habla con el endpoint, nunca con el proveedor."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from shared.ia.cliente import ClienteAsistente, ErrorAsistente
from shared.ia.politica import TIMEOUT_MAXIMO_SEGUNDOS, validar_timeout


class Servidor:
    def __init__(self):
        self.respuestas = []
        self.recibido = []
        servidor = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                largo = int(self.headers.get("Content-Length", "0"))
                servidor.recibido.append(
                    {
                        "ruta": self.path,
                        "autorizacion": self.headers.get("Authorization"),
                        "cuerpo": json.loads(self.rfile.read(largo) or b"{}"),
                    }
                )
                if not servidor.respuestas:
                    self.send_response(500)
                    self.end_headers()
                    return
                estado, cuerpo, demora = servidor.respuestas.pop(0)
                if demora:
                    time.sleep(demora)
                datos = json.dumps(cuerpo).encode()
                self.send_response(estado)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(datos)))
                self.end_headers()
                self.wfile.write(datos)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.hilo = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.hilo.start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/api"

    def cerrar(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def servidor():
    s = Servidor()
    yield s
    s.cerrar()


def test_envia_mensaje_y_token_al_endpoint(servidor):
    servidor.respuestas.append(
        (200, {"estado": "ok", "motivo": None, "respuesta": "hola", "datos": {}}, 0)
    )

    resultado = ClienteAsistente(servidor.url, "jwt-123").consultar("  ¿qué pago?  ")

    assert resultado["respuesta"] == "hola"
    assert servidor.recibido[0]["ruta"] == "/api/asistente/"
    assert servidor.recibido[0]["autorizacion"] == "Bearer jwt-123"
    assert servidor.recibido[0]["cuerpo"] == {"mensaje": "  ¿qué pago?  "}


def test_403_es_error_controlado_sin_reintento(servidor):
    servidor.respuestas.append((403, {"detail": "Requiere Premium"}, 0))

    with pytest.raises(ErrorAsistente) as info:
        ClienteAsistente(servidor.url, "jwt").consultar()

    assert info.value.status == 403
    assert info.value.codigo == "sin_autorizacion"
    assert len(servidor.recibido) == 1


def test_503_reintenta_una_vez_y_luego_responde(servidor):
    servidor.respuestas.append((503, {"detail": "permisos"}, 0))
    servidor.respuestas.append(
        (200, {"estado": "degradado", "motivo": "cuota_agotada", "respuesta": "x"}, 0)
    )

    resultado = ClienteAsistente(servidor.url, reintentos=1).consultar()

    assert resultado["estado"] == "degradado"
    assert len(servidor.recibido) == 2


def test_timeout_no_se_reintenta_sin_control(servidor):
    servidor.respuestas.append((200, {"estado": "ok", "respuesta": "tarde"}, 0.5))

    with pytest.raises(ErrorAsistente) as info:
        ClienteAsistente(servidor.url, timeout=0.2, reintentos=0).consultar()

    assert info.value.codigo == "timeout"


def test_respuesta_fuera_de_contrato_es_error(servidor):
    servidor.respuestas.append((200, {"cualquier": "cosa"}, 0))

    with pytest.raises(ErrorAsistente) as info:
        ClienteAsistente(servidor.url).consultar()

    assert info.value.codigo == "respuesta_invalida"


def test_no_permite_timeout_por_encima_de_la_politica():
    with pytest.raises(ValueError):
        ClienteAsistente("http://localhost/api", timeout=TIMEOUT_MAXIMO_SEGUNDOS + 1)
    with pytest.raises(ValueError):
        ClienteAsistente("", timeout=1)
    assert validar_timeout(TIMEOUT_MAXIMO_SEGUNDOS) == TIMEOUT_MAXIMO_SEGUNDOS
