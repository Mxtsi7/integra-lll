#!/usr/bin/env bash
# Crea en el broker el usuario que declara el Secret `ojoalgasto-rabbitmq`.
# Ejecutado por desplegar.sh DESPUES de que el broker queda arriba.
#
# ── Por que hace falta un guion aparte ──────────────────────────────────────
# `RABBITMQ_DEFAULT_USER` y `RABBITMQ_DEFAULT_PASS` SOLO crean el usuario en el
# PRIMER arranque, y solo si el directorio de datos esta vacio. El broker tiene
# un PVC, asi que en cualquier instalacion que ya existia esas variables no
# hacen nada: el broker queda con `guest` y los clientes --que vienen con
# `amqp://ojoalgasto:...` desde el mismo Secret-- no pueden autenticarse.
#
# Paso exactamente eso al desplegar D-11 el 31-10: el broker arranco bien y
# `consumidor-eventos` quedo en CrashLoopBackOff con `AMQPConnectionError`,
# porque `rabbitmqctl list_users` devolvia solo `guest`.
#
# Es el equivalente de `configurar-usuarios-bd.sh` para Postgres, que si
# existe. Conserva credenciales: no rota nada, solo deja el broker de acuerdo
# con el Secret.
#
# ── La trampa de la entrada estandar ───────────────────────────────────────
# El guion remoto se arma en una VARIABLE y se pasa con `sh -c`, no con un
# heredoc. Un heredoc redirige la entrada de `kubectl exec` y se come la
# tuberia que trae la clave: `read` llega a fin de archivo y el guion muere
# con salida 1 sin imprimir nada. Ya paso.
set -euo pipefail

SECRETO="ojoalgasto-rabbitmq"
VHOST="${VHOST:-/}"

usuario="$(kubectl get secret "$SECRETO" -o jsonpath='{.data.RABBITMQ_USER}' | base64 -d)"
if [ -z "$usuario" ]; then
  echo "El Secret $SECRETO no declara RABBITMQ_USER." >&2
  exit 1
fi
if [ "$usuario" = "guest" ]; then
  echo "El Secret declara 'guest'; no se toca el usuario por omision." >&2
  exit 1
fi

# `cat` consume el heredoc, no `kubectl exec`: asi la entrada estandar del
# exec queda libre para la tuberia con la clave.
REMOTO="$(cat <<'EOS'
set -eu
USUARIO="$1"
VHOST="$2"

read -r CLAVE || { echo "No llego la clave por la entrada estandar." >&2; exit 1; }
[ -n "$CLAVE" ] || { echo "La clave del Secret vino vacia." >&2; exit 1; }

# `list_users` sale separado por tabulacion: usuario y etiquetas.
if rabbitmqctl --quiet list_users | cut -f1 | grep -qx "$USUARIO"; then
  # Ya existe: se alinea la clave con la del Secret en vez de fallar, para que
  # el guion se pueda volver a correr despues de rotar el Secret.
  rabbitmqctl --quiet change_password "$USUARIO" "$CLAVE"
  echo "usuario $USUARIO: clave alineada con el Secret"
else
  rabbitmqctl --quiet add_user "$USUARIO" "$CLAVE"
  echo "usuario $USUARIO: creado"
fi
unset CLAVE

rabbitmqctl --quiet set_permissions -p "$VHOST" "$USUARIO" ".*" ".*" ".*"
rabbitmqctl --quiet set_user_tags "$USUARIO" management
echo "usuario $USUARIO: permisos sobre '$VHOST' y etiqueta management"
EOS
)"

# La clave viaja por la tuberia hasta la entrada estandar del pod y no se
# imprime en ningun momento. Queda en argv DENTRO del pod del broker mientras
# dura el comando, que es lo mismo que hace cualquier `rabbitmqctl add_user`.
kubectl get secret "$SECRETO" -o jsonpath='{.data.RABBITMQ_PASSWORD}' | base64 -d \
  | kubectl exec -i deploy/rabbitmq -c rabbitmq -- sh -c "$REMOTO" sh "$usuario" "$VHOST"

echo "Usuario del broker configurado."
