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
#
# ── Cómo se recupera de una corrida a medias ─────────────────────────────────
# El archivo de recuperación guarda FASES, no solo la clave. Y antes de
# saltarse un paso se COMPRUEBA el estado efectivo de la base, no se infiere
# del archivo: que exista el archivo no demuestra que el ALTER haya ocurrido.
# Ver `leer_pendiente` más abajo.
set -euo pipefail

APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

# Los que abren conexiones a la base. El gateway recibe el Secret pero no
# consulta Postgres, así que no se reinicia: sería corte sin motivo.
SERVICIOS=(auth subscriptions subscriptions-worker subscriptions-beat)
SECRETO=ojoalgasto

paso() { echo; echo "── $* ──"; }
mal()  { echo "ERROR: $*" >&2; exit 1; }
huella() { printf %s "$1" | sha256sum | cut -d' ' -f1; }

# ── El archivo de recuperación ───────────────────────────────────────────────
# Guarda la clave nueva (600) Y en qué fase quedó la operación. Sin las fases,
# la sola existencia del archivo hacía que la corrida siguiente se saltara el
# ALTER: si el ALTER había fallado, el Secret terminaba con una clave que la
# base nunca recibió. Justo la desincronización que este script evita.
#
# Guarda también a QUÉ destino pertenece (contexto, namespace, Secret) y la
# huella de la clave anterior, para no reanudar sobre otro cluster ni perder
# la referencia de cuál era la vieja.
RECUPERACION="${HOME}/.ojoalgasto-rotacion-pendiente"

FASE_GENERADA=generada      # hay clave nueva; el ALTER puede o no haber corrido
FASE_ALTER=alter_ok         # la base YA acepta la clave nueva
FASE_SECRET=secret_ok       # el Secret ya está en sincronía
FASE_ROLLOUT=rollout_ok     # los servicios ya reiniciaron

CONTEXTO="$(kubectl config current-context 2>/dev/null || echo desconocido)"
NAMESPACE="$(kubectl config view --minify -o jsonpath='{..namespace}' 2>/dev/null || true)"
NAMESPACE="${NAMESPACE:-default}"
DESTINO="${CONTEXTO}|${NAMESPACE}|${SECRETO}"

# ── Se escribe COMPLETO en un temporal y se reemplaza con un rename ─────────
# La primera versión hacía `> "$RECUPERACION"` en cada fase. Esa redirección
# TRUNCA antes de escribir: si el proceso moría entre truncar y terminar (la
# revisión lo reprodujo con un SIGKILL: archivo de 0 bytes), se perdía la
# única copia de la clave nueva con la base ya cambiada y el Secret viejo.
# Justo el estado que este archivo existe para poder recuperar.
#
# Ahora el archivo vigente NUNCA se abre para escribir. La versión nueva se
# escribe entera en `$RECUPERACION.tmp` (mismo directorio, permisos 600) y
# recién cuando está completa se renombra encima: en el mismo sistema de
# archivos `mv` es un rename, y un rename es atómico. Si el proceso muere en
# cualquier punto, sobrevive la versión anterior íntegra, con la misma clave
# (la clave no cambia entre fases; solo cambia la fase anotada).
#
# El temporal que pueda quedar de una muerte anterior no hace falta para
# recuperar —la clave ya está en el archivo vigente— y se pisa en la escritura
# siguiente; al terminar bien se borra junto con el archivo.
escribir_pendiente() {  # $1 = fase, $2 = clave, $3 = huella de la anterior
  local temporal="$RECUPERACION.tmp"
  rm -f "$temporal"
  ( umask 077
    {
      echo "version=1"
      echo "destino=$DESTINO"
      echo "fase=$1"
      echo "anterior_sha256=$3"
      echo "clave=$2"
    } > "$temporal"
  ) || { rm -f "$temporal"
         mal "no se pudo escribir el archivo de recuperación (fase $1).
  El anterior sigue intacto en $RECUPERACION; no se tocó."; }
  grep -q '^clave=.' "$temporal" \
    || { rm -f "$temporal"
         mal "el archivo de recuperación quedó incompleto al escribir la fase $1.
  El anterior sigue intacto en $RECUPERACION; no se tocó."; }
  mv -f "$temporal" "$RECUPERACION" \
    || { rm -f "$temporal"
         mal "no se pudo reemplazar el archivo de recuperación (fase $1).
  El anterior sigue intacto en $RECUPERACION; no se tocó."; }
}

leer_pendiente() {  # deja PEND_FASE, PEND_CLAVE, PEND_ANTERIOR o devuelve 1
  [ -f "$RECUPERACION" ] || return 1
  PEND_FASE=""; PEND_CLAVE=""; PEND_ANTERIOR=""; local destino=""
  while IFS='=' read -r llave valor; do
    case "$llave" in
      fase)            PEND_FASE="$valor" ;;
      clave)           PEND_CLAVE="$valor" ;;
      anterior_sha256) PEND_ANTERIOR="$valor" ;;
      destino)         destino="$valor" ;;
    esac
  done < "$RECUPERACION"
  [ -n "$PEND_CLAVE" ] || mal "el archivo de recuperación no tiene clave; revísalo a mano"
  if [ "$destino" != "$DESTINO" ]; then
    mal "el archivo de recuperación es de OTRO destino ($destino), no de $DESTINO.
  No se reanuda a ciegas sobre un cluster distinto. Revísalo a mano."
  fi
  return 0
}

