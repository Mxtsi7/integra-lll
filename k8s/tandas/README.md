# Tandas de D-03 con cuota fija

Se demuestra un servicio completo por tanda. No se pide capacidad ni nuevos
permisos; `auth-eliminaciones` permanece activo. Autoescalado y comparación de
cola se miden aparte, con Beat activo.

## Estado y presupuesto

Notificaciones tiene consumidor FE-24, inbox/migración, API, Service, construcción
de imagen y generador. `faltan: []` significa código disponible, **no despliegue
ni consumo bajo carga comprobados**. Connectors y Analytics siguen pendientes
según `perfiles.yaml`; sus manifiestos no se inventan en el presupuesto.

| Notificaciones, HPA fijos en uno y Beat pausado | Reposo | Generador corriendo | Cuota |
|---|---:|---:|---:|
| Pods | 10 | 11 | 12 |
| Límites memoria | 2432 Mi | 2592 Mi | 2752 Mi |
| Solicitudes memoria | 976 Mi | 1040 Mi | 1152 Mi |
| Límites CPU | 1750m | 1900m | 2000m |
| Solicitudes CPU | 475m | 500m | 1000m |
| Services | 8 | 8 | 10 |

API (256 Mi) y consumidor (160 Mi) comparten un pod; migrar usa un init de
256 Mi. El generador ocupa otro pod hasta terminar (160 Mi). Los límites son
presupuesto, no mediciones de suficiencia. Si hay OOM, se detiene la tanda.

Los manifiestos están fuera del glob permanente de `desplegar.sh`: no se
activan sin la ventana ni cambian el núcleo en cada despliegue. La herramienta
calcula todas las dimensiones y el máximo de init/containers.

## 1. Preparar imágenes y renderizar, sin tocar Kubernetes

Desde la raíz y con Python/PyYAML, Docker y sesión de escritura en tu registro:

```bash
export IMAGEN_NOTIFICATIONS="ghcr.io/TU_USUARIO/ojoalgasto-notifications:SHA_VALIDADO"
bash k8s/tandas/preparar-notifications.sh construir
bash k8s/tandas/preparar-notifications.sh render > /tmp/notifications-tanda.yaml
```

El render verifica presupuesto, sustituye la imagen de los dos manifiestos y no
aplica nada. El generador externo indicado por el cálculo es solo una entrada
contable: el script no lanza carga ni solicita un namespace adicional.

El núcleo debe estar actualizado a una versión validada. En particular, el
productor de Subscriptions debe publicar `fin_prueba` cuando exista para FE-18;
se añade como extensión opcional del snapshot v2, sin cambiar campos obligatorios.
Reconstruir/desplegar la imagen de Subscriptions de esa versión antes de esta
ventana. No se ha ejecutado ese despliegue desde las pruebas locales.

## 2. Entrar en ventana controlada

Usar el contexto/namespace correcto. Registrar SHA/digests, HPA completos,
réplicas y valores originales (o ausencia) de overrides de
`EVENTOS_ASINCRONOS` y `ELIMINACION_DESTINOS` de Auth, auth-eliminaciones,
Subscriptions y su worker. Conservarlos para una restauración exacta.

1. Fijar **ambos** HPA en min/max uno, escalar Gateway y Subscriptions a uno y
   esperar que terminen las réplicas extra. `--sin-autoescalado` solo cambia
   el cálculo, no el clúster.
2. Confirmar `EVENTOS_ASINCRONOS=0` en los procesos pertinentes. Esperar salud,
   outbox drenado y tareas previas terminadas con Beat todavía activo.
3. Comprobar Secrets existentes `ghcr`, `ojoalgasto`,
   `ojoalgasto-bd-notifications` y `ojoalgasto-rabbitmq`, y rol/esquema de BD
   restringidos aprovisionados. No mostrar valores ni usar la URL administradora.
