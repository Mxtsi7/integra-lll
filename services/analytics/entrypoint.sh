#!/bin/sh
# Migra el esquema propio antes de servir. Postgres ya está sano cuando
# llegamos acá (docker-compose.yml usa condition: service_healthy).
# El bind mount desde Windows no garantiza el bit de ejecución: el
# Dockerfile invoca este archivo con "sh" explícito.
set -e

echo ">> aplicando migraciones en el esquema ${ESQUEMA_BD:-?}"
python manage.py migrate --noinput

exec "$@"
