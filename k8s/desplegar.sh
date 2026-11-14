#!/usr/bin/env bash
# Construye las imágenes, las publica y despliega todo en Kubernetes.
#
#     ./k8s/desplegar.sh                 # construye, publica y aplica
#     SOLO_APLICAR=1 ./k8s/desplegar.sh  # solo aplica (no reconstruye)
#
# Requisitos: Python 3, docker, kubectl con el contexto del ramo, y sesión en
# el registro (docker login ghcr.io).
set -euo pipefail

# ── Un Python que de verdad funcione ─────────────────────────────────────────
# En Windows `python3` suele ser el alias de la Microsoft Store: existe en el
# PATH, pero no ejecuta nada; imprime "Python was not found" y sale con error.
# Se prueba cada candidato EJECUTANDOLO, no solo con `command -v`, y se resuelve
# antes de construir o tocar el cluster: descubrirlo a mitad del despliegue
# deja los pasos anteriores aplicados y los siguientes no.
PYTHON=""
for candidato in python3 python; do
  if command -v "$candidato" >/dev/null 2>&1 && "$candidato" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    PYTHON="$candidato"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "No hay un Python 3 que funcione (se probaron python3 y python). No se despliega." >&2
  exit 1
fi

REGISTRO="${REGISTRO:-ghcr.io/felipeorellanacaro}"
ETIQUETA="${ETIQUETA:-$(git rev-parse --short HEAD)}"
HOST_PUBLICO="${HOST_PUBLICO:-ojoalgasto-forellana.dev.censei.cl}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

# El contenido llega por stdin; ni las claves ni el JSON aparecen en argv.
# El subshell limita umask y trampas a cada parche, también si kubectl falla.
parchear_secreto() (
  umask 077
  PARCHE="$(mktemp)"
  trap 'rm -f "$PARCHE"' EXIT
  trap 'exit 1' HUP INT TERM
  cat > "$PARCHE"
  kubectl patch secret ojoalgasto --type=merge --patch-file "$PARCHE" >/dev/null
)

# ── Servicios repartidos en el namespace de otro integrante ─────────────────
# k8s/reparto.env dice dónde vive cada uno (ver k8s/README.md). Acá solo se
# usa para que el gateway y Auth del núcleo los busquen ahí; desplegarlos es
# trabajo de k8s/desplegar-satelite.sh.
#
# El archivo no se ejecuta: se lee, y solo admite el alfabeto de un namespace.
leer_reparto() {
  sed -n "s/^$1=\([a-z0-9-]*\)[[:space:]]*\$/\1/p" k8s/reparto.env | tail -n 1
}
NS_NOTIFICATIONS="$(leer_reparto NS_NOTIFICATIONS)"
URL_NOTIFICATIONS="http://notifications:8005"
DESTINOS_ELIMINACION="subscriptions"
if [ -n "$NS_NOTIFICATIONS" ]; then
  URL_NOTIFICATIONS="http://notifications.$NS_NOTIFICATIONS:8005"
  # Un servicio que guarda datos de una organización tiene que estar en la
  # lista de borrado, o al eliminar la organización sus filas quedan huérfanas.
  DESTINOS_ELIMINACION="subscriptions,notifications"
fi

# Sustituye imágenes, host público y el reparto. Todo manifiesto que se aplica
# pasa por acá: aplicar uno en crudo devolvería el gateway a la dirección
# corta de un servicio que ya no vive en este namespace.
renderizar() {
  sed -e "s|IMAGEN_AUTH|$IMAGEN_AUTH|g" \
      -e "s|IMAGEN_SUBSCRIPTIONS|$IMAGEN_SUBSCRIPTIONS|g" \
      -e "s|IMAGEN_GATEWAY|$IMAGEN_GATEWAY|g" \
      -e "s|IMAGEN_WEB|$IMAGEN_WEB|g" \
      -e "s|ojoalgasto-forellana.dev.censei.cl|$HOST_PUBLICO|g" \
      -e "s|^\(  URL_NOTIFICATIONS:\) .*\$|\1 $URL_NOTIFICATIONS|" \
      -e "s|^\(  ELIMINACION_DESTINOS:\) .*\$|\1 $DESTINOS_ELIMINACION|" \
      "$1"
}

IMAGEN_AUTH="$REGISTRO/ojoalgasto-auth:$ETIQUETA"
IMAGEN_SUBSCRIPTIONS="$REGISTRO/ojoalgasto-subscriptions:$ETIQUETA"
IMAGEN_GATEWAY="$REGISTRO/ojoalgasto-gateway:$ETIQUETA"
IMAGEN_WEB="$REGISTRO/ojoalgasto-web:$ETIQUETA"

