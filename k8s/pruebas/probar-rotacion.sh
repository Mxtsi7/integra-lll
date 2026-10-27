#!/usr/bin/env bash
# Prueba k8s/rotar-clave-postgres.sh con kubectl, openssl y git DOBLES.
#
#     bash k8s/pruebas/probar-rotacion.sh
#
# Nunca toca un cluster ni una base: todo son stubs y la clave es sintetica.
#
# Existe porque ese script puede dejar al equipo sin base de datos y no se
# puede "probar en produccion a ver que pasa". Lo que comprueba:
#
#   · que ninguna clave aparezca en los ARGUMENTOS de un proceso (`ps`)
#   · que si falla el patch del Secret quede el archivo de recuperacion, el
#     script avise y NO anuncie exito
#   · que una segunda corrida REANUDE con esa clave y no genere otra
#   · que un /health/ caido, un rollout fallido o una clave vieja que todavia
#     entra den codigo de salida distinto de 0
#   · que el modo ensayo no llame a patch ni a exec
#
# Los cinco salieron de la revision de la PR #108; los cinco eran reales.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUION="$AQUI/../rotar-clave-postgres.sh"
BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT
DOBLES="$BASE/bin"
mkdir -p "$DOBLES"

CLAVE_VIEJA="aaaaaaaa"
CLAVE_NUEVA="b1b2b3b4b5b6b7b8b9c0c1c2c3c4c5c6"
export HOME="$BASE/home"; mkdir -p "$HOME"
PENDIENTE="$HOME/.ojoalgasto-rotacion-pendiente"

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

cat > "$DOBLES/kubectl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "\$REGISTRO_ARGV"
case "\$1 \${2:-}" in
  "get statefulset") echo 1; exit 0 ;;
  "get secret")      printf %s "$CLAVE_VIEJA" | base64 -w0; exit 0 ;;
  "get deployment"*)  echo 1; exit 0 ;;
  "patch secret")
      for a in "\$@"; do
        [ -f "\$a" ] && cat "\$a" >> "\$REGISTRO_PATCH"
      done
      exit \${FALLA_PATCH:-0} ;;
  "rollout restart") exit 0 ;;
  "rollout status")  exit \${FALLA_ROLLOUT:-0} ;;
  "exec -i")
      recibido="\$(cat)"
      # El ALTER USER va con psql directo; las comprobaciones de clave con
      # `sh -c`. Y entre esas dos hay que distinguir CUAL clave se probo:
      # la vieja tiene que ser rechazada y la nueva aceptada. El doble lo
      # decide mirando lo que le llega por stdin, igual que haria la base.
      case "\$*" in
        *"sh -c"*)
            if [ "\$recibido" = "$CLAVE_VIEJA" ]; then
              exit \${FALLA_EXEC_I:-1}   # 1 = rechazada (lo correcto)
            else
              exit \${FALLA_CLAVE_NUEVA:-0}   # 0 = entra (lo correcto)
            fi ;;
        *) exit \${FALLA_ALTER:-0} ;;
      esac ;;
  "exec deployment/auth"|"exec deployment/subscriptions")
      echo "ok . esquema x"; exit \${FALLA_HEALTH:-0} ;;
