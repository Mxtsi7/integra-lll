#!/usr/bin/env bash
# Compara el mismo trabajo hecho con cola y sin cola.
#
#     NS_CARGA=student-carga TOKEN_SIN=<access_token> TOKEN_CON=<access_token> ./k8s/pruebas/comparar-cola.sh
#
# Qué compara exactamente
#   Crear una suscripción dispara trabajo derivado: recalcular el resumen de
#   gasto de la organización. Ese trabajo es IDÉNTICO en los dos modos; lo
#   único que cambia es quién lo espera.
#
#     EVENTOS_ASINCRONOS=0  se hace dentro del POST. El usuario espera.
#     EVENTOS_ASINCRONOS=1  se publica en RabbitMQ y el POST responde al tiro;
#                           lo hace el consumidor, detrás de la cola.
#
# Por qué una organización distinta en cada corrida
#   Cada POST agrega una suscripción, y el recálculo cuesta más mientras más
#   suscripciones tiene la organización. Si las dos corridas compartieran
#   organización, la segunda partiría con todo lo que creó la primera y los
#   números no se podrían comparar. Usar dos cuentas de prueba de organizaciones
#   distintas y vacías, con sesiones vigentes durante ambas corridas.
#
# Qué esperar
#   Con cola, la latencia del POST baja y se mantiene plana, porque el POST
#   deja de hacer el trabajo. El trabajo no desaparece: se ve como mensajes
#   acumulados en la cola, que el consumidor drena a ritmo parejo. Eso es el
#   punto: la ráfaga deja de ser latencia del usuario y pasa a ser
#   profundidad de cola.
#
# Incluye el coste del gateway: es la entrada confiable (ADR-004).
# Una cola no amortigua ese proxy síncrono; considerar su techo al elegir QPS.
set -euo pipefail

