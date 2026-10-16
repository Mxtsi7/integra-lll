#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════════════════╗
# ║  OJO AL GASTO · CORRER TODAS LAS PRUEBAS                               ║
# ╚═══════════════════════════════════════════════════════════════════════╝
#
# ¿PARA QUÉ SIRVE?
#   Para correr en tu PC exactamente las mismas pruebas que corre el CI de
#   GitHub en cada PR, sin tener que acordarse de variables ni comandos.
#   Si acá sale verde, el PR sale verde.
#
# ¿CÓMO SE USA?
#     ./scripts/correr-tests.sh                 # todo: auth, subscriptions, gateway, shared, frontend
#     ./scripts/correr-tests.sh auth            # solo un servicio
#     ./scripts/correr-tests.sh backend         # los tres servicios Django
#     ./scripts/correr-tests.sh frontend        # typecheck + vitest
#     ./scripts/correr-tests.sh --build         # además construye la web, como el CI
#     ./scripts/correr-tests.sh auth -- -k login -x     # lo que va tras `--` es para pytest
#     ./scripts/correr-tests.sh k8s             # lo mismo, pero DENTRO de los pods del cluster
#     ./scripts/correr-tests.sh k8s auth        # un solo servicio, en su pod
#   En Windows también funciona con doble clic (se abre en Git Bash).
#
# ¿QUÉ HACE POR DEBAJO?
#   Modo normal (Docker, igual al CI):
#   · Levanta un Postgres 16 en Docker (igual al del CI) y lo apaga al final.
#   · Para cada servicio arma una imagen Python 3.12 con su requirements.txt
#     (Docker la cachea: solo se reconstruye si cambia el requirements) y corre
#     adentro `python manage.py check` y `pytest`, con el repo montado y las
#     mismas variables que .github/workflows/ci.yml. Prueba TU código local.
#   Modo k8s:
#   · Hace `kubectl exec` en el pod de cada servicio y corre pytest ahí: la
#     imagen desplegada lleva tests/ y pytest adentro. Prueba LO QUE ESTÁ
#     DESPLEGADO (se imprime el tag de la imagen), no tu copia local.
#   · La base de pruebas (test_auth, test_subscriptions) se crea y se borra en
#     el Postgres del cluster; los datos reales no se tocan. Mientras corre,
#     el servicio comparte su CPU (250m) con pytest y responde más lento.
#   · Quita PBKDF2_ITERACIONES del entorno de pytest: el ConfigMap la fija en
#     100000 para que el login sea rápido, y dos pruebas de auth asumen que no
#     está definida.
#   En los dos modos:
#   · El frontend se corre con el node de tu PC: `npm run typecheck` y
#     `npm test` (vitest). La imagen web del cluster es nginx con archivos
#     estáticos, sin node, así que ahí no hay nada que ejecutar.
#   · Al final imprime un resumen con cuántas pruebas pasaron en cada parte.
#
# Necesita Docker Desktop abierto (modo normal) o kubectl logueado (modo k8s),
# y para el frontend, node + npm.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
cd "$RAIZ" || exit 1

# Git Bash convierte "/repo" en "C:/Program Files/Git/repo" al pasarlo a
# docker. Esto lo evita; la ruta del host se pasa en formato Windows aparte.
export MSYS_NO_PATHCONV=1
RAIZ_HOST="$(cygpath -w "$RAIZ" 2>/dev/null || echo "$RAIZ")"

RED="ojoalgasto-tests"
PG="ojoalgasto-tests-postgres"
LOGS="${TMPDIR:-/tmp}/ojoalgasto-tests"; mkdir -p "$LOGS"
INTERACTIVO=1; [ -t 0 ] || INTERACTIVO=0

# ── Utilidades ──────────────────────────────────────────────────────────────
titulo() { printf '\n\033[1m  ━━ %s ━━\033[0m\n\n' "$1"; }
nota()   { printf '  \033[2m%s\033[0m\n' "$1"; }
ok()     { printf '  \033[32m✔\033[0m %s\n' "$1"; }
mal()    { printf '  \033[31m✘\033[0m %s\n' "$1"; }
segs()   { echo $(( $(date +%s) - $1 )); }

