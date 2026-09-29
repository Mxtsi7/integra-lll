#!/usr/bin/env bash
# Construye las imágenes, las publica y despliega todo en Kubernetes.
#
#     ./k8s/desplegar.sh                 # construye, publica y aplica
#     SOLO_APLICAR=1 ./k8s/desplegar.sh  # solo aplica (no reconstruye)
#
# Requisitos: docker, kubectl con el contexto del ramo, y sesión en el
# registro (docker login ghcr.io).
set -euo pipefail

REGISTRO="${REGISTRO:-ghcr.io/felipeorellanacaro}"
ETIQUETA="${ETIQUETA:-$(git rev-parse --short HEAD)}"
HOST_PUBLICO="${HOST_PUBLICO:-ojoalgasto-forellana.dev.censei.cl}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

IMAGEN_AUTH="$REGISTRO/ojoalgasto-auth:$ETIQUETA"
IMAGEN_SUBSCRIPTIONS="$REGISTRO/ojoalgasto-subscriptions:$ETIQUETA"
IMAGEN_GATEWAY="$REGISTRO/ojoalgasto-gateway:$ETIQUETA"
IMAGEN_WEB="$REGISTRO/ojoalgasto-web:$ETIQUETA"

if [ "${SOLO_APLICAR:-0}" != "1" ]; then
  echo "── construyendo imágenes ($ETIQUETA) ──"
  docker build -q -f k8s/Dockerfile.servicio --build-arg SERVICIO=services/auth          -t "$IMAGEN_AUTH" .
  docker build -q -f k8s/Dockerfile.servicio --build-arg SERVICIO=services/subscriptions -t "$IMAGEN_SUBSCRIPTIONS" .
  docker build -q -f k8s/Dockerfile.servicio --build-arg SERVICIO=gateway                -t "$IMAGEN_GATEWAY" .
  docker build -q -f k8s/Dockerfile.web --build-arg "VITE_API_URL=/api" -t "$IMAGEN_WEB" frontend/

  echo "── publicando ──"
  for i in "$IMAGEN_AUTH" "$IMAGEN_SUBSCRIPTIONS" "$IMAGEN_GATEWAY" "$IMAGEN_WEB"; do
    docker push -q "$i"
  done
fi

echo "── credencial del registro ──"
# El cluster solo necesita BAJAR las imágenes, así que con un token de
# `read:packages` basta. Pásalo en GHCR_TOKEN:
#     https://github.com/settings/tokens/new?scopes=read:packages
# Sin él se usa el de `gh`, que tiene permiso de escritura: funciona, pero
# deja en el cluster una credencial que puede publicar paquetes a tu nombre.
if [ -z "${GHCR_TOKEN:-}" ]; then
  echo "   OJO: sin GHCR_TOKEN se usa el token de gh, que puede escribir."
  GHCR_TOKEN="$(gh auth token)"
fi
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
    --from-literal=DATABASE_URL="postgres://postgres:$CLAVE_POSTGRES@postgres:5432/suscripciones"
  echo "   secret creado (clave de Postgres aleatoria)"
elif ! kubectl get secret ojoalgasto -o jsonpath='{.data.DATABASE_URL}' | grep -q .; then
  # Despliegue anterior: la base ya está inicializada con esa clave, así que
  # NO se cambia (POSTGRES_PASSWORD solo se aplica en el primer arranque).
  # Solo se agrega la URL que faltaba.
  CLAVE_POSTGRES="$(kubectl get secret ojoalgasto -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
  kubectl patch secret ojoalgasto --type=merge \
    -p "{\"stringData\":{\"DATABASE_URL\":\"postgres://postgres:$CLAVE_POSTGRES@postgres:5432/suscripciones\"}}" >/dev/null
  echo "   secret al día: DATABASE_URL agregada con la clave que ya usaba la base"
else
  echo "   ya existía, se deja como está"
fi

echo "── aplicando manifiestos ──"
for f in k8s/00-configuracion.yaml k8s/01-postgres.yaml k8s/02-redis-rabbitmq.yaml \
         k8s/10-auth.yaml k8s/11-subscriptions.yaml k8s/12-gateway.yaml \
         k8s/13-web.yaml k8s/20-ingress.yaml; do
  sed -e "s|IMAGEN_AUTH|$IMAGEN_AUTH|g" \
      -e "s|IMAGEN_SUBSCRIPTIONS|$IMAGEN_SUBSCRIPTIONS|g" \
      -e "s|IMAGEN_GATEWAY|$IMAGEN_GATEWAY|g" \
      -e "s|IMAGEN_WEB|$IMAGEN_WEB|g" \
      -e "s|ojoalgasto-forellana.dev.censei.cl|$HOST_PUBLICO|g" \
      "$f" | kubectl apply -f -
done

echo "── esperando a que todo quede arriba ──"
kubectl rollout status statefulset/postgres --timeout=300s
for d in redis rabbitmq auth subscriptions subscriptions-worker subscriptions-beat gateway web; do
  kubectl rollout status "deployment/$d" --timeout=300s
done

echo
kubectl get pods -o wide
echo
echo "Listo: https://$HOST_PUBLICO"
