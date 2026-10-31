#!/usr/bin/env bash
# Ejecutado por desplegar.sh después de arrancar Postgres y ANTES del dominio.
# Conserva credenciales existentes; no es una rotación automática.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
for servicio in auth subscriptions connectors analytics notifications; do
  secreto="ojoalgasto-bd-$servicio"
  if kubectl get secret "$secreto" >/dev/null 2>&1; then
    clave="$(kubectl get secret "$secreto" -o jsonpath='{.data.DB_PASSWORD}' | base64 -d)"
  else
    clave="$(openssl rand -hex 32)"
    # Guardar ANTES de tocar PostgreSQL: si se interrumpe, el reintento usa
    # la misma clave y puede terminar la configuración sin perderla.
    printf '{"apiVersion":"v1","kind":"Secret","metadata":{"name":"%s"},"type":"Opaque","stringData":{"DB_PASSWORD":"%s","DATABASE_URL":"postgres://svc_%s:%s@postgres:5432/suscripciones"}}' \
      "$secreto" "$clave" "$servicio" "$clave" | kubectl create -f - >/dev/null
  fi
  # Solo claves generadas por este procedimiento: permite pasarlas por psql
  # sin interpolar contenido arbitrario en SQL o en el shell remoto.
  [[ "$clave" =~ ^[0-9a-f]{64}$ ]] || { echo "Secret $secreto incompatible; revisar sin imprimirlo." >&2; exit 1; }
  {
    printf '\\set esquema %s\n\\set rol svc_%s\n\\set clave %s\n' "$servicio" "$servicio" "$clave"
    cat "$RAIZ/infra/migraciones/usuarios-servicio.sql"
  } | kubectl exec -i postgres-0 -- psql -X -q -U postgres -d suscripciones -v ON_ERROR_STOP=1 >/dev/null
done
echo "Usuarios de base de datos configurados por esquema."
