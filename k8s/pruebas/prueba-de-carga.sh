#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════════════════╗
# ║  OJO AL GASTO · PRUEBA DE CARGA · un solo punto de entrada             ║
# ╚═══════════════════════════════════════════════════════════════════════╝
#
# ¿PARA QUÉ SIRVE?
#   Para mostrar en vivo cómo se comporta el sistema cuando le llegan muchas
#   peticiones a la vez, y señalar exactamente dónde está el límite.
#   No hay que acordarse de ningún comando: este menú los corre por ti y
#   explica qué hace cada uno.
#
# ¿CÓMO SE ABRE?
#   · Windows: doble clic en este archivo (se abre en Git Bash).
#   · Terminal (Git Bash, WSL, Linux):  ./k8s/pruebas/prueba-de-carga.sh
#   Si el cluster pide login, se abre el navegador: entra con tu cuenta UCT.
#   Tienes 3 minutos.
#
# ¿QUÉ HACE POR DEBAJO?
#   Llama a los dos scripts que viven en esta misma carpeta:
#     ver-estres.sh   panel en vivo del gateway (peticiones/s, CPU frenada, probes)
#     estresar.sh N   lanza un pod de Fortio DENTRO del cluster a N peticiones/s
#   y a los manifiestos diagnostico-busybox.yaml y los `kubectl scale` que
#   liberan o devuelven CPU. Todo corre en el namespace del proyecto
#   (student-forellana), desde este computador.
set -uo pipefail

# ── Ubicarse: raíz del repo, sin importar desde dónde se abrió ──────────────
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
cd "$RAIZ" || exit 1

# Git Bash convierte /sys/fs/cgroup/... en una ruta de Windows si no está esto.
export MSYS_NO_PATHCONV=1

# kubelogin instalado con winget queda fuera del PATH en algunas terminales.
if ! command -v kubectl-oidc_login >/dev/null 2>&1; then
  for d in "${LOCALAPPDATA:-}"/Microsoft/WinGet/Packages/int128.kubelogin*; do
    [ -d "$d" ] && export PATH="$d:$PATH" && break
  done
fi

NS_APP="student-forellana"
INTERACTIVO=1; [ -t 0 ] || INTERACTIVO=0

# Ctrl+S congela la pantalla de la terminal hasta apretar Ctrl+Q y parece que
# el script se pegó. Esto lo desactiva mientras corre el menú.
[ "$INTERACTIVO" = 1 ] && stty -ixon 2>/dev/null

# ── Utilidades ──────────────────────────────────────────────────────────────
titulo() { printf '\n  \033[1m%s\033[0m\n' "$1"; }
nota()   { printf '  \033[2m%s\033[0m\n' "$1"; }
ok()     { printf '  \033[32m✔\033[0m %s\n' "$1"; }
mal()    { printf '  \033[31m✘\033[0m %s\n' "$1"; }
pausa()  { [ "$INTERACTIVO" = 1 ] || return 0; echo; read -rp "  Enter para volver al menú " _; }

a_milicores() {  # "250m" -> 250 ; "2" -> 2000 ; "" -> 0
  case "${1:-}" in
    "") echo 0 ;;
    *m) echo "${1%m}" ;;
    *)  echo $(( ${1%%.*} * 1000 )) ;;
  esac
}

cpu_namespace() {  # imprime "usado libre" en milicores, o nada si no se puede leer
  local u h
  u="$(kubectl get resourcequota -o jsonpath='{.items[0].status.used.limits\.cpu}' 2>/dev/null)"
  h="$(kubectl get resourcequota -o jsonpath='{.items[0].status.hard.limits\.cpu}' 2>/dev/null)"
  [ -n "$u" ] && [ -n "$h" ] || return 1
  u="$(a_milicores "$u")"; h="$(a_milicores "$h")"
  echo "$u $(( h - u ))"
}

cpu_fortio() {  # cuánto pide el generador según qps (igual que estresar.sh)
  if   [ "$1" -le 50 ];  then echo 150
  elif [ "$1" -le 120 ]; then echo 250
  else                        echo 400
  fi
}

# Por qué un pod quedó Pending: el evento SyncError del vcluster lo dice.
# $1 = fragmento del nombre del pod. Imprime el mensaje, o nada.
motivo_pending() {
  kubectl get events --field-selector involvedObject.kind=Pod --sort-by=.lastTimestamp \
    -o jsonpath="{range .items[?(@.reason=='SyncError')]}{.involvedObject.name}{'\t'}{.message}{'\n'}{end}" 2>/dev/null \
    | grep -- "$1" | tail -1 | cut -f2
}

