"""Regresiones de D-11; ejecutar con pytest scripts/tests/."""
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[2]


def documentos(ruta):
    return list(yaml.safe_load_all((RAIZ / ruta).read_text(encoding="utf-8")))


def test_compose_no_publica_servicios_internos():
    servicios = documentos("docker-compose.yml")[0]["services"]
    for nombre, servicio in servicios.items():
        if nombre not in {"gateway", "frontend"}:
            assert not servicio.get("ports"), nombre
    assert "postgres}" not in servicios["postgres"]["environment"]["POSTGRES_PASSWORD"]
    assert "RABBITMQ_DEFAULT_PASS" in servicios["rabbitmq"]["environment"]
    assert servicios["auth"]["environment"]["SEED_DEMO"] != "1"
    dominios = {"auth", "subscriptions", "connectors", "analytics", "notifications"}
    for nombre in dominios:
        redes = set(servicios[nombre]["networks"])
        assert redes & set(servicios["gateway"]["networks"])
        assert not redes & set(servicios["frontend"]["networks"])
        for otro in dominios - {nombre}:
            assert not redes & set(servicios[otro]["networks"])


def test_configuracion_publica_no_contiene_credenciales():
    for ruta in ("k8s/00-configuracion.yaml", "infra/k8s/base/config.yaml"):
        for doc in documentos(ruta):
            assert doc["kind"] != "Secret", ruta
            if doc["kind"] == "ConfigMap":
                datos = doc["data"]
                assert "RABBITMQ_URL" not in datos
                assert "SEED_CLAVE" not in datos
                assert datos.get("SEED_DEMO", "0") != "1"


def selecciona(selector, etiquetas):
    return all(etiquetas.get(k) == v for k, v in selector.get("matchLabels", {}).items()) and all(
        etiquetas.get(e["key"]) in e["values"] for e in selector.get("matchExpressions", [])
    )


def permitido(origen, destino, puerto, namespace="local", etiquetas_origen=None):
    politicas = documentos("k8s/40-red.yaml")
    etiquetas = {"app": destino, "app.kubernetes.io/part-of": "ojoalgasto"}
    aplicables = [p["spec"] for p in politicas if selecciona(p["spec"]["podSelector"], etiquetas)]
    assert aplicables, f"{destino} no está aislado"
    for politica in aplicables:
        for regla in politica.get("ingress", []):
            if puerto not in [p["port"] for p in regla["ports"]]:
                continue
            for peer in regla["from"]:
                ns = peer.get("namespaceSelector")
                if ns is None and namespace != "local":
                    continue
                if ns is not None and not selecciona(ns, {"kubernetes.io/metadata.name": namespace}):
                    continue
                if selecciona(peer.get("podSelector", {}), etiquetas_origen or {"app": origen}):
                    return True
    return False


def test_red_permite_rutas_necesarias_y_bloquea_suplantacion():
    for servicio, puerto in [("auth", 8001), ("subscriptions", 8002), ("connectors", 8003),
                             ("analytics", 8004), ("notifications", 8005)]:
        assert permitido("gateway", servicio, puerto)
        assert not permitido("web", servicio, puerto)
        assert not permitido("subscriptions", servicio, puerto)
        assert not permitido("gateway", servicio, puerto, namespace="otro-grupo")
    assert permitido("web", "gateway", 8000)
    assert permitido("subscriptions-worker", "postgres", 5432)
    assert permitido("auth", "redis", 6379)
    assert permitido("analytics-worker", "rabbitmq", 5672)
    assert not permitido("web", "postgres", 5432)
    assert not permitido("otro", "rabbitmq", 15672)
    assert not permitido("web", "gateway", 8000, namespace="otro-grupo")
    for ns in ("ingress-nginx", "kube-system"):
        controlador = {"app.kubernetes.io/component": "controller", "app.kubernetes.io/name": "ingress-nginx"}
        assert permitido("ingress", "web", 8080, namespace=ns, etiquetas_origen=controlador)
        assert not permitido("otro", "web", 8080, namespace=ns)


def test_rabbitmq_usa_secret_y_despliegue_incluye_politicas():
    broker = next(d for d in documentos("k8s/02-redis-rabbitmq.yaml")
                  if d["kind"] == "Deployment" and d["metadata"]["name"] == "rabbitmq")
    env = broker["spec"]["template"]["spec"]["containers"][0]["env"]
    assert {e["name"] for e in env} >= {"RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS"}
    assert all("secretKeyRef" in e["valueFrom"] for e in env)
    script = (RAIZ / "k8s/desplegar.sh").read_text(encoding="utf-8")
    assert "k8s/40-red.yaml" in script
    assert "gh auth token" not in script


