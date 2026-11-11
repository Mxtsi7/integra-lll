#!/usr/bin/env bash
# Despliega un servicio en el namespace de otro integrante (ver k8s/reparto.env).
#
#     ./k8s/desplegar-satelite.sh notifications                 # construye, publica y aplica
#     SOLO_APLICAR=1 ./k8s/desplegar-satelite.sh notifications  # solo aplica
#     SOLO_ENSAYAR=1 ./k8s/desplegar-satelite.sh notifications  # valida contra el servidor y no cambia nada
#
# Requisitos: Python 3, kubectl con permiso de escritura en LOS DOS namespaces
# (el dueño del satélite lo da con el `rolebinding` que este guion imprime si
# falta), y el núcleo ya desplegado en la misma versión.
#
# Qué hace, en orden, y por qué en ese orden:
#   1. comprueba permisos y que el núcleo tenga lo que se va a copiar;
#   2. valida los manifiestos contra el servidor ANTES de copiar un secreto;
#   3. copia configuración y secretos, con las direcciones calificadas;
#   4. aplica el servicio y espera a que el consumidor esté escuchando;
#   5. recién entonces apunta el gateway y Auth del núcleo hacia el satélite.
# Si algo falla antes del paso 5, el núcleo no se entera de nada.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

SERVICIO="${1:-}"
case "$SERVICIO" in
  notifications) PUERTO=8005; CLAVE_REPARTO=NS_NOTIFICATIONS ;;
  *) echo "Uso: desplegar-satelite.sh notifications" >&2
     echo "(connectors y analytics todavía no tienen manifiestos: ver k8s/tandas/perfiles.yaml)" >&2
     exit 1 ;;
esac

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

# reparto.env no se ejecuta: se lee. Solo admite el alfabeto de un namespace.
leer_reparto() {
  sed -n "s/^$1=\([a-z0-9-]*\)[[:space:]]*\$/\1/p" k8s/reparto.env | tail -n 1
}
NS_NUCLEO="$(leer_reparto NS_NUCLEO)"
NS_SATELITE="$(leer_reparto "$CLAVE_REPARTO")"
if [ -z "$NS_NUCLEO" ] || [ -z "$NS_SATELITE" ]; then
  echo "k8s/reparto.env no declara NS_NUCLEO o $CLAVE_REPARTO. No se despliega." >&2
  exit 1
fi
if [ "$NS_NUCLEO" = "$NS_SATELITE" ]; then
  echo "El satélite no puede ser el namespace del núcleo." >&2
  exit 1
fi

REGISTRO="${REGISTRO:-ghcr.io/felipeorellanacaro}"
ETIQUETA="${ETIQUETA:-$(git rev-parse --short HEAD)}"
IMAGEN="$REGISTRO/ojoalgasto-$SERVICIO:$ETIQUETA"
[[ "$IMAGEN" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/@:-]+$ ]] || { echo "Referencia de imagen inválida" >&2; exit 1; }
URL_SATELITE="http://$SERVICIO.$NS_SATELITE:$PUERTO"

echo "── $SERVICIO: núcleo $NS_NUCLEO → satélite $NS_SATELITE ($IMAGEN) ──"

echo "── permisos ──"
for ns in "$NS_NUCLEO" "$NS_SATELITE"; do
  for recurso in deployments.apps secrets configmaps; do
    if [ "$(kubectl auth can-i create "$recurso" -n "$ns" 2>/dev/null || true)" != "yes" ]; then
      echo "Esta cuenta no puede crear $recurso en $ns." >&2
      if [ "$ns" = "$NS_SATELITE" ]; then
        echo "El dueño de ese namespace tiene que correr, con SU cuenta:" >&2
        echo "  kubectl create rolebinding acceso-nucleo --clusterrole=student-workspace-admin --user=<tu usuario> -n $NS_SATELITE" >&2
        echo "(tu usuario es el que muestra: kubectl auth whoami)" >&2
      fi
      exit 1
    fi
  done
done

echo "── el núcleo tiene lo que se va a copiar ──"
for secreto in ghcr ojoalgasto "ojoalgasto-bd-$SERVICIO" ojoalgasto-rabbitmq; do
  kubectl get secret "$secreto" -n "$NS_NUCLEO" >/dev/null 2>&1 || {
    echo "Falta el Secret $secreto en $NS_NUCLEO: desplegar el núcleo primero (k8s/desplegar.sh)." >&2
    exit 1
  }
done
kubectl get configmap ojoalgasto -n "$NS_NUCLEO" >/dev/null

if [ "${SOLO_APLICAR:-0}" != "1" ] && [ "${SOLO_ENSAYAR:-0}" != "1" ]; then
  echo "── construyendo y publicando la imagen ──"
  docker build -q -f k8s/Dockerfile.servicio --build-arg "SERVICIO=services/$SERVICIO" -t "$IMAGEN" .
  docker push -q "$IMAGEN"
fi

MANIFIESTOS="$(mktemp)"
trap 'rm -f "$MANIFIESTOS"' EXIT
for f in "k8s/tandas/$SERVICIO.yaml" "k8s/tandas/alertas-$SERVICIO.yaml"; do
  echo "---"
  sed -e "s|IMAGEN_NOTIFICATIONS|$IMAGEN|g" "$f"