# ── Comprobar la clave CONTRA LA BASE, no contra el Secret ───────────────────
# El Secret dice lo que creemos, la base dice lo que es. Distinguirlos es lo
# que permite saber si un ALTER a medias llegó a ocurrir.
#
# La clave va por stdin a un `sh -c` que la mete en el entorno de psql, no en
# sus argumentos: así no aparece en ningún `ps`. Queda en el entorno de ese
# proceso mientras dure, que es lo menos malo disponible con kubectl exec; se
# dice para que nadie crea que es hermético.
entra_en_la_base() {  # $1 = clave. 0 si entra, 1 si no
  printf %s "$1" | kubectl exec -i statefulset/postgres -- sh -c '
    read -r p
    PGPASSWORD="$p" psql -h 127.0.0.1 -U postgres -d suscripciones \
      -q -v ON_ERROR_STOP=1 -c "select 1" >/dev/null 2>&1
  '
}

paso "comprobaciones previas"

kubectl get statefulset postgres >/dev/null 2>&1 || mal "no veo el StatefulSet de postgres; ¿contexto correcto?"
[ "$(kubectl get statefulset postgres -o jsonpath='{.status.readyReplicas}')" = "1" ] \
  || mal "postgres no está listo; no se rota con la base caída"

ACTUAL="$(kubectl get secret "$SECRETO" -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
[ -n "$ACTUAL" ] || mal "el Secret no tiene POSTGRES_PASSWORD"
echo "   clave del Secret: ${#ACTUAL} caracteres"
echo "   destino: $DESTINO"

# ── Lo PRIMERO: ¿hay una operación a medias? ─────────────────────────────────
# Antes esta comprobación venía DESPUÉS de la de "ya se rotó", y eso dejaba un
# caso sin salida: ALTER correcto + Secret correcto + rollout o health
# fallido. En la corrida siguiente el Secret ya tiene la clave nueva, así que
# no coincide con la publicada, el script decía "ya se rotó" y salía con 0 sin
# reanudar los reinicios ni las verificaciones.
REANUDANDO=0
NUEVA=""
ANTERIOR_HUELLA=""
FASE="$FASE_GENERADA"

if leer_pendiente; then
  paso "hay una rotación a medias"
  echo "   $RECUPERACION, fase anotada: $PEND_FASE"
  REANUDANDO=1
  NUEVA="$PEND_CLAVE"
  ANTERIOR_HUELLA="$PEND_ANTERIOR"
  FASE="$PEND_FASE"

  if [ "$APLICAR" != "1" ]; then
    echo "   en modo ensayo no se reanuda. Para continuarla: $0 --aplicar"
    exit 0
  fi

  # ── No se CREE la fase: se COMPRUEBA ───────────────────────────────────────
  # `fase=generada` significa "se generó la clave", no "el ALTER ocurrió": el
  # archivo se escribe antes de tocar la base a propósito, para no perderla.
  # Así que se le pregunta a la base cuál acepta.
  echo "   comprobando contra la base qué clave acepta…"
  if entra_en_la_base "$NUEVA"; then
    echo "   la base YA acepta la clave nueva"
    [ "$FASE" = "$FASE_GENERADA" ] && FASE="$FASE_ALTER"
  else
    echo "   la base todavía NO acepta la clave nueva: el ALTER no llegó a ocurrir"
    if [ "$FASE" != "$FASE_GENERADA" ]; then
      mal "el archivo dice fase=$FASE pero la base no acepta esa clave.
  Estado inconsistente: no se toca nada. Revísalo a mano antes de seguir."
    fi
  fi
