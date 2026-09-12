#!/bin/sh
# Se ejecuta al arrancar el contenedor, antes del comando del Dockerfile.
# Postgres ya esta sano cuando llegamos aca (depends_on: service_healthy).
set -e

echo ">> aplicando migraciones en el esquema ${ESQUEMA_BD:-?}"
python manage.py migrate --noinput

exec "$@"