if [ "${SOLO_APLICAR:-0}" != "1" ]; then
  echo "── construyendo imágenes ($ETIQUETA) ──"
  docker build -q -f k8s/Dockerfile.servicio --build-arg SERVICIO=services/auth          -t "$IMAGEN_AUTH" .
  docker build -q -f k8s/Dockerfile.servicio --build-arg SERVICIO=services/subscriptions -t "$IMAGEN_SUBSCRIPTIONS" .
  docker build -q -f k8s/Dockerfile.servicio --build-arg SERVICIO=gateway                -t "$IMAGEN_GATEWAY" .
  # MSYS_NO_PATHCONV: sin esto Git Bash convierte `/api` en
  # `C:/Program Files/Git/api` y la web compila apuntando a esa "URL". El
  # Dockerfile ademas lo rechaza, por si alguien construye a mano.
  MSYS_NO_PATHCONV=1 docker build -q -f k8s/Dockerfile.web --build-arg "VITE_API_URL=/api" -t "$IMAGEN_WEB" frontend/

  echo "── publicando ──"
  for i in "$IMAGEN_AUTH" "$IMAGEN_SUBSCRIPTIONS" "$IMAGEN_GATEWAY" "$IMAGEN_WEB"; do
    docker push -q "$i"
  done
fi

echo "── credencial del registro ──"
# El cluster solo necesita BAJAR las imágenes, así que con un token de
# `read:packages` basta. Pásalo en GHCR_TOKEN:
#     https://github.com/settings/tokens/new?scopes=read:packages
# No se copia al cluster el token de escritura de la cuenta de desarrollo.
: "${GHCR_TOKEN:?Definir GHCR_TOKEN con permiso read:packages para el cluster}"
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username="${GHCR_USUARIO:-FelipeOrellanaCaro}" \
  --docker-password="$GHCR_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "── secretos ──"
# Se generan una sola vez y quedan en el cluster; no se guardan en el repo.
#
# DATABASE_URL va acá y no en el ConfigMap porque lleva la contraseña adentro,
# y se arma con la MISMA clave que recibe Postgres: una sola fuente de verdad.
# Tenerla en los dos lados era pedir que se desincronizaran.
if ! kubectl get secret ojoalgasto >/dev/null 2>&1; then
  CLAVE_POSTGRES="$(openssl rand -hex 16)"
  kubectl create secret generic ojoalgasto \
    --from-literal=SECRET_KEY="$(openssl rand -hex 32)" \
    --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
    --from-literal=POSTGRES_PASSWORD="$CLAVE_POSTGRES" \
    --from-literal=DATABASE_URL="postgres://postgres:$CLAVE_POSTGRES@postgres:5432/suscripciones" \
    --from-literal=CLAVES_CIFRADO="$(openssl rand -base64 32 | tr '+/' '-_')"
  echo "   secret creado (clave de Postgres aleatoria)"
elif ! kubectl get secret ojoalgasto -o jsonpath='{.data.DATABASE_URL}' | grep -q .; then
  # Despliegue anterior: la base ya está inicializada con esa clave, así que
  # NO se cambia (POSTGRES_PASSWORD solo se aplica en el primer arranque).
  # Solo se agrega la URL que faltaba.
  CLAVE_POSTGRES="$(kubectl get secret ojoalgasto -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
  printf '{"stringData":{"DATABASE_URL":"postgres://postgres:%s@postgres:5432/suscripciones"}}' "$CLAVE_POSTGRES" | parchear_secreto
  echo "   secret al día: DATABASE_URL agregada con la clave que ya usaba la base"
else
  echo "   ya existía, se deja como está"
fi
# OJO con lo de arriba: el `if` solo genera una clave aleatoria cuando el
# Secret NO existe. Eso es correcto —regenerarla en cada despliegue dejaría la
# base sin poder conectar— pero tiene una consecuencia que ya nos costó:
#
# Si el Secret se creó alguna vez con una clave mala (la nuestra estuvo en
# 00-configuracion.yaml, en un repo público), este script NUNCA la va a
# cambiar. Y como POSTGRES_PASSWORD solo se aplica en el primer arranque de
# Postgres, editar el Secret a mano tampoco alcanza: hay que cambiarla dentro
# de la base.
#
# Para eso está k8s/rotar-clave-postgres.sh.

# CLAVES_CIFRADO: clave Fernet con la que shared/cifrado guarda los tokens de
# los conectores (FE-06). Una clave Fernet son 32 bytes en base64 url-safe.
# Se agrega una sola vez; rotarla es un procedimiento aparte
# (shared/cifrado/README.md), nunca se regenera sola o lo guardado queda ilegible.
if ! kubectl get secret ojoalgasto -o jsonpath='{.data.CLAVES_CIFRADO}' | grep -q .; then
  printf '{"stringData":{"CLAVES_CIFRADO":"%s"}}' "$(openssl rand -base64 32 | tr '+/' '-_')" | parchear_secreto
  echo "   CLAVES_CIFRADO agregada al secret"