else
  if [ "$APLICAR" = "1" ]; then
    # Solo se exige esto en una rotación NUEVA. Si hay uno a medias, la clave
    # del Secret ya puede ser la nueva y esta comprobación no aplica.
    FILTRADA="$(git show 4e2af2c:k8s/00-configuracion.yaml 2>/dev/null \
      | grep -oE 'postgres://[^:]+:[^@]+@' | sed -E 's|postgres://[^:]+:||; s|@$||' | tr -d '\n' || true)"
    if [ -n "$FILTRADA" ]; then
      if [ "$(huella "$ACTUAL")" = "$(huella "$FILTRADA")" ]; then
        echo "   coincide con la publicada en el historial: HAY QUE ROTARLA"
      else
        echo "   NO coincide con la publicada: parece que ya se rotó"
        echo "   (y no hay ninguna operación pendiente que reanudar)"
        exit 0
      fi
    fi
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

# Los temporales llevan la clave adentro: se limpian pase lo que pase.
TEMPORALES=()
limpiar() {
  # El `return 0` NO es decorativo: esta funcion corre en un trap EXIT, y el
  # estado con que termina PASA A SER el del script. Con `[ 0 -gt 0 ] && rm`,
  # cuando no habia temporales el test fallaba, el && cortaba, la funcion
  # devolvia 1 y el script salia con 1 despues de haber impreso "Listo".
  # Pasaba justo al reanudar, que es cuando el patch se omite y no hay
  # temporales. Lo encontro el arnes con dobles con estado.
  if [ "${#TEMPORALES[@]}" -gt 0 ]; then
    rm -f "${TEMPORALES[@]}"
  fi
  return 0
}
trap limpiar EXIT

if [ "$REANUDANDO" != "1" ]; then
  # hex: sin comillas ni escapes que romper en el SQL ni en el JSON
  NUEVA="$(openssl rand -hex 16)"
  ANTERIOR_HUELLA="$(huella "$ACTUAL")"
  escribir_pendiente "$FASE_GENERADA" "$NUEVA" "$ANTERIOR_HUELLA"
  echo
  echo "   clave nueva guardada en $RECUPERACION (permisos 600)"
  echo "   se borra sola cuando todo verifique"
fi

if [ "$FASE" = "$FASE_GENERADA" ]; then
  paso "1/5 · cambiando la clave dentro de Postgres"
  # Va por stdin y no como argumento: así no queda en la lista de procesos del
  # pod ni en el historial del shell.
  #
  # ON_ERROR_STOP=1 es obligatorio: sin eso, psql leyendo un script por stdin
  # puede terminar con código 0 aunque la sentencia haya sido rechazada, y el
  # `|| mal` no se dispara. Entonces el Secret se actualizaba con una clave que
  # la base nunca llegó a tener.
  printf "ALTER USER postgres WITH PASSWORD '%s';\n" "$NUEVA" \
    | kubectl exec -i statefulset/postgres -- \
        psql -U postgres -d suscripciones -q -v ON_ERROR_STOP=1 \
    || mal "el ALTER USER falló; no se tocó el Secret, el sistema sigue como estaba.
  La clave generada quedó en $RECUPERACION con fase=$FASE_GENERADA; al volver a
  correr se comprueba contra la base y se reintenta el ALTER."
  # La fase se anota DESPUÉS de que la base lo confirmó.
  escribir_pendiente "$FASE_ALTER" "$NUEVA" "$ANTERIOR_HUELLA"
  FASE="$FASE_ALTER"
  echo "   hecho"
else
  paso "1/5 · el ALTER USER ya está hecho (comprobado contra la base); se omite"
fi

