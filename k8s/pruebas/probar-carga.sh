#!/usr/bin/env bash
# Sin cluster: comprueba namespace, destino y que no se apagan workers.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export REGISTRO_CARGA="$TMP/llamadas" MANIFIESTO_CARGA="$TMP/job.yaml"
mkdir "$TMP/bin"
cat > "$TMP/bin/kubectl" <<'DOBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REGISTRO_CARGA"
case "$*" in
  *config\ view*) printf student-forellana ;;
  *apply*) cat > "$MANIFIESTO_CARGA" ;;
esac
DOBLE
chmod +x "$TMP/bin/kubectl"
export PATH="$TMP/bin:$PATH"
if NS_CARGA=student-forellana bash "$RAIZ/k8s/pruebas/estresar.sh" 25 > "$TMP/local.log" 2>&1; then
  echo 'ERROR: permitió carga dentro de la cuota de aplicación'; exit 1
fi
if grep -q 'apply\|delete\|scale' "$REGISTRO_CARGA"; then exit 1; fi
: > "$REGISTRO_CARGA"
NS_CARGA=student-carga bash "$RAIZ/k8s/pruebas/estresar.sh" 100 > "$TMP/externa.log" 2>&1
grep -q -- '-n student-carga apply' "$REGISTRO_CARGA"
if grep -q 'scale' "$REGISTRO_CARGA"; then exit 1; fi
if grep -v 'config view\|^\-n student-carga ' "$REGISTRO_CARGA" | grep -q .; then exit 1; fi
grep -q 'http://ojoalgasto-forellana.dev.censei.cl/health/' "$MANIFIESTO_CARGA"
if grep -q 'Host: gateway\|svc.cluster.local' "$MANIFIESTO_CARGA"; then exit 1; fi
echo 'Carga externa: namespace, entrada pública y workers correctos'
