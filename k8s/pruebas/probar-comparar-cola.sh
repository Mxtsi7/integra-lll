#!/usr/bin/env bash
# Prueba k8s/pruebas/comparar-cola.sh con un kubectl DOBLE.
#
#     bash k8s/pruebas/probar-comparar-cola.sh
#
# Nunca toca un cluster. Existe porque ese script cambia la configuracion de
# un deployment de produccion y tiene que dejarla EXACTAMENTE como estaba,
# pase lo que pase: salida normal, drenaje que no termina, carga interrumpida.
#
# ── El doble tiene ESTADO, por CONTENEDOR ────────────────────────────────────
# Un deployment tiene varios contenedores y `kubectl set env` sin
# `--containers` escribe en TODOS (el comodin `*` es el valor por omision):
# asi se perdia la configuracion del consumidor al restaurar la del worker.
# Lo reprodujo la revision de la PR, y por eso el doble modela cada
# contenedor por separado y respeta `--containers`:
#
#   $ESTADO/env.subscriptions.migrar                   (initContainer de la API)
#   $ESTADO/env.subscriptions.subscriptions            la API: el UNICO que debe cambiar
#   $ESTADO/env.subscriptions-worker.worker
#   $ESTADO/env.subscriptions-worker.consumidor-eventos
#   $ESTADO/rollouts                                   cuantos `rollout status` se pidieron
#
# Cada archivo guarda "ausente" o el valor ("0", "1").
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

# Los contenedores de cada deployment, como en k8s/11-subscriptions.yaml
# (incluido el initContainer de la API: set env tambien lo toca).
contenedores_de() {
  case "$1" in
    subscriptions)        echo "migrar subscriptions" ;;
    subscriptions-worker) echo "worker consumidor-eventos" ;;
    *)                    echo "" ;;
  esac
}

case "$1" in
  get)
      # get deployment/<d> -o jsonpath=...containers[?(@.name=="X")]...
      d="${2#deployment/}"
      c="$(printf '%s' "$todo" | sed -n 's/.*containers\[?(@\.name=="\([^"]*\)")\].*/\1/p')"
      if [ -z "$c" ]; then
        # containers[0]: el primero del pod. En la API es `migrar`, que es
        # justamente la trampa que la revision encontro.
        c="$(contenedores_de "$d" | cut -d' ' -f1)"
      fi
      v="$(cat "$ESTADO/env.$d.$c" 2>/dev/null || echo ausente)"
      [ "$v" = "ausente" ] || printf 'presente=%s' "$v"
      exit 0 ;;
  set)
      # set env deployment/<d> [--containers=X] VAR=valor | VAR-
      d="${3#deployment/}"
      objetivo="*"; spec=""
      for a in "${@:4}"; do
        case "$a" in
          --containers=*) objetivo="${a#--containers=}" ;;
          *) spec="$a" ;;
        esac
      done
      if [ "$objetivo" = "*" ]; then lista="$(contenedores_de "$d")"; else lista="$objetivo"; fi
      for c in $lista; do
        case "$spec" in
          *-)  echo ausente > "$ESTADO/env.$d.$c" ;;
          *=*) echo "${spec#*=}" > "$ESTADO/env.$d.$c" ;;
        esac
      done
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
      case "$2" in
        deployment/subscriptions|deployment/rabbitmq) ;;
        *) echo "Error from server (NotFound): recurso $2 inexistente" >&2; exit 1 ;;
      esac
      case "$todo" in
        *bulk_create*)         echo "sembradas 500"; exit 0 ;;
        *OutboxEvento*)        echo "${OUTBOX_PENDIENTES:-0}"; exit 0 ;;
        *"--quiet"*)
          [ "$FALLA_RABBIT" = "0" ] || exit 1
          [ "$COLA_AUSENTE" = "1" ] || echo "subscriptions.resumen ${COLA_MENSAJES:-0}"
          exit 0 ;;
        *rabbitmqctl*)         echo "name messages consumers"; exit 0 ;;
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