explicar_pending() {  # $1 = mensaje de motivo_pending
  if printf '%s' "$1" | grep -q students-host-envelope; then
    mal "la bolsa de CPU compartida por TODO el curso está llena (no es cuota nuestra):"
    printf '%s' "$1" | grep -o 'used: limits.cpu=[0-9]*m, limited: limits.cpu=[0-9]*' | sed 's/^/      /'
    nota "Se arregla liberando CPU de nuestro propio namespace (opción 4)."
  elif [ -n "$1" ]; then
    mal "motivo:"; printf '      %s\n' "$1"
  else
    mal "sin motivo visible; mira: kubectl describe pod"
  fi
}

# Pregunta sí/no. Fuera de una terminal responde que no.
preguntar() {
  [ "$INTERACTIVO" = 1 ] || return 1
  local r; read -rp "  $1 [S/n] " r
  case "${r:-s}" in s|S|si|sí|Si|Sí|y|Y) return 0 ;; *) return 1 ;; esac
}

# Abre un comando en OTRA ventana de terminal. Devuelve 1 si no hay cómo.
abrir_ventana() {
  local tit="$1"; shift
  if command -v mintty >/dev/null 2>&1; then                     # Git Bash
    mintty --title "$tit" --hold error -e bash "$@" >/dev/null 2>&1 &
    return 0
  fi
  local t
  for t in gnome-terminal konsole xfce4-terminal x-terminal-emulator xterm; do
    command -v "$t" >/dev/null 2>&1 || continue
    case "$t" in
      gnome-terminal) gnome-terminal --title="$tit" -- bash "$@" >/dev/null 2>&1 & ;;
      konsole)        konsole --title "$tit" -e bash "$@" >/dev/null 2>&1 & ;;
      *)              "$t" -T "$tit" -e bash "$@" >/dev/null 2>&1 & ;;
    esac
    return 0
  done
  return 1
}

# ── Estado del cluster (se muestra arriba del menú) ─────────────────────────
estado() {
  titulo "ESTADO"
  local ns pods total corriendo gw_rep gw_cpu cpu
  ns="$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null || true)"
  if [ "$ns" != "$NS_APP" ]; then
    mal "estás en el namespace '${ns:-?}', no en $NS_APP."
    nota "Este menú es para correrlo desde la cuenta del proyecto (la de Felipe)."
    nota "Si eres otro integrante, lo tuyo es GUIA-EQUIPO.md (lanzas desde tu namespace)."
    return 1
  fi
  pods="$(kubectl get pods --no-headers 2>&1)" || {
    mal "no pude hablar con el cluster:"
    printf '%s\n' "$pods" | head -3 | sed 's/^/      /'
    nota "Si se abrió el navegador y se venció, elige cualquier opción para reintentar."
    return 1
  }
  total="$(printf '%s\n' "$pods" | grep -c . || true)"
  corriendo="$(printf '%s\n' "$pods" | grep -c ' Running ' || true)"
  if [ "$corriendo" = "$total" ]; then ok "pods: $corriendo/$total Running"
  else mal "pods: $corriendo/$total Running"; printf '%s\n' "$pods" | grep -v ' Running ' | sed 's/^/      /'; fi

  gw_rep="$(kubectl get deploy gateway -o jsonpath='{.spec.replicas}' 2>/dev/null || echo '?')"
  gw_cpu="$(kubectl get deploy gateway -o jsonpath='{.spec.template.spec.containers[0].resources.limits.cpu}' 2>/dev/null || echo '?')"
  ok "gateway: $gw_rep réplica(s), límite $gw_cpu de CPU  (el blanco de la prueba)"

  if cpu="$(cpu_namespace)"; then
    set -- $cpu
    ok "CPU del namespace: ${1}m en uso, ${2}m libres  (Fortio a 100 qps pide 250m)"
    [ "$2" -lt 250 ] && nota "→ con menos de 250m libres el generador queda en Pending: usa la opción 4."
  fi
  nota "La bolsa de CPU compartida por todo el curso no se puede consultar. Si está"
  nota "llena, el generador queda Pending y el menú ofrece liberar CPU y reintentar."

  local jobs
  jobs="$(kubectl get jobs -l app=carga-fortio --no-headers 2>/dev/null || true)"
  [ -n "$jobs" ] && nota "hay Jobs de carga de antes: $(printf '%s\n' "$jobs" | awk '{print $1}' | tr '\n' ' ')(opción 7 los borra)"
  return 0
}

