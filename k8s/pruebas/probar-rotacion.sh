#!/usr/bin/env bash
# Prueba k8s/rotar-clave-postgres.sh con kubectl, openssl y git DOBLES.
#
#     bash k8s/pruebas/probar-rotacion.sh
#
# Nunca toca un cluster ni una base: todo son stubs y la clave es sintetica.
#
# Existe porque ese script puede dejar al equipo sin base de datos y no se
# puede "probar en produccion a ver que pasa".
#
# ── Los dobles tienen ESTADO ─────────────────────────────────────────────────
# La primera version devolvia siempre la misma clave en `get secret`, aunque
# el patch hubiera funcionado. O sea que no modelaba la mutacion que decide el
# comportamiento de la segunda corrida, y por eso NO detectaba el caso en que
# una rotacion a medias quedaba sin poder reanudarse. Lo señalo la revision de
# la PR #108 y era cierto.
#
# Ahora hay dos estados independientes, como en la realidad:
#
#   $ESTADO/bd      la clave que ACEPTA la base      (la cambia el ALTER)
#   $ESTADO/secret  la clave que dice el Secret      (la cambia el patch)
#
# Que puedan diverger es justamente el problema que el script evita, asi que
# el arnes tiene que poder representarlo.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUION="$AQUI/../rotar-clave-postgres.sh"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
DOBLES="$BASE/bin"
ESTADO="$BASE/estado"
mkdir -p "$DOBLES" "$ESTADO"

CLAVE_VIEJA="aaaaaaaa"
CLAVE_NUEVA="b1b2b3b4b5b6b7b8b9c0c1c2c3c4c5c6"
export HOME="$BASE/home"; mkdir -p "$HOME"
PENDIENTE="$HOME/.ojoalgasto-rotacion-pendiente"

export REGISTRO_ARGV="$BASE/argv.txt"
export REGISTRO_PATCH="$BASE/patch.txt"
export ESTADO

# ── Un `mv` que puede "morir" ────────────────────────────────────────────────
# El archivo de recuperacion se escribe entero en un temporal y se renombra
# encima. Este doble deja simular que el proceso muere JUSTO antes del rename
# de una fase dada (MUERE_MV_EN_FASE=alter_ok, por ejemplo): sale con 137,
# como un SIGKILL, sin tocar nada. Lo que tiene que sobrevivir es la version
# anterior del archivo, integra y con la clave.
MV_REAL="$(command -v mv)"
cat > "$DOBLES/mv" <<EOF
#!/usr/bin/env bash
if [ -n "\${MUERE_MV_EN_FASE:-}" ] && [ -f "\${2:-}" ] \\
   && grep -q "^fase=\${MUERE_MV_EN_FASE}\$" "\$2" 2>/dev/null; then
  exit 137
fi
exec "$MV_REAL" "\$@"
EOF

cat > "$DOBLES/openssl" <<EOF
#!/usr/bin/env bash
[ "\$1" = "rand" ] && { echo "$CLAVE_NUEVA"; exit 0; }
exec /usr/bin/openssl "\$@"
EOF

cat > "$DOBLES/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "show" ]; then
  echo "  DATABASE_URL: postgres://postgres:$CLAVE_VIEJA@postgres:5432/suscripciones"
  exit 0
fi
exec /usr/bin/git "\$@"
EOF

cat > "$DOBLES/kubectl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REGISTRO_ARGV"
case "$1 ${2:-}" in
  "config current-context") echo "cluster-de-prueba"; exit 0 ;;
  "config view")            echo "pruebas"; exit 0 ;;
  "get statefulset")        echo 1; exit 0 ;;
  "get secret")             printf %s "$(cat "$ESTADO/secret")" | base64 -w0; exit 0 ;;
  "get deployment"*)        echo 1; exit 0 ;;
  "patch secret")
      for a in "$@"; do
        if [ -f "$a" ]; then
          cat "$a" >> "$REGISTRO_PATCH"
          # El patch MUTA el Secret. Modelarlo es el punto de este arnes.
          if [ "${FALLA_PATCH:-0}" = "0" ]; then
            python -c "