esac
exit 0
EOF
chmod +x "$DOBLES"/*
export PATH="$DOBLES:$PATH"

export REGISTRO_ARGV="$BASE/argv.txt"
export REGISTRO_PATCH="$BASE/patch.txt"

correr() {
  : > "$REGISTRO_ARGV"
  : > "$REGISTRO_PATCH"
  bash "$GUION" --aplicar > "$BASE/salida.txt" 2>&1
  echo $?
}

ok=0; mal=0
juzgar() {
  if [ "$2" = "1" ]; then echo "  [ OK    ] $1"; ok=$((ok+1))
  else echo "  [ FALLA ] $1"; mal=$((mal+1)); fi
}
# OJO: `test "$@"` y no `[ "$1" ]`. La primera version ignoraba la
# comparacion y devolvia 1 siempre, asi que varias aserciones pasaban en
# vacio. El arnes mentia.
si() { if test "$@"; then echo 1; else echo 0; fi; }

echo "=== 1. camino feliz ==="
rm -f "$PENDIENTE"
export FALLA_ALTER=${FALLA_ALTER:-0} FALLA_PATCH=0 FALLA_ROLLOUT=0 FALLA_HEALTH=0 FALLA_EXEC_I=1
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "borra el archivo de recuperacion" "$(si ! -f "$PENDIENTE")"
if grep -qF "$CLAVE_NUEVA" "$REGISTRO_ARGV"; then fuga_n=0; else fuga_n=1; fi
juzgar "la clave NUEVA no aparece en ningun argv" "$fuga_n"
if grep -qF "$CLAVE_VIEJA" "$REGISTRO_ARGV"; then fuga_v=0; else fuga_v=1; fi
juzgar "la clave VIEJA no aparece en ningun argv" "$fuga_v"
if grep -qF "$CLAVE_NUEVA" "$REGISTRO_PATCH"; then en_patch=1; else en_patch=0; fi
juzgar "la clave nueva SI viaja en el archivo de patch" "$en_patch"
if grep -q -- "--patch-file" "$REGISTRO_ARGV"; then pf=1; else pf=0; fi
juzgar "usa --patch-file" "$pf"
if grep -q "ON_ERROR_STOP=1" "$REGISTRO_ARGV"; then oes=1; else oes=0; fi
juzgar "pasa ON_ERROR_STOP=1 a psql" "$oes"

echo
echo "=== 2. falla el patch del Secret (el caso grave) ==="
rm -f "$PENDIENTE"
export FALLA_ALTER=${FALLA_ALTER:-0} FALLA_PATCH=1 FALLA_ROLLOUT=0 FALLA_HEALTH=0 FALLA_EXEC_I=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "CONSERVA el archivo de recuperacion" "$(si -f "$PENDIENTE")"
juzgar "el archivo tiene la clave nueva" "$(si "$(cat "$PENDIENTE" 2>/dev/null)" = "$CLAVE_NUEVA")"
if grep -q "NO borres" "$BASE/salida.txt"; then avisa=1; else avisa=0; fi
juzgar "avisa que no se borre" "$avisa"
if grep -q "ya no entra a la base" "$BASE/salida.txt"; then exito=0; else exito=1; fi
juzgar "no anuncia exito" "$exito"

echo
echo "=== 3. reanudacion con el archivo presente ==="
export FALLA_ALTER=${FALLA_ALTER:-0} FALLA_PATCH=0 FALLA_ROLLOUT=0 FALLA_HEALTH=0 FALLA_EXEC_I=1
codigo="$(correr)"
juzgar "sale con 0" "$(si "$codigo" = "0")"
if grep -q "a medias" "$BASE/salida.txt"; then rea=1; else rea=0; fi
juzgar "dice que reanuda" "$rea"
if grep -q "ya se" "$BASE/salida.txt"; then omite=1; else omite=0; fi
juzgar "NO repite el ALTER USER" "$omite"
juzgar "ahora si borra el archivo" "$(si ! -f "$PENDIENTE")"

echo
echo "=== 4. el /health/ falla ==="
rm -f "$PENDIENTE"
export FALLA_ALTER=${FALLA_ALTER:-0} FALLA_PATCH=0 FALLA_ROLLOUT=0 FALLA_HEALTH=1 FALLA_EXEC_I=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if grep -q "ya no entra a la base" "$BASE/salida.txt"; then e4=0; else e4=1; fi
juzgar "NO anuncia exito" "$e4"
juzgar "conserva el archivo" "$(si -f "$PENDIENTE")"

echo
echo "=== 5. la clave vieja TODAVIA entra ==="
rm -f "$PENDIENTE"
export FALLA_ALTER=${FALLA_ALTER:-0} FALLA_PATCH=0 FALLA_ROLLOUT=0 FALLA_HEALTH=0 FALLA_EXEC_I=0
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
if grep -q "ENTRA" "$BASE/salida.txt"; then av5=1; else av5=0; fi
juzgar "avisa que la publicada sigue sirviendo" "$av5"

echo
echo "=== 6. falla el rollout ==="
rm -f "$PENDIENTE"
export FALLA_ALTER=${FALLA_ALTER:-0} FALLA_PATCH=0 FALLA_ROLLOUT=1 FALLA_HEALTH=0 FALLA_EXEC_I=1
codigo="$(correr)"
juzgar "sale distinto de 0" "$(si "$codigo" != "0")"
juzgar "conserva el archivo" "$(si -f "$PENDIENTE")"

echo
echo "=== 7. modo ensayo no toca nada ==="
rm -f "$PENDIENTE"
REGISTRO_ARGV="$BASE/argv2.txt"; : > "$REGISTRO_ARGV"
REGISTRO_PATCH="$BASE/patch2.txt"; : > "$REGISTRO_PATCH"
bash "$GUION" > "$BASE/ensayo.txt" 2>&1; codigo=$?
juzgar "sale con 0" "$(si "$codigo" = "0")"
juzgar "no crea archivo de recuperacion" "$(si ! -f "$PENDIENTE")"
if grep -q "patch secret" "$REGISTRO_ARGV"; then p7=0; else p7=1; fi
juzgar "no llama a patch" "$p7"
if grep -q "^exec" "$REGISTRO_ARGV"; then e7=0; else e7=1; fi
juzgar "no llama a exec" "$e7"

echo
echo "--------------------------------"
echo "  $ok bien, $mal mal"
[ "$mal" = "0" ] || exit 1