4. Revisar la cola **antes del primer despliegue**. Esta versión declara
   `notifications.dominio.v2` con `x-max-length=1000`,
   `x-max-length-bytes=4194304` y `x-overflow=reject-publish`. El tope protege
   la cola de dominio; no es una cota de RAM total del broker ni de la DLQ.
   Al llenarse, el productor recibe NACK y conserva el outbox para reintentar;
   no se descarta el snapshot más antiguo. Detener tráfico si crece la DLQ.

```bash
# Confirmar el vhost usado por RABBITMQ_URL, sin imprimir la credencial.
VHOST=/  # ajustar al vhost real antes de continuar
kubectl exec deployment/rabbitmq -- rabbitmqctl list_queues -p "$VHOST" \
  name arguments messages_ready messages_unacknowledged consumers
```

Si la cola no existe, continuar. Si ya existe con otros argumentos, **no**
aplicar encima: RabbitMQ rechaza la redeclaración (`PRECONDITION_FAILED`).
Congelar productores, usar la imagen anterior para drenar el outbox y la cola,
resolver/reprocesar la DLQ y detener el consumidor. Solo con cola vacía y sin
consumidores, eliminarla con las dos guardas del cierre y aplicar esta versión
para recrearla. Si hay pendientes, conservar la versión anterior y abortar
la actualización; nunca purgar mensajes para cambiar argumentos.

5. Pausar Beat y aplicar solo la tanda:

```bash
kubectl scale deployment/subscriptions-beat --replicas=0
kubectl apply -f /tmp/notifications-tanda.yaml
kubectl rollout status deployment/notifications --timeout=300s
kubectl logs deployment/notifications -c consumidor
```

Esperar el log `Escuchando notifications.dominio.v2` **antes de crear datos**.
La salud HTTP no prueba que el consumidor esté conectado. Una caída de AMQP
hace terminar el proceso; Kubernetes lo reinicia y el inbox deduplica reentregas.
No se reconstruye automáticamente el historial publicado antes de enlazar su cola.

Añadir `notifications` a los destinos de eliminación de Auth y su worker antes
de almacenar datos de la tanda, conservando otros destinos que tengan datos.
Aplicar el override a **Auth primero**, esperar su rollout y después hacerlo
en **auth-eliminaciones**, esperando también. Nunca reiniciarlos juntos ni
mientras corre un Job del generador: en reposo cabe un pod adicional de
256 Mi (2432 + 256 = 2688 Mi), pero con el generador excedería memoria y CPU.
No lanzar Jobs hasta terminar ambos rollouts. Usar una organización sintética
nueva para esta prueba.

La pausa de Beat quita el reintento periódico del outbox, aunque el modo
síncrono publique dentro de la petición. Sin tráfico ajeno a la demostración,
comprobar publicaciones pendientes/errores tras cada operación. Ante fallo,
invalidar la tanda y recuperar; nunca ignorar un pendiente.

## 3. Verificar alertas, lectura y borrado

Crear una suscripción sintética con cobro próximo (o prueba con `fin_prueba`
válido) por el Gateway, con el usuario autenticado de esa organización.
Comprobar proyección/evento por identificador y acceso aislado de otro tenant.
El inbox y el efecto comparten transacción; ACK sucede después del commit y
los rechazos van a `notifications.fallidos`, no al DLX de Subscriptions.

El CronJob llega suspendido. Verificar que no exista otro Job activo y crear
uno manual con nombre único. `Forbid` no protege Jobs manuales.

```bash
kubectl get jobs
kubectl create job --from=cronjob/generar-alertas alertas-tanda-01
kubectl wait --for=condition=complete job/alertas-tanda-01 --timeout=600s
kubectl logs job/alertas-tanda-01
```

Comprobar la alerta por `/api/alertas/`, contador, lectura y preferencias.
**Abrir la web** con ese mismo usuario y organización: ver la alerta en la
campana, comprobar el contador de no leídas, abrir/marcar la alerta como leída
y comprobar que disminuye. Recargar y verificar persistencia; otro tenant no
debe verla. Guardar capturas o vídeo sin tokens ni datos reales, junto a IDs
sintéticos, SHA/digest, hora y logs del consumidor/generador. Una respuesta
HTTP correcta por sí sola no acredita la campana ni cierra D-03.