# ── Acciones ────────────────────────────────────────────────────────────────
accion_panel() {
  titulo "1 · PANEL EN VIVO"
  nota "Mide el gateway: peticiones reales (sin los chequeos de Kubernetes), cuántos"
  nota "períodos lo frenó su límite de CPU y si sigue dentro del Service."
  nota "Los números se ACUMULAN 30 s (lo que dura un Fortio) y se reinician solos;"
  nota "con r o Enter los reinicias tú. La ventana anterior queda resumida abajo."
  nota "Se cierra con Ctrl+C."
  if abrir_ventana "Ojo al Gasto · panel de carga" "$AQUI/ver-estres.sh"; then
    ok "abierto en otra ventana. Déjala a la vista."
  else
    mal "no encontré cómo abrir otra ventana. Abre otra terminal y corre:"
    echo "      ./k8s/pruebas/ver-estres.sh"
  fi
}

accion_carga() {
  local qps="${1:-}" dur="${2:-30s}" cpu
  titulo "2 · LANZAR CARGA"
  nota "Levanta un pod de Fortio DENTRO del cluster que dispara N peticiones por"
  nota "segundo al /health/ del gateway. Este computador solo manda la orden:"
  nota "la carga la genera un pod y la recibe otro pod."
  if [ -z "$qps" ]; then
    echo
    echo "    25   suave: lo que aguanta sin despeinarse (13 ms de latencia)"
    echo "   100   la demo: pide el doble de lo que puede, para ver el techo"
    echo "   200   brutal: lo mismo pero más feo"
    read -rp "  ¿Cuántas peticiones por segundo? [100] " qps; qps="${qps:-100}"
    read -rp "  ¿Cuánto tiempo? [30s] " dur; dur="${dur:-30s}"
  fi
  if ! [[ "$qps" =~ ^[0-9]+$ ]]; then mal "'$qps' no es un número."; return 1; fi
  if cpu="$(cpu_namespace)"; then
    set -- $cpu
    if [ "$2" -lt "$(cpu_fortio "$qps")" ]; then
      mal "faltan ${2}m libres y el generador a $qps qps necesita $(cpu_fortio "$qps")m."
      nota "El pod quedaría en Pending. Libera CPU con la opción 4 y vuelve a intentar."
      return 1
    fi
  fi
  echo
  bash "$AQUI/estresar.sh" "$qps" "$dur"
  local rc=$?
  if [ "$rc" -ne 0 ] && preguntar "¿Libero CPU (apago rabbitmq y worker) y reintento?"; then
    accion_liberar "$qps" || return 1
    echo
    nota "reintentando…"
    bash "$AQUI/estresar.sh" "$qps" "$dur"
    rc=$?
  fi
  return "$rc"
}

accion_demo() {
  titulo "3 · DEMO COMPLETA"
  nota "Lo que se muestra en la revisión: el panel en una ventana, la carga en"
  nota "esta, y en paralelo tú navegas la web para demostrar que sigue viva."
  accion_panel
  echo
  nota "Dale 5 segundos al panel para que tome la primera lectura en reposo…"
  sleep 5
  accion_carga
}

accion_liberar() {
  local qps="${1:-100}" apagar="rabbitmq subscriptions-worker" libera=350
  titulo "4 · LIBERAR CPU ANTES DE LA PRUEBA"
  nota "El namespace tiene techo de 2000m. Los 10 pods usan 1350m; el generador"
  nota "pide hasta 400m y el HPA hasta 400m más. Si otro namespace del curso copa"
  nota "la bolsa compartida, o si el autoescalado ya creció, no alcanza."
  nota "Se apagan cosas que hoy no hacen nada: RabbitMQ (150m, nunca transportó un"
  nota "mensaje) y el worker de Celery (200m, solo un latido). La app sigue igual."
  if [ "$qps" -gt 120 ]; then
    apagar="$apagar subscriptions-beat"; libera=450
    nota "Para $qps qps el generador pide 400m, así que también se apaga beat (100m)."
  fi
  echo
  local d
  for d in $apagar; do kubectl scale "deployment/$d" --replicas=0 || return 1; done
  nota "esperando a que los pods terminen y suelten la CPU…"
  for d in $apagar; do kubectl wait --for=delete pod -l "app=$d" --timeout=90s >/dev/null 2>&1 || true; done
  ok "${libera}m liberados. Devuélvelos al final con la opción 5."
}

