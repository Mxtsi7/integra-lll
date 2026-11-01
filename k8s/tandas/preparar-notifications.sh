#!/usr/bin/env bash
# Construye/publica o renderiza la tanda; no altera el clúster.
# IMAGEN_NOTIFICATIONS=ghcr.io/usuario/ojoalgasto-notifications:SHA bash ... render
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$RAIZ"
MODO="${1:-render}"
: "${IMAGEN_NOTIFICATIONS:?Definir la imagen inmutable de esta versión}"
# Impide reemplazos con separadores o caracteres que rompan el YAML.
[[ "$IMAGEN_NOTIFICATIONS" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/@:-]+$ ]] || {
  echo 'Referencia de imagen inválida' >&2; exit 1;
}
case "$MODO" in
  construir)
    docker build -f k8s/Dockerfile.servicio --build-arg SERVICIO=services/notifications -t "$IMAGEN_NOTIFICATIONS" .
    docker push "$IMAGEN_NOTIFICATIONS"
    ;;
  render)
    python3 k8s/pruebas/presupuesto.py k8s \
      --generador k8s/pruebas/carga-fortio-otro-namespace.yaml \
      --namespace-generador student-carga --sin-autoescalado \
      --pausar subscriptions-beat --extra k8s/tandas/notifications.yaml \
      --extra k8s/tandas/alertas-notifications.yaml >&2
    # El generador anterior solo se usa para calcular; no se crea ningún Job.
    python3 - <<'PY'
import os
from pathlib import Path
for nombre in ('notifications.yaml', 'alertas-notifications.yaml'):
    print('---')
    print((Path('k8s/tandas') / nombre).read_text().replace(
        'IMAGEN_NOTIFICATIONS', os.environ['IMAGEN_NOTIFICATIONS']))
PY
    ;;
  *) echo 'Uso: preparar-notifications.sh construir|render' >&2; exit 1 ;;
esac
