#!/usr/bin/env bash
# Despliegue con dobles y valores ficticios: nunca toca un cluster.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PARCHES_PRUEBA="$TMP/parches" ARGUMENTOS_PRUEBA="$TMP/argv"
mkdir "$TMP/bin"
cat > "$TMP/bin/kubectl" <<'DOBLE'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$ARGUMENTOS_PRUEBA"
case "$*" in
  'get deployment/rabbitmq --ignore-not-found -o json') : ;;
  'get secret ojoalgasto-bd-'*'jsonpath={.data.DB_PASSWORD}') printf '%064d' 0 | base64 ;;
  # El Secret del broker, para configurar-usuario-rabbitmq.sh. Va ANTES del
  # patron general 'get secret ojoalgasto'*, que si no lo atrapa primero y
  # devuelve vacio: el guion se niega a seguir sin usuario, como debe.
  'get secret ojoalgasto-rabbitmq -o jsonpath={.data.RABBITMQ_USER}') printf ojoalgasto | base64 ;;
  'get secret ojoalgasto-rabbitmq -o jsonpath={.data.RABBITMQ_PASSWORD}') printf '%064d' 0 | base64 ;;
  # Se traga la clave que llega por la tuberia; el guion REMOTO se prueba
  # aparte, en scripts/tests/test_configurar_usuario_rabbitmq.py.
  'exec -i deploy/rabbitmq'*) cat >/dev/null ;;
  'get secret ojoalgasto -o jsonpath={.data.POSTGRES_PASSWORD}') printf cHJ1ZWJhLXBvc3RncmVz ;;
  'get secret ojoalgasto'*) : ;;
  'patch secret ojoalgasto'*)
    archivo=''
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -p|--patch) echo 'ERROR: secreto en argv' >&2; exit 1 ;;
        --patch-file) shift; archivo="$1" ;;
      esac
      shift
    done
    [ -n "$archivo" ] && [ -f "$archivo" ]
    # Windows/MSYS no representa los permisos POSIX; CI Linux sí los comprueba.
    case "$OSTYPE" in msys*|cygwin*) : ;; *) [ "$(stat -c %a "$archivo")" = 600 ] ;; esac
    printf '%s\n' "$archivo" >> "$PARCHES_PRUEBA"
    cat "$archivo" >> "$PARCHES_PRUEBA.json"
    [ "${FALLAR_PARCHE:-0}" != 1 ] ;;
  *'apply -f -') cat >/dev/null ;;
  'exec -i postgres-0 -- psql'*) cat >/dev/null ;;
esac
DOBLE
chmod +x "$TMP/bin/kubectl"
# Este arnés solo verifica parches de secretos; el guard del broker se prueba
# aparte en scripts/tests/test_migracion_rabbitmq.py, también con broker real.
cat > "$TMP/bin/python3" <<'DOBLE'
#!/usr/bin/env bash
[ "$#" = 1 ] && [ "$1" = k8s/actualizar-rabbitmq.py ]
DOBLE
chmod +x "$TMP/bin/python3"
export PATH="$TMP/bin:$PATH"
export SOLO_APLICAR=1 ETIQUETA=prueba GHCR_TOKEN=registro-ficticio
if ! bash "$RAIZ/k8s/desplegar.sh" > "$TMP/salida" 2>&1; then
  tail -2 "$TMP/salida"
  exit 1
fi
[ "$(wc -l < "$PARCHES_PRUEBA")" -eq 3 ]
grep -q 'ELIMINACION_INTERNA_SECRET' "$PARCHES_PRUEBA.json"
grep -q 'CLAVES_CIFRADO' "$PARCHES_PRUEBA.json"
grep -q 'DATABASE_URL' "$PARCHES_PRUEBA.json"
# El usuario del broker no se crea solo: RABBITMQ_DEFAULT_USER/PASS no hacen
# nada cuando el PVC ya tiene datos. Si desplegar.sh deja de invocar el guion,
# los clientes quedan sin poder autenticarse y nadie se entera hasta el deploy.
grep -q 'exec -i deploy/rabbitmq' "$ARGUMENTOS_PRUEBA"
if grep -qE 'stringData|prueba-postgres' "$ARGUMENTOS_PRUEBA" "$TMP/salida"; then exit 1; fi
while IFS= read -r archivo; do [ ! -e "$archivo" ]; done < "$PARCHES_PRUEBA"
: > "$PARCHES_PRUEBA"
if FALLAR_PARCHE=1 bash "$RAIZ/k8s/desplegar.sh" > "$TMP/error" 2>&1; then
  echo 'ERROR: ocultó el fallo del parche'; exit 1
fi
while IFS= read -r archivo; do [ ! -e "$archivo" ]; done < "$PARCHES_PRUEBA"
echo 'Parches privados: argv, permisos y limpieza tras éxito/fallo correctos'
