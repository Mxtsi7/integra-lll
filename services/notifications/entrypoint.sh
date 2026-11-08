#!/bin/sh
set -e

python manage.py wait_for_db
if [ "${APLICAR_MIGRACIONES:-1}" = "1" ]; then
  python manage.py migrate --noinput
fi

exec "$@"