Guardar también `kubectl logs deployment/notifications -c migrar` y
`kubectl exec deployment/notifications -c api -- python manage.py showmigrations notifications`.
Registrar motor PostgreSQL y recuentos de datos antes/después de la migración
si el esquema ya tenía datos. Si es una instalación vacía, declararlo: **no
prueba actualización con datos existentes**. El smoke SQLite de CI solo valida
la imagen. Migración/flujo/campana en el clúster siguen pendientes hasta adjuntar
estas evidencias.
Repetir el generador con otro Job solo después de terminar el anterior: no debe
duplicar la misma ventana. Para demostrar horario automático, habilitar
explícitamente el CronJob en una ventana sin Jobs manuales y observar una
corrida; dispararlo a mano no acredita la programación.

Antes de desmontar, eliminar la organización sintética por el flujo real de
Auth y esperar todos los ACK. La limpieza de Notificaciones incluye inbox,
proyección, alertas y preferencias; una reentrega tardía no recrea filas.
No retirar destinos con datos o ACK pendientes.

## 4. Recuperar y restaurar

### 4.1 Detener carga y recuperar con el consumidor todavía activo

Congelar nuevas escrituras/importaciones de la demostración y tráfico ajeno;
no cerrar la cola con productores generando hechos nuevos. Suspender el
CronJob (no detiene Jobs ya creados), esperar todos los Jobs manuales/automáticos,
guardar sus logs y retirar **solo** los terminados. Conservar la API y el
consumidor. No basta `rollout status`: con cero réplicas también informa éxito.

```bash
kubectl patch cronjob generar-alertas --type=merge -p '{"spec":{"suspend":true}}'
kubectl get jobs
# Esperar cada Job inventariado, guardar sus logs; ejemplo del manual:
kubectl wait --for=condition=complete job/alertas-tanda-01 --timeout=600s
kubectl logs job/alertas-tanda-01
kubectl delete job alertas-tanda-01
# Sin Jobs activos: hay cupo para Beat con notifications todavía arriba.
kubectl scale deployment/subscriptions-beat --replicas=1
kubectl rollout status deployment/subscriptions-beat --timeout=300s
kubectl get deployment subscriptions-beat
kubectl wait --for=condition=Ready pod -l app=subscriptions-beat --timeout=300s
```

Confirmar **1 réplica disponible**, no solo rollout exitoso. Beat + API/consumidor
sin generador usan 11 pods, 2592 Mi de límites, 1040 Mi solicitados y 1800m de
CPU límite: caben con HPA en uno. Nunca levantar Beat con el Job aún activo.
Esperar outbox a cero incluso si `siguiente_intento` aplazó el reintento; no
contar solo los eventos vencidos. Consultar sin cuerpos ni secretos:

```bash
kubectl exec deployment/subscriptions -- python manage.py shell -c \
  'from app.models import OutboxEvento; print("outbox_pendiente=", OutboxEvento.objects.filter(publicado_en__isnull=True).count())'
kubectl exec deployment/rabbitmq -- rabbitmqctl list_queues -p "$VHOST" \
  name messages_ready messages_unacknowledged consumers
```

Si hay mensajes en `notifications.fallidos` por caída de PostgreSQL, corregir
la causa y ejecutar el replay acotado **antes de retirar el consumidor**:

```bash
kubectl exec deployment/notifications -c consumidor -- \
  python manage.py reprocesar_fallidos --limite 100
```