# ── Argumentos ──────────────────────────────────────────────────────────────
SUITES=(); BUILD=0; K8S=0; PYTEST_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; PYTEST_ARGS=("$@"); break ;;
    --build) BUILD=1 ;;
    k8s|--k8s|kubernetes|cluster) K8S=1 ;;
    -h|--help|--ayuda|ayuda) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    todo|all) SUITES+=(auth subscriptions gateway shared frontend) ;;
    backend)  SUITES+=(auth subscriptions gateway shared) ;;
    auth|subscriptions|gateway|shared|frontend) SUITES+=("$1") ;;
    *) mal "no sé qué es '$1'. Opciones: auth subscriptions gateway shared frontend backend todo k8s --build"; exit 2 ;;
  esac
  shift
done
[ ${#SUITES[@]} -gt 0 ] || SUITES=(auth subscriptions gateway shared frontend)

# Carpeta y nombre de esquema de cada servicio Django
dir_de() { case "$1" in gateway) echo gateway ;; *) echo "services/$1" ;; esac; }

# ── Resultados para el resumen ──────────────────────────────────────────────
declare -A ESTADO PASARON FALLARON DETALLE TIEMPO
FALLO_GLOBAL=0

registrar() {  # suite estado pasaron fallaron detalle segundos
  ESTADO[$1]="$2"; PASARON[$1]="$3"; FALLARON[$1]="$4"; DETALLE[$1]="$5"; TIEMPO[$1]="$6"
  [ "$2" = "ok" ] || FALLO_GLOBAL=1
}

# Lee la última línea de resumen de pytest ("12 passed, 1 failed in 3.2s")
resumen_pytest() {  # $1 = log
  local linea p f e
  # Con -v viene como "===== 12 passed in 3s =====", con -q como "12 passed in 3s".
  linea="$(sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E '[0-9]+ (passed|failed|error|deselected|no tests ran)' | tail -1)"
  p="$(printf '%s' "$linea" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo 0)"
  f="$(printf '%s' "$linea" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo 0)"
  e="$(printf '%s' "$linea" | grep -oE '[0-9]+ error' | grep -oE '[0-9]+' || echo 0)"
  echo "${p:-0} $(( ${f:-0} + ${e:-0} ))"
}

# ── Docker / Postgres ───────────────────────────────────────────────────────
# `shared` corre con sqlite en memoria, igual que en el CI: no necesita
# Postgres ni cluster. Se excluye junto con `frontend` para no levantar
# Docker por gusto cuando se pide solo esa suite.
sin_base() { [ "$1" = frontend ] || [ "$1" = shared ]; }

NECESITA_DOCKER=0
for s in "${SUITES[@]}"; do sin_base "$s" || { [ "$K8S" = 0 ] && NECESITA_DOCKER=1; }; done
NECESITA_K8S=0
for s in "${SUITES[@]}"; do sin_base "$s" || { [ "$K8S" = 1 ] && NECESITA_K8S=1; }; done

apagar_postgres() {
  [ "$NECESITA_DOCKER" = 1 ] && docker rm -f "$PG" >/dev/null 2>&1 || true
}
trap 'apagar_postgres' EXIT

if [ "$NECESITA_K8S" = 1 ]; then
  titulo "CLUSTER (modo k8s: pytest dentro de los pods desplegados)"
  # kubelogin instalado con winget queda fuera del PATH en algunas terminales.
  if ! command -v kubectl-oidc_login >/dev/null 2>&1; then
    for d in "${LOCALAPPDATA:-}"/Microsoft/WinGet/Packages/int128.kubelogin*; do
      [ -d "$d" ] && export PATH="$d:$PATH" && break
    done
  fi
  nota "si se abre el navegador, es el login del cluster: entra con tu cuenta UCT (3 min)."
  NS_K8S="$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null || true)"
  if ! kubectl get deploy >/dev/null 2>&1; then
    mal "no pude hablar con el cluster (namespace '${NS_K8S:-?}')."
    [ "$INTERACTIVO" = 1 ] && read -rp "  Enter para cerrar " _
    exit 1
  fi
  ok "conectado al namespace $NS_K8S"
  nota "OJO: esto prueba la imagen que está corriendo, no el código de tu carpeta."
