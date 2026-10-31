"""Ejecuta el guard de migración; solo sustituye el límite externo kubectl."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

RUTA = Path(__file__).resolve().parents[2] / "k8s/actualizar-rabbitmq.py"


@pytest.fixture
def guard():
    spec = importlib.util.spec_from_file_location("migracion_rabbitmq", RUTA)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


class Cluster:
    def __init__(self, mensajes=0, fallo=None):
        self.mensajes = mensajes
        self.fallo = fallo
        self.acciones = []
        self.suspendido = False
        self.cerrado = False
        self.aplicado = False

    def __call__(self, *args):
        self.acciones.append(args)
        if self.fallo and self.fallo in args:
            raise RuntimeError("consulta fallida")
        if args[:2] == ("get", "deployment/rabbitmq"):
            return json.dumps({"spec": {"replicas": 1}})
        if args[:2] == ("get", "pods"):
            return json.dumps({"items": [{"metadata": {"name": "rabbit-viejo", "uid": "original"},
                "status": {"phase": "Running", "containerStatuses": [{"ready": True}]}}]})
        if args[:2] == ("get", "pod/rabbit-viejo"):
            return "" if self.aplicado else json.dumps({"metadata": {"uid": "original"}})
        if "suspend_listeners" in args:
            self.suspendido = True
        if "resume_listeners" in args:
            self.suspendido = False
        if "close_connection" in args:
            assert self.suspendido
            self.cerrado = True
        if "list_connections" in args:
            return json.dumps([] if self.cerrado else [{"pid": "<rabbit@viejo.1.0>"}])
        if "list_vhosts" in args:
            return json.dumps([{"name": "/"}, {"name": "otro"}])
        if "list_queues" in args:
            # Incluye DLQ en otro vhost: no basta revisar subscriptions.resumen.
            n = self.mensajes if args[args.index("-p") + 1] == "otro" else 0
            return json.dumps([{"name": "fallidos", "messages": n,
                "auto_delete": False, "exclusive": False, "state": "running"}])
        if args[0] == "apply":
            assert self.suspendido and self.cerrado
            self.aplicado = True
        return ""


def test_reemplaza_solo_despues_de_cerrar_y_comprobar_todos_los_vhosts(guard):
    cluster = Cluster()
    guard.actualizar(cluster, intentos=1, pausa=0)
    assert cluster.aplicado
    assert any("rollout" in a for a in cluster.acciones)


def test_mensajes_en_dlq_impiden_reemplazo(guard):
    cluster = Cluster(mensajes=3)
    with pytest.raises(RuntimeError):
        guard.actualizar(cluster, intentos=1, pausa=0)
    assert not cluster.aplicado
    assert not cluster.suspendido


@pytest.mark.parametrize("fallo", ["list_vhosts", "list_queues", "list_connections", "close_connection"])
def test_consulta_o_reemplazo_fallido_no_deja_broker_suspendido(guard, fallo):
    cluster = Cluster(fallo=fallo)
    with pytest.raises(RuntimeError):
        guard.actualizar(cluster, intentos=1, pausa=0)
    assert not cluster.aplicado
    assert not cluster.suspendido


@pytest.mark.parametrize("fallo", ["apply", "rollout"])
def test_actualizacion_incierta_no_reabre_pod_que_puede_ser_eliminado(guard, fallo):
    cluster = Cluster()

    def ejecutar(*args):
        if args[0] == fallo:
            # El servidor aceptó la actualización pero no conocemos el resultado.
            cluster.aplicado = True
            raise RuntimeError("respuesta perdida o rollout sin verificar")
        if args[:2] == ("get", "pod/rabbit-viejo"):
            return json.dumps({"metadata": {"uid": "original"}})
        return cluster(*args)

    with pytest.raises(RuntimeError):
        guard.actualizar(ejecutar, intentos=1, pausa=0)
    assert cluster.aplicado
    assert cluster.suspendido


def test_mensaje_que_llega_al_cerrar_conexiones_aborta_y_reanuda(guard):
    cluster = Cluster()
    original = cluster.__call__

    def ejecutar(*args):
        if "close_connection" in args:
            cluster.mensajes = 1
        return original(*args)

    with pytest.raises(RuntimeError):
        guard.actualizar(ejecutar, intentos=1, pausa=0)
    assert not cluster.aplicado
    assert not cluster.suspendido


@pytest.mark.parametrize("cambio", [
    {"messages": None}, {"messages": "0"}, {"state": "down"},
    {"auto_delete": True}, {"exclusive": True},
])
def test_cola_no_verificable_no_autoriza_reemplazo(guard, cambio):
    cluster = Cluster()

    def ejecutar(*args):
        salida = cluster(*args)
        if "list_queues" in args:
            datos = json.loads(salida)
            datos[0].update(cambio)
            return json.dumps(datos)
        return salida

    with pytest.raises(RuntimeError):
        guard.actualizar(ejecutar, intentos=1, pausa=0)
    assert not cluster.aplicado


def test_pod_original_que_sigue_vivo_reanuda_en_reintento_sin_cambios(guard):
    cluster = Cluster()

    def ejecutar(*args):
        salida = cluster(*args)
        if args[:2] == ("get", "pod/rabbit-viejo"):
            return json.dumps({"metadata": {"uid": "original"}})
        return salida

    guard.actualizar(ejecutar, intentos=1, pausa=0)
    assert cluster.aplicado
    assert not cluster.suspendido


@pytest.mark.parametrize("momento", ["antes_apply", "despues_rollout"])
def test_finally_no_reabre_original_con_marca_de_eliminacion(guard, momento):
    cluster = Cluster()

    def ejecutar(*args):
        salida = cluster(*args)
        if args[:2] == ("get", "pod/rabbit-viejo"):
            metadata = {"uid": "original"}
            if momento == "antes_apply" or cluster.aplicado:
                metadata["deletionTimestamp"] = "2026-10-31T00:00:00Z"
            return json.dumps({"metadata": metadata})
        return salida

    if momento == "antes_apply":
        with pytest.raises(RuntimeError, match="El pod cambió"):
            guard.actualizar(ejecutar, intentos=1, pausa=0)
        assert not cluster.aplicado
    else:
        guard.actualizar(ejecutar, intentos=1, pausa=0)
        assert cluster.aplicado
    assert cluster.suspendido
    assert not any("resume_listeners" in args for args in cluster.acciones)


@pytest.mark.skipif(not os.getenv("D11_RABBITMQ_CONTENEDOR"), reason="Requiere RabbitMQ real en Docker (CI)")
def test_guard_preserva_mensaje_confirmado_con_rabbitmq_real(guard):
    """kubectl exec se traduce a docker exec; el CLI y las colas son reales."""
    import pika

    contenedor = os.environ["D11_RABBITMQ_CONTENEDOR"]
    url = os.environ["D11_RABBITMQ_URL"]
    cluster = Cluster()
    # No hay conexiones falsas: los comandos RabbitMQ se ejecutan realmente.
    def ejecutar(*args):
        if args[0] == "exec":
            resultado = subprocess.run(
                ["docker", "exec", contenedor, *args[args.index("--") + 1:]],
                capture_output=True, text=True, check=True, timeout=60,
            )
            return resultado.stdout
        if args[0] == "apply":
            cluster.aplicado = True
            return ""
        if args[:2] == ("get", "pod/rabbit-viejo"):
            return json.dumps({"metadata": {"uid": "original"}})
        return cluster(*args)

    with pika.BlockingConnection(pika.URLParameters(url)) as conexion:
        canal = conexion.channel()
        canal.queue_declare(queue="regresion.d11.fallidos", durable=True)
        canal.confirm_delivery()
        canal.basic_publish(exchange="", routing_key="regresion.d11.fallidos", body=b"conservar",
            mandatory=True, properties=pika.BasicProperties(delivery_mode=2))
    with pytest.raises(RuntimeError, match="No se drenaron"):
        guard.actualizar(ejecutar, intentos=1, pausa=0)
    assert not cluster.aplicado
    with pika.BlockingConnection(pika.URLParameters(url)) as conexion:
        canal = conexion.channel()
        metodo, _, cuerpo = canal.basic_get("regresion.d11.fallidos", auto_ack=True)
        assert metodo and cuerpo == b"conservar"
    guard.actualizar(ejecutar, intentos=1, pausa=0)
    assert cluster.aplicado
    # En el ensayo el pod no se reemplaza: finally debe reanudar el listener.
    with pika.BlockingConnection(pika.URLParameters(url)) as conexion:
        assert conexion.is_open
