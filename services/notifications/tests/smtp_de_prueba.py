"""Un servidor SMTP mínimo, local y DE PRUEBA. No es un proveedor.

Sirve para que el backend SMTP de Django y `smtplib` hablen el protocolo de
verdad por un socket y reciban las respuestas que se le pidan (250, 550,
451, un corte, un silencio), sin salir de la máquina. Lo que acredita es
cómo se clasifica cada respuesta y qué se anota; que Gmail acepte un correo
real es otra cosa y no se prueba acá.

    with ServidorSMTP(rcpt="550 5.1.1 no existe") as servidor:
        settings.EMAIL_PORT = servidor.puerto
        ...
    servidor.mensajes   # lo que llegó a aceptarse, crudo
"""

from __future__ import annotations

import socket
import socketserver
import threading


class _Atender(socketserver.StreamRequestHandler):
    timeout = 10

    def responder(self, linea: str) -> None:
        self.wfile.write(f"{linea}\r\n".encode())
        self.wfile.flush()

    def handle(self):
        servidor: ServidorSMTP = self.server.servidor_de_prueba
        servidor.conexiones += 1
        self.responder("220 prueba.local ESMTP servidor de prueba")
        while True:
            crudo = self.rfile.readline()
            if not crudo:
                return
            orden = crudo.decode(errors="replace").strip().upper()
            if orden.startswith(("EHLO", "HELO")):
                self.responder("250 prueba.local")
            elif orden.startswith("MAIL FROM"):
                self.responder(servidor.mail)
            elif orden.startswith("RCPT TO"):
                self.responder(servidor.rcpt)
            elif orden == "DATA":
                self.responder("354 termina con un punto")
                cuerpo = []
                while True:
                    linea = self.rfile.readline()
                    if not linea or linea in (b".\r\n", b".\n"):
                        break
                    cuerpo.append(linea)
                if servidor.al_terminar_data == "cortar":
                    return  # cierra sin responder: el cliente no sabe si llegó
                if servidor.al_terminar_data == "callar":
                    servidor.callando.wait(10)
                    return
                if servidor.data.startswith("250"):
                    servidor.mensajes.append(b"".join(cuerpo))
                self.responder(servidor.data)
            elif orden.startswith("QUIT"):
                self.responder("221 chao")
                return
            else:  # RSET, NOOP y lo demás
                self.responder("250 OK")


class _Servidor(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


class ServidorSMTP:
    def __init__(self, *, mail="250 OK", rcpt="250 OK", data="250 2.0.0 OK id-de-prueba",
                 al_terminar_data: str | None = None):
        self.mail, self.rcpt, self.data = mail, rcpt, data
        self.al_terminar_data = al_terminar_data
        self.mensajes: list[bytes] = []
        self.conexiones = 0
        self.callando = threading.Event()
        self._servidor = _Servidor(("127.0.0.1", 0), _Atender)
        self._servidor.servidor_de_prueba = self
        self.puerto = self._servidor.server_address[1]

    def __enter__(self):
        threading.Thread(target=self._servidor.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *_):
        self.callando.set()
        self._servidor.shutdown()
        self._servidor.server_close()


def puerto_cerrado() -> int:
    """Un puerto en el que nadie escucha: conectar da 'connection refused'."""
    with socket.socket() as sonda:
        sonda.bind(("127.0.0.1", 0))
        return sonda.getsockname()[1]
