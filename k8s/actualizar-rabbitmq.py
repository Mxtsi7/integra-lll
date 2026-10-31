#!/usr/bin/env python3
"""Drena y congela el broker efímero antes de aplicar su manifiesto.

Solo usa la biblioteca estándar y kubectl. Un cero sin cerrar conexiones
no es evidencia suficiente: un publicador podría confirmar otro mensaje
entre la consulta y el reemplazo del pod.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

MANIFIESTO = Path(__file__).resolve().with_name("02-redis-rabbitmq.yaml")


def kubectl(*args):
    resultado = subprocess.run(
        ["kubectl", *map(str, args)], capture_output=True, text=True,
        encoding="utf-8", timeout=360,
    )
    if resultado.returncode:
        raise RuntimeError(resultado.stderr.strip() or "kubectl falló")
    return resultado.stdout


def filas(salida):
    datos = json.loads(salida)
    if not isinstance(datos, list) or not all(isinstance(f, dict) for f in datos):
        raise RuntimeError("Respuesta del broker inválida; no se autoriza reemplazo")
    return datos


def actualizar(ejecutar=kubectl, intentos=60, pausa=2):
    if intentos < 1 or pausa < 0:
        raise RuntimeError("Drenaje requiere intentos positivos y pausa no negativa")
    deployment = ejecutar("get", "deployment/rabbitmq", "--ignore-not-found", "-o", "json")
    if not deployment.strip():
        ejecutar("apply", "-f", str(MANIFIESTO))
        ejecutar("rollout", "status", "deployment/rabbitmq", "--timeout=300s")
        return
    if json.loads(deployment)["spec"]["replicas"] != 1:
        raise RuntimeError("Se requiere un broker de una réplica disponible para comprobar sus colas")
    pods = json.loads(ejecutar("get", "pods", "-l", "app=rabbitmq", "-o", "json"))["items"]
    if len(pods) != 1:
        raise RuntimeError("No se puede identificar un único pod RabbitMQ; no se reemplaza")
    pod = pods[0]
    if (pod.get("metadata", {}).get("deletionTimestamp")
            or pod["status"].get("phase") != "Running"
            or not pod["status"].get("containerStatuses")
            or not all(c.get("ready") for c in pod["status"]["containerStatuses"])):
        raise RuntimeError("RabbitMQ no está listo para verificar el drenaje")
    nombre, uid = pod["metadata"]["name"], pod["metadata"]["uid"]

    def ctl(*args):
        return ejecutar("exec", nombre, "-c", "rabbitmq", "--", "rabbitmqctl", "--quiet", *args)

    def vacio():
        vhosts = filas(ctl("list_vhosts", "name", "--formatter=json"))
        if not vhosts:
            raise RuntimeError("No se pudieron verificar los vhosts")
        total = 0
        for vhost in vhosts:
            for cola in filas(ctl("list_queues", "-p", vhost["name"], "name", "messages",
                                  "auto_delete", "exclusive", "state", "--formatter=json")):
                # No cerrar conexiones de colas que puedan borrarse al desconectar:
                # podrían recibir un mensaje entre la lectura y el cierre.
                if (cola.get("auto_delete") is not False or cola.get("exclusive") is not False
                        or cola.get("state") != "running"
                        or type(cola.get("messages")) is not int or cola["messages"] < 0):
                    raise RuntimeError("Cola no verificable o temporal; preservar manualmente antes de migrar")
                total += cola["messages"]  # ready + unacknowledged, también las DLQ
        print(f"RabbitMQ: {total} mensajes pendientes en todos los vhosts", flush=True)
        return total == 0

    # Los consumidores siguen activos durante este drenaje acotado.
    for intento in range(intentos):
        if vacio():
            break
        if intento + 1 == intentos:
            raise RuntimeError("No se drenaron todas las colas; no se reemplaza RabbitMQ")
        time.sleep(pausa)

    aplicacion_iniciada = False
    rollout_verificado = False
    try:
        ctl("suspend_listeners")
        for conexion in filas(ctl("list_connections", "pid", "--formatter=json")):
            ctl("close_connection", conexion["pid"], "Migración D-11: reintentar desde outbox")
        if filas(ctl("list_connections", "pid", "--formatter=json")):
            raise RuntimeError("Persisten conexiones; no se reemplaza RabbitMQ")
        if not vacio():
            raise RuntimeError("Llegaron mensajes durante el cierre; drenar y reintentar")
        actual = json.loads(ejecutar("get", f"pod/{nombre}", "-o", "json"))
        if actual["metadata"]["uid"] != uid or actual["metadata"].get("deletionTimestamp"):
            raise RuntimeError("El pod cambió durante la verificación; no se reemplaza")
        # Desde aquí el servidor podría aceptar el reemplazo aunque perdamos
        # su respuesta. Nunca reabrir un broker que puede estar por eliminarse.
        aplicacion_iniciada = True
        ejecutar("apply", "-f", str(MANIFIESTO))
        ejecutar("rollout", "status", "deployment/rabbitmq", "--timeout=300s")
        rollout_verificado = True
    finally:
        # También sirve en reintentos sin cambio de plantilla: el pod original
        # sigue vivo y debe volver a aceptar conexiones. Nunca tocar un pod nuevo.
        actual = ejecutar("get", f"pod/{nombre}", "--ignore-not-found", "-o", "json")
        actual = json.loads(actual) if actual.strip() else None
        if actual and actual["metadata"]["uid"] == uid:
            if actual["metadata"].get("deletionTimestamp"):
                print(f"ATENCIÓN: {nombre} está terminando; no se reabren sus listeners.", file=sys.stderr)
            elif not aplicacion_iniciada or rollout_verificado:
                ctl("resume_listeners")
            else:
                print(f"ATENCIÓN: {nombre} permanece suspendido: actualización incierta. "
                      "Verificar/cancelar el reemplazo pendiente antes de reanudar listeners.", file=sys.stderr)


def interrumpir(signum, frame):
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrumpir)
    try:
        actualizar(intentos=int(os.getenv("RABBIT_DRENAR_INTENTOS", "60")),
                   pausa=float(os.getenv("RABBIT_DRENAR_PAUSA", "2")))
    except (RuntimeError, ValueError, KeyError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        sys.exit(f"Migración RabbitMQ abortada: {error}. Revisar el broker original antes de reintentar.")