fi

if [ "$NECESITA_DOCKER" = 1 ]; then
  if ! docker info >/dev/null 2>&1; then
    mal "Docker no responde. Abre Docker Desktop y vuelve a correr esto."
    [ "$INTERACTIVO" = 1 ] && read -rp "  Enter para cerrar " _
    exit 1
  fi
  titulo "POSTGRES DE PRUEBAS (postgres:16-alpine, como en el CI)"
  docker network inspect "$RED" >/dev/null 2>&1 || docker network create "$RED" >/dev/null
  apagar_postgres
  docker run -d --rm --name "$PG" --network "$RED" \
    -e POSTGRES_DB=suscripciones -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    postgres:16-alpine >/dev/null || { mal "no pude levantar Postgres"; exit 1; }
  for i in $(seq 1 30); do
    docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  if docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; then
    ok "Postgres listo (contenedor $PG, se borra al terminar)"
  else
    mal "Postgres no arrancó en 30 s"; docker logs "$PG" 2>&1 | tail -5; exit 1
  fi
fi

# ── Backend: un servicio Django ────────────────────────────────────────────
correr_servicio() {
  local svc="$1" dir img log t0 rc p f
  dir="$(dir_de "$svc")"; img="ojoalgasto-tests-$svc"; log="$LOGS/$svc.log"; t0=$(date +%s)
  titulo "$svc  ($dir)"

  nota "imagen con las dependencias de $dir/requirements.txt (cacheada por Docker)…"
  if ! docker build -q -t "$img" -f - "$dir" >"$LOGS/$svc-build.log" 2>&1 <<'EOF'
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
EOF
  then
    mal "falló la construcción de la imagen:"; tail -15 "$LOGS/$svc-build.log" | sed 's/^/      /'
    registrar "$svc" error 0 0 "no se pudo instalar requirements.txt" "$(segs $t0)"
    return 1
  fi

  nota "python manage.py check && pytest ${PYTEST_ARGS[*]:-}"
  echo
  docker run --rm --network "$RED" \
    -v "$RAIZ_HOST:/repo" -w "/repo/$dir" \
    -e DEBUG=True \
    -e SECRET_KEY=clave-solo-para-tests \
    -e ALLOWED_HOSTS=localhost,127.0.0.1,testserver \
    -e DATABASE_URL="postgres://postgres:postgres@$PG:5432/suscripciones" \
    -e ESQUEMA_BD="$svc" \
    -e JWT_SECRET=secreto-solo-para-tests \
    -e JWT_ALGORITMO=HS256 \
    -e PYTHONPATH=/repo \
    "$img" bash -c "python manage.py check && pytest -p no:cacheprovider ${PYTEST_ARGS[*]:-}" \
    2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}

  read -r p f <<< "$(resumen_pytest "$log")"
  echo
  if [ "$rc" -eq 0 ]; then
    ok "$svc: $p pruebas pasaron en $(segs $t0) s"
    registrar "$svc" ok "$p" "$f" "" "$(segs $t0)"
  else
    mal "$svc: $f fallaron, $p pasaron (código $rc). Log: $log"
    registrar "$svc" fallo "$p" "$f" "ver $log" "$(segs $t0)"
  fi
}