reiniciar_estado() {  # $1 = API, $2 = worker, $3 = consumidor-eventos, $4 = migrar (opcional)
  echo "$1" > "$ESTADO/env.subscriptions.subscriptions"
  echo "$2" > "$ESTADO/env.subscriptions-worker.worker"
  echo "$3" > "$ESTADO/env.subscriptions-worker.consumidor-eventos"
  echo "${4:-ausente}" > "$ESTADO/env.subscriptions.migrar"
  rm -f "$ESTADO/rollouts"
  : > "$REGISTRO"
  export OUTBOX_PENDIENTES=0 COLA_MENSAJES=0 FALLA_CARGA=0 ROLLOUT_FALLA_DESDE=""
  export FALLA_RABBIT=0 COLA_AUSENTE=0
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
api()        { cat "$ESTADO/env.subscriptions.subscriptions"; }
migrar()     { cat "$ESTADO/env.subscriptions.migrar"; }
worker()     { cat "$ESTADO/env.subscriptions-worker.worker"; }
consumidor() { cat "$ESTADO/env.subscriptions-worker.consumidor-eventos"; }
rollouts()   { cat "$ESTADO/rollouts" 2>/dev/null || echo 0; }
dice()       { grep -q "$1" "$BASE/salida.txt"; }
toco_el_worker() { grep -q "deployment/subscriptions-worker" "$REGISTRO" && ! grep -q "logs deployment/subscriptions-worker" <(grep "deployment/subscriptions-worker" "$REGISTRO" | grep -v "^logs "); }
comandos_sobre_el_worker() { grep -E "^(set env|rollout) .*deployment/subscriptions-worker" "$REGISTRO" | wc -l | tr -d ' '; }
set_env_sin_contenedor() { grep -E "^set env" "$REGISTRO" | grep -vc -- "--containers=subscriptions" | tr -d ' '; }

# La reproduccion de la revision: API=0; worker con la variable en 1;
# consumidor SIN override. Antes el script terminaba con worker=1 y
# consumidor=1 explicito, y salia con 0.
echo "=== 1. la reproduccion de la revision: worker=1, consumidor sin la variable ==="
reiniciar_estado 0 1 ausente
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "CON cola"; then v=1; else v=0; fi
juzgar "corrio las dos corridas" "$v"
juzgar "la API volvio a 0" "$(si "$(api)" = "0")"
juzgar "el worker sigue en 1" "$(si "$(worker)" = "1")"
juzgar "el consumidor sigue SIN la variable (no se le copio la del worker)" "$(si "$(consumidor)" = "ausente")"
juzgar "el initContainer migrar tampoco se toco" "$(si "$(migrar)" = "ausente")"
juzgar "ningun set env ni rollout fue al pod del worker" "$(si "$(comandos_sobre_el_worker)" = "0")"
juzgar "todos los set env llevan --containers=subscriptions" "$(si "$(set_env_sin_contenedor)" = "0")"
juzgar "rollouts solo de la API: 3 (corrida 0, corrida 1, restauracion)" "$(si "$(rollouts)" = "3")"
if dice "rollout comprobado"; then v=1; else v=0; fi
juzgar "lo dice en la salida" "$v"

echo
echo "=== 2. la inversa: API sin la variable, worker en 0, consumidor en 1 ==="
reiniciar_estado ausente 0 1
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "la API volvio a NO tener la variable" "$(si "$(api)" = "ausente")"
if grep -q "set env deployment/subscriptions --containers=subscriptions EVENTOS_ASINCRONOS-" "$REGISTRO"; then v=1; else v=0; fi
juzgar "la ausencia se restaura quitando la variable (VAR-), no poniendola vacia" "$v"
juzgar "el worker sigue en 0" "$(si "$(worker)" = "0")"
juzgar "el consumidor sigue en 1" "$(si "$(consumidor)" = "1")"

echo
echo "=== 3. valores distintos en todos, incluido migrar ==="
reiniciar_estado 1 0 ausente 1
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "la API volvio a 1" "$(si "$(api)" = "1")"
juzgar "migrar sigue en 1" "$(si "$(migrar)" = "1")"
juzgar "el worker sigue en 0 y el consumidor sin la variable" "$(si "$(worker)" = "0" -a "$(consumidor)" = "ausente")"

echo
echo "=== 4. el drenaje no termina: aborta, no compara corridas contaminadas ==="
reiniciar_estado 0 1 ausente
export OUTBOX_PENDIENTES=5
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "COMPARACION INVALIDA"; then v=1; else v=0; fi
juzgar "dice que la comparacion es invalida" "$v"
if dice "CON cola"; then v=0; else v=1; fi
juzgar "NO corre la segunda corrida" "$v"
juzgar "la API quedo restaurada igual" "$(si "$(api)" = "0")"
juzgar "el worker y el consumidor quedaron como estaban" "$(si "$(worker)" = "1" -a "$(consumidor)" = "ausente")"

echo
echo "=== 5. la carga se interrumpe a la mitad: restaura igual ==="
reiniciar_estado 0 1 ausente
export FALLA_CARGA=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la API volvio a 0" "$(si "$(api)" = "0")"
juzgar "el worker y el consumidor quedaron como estaban" "$(si "$(worker)" = "1" -a "$(consumidor)" = "ausente")"
juzgar "y se comprobo el rollout de la restauracion (1 de la corrida + 1)" "$(si "$(rollouts)" = "2")"

echo
echo "=== 6. el rollout de la restauracion falla: lo dice y sale mal ==="
reiniciar_estado 0 1 ausente
export ROLLOUT_FALLA_DESDE=3   # el 3.o rollout es el de la restauracion
codigo="$(correr)"
juzgar "sale distinto de 0 aunque la comparacion haya terminado" "$(si "$codigo" != "0")"
if dice "NO SE PUDO VERIFICAR"; then v=1; else v=0; fi
juzgar "avisa que la restauracion no se pudo verificar" "$v"
if dice "kubectl get deployment subscriptions -o yaml"; then v=1; else v=0; fi
juzgar "y dice como revisarla a mano" "$v"

echo
echo "=== 7. la cola tiene mensajes: aborta y restaura ==="
reiniciar_estado 0 1 ausente
export COLA_MENSAJES=5
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "COMPARACION INVALIDA"; then v=1; else v=0; fi
juzgar "no acredita drenaje con mensajes pendientes" "$v"
juzgar "la API vuelve al valor original" "$(si "$(api)" = "0")"

echo
echo "=== 8. la cola no aparece: no equivale a cero ==="
reiniciar_estado 1 0 ausente
export COLA_AUSENTE=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "COMPARACION INVALIDA"; then v=1; else v=0; fi
juzgar "no acredita drenaje sin evidencia de la cola" "$v"
if dice "CON cola"; then v=0; else v=1; fi
juzgar "no inicia la segunda corrida" "$v"
juzgar "la API vuelve al valor original" "$(si "$(api)" = "1")"

echo
echo "=== 9. rabbitmqctl falla: no equivale a cero ==="
reiniciar_estado 1 0 ausente
export FALLA_RABBIT=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "COMPARACION INVALIDA"; then v=1; else v=0; fi
juzgar "no acredita drenaje tras un error de consulta" "$v"
juzgar "la API vuelve al valor original" "$(si "$(api)" = "1")"

echo
echo "=== 10. conteos no numericos: no acreditan drenaje ==="
for origen in OUTBOX_PENDIENTES COLA_MENSAJES; do
  reiniciar_estado 1 0 ausente
  export "$origen=desconocido"
  codigo="$(correr)"
  juzgar "$origen invalido impide terminar con exito" "$(si "$codigo" != "0")"
  juzgar "se restaura la API tras $origen invalido" "$(si "$(api)" = "1")"
done

echo
echo "--------------------------------"
echo "  $ok bien, $mal mal"
[ "$mal" = "0" ] || exit 1