done > "$MANIFIESTOS"

echo "── validando los manifiestos contra el servidor ──"
# Pasa por la cuota, el LimitRange y los permisos del satélite sin guardar
# nada. Si el servidor los rechaza, se aborta acá: sin un solo secreto copiado.
kubectl apply -n "$NS_SATELITE" --dry-run=server -f "$MANIFIESTOS"

if [ "${SOLO_ENSAYAR:-0}" = "1" ]; then
  echo
  echo "Ensayo terminado: el servidor acepta los manifiestos. No se cambió nada."
  exit 0
fi

echo "── configuración y secretos ──"
# Cada traslado es una tubería entre dos kubectl: el valor no toca el disco,
# la línea de comandos ni la pantalla. satelite.py califica las direcciones
# (`postgres` → `postgres.$NS_NUCLEO`) y deja pasar solo las claves nombradas.
kubectl get configmap ojoalgasto -n "$NS_NUCLEO" -o json \
  | "$PYTHON" k8s/satelite.py configmap --nucleo "$NS_NUCLEO" --satelite "$NS_SATELITE" --servicio "$SERVICIO" \
  | kubectl apply -n "$NS_SATELITE" -f -

trasladar_secreto() {
  kubectl get secret "$1" -n "$NS_NUCLEO" -o json \
    | "$PYTHON" k8s/satelite.py secreto --nucleo "$NS_NUCLEO" --claves "$2" \
    | kubectl apply -n "$NS_SATELITE" -f - >/dev/null
  echo "   $1: $2"
}
trasladar_secreto ghcr .dockerconfigjson
# Del Secret global solo lo que el servicio lee. Se quedan en el núcleo la
# clave administradora de PostgreSQL, el secreto de los JWT, las claves de
# cifrado de los conectores y la cuenta de correo.
trasladar_secreto ojoalgasto SECRET_KEY,ELIMINACION_INTERNA_SECRET
trasladar_secreto "ojoalgasto-bd-$SERVICIO" DATABASE_URL
trasladar_secreto ojoalgasto-rabbitmq RABBITMQ_URL

echo "── aplicando el servicio ──"
kubectl apply -n "$NS_SATELITE" -f "$MANIFIESTOS"
kubectl rollout status "deployment/$SERVICIO" -n "$NS_SATELITE" --timeout=300s

echo "── esperando al consumidor ──"
# La salud HTTP no prueba que el consumidor esté conectado al broker del
# núcleo: es otro contenedor y otra conexión. Se espera su propia línea.
escuchando=0
for _ in $(seq 1 30); do
  if kubectl logs "deployment/$SERVICIO" -n "$NS_SATELITE" -c consumidor --tail=50 2>/dev/null | grep -q "Escuchando "; then
    escuchando=1
    break
  fi
  kubectl wait --for=condition=Ready pod -l "app=$SERVICIO,componente=api" -n "$NS_SATELITE" --timeout=10s >/dev/null 2>&1 || true
done
if [ "$escuchando" != "1" ]; then
  echo "El consumidor no llegó a escuchar. El núcleo NO se apunta al satélite." >&2
  echo "Revisar: kubectl logs deployment/$SERVICIO -n $NS_SATELITE -c consumidor" >&2
  exit 1
fi
echo "   consumidor escuchando"

echo "── apuntando el núcleo al satélite ──"
# Mismos valores que k8s/desplegar.sh escribe a partir de reparto.env, para
# que el próximo despliegue del núcleo no los revierta.
destinos="$(kubectl get configmap ojoalgasto -n "$NS_NUCLEO" -o jsonpath='{.data.ELIMINACION_DESTINOS}')"
case ",$destinos," in
  *",$SERVICIO,"*) ;;
  *) destinos="${destinos:+$destinos,}$SERVICIO" ;;
esac
CLAVE_URL="URL_$(printf '%s' "$SERVICIO" | tr '[:lower:]' '[:upper:]')"
# El parche va por argumento y no por la entrada estándar: `--patch-file
# /dev/stdin` no existe para kubectl.exe en Windows. No lleva secretos (una
# dirección interna y una lista de nombres), así que puede verse en argv.
PARCHE="$(printf '{"data":{"%s":"%s","ELIMINACION_DESTINOS":"%s"}}' "$CLAVE_URL" "$URL_SATELITE" "$destinos")"
kubectl patch configmap ojoalgasto -n "$NS_NUCLEO" --type=merge -p "$PARCHE"
# Un ConfigMap leído con envFrom no se recarga solo. De a uno y esperando:
# con la cuota al tope no caben dos rollouts a la vez, y Auth va antes que su
# worker para que ningún borrado se despache con la lista vieja de destinos.
for d in gateway auth auth-eliminaciones; do
  kubectl rollout restart "deployment/$d" -n "$NS_NUCLEO" >/dev/null
  kubectl rollout status "deployment/$d" -n "$NS_NUCLEO" --timeout=300s
done

echo
kubectl get pods -n "$NS_SATELITE" -o wide
echo
echo "Listo: $SERVICIO corre en $NS_SATELITE y el núcleo lo busca en $URL_SATELITE"
