#!/usr/bin/env python3
"""Adapta un ConfigMap o un Secret del núcleo para un namespace satélite.

El sistema no cabe en la cuota de un solo namespace (12 pods), así que algunos
servicios corren en el namespace de otro integrante. Esos servicios siguen
usando el PostgreSQL, el RabbitMQ y el Redis del núcleo, y para eso necesitan
dos cosas que este módulo resuelve:

1. **Nombres calificados.** Dentro del núcleo los servicios se hablan por el
   nombre corto del Service (`postgres`). Desde otro namespace ese nombre no
   resuelve: hay que escribir `postgres.<namespace del núcleo>`.
2. **Solo lo que el servicio usa.** Un Secret se traslada con una lista
   explícita de claves. Lo que no está en la lista no viaja: el satélite no
   recibe la clave administradora de PostgreSQL ni el secreto de los JWT.

Lee el objeto en JSON por la entrada estándar y escribe el adaptado por la
salida, para encadenarlo entre dos `kubectl` sin que un valor toque el disco,
la línea de comandos ni la pantalla:

    kubectl get secret ojoalgasto-rabbitmq -n NUCLEO -o json \\
      | python k8s/satelite.py secreto --nucleo NUCLEO --claves RABBITMQ_URL \\
      | kubectl apply -n SATELITE -f -

Solo usa la biblioteca estándar.
"""
import argparse
import base64
import json
import re
import sys

# Lo que vive en el núcleo y un satélite puede necesitar alcanzar.
SERVICIOS_DEL_NUCLEO = frozenset({"postgres", "rabbitmq", "redis", "auth", "subscriptions", "gateway"})

_NAMESPACE = re.compile(r"^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$")
# esquema://[usuario[:clave]@]host[:puerto][resto]
_URL = re.compile(r"^(?P<esquema>[a-z][a-z0-9+.-]*://)(?P<credencial>[^/@]*@)?(?P<host>[^/:@?#]+)(?P<resto>.*)$", re.S)


class Rechazo(ValueError):
    """El objeto no se puede trasladar tal como viene."""


def validar_namespace(nombre):
    if not isinstance(nombre, str) or not _NAMESPACE.match(nombre):
        raise Rechazo(f"Nombre de namespace inválido: {nombre!r}")
    return nombre


def calificar(valor, nucleo):
    """Devuelve `valor` con el host calificado si es una URL hacia el núcleo.

    Solo toca un host que sea EXACTAMENTE el nombre corto de un servicio del
    núcleo. Un host ya calificado, uno externo o un texto que no es URL
    vuelven sin cambios: aplicar esto dos veces da lo mismo que aplicarlo una.
    """
    if not isinstance(valor, str):
        return valor
    partes = _URL.match(valor)
    if not partes or partes["host"] not in SERVICIOS_DEL_NUCLEO:
        return valor
    return f"{partes['esquema']}{partes['credencial'] or ''}{partes['host']}.{nucleo}{partes['resto']}"


def _metadatos(objeto):
    """Nombre y etiquetas; nada del namespace de origen.

    `resourceVersion`, `uid`, `namespace`, `ownerReferences` y las anotaciones
    (incluida la última configuración aplicada, que en un Secret trae los
    valores) pertenecen al objeto del núcleo y no se copian.
    """
    origen = objeto.get("metadata") or {}
    if not origen.get("name"):
        raise Rechazo("El objeto no trae nombre")
    limpio = {"name": origen["name"]}
    if origen.get("labels"):
        limpio["labels"] = dict(origen["labels"])
    return limpio


def configmap_para_satelite(configmap, nucleo, satelite, servicio):
    """El ConfigMap del núcleo, apuntando al núcleo desde afuera."""
    validar_namespace(nucleo)
    validar_namespace(satelite)
    if configmap.get("kind") != "ConfigMap":
        raise Rechazo(f"Se esperaba un ConfigMap y llegó {configmap.get('kind')!r}")
    if nucleo == satelite:
        raise Rechazo("El satélite no puede ser el mismo namespace que el núcleo")
    datos = {clave: calificar(valor, nucleo) for clave, valor in (configmap.get("data") or {}).items()}
    # El gateway llega al servicio por su nombre calificado, y Django rechaza
    # con 400 un Host que no conoce. El nombre corto ya lo agrega cada
    # servicio en su configuración; acá van las formas con namespace.
    anfitriones = [h for h in datos.get("ALLOWED_HOSTS", "").split(",") if h]
    for forma in (f"{servicio}.{satelite}", f"{servicio}.{satelite}.svc", f"{servicio}.{satelite}.svc.cluster.local"):
        if forma not in anfitriones:
            anfitriones.append(forma)
    datos["ALLOWED_HOSTS"] = ",".join(anfitriones)
    return {"apiVersion": "v1", "kind": "ConfigMap", "metadata": _metadatos(configmap), "data": datos}


def secreto_para_satelite(secreto, nucleo, claves):
    """Un Secret del núcleo reducido a `claves`, con sus URL calificadas."""
    validar_namespace(nucleo)
    if secreto.get("kind") != "Secret":
        raise Rechazo(f"Se esperaba un Secret y llegó {secreto.get('kind')!r}")
    if not claves:
        raise Rechazo("Hay que nombrar las claves que se trasladan; no se copia un Secret entero")
    origen = secreto.get("data") or {}
    faltan = [clave for clave in claves if clave not in origen]
    if faltan:
        # Se nombran las claves, nunca los valores.
        raise Rechazo(f"El Secret {secreto['metadata']['name']} no tiene: {', '.join(faltan)}")
    datos = {}
    for clave in claves:
        crudo = base64.b64decode(origen[clave])
        try:
            texto = crudo.decode("utf-8")
        except UnicodeDecodeError:
            datos[clave] = origen[clave]  # binario: viaja tal cual
            continue
        datos[clave] = base64.b64encode(calificar(texto, nucleo).encode("utf-8")).decode("ascii")
    return {"apiVersion": "v1", "kind": "Secret", "metadata": _metadatos(secreto),
            "type": secreto.get("type", "Opaque"), "data": datos}


def main(argv=None):
    analizador = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    analizador.add_argument("tipo", choices=["configmap", "secreto"])
    analizador.add_argument("--nucleo", required=True)
    analizador.add_argument("--satelite")
    analizador.add_argument("--servicio")
    analizador.add_argument("--claves", default="")
    opciones = analizador.parse_args(argv)
    try:
        objeto = json.load(sys.stdin)
        if opciones.tipo == "configmap":
            if not opciones.satelite or not opciones.servicio:
                raise Rechazo("configmap requiere --satelite y --servicio")
            salida = configmap_para_satelite(objeto, opciones.nucleo, opciones.satelite, opciones.servicio)
        else:
            salida = secreto_para_satelite(objeto, opciones.nucleo,
                                           [c for c in opciones.claves.split(",") if c])
    except (Rechazo, json.JSONDecodeError, KeyError) as error:
        # El mensaje nunca incluye el contenido leído: podría ser un Secret.
        sys.exit(f"No se traslada: {error if isinstance(error, Rechazo) else type(error).__name__}")
    json.dump(salida, sys.stdout)


if __name__ == "__main__":
    main()
