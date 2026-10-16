#!/usr/bin/env bash
# Panel en vivo de la prueba de carga. Salir con Ctrl+C.
#
#     ./k8s/pruebas/ver-estres.sh          # ventana de 30 s (lo que dura un Fortio)
#     ./k8s/pruebas/ver-estres.sh 60       # ventana de 60 s
#
# Pensado para correrlo en UNA terminal mientras estresar.sh (o los compañeros)
# lanzan la carga desde OTRA.
#
# Cómo se lee:
#   · La pantalla se redibuja cada pocos segundos (cada vuelta son varias
#     llamadas a kubectl), pero los números se ACUMULAN durante una ventana de
#     30 s y recién ahí se reinician solos. Así el total de un ataque completo
#     queda a la vista en vez de parpadear.
#   · `r` o Enter reinician la ventana a mano (por ejemplo justo antes del "¡YA!").
#   · La ventana anterior queda resumida abajo, para compararla con la actual.
#
# Muestra, de arriba abajo:
#   · el Job de Fortio y en qué va
#   · el pod del gateway: si sigue listo, reinicios y si está en el Service
#   · peticiones que REALMENTE recibió en la ventana (sin los chequeos del kubelet)
#   · cuántos períodos de CPU le frenó su límite (lo más revelador)
#   · avisos recientes del namespace (probes fallando = la prueba se mata sola)
set -uo pipefail

VENTANA="${1:-30}"      # segundos que dura una ventana de acumulación
REFRESCO=2              # pausa entre redibujados (más lo que tarde kubectl)
NS_APP="student-forellana"

# MSYS_NO_PATHCONV evita que Git Bash convierta /sys/fs/cgroup/... en una ruta
# de Windows al pasarlo a kubectl. Sin esto el panel no puede leer el throttling.
export MSYS_NO_PATHCONV=1

ns_flag=""
[ "$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null || true)" = "$NS_APP" ] || ns_flag="-n $NS_APP"

INTERACTIVO=1; [ -t 0 ] || INTERACTIVO=0
# Ctrl+S congelaría la pantalla hasta Ctrl+Q; mejor que no pase en la demo.
[ "$INTERACTIVO" = 1 ] && stty -ixon 2>/dev/null

declare -A BASE_NR BASE_US          # throttling al inicio de la ventana, por pod
INICIO_EPOCH=0; INICIO_RFC=""       # cuándo empezó la ventana actual
ANTERIOR=""                         # resumen de la ventana anterior
ULT_CARGA=0; ULT_NR=0; ULT_US=0     # últimos totales, para armar el resumen

ahora_rfc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

reiniciar_ventana() {
  if [ "$INICIO_EPOCH" -gt 0 ]; then
    local dur=$(( $(date +%s) - INICIO_EPOCH )); [ "$dur" -lt 1 ] && dur=1
    ANTERIOR="$(printf '%s peticiones en %s s (%s/s) · %s períodos frenados · %s ms esperando' \
      "$ULT_CARGA" "$dur" "$(( ULT_CARGA / dur ))" "$ULT_NR" "$ULT_US")"
  fi
  INICIO_EPOCH="$(date +%s)"; INICIO_RFC="$(ahora_rfc)"
  BASE_NR=(); BASE_US=()
  ULT_CARGA=0; ULT_NR=0; ULT_US=0
}

limpiar() { printf '\033[2J\033[H'; }
trap 'printf "\n  listo.\n"; exit 0' INT TERM

reiniciar_ventana
sleep 1   # que la primera lectura tenga al menos un segundo de ventana

