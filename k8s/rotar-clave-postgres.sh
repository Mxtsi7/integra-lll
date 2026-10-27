#!/usr/bin/env bash
# Rota la contraseña de Postgres en el cluster.
#
#     ./k8s/rotar-clave-postgres.sh            # muestra qué haría, no toca nada
#     ./k8s/rotar-clave-postgres.sh --aplicar  # la rota de verdad
#
# ── Por qué hace falta ───────────────────────────────────────────────────────
# La clave estuvo en k8s/00-configuracion.yaml, dentro de un DATABASE_URL, en
# un repo público. El commit 971aa5e la sacó del archivo, pero sacarla del
# archivo NO la invalida: la base siguió usándola.
#
# Sobrevivió por dos razones que se sumaron:
#   1. desplegar.sh solo genera una clave aleatoria si el Secret NO existe. El
#      Secret ya existía de antes, así que esa rama nunca corrió.
#   2. POSTGRES_PASSWORD solo se aplica en el PRIMER arranque de Postgres. Una
#      vez inicializada la base, cambiar esa variable no cambia nada.
#
# Por eso no basta con editar el Secret: hay que cambiarla DENTRO de Postgres
# y dejar el Secret en sincronía.
#
# ── Ojo: hay una ventana de corte ────────────────────────────────────────────
# Entre el ALTER USER y el reinicio de los servicios, las conexiones que ya
# estaban abiertas siguen funcionando, pero las nuevas fallan. Django abre una
# conexión por petición (CONN_MAX_AGE=0), así que en la práctica el sitio
# responde error durante el reinicio: alrededor de un minuto. No correr esto
# durante la demo.
set -euo pipefail

APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

# Los que abren conexiones a la base. El gateway recibe el Secret pero no
# consulta Postgres, así que no se reinicia: sería corte sin motivo.
SERVICIOS=(auth subscriptions subscriptions-worker subscriptions-beat)

paso() { echo; echo "── $* ──"; }
mal()  { echo "ERROR: $*" >&2; exit 1; }

paso "comprobaciones previas"

kubectl get statefulset postgres >/dev/null 2>&1 || mal "no veo el StatefulSet de postgres; ¿contexto correcto?"
[ "$(kubectl get statefulset postgres -o jsonpath='{.status.readyReplicas}')" = "1" ] \
  || mal "postgres no está listo; no se rota con la base caída"

ACTUAL="$(kubectl get secret ojoalgasto -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
[ -n "$ACTUAL" ] || mal "el Secret no tiene POSTGRES_PASSWORD"
echo "   clave actual: ${#ACTUAL} caracteres"

# Se confirma que la que está viva es la publicada, para no rotar a ciegas una
# que alguien ya rotó. La huella se compara, el valor no se imprime nunca.
FILTRADA="$(git show 4e2af2c:k8s/00-configuracion.yaml 2>/dev/null \
  | grep -oE 'postgres://[^:]+:[^@]+@' | sed -E 's|postgres://[^:]+:||; s|@$||' | tr -d '\n' || true)"
if [ -n "$FILTRADA" ]; then
  if [ "$(printf %s "$ACTUAL" | sha256sum)" = "$(printf %s "$FILTRADA" | sha256sum)" ]; then
    echo "   coincide con la publicada en el historial: HAY QUE ROTARLA"
  else
    echo "   NO coincide con la publicada: parece que ya se rotó"
    echo "   si igual quieres rotarla, borra esta comprobación a mano"
    exit 0
  fi
fi

if [ "$APLICAR" != "1" ]; then
  paso "ensayo: esto es lo que haría"
  echo "   1. generar una clave nueva de 32 caracteres (openssl rand -hex 16)"
  echo "   2. ALTER USER postgres dentro del pod de la base"
  echo "   3. actualizar POSTGRES_PASSWORD y DATABASE_URL del Secret, en sincronía"
  echo "   4. reiniciar: ${SERVICIOS[*]}"
  echo "   5. comprobar el /health/ de cada servicio, que toca la base"
  echo "   6. comprobar, autenticando de verdad, que la clave vieja ya NO entra"
  echo
  echo "   para hacerlo de verdad: $0 --aplicar"
  exit 0
fi

