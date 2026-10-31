"""Ejecuta el guion remoto de `k8s/configurar-usuario-rabbitmq.sh`.

Sustituye solo el limite externo: `rabbitmqctl`. El guion que se prueba se
EXTRAE del archivo real, no se copia aca, para que no pueda quedar desfasado.

Lo que estas pruebas existen para impedir, porque ya paso en el despliegue del
31-10 y costo dos intentos:

  · la clave llega SIN salto de linea final --`base64 -d` nunca lo pone-- y
    `read` devuelve FALLO en ese caso aunque la haya leido completa. Mirar su
    codigo de salida descartaba una clave valida;
  · la primera version pasaba el guion remoto con un heredoc, que le robaba la
    entrada estandar a `kubectl exec` y se comia la tuberia con la clave.

La primera version de esta prueba alimentaba el guion con `printf "...\\n"`,
CON salto, asi que pasaba y el guion fallaba igual contra el cluster. Por eso
el caso sin salto va primero.
"""
import os
import re
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

RAIZ = Path(__file__).resolve().parents[2]
GUION = RAIZ / "k8s/configurar-usuario-rabbitmq.sh"

CLAVE = "0123456789abcdef" * 4          # 64 caracteres, como la que genera openssl

RABBITMQCTL_FALSO = """#!/bin/sh
# Registra lo que le piden. De la clave informa el LARGO, nunca el valor:
# una prueba de credenciales no puede imprimirlas.
[ "$1" = "--quiet" ] && shift
case "$1" in
  list_users)
      printf 'user\\ttags\\nguest\\t[administrator]\\n'
      [ "${EXISTE:-0}" = "1" ] && printf 'ojoalgasto\\t[management]\\n'
      ;;
  add_user|change_password)
      echo "$1 usuario=$2 largo_clave=${#3}" >&2 ;;
  *)  echo "$*" >&2 ;;
esac
"""


def guion_remoto():
    """El bloque que corre DENTRO del pod, sacado del archivo real."""
    texto = GUION.read_text(encoding="utf-8")
    bloque = re.search(r"<<'EOS'\n(.*?)\nEOS\n", texto, re.S)
    assert bloque, "no encontre el guion remoto en " + str(GUION)
    return bloque.group(1)


@pytest.fixture
def correr(tmp_path):
    binarios = tmp_path / "bin"
    binarios.mkdir()
    falso = binarios / "rabbitmqctl"
    falso.write_text(RABBITMQCTL_FALSO, encoding="utf-8")
    falso.chmod(falso.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    def ejecutar(entrada, *, existe=False, usuario="ojoalgasto"):
        entorno = dict(os.environ)
        entorno["PATH"] = f"{binarios}{os.pathsep}{entorno['PATH']}"
        entorno["EXISTE"] = "1" if existe else "0"
        # La entrada va en BYTES a proposito. En modo texto, Python sobre
        # Windows traduce el salto de linea a retorno-de-carro-mas-salto al
        # escribirla (\n -> \r\n), asi que la clave llegaba con un retorno
        # de carro pegado: la prueba medía 65 caracteres donde el cluster
        # habria visto 64. El arnes no puede alterar justo lo que se esta
        # comprobando.
        crudo = subprocess.run(
            ["sh", "-c", guion_remoto(), "sh", usuario, "/"],
            input=entrada.encode("utf-8"), capture_output=True,
            env=entorno, timeout=60,
        )
        return SimpleNamespace(
            returncode=crudo.returncode,
            stdout=crudo.stdout.decode("utf-8", "replace"),
            stderr=crudo.stderr.decode("utf-8", "replace"),
        )

    return ejecutar


def test_clave_sin_salto_de_linea_final_se_usa_entera(correr):
    """EL caso real: `base64 -d` no pone salto final."""
    r = correr(CLAVE)
    assert r.returncode == 0, r.stderr
    assert f"add_user usuario=ojoalgasto largo_clave={len(CLAVE)}" in r.stderr
    assert CLAVE not in r.stdout + r.stderr, "la clave no puede aparecer en la salida"


def test_clave_con_salto_de_linea_tambien_sirve(correr):
    r = correr(CLAVE + "\n")
    assert r.returncode == 0, r.stderr
    assert f"largo_clave={len(CLAVE)}" in r.stderr


def test_sin_clave_falla_diciendo_por_que(correr):
    """Un guion que maneja una credencial no puede morir en silencio: la
    primera version salia 1 sin imprimir nada y no habia como saber donde."""
    r = correr("")
    assert r.returncode != 0
    assert "entrada estandar" in r.stderr


def test_usuario_existente_alinea_la_clave_en_vez_de_fallar(correr):
    """Idempotente: se puede volver a correr despues de rotar el Secret."""
    r = correr(CLAVE, existe=True)
    assert r.returncode == 0, r.stderr
    assert "change_password usuario=ojoalgasto" in r.stderr
    assert "add_user" not in r.stderr


def test_siempre_deja_permisos_y_etiqueta(correr):
    for existe in (False, True):
        r = correr(CLAVE, existe=existe)
        assert r.returncode == 0, r.stderr
        assert "set_permissions -p / ojoalgasto .* .* .*" in r.stderr
        assert "set_user_tags ojoalgasto management" in r.stderr