accion_devolver() {
  titulo "5 · DEVOLVER LO APAGADO"
  nota "Vuelve a 1 réplica todo lo que se apagó, y el gateway también por si se"
  nota "escaló durante la demo. Si la bolsa del curso se llenó mientras tanto,"
  nota "quedan Pending hasta que alguien suelte CPU: no es grave, se levantan solos."
  echo
  kubectl scale deployment/rabbitmq deployment/subscriptions-worker deployment/subscriptions-beat deployment/gateway --replicas=1
  ok "todo de vuelta a 1 réplica. Tardan ~1 min en estar Running."
}

accion_comprobar() {
  titulo "6 · COMPROBAR QUE EL GATEWAY RESPONDE"
  nota "Levanta un pod mínimo (BusyBox), le pide que llame al gateway por la red"
  nota "interna del cluster y lo borra. Si esto falla, la prueba de carga tampoco"
  nota "va a funcionar, y conviene saberlo antes."
  echo
  kubectl apply -f k8s/pruebas/diagnostico-busybox.yaml >/dev/null || return 1
  if ! kubectl wait --for=condition=Ready pod/diagnostico --timeout=60s >/dev/null 2>&1; then
    mal "el pod de diagnóstico no arrancó."
    explicar_pending "$(motivo_pending diagnostico)"
    kubectl delete pod diagnostico --ignore-not-found >/dev/null
    if preguntar "¿Libero CPU (apago rabbitmq y worker) y reintento?"; then
      accion_liberar 25 && accion_comprobar
      return $?
    fi
    return 1
  fi
  local r
  r="$(kubectl exec diagnostico -- wget -qO- -T 8 http://gateway:8000/health/ 2>&1)"
  kubectl delete pod diagnostico --ignore-not-found >/dev/null
  if printf '%s' "$r" | grep -q '"estado": *"ok"'; then ok "el gateway respondió: $r"
  else mal "respuesta inesperada: ${r:-(vacía)}"; return 1; fi
}

accion_limpiar() {
  titulo "7 · LIMPIAR"
  nota "Borra los Jobs de Fortio que hayan quedado y el pod de diagnóstico."
  local j
  for j in $(kubectl get jobs -l app=carga-fortio -o name 2>/dev/null); do
    kubectl delete "$j" --ignore-not-found && ok "borrado $j"
  done
  kubectl delete pod diagnostico --ignore-not-found 2>/dev/null | grep -q deleted && ok "borrado pod/diagnostico"
  ok "limpio."
}

accion_companeros() {
  titulo "9 · ATAQUE DESDE LOS PC DE LOS COMPAÑEROS"
  nota "Cada compañero lanza SU Fortio (25 qps) desde SU namespace contra nuestro"
  nota "gateway, con el mismo YAML de siempre. Tú no lanzas nada: miras el panel."
  nota "Con 4 personas a la vez son ~100 qps pedidos; el gateway topa en ~45-50."
  echo
  echo "  Esto es lo que ellos pegan (sirve igual en PowerShell, Linux y Git Bash,"
  echo "  desde cualquier carpeta, ya logueados en el cluster):"
  echo
  echo "    kubectl delete job carga-desde-afuera --ignore-not-found"
  echo "    kubectl apply -f https://raw.githubusercontent.com/Mxtsi7/integra-lll/main/k8s/pruebas/carga-fortio-otro-namespace.yaml"
  echo "    kubectl logs -f job/carga-desde-afuera"
  echo
  echo "  y al terminar:   kubectl delete job carga-desde-afuera"
  echo
  nota "OJO con la bolsa de CPU del curso: cada Fortio de ellos pide 150m. Si está"
  nota "llena (hoy lo estaba), con la opción 4 caben 2 a la vez; apagando también"
  nota "beat caben 3. Si el pod de alguien queda Pending, es eso."
  echo
  if preguntar "¿Libero CPU ahora (rabbitmq, worker y beat) para que quepan sus pods?"; then
    accion_liberar 200   # >120 apaga también beat: 450m libres
    echo
  fi
  accion_panel
  echo
  if [ "$INTERACTIVO" = 1 ]; then
    read -rp "  Cuando todos tengan el comando escrito y el dedo en Enter, aprieta Enter aquí: " _
    local i
    for i in 5 4 3 2 1; do printf '\r  %s… ' "$i"; sleep 1; done
    printf '\r  ¡YA! que lancen todos.          \n'
    nota "Dura 30 s. Mira el panel: peticiones/s tocando techo y 'períodos frenados'."
    nota "Espero 45 s y te digo cuántas llegaron…"
    sleep 45
  fi
  echo
  local p n
  for p in $(kubectl get pods -l app=gateway -o name 2>/dev/null); do
    n="$(kubectl logs "$p" --since=60s 2>/dev/null | grep -v kube-probe | grep -c fortio || true)"
    ok "$p: ${n:-0} peticiones de Fortio en el último minuto"
  done
  nota "Referencia: una réplica satura en ~1 350 por 30 s (~45 qps); si pidieron"
  nota "100 qps y llegaron ~1 350, el techo es el límite de CPU, no la red."
  echo
  nota "Para mostrar la solución en vivo:  kubectl scale deployment/gateway --replicas=2"
  nota "(cabe en la cuota del namespace; una tercera no). Que lancen otra vez: ~88 qps."
  nota "Al final, opción 5 para dejar todo en 1 réplica."
}