# ── Backend en el cluster: pytest dentro del pod del servicio ──────────────
correr_servicio_k8s() {
  local svc="$1" log t0 rc p f cont imagen tag
  log="$LOGS/$svc-k8s.log"; t0=$(date +%s)
  titulo "$svc  (en el pod del cluster)"

  if ! kubectl get deploy "$svc" >/dev/null 2>&1; then
    mal "no existe deployment/$svc en este namespace"
    registrar "$svc" error 0 0 "sin deployment" 0; return 1
  fi
  if [ "$(kubectl get deploy "$svc" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)" = "" ]; then
    mal "deployment/$svc no tiene réplicas listas (¿apagado o arrancando?)"
    registrar "$svc" error 0 0 "sin pod listo" 0; return 1
  fi
  cont="$(kubectl get deploy "$svc" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null)"
  imagen="$(kubectl get deploy "$svc" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)"
  tag="${imagen##*:}"
  nota "imagen desplegada: ${imagen##*/}"
  nota "kubectl exec deploy/$svc -c $cont -- env -u PBKDF2_ITERACIONES pytest ${PYTEST_ARGS[*]:-}"
  [ "$svc" = auth ] && nota "(el pod tiene 250m de CPU: auth tarda ~1,5 min por las pruebas de hash)"
  echo
  kubectl exec "deploy/$svc" -c "$cont" -- \
    env -u PBKDF2_ITERACIONES pytest -p no:cacheprovider "${PYTEST_ARGS[@]}" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}

  read -r p f <<< "$(resumen_pytest "$log")"
  echo
  if [ "$rc" -eq 0 ]; then
    ok "$svc: $p pruebas pasaron en el pod en $(segs $t0) s"
    registrar "$svc" ok "$p" "$f" "pod, imagen $tag" "$(segs $t0)"
  else
    mal "$svc: $f fallaron, $p pasaron (código $rc). Log: $log"
    registrar "$svc" fallo "$p" "$f" "pod, imagen $tag · ver $log" "$(segs $t0)"
  fi
}

# ── Frontend ────────────────────────────────────────────────────────────────
correr_frontend() {
  local t0 log rc_tc rc_test rc_build=0 p detalle
  t0=$(date +%s); log="$LOGS/frontend.log"
  titulo "frontend  (typecheck + vitest$( [ "$BUILD" = 1 ] && echo ' + build'))"
  if ! command -v npm >/dev/null 2>&1; then
    mal "no encuentro npm. Instala Node 20+ (https://nodejs.org) y vuelve a correr."
    registrar frontend error 0 0 "sin npm" 0; return 1
  fi
  cd "$RAIZ/frontend" || return 1
  if [ ! -d node_modules ]; then
    nota "no hay node_modules: npm ci (una sola vez)…"
    npm ci 2>&1 | tail -3
  fi
  : > "$log"
  nota "npm run typecheck"; npm run typecheck 2>&1 | tee -a "$log" | grep -E 'error|✖' | head -20
  rc_tc=${PIPESTATUS[0]}
  nota "npm test"; echo
  npm test 2>&1 | tee -a "$log" | sed 's/\x1b\[[0-9;]*m//g' | grep -E '✓|✗|×|FAIL|Tests |Test Files|No test files|passed|failed'
  rc_test=${PIPESTATUS[0]}
  if [ "$BUILD" = 1 ]; then
    nota "npm run build"; npm run build 2>&1 | tee -a "$log" | tail -4
    rc_build=${PIPESTATUS[0]}
  fi
  cd "$RAIZ"
  # vitest imprime una línea "Tests  21 passed (21)" por workspace: se suman
  p="$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -oE 'Tests +[0-9]+ passed' | awk '{ s += $2 } END { print s + 0 }')"
  detalle="typecheck $( [ "$rc_tc" -eq 0 ] && echo OK || echo FALLÓ )"
  [ "$BUILD" = 1 ] && detalle="$detalle · build $( [ "$rc_build" -eq 0 ] && echo OK || echo FALLÓ )"
  echo
  if [ "$rc_tc" -eq 0 ] && [ "$rc_test" -eq 0 ] && [ "$rc_build" -eq 0 ]; then
    ok "frontend: $p pruebas pasaron, $detalle, en $(segs $t0) s"
    registrar frontend ok "$p" 0 "$detalle" "$(segs $t0)"
  else
    mal "frontend: algo falló ($detalle, tests código $rc_test). Log: $log"
    registrar frontend fallo "$p" "?" "$detalle" "$(segs $t0)"
  fi
}

