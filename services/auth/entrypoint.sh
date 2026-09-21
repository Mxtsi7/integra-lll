#!/bin/sh
# Se ejecuta al arrancar el contenedor, antes del comando del Dockerfile.
# Postgres ya esta sano cuando llegamos aca (depends_on: service_healthy).
set -e

echo ">> aplicando migraciones en el esquema ${ESQUEMA_BD:-?}"
python manage.py migrate --noinput

# Solo en desarrollo (docker-compose.yml pone SEED_DEMO=1). Es idempotente:
# la segunda vez no hace nada.
if [ "${SEED_DEMO:-0}" = "1" ]; then
  echo ">> sembrando el usuario de demostracion"
  python manage.py seed
fi

exec "$@"