while true; do
  # Reinicio automático al cumplir la ventana (cada vuelta tarda varios
  # segundos por las llamadas a kubectl, así que puede pasarse un poco).
  if [ $(( $(date +%s) - INICIO_EPOCH )) -ge "$VENTANA" ]; then
    reiniciar_ventana
  fi
  limpiar
  AHORA="$(date +%H:%M:%S)"
  echo "  OJO AL GASTO · panel de carga                        $AHORA"
  echo "  ═══════════════════════════════════════════════════════════════"

  # ── Sistema: qué pods y services hay, con número ───────────────────
  PODS_ALL="$(kubectl get pods $ns_flag -o jsonpath='{range .items[*]}{.metadata.labels.app}{"\t"}{.status.phase}{"\t"}{.status.containerStatuses[0].ready}{"\n"}{end}' 2>/dev/null || true)"
  SVCS="$(kubectl get svc $ns_flag -o jsonpath='{range .items[*]}{.metadata.name}:{.spec.ports[0].port} {end}' 2>/dev/null || true)"
  N_PODS=$(printf '%s\n' "$PODS_ALL" | grep -c . || true)
  N_RUN=$(printf '%s\n' "$PODS_ALL" | grep -c $'\tRunning\ttrue' || true)
  N_SVC=$(printf '%s\n' "$SVCS" | wc -w | tr -d ' ')
  echo
  echo "  SISTEMA: ${N_PODS:-0} pods (${N_RUN:-0} listos) · ${N_SVC:-0} services"
  if [ -n "$PODS_ALL" ]; then
    printf '%s\n' "$PODS_ALL" | awk -F'\t' '{
      if ($2=="Running" && $3=="true") m="+"; else if ($2=="Succeeded") m="ok"; else m="! " $2;
      printf "%s[%s] ", $1, m } END { print "" }' | fold -s -w 72 | sed 's/^/    /'
  fi
  [ -n "$SVCS" ] && printf '%s\n' "services: $SVCS" | fold -s -w 72 | sed 's/^/    /'

  # ── Fortio ──────────────────────────────────────────────────────────
  echo
  echo "  GENERADOR DE CARGA (el mío; los de los compañeros no se ven aquí)"
  JOBS="$(kubectl get jobs $ns_flag -l app=carga-fortio --no-headers 2>/dev/null || true)"
  if [ -z "$JOBS" ]; then
    echo "    (ningún Job de carga corriendo en este namespace)"
  else
    # columnas: NAME STATUS COMPLETIONS DURATION AGE
    echo "$JOBS" | awk '{printf "    %-26s %-10s completados=%-5s duracion=%s\n", $1, $2, $3, $4}'
    POD_F="$(kubectl get pod $ns_flag -l app=carga-fortio -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null || true)"
    if [ -n "$POD_F" ]; then
      FASE="$(kubectl get pod $ns_flag "$POD_F" -o jsonpath='{.status.phase}' 2>/dev/null || echo '?')"
      echo "    pod: $POD_F  ($FASE)"
      kubectl logs $ns_flag "$POD_F" --tail=2 2>/dev/null \
        | grep -vE '^\s*$' | cut -c1-100 | sed 's/^/      /' || true
    fi
  fi

  # ── Gateway ─────────────────────────────────────────────────────────
  echo
  echo "  BLANCO: gateway"
  PODS_GW="$(kubectl get pods $ns_flag -l app=gateway -o jsonpath='{range .items[*]}{.metadata.name} {.status.containerStatuses[0].ready} {.status.containerStatuses[0].restartCount}{"\n"}{end}' 2>/dev/null || true)"
  if [ -z "$PODS_GW" ]; then
    echo "    (no encuentro pods del gateway)"
  else
    while read -r P LISTO REINIC; do
      [ -n "$P" ] || continue
      if [ "$LISTO" = "true" ]; then
        printf "    %-34s listo: SI   reinicios: %s\n" "$P" "$REINIC"
      else
        printf "    %-34s listo: NO  <-- fuera del Service, sin destino   reinicios: %s\n" "$P" "$REINIC"
      fi
    done <<< "$PODS_GW"
    BACKENDS="$(kubectl get endpoints $ns_flag gateway -o jsonpath='{range .subsets[*].addresses[*]}{.ip} {end}' 2>/dev/null || true)"
    echo "    backends que ve el Service: ${BACKENDS:-(ninguno)}"

    # ── Ventana: peticiones desde el inicio, sumando TODAS las réplicas ──
    TRANSC=$(( $(date +%s) - INICIO_EPOCH )); [ "$TRANSC" -lt 1 ] && TRANSC=1
    LOG="$(kubectl logs $ns_flag -l app=gateway --since-time="$INICIO_RFC" --tail=-1 2>/dev/null || true)"
    TOTAL=$(printf '%s\n' "$LOG" | grep -c 'HTTP/1.1' 2>/dev/null || true)
    SONDAS=$(printf '%s\n' "$LOG" | grep -c 'kube-probe' 2>/dev/null || true)
    NO200=$(printf '%s\n' "$LOG" | grep -cE 'HTTP/1.1" (4|5)[0-9][0-9]' 2>/dev/null || true)
    TOTAL=${TOTAL:-0}; SONDAS=${SONDAS:-0}; NO200=${NO200:-0}
    CARGA=$(( TOTAL - SONDAS )); [ "$CARGA" -lt 0 ] && CARGA=0
    ULT_CARGA=$CARGA

    # Barra de progreso de la ventana
    LLENO=$(( TRANSC * 30 / VENTANA )); [ "$LLENO" -gt 30 ] && LLENO=30
    BARRA="$(printf '%*s' "$LLENO" '' | tr ' ' '#')$(printf '%*s' $(( 30 - LLENO )) '' | tr ' ' '.')"
    echo
    printf "    VENTANA ACTUAL  [%s]  %2d s de %s" "$BARRA" "$TRANSC" "$VENTANA"
    [ "$INTERACTIVO" = 1 ] && printf "     (r o Enter: reiniciar)"
    echo
    printf "      peticiones de carga : %-7s (%s/s)\n" "$CARGA" "$(( CARGA / TRANSC ))"
    printf "      chequeos de salud   : %s\n" "$SONDAS"
    [ "$NO200" -gt 0 ] && printf "      respuestas 4xx/5xx  : %s  <-- OJO\n" "$NO200"

    # ── Throttling de CPU, acumulado desde el inicio de la ventana ────
    SUM_NR=0; SUM_US=0; HAY_STAT=0
    while read -r P _ _; do
      [ -n "$P" ] || continue
      STAT="$(kubectl exec $ns_flag "$P" -- cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true)"
      [ -n "$STAT" ] || continue
      HAY_STAT=1
      NR="$(printf '%s\n' "$STAT" | awk '/^nr_throttled/{print $2}')"
      US="$(printf '%s\n' "$STAT" | awk '/^throttled_usec/{print $2}')"
      if [ -z "${BASE_NR[$P]:-}" ]; then BASE_NR[$P]="$NR"; BASE_US[$P]="$US"; fi
      SUM_NR=$(( SUM_NR + NR - BASE_NR[$P] ))
      SUM_US=$(( SUM_US + (US - BASE_US[$P]) / 1000 ))
    done <<< "$PODS_GW"
    if [ "$HAY_STAT" = 1 ]; then
      ULT_NR=$SUM_NR; ULT_US=$SUM_US
      printf "      períodos frenados   : %-7s tiempo esperando por el límite: %s ms\n" "$SUM_NR" "$SUM_US"
      if [ "$SUM_NR" -gt 0 ]; then
        echo "      -> lo está topando el límite de CPU (200m), no el código"
      else
        echo "      -> sin frenos: el gateway va holgado"
      fi
    fi

    echo
    if [ -n "$ANTERIOR" ]; then
      echo "    VENTANA ANTERIOR: $ANTERIOR"
    else
      echo "    VENTANA ANTERIOR: (todavía ninguna)"
    fi
    echo "    referencia: 1 réplica satura en ~45/s; 2 réplicas, ~88/s"
  fi

  # ── Avisos ──────────────────────────────────────────────────────────
  echo
  echo "  AVISOS RECIENTES"
  EV="$(kubectl get events $ns_flag --field-selector type=Warning --sort-by=.lastTimestamp 2>/dev/null \
        | tail -3 | grep -vE '^LAST SEEN' || true)"
  if [ -z "$EV" ]; then
    echo "    (ninguno)"
  else
    printf '%s\n' "$EV" | cut -c1-110 | sed 's/^/    /'
  fi

  echo
  echo "  ═══════════════════════════════════════════════════════════════"
  echo "  Ctrl+C para salir · la ventana se reinicia sola cada ${VENTANA} s"

  # ── Esperar; r o Enter reinician la ventana a mano ─────────────────
  if [ "$INTERACTIVO" = 1 ]; then
    if read -r -s -t "$REFRESCO" -n 1 TECLA; then
      case "$TECLA" in r|R|"") reiniciar_ventana ;; esac
    fi
  else
    sleep "$REFRESCO"
  fi
done