correr_shared() {
  # El código de shared/ no pertenece a ningún servicio: corre con el python
  # de tu PC y sqlite en memoria, igual que el trabajo `shared · cifrado`
  # del CI. No necesita Docker ni Postgres.
  local t0 log py p f
  t0=$(date +%s); log="$LOGS/shared.log"
  titulo "shared  (código compartido: cifrado)"

  # Se elige el primer python que TENGA las dependencias, no el primero que
  # exista: en Windows suele haber un `python3` del sistema sin nada instalado
  # conviviendo con el `python` de un entorno virtual que sí las tiene.
  local primero=""
  py=""
  for candidato in python python3 py; do
    command -v "$candidato" >/dev/null 2>&1 || continue
    [ -n "$primero" ] || primero="$candidato"
    if "$candidato" -c "import pytest, django, rest_framework, cryptography" >/dev/null 2>&1; then
      py="$candidato"; break
    fi
  done

  if [ -z "$primero" ]; then
    mal "no encuentro python. Instala Python 3.12+ y vuelve a correr."
    registrar shared error 0 0 "sin python" 0; return 1
  fi
  if [ -z "$py" ]; then
    mal "faltan dependencias de pruebas. Instálalas con:"
    nota "$primero -m pip install -r shared/requirements-pruebas.txt"
    registrar shared error 0 0 "faltan dependencias" 0; return 1
  fi

  cd "$RAIZ" || return 1
  : > "$log"
  nota "pytest shared"
  "$py" -m pytest shared "${PYTEST_ARGS[@]}" 2>&1 | tee -a "$log" \
    | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'PASSED|FAILED|ERROR|passed|failed|error'
  read -r p f <<<"$(resumen_pytest "$log")"
  echo
  if [ "$f" -eq 0 ] && [ "$p" -gt 0 ]; then
    ok "shared: $p pruebas pasaron en $(segs $t0) s"
    registrar shared ok "$p" 0 "sqlite en memoria" "$(segs $t0)"
  else
    mal "shared: $f fallaron. Log: $log"
    registrar shared fallo "$p" "$f" "sqlite en memoria" "$(segs $t0)"
  fi
}

# ── Correr ──────────────────────────────────────────────────────────────────
T_INICIO=$(date +%s)
for s in "${SUITES[@]}"; do
  if [ "$s" = frontend ]; then correr_frontend
  elif [ "$s" = shared ]; then correr_shared
  elif [ "$K8S" = 1 ]; then correr_servicio_k8s "$s"
  else correr_servicio "$s"; fi
done

# ── Resumen ─────────────────────────────────────────────────────────────────
titulo "RESUMEN"
TOTAL_P=0; TOTAL_F=0
for s in "${SUITES[@]}"; do
  case "${ESTADO[$s]:-?}" in
    ok)    printf '  \033[32m✔\033[0m %-14s %4s pasaron  %5s s  %s\n' "$s" "${PASARON[$s]}" "${TIEMPO[$s]}" "${DETALLE[$s]}" ;;
    fallo) printf '  \033[31m✘\033[0m %-14s %4s pasaron, %s fallaron  %5s s  %s\n' "$s" "${PASARON[$s]}" "${FALLARON[$s]}" "${TIEMPO[$s]}" "${DETALLE[$s]}" ;;
    *)     printf '  \033[31m✘\033[0m %-14s no se pudo correr: %s\n' "$s" "${DETALLE[$s]:-?}" ;;
  esac
  TOTAL_P=$(( TOTAL_P + ${PASARON[$s]:-0} ))
  [[ "${FALLARON[$s]:-0}" =~ ^[0-9]+$ ]] && TOTAL_F=$(( TOTAL_F + FALLARON[$s] ))
done
echo
if [ "$FALLO_GLOBAL" = 0 ] && [ "$K8S" = 1 ]; then
  ok "TODO VERDE: $TOTAL_P pruebas pasaron en $(segs $T_INICIO) s, sobre lo que está desplegado."
elif [ "$FALLO_GLOBAL" = 0 ]; then
  ok "TODO VERDE: $TOTAL_P pruebas pasaron en $(segs $T_INICIO) s. Así va a salir el CI."
else
  mal "HAY FALLAS: $TOTAL_F fallaron, $TOTAL_P pasaron. Los logs están en $LOGS/"
fi
echo
[ "$INTERACTIVO" = 1 ] && [ -z "${CI:-}" ] && [ -z "${SSH_TTY:-}" ] && [ -n "${MSYSTEM:-}" ] && read -rp "  Enter para cerrar " _
exit "$FALLO_GLOBAL"
