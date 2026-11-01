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
4. Pausar Beat y aplicar solo la tanda:

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
Esperar sus rollouts. Usar una organización sintética nueva para esta prueba.

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
Repetir el generador con otro Job solo después de terminar el anterior: no debe
duplicar la misma ventana. Para demostrar horario automático, habilitar
explícitamente el CronJob en una ventana sin Jobs manuales y observar una
corrida; dispararlo a mano no acredita la programación.

Antes de desmontar, eliminar la organización sintética por el flujo real de
Auth y esperar todos los ACK. La limpieza de Notificaciones incluye inbox,
proyección, alertas y preferencias; una reentrega tardía no recrea filas.
No retirar destinos con datos o ACK pendientes.

## 4. Recuperar y restaurar

Suspender el CronJob; eso no detiene Jobs ya creados. Esperar finalización,
inventariar los manuales, guardar logs y comprobar outbox/colas y limpieza.

```bash
kubectl patch cronjob generar-alertas --type=merge -p '{"spec":{"suspend":true}}'
# Solo una vez terminados y guardada su evidencia:
kubectl delete job alertas-tanda-01
kubectl delete -f /tmp/notifications-tanda.yaml
kubectl scale deployment/subscriptions-beat --replicas=1
kubectl rollout status deployment/subscriptions-beat --timeout=300s
```

Restaurar las banderas/destinos/réplicas/HPA registrados, incluida ausencia de
overrides, cuando no queden datos o ACK que requieran Notificaciones. Si hubo
publicaciones fallidas, verificar recuperación del outbox **y efecto final**;
conservar o reactivar el consumidor necesario hasta comprobarlo. Nunca borrar
colas ni mensajes para aparentar drenaje. Si no hay cupo para recuperación con
Beat, detener nuevas operaciones y liberar el Job terminado antes de proceder.

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
necesaria para alertas dentro de la aplicación. No se promete email o push.
