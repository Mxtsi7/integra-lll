"""`desplegar-satelite.sh` espera al consumidor antes de apuntar el núcleo.

Revisión de #164. La espera original no esperaba: usaba
`kubectl wait --for=condition=Ready --timeout=10s` como pausa entre consultas,
pero el timeout de `wait` es un máximo, no una pausa. Después del rollout el
pod ya está Ready, `wait` vuelve al instante, y los treinta intentos se
agotaban antes de que el consumidor terminara de conectarse a RabbitMQ: un
despliegue bueno abortaba con «El consumidor no llegó a escuchar».

Se ejecuta el guion REAL, entero, con un `kubectl` doble. El doble contesta
como contesta el de verdad en lo que importa acá: `wait` vuelve enseguida
porque el pod ya está Ready, y `logs` no trae la línea hasta que pasa un
tiempo. No se toca ningún cluster: el doble va primero en el PATH y, por si
algo se colara, `KUBECONFIG` apunta a un archivo vacío.
"""
import base64
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
GUION = RAIZ / "k8s/desplegar-satelite.sh"
BASH = shutil.which("bash")

pytestmark = pytest.mark.skipif(BASH is None, reason="Requiere bash")

KUBECTL_DOBLE = r"""#!/usr/bin/env bash
# Doble de kubectl para desplegar-satelite.sh. Anota cada llamada.
printf '%s\n' "$*" >> "$DOBLE_REGISTRO"
ahora_ms() { echo $(( $(date +%s%N) / 1000000 )); }
case "$*" in
  "auth can-i "*) echo yes ;;
  "get configmap ojoalgasto -n "*" -o json") cat "$DOBLE_DATOS/configmap.json" ;;
  "get configmap ojoalgasto -n "*" -o jsonpath="*) printf 'subscriptions' ;;
  "get secret "*" -o json") cat "$DOBLE_DATOS/secreto-$3.json" ;;
  "wait "*)
    # El pod YA está Ready tras el rollout: `wait` vuelve al instante.
    exit 0 ;;
  "logs "*)
    # La línea del consumidor aparece DOBLE_APARECE_TRAS_MS después de la
    # primera consulta; con -1 no aparece nunca.
    [ -f "$DOBLE_DATOS/primera" ] || ahora_ms > "$DOBLE_DATOS/primera"
    if [ "$DOBLE_APARECE_TRAS_MS" -ge 0 ] \
       && [ $(( $(ahora_ms) - $(cat "$DOBLE_DATOS/primera") )) -ge "$DOBLE_APARECE_TRAS_MS" ]; then
      echo "Escuchando notifications.dominio.v2"
    fi ;;
  "apply "*"-f -") cat > /dev/null ;;
  *) : ;;
esac
"""


def _b64(texto):
    return base64.b64encode(texto.encode()).decode()


def _secreto(nombre, **claves):
    return {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": nombre, "namespace": "student-forellana"},
            "data": {clave: _b64(valor) for clave, valor in claves.items()}}