fi

# Firma independiente de JWT, compartida por Auth y consumidores de limpieza.
# Se añade también al Secret existente, sin rotar otras credenciales.
if ! kubectl get secret ojoalgasto -o jsonpath='{.data.ELIMINACION_INTERNA_SECRET}' | grep -q .; then
  CLAVE_ELIMINACION="$(openssl rand -hex 32)"
  printf '{"stringData":{"ELIMINACION_INTERNA_SECRET":"%s"}}' "$CLAVE_ELIMINACION" | parchear_secreto
fi

echo "── aplicando manifiestos ──"
# Credencial dedicada; en un despliegue existente se conserva el Secret.
if ! kubectl get secret ojoalgasto-rabbitmq >/dev/null 2>&1; then
  CLAVE_RABBITMQ="$(openssl rand -hex 32)"
  printf '{"apiVersion":"v1","kind":"Secret","metadata":{"name":"ojoalgasto-rabbitmq"},"type":"Opaque","stringData":{"RABBITMQ_USER":"ojoalgasto","RABBITMQ_PASSWORD":"%s","RABBITMQ_URL":"amqp://ojoalgasto:%s@rabbitmq:5672/"}}' \
    "$CLAVE_RABBITMQ" "$CLAVE_RABBITMQ" | kubectl create -f - >/dev/null
fi
# Verificar/drenar el broker ANTES de reemplazarlo o reiniciar sus consumidores.
# Si falla, no se aplica el manifiesto ni se prosigue con la migración.
"$PYTHON" k8s/actualizar-rabbitmq.py
# El usuario del broker NO lo crean RABBITMQ_DEFAULT_USER/PASS cuando ya hay
# datos en el PVC: solo actuan en el primer arranque. Sin esto los clientes
# quedan sin poder autenticarse. Ver el encabezado del guion.
bash k8s/configurar-usuario-rabbitmq.sh

# Preparar Postgres antes de las migraciones de dominio.
renderizar k8s/00-configuracion.yaml | kubectl apply -f -
kubectl apply -f k8s/01-postgres.yaml
kubectl rollout status statefulset/postgres --timeout=300s
bash k8s/configurar-usuarios-bd.sh

# ── Las politicas de red solo se aplican si el cluster lo permite ────────────
# En el cluster del ramo la cuenta de estudiante NO puede crear NetworkPolicy
# (el rol solo da lectura), y `kubectl apply -f k8s/40-red.yaml` responde
# Forbidden. Con `set -e` eso cortaba el guion despues de aplicar todo lo
# demas y antes de esperar los rollouts: el despliegue quedaba hecho, pero el
# guion terminaba en error y sin comprobar nada.
#
# `can-i` sale con 1 cuando la respuesta es "no"; por eso el `|| true`.
PUEDE_POLITICAS="$(kubectl auth can-i create networkpolicies.networking.k8s.io 2>/dev/null || true)"
SIN_POLITICAS=0

for f in k8s/00-configuracion.yaml k8s/01-postgres.yaml \
         k8s/10-auth.yaml k8s/11-subscriptions.yaml k8s/12-gateway.yaml \
         k8s/13-web.yaml k8s/20-ingress.yaml k8s/30-autoescalado.yaml k8s/40-red.yaml; do
  if [ "$f" = "k8s/40-red.yaml" ] && [ "$PUEDE_POLITICAS" != "yes" ]; then
    SIN_POLITICAS=1
    continue
  fi
  renderizar "$f" | kubectl apply -f -
done

echo "── esperando a que todo quede arriba ──"
kubectl rollout status statefulset/postgres --timeout=300s
for d in redis rabbitmq auth auth-eliminaciones subscriptions subscriptions-worker subscriptions-beat gateway web; do
  # Un deployment en 0 réplicas está así a propósito (RabbitMQ hasta el
  # Sprint 2). `rollout status` se quedaría esperando 300s y saldría con
  # error, tumbando el script entero por algo que no es una falla.
  deseadas="$(kubectl get "deployment/$d" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  if [ "${deseadas:-0}" = "0" ]; then
    echo "   $d: 0 réplicas por diseño, se omite"
    continue
  fi
  kubectl rollout status "deployment/$d" --timeout=300s
done

echo
kubectl get pods -o wide
if [ "$SIN_POLITICAS" = "1" ]; then
  echo
  echo "ATENCIÓN: k8s/40-red.yaml NO se aplicó: esta cuenta no puede crear NetworkPolicy." >&2
  echo "  Los servicios quedan SIN aislamiento de red: cualquier pod del cluster que" >&2
  echo "  conozca el nombre puede hablarles directo, sin pasar por el gateway." >&2
  echo "  Comprobar con: kubectl get networkpolicy" >&2
fi

echo
echo "Listo: https://$HOST_PUBLICO"