# ── El archivo de recuperación ───────────────────────────────────────────────
# La clave nueva se escribe EN DISCO, con permisos 600, ANTES de tocar Postgres.
#
# Sin esto había un agujero que podía dejar al equipo sin base: el ALTER USER
# ocurre antes de actualizar el Secret, y si el `kubectl patch` fallaba, la
# clave nueva solo existía en una variable del shell. El script moría por
# `set -e` y nadie quedaba sabiendo la contraseña: la base con una clave
# desconocida y el Secret con la vieja. Lo encontró la revisión de la PR.
#
# Si el archivo existe al arrancar, es que una corrida anterior quedó a medias:
# se REANUDA con esa clave en vez de generar otra a ciegas. Generar una nueva
# dejaría la primera huérfana para siempre.
#
# Se borra recién cuando todo verificó.
RECUPERACION="${HOME}/.ojoalgasto-rotacion-pendiente"

if [ -f "$RECUPERACION" ]; then
  paso "hay una rotación a medias"
  echo "   $RECUPERACION existe: una corrida anterior no terminó."
  echo "   Se REANUDA con esa clave; no se genera otra."
  echo "   (si estás seguro de que no hace falta, borra el archivo a mano)"
  NUEVA="$(cat "$RECUPERACION")"
  [ -n "$NUEVA" ] || mal "el archivo de recuperación está vacío; revísalo a mano"
  REANUDANDO=1
else
  # hex: sin comillas ni escapes que romper en el SQL ni en el JSON
  NUEVA="$(openssl rand -hex 16)"
  REANUDANDO=0
  ( umask 077; printf %s "$NUEVA" > "$RECUPERACION" )
  echo
  echo "   clave nueva guardada en $RECUPERACION (permisos 600)"
  echo "   se borra sola cuando todo verifique"
fi

# Los temporales llevan la clave adentro: se limpian pase lo que pase.
TEMPORALES=()
limpiar() { [ "${#TEMPORALES[@]}" -gt 0 ] && rm -f "${TEMPORALES[@]}"; }
trap limpiar EXIT

if [ "$REANUDANDO" = "1" ]; then
  paso "1/5 · el ALTER USER ya se había hecho; se omite"
  echo "   (la clave del archivo de recuperación ya está en la base)"
else
  paso "1/5 · cambiando la clave dentro de Postgres"
  # Va por stdin y no como argumento: así no queda en la lista de procesos del
  # pod ni en el historial del shell.
  #
  # ON_ERROR_STOP=1 es obligatorio: sin eso, psql leyendo un script por stdin
  # puede terminar con código 0 aunque la sentencia haya sido rechazada, y el
  # `|| mal` no se dispara. Entonces el Secret se actualizaba con una clave que
  # la base nunca llegó a tener. Lo encontró la revisión de la PR.
  printf "ALTER USER postgres WITH PASSWORD '%s';\n" "$NUEVA" \
    | kubectl exec -i statefulset/postgres -- \
        psql -U postgres -d suscripciones -q -v ON_ERROR_STOP=1 \
    || mal "el ALTER USER falló; no se tocó el Secret, el sistema sigue como estaba"
  echo "   hecho"
fi

paso "2/5 · actualizando el Secret"
# ── Por qué un archivo y no `-p "$json"` ─────────────────────────────────────
# `kubectl patch -p "$json"` pone la contraseña en los ARGUMENTOS del proceso,
# visibles en el `ps` de cualquiera en esta máquina. Lo mismo pasaba al armar
# el JSON con `python -c ... "$NUEVA"`. Las dos cosas las encontró la revisión
# de la PR, y eran ciertas: el ALTER USER iba por stdin, pero estos dos no.
#
# Ahora el JSON se arma leyendo la clave por STDIN y se aplica desde un archivo
# con permisos 600 que se borra en el trap.
PATCH="$(mktemp)"
TEMPORALES+=("$PATCH")
chmod 600 "$PATCH"
printf %s "$NUEVA" | python -c "
import json, sys
clave = sys.stdin.read()
# Los dos campos juntos en un solo patch: si quedaran desincronizados, los
# servicios no podrían conectar y el arreglo sería a mano.
print(json.dumps({'stringData': {
    'POSTGRES_PASSWORD': clave,
    'DATABASE_URL': f'postgres://postgres:{clave}@postgres:5432/suscripciones',
}}))
" > "$PATCH" || mal "no se pudo armar el patch; la clave nueva está en $RECUPERACION"

kubectl patch secret ojoalgasto --type=merge --patch-file "$PATCH" >/dev/null \
  || mal "el patch del Secret falló. La base YA tiene la clave nueva y el Secret no.
  La clave está en $RECUPERACION — NO borres ese archivo.
  Vuelve a correr este script: detecta el estado a medias y reanuda."