if [ "$FASE" = "$FASE_ALTER" ]; then
  paso "2/5 · actualizando el Secret"
  # ── Por qué un archivo y no `-p "$json"` ───────────────────────────────────
  # `kubectl patch -p "$json"` pone la contraseña en los ARGUMENTOS del
  # proceso, visibles en el `ps` de cualquiera en esta máquina. Lo mismo pasaba
  # al armar el JSON con `python -c ... "$NUEVA"`.
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

  kubectl patch secret "$SECRETO" --type=merge --patch-file "$PATCH" >/dev/null \
    || mal "el patch del Secret falló. La base YA tiene la clave nueva y el Secret no.
  La clave está en $RECUPERACION — NO borres ese archivo.
  Vuelve a correr este script: detecta el estado a medias y reanuda."
  escribir_pendiente "$FASE_SECRET" "$NUEVA" "$ANTERIOR_HUELLA"
  FASE="$FASE_SECRET"
  echo "   POSTGRES_PASSWORD y DATABASE_URL al día"
else
  paso "2/5 · el Secret ya está en sincronía; se omite"
fi

if [ "$FASE" = "$FASE_SECRET" ]; then
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
  Revisa los pods y vuelve a correr este script para reanudar desde acá."
  done
  escribir_pendiente "$FASE_ROLLOUT" "$NUEVA" "$ANTERIOR_HUELLA"
  FASE="$FASE_ROLLOUT"
else
  paso "3/5 · los servicios ya reiniciaron; se omite"
fi

# ── A partir de acá se ACUMULAN fallos ───────────────────────────────────────
# Antes, un /health/ caído solo imprimía "no responde" y el script seguía hasta
# anunciar "Listo. La clave publicada ya no sirve." con código 0. O sea que
# decía que todo estaba bien justo cuando no lo estaba.
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

paso "5/5 · comprobando contra la base qué clave entra"
# ── Por qué la huella viene del archivo y no de $ACTUAL ──────────────────────
# Al reanudar, el Secret YA puede tener la clave nueva, así que `$ACTUAL` sería
# la nueva y comprobar "la anterior" con ella no probaría nada. La huella de la
# verdadera anterior se guardó en el archivo cuando todavía se sabía cuál era.
printf "   clave nueva…      "
if entra_en_la_base "$NUEVA"; then
  echo "entra (correcto)"
else
  echo "NO ENTRA"
  echo "   ↑ la base no acepta la clave nueva; algo quedó a medias"
  FALLOS=$((FALLOS + 1))
fi

printf "   clave anterior…   "
if [ "$REANUDANDO" = "1" ] && [ "$(huella "$ACTUAL")" = "$ANTERIOR_HUELLA" ]; then
  ANTERIOR="$ACTUAL"
elif [ "$REANUDANDO" != "1" ]; then
  ANTERIOR="$ACTUAL"
else
  ANTERIOR=""
fi

if [ -z "$ANTERIOR" ]; then
  # Reanudando después de parchear el Secret: ya no tenemos el valor de la
  # anterior, solo su huella. Se dice en vez de comprobar la que no es.
  echo "no se puede comprobar"
  echo "   ↑ al reanudar, el Secret ya tiene la clave nueva y el valor de la"
  echo "     anterior no se guarda (solo su huella). Lo que sí está verificado"
  echo "     es que la base acepta la nueva, y el ALTER reemplaza la anterior."
elif entra_en_la_base "$ANTERIOR"; then
  echo "TODAVÍA ENTRA"
  echo "   ↑ la rotación no surtió efecto: la clave publicada sigue sirviendo"
  FALLOS=$((FALLOS + 1))
else
  echo "rechazada (correcto)"
fi

echo
if [ "$FALLOS" -gt 0 ]; then
  echo "TERMINÓ CON $FALLOS COMPROBACIÓN(ES) FALLIDA(S)."
  echo "La clave nueva sigue en $RECUPERACION — NO la borres hasta resolverlo."
  echo "Vuelve a correr este script cuando lo arregles: reanuda sin generar otra."
  exit 1
fi

rm -f "$RECUPERACION" "$RECUPERACION.tmp"
if [ -n "$ANTERIOR" ]; then
  echo "Listo, y verificado: la base acepta la clave nueva y rechaza la anterior."
else
  echo "Listo. Verificado que la base acepta la clave nueva."
  echo "El rechazo de la anterior no se pudo comprobar en esta corrida (ver 5/5)."
fi
echo "La publicada sigue en el historial del repo, pero no abre nada."
echo "($RECUPERACION borrado.)"
