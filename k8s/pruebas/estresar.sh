#!/usr/bin/env bash
# Lanza una prueba de carga con Fortio contra el gateway de Ojo al Gasto.
#
#     ./k8s/pruebas/estresar.sh            # 25 qps (suave)
#     ./k8s/pruebas/estresar.sh 100        # 100 qps
#     ./k8s/pruebas/estresar.sh 200        # 200 qps
#     ./k8s/pruebas/estresar.sh 100 60s    # 100 qps durante 60 segundos
#
# El pod de Fortio corre DENTRO del cluster: tu notebook solo manda el YAML al
# API server. La carga la genera un pod y la recibe un pod; tu conexión no
# participa. Por eso el resultado es el mismo lo lance quien lo lance.
#
# El script detecta solo en qué namespace estás:
#   · exige un namespace distinto de student-forellana (NS_CARGA o contexto)
#   · entra por la URL pública del Ingress, web y gateway; no atraviesa la
#     política que bloquea al Service interno desde otros namespaces.
#
# Funciona en Git Bash, WSL y Linux.
set -euo pipefail

NS_DESTINO="student-forellana"
URL_CARGA="${URL_CARGA:-http://ojoalgasto-forellana.dev.censei.cl/health/}"

QPS="${1:-25}"
DURACION="${2:-30s}"

if ! [[ "$QPS" =~ ^[0-9]+$ ]] || [ "$QPS" -lt 1 ]; then
  echo "ERROR: el primer argumento son las peticiones por segundo (un entero). Recibí: '$QPS'" >&2
  exit 1
fi

# Conexiones en paralelo: más carga necesita más conexiones abiertas, pero
# pasarse solo agrega ruido. Una por cada 12 qps, con piso 4 y techo 32.
CONEXIONES=$(( QPS / 12 )); [ "$CONEXIONES" -lt 4 ] && CONEXIONES=4
[ "$CONEXIONES" -gt 32 ] && CONEXIONES=32

# CPU del pod de Fortio. Si se queda corto, el cuello de botella pasa a ser el
# generador y medirías a Fortio, no al gateway. Ojo con la cuota: el namespace
# tiene un techo de 2 CPU en limits.
if   [ "$QPS" -le 50 ];  then CPU_LIM=150m
elif [ "$QPS" -le 120 ]; then CPU_LIM=250m
else                          CPU_LIM=400m
fi

MI_NS="$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null || true)"
MI_NS="${NS_CARGA:-${MI_NS:-default}}"

if [ "$MI_NS" = "$NS_DESTINO" ]; then
  echo 'ERROR: el HPA máximo ocupa 12/12 pods. Usa NS_CARGA con otro namespace o el contexto de otro integrante.' >&2
  exit 1
else
  BLANCO="$URL_CARGA"
  CABECERA=""
fi

# Todas las operaciones sobre el generador usan explícitamente su namespace.
kubectl() { command kubectl -n "$MI_NS" "$@"; }

NOMBRE="carga-fortio-${QPS}qps"

echo "─────────────────────────────────────────────────────────────"
echo "  namespace desde el que lanzas : $MI_NS"
echo "  blanco                        : $BLANCO"
[ -n "$CABECERA" ] && echo "  cabecera                      : $CABECERA"
echo "  carga                         : ${QPS} qps, ${CONEXIONES} conexiones, ${DURACION}"
echo "  cpu del generador             : $CPU_LIM"
echo "─────────────────────────────────────────────────────────────"

# Aviso honesto: el gateway corre con 1 réplica y un límite de 200m de CPU, y
# medido topa cerca de 50 qps. Pedir más no es un error, pero conviene saber
# qué vas a ver.
if [ "$QPS" -gt 60 ]; then
  echo
  echo "  OJO: el gateway tiene 1 réplica con 200m de CPU y medido topa cerca"
  echo "       de 50 qps. Con ${QPS} qps vas a ver latencia alta y qps real muy"
  echo "       por debajo del pedido: eso NO es un fallo, es el techo de CPU."
  echo
  echo "       Además su readinessProbe pega al MISMO /health/ con timeout de 1s."
  echo "       Si se satura 30s seguidos, el pod sale del Service y el propio"
  echo "       Fortio se queda sin destino. Mira eso con ver-estres.sh."
  echo
fi

# Si quedó una corrida anterior con el mismo nombre, se borra: un Job no se
# puede modificar en caliente.
kubectl delete job "$NOMBRE" --ignore-not-found --wait=true >/dev/null 2>&1 || true