DURACION="${DURACION:-30s}"
CONEXIONES="${CONEXIONES:-8}"
QPS="${QPS:-60}"
SEMILLA="${SEMILLA:-500}"   # suscripciones precargadas por organización
: "${TOKEN_SIN:?Iniciar sesión con la primera cuenta de prueba y definir TOKEN_SIN}"
: "${TOKEN_CON:?Iniciar sesión con otra organización y definir TOKEN_CON}"
for token in "$TOKEN_SIN" "$TOKEN_CON"; do
  [[ "$token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || {
    echo "Token de acceso inválido" >&2; exit 1;
  }
done

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
: "${NS_CARGA:?Definir NS_CARGA=student-carga (namespace externo autorizado en 40-red.yaml)}"
NS_APP="$(kubectl config view --minify --output 'jsonpath={..namespace}')"
NS_APP="${NS_APP:-default}"
for ns in "$NS_APP" "$NS_CARGA"; do
  [[ ${#ns} -le 63 && "$ns" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || {
    echo "Namespace inválido" >&2; exit 1;
  }
done
[ "$NS_CARGA" != "$NS_APP" ] || {
  echo "El comparador requiere un namespace de carga distinto al de la aplicación (presupuesto HPA)." >&2
  exit 1
}
# Solo el generador y su Secret viven fuera. API, logs y outbox siguen en el
# namespace del contexto actual. Nunca copiar los Secrets de la aplicación.
kubectl_carga() { command kubectl -n "$NS_CARGA" "$@"; }

# Cuánto se espera a que se drene el trabajo entre corridas. Configurable para
# que el arnés (probar-comparar-cola.sh) no tenga que esperar de verdad.
DRENAR_INTENTOS="${DRENAR_INTENTOS:-60}"
DRENAR_PAUSA="${DRENAR_PAUSA:-2}"
RABBIT="${RABBIT:-deployment/rabbitmq}"

# ── Solo se toca UN contenedor: el de la API, por nombre ─────────────────────
# Lo único que lee EVENTOS_ASINCRONOS es el POST (events/modo.py). El
# consumidor decide por la evidencia del evento, no por la bandera, así que el
# pod del worker NO se toca: ni el contenedor `worker` ni `consumidor-eventos`.
#
# Y en la API se cambia el contenedor `subscriptions` con `--containers`
# explícito. Sin eso, `kubectl set env` usa el comodín `*` y escribe la
# variable en TODOS los contenedores del pod (incluido el initContainer
# `migrar`), mientras que leer `containers[0]` guardaba uno solo: al restaurar
# se copiaba el valor de un contenedor sobre los demás. Lo reprodujo la
# revisión de la PR con el worker y el consumidor.
#
# Se guarda "presente=<valor>" o "ausente" (no es lo mismo que vacía) y se
# restaura exactamente eso: el valor, o la ausencia (`VAR-`).
DEPLOYMENT_API=subscriptions
CONTENEDOR_API=subscriptions

leer_bandera() {  # $1 = deployment, $2 = contenedor
  local valor
  valor="$(kubectl get "deployment/$1" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$2\")].env[?(@.name==\"EVENTOS_ASINCRONOS\")]}{\"presente=\"}{.value}{end}" 2>/dev/null || true)"
  if [ -n "$valor" ]; then printf '%s' "$valor"; else printf 'ausente'; fi
}

poner_bandera() {  # $1 = deployment, $2 = contenedor, $3 = "presente=<valor>" o "ausente"
  if [ "$3" = "ausente" ]; then
    kubectl set env "deployment/$1" --containers="$2" EVENTOS_ASINCRONOS- >/dev/null
  else
    kubectl set env "deployment/$1" --containers="$2" "EVENTOS_ASINCRONOS=${3#presente=}" >/dev/null
  fi
}

ORIGINAL_API="$(leer_bandera "$DEPLOYMENT_API" "$CONTENEDOR_API")"

# ── Restaurar lo que se tocó, y COMPROBAR el rollout de la restauración ──────
# Corre en el trap EXIT, o sea también si la comparación se interrumpe a la
# mitad. Ningún comando de acá puede fallar "suelto": con `set -e`, un fallo
# dentro del trap corta la restauración a medias y además decide el código
# de salida (ya pasó en rotar-clave-postgres.sh). Por eso cada paso acumula
# en `fallas` y al final se decide explícitamente con qué código salir.
RESTAURADO=0
restaurar() {
  local codigo=$?
  [ "$RESTAURADO" = "1" ] && exit "$codigo"
  RESTAURADO=1
  echo
  echo "── restaurando la bandera en el contenedor de la API ──"
  local fallas=0
  poner_bandera "$DEPLOYMENT_API" "$CONTENEDOR_API" "$ORIGINAL_API" || fallas=$((fallas + 1))
  if ! kubectl rollout status "deployment/$DEPLOYMENT_API" --timeout=180s >/dev/null; then
    echo "   AVISO: el rollout de $DEPLOYMENT_API tras restaurar no terminó"
    fallas=$((fallas + 1))
  fi
  kubectl_carga delete job carga-comparar --ignore-not-found >/dev/null 2>&1 || fallas=$((fallas + 1))
  kubectl_carga delete secret carga-comparar-token --ignore-not-found >/dev/null 2>&1 || fallas=$((fallas + 1))
  if [ "$fallas" -gt 0 ]; then
    echo "   LA RESTAURACIÓN NO SE PUDO VERIFICAR ($fallas problema(s)). Revísala a mano:"
    echo "   kubectl get deployment $DEPLOYMENT_API -o yaml | grep -B1 -A1 EVENTOS_ASINCRONOS"
    exit 1
  fi
  echo "   $DEPLOYMENT_API/$CONTENEDOR_API: $ORIGINAL_API (rollout comprobado); el pod del worker no se tocó"
  exit "$codigo"
}
trap restaurar EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

sembrar() {
  local org="$1"
  kubectl exec deployment/subscriptions -c subscriptions -- python manage.py shell -c "
from datetime import date
from decimal import Decimal
from app.models import Subscription
assert not Subscription.objects.filter(organizacion_id='$org').exists(), 'Usar una organización de prueba vacía'
Subscription.objects.bulk_create([
    Subscription(organizacion_id='$org', nombre=f'Semilla {i}', monto=Decimal('1000'),
                 moneda='CLP', frecuencia='mensual', fecha_proximo_cobro=date(2026,11,1),
                 categoria='streaming', estado='activo')
    for i in range($SEMILLA)
])
print('sembradas', Subscription.objects.filter(organizacion_id='$org').count())
"
}

# ── Esperar a que no quede trabajo pendiente ─────────────────────────────────
# Sin esto, la segunda corrida arrancaba con la cola y el outbox de la primera
# todavía drenándose, así que medía su carga MÁS la cola de la anterior. Los
# números no eran de corridas aisladas. Lo encontró la revisión de la PR #106.
drenar() {
  local limite="$DRENAR_INTENTOS" i=0
  printf "── esperando a que se drene el outbox y la cola "
  while [ "$i" -lt "$limite" ]; do
    local pendientes cola
    pendientes="$(kubectl exec "deployment/$DEPLOYMENT_API" -c "$CONTENEDOR_API" -- \
      python manage.py shell -c \
      "from app.models import OutboxEvento; print(OutboxEvento.objects.filter(publicado_en__isnull=True).count())" \
      2>/dev/null | tr -d '\r\n' || echo "?")"
    cola="$(kubectl exec "$RABBIT" -- \
      rabbitmqctl list_queues name messages --quiet 2>/dev/null \
      | awk '$1=="subscriptions.resumen"{print $2}' || echo "?")"
    # Ausencia de la cola o fallo de consulta no acreditan un cero.
    if [[ "$pendientes" =~ ^[0-9]+$ && "$cola" =~ ^[0-9]+$ ]] \
       && [ "$pendientes" = "0" ] && [ "$cola" = "0" ]; then
      echo " listo (outbox 0, cola 0)"
      return 0
    fi
    printf "."
    sleep "$DRENAR_PAUSA"
    i=$((i + 1))
  done
  echo
  echo "   no se drenó en $((limite * DRENAR_PAUSA))s (outbox=$pendientes cola=$cola)."
  return 1
}

# Cuenta cuantas veces se recalculo el resumen, para comprobar que los dos
# modos hicieron la MISMA cantidad de trabajo. Si no calzan, la comparacion
# no mide arquitectura: mide dos cargas distintas.
contar_recalculos() {
  local desde="$1"
  local api cons
  api="$(kubectl logs deployment/subscriptions --since-time="$desde" --all-containers 2>/dev/null     | grep -c "resumen.recalculado" || true)"
  cons="$(kubectl logs deployment/subscriptions-worker --since-time="$desde" --all-containers 2>/dev/null     | grep -c "resumen.recalculado" || true)"
  echo "$(( ${api:-0} + ${cons:-0} ))"
}

correr() {
  local modo="$1" etiqueta="$2" org="$3" token="$4" salida

  echo
  echo "═══ $etiqueta (EVENTOS_ASINCRONOS=$modo) ═══"
  # Solo el contenedor de la API. El consumidor (pod del worker) no mira la
  # bandera: con evidencia por evento, en modo 0 encuentra la de la API y
  # omite, y en modo 1 no la encuentra y recalcula. No hay que tocarlo.
  poner_bandera "$DEPLOYMENT_API" "$CONTENEDOR_API" "presente=$modo"
  kubectl rollout status "deployment/$DEPLOYMENT_API" --timeout=180s

  # Desde aca se cuentan los recalculos de ESTA corrida. Con --since-time, asi
  # que tiene que ser UTC en el formato que acepta kubectl.
  local DESDE
  DESDE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  echo "── sembrando $SEMILLA suscripciones ──"
  sembrar "$org"

  kubectl_carga delete job carga-comparar --ignore-not-found >/dev/null
  # No guardar tokens en manifiestos, argumentos de kubectl ni logs.
  kubectl_carga delete secret carga-comparar-token --ignore-not-found >/dev/null
  printf '{"apiVersion":"v1","kind":"Secret","metadata":{"name":"carga-comparar-token"},"type":"Opaque","stringData":{"token":"%s"}}' \
    "$token" | kubectl_carga create -f - >/dev/null
  sed -e "s|DURACION|$DURACION|g" \
      -e "s|CONEXIONES|$CONEXIONES|g" -e "s|CANTIDAD_QPS|$QPS|g" \
      -e "s|gateway.student-forellana.svc.cluster.local|gateway.$NS_APP.svc.cluster.local|g" \
      "$RAIZ/k8s/pruebas/carga-comparar.yaml" | kubectl_carga apply -f - >/dev/null

  echo "── cargando $DURACION ──"
  kubectl_carga wait --for=condition=complete job/carga-comparar --timeout=300s >/dev/null
  salida="$(kubectl_carga logs job/carga-comparar)"
  # Fortio puede terminar con éxito aun si todas las respuestas son 401/403.
  if ! printf '%s\n' "$salida" | grep -Eq '^Code 201 : [1-9][0-9]*' \
     || printf '%s\n' "$salida" | grep -E '^Code ' | grep -Evq '^Code 201 :'; then
    echo "COMPARACION INVALIDA: se esperaban solo creaciones HTTP 201 (revisar sesión, cuota y permisos)." >&2
    exit 1
  fi
  printf '%s\n' "$salida" | grep -E "^(Code |All errors|Sockets used)|target .* avg|percentile|Aggregated" || true
  kubectl_carga delete job carga-comparar --ignore-not-found >/dev/null

  # El trabajo derivado del modo asincrono ocurre DESPUES de que la carga
  # termino, asi que hay que esperarlo antes de contar y antes de la corrida
  # siguiente.
  #
  # Si NO se drena, se aborta. La version anterior seguia con `|| true`, y la
  # corrida siguiente arrancaba con la cola de esta todavia drenandose: los
  # numeros parecian de corridas aisladas y no lo eran. Lo encontro la
  # revision de la PR. Una comparacion contaminada no sirve para nada, asi
  # que mejor decirlo y parar (el trap restaura las banderas igual).
  drenar || {
    echo
    echo "COMPARACION INVALIDA: el trabajo de '$etiqueta' no se dreno."
    echo "No se sigue como si las corridas estuvieran aisladas. Revisa el"
    echo "consumidor y el despachador del outbox, y vuelve a correr."
    exit 1
  }
  echo "── recalculos del resumen en esta corrida: $(contar_recalculos "$DESDE") ──"
  echo "   (tienen que ser ~iguales en los dos modos; si no, no se comparo lo mismo)"
}

echo "Comparación con y sin cola · $DURACION · $CONEXIONES conexiones · $QPS qps"
echo "Semilla por organización: $SEMILLA suscripciones"
echo "Aplicación: $NS_APP; generador y Secret temporal: $NS_CARGA (cuota independiente)"

organizacion_del_token() {
  local org
  # Validar firma y sesión con la misma lógica del gateway.
  org="$(printf '%s' "$1" | kubectl exec -i deployment/gateway -c gateway -- \
    python manage.py shell -c 'import sys; from app.identidad import validar; print(validar(sys.stdin.read().strip())["organizacion_id"])' | tail -1 | tr -d '\r')"
  [[ "$org" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
    echo "La sesión no identifica una organización válida" >&2; return 1;
  }
  printf '%s' "$org"
}

ORG_SIN="$(organizacion_del_token "$TOKEN_SIN")"
ORG_CON="$(organizacion_del_token "$TOKEN_CON")"
[ "$ORG_SIN" != "$ORG_CON" ] || { echo "Usar dos organizaciones distintas" >&2; exit 1; }

correr 0 "SIN cola: el POST hace el trabajo" "$ORG_SIN" "$TOKEN_SIN"
correr 1 "CON cola: el POST solo publica"    "$ORG_CON" "$TOKEN_CON"

echo
echo "═══ la cola después de la corrida asíncrona ═══"
kubectl exec "$RABBIT" -- rabbitmqctl list_queues name messages consumers 2>/dev/null || true
echo
echo "Si 'messages' bajó a 0, el consumidor ya drenó la ráfaga."
echo "Resúmenes calculados:"
kubectl exec deployment/subscriptions -c subscriptions -- python manage.py shell -c "
from app.models import ResumenOrganizacion
for r in ResumenOrganizacion.objects.filter(organizacion_id__in=['$ORG_SIN','$ORG_CON']):
    print(' ', r.organizacion_id, r.total_mensual, 'en', r.cantidad_activas, 'activas')
"
