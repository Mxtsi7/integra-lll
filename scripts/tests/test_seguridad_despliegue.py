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


def _cumple(expresion, etiquetas):
    # Los cuatro operadores de un LabelSelector. Antes todo se leía como In,
    # y un NotIn (la regla al revés) pasaba por permitido.
    clave, operador = expresion["key"], expresion["operator"]
    if operador == "In":
        return clave in etiquetas and etiquetas[clave] in expresion["values"]
    if operador == "NotIn":
        return clave not in etiquetas or etiquetas[clave] not in expresion["values"]
    if operador == "Exists":
        return clave in etiquetas
    if operador == "DoesNotExist":
        return clave not in etiquetas
    raise AssertionError(f"operador desconocido en un selector: {operador!r}")


def selecciona(selector, etiquetas):
    return all(etiquetas.get(k) == v for k, v in selector.get("matchLabels", {}).items()) and all(
        _cumple(e, etiquetas) for e in selector.get("matchExpressions", [])
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
    env = {e["name"]: e for e in broker["spec"]["template"]["spec"]["containers"][0]["env"]}
    credenciales = {"RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS"}
    assert credenciales <= set(env)
    # Las credenciales salen de un Secret, nunca del manifiesto.
    for nombre in credenciales:
        assert "secretKeyRef" in env[nombre].get("valueFrom", {}), nombre
        assert "value" not in env[nombre], nombre

    # La regla era "TODA variable usa secretKeyRef", y eso prohibia tambien
    # las de ajuste que no son credenciales --RABBITMQ_NODENAME y los
    # argumentos de la maquina virtual de Erlang, que el broker necesita para
    # arrancar con la CPU que da la cuota--. Se cambia por lo que de verdad
    # importa: que ninguna variable con pinta de credencial traiga su valor
    # escrito en el manifiesto.
    SOSPECHOSAS = ("PASS", "SECRET", "TOKEN", "KEY", "CLAVE")
    for nombre, entrada in env.items():
        if any(palabra in nombre.upper() for palabra in SOSPECHOSAS):
            assert "value" not in entrada, f"{nombre} trae su valor en el manifiesto"
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


# ── S3-FE-21: el directorio de destinatarios ────────────────────────────────


def _reparto():
    """Las líneas NOMBRE=valor de k8s/reparto.env.

    Una clave repetida es un error: desplegar-satelite.sh se queda con la
    ÚLTIMA (`tail -n 1`) y una prueba que leyera la primera validaría otro
    namespace que el que se despliega.
    """
    valores = {}
    for linea in (RAIZ / "k8s/reparto.env").read_text(encoding="utf-8").splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        clave, _, valor = linea.partition("=")
        assert clave not in valores, f"k8s/reparto.env repite {clave}"
        valores[clave] = valor.strip()
    return valores


def _ns_notifications():
    ns = _reparto().get("NS_NOTIFICATIONS")
    assert ns, "k8s/reparto.env no declara NS_NOTIFICATIONS"
    return ns


def test_solo_los_jobs_de_alertas_llegan_a_auth_ademas_del_gateway():
    alertas = {"app": "notifications", "componente": "alertas"}
    api = {"app": "notifications", "componente": "api"}
    assert permitido("notifications", "auth", 8001, etiquetas_origen=alertas)
    assert permitido("notifications", "auth", 8001, namespace=_ns_notifications(), etiquetas_origen=alertas)
    assert not permitido("notifications", "auth", 8001, etiquetas_origen=api)
    assert not permitido("notifications", "auth", 8001, namespace=_ns_notifications(), etiquetas_origen=api)
    assert not permitido("notifications", "auth", 8001, namespace="otro-grupo", etiquetas_origen=alertas)


def test_en_compose_solo_el_proceso_de_alertas_cruza_a_auth():
    servicios = documentos("docker-compose.yml")[0]["services"]
    alertas = servicios["notifications-alertas"]
    assert set(alertas["networks"]) == {"notifications", "auth"}
    assert not alertas.get("ports")
    assert set(servicios["notifications"]["networks"]) == {"notifications"}


def test_la_cuenta_de_correo_solo_llega_al_contenedor_que_despacha():
    cronjob = documentos("k8s/tandas/alertas-notifications.yaml")[0]
    pod = cronjob["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    nombres = lambda c: {e["name"] for e in c.get("env", [])}
    (generar,) = pod["initContainers"]
    (despachar,) = pod["containers"]
    assert despachar["command"][-1] == "despachar_alertas"
    assert {"EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD"} <= nombres(despachar)
    assert not {"EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD"} & nombres(generar)
    for contenedor in (generar, despachar):
        ref = {e["name"]: e for e in contenedor["env"]}["DIRECTORIO_INTERNO_SECRET"]["valueFrom"]["secretKeyRef"]
        assert ref == {"name": "ojoalgasto-alertas", "key": "DIRECTORIO_INTERNO_SECRET", "optional": True}
    for doc in documentos("k8s/tandas/notifications.yaml"):
        assert "EMAIL_HOST_PASSWORD" not in str(doc), "la API y el consumidor no mandan correos"
        assert "ojoalgasto-alertas" not in str(doc)


# ── notifications repartido: el satélite llega a PostgreSQL y RabbitMQ ─────
# Corre en el namespace de NS_NOTIFICATIONS (k8s/reparto.env) y usa la base y
# el broker del núcleo. Un peer con solo podSelector no cruza de namespace,
# así que sin su propio peer el satélite no arranca el día que el clúster
# haga cumplir las políticas.

_BASE_Y_BROKER = (("postgres", 5432), ("rabbitmq", 5672))


def _pods_notifications():
    """Las etiquetas de los pods que despliega el satélite, leídas de sus
    manifiestos: la API con el consumidor (mismo pod, componente: api) y los
    Jobs de alertas (componente: alertas). Las del objeto no sirven: la
    política mira las de la plantilla del pod."""
    pods = []
    for ruta in ("k8s/tandas/notifications.yaml", "k8s/tandas/alertas-notifications.yaml"):
        for doc in documentos(ruta):
            if doc["kind"] == "Deployment":
                pods.append(doc["spec"]["template"]["metadata"]["labels"])
            elif doc["kind"] == "CronJob":
                pods.append(doc["spec"]["jobTemplate"]["spec"]["template"]["metadata"]["labels"])
    assert {p.get("componente") for p in pods} == {"api", "alertas"}, pods
    return pods


def test_notifications_repartido_llega_a_postgres_y_rabbitmq():
    for destino, puerto in _BASE_Y_BROKER:
        for etiquetas in _pods_notifications():
            assert permitido("notifications", destino, puerto, namespace=_ns_notifications(),
                             etiquetas_origen=etiquetas), (destino, etiquetas)
        # Desde el núcleo, como antes.
        assert permitido("notifications", destino, puerto)


def test_notifications_de_otro_grupo_no_llega_a_postgres_ni_rabbitmq():
    for destino, puerto in _BASE_Y_BROKER:
        for etiquetas in _pods_notifications():
            assert not permitido("notifications", destino, puerto, namespace="otro-grupo",
                                 etiquetas_origen=etiquetas), (destino, etiquetas)


def test_otra_app_del_namespace_de_notifications_no_llega_a_postgres_ni_rabbitmq():
    # El namespace es de otro integrante: lo que corra ahí que no sea
    # notifications no entra, aunque en el núcleo sí tenga permiso.
    otras = ("web", "gateway", "auth", "auth-eliminaciones", "subscriptions", "subscriptions-worker",
             "connectors", "connectors-worker", "analytics", "analytics-worker", "notificaciones", "otro")
    for destino, puerto in _BASE_Y_BROKER:
        for app in otras:
            assert not permitido(app, destino, puerto, namespace=_ns_notifications()), (destino, app)
        assert not permitido("otro", destino, puerto, namespace=_ns_notifications(),
                             etiquetas_origen={"componente": "alertas"}), destino


def test_notifications_repartido_no_llega_a_nada_mas_del_nucleo():
    # No usa Redis (sin cliente en requirements.txt, sin URL en sus Secrets)
    # ni llama a las APIs de dominio; el directorio de auth es solo de los
    # Jobs de alertas y está cubierto en su propia prueba.
    api = {"app": "notifications", "componente": "api"}
    for etiquetas in _pods_notifications():
        for destino, puerto in (("redis", 6379), ("rabbitmq", 15672), ("gateway", 8000),
                                ("subscriptions", 8002), ("connectors", 8003), ("analytics", 8004)):
            assert not permitido("notifications", destino, puerto, namespace=_ns_notifications(),
                                 etiquetas_origen=etiquetas), (destino, etiquetas)
    assert not permitido("notifications", "auth", 8001, namespace=_ns_notifications(), etiquetas_origen=api)


def test_el_namespace_de_notifications_en_la_red_es_el_de_reparto():
    # El nombre está escrito en 40-red.yaml; si reparto.env cambia y la
    # política no, el satélite nuevo queda sin base ni broker.
    vistos = {}
    for politica in documentos("k8s/40-red.yaml"):
        destino = politica["spec"]["podSelector"].get("matchLabels", {}).get("app")
        for regla in politica["spec"].get("ingress", []):
            for peer in regla["from"]:
                ns = peer.get("namespaceSelector")
                if ns is None or not any(selecciona(peer.get("podSelector", {}), e)
                                            for e in _pods_notifications()):
                    continue
                for puerto in (p["port"] for p in regla["ports"]):
                    vistos.setdefault((destino, puerto), set()).add(
                        ns.get("matchLabels", {}).get("kubernetes.io/metadata.name"))
    for destino, puerto in _BASE_Y_BROKER:
        assert vistos.get((destino, puerto)) == {_ns_notifications()}, (destino, puerto, vistos)
    for clave, namespaces in vistos.items():
        assert namespaces == {_ns_notifications()}, (clave, namespaces)


def test_la_infraestructura_del_nucleo_solo_cruza_a_namespaces_del_reparto():
    # Las pruebas de arriba miran caminos sueltos; esta mira la forma. A
    # PostgreSQL, RabbitMQ y Redis del núcleo solo se entra desde otro
    # namespace si está en reparto.env, con su nombre exacto y sin rangos ni
    # IPs. Y desde el de notifications, solo app: notifications, sin otra app.
    repartidos = {v for k, v in _reparto().items() if k.startswith("NS_") and k != "NS_NUCLEO" and v}
    assert _ns_notifications() in repartidos
    for politica in documentos("k8s/40-red.yaml"):
        destino = politica["spec"]["podSelector"].get("matchLabels", {}).get("app")
        if destino not in {"postgres", "rabbitmq", "redis"}:
            continue
        for regla in politica["spec"].get("ingress", []):
            assert regla.get("from"), f"{destino}: una regla sin from deja entrar a cualquiera"
            assert regla.get("ports"), f"{destino}: una regla sin ports abre todos los puertos"
            for puerto in regla["ports"]:
                assert puerto.get("protocol") == "TCP" and "endPort" not in puerto, (destino, puerto)
            for peer in regla["from"]:
                assert "ipBlock" not in peer, (destino, peer)
                ns = peer.get("namespaceSelector")
                if ns is None:
                    continue
                assert set(ns) == {"matchLabels"}, (destino, ns)
                assert set(ns["matchLabels"]) == {"kubernetes.io/metadata.name"}, (destino, ns)
                nombre = ns["matchLabels"]["kubernetes.io/metadata.name"]
                assert nombre in repartidos, f"{destino}: {nombre} no está en k8s/reparto.env"
                assert "podSelector" in peer, f"{destino}: abre el namespace {nombre} entero"
                if nombre == _ns_notifications():
                    assert peer["podSelector"] == {"matchLabels": {"app": "notifications"}}, (destino, peer)


def test_la_api_de_connectors_en_la_web_no_abre_la_base_a_cualquier_web():
    con_connectors = {"app": "web", "componente": "con-connectors"}
    for destino, puerto in (("postgres", 5432), ("redis", 6379)):
        assert permitido("web", destino, puerto, etiquetas_origen=con_connectors)
        assert not permitido("web", destino, puerto)
    assert permitido("gateway", "web", 8003)
    assert not permitido("subscriptions", "web", 8003)
    assert not permitido("gateway", "web", 8003, namespace="otro-grupo")


# ── Revisión de #233: los otros receptores de connectors ────────────────────


def _ns_connectors():
    for linea in (RAIZ / "k8s/reparto.env").read_text(encoding="utf-8").splitlines():
        if linea.startswith("NS_CONNECTORS="):
            return linea.split("=", 1)[1].strip()
    raise AssertionError("k8s/reparto.env no declara NS_CONNECTORS")


def test_el_borrado_entre_servicios_llega_a_la_api_de_connectors_en_la_web():
    """auth-eliminaciones manda el DELETE firmado a URL_CONNECTORS, que con
    CONNECTORS_API=web es web:8003. Sin esto, el borrado de una organización
    queda pendiente y connectors conserva sus datos."""
    assert permitido("auth-eliminaciones", "web", 8003)
    assert permitido("gateway", "web", 8003)
    for otro in ("subscriptions", "auth", "notifications", "web"):
        assert not permitido(otro, "web", 8003), otro
    assert not permitido("auth-eliminaciones", "web", 8003, namespace="otro-grupo")


def test_el_satelite_de_connectors_llega_a_postgres_y_redis():
    ns = _ns_connectors()
    for origen, destinos in (
        ("connectors-worker", (("postgres", 5432), ("redis", 6379))),
        ("connectors", (("postgres", 5432), ("redis", 6379))),  # la purga y la API
    ):
        for destino, puerto in destinos:
            assert permitido(origen, destino, puerto, namespace=ns), (origen, destino)
            # Ni otro namespace con la misma etiqueta,
            assert not permitido(origen, destino, puerto, namespace="otro-grupo"), (origen, destino)
    # ni otra app del mismo namespace.
    for destino, puerto in (("postgres", 5432), ("redis", 6379)):
        assert not permitido("otra-app", destino, puerto, namespace=ns)


def test_el_namespace_de_las_politicas_es_el_de_reparto():
    """Si connectors cambia de namespace en reparto.env, las políticas tienen
    que cambiar con él."""
    texto = (RAIZ / "k8s/40-red.yaml").read_text(encoding="utf-8")
    assert f"kubernetes.io/metadata.name: {_ns_connectors()} }}" in texto


# ── RF-14: el worker de connectors publica las órdenes de cobro ────────────


def test_el_worker_de_connectors_repartido_llega_a_rabbitmq_y_nadie_mas_de_su_namespace():
    ns = _ns_connectors()
    assert permitido("connectors-worker", "rabbitmq", 5672, namespace=ns)
    # La API y la purga no publican.
    assert not permitido("connectors", "rabbitmq", 5672, namespace=ns)
    assert not permitido("otra-app", "rabbitmq", 5672, namespace=ns)
    assert not permitido("connectors-worker", "rabbitmq", 5672, namespace="otro-grupo")
    # Ni la consola de administración del broker.
    assert not permitido("connectors-worker", "rabbitmq", 15672, namespace=ns)


def _variables(contenedor):
    return {v["name"]: v for v in contenedor.get("env", [])}


def test_solo_el_worker_de_connectors_recibe_la_credencial_del_broker():
    (worker,) = [d for d in documentos("k8s/tandas/worker-connectors.yaml") if d["kind"] == "Deployment"]
    (contenedor,) = worker["spec"]["template"]["spec"]["containers"]
    ref = _variables(contenedor)["RABBITMQ_URL"]["valueFrom"]["secretKeyRef"]
    assert ref == {"name": "ojoalgasto-rabbitmq", "key": "RABBITMQ_URL"}

    import yaml

    parche = yaml.safe_load((RAIZ / "k8s/parches/connectors-api-en-web.yaml").read_text(encoding="utf-8"))
    (api_en_web,) = parche["spec"]["template"]["spec"]["containers"]
    assert "RABBITMQ_URL" not in _variables(api_en_web)
    for doc in documentos("k8s/tandas/connectors.yaml"):
        if doc["kind"] == "Deployment":
            for contenedor in doc["spec"]["template"]["spec"]["containers"]:
                assert "RABBITMQ_URL" not in _variables(contenedor), doc["metadata"]["name"]
