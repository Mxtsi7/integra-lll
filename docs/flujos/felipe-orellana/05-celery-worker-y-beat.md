# 05 · Celery: worker, beat y la tarea de prueba

**Tareas de la planilla:** Configurar Celery worker en docker-compose ·
Configurar Celery beat en docker-compose · Crear tarea básica de prueba en
Celery.

**Archivos:**

| Archivo | Qué hace |
|---|---|
| `services/subscriptions/config/celery.py` | la app Celery y la tarea `latido` |
| `services/subscriptions/config/settings.py` | `CELERY_BROKER_URL`, `CELERY_BEAT_SCHEDULE` |
| `docker-compose.yml` (`subscriptions-worker`, `subscriptions-beat`) | los dos procesos |
| `k8s/11-subscriptions.yaml` | los mismos dos como Deployments |
| `services/subscriptions/tests/test_celery.py` | 3 pruebas |

Celery es el actor **Temporizador** del modelo de casos de uso: lo que el
sistema hace solo, sin que nadie apriete nada (avanzar fechas de cobro,
marcar fantasmas, avisar antes de un cobro). En el Sprint 1 quedó la
infraestructura lista con una tarea de prueba; las tareas de dominio son del
Sprint 2.

## Flujo

```
subscriptions-beat ──cada 60 s──▶ encola "config.celery.latido" en Redis
                                            │
subscriptions-worker ◀──toma la tarea───────┘
        │
        └─▶ ejecuta latido(): escribe en el log la hora y devuelve {"servicio": "subscriptions", "latido": "..."}
```

- **beat** es el reloj: lee `CELERY_BEAT_SCHEDULE` y encola cada tarea cuando
  toca. Corre **una sola instancia** (dos beats encolarían todo dos veces).
- **worker** es quien ejecuta. Puede haber varios.
- **Redis** es el broker (`CELERY_BROKER_URL=redis://redis:6379/0`). RabbitMQ
  está levantado para eventos entre servicios, pero hoy no lo usa nadie:
  ni Celery ni los servicios.

Los dos procesos usan **la misma imagen** que `subscriptions`, con otro
`entrypoint`: `celery -A config worker` y `celery -A config beat`. Así ven los
mismos modelos y la misma base. No corren `migrate` (lo hace `subscriptions`)
y arrancan cuando ese ya está sano, para que la base esté migrada.

La app Celery carga su configuración desde los settings de Django
(`config_from_object("django.conf:settings", namespace="CELERY")`) y
descubre sola cualquier `app/tasks.py` (`autodiscover_tasks()`). Para
agregar una tarea real: escribirla en `services/subscriptions/app/tasks.py`
con `@shared_task` y programarla en `CELERY_BEAT_SCHEDULE`.

## Dónde está cada cosa en el código

| Paso | Archivo y línea | Qué buscar |
|---|---|---|
| La app Celery | `services/subscriptions/config/celery.py:21` | `app = Celery("subscriptions")` |
| Lee la configuración de Django | `celery.py:22` | `config_from_object("django.conf:settings", namespace="CELERY")` |
| Descubre `app/tasks.py` solo | `celery.py:23` | `app.autodiscover_tasks()` |
| La tarea de prueba | `celery.py:28-34` | `@app.task(name="config.celery.latido")` → `def latido()` |
| Broker (Redis) | `services/subscriptions/config/settings.py:89-90` | `CELERY_BROKER_URL = env(..., default="redis://redis:6379/0")` |
| Programación cada 60 s | `services/subscriptions/config/settings.py:93-100` | `CELERY_BEAT_SCHEDULE["latido-del-temporizador"]`, `"schedule": 60.0` |
| Worker en compose | `docker-compose.yml`, servicio `subscriptions-worker` | `entrypoint: ["celery", "-A", "config"]`, `command: ["worker", ...]`, healthcheck `celery inspect ping` |
| Beat en compose | `docker-compose.yml`, servicio `subscriptions-beat` | `command: ["beat", ..., "--schedule", "/tmp/celerybeat-schedule"]`, `healthcheck: disable` |
| Esperan a que subscriptions migró | `docker-compose.yml`, `depends_on` de ambos | `subscriptions: { condition: service_healthy }` |
| Worker en el cluster | `k8s/11-subscriptions.yaml:78-97` | Deployment `subscriptions-worker`, `command: ["celery", "-A", "config", "worker", ...]` |
| Beat en el cluster | `k8s/11-subscriptions.yaml:114-133` | Deployment `subscriptions-beat`, `command: ["celery", "-A", "config", "beat", ...]` |
| Pruebas | `services/subscriptions/tests/test_celery.py:12, 17, 23` | `test_la_app_de_celery_lee_la_configuracion_de_django`, `test_el_latido_esta_programado_en_beat`, `test_el_latido_se_ejecuta_y_devuelve_la_hora` |
| Apagar/encender durante pruebas de carga | `k8s/pruebas/prueba-de-carga.sh`, funciones `accion_liberar` y `accion_devolver` | `kubectl scale deployment/subscriptions-worker --replicas=0/1` |

## Detalles de compose y Kubernetes

- El healthcheck del Dockerfile es HTTP y un worker no sirve HTTP, así que
  el worker usa `celery inspect ping` y beat no tiene healthcheck.
- El archivo de estado de beat va en `/tmp/celerybeat-schedule`, fuera de
  `/app`, para que no aparezca en el repo por el bind mount.
- En el cluster, worker (200m) y beat (100m) suman 300m de los 1600m que
  usa el sistema. Como hoy solo hacen el latido, `k8s/pruebas/prueba-de-carga.sh`
  los apaga para liberar CPU durante las pruebas de carga y los vuelve a
  levantar después.

## Cómo probarlo

```bash
docker compose up -d subscriptions-worker subscriptions-beat
docker compose logs -f subscriptions-worker        # cada minuto: "latido del Temporizador a las HH:MM:SS"
docker compose exec subscriptions pytest tests/test_celery.py -v
```

Las tres pruebas: la app lee la configuración de Django, el latido está
programado en beat, y el latido se ejecuta y devuelve la hora (sin broker:
se llama la función directo).

En el cluster:

```bash
kubectl logs deploy/subscriptions-worker --since=3m | grep latido
```

## Qué queda pendiente

- Tareas de dominio: avanzar `fecha_proximo_cobro` y generar el `Cobro` al
  vencer; marcar `fantasma` por falta de uso; avisos antes del cobro
  (`notifications`).
- La "snapshot con y sin RabbitMQ" que pidió el profe no tiene sentido
  todavía: nada pasa por RabbitMQ. Primero hay que mover algo real a una
  tarea asíncrona y después comparar la latencia de la petición en modo
  síncrono y encolado.