El replay requiere colas existentes; conserva cuerpo, IDs/correlación y usa
publicación persistente, `mandatory` y confirms. Solo da ACK al original de la
DLQ tras el confirm. Un corte entre publicación y ACK puede duplicar la entrega;
el inbox evita duplicar el efecto. No cambia el retry limitado del contrato MX-21
ni crea un bucle de requeue inmediato. Su contador significa **reenviados**, no
procesados. Revisar efecto/inbox y ambas colas después de cada lote. Un inválido
puede volver a fallar: no repetir automáticamente ni borrar la DLQ; investigar
sin exponer el cuerpo. Si queda cualquier fallo o efecto pendiente, detener el
cierre y conservar el consumidor. Mantener también `auth-eliminaciones` y sus
destinos hasta resolver todos sus ACK y la limpieza de la organización sintética.

### 4.2 Retirar la cola de la tanda y restaurar el núcleo

Con tráfico congelado, outbox cero, efectos/limpieza verificados y **ambas colas
de Notificaciones con ready=0 y unacknowledged=0**, parar el Deployment y esperar
que desaparezca su pod. Verificar de nuevo los contadores y consumers=0 antes
de eliminar la cola de dominio con guardas. Si una guarda falla, no forzar ni
purgar: reactivar la misma imagen, recuperar y repetir la comprobación.

```bash
kubectl scale deployment/notifications --replicas=0
# Solo pods API/consumidor, no confundirlos con Jobs terminados:
kubectl wait --for=delete pod -l app=notifications,componente=api --timeout=300s
kubectl exec deployment/rabbitmq -- rabbitmqctl list_queues -p "$VHOST" \
  name messages_ready messages_unacknowledged consumers
kubectl exec deployment/rabbitmq -- rabbitmqctl delete_queue -p "$VHOST" \
  notifications.dominio.v2 --if-empty --if-unused
# Verificar ausencia de la cola; ya no recibe durante Connectors/Analytics.
kubectl exec deployment/rabbitmq -- rabbitmqctl list_queues -p "$VHOST" name
kubectl delete -f /tmp/notifications-tanda.yaml
```

La eliminación es **solo de la cola de dominio vacía** de esta tanda; no del
exchange compartido `suscripciones` ni de colas de otros servicios. Conservar
la DLQ para diagnóstico (ya comprobada vacía). La siguiente tanda recrea los
bindings al iniciar el consumidor; no reconstruye hechos emitidos durante su
ausencia. Nunca borrar colas con mensajes para aparentar drenaje.

Restaurar las banderas/destinos/réplicas/HPA registrados, incluida ausencia de
overrides, solo tras retirar Notificaciones y confirmar que no tiene datos o
ACK pendientes. Mantener Beat en su réplica original activa; comprobar salud
del núcleo, outbox y cinco dimensiones de cuota antes de reabrir tráfico o
iniciar la siguiente tanda. Guardar evidencia de Beat disponible y cola ausente.

No ejecutar `desplegar.sh` general dentro de la tanda: puede restaurar réplicas
y además intenta aplicar NetworkPolicies que hoy están bloqueadas por RBAC.
Esa restricción se documenta como aislamiento no demostrado; no se prometen
permisos nuevos ni se declara D-11 cerrado.

## Pruebas y límites de evidencia

`pytest scripts/tests k8s/pruebas` valida perfil, mínimos, credenciales, etiquetas,
registro privado, suspensión y presupuesto. La suite de Notificaciones valida
inbox/rollback, borrado y generación. CI usa PostgreSQL y RabbitMQ para probar
routing v2, reentrega y DLQ; sin `RABBITMQ_PRUEBA_URL` la integración se omite.
No equivale a probar rendimiento o despliegue real de la tanda universitaria.

El WIP FE-23/24 no se incorpora completo: entrega externa/outbox de avisos queda
fuera; se conserva el generador actual y se completa solamente la ingesta FE-24
necesaria para alertas dentro de la aplicación. **FE-24 queda parcial respecto
a la tarjeta**: `alert.due` / `alerta.activada.v2` y la cola de entregas no se
emiten aquí. Su integración con FE-23 requiere una entrega posterior con outbox
y pruebas de canal; no se declara FE-24 completa ni se promete email o push.
Ver [seguimiento de FE-24](../../docs/flujos/felipe-orellana/11-alcance-fe24-tanda.md).