echo "   POSTGRES_PASSWORD y DATABASE_URL al día"

paso "3/5 · reiniciando los servicios que conectan a la base"
for s in "${SERVICIOS[@]}"; do
  deseadas="$(kubectl get "deployment/$s" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  if [ "${deseadas:-0}" = "0" ]; then
    echo "   $s: en 0 réplicas, se omite"
    continue
  fi
  kubectl rollout restart "deployment/$s" >/dev/null
done
for s in "${SERVICIOS[@]}"; do
  deseadas="$(kubectl get "deployment/$s" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  [ "${deseadas:-0}" = "0" ] && continue
  kubectl rollout status "deployment/$s" --timeout=180s \
    || mal "el reinicio de $s no terminó. La clave está en $RECUPERACION — NO lo borres.
  Revisa los pods y vuelve a correr este script para reanudar."
done

# ── A partir de acá se ACUMULAN fallos ───────────────────────────────────────
# Antes, un /health/ caído solo imprimía "no responde" y el script seguía hasta
# anunciar "Listo. La clave publicada ya no sirve." con código 0. O sea que
# decía que todo estaba bien justo cuando no lo estaba. Lo encontró la revisión
# de la PR. Ahora cada fallo suma y el código de salida lo refleja.
FALLOS=0

paso "4/5 · comprobando que cada servicio llega a su esquema"
for s in auth subscriptions; do
  printf "   %-16s " "$s"
  if kubectl exec "deployment/$s" -- python -c "
import urllib.request, json, sys
try:
    r = json.load(urllib.request.urlopen('http://localhost:800' + ('1' if '$s'=='auth' else '2') + '/health/', timeout=5))
    if r.get('estado') != 'ok':
        print('estado inesperado:', r.get('estado')); sys.exit(1)
    print(r.get('estado'), '· esquema', r.get('esquema'))
except Exception as e:
    print('FALLA:', e); sys.exit(1)
" 2>/dev/null; then :; else
    echo "   ↑ no responde o no está ok"
    FALLOS=$((FALLOS + 1))
  fi
done

paso "5/5 · comprobando que la clave VIEJA ya no entra"
# La comparación del principio lee el Secret; eso no prueba qué acepta la base.
# Acá se intenta autenticar de verdad con la clave anterior: tiene que fallar.
#
# La clave va por stdin a un `sh -c` que la mete en el entorno de psql, no en
# sus argumentos: así no aparece en ningún `ps`. Queda en el entorno de ese
# proceso mientras dure, que es lo menos malo disponible con kubectl exec; se
# dice para que nadie crea que es hermético.
printf "   clave anterior… "
if printf %s "$ACTUAL" | kubectl exec -i statefulset/postgres -- sh -c '
  read -r p
  PGPASSWORD="$p" psql -h 127.0.0.1 -U postgres -d suscripciones \
    -q -v ON_ERROR_STOP=1 -c "select 1" >/dev/null 2>&1
' ; then
  echo "TODAVÍA ENTRA"
  echo "   ↑ la rotación no surtió efecto: la clave publicada sigue sirviendo"
  FALLOS=$((FALLOS + 1))
else
  echo "rechazada (correcto)"
fi

printf "   clave nueva…    "
if printf %s "$NUEVA" | kubectl exec -i statefulset/postgres -- sh -c '
  read -r p
  PGPASSWORD="$p" psql -h 127.0.0.1 -U postgres -d suscripciones \
    -q -v ON_ERROR_STOP=1 -c "select 1" >/dev/null 2>&1
' ; then
  echo "entra (correcto)"
else
  echo "NO ENTRA"
  echo "   ↑ la base no acepta la clave nueva; algo quedó a medias"
  FALLOS=$((FALLOS + 1))
fi

echo
if [ "$FALLOS" -gt 0 ]; then
  echo "TERMINÓ CON $FALLOS COMPROBACIÓN(ES) FALLIDA(S)."
  echo "La clave nueva sigue en $RECUPERACION — NO la borres hasta resolverlo."
  echo "Vuelve a correr este script cuando lo arregles: reanuda sin generar otra."
  exit 1
fi

rm -f "$RECUPERACION"
echo "Listo, y verificado: la clave publicada ya no entra a la base."
echo "Sigue en el historial del repo, pero no abre nada."
echo "($RECUPERACION borrado.)"
