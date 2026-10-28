#!/usr/bin/env bash
# Compara el mismo trabajo hecho con cola y sin cola.
#
#     ./k8s/pruebas/comparar-cola.sh
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
#   números no se podrían comparar. Por eso cada modo usa un UUID nuevo y se
#   siembra la misma cantidad de filas en los dos.
#
# Qué esperar
#   Con cola, la latencia del POST baja y se mantiene plana, porque el POST
#   deja de hacer el trabajo. El trabajo no desaparece: se ve como mensajes
#   acumulados en la cola, que el consumidor drena a ritmo parejo. Eso es el
#   punto: la ráfaga deja de ser latencia del usuario y pasa a ser
#   profundidad de cola.
#
# Ojo: NO mide el gateway. Le pega directo al Service de subscriptions, porque
# el gateway es un proxy síncrono y una cola no puede amortiguarlo (ADR-003).
set -euo pipefail

DURACION="${DURACION:-30s}"
CONEXIONES="${CONEXIONES:-8}"
QPS="${QPS:-60}"
SEMILLA="${SEMILLA:-500}"   # suscripciones precargadas por organización

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
ORIGINAL="$(kubectl get deployment/subscriptions \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="EVENTOS_ASINCRONOS")].value}' 2>/dev/null || true)"

restaurar() {
  echo
  echo "── restaurando la bandera ──"
  if [ -n "$ORIGINAL" ]; then
    kubectl set env deployment/subscriptions "EVENTOS_ASINCRONOS=$ORIGINAL" >/dev/null
  else
    kubectl set env deployment/subscriptions EVENTOS_ASINCRONOS- >/dev/null
  fi
  kubectl delete job carga-comparar --ignore-not-found >/dev/null 2>&1 || true
}
trap restaurar EXIT

sembrar() {
  local org="$1"
  kubectl exec deployment/subscriptions -c subscriptions -- python manage.py shell -c "
from datetime import date
from decimal import Decimal
from app.models import Subscription
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
  local limite=120 i=0
  printf "── esperando a que se drene el outbox y la cola "
  while [ "$i" -lt "$limite" ]; do
    local pendientes cola
    pendientes="$(kubectl exec deployment/subscriptions --       python manage.py shell -c       "from app.models import OutboxEvento; print(OutboxEvento.objects.filter(publicado_en__isnull=True).count())"       2>/dev/null | tr -d '
' || echo "?")"
    cola="$(kubectl exec statefulset/rabbitmq --       rabbitmqctl list_queues name messages --quiet 2>/dev/null       | awk '$1=="subscriptions.resumen"{print $2}' || echo "?")"
    if [ "$pendientes" = "0" ] && [ "${cola:-0}" = "0" ]; then
      echo " listo (outbox 0, cola 0)"
      return 0
    fi
    printf "."
    sleep 2
    i=$((i + 1))
  done
  echo
  echo "   AVISO: no se drenó en $((limite * 2))s (outbox=$pendientes cola=$cola)."
  echo "   Los numeros de la corrida siguiente pueden estar contaminados."
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
  local modo="$1" etiqueta="$2" org="$3"

  echo
  echo "═══ $etiqueta (EVENTOS_ASINCRONOS=$modo) ═══"
  kubectl set env deployment/subscriptions "EVENTOS_ASINCRONOS=$modo" >/dev/null
  # El consumidor vive en el pod del worker y tambien mira la bandera: hay que
  # cambiarsela a los dos o el modo 0 seguiria recalculando por partida doble.
  kubectl set env deployment/subscriptions-worker "EVENTOS_ASINCRONOS=$modo" >/dev/null
  kubectl rollout status deployment/subscriptions --timeout=180s
  kubectl rollout status deployment/subscriptions-worker --timeout=180s

  # Desde aca se cuentan los recalculos de ESTA corrida. Con --since-time, asi
  # que tiene que ser UTC en el formato que acepta kubectl.
  local DESDE
  DESDE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  echo "── sembrando $SEMILLA suscripciones ──"
  sembrar "$org"

  kubectl delete job carga-comparar --ignore-not-found >/dev/null 2>&1 || true
  sed -e "s|ORGANIZACION|$org|g" -e "s|DURACION|$DURACION|g" \
      -e "s|CONEXIONES|$CONEXIONES|g" -e "s|CANTIDAD_QPS|$QPS|g" \
      "$RAIZ/k8s/pruebas/carga-comparar.yaml" | kubectl apply -f - >/dev/null

  echo "── cargando $DURACION ──"
  kubectl wait --for=condition=complete job/carga-comparar --timeout=300s >/dev/null
  kubectl logs job/carga-comparar | grep -E "^(Code |All errors|Sockets used)|target .* avg|percentile|Aggregated" || true
  kubectl delete job carga-comparar --ignore-not-found >/dev/null 2>&1 || true

  # El trabajo derivado del modo asincrono ocurre DESPUES de que la carga
  # termino, asi que hay que esperarlo antes de contar y antes de la corrida
  # siguiente.
  drenar || true
  echo "── recalculos del resumen en esta corrida: $(contar_recalculos "$DESDE") ──"
  echo "   (tienen que ser ~iguales en los dos modos; si no, no se comparo lo mismo)"
}

echo "Comparación con y sin cola · $DURACION · $CONEXIONES conexiones · $QPS qps"
echo "Semilla por organización: $SEMILLA suscripciones"

# Git Bash en Windows no tiene /proc ni uuidgen; openssl si (lo usa
# desplegar.sh). Arma un UUID v4 valido a partir de 16 bytes al azar.
uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
    return
  fi
  # Git Bash en Windows no tiene /proc ni uuidgen; openssl si (lo usa
  # desplegar.sh). Se arma el UUID v4 con expansion de parametros y printf,
  # NO con sed: la version anterior llevaba bytes de control 0x01..0x05
  # incrustados donde debian ir las referencias .., y devolvia basura
  # que no era un UUID. `bash -n` no lo detecta: la sintaxis era valida.
  local h
  h=$(openssl rand -hex 16) || return 1
  local salida
  salida=$(printf '%s-%s-4%s-a%s-%s' \
    "${h:0:8}" "${h:8:4}" "${h:13:3}" "${h:17:3}" "${h:20:12}")
  # Se comprueba antes de devolverlo: sembrar la base con un id invalido
  # rompe la comparacion mucho mas lejos y cuesta encontrar por que.
  case "$salida" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-a[0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      printf '%s
' "$salida" ;;
    *)
      echo "uuid(): no se pudo generar un UUID valido ('$salida')" >&2
      return 1 ;;
  esac
}

ORG_SIN="$(uuid)"
ORG_CON="$(uuid)"

correr 0 "SIN cola: el POST hace el trabajo" "$ORG_SIN"
correr 1 "CON cola: el POST solo publica"    "$ORG_CON"

echo
echo "═══ la cola después de la corrida asíncrona ═══"
kubectl exec deployment/rabbitmq -- rabbitmqctl list_queues name messages consumers 2>/dev/null || true
echo
echo "Si 'messages' bajó a 0, el consumidor ya drenó la ráfaga."
echo "Resúmenes calculados:"
kubectl exec deployment/subscriptions -c subscriptions -- python manage.py shell -c "
from app.models import ResumenOrganizacion
for r in ResumenOrganizacion.objects.filter(organizacion_id__in=['$ORG_SIN','$ORG_CON']):
    print(' ', r.organizacion_id, r.total_mensual, 'en', r.cantidad_activas, 'activas')
"