accion_pods() {
  titulo "10 · PODS Y SERVICES"
  nota "Todo lo que hay en el namespace del proyecto, con conteo. Un pod 'Running'"
  nota "con READY 1/1 está prendido y atendiendo; 0/1 arrancando o fuera del Service."
  echo
  local pods total corriendo listos apagados
  pods="$(kubectl get pods --no-headers 2>&1)" || { mal "no pude listar: $pods"; return 1; }
  total="$(printf '%s\n' "$pods" | grep -c . || true)"
  corriendo="$(printf '%s\n' "$pods" | grep -c ' Running ' || true)"
  # listo = READY n/n y Running (todos sus contenedores atendiendo)
  listos="$(printf '%s\n' "$pods" | awk '{ split($2, a, "/"); if (a[1] == a[2] && $3 == "Running") n++ } END { print n + 0 }')"
  if [ "$listos" = "$total" ]; then ok "$total pods · $corriendo Running · $listos listos (todos)"
  else mal "$total pods · $corriendo Running · $listos listos"; fi
  echo
  kubectl get pods 2>/dev/null | sed 's/^/    /'
  # deployments en 0 réplicas no aparecen como pods: avisarlo
  apagados="$(kubectl get deploy -o jsonpath='{range .items[?(@.spec.replicas==0)]}{.metadata.name} {end}' 2>/dev/null)"
  [ -n "$apagados" ] && { echo; mal "apagados (0 réplicas, sin pod): $apagados   → opción 5 los devuelve"; }
  echo
  local svcs
  svcs="$(kubectl get svc --no-headers 2>/dev/null)"
  ok "$(printf '%s\n' "$svcs" | grep -c .) services"
  kubectl get svc -o custom-columns='SERVICE:.metadata.name,TIPO:.spec.type,IP:.spec.clusterIP,PUERTO:.spec.ports[*].port' 2>/dev/null | sed 's/^/    /'
  echo
  ok "$(kubectl get deploy --no-headers 2>/dev/null | grep -c .) deployments"
  kubectl get deploy -o custom-columns='DEPLOYMENT:.metadata.name,LISTAS:.status.readyReplicas,DESEADAS:.spec.replicas,CPU:.spec.template.spec.containers[0].resources.limits.cpu' 2>/dev/null | sed 's/^/    /'
}

