#!/usr/bin/env bash
# Prueba k8s/pruebas/comparar-cola.sh con un kubectl DOBLE.
#
#     bash k8s/pruebas/probar-comparar-cola.sh
#
# Nunca toca un cluster. Existe porque ese script cambia la configuracion de
# dos deployments de produccion y tiene que dejarlos EXACTAMENTE como estaban,
# pase lo que pase: salida normal, drenaje que no termina, carga interrumpida.
#
# ── El doble tiene ESTADO ────────────────────────────────────────────────────
#   $ESTADO/env.subscriptions          la bandera de la API    ("0", "1" o "ausente")
#   $ESTADO/env.subscriptions-worker   la bandera del worker
#   $ESTADO/rollouts                   cuantos `rollout status` se pidieron
#
# `set env` muta el estado y `get deployment` lo lee, como en la realidad. Asi
# se puede comprobar que al final cada deployment tiene SU valor original,
# incluida la ausencia de la variable.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUION="$AQUI/comparar-cola.sh"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
DOBLES="$BASE/bin"
ESTADO="$BASE/estado"
mkdir -p "$DOBLES" "$ESTADO"

export ESTADO
export REGISTRO="$BASE/argv.txt"

cat > "$DOBLES/kubectl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REGISTRO"
todo="$*"
case "$1" in
  get)
      # get deployment/<d> -o jsonpath=...  → "presente=<v>" o nada si ausente
      d="${2#deployment/}"
      v="$(cat "$ESTADO/env.$d" 2>/dev/null || echo ausente)"
      [ "$v" = "ausente" ] || printf 'presente=%s' "$v"
      exit 0 ;;
  set)
      # set env deployment/<d> VAR=valor | VAR-
      d="${3#deployment/}"
      case "$4" in
        *-)  echo ausente > "$ESTADO/env.$d" ;;
        *=*) echo "${4#*=}" > "$ESTADO/env.$d" ;;
      esac
      exit 0 ;;
  rollout)
      n=$(( $(cat "$ESTADO/rollouts" 2>/dev/null || echo 0) + 1 ))
      echo "$n" > "$ESTADO/rollouts"
      if [ -n "${ROLLOUT_FALLA_DESDE:-}" ] && [ "$n" -ge "$ROLLOUT_FALLA_DESDE" ]; then
        echo "error: deployment exceeded its progress deadline" >&2
        exit 1
      fi
      exit 0 ;;
  exec)
      case "$todo" in
        *bulk_create*)        echo "sembradas 500"; exit 0 ;;
        *OutboxEvento*)       echo "${OUTBOX_PENDIENTES:-0}"; exit 0 ;;
        *"--quiet"*)          echo "subscriptions.resumen ${COLA_MENSAJES:-0}"; exit 0 ;;
        *rabbitmqctl*)        echo "name messages consumers"; exit 0 ;;
        *ResumenOrganizacion*) echo "  org 1000 en 1 activas"; exit 0 ;;
      esac
      exit 0 ;;
  delete)  exit 0 ;;
  apply)   cat >/dev/null; exit 0 ;;
  wait)    exit "${FALLA_CARGA:-0}" ;;
  logs)
      case "$todo" in
        *job/carga-comparar*) echo "Code 201 : 1000"; exit 0 ;;
        *)  for _ in $(seq 1 "${RECALCULOS:-3}"); do echo "resumen.recalculado modo=x"; done; exit 0 ;;
      esac ;;
esac
exit 0
EOF
chmod +x "$DOBLES/kubectl"
export PATH="$DOBLES:$PATH"

# Sin esperas reales: el arnes no tiene por que dormir.
export DRENAR_INTENTOS=2 DRENAR_PAUSA=0 DURACION=1s

reiniciar_estado() {  # $1 = bandera original de la API, $2 = la del worker
  echo "$1" > "$ESTADO/env.subscriptions"
  echo "$2" > "$ESTADO/env.subscriptions-worker"
  rm -f "$ESTADO/rollouts"
  : > "$REGISTRO"
  export OUTBOX_PENDIENTES=0 COLA_MENSAJES=0 FALLA_CARGA=0 ROLLOUT_FALLA_DESDE=""
}

