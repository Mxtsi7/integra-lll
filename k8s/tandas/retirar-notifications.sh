#!/usr/bin/env bash
# Ejecutar solo tras el drenaje, restauración de destinos y escala a cero.
set -euo pipefail
: "${VHOST:?Definir el vhost real de RabbitMQ}"
MANIFIESTO="${1:?Indicar el manifiesto renderizado}"
[[ -f "$MANIFIESTO" ]] || { echo 'No existe el manifiesto; no se retira la cola' >&2; exit 1; }
# Solo esta llamada desactiva conversión MSYS. La ruta del manifiesto conserva
# la conversión nativa de Git Bash para kubectl.exe.
if ! MSYS_NO_PATHCONV=1 kubectl exec deployment/rabbitmq -- rabbitmqctl delete_queue \
    -p "$VHOST" notifications.dominio.v2 --if-empty --if-unused; then
  echo 'No se retiró la cola; se conservan los objetos de la tanda. Recuperar antes de continuar.' >&2
  exit 1
fi
kubectl delete -f "$MANIFIESTO"