@pytest.fixture
def entorno(tmp_path):
    binarios = tmp_path / "bin"
    datos = tmp_path / "datos"
    binarios.mkdir()
    datos.mkdir()
    doble = binarios / "kubectl"
    doble.write_text(KUBECTL_DOBLE, encoding="utf-8", newline="\n")
    doble.chmod(doble.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    configmap = next(d for d in yaml.safe_load_all(
        (RAIZ / "k8s/00-configuracion.yaml").read_text(encoding="utf-8"))
        if d["kind"] == "ConfigMap" and d["metadata"]["name"] == "ojoalgasto")
    (datos / "configmap.json").write_text(json.dumps(configmap), encoding="utf-8")
    clave = "0f" * 32
    for secreto in (
        _secreto("ghcr", **{".dockerconfigjson": json.dumps({"auths": {"ghcr.io": {"auth": "eDp5"}}})}),
        _secreto("ojoalgasto", SECRET_KEY="s" * 64, ELIMINACION_INTERNA_SECRET="e" * 64, JWT_SECRET="j" * 64),
        _secreto("ojoalgasto-bd-notifications",
                 DATABASE_URL=f"postgres://svc_notifications:{clave}@postgres:5432/suscripciones"),
        _secreto("ojoalgasto-rabbitmq", RABBITMQ_URL=f"amqp://ojoalgasto:{clave}@rabbitmq:5672/"),
    ):
        (datos / f"secreto-{secreto['metadata']['name']}.json").write_text(json.dumps(secreto), encoding="utf-8")

    sin_cluster = tmp_path / "sin-cluster"
    sin_cluster.write_text("", encoding="utf-8")
    registro = tmp_path / "kubectl.log"
    registro.write_text("", encoding="utf-8")
    base = {
        **os.environ,
        "PATH": str(binarios) + os.pathsep + os.environ["PATH"],
        "KUBECONFIG": str(sin_cluster),
        "SOLO_APLICAR": "1",
        "ETIQUETA": "prueba",
        "DOBLE_REGISTRO": registro.as_posix(),
        "DOBLE_DATOS": datos.as_posix(),
    }
    base.pop("SOLO_ENSAYAR", None)

    def ejecutar(**extra):
        inicio = time.monotonic()
        resultado = subprocess.run([BASH, str(GUION), "notifications"], capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", env={**base, **extra}, timeout=120)
        llamadas = registro.read_text(encoding="utf-8").splitlines()
        return resultado, llamadas, time.monotonic() - inicio

    return ejecutar


def _apunto_el_nucleo(llamadas):
    return any(linea.startswith("patch configmap ojoalgasto -n student-forellana") for linea in llamadas)


def _consultas_de_logs(llamadas):
    return [linea for linea in llamadas if linea.startswith("logs ")]


def test_el_consumidor_que_conecta_tarde_se_espera_y_el_nucleo_se_apunta(entorno):
    """La reproducción de la revisión, al revés: el pod ya está Ready y la
    línea del consumidor aparece un segundo y medio después. Antes los
    treinta intentos se agotaban en centésimas y el despliegue abortaba."""
    resultado, llamadas, _ = entorno(DOBLE_APARECE_TRAS_MS="4000",
                                     PAUSA_CONSUMIDOR="1", PLAZO_CONSUMIDOR="40")

    assert resultado.returncode == 0, resultado.stderr[-600:]
    assert "consumidor escuchando" in resultado.stdout
    assert _apunto_el_nucleo(llamadas)
    # Esperó de verdad, y PAUSANDO: en cuatro segundos, con un segundo entre
    # consultas, caben unas cinco. La cota de arriba es la que distingue una
    # espera de un sondeo sin pausa, y no depende de la máquina: en Linux el
    # guion anterior agotaba sus treinta intentos en centésimas y abortaba;
    # en Windows, donde lanzar un proceso es lento, llegaba a ver la línea
    # pero después de consultar decenas de veces seguidas.
    assert 2 <= len(_consultas_de_logs(llamadas)) <= 7
    # Y después de apuntar reinició lo que lee esa configuración, en orden.
    reinicios = [l.split()[2] for l in llamadas if l.startswith("rollout restart ")]
    assert reinicios == ["deployment/gateway", "deployment/auth", "deployment/auth-eliminaciones"]


def test_si_el_consumidor_nunca_conecta_se_aborta_al_vencer_el_plazo_sin_apuntar(entorno):
    """La salida segura que hay que conservar: sin consumidor acreditado, el
    núcleo no se toca. Y se aborta al VENCER el plazo, no antes."""
    resultado, llamadas, duracion = entorno(DOBLE_APARECE_TRAS_MS="-1",
                                            PAUSA_CONSUMIDOR="1", PLAZO_CONSUMIDOR="4")

    assert resultado.returncode == 1
    assert "no llegó a escuchar" in resultado.stderr
    assert not _apunto_el_nucleo(llamadas)
    assert not any(l.startswith("rollout restart ") for l in llamadas)
    # Usó el plazo: no se rindió en centésimas ni se quedó para siempre, y
    # consultó lo que cabe en cuatro segundos pausando uno: no treinta veces.
    assert 2 <= len(_consultas_de_logs(llamadas)) <= 7
    assert duracion >= 4
    assert duracion < 60
    assert "4s" in resultado.stderr


def test_el_consumidor_que_ya_escucha_no_hace_esperar(entorno):
    resultado, llamadas, _ = entorno(DOBLE_APARECE_TRAS_MS="0",
                                     PAUSA_CONSUMIDOR="5", PLAZO_CONSUMIDOR="20")

    assert resultado.returncode == 0, resultado.stderr[-600:]
    assert len(_consultas_de_logs(llamadas)) == 1
    assert _apunto_el_nucleo(llamadas)


@pytest.mark.parametrize("variable, valor", [
    ("PLAZO_CONSUMIDOR", "pronto"), ("PLAZO_CONSUMIDOR", "0"), ("PLAZO_CONSUMIDOR", "-5"),
    ("PAUSA_CONSUMIDOR", "un rato"), ("PAUSA_CONSUMIDOR", "0"), ("PAUSA_CONSUMIDOR", ""),
])
def test_un_plazo_o_una_pausa_que_no_sirven_se_rechazan_antes_de_tocar_nada(entorno, variable, valor):
    """Una pausa de cero vuelve a ser el defecto original, y un plazo que no
    es un número rompería la cuenta a mitad del despliegue, con los secretos
    ya copiados."""
    resultado, llamadas, _ = entorno(DOBLE_APARECE_TRAS_MS="0", **{variable: valor})

    assert resultado.returncode == 1
    assert variable in resultado.stderr
    assert llamadas == [], "se llamó a kubectl antes de validar"


def test_la_espera_no_usa_kubectl_wait_como_pausa():
    """El defecto en una línea: `wait` no pausa cuando la condición ya se
    cumple. La pausa tiene que ser explícita."""
    guion = GUION.read_text(encoding="utf-8")
    ejecutable = "\n".join(l for l in guion.splitlines() if not l.lstrip().startswith("#"))
    assert "kubectl wait" not in ejecutable
    assert 'sleep "$PAUSA_CONSUMIDOR"' in ejecutable