{
  echo "apiVersion: batch/v1"
  echo "kind: Job"
  echo "metadata:"
  echo "  name: $NOMBRE"
  echo "  labels:"
  echo "    app: carga-fortio"
  echo "    app.kubernetes.io/part-of: ojoalgasto"
  echo "spec:"
  echo "  backoffLimit: 0"
  echo "  ttlSecondsAfterFinished: 600"
  echo "  template:"
  echo "    metadata:"
  echo "      labels:"
  echo "        app: carga-fortio"
  echo "    spec:"
  echo "      restartPolicy: Never"
  echo "      containers:"
  echo "        - name: fortio"
  echo "          image: fortio/fortio:1.66.3"
  echo "          args:"
  echo "            - load"
  echo "            - -c"
  echo "            - \"$CONEXIONES\""
  echo "            - -qps"
  echo "            - \"$QPS\""
  echo "            - -t"
  echo "            - \"$DURACION\""
  if [ -n "$CABECERA" ]; then
  echo "            - -H"
  echo "            - \"$CABECERA\""
  fi
  echo "            - \"$BLANCO\""
  echo "          resources:"
  echo "            requests: { cpu: 50m, memory: 64Mi }"
  echo "            limits: { cpu: $CPU_LIM, memory: 128Mi }"
} | kubectl apply -f -

echo
echo "  esperando a que arranque el pod..."
if ! kubectl wait --for=condition=Ready pod -l "job-name=$NOMBRE" --timeout=90s >/dev/null 2>&1; then
  # Puede haber terminado tan rápido que nunca se vio "Ready", o estar Pending
  # por cuota. Se distingue mirando el estado.
  ESTADO="$(kubectl get pod -l "job-name=$NOMBRE" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo '?')"
  if [ "$ESTADO" = "Pending" ]; then
    echo
    echo "  El pod quedó en Pending. El motivo exacto lo dice el evento:"
    echo
    # --sort-by deja el más reciente al final: si quedó un evento de una corrida
    # anterior con el mismo nombre, no queremos mostrar ese.
    MOTIVO="$(kubectl get events --field-selector involvedObject.kind=Pod \
                --sort-by=.lastTimestamp \
                -o jsonpath="{range .items[?(@.reason=='SyncError')]}{.involvedObject.name}{'\t'}{.message}{'\n'}{end}" \
                2>/dev/null | grep "$NOMBRE" | tail -1 | cut -f2 || true)"
    if [ -n "$MOTIVO" ]; then
      printf '    %s\n' "$MOTIVO" | tr ';' '\n' | sed 's/^ */    /'
      echo
      case "$MOTIVO" in
        *students-host-envelope*)
          echo "    Esa cuota NO es tuya: es la bolsa de CPU que comparten TODOS los"
          echo "    namespaces del ramo. Si está llena, no es algo que puedas arreglar"
          echo "    bajando el qps: hay que liberar CPU o esperar a que otro la suelte."
          echo
          echo "    Mantén los workers de la aplicación activos; espera cuota en el namespace externo."
          ;;
        *)
          echo "    Si habla de la cuota de tu namespace, comprueba la cuota del namespace externo."
          ;;
      esac
    else
      echo "    (no encontré un evento SyncError; mira 'kubectl describe pod')"
      kubectl get resourcequota 2>/dev/null | sed 's/^/    /' || true
    fi
    echo
    kubectl delete job "$NOMBRE" --ignore-not-found >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo
# `logs -f` se cae en este nodo a veces ("too many open files", es el inotify
# del nodo). Si pasa, se espera a que el Job termine y se pide el log entero,
# en vez de mostrar la mitad.
case "$DURACION" in
  *m) DUR_SEG=$(( ${DURACION%m} * 60 )) ;;
  *s) DUR_SEG=${DURACION%s} ;;
  *)  DUR_SEG=${DURACION} ;;
esac
if ! kubectl logs -f "job/$NOMBRE" 2>/dev/null; then
  echo "  (no pude seguir el log en vivo; espero a que termine la prueba...)"
  kubectl wait --for=condition=complete "job/$NOMBRE" --timeout="$(( DUR_SEG + 90 ))s" >/dev/null 2>&1 || true
  kubectl logs "job/$NOMBRE" 2>/dev/null || true
fi

echo
echo "─────────────────────────────────────────────────────────────"
echo "  Para borrar el Job:  kubectl -n $MI_NS delete job $NOMBRE"
echo "  (si no, se borra solo 10 minutos después de terminar)"
echo "─────────────────────────────────────────────────────────────"