import json,sys
print(json.load(open(sys.argv[1]))['stringData']['POSTGRES_PASSWORD'], end='')
" "$a" > "$ESTADO/secret"
          fi
        fi
      done
      exit ${FALLA_PATCH:-0} ;;
  "rollout restart") exit 0 ;;
  "rollout status")  exit ${FALLA_ROLLOUT:-0} ;;
  "exec -i")
      recibido="$(cat)"
      case "$*" in
        *"sh -c"*)
            # Comprobacion de clave: entra si es la que acepta la BASE.
            [ "$recibido" = "$(cat "$ESTADO/bd")" ] && exit 0 || exit 1 ;;
        *)
            # ALTER USER: muta la clave de la BASE, si no se fuerza un fallo.
            if [ "${FALLA_ALTER:-0}" != "0" ]; then exit "${FALLA_ALTER}"; fi
            printf %s "$(printf '%s' "$recibido" | sed -E "s/.*PASSWORD '([^']*)'.*/\1/")" \
              > "$ESTADO/bd"
            exit 0 ;;
      esac ;;
  "exec deployment/auth"|"exec deployment/subscriptions")
      echo "ok . esquema x"; exit ${FALLA_HEALTH:-0} ;;
esac
exit 0
EOF
chmod +x "$DOBLES"/*
export PATH="$DOBLES:$PATH"

reiniciar_estado() {
  printf %s "$CLAVE_VIEJA" > "$ESTADO/bd"
  printf %s "$CLAVE_VIEJA" > "$ESTADO/secret"
  chmod -R u+w "$HOME"
  rm -f "$PENDIENTE" "$PENDIENTE.tmp"
  export FALLA_ALTER=0 FALLA_PATCH=0 FALLA_ROLLOUT=0 FALLA_HEALTH=0
  export MUERE_MV_EN_FASE=""
}

correr() {
  : > "$REGISTRO_ARGV"
  : > "$REGISTRO_PATCH"
  bash "$GUION" --aplicar > "$BASE/salida.txt" 2>&1
  echo $?
}

ok=0; mal=0; saltados=0
juzgar() {
  if [ "$2" = "1" ]; then echo "  [ OK    ] $1"; ok=$((ok+1))
  else echo "  [ FALLA ] $1"; mal=$((mal+1)); fi
}
saltar() { echo "  [ SALTA ] $1"; saltados=$((saltados+1)); }
# El archivo de recuperacion tiene que estar entero: con fase, clave y sin
# haber quedado en 0 bytes. Se comprueba el contenido, no solo que exista.
pendiente_integro() {  # $1 = fase esperada
  [ -s "$PENDIENTE" ] \
    && grep -q "^fase=$1\$" "$PENDIENTE" \
    && grep -q "^clave=$CLAVE_NUEVA\$" "$PENDIENTE" \
    && grep -q "^anterior_sha256=.\+" "$PENDIENTE"
}
# OJO: `test "$@"` y no `[ "$1" ]`. La primera version ignoraba la comparacion
# y devolvia 1 siempre, asi que varias aserciones pasaban en vacio.
si() { if test "$@"; then echo 1; else echo 0; fi; }
bd()     { cat "$ESTADO/bd"; }
secreto() { cat "$ESTADO/secret"; }
dice()   { grep -q "$1" "$BASE/salida.txt"; }

echo "=== 1. camino feliz ==="
reiniciar_estado
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "la BASE quedo con la clave nueva" "$(si "$(bd)" = "$CLAVE_NUEVA")"
juzgar "el SECRET quedo con la clave nueva" "$(si "$(secreto)" = "$CLAVE_NUEVA")"
juzgar "borra el archivo de recuperacion" "$(si ! -f "$PENDIENTE")"
if grep -qF "$CLAVE_NUEVA" "$REGISTRO_ARGV"; then v=0; else v=1; fi
juzgar "la clave NUEVA no aparece en ningun argv" "$v"
if grep -qF "$CLAVE_VIEJA" "$REGISTRO_ARGV"; then v=0; else v=1; fi
juzgar "la clave VIEJA no aparece en ningun argv" "$v"
if grep -qF "$CLAVE_NUEVA" "$REGISTRO_PATCH"; then v=1; else v=0; fi
juzgar "la clave nueva viaja en el ARCHIVO de patch" "$v"
if grep -q -- "--patch-file" "$REGISTRO_ARGV"; then v=1; else v=0; fi
juzgar "usa --patch-file" "$v"
if grep -q "ON_ERROR_STOP=1" "$REGISTRO_ARGV"; then v=1; else v=0; fi
juzgar "pasa ON_ERROR_STOP=1 a psql" "$v"

echo
echo "=== 2. el ALTER falla (el caso nuevo: NO debe adelantar el Secret) ==="
reiniciar_estado
export FALLA_ALTER=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la BASE sigue con la clave vieja" "$(si "$(bd)" = "$CLAVE_VIEJA")"
juzgar "el SECRET sigue con la clave vieja" "$(si "$(secreto)" = "$CLAVE_VIEJA")"
juzgar "queda el archivo de recuperacion" "$(si -f "$PENDIENTE")"
if grep -q "^fase=generada" "$PENDIENTE" 2>/dev/null; then v=1; else v=0; fi
juzgar "anotado con fase=generada, no alter_ok" "$v"

echo
echo "=== 3. reanudar tras ALTER fallido: NO debe saltarse el ALTER ==="
# Este es el caso que la version anterior rompia: la sola existencia del
# archivo activaba REANUDANDO y se saltaba el ALTER, dejando el Secret con una
# clave que la base nunca recibio.
export FALLA_ALTER=0
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "NO acepta la clave nueva"; then v=1; else v=0; fi
juzgar "detecta que la base NO tenia la clave nueva" "$v"
juzgar "ahora SI hace el ALTER: la base tiene la nueva" "$(si "$(bd)" = "$CLAVE_NUEVA")"
juzgar "y el Secret quedo en sincronia" "$(si "$(secreto)" = "$CLAVE_NUEVA")"
juzgar "borra el archivo" "$(si ! -f "$PENDIENTE")"

echo
echo "=== 4. falla el patch del Secret ==="
reiniciar_estado
export FALLA_PATCH=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la BASE ya tiene la nueva" "$(si "$(bd)" = "$CLAVE_NUEVA")"
juzgar "el SECRET se quedo atras (la desincronia real)" "$(si "$(secreto)" = "$CLAVE_VIEJA")"
juzgar "conserva el archivo" "$(si -f "$PENDIENTE")"
if grep -q "^fase=alter_ok" "$PENDIENTE" 2>/dev/null; then v=1; else v=0; fi
juzgar "anotado con fase=alter_ok" "$v"
if dice "NO borres"; then v=1; else v=0; fi
juzgar "avisa que no se borre" "$v"

echo
echo "=== 5. reanudar tras patch fallido: omite el ALTER y parchea ==="
export FALLA_PATCH=0
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "YA acepta la clave nueva"; then v=1; else v=0; fi
juzgar "comprueba contra la base y ve que el ALTER ya estaba" "$v"
juzgar "el Secret quedo en sincronia" "$(si "$(secreto)" = "$CLAVE_NUEVA")"

echo
echo "=== 6. falla el rollout (ALTER y Secret YA aplicados) ==="
reiniciar_estado
export FALLA_ROLLOUT=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la BASE tiene la nueva" "$(si "$(bd)" = "$CLAVE_NUEVA")"
juzgar "el SECRET tiene la nueva" "$(si "$(secreto)" = "$CLAVE_NUEVA")"
juzgar "conserva el archivo" "$(si -f "$PENDIENTE")"
if grep -q "^fase=secret_ok" "$PENDIENTE" 2>/dev/null; then v=1; else v=0; fi
juzgar "anotado con fase=secret_ok" "$v"

echo
echo "=== 7. reanudar tras rollout fallido (el caso que antes NO se reanudaba) ==="
# Aca el Secret YA tiene la clave nueva, asi que la comprobacion de "coincide
# con la publicada" NO calza. La version anterior decia "ya se roto" y salia
# con 0 sin reanudar los reinicios ni las verificaciones.
export FALLA_ROLLOUT=0
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "ya se rotó"; then v=0; else v=1; fi
juzgar "NO dice 'ya se roto' y abandona" "$v"
if dice "hay una rotación a medias"; then v=1; else v=0; fi
juzgar "detecta la operacion pendiente" "$v"
if grep -q "rollout restart" "$REGISTRO_ARGV"; then v=1; else v=0; fi
juzgar "SI reanuda los reinicios" "$v"
juzgar "borra el archivo al terminar" "$(si ! -f "$PENDIENTE")"

echo
echo "=== 8. falla el /health/ (todo lo demas aplicado) ==="
reiniciar_estado
export FALLA_HEALTH=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "la base acepta la clave nueva y rechaza"; then v=0; else v=1; fi
juzgar "NO anuncia exito" "$v"
juzgar "conserva el archivo" "$(si -f "$PENDIENTE")"

echo
echo "=== 9. reanudar tras health fallido ==="
export FALLA_HEALTH=0
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if grep -q "exec deployment/auth" "$REGISTRO_ARGV"; then v=1; else v=0; fi
juzgar "vuelve a comprobar los health" "$v"
juzgar "borra el archivo" "$(si ! -f "$PENDIENTE")"

echo
echo "=== 10. sin nada pendiente y ya rotada: no hace nada ==="
reiniciar_estado
printf %s "$CLAVE_NUEVA" > "$ESTADO/bd"
printf %s "$CLAVE_NUEVA" > "$ESTADO/secret"
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "ya se rotó"; then v=1; else v=0; fi
juzgar "dice que ya se roto" "$v"
if grep -q "exec -i" "$REGISTRO_ARGV"; then v=0; else v=1; fi
juzgar "no toca la base" "$v"

echo
echo "=== 11. el archivo es de OTRO destino: no reanuda a ciegas ==="
reiniciar_estado
( umask 077; printf 'version=1\ndestino=otro-cluster|otro-ns|ojoalgasto\nfase=alter_ok\nanterior_sha256=x\nclave=zzz\n' > "$PENDIENTE" )
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if dice "OTRO destino"; then v=1; else v=0; fi
juzgar "avisa que es de otro destino" "$v"
juzgar "no toca la base" "$(si "$(bd)" = "$CLAVE_VIEJA")"

echo
echo "=== 12. modo ensayo no toca nada ==="
reiniciar_estado
: > "$REGISTRO_ARGV"; : > "$REGISTRO_PATCH"
bash "$GUION" > "$BASE/ensayo.txt" 2>&1; codigo=$?
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "no crea archivo de recuperacion" "$(si ! -f "$PENDIENTE")"
juzgar "la base no cambia" "$(si "$(bd)" = "$CLAVE_VIEJA")"
if grep -q "patch secret" "$REGISTRO_ARGV"; then v=0; else v=1; fi
juzgar "no llama a patch" "$v"
if grep -q "exec -i" "$REGISTRO_ARGV"; then v=0; else v=1; fi
juzgar "no llama a exec" "$v"

echo
echo "=== 13. muere al anotar alter_ok (el ALTER YA corrio): el archivo sobrevive ==="
# El caso de la revision: con `> archivo` en cada fase, morir entre truncar y
# escribir dejaba 0 bytes, y con la base ya cambiada se perdia la unica copia
# de la clave. Aca el proceso muere justo antes del rename de alter_ok.
reiniciar_estado
export MUERE_MV_EN_FASE=alter_ok
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la BASE ya tiene la nueva (el ALTER ocurrio antes de morir)" "$(si "$(bd)" = "$CLAVE_NUEVA")"
juzgar "el SECRET sigue con la vieja" "$(si "$(secreto)" = "$CLAVE_VIEJA")"
juzgar "el archivo NO quedo en 0 bytes" "$(si -s "$PENDIENTE")"
if pendiente_integro generada; then v=1; else v=0; fi
juzgar "conserva la version anterior integra: fase=generada y la clave" "$v"

echo
echo "=== 14. reanudar: comprueba contra la base, omite el ALTER y termina ==="
export MUERE_MV_EN_FASE=""
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if dice "YA acepta la clave nueva"; then v=1; else v=0; fi
juzgar "ve que el ALTER ya estaba (no lo infiere del archivo)" "$v"
if grep -q "ALTER USER" "$REGISTRO_ARGV" 2>/dev/null; then v=0; else v=1; fi
juzgar "NO repite el ALTER" "$v"
juzgar "el Secret quedo en sincronia" "$(si "$(secreto)" = "$CLAVE_NUEVA")"
juzgar "borra el archivo" "$(si ! -f "$PENDIENTE")"
juzgar "y tambien el temporal" "$(si ! -f "$PENDIENTE.tmp")"

echo
echo "=== 15. muere al anotar secret_ok (ALTER y patch YA corrieron) ==="
reiniciar_estado
export MUERE_MV_EN_FASE=secret_ok
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "la BASE tiene la nueva" "$(si "$(bd)" = "$CLAVE_NUEVA")"
juzgar "el SECRET tiene la nueva" "$(si "$(secreto)" = "$CLAVE_NUEVA")"
juzgar "el archivo NO quedo en 0 bytes" "$(si -s "$PENDIENTE")"
if pendiente_integro alter_ok; then v=1; else v=0; fi
juzgar "conserva la version anterior integra: fase=alter_ok y la clave" "$v"

echo
echo "=== 16. reanudar con base y Secret ya al dia: solo falta el rollout ==="
export MUERE_MV_EN_FASE=""
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if grep -q "ALTER USER" "$REGISTRO_ARGV" 2>/dev/null; then v=0; else v=1; fi
juzgar "NO repite el ALTER" "$v"
if grep -q "rollout restart" "$REGISTRO_ARGV"; then v=1; else v=0; fi
juzgar "SI hace los reinicios" "$v"
juzgar "borra el archivo" "$(si ! -f "$PENDIENTE")"

echo
echo "=== 17. el archivo vigente NUNCA se abre para escribir ==="
# Se deja el archivo de solo lectura. Una implementacion que lo trunque con
# `>` revienta aqui (y si no reventara, lo habria vaciado); el rename lo
# reemplaza sin abrirlo. Es la propiedad que evita el 0 bytes, probada directo.
reiniciar_estado
export FALLA_PATCH=1
codigo="$(correr)"          # deja fase=alter_ok, base nueva, Secret viejo
export FALLA_PATCH=0
chmod 400 "$PENDIENTE"
codigo="$(correr)"
chmod 600 "$PENDIENTE" 2>/dev/null
juzgar "sale con 0 aunque el archivo vigente sea de solo lectura" "$(si "$codigo" = "0")"
juzgar "el Secret quedo en sincronia" "$(si "$(secreto)" = "$CLAVE_NUEVA")"
juzgar "borra el archivo al terminar" "$(si ! -f "$PENDIENTE")"

echo
echo "=== 18. no se puede crear el temporal (directorio sin escritura) ==="
# Error de escritura, no muerte: el script tiene que fallar con mensaje y
# dejar el archivo vigente intacto. Solo en Linux: en Windows quitar el
# permiso de escritura a un directorio no impide crear archivos adentro, y
# como root tampoco.
reiniciar_estado
if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" != "0" ]; then
  export FALLA_PATCH=1
  codigo="$(correr)"          # deja fase=alter_ok, base nueva, Secret viejo
  export FALLA_PATCH=0
  chmod 500 "$HOME"
  codigo="$(correr)"
  chmod 700 "$HOME"
  juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
  if dice "no se pudo escribir el archivo de recuperación"; then v=1; else v=0; fi
  juzgar "dice que no pudo escribir y que el anterior sigue intacto" "$v"
  if pendiente_integro alter_ok; then v=1; else v=0; fi
  juzgar "el archivo vigente sigue integro: fase=alter_ok y la clave" "$v"
  codigo="$(correr)"
  juzgar "al volver a correr, reanuda y termina con 0" "$(si "$codigo" = "0")"
  juzgar "borra el archivo" "$(si ! -f "$PENDIENTE")"
else
  saltar "solo en Linux sin root (aqui: $(uname -s), uid $(id -u))"
fi

echo
echo "--------------------------------"
if [ "$saltados" != "0" ]; then
  echo "  $ok bien, $mal mal, $saltados saltados"
else
  echo "  $ok bien, $mal mal"
fi
[ "$mal" = "0" ] || exit 1
