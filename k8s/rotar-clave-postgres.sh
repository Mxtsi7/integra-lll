#!/usr/bin/env bash
# Rota la contraseña de Postgres en el cluster.
#
#     ./k8s/rotar-clave-postgres.sh            # muestra qué haría, no toca nada
#     ./k8s/rotar-clave-postgres.sh --aplicar  # la rota de verdad
#
# ── Por qué hace falta ───────────────────────────────────────────────────────
# La clave estuvo en k8s/00-configuracion.yaml, dentro de un DATABASE_URL, en
# un repo público. El commit 971aa5e la sacó del archivo, pero sacarla del
# archivo NO la invalida: la base siguió usándola.
#
# Sobrevivió por dos razones que se sumaron:
#   1. desplegar.sh solo genera una clave aleatoria si el Secret NO existe. El
#      Secret ya existía de antes, así que esa rama nunca corrió.
#   2. POSTGRES_PASSWORD solo se aplica en el PRIMER arranque de Postgres. Una
#      vez inicializada la base, cambiar esa variable no cambia nada.
#
# Por eso no basta con editar el Secret: hay que cambiarla DENTRO de Postgres
# y dejar el Secret en sincronía.
#
# ── Ojo: hay una ventana de corte ────────────────────────────────────────────
# Entre el ALTER USER y el reinicio de los servicios, las conexiones que ya
# estaban abiertas siguen funcionando, pero las nuevas fallan. Django abre una
# conexión por petición (CONN_MAX_AGE=0), así que en la práctica el sitio
# responde error durante el reinicio: alrededor de un minuto. No correr esto
# durante la demo.
set -euo pipefail

APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

# Los que abren conexiones a la base. El gateway recibe el Secret pero no
# consulta Postgres, así que no se reinicia: sería corte sin motivo.
SERVICIOS=(auth subscriptions subscriptions-worker subscriptions-beat)

paso() { echo; echo "── $* ──"; }
mal()  { echo "ERROR: $*" >&2; exit 1; }

paso "comprobaciones previas"

kubectl get statefulset postgres >/dev/null 2>&1 || mal "no veo el StatefulSet de postgres; ¿contexto correcto?"
[ "$(kubectl get statefulset postgres -o jsonpath='{.status.readyReplicas}')" = "1" ] \
  || mal "postgres no está listo; no se rota con la base caída"

ACTUAL="$(kubectl get secret ojoalgasto -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
[ -n "$ACTUAL" ] || mal "el Secret no tiene POSTGRES_PASSWORD"
echo "   clave actual: ${#ACTUAL} caracteres"

# Se confirma que la que está viva es la publicada, para no rotar a ciegas una
# que alguien ya rotó. La huella se compara, el valor no se imprime nunca.
FILTRADA="$(git show 4e2af2c:k8s/00-configuracion.yaml 2>/dev/null \
  | grep -oE 'postgres://[^:]+:[^@]+@' | sed -E 's|postgres://[^:]+:||; s|@$||' | tr -d '\n' || true)"
if [ -n "$FILTRADA" ]; then
  if [ "$(printf %s "$ACTUAL" | sha256sum)" = "$(printf %s "$FILTRADA" | sha256sum)" ]; then
    echo "   coincide con la publicada en el historial: HAY QUE ROTARLA"
  else
    echo "   NO coincide con la publicada: parece que ya se rotó"
    echo "   si igual quieres rotarla, borra esta comprobación a mano"
    exit 0
  fi
fi

if [ "$APLICAR" != "1" ]; then
  paso "ensayo: esto es lo que haría"
  echo "   1. generar una clave nueva de 32 caracteres (openssl rand -hex 16)"
  echo "   2. ALTER USER postgres dentro del pod de la base"
  echo "   3. actualizar POSTGRES_PASSWORD y DATABASE_URL del Secret, en sincronía"
  echo "   4. reiniciar: ${SERVICIOS[*]}"
  echo "   5. comprobar el /health/ de cada servicio, que toca la base"
  echo
  echo "   para hacerlo de verdad: $0 --aplicar"
  exit 0
fi

NUEVA="$(openssl rand -hex 16)"   # hex: sin comillas ni escapes que romper en el SQL

paso "1/4 · cambiando la clave dentro de Postgres"
# Va por stdin y no como argumento: así no queda en la lista de procesos del
# pod ni en el historial del shell.
printf "ALTER USER postgres WITH PASSWORD '%s';\n" "$NUEVA" \
  | kubectl exec -i statefulset/postgres -- psql -U postgres -d suscripciones -q \
  || mal "el ALTER USER falló; no se tocó el Secret, el sistema sigue como estaba"
echo "   hecho"

paso "2/4 · actualizando el Secret"
# Los dos campos juntos en un solo patch: si quedaran desincronizados, los
# servicios no podrían conectar y el arreglo sería a mano.
kubectl patch secret ojoalgasto --type=merge -p "$(python -c "
import json,sys
clave = sys.argv[1]
print(json.dumps({'stringData': {
    'POSTGRES_PASSWORD': clave,
    'DATABASE_URL': f'postgres://postgres:{clave}@postgres:5432/suscripciones',
}}))
" "$NUEVA")" >/dev/null
echo "   POSTGRES_PASSWORD y DATABASE_URL al día"

paso "3/4 · reiniciando los servicios que conectan a la base"
for s in "${SERVICIOS[@]}"; do
  deseadas="$(kubectl get "deployment/$s" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  if [ "${deseadas:-0}" = "0" ]; then
    echo "   $s: en 0 réplicas, se omite"
    continue
  fi
  kubectl rollout restart "deployment/$s" >/dev/null
done
for s in "${SERVICIOS[@]}"; do
  deseadas="$(kubectl get "deployment/$s" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  [ "${deseadas:-0}" = "0" ] && continue
  kubectl rollout status "deployment/$s" --timeout=180s
done

paso "4/4 · comprobando que cada servicio llega a su esquema"
for s in auth subscriptions; do
  printf "   %-16s " "$s"
  if kubectl exec "deployment/$s" -- python -c "
import urllib.request, json, sys
try:
    r = json.load(urllib.request.urlopen('http://localhost:800' + ('1' if '$s'=='auth' else '2') + '/health/', timeout=5))
    print(r.get('estado'), '· esquema', r.get('esquema'))
except Exception as e:
    print('FALLA:', e); sys.exit(1)
" 2>/dev/null; then :; else echo "no responde"; fi
done

echo
echo "Listo. La clave publicada ya no sirve."
echo "Sigue en el historial del repo, pero no abre nada."