def test_carga_local_entra_por_gateway_sin_poder_suplantarlo():
    for ruta in ("k8s/pruebas/carga-fortio.yaml",):
        pod = documentos(ruta)[0]["spec"]["template"]
        etiquetas = pod["metadata"]["labels"]
        app = etiquetas["app"]
        assert permitido(app, "gateway", 8000, etiquetas_origen=etiquetas)
        assert not permitido(app, "subscriptions", 8002, etiquetas_origen=etiquetas)
        assert not permitido(app, "auth", 8001, etiquetas_origen=etiquetas)
        assert not permitido(app, "gateway", 8000, namespace="otro-grupo", etiquetas_origen=etiquetas)
        args = pod["spec"]["containers"][0]["args"]
        assert args[-1].startswith("http://gateway:8000/")
        assert not any("X-Organizacion-Id" in arg for arg in args)


def test_dominio_no_recibe_la_credencial_administrativa():
    for ruta, servicio in [("k8s/10-auth.yaml", "auth"), ("k8s/11-subscriptions.yaml", "subscriptions")]:
        for doc in documentos(ruta):
            if doc["kind"] != "Deployment":
                continue
            pod = doc["spec"]["template"]["spec"]
            for contenedor in pod.get("initContainers", []) + pod["containers"]:
                assert not any("secretRef" in e for e in contenedor.get("envFrom", []))
                env = {e["name"]: e for e in contenedor["env"]}
                assert env["DATABASE_URL"]["valueFrom"]["secretKeyRef"]["name"] == f"ojoalgasto-bd-{servicio}"
                assert "POSTGRES_PASSWORD" not in env


def test_limpieza_conserva_redes_y_secreto_explicito():
    servicios = documentos("docker-compose.yml")[0]["services"]
    worker = servicios["auth-eliminaciones"]
    assert set(worker["networks"]) == {"auth", "subscriptions", "connectors", "analytics", "notifications"}
    assert "RABBITMQ_URL" in worker["environment"]
    for nombre in ("auth", "auth-eliminaciones", "subscriptions", "connectors", "analytics", "notifications"):
        assert ":?" in servicios[nombre]["environment"]["ELIMINACION_INTERNA_SECRET"]
    for ruta in ("k8s/10-auth.yaml", "k8s/11-subscriptions.yaml"):
        for doc in documentos(ruta):
            if doc["kind"] != "Deployment":
                continue
            pod = doc["spec"]["template"]["spec"]
            for contenedor in pod.get("initContainers", []) + pod["containers"]:
                env = {e["name"]: e for e in contenedor["env"]}
                assert env["ELIMINACION_INTERNA_SECRET"]["valueFrom"]["secretKeyRef"] == {
                    "name": "ojoalgasto", "key": "ELIMINACION_INTERNA_SECRET"}
    for destino, puerto in (("subscriptions", 8002), ("connectors", 8003), ("analytics", 8004), ("notifications", 8005)):
        assert permitido("auth-eliminaciones", destino, puerto)
        assert not permitido("auth-eliminaciones", destino, puerto, namespace="otro-grupo")
    assert permitido("auth-eliminaciones", "postgres", 5432)
    assert permitido("auth-eliminaciones", "redis", 6379)
    assert not permitido("auth-eliminaciones", "auth", 8001)


def test_comparador_externo_tiene_acceso_solo_al_gateway_autorizado():
    pod = documentos("k8s/pruebas/carga-comparar.yaml")[0]["spec"]["template"]
    etiquetas = pod["metadata"]["labels"]
    assert permitido("carga-comparar", "gateway", 8000, namespace="student-carga", etiquetas_origen=etiquetas)
    assert not permitido("carga-comparar", "gateway", 8000, namespace="otro-grupo", etiquetas_origen=etiquetas)
    assert not permitido("otro", "gateway", 8000, namespace="student-carga")
    assert not permitido("carga-comparar", "gateway", 8000)
    for servicio, puerto in (("auth", 8001), ("subscriptions", 8002), ("postgres", 5432), ("rabbitmq", 5672)):
        assert not permitido("carga-comparar", servicio, puerto, namespace="student-carga", etiquetas_origen=etiquetas)
    args = pod["spec"]["containers"][0]["args"]
    assert args[-1] == "http://gateway.student-forellana.svc.cluster.local:8000/api/suscripciones/"
    assert "Host: gateway" in args
    assert "Authorization: Bearer $(TOKEN_CARGA)" in args
