"""Regresiones del despliegue del 09-11-2026, que dejó el broker cerrado 22 h.

Tres defectos del guion, los tres descubiertos chocando contra el cluster:

1. el PVC del broker no declaraba la clase de almacenamiento y el servidor
   rechazaba el manifiesto (cubierto también en `test_migracion_rabbitmq.py`,
   que comprueba que el rechazo se conoce ANTES de suspender los listeners);
2. `python3` en Windows es el alias de la Microsoft Store y no ejecuta nada;
3. `40-red.yaml` responde Forbidden con la cuenta de estudiante y cortaba el
   guion después de aplicar todo lo demás;
4. Git Bash convertía `VITE_API_URL=/api` en `C:/Program Files/Git/api` y la
   web compilaba apuntando a esa dirección. La imagen `0e70d60` salió así: si
   aquel despliegue hubiera terminado, la web habría quedado sin API.
"""
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
DESPLEGAR = RAIZ / "k8s/desplegar.sh"


def _guion():
    return DESPLEGAR.read_text(encoding="utf-8")


# ── 1. El PVC del broker ────────────────────────────────────────────────────

def test_el_pvc_del_broker_declara_su_clase_de_almacenamiento():
    """El PVC vivo tiene `cinder-ceph` en su última configuración aplicada. Si
    el manifiesto no la declara, `kubectl apply` calcula que hay que quitarla
    y el servidor responde `spec is immutable after creation`."""
    documentos = list(yaml.safe_load_all(
        (RAIZ / "k8s/02-redis-rabbitmq.yaml").read_text(encoding="utf-8")))
    pvc = [d for d in documentos if d and d["kind"] == "PersistentVolumeClaim"]
    assert [d["metadata"]["name"] for d in pvc] == ["rabbitmq-data"]
    assert pvc[0]["spec"].get("storageClassName") == "cinder-ceph"


# ── 2. El intérprete ────────────────────────────────────────────────────────

def test_ningun_guion_python_se_invoca_con_python3_a_secas():
    """Toda invocación de un `.py` pasa por el intérprete que el guion ya
    comprobó que funciona. Una sola que quede con `python3` literal vuelve a
    fallar en Windows a mitad del despliegue."""
    invocaciones = [linea.strip() for linea in _guion().splitlines()
                    if re.search(r"\S+\.py\b", linea) and not linea.lstrip().startswith("#")]
    assert invocaciones, "el guion ya no ejecuta ningún .py: revisar esta prueba"
    for linea in invocaciones:
        assert linea.startswith('"$PYTHON" '), linea


def _doble(carpeta, nombre, cuerpo):
    ruta = carpeta / nombre
    ruta.write_text("#!/bin/sh\n" + cuerpo + "\n", encoding="utf-8", newline="\n")
    ruta.chmod(ruta.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return ruta


BASH = shutil.which("bash")


@pytest.mark.skipif(BASH is None, reason="Requiere bash")
def test_sin_un_python_que_funcione_no_se_toca_el_cluster(tmp_path):
    """El alias de la Microsoft Store EXISTE en el PATH, así que `command -v`
    lo da por bueno; lo que hace es imprimir un aviso y salir con error. El
    guion tiene que ejecutarlo para saberlo, y abortar antes de construir una
    imagen o de mandar una sola orden al cluster."""
    marcas = tmp_path / "marcas"
    marcas.mkdir()
    binarios = tmp_path / "bin"
    binarios.mkdir()
    # Lo que hace el alias de verdad: mensaje por stderr y código distinto de 0.
    alias = 'echo "Python was not found; run without arguments to install from the Microsoft Store" >&2\nexit 49'
    _doble(binarios, "python3", alias)
    _doble(binarios, "python", alias)
    for herramienta in ("kubectl", "docker", "git", "openssl"):
        _doble(binarios, herramienta, f'echo "$@" >> "{marcas.as_posix()}/{herramienta}"')

    entorno = {**os.environ, "PATH": str(binarios), "SOLO_APLICAR": "1", "GHCR_TOKEN": "no-se-usa"}
    resultado = subprocess.run([BASH, str(DESPLEGAR)], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", env=entorno, timeout=60)

    assert resultado.returncode == 1, resultado.stderr
    assert "No hay un Python 3 que funcione" in resultado.stderr
    assert list(marcas.iterdir()) == [], "se invocó una herramienta antes de comprobar el intérprete"


# ── 3. Las políticas de red ─────────────────────────────────────────────────

def test_las_politicas_de_red_se_consultan_antes_de_aplicarlas():
    """La cuenta de estudiante no puede crear NetworkPolicy. El guion lo
    pregunta con `can-i`, salta el manifiesto si la respuesta no es `yes` y lo
    DICE al terminar: un despliegue sin aislamiento no puede pasar por uno
    normal."""
    guion = _guion()
    assert "kubectl auth can-i create networkpolicies.networking.k8s.io" in guion
    # `can-i` sale con 1 cuando responde "no": sin esto `set -e` corta el guion.
    consulta = next(l for l in guion.splitlines() if l.startswith("PUEDE_POLITICAS="))
    assert "|| true" in consulta
    salto = guion.index('[ "$f" = "k8s/40-red.yaml" ] && [ "$PUEDE_POLITICAS" != "yes" ]')
    aplicar = guion.index('"$f" | kubectl apply -f -')
    assert salto < aplicar, "el salto tiene que estar antes del apply del ciclo"
    aviso = guion.index("NO se aplicó: esta cuenta no puede crear NetworkPolicy")
    assert aviso > aplicar
    assert "SIN aislamiento de red" in guion


# ── 4. La URL de la API que se compila en la web ────────────────────────────

def test_la_construccion_de_la_web_no_deja_que_git_bash_convierta_la_url():
    """Comprobado construyendo la imagen de verdad en Windows: sin la variable
    el JavaScript compilado trae `??"C:/Program Files/Git/api"`, y con ella
    `??"/api"`."""
    lineas = [l.strip() for l in _guion().splitlines()
              if "Dockerfile.web" in l and not l.lstrip().startswith("#")]
    assert len(lineas) == 1, lineas
    assert lineas[0].startswith("MSYS_NO_PATHCONV=1 docker build "), lineas[0]
    assert '--build-arg "VITE_API_URL=/api"' in lineas[0]


def test_el_dockerfile_de_la_web_rechaza_una_url_convertida_en_ruta():
    """La variable del guion no protege a quien construye a mano. El
    Dockerfile valida el valor antes de compilar, y tiene que hacerlo ANTES:
    después, la compilación ya terminó bien con la URL mala adentro."""
    dockerfile = (RAIZ / "k8s/Dockerfile.web").read_text(encoding="utf-8")
    guarda = dockerfile.index('RUN case "$VITE_API_URL" in /*|http://*|https://*) ;;')
    assert "exit 1" in dockerfile[guarda:dockerfile.index(chr(10), guarda)]
    assert dockerfile.index("ENV VITE_API_URL=") < guarda < dockerfile.index("RUN npm run build")