accion_explicar() {
  cat <<'FIN'

  ¿QUÉ ES ESTO Y QUÉ SE VA A VER?

  El blanco es el gateway: 1 réplica con un límite de 200 milicores (una
  quinta parte de un núcleo). Medido, atiende unas 45-50 peticiones por
  segundo al /health/.

  La carga la genera Fortio desde un pod DENTRO del cluster. El notebook no
  participa: solo le manda el manifiesto al API server. Por eso el resultado
  es el mismo lo lance quien lo lance y no depende de la conexión de nadie.

  Con 100 qps pedidos se ve, en el panel:
    · peticiones de carga ~45-50/s      → el techo, no llega a 100
    · períodos frenados > 0 por lectura → el kernel frenando al pod por el
                                           límite que NOSOTROS le pusimos
    · reinicios / "listo: NO"           → si el probe de salud (mismo /health/,
                                           1 s de plazo) no alcanza a responder,
                                           Kubernetes saca el pod del Service y
                                           la prueba se queda sin blanco
  y en la salida de Fortio:
    · "All done 3000 calls, 150-300 ms avg, ~48 qps" en vez de 13 ms y 100 qps.

  Lo que vale decir: no es que el código sea lento, es que el recurso está
  acotado a propósito y podemos señalar exactamente dónde. Escalar a 2
  réplicas (kubectl scale deployment/gateway --replicas=2) duplica el techo
  a ~88 qps; una tercera no cabe en la cuota del namespace.

  Números de referencia (06-10-2026):
    25 qps, 1 réplica  → 748/748 OK, 13 ms promedio, p99 24 ms
    ~100 qps, 1 réplica → ~45 qps reales, latencia 150-300 ms
    ~100 qps, 2 réplicas → ~88 qps reales, reparto 50/50 entre pods

  Mientras corre, navegar la web en el navegador: sigue respondiendo. Eso es el
  "funcionamiento simultáneo" que pide el enunciado.

  Comandos equivalentes a mano, por si alguien pregunta:
    ./k8s/pruebas/ver-estres.sh            panel
    ./k8s/pruebas/estresar.sh 100          carga
    kubectl exec deploy/gateway -- cat /sys/fs/cgroup/cpu.stat     throttling crudo
    kubectl logs -l app=gateway --since=5s | grep -vc kube-probe   peticiones en 5 s
FIN
}

# ── Menú ────────────────────────────────────────────────────────────────────
menu() {
  cat <<'FIN'

  ¿QUÉ QUIERES HACER?
    1  Abrir el panel en vivo (otra ventana)          ver-estres.sh
    2  Lanzar la carga                                estresar.sh N
    3  Demo completa: 1 + 2 seguidos                  lo de la revisión
    4  Liberar CPU antes (apaga rabbitmq y worker)    si el pod queda Pending
    5  Devolver lo apagado y dejar gateway en 1       al terminar
    6  Comprobar que el gateway responde              antes de la demo
    7  Limpiar Jobs y pods de prueba
    8  ¿Qué es todo esto y qué se va a ver?           léelo una vez
    9  Ataque desde los PC de los compañeros          tú miras, ellos lanzan
   10  Mostrar pods y services                        qué hay prendido
    0  Salir
FIN
}

# Modo directo sin menú: ./prueba-de-carga.sh 100   (lanza carga y listo)
if [ $# -gt 0 ]; then
  case "$1" in
    panel)     accion_panel ;;
    demo)      accion_demo ;;
    liberar)   accion_liberar ;;
    devolver)  accion_devolver ;;
    comprobar) accion_comprobar ;;
    limpiar)   accion_limpiar ;;
    explicar)  accion_explicar ;;
    companeros|compañeros) accion_companeros ;;
    pods)      accion_pods ;;
    [0-9]*)    accion_carga "$1" "${2:-30s}" ;;
    *) echo "uso: $0 [panel|demo|liberar|devolver|comprobar|limpiar|explicar|companeros|pods|<qps> [duración]]"; exit 1 ;;
  esac
  exit $?
fi

printf '\033[2J\033[H'
echo
echo "  ╔═══════════════════════════════════════════════════════════════╗"
echo "  ║   OJO AL GASTO · prueba de carga                              ║"
echo "  ╚═══════════════════════════════════════════════════════════════╝"
nota "Para qué sirve: mostrar en vivo qué pasa cuando le llegan 100 peticiones"
nota "por segundo al gateway y dónde está el límite. Qué hace: levanta un pod"
nota "de Fortio dentro del cluster y, en otra ventana, un panel que mide."
nota "Si se abre el navegador, es el login del cluster: entra con tu cuenta UCT."

estado || true

while true; do
  menu
  read -rp "  > " op || exit 0
  case "$op" in
    1) accion_panel;     pausa ;;
    2) accion_carga;     pausa ;;
    3) accion_demo;      pausa ;;
    4) accion_liberar;   pausa ;;
    5) accion_devolver;  pausa ;;
    6) accion_comprobar; pausa ;;
    7) accion_limpiar;   pausa ;;
    8) accion_explicar;  pausa ;;
    9) accion_companeros; pausa ;;
    10) accion_pods;     pausa ;;
    0|q|salir) echo "  chao."; exit 0 ;;
    *) mal "opción '$op' no existe." ;;
  esac
  printf '\033[2J\033[H'
  estado || true
done