correr() {
  bash "$GUION" > "$BASE/salida.txt" 2>&1
  echo $?
}

ok=0; mal=0
juzgar() {
  if [ "$2" = "1" ]; then echo "  [ OK    ] $1"; ok=$((ok+1))
  else echo "  [ FALLA ] $1"; mal=$((mal+1)); fi
}
si() { if test "$@"; then echo 1; else echo 0; fi; }
api()     { cat "$ESTADO/env.subscriptions"; }
worker()  { cat "$ESTADO/env.subscriptions-worker"; }
rollouts() { cat "$ESTADO/rollouts" 2>/dev/null || echo 0; }
dice()    { grep -q "$1" "$BASE/salida.txt"; }

echo "=== 1. camino feliz: API en 0, worker sin la variable ==="
reiniciar_estado 0 ausente
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "CON cola"; then v=1; else v=0; fi
juzgar "corrio las dos corridas" "$v"
juzgar "la API volvio a 0" "$(si "$(api)" = "0")"
juzgar "el worker volvio a NO tener la variable" "$(si "$(worker)" = "ausente")"
if grep -q "set env deployment/subscriptions-worker EVENTOS_ASINCRONOS-" "$REGISTRO"; then v=1; else v=0; fi
juzgar "la ausencia se restaura quitando la variable (VAR-), no poniendola vacia" "$v"
juzgar "rollout comprobado en los dos tras restaurar: 6 en total (2+2+2)" "$(si "$(rollouts)" = "6")"
if dice "rollout comprobado"; then v=1; else v=0; fi
juzgar "lo dice en la salida" "$v"

echo
echo "=== 2. originales al reves: API sin la variable, worker en 1 ==="
reiniciar_estado ausente 1
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "la API volvio a NO tener la variable" "$(si "$(api)" = "ausente")"
juzgar "el worker volvio a 1" "$(si "$(worker)" = "1")"

echo
echo "=== 3. el drenaje no termina: aborta, no compara corridas contaminadas ==="
reiniciar_estado 0 0
export OUTBOX_PENDIENTES=5
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "COMPARACION INVALIDA"; then v=1; else v=0; fi
juzgar "dice que la comparacion es invalida" "$v"
if dice "CON cola"; then v=0; else v=1; fi
juzgar "NO corre la segunda corrida" "$v"
juzgar "la API quedo restaurada igual" "$(si "$(api)" = "0")"
juzgar "el worker quedo restaurado igual" "$(si "$(worker)" = "0")"

echo
echo "=== 4. la carga se interrumpe a la mitad: restaura los dos igual ==="
reiniciar_estado 0 ausente
export FALLA_CARGA=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la API volvio a 0" "$(si "$(api)" = "0")"
juzgar "el worker volvio a NO tener la variable" "$(si "$(worker)" = "ausente")"
juzgar "y se comprobo el rollout de la restauracion (2 de la corrida + 2)" "$(si "$(rollouts)" = "4")"

echo
echo "=== 5. el rollout de la restauracion falla: lo dice y sale mal ==="
reiniciar_estado 0 ausente
export ROLLOUT_FALLA_DESDE=5   # el 5.o rollout es el primero de la restauracion
codigo="$(correr)"
juzgar "sale distinto de 0 aunque la comparacion haya terminado" "$(si "$codigo" != "0")"
if dice "NO SE PUDO VERIFICAR"; then v=1; else v=0; fi
juzgar "avisa que la restauracion no se pudo verificar" "$v"
if dice "kubectl get deployment subscriptions subscriptions-worker"; then v=1; else v=0; fi
juzgar "y dice como revisarla a mano" "$v"

echo
echo "--------------------------------"
echo "  $ok bien, $mal mal"
[ "$mal" = "0" ] || exit 1
