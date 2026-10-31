# D-01 · `connectors-worker` sin app Celery

Hallazgo D-01 del manual (sección 6, severidad alta, servicio `connectors`).
Rama: `Christopher/celery_connectors`, desde `origin/main` (`a5659f9`).

## Qué estaba roto

- `docker-compose.yml` e `infra/k8s/base/servicios.yaml` arrancaban el worker
  con `celery -A config worker --beat`. En `services/connectors/config/` solo
  hay un `__init__.py` vacío que quedó de la plantilla: los settings del
  servicio viven en `connectors_config/` y no existía ningún `celery.py`.
  El CLI de Celery no encuentra la app (`module 'config' has no attribute
  'celery'`) y el contenedor termina al arrancar.
- Aunque arrancara, el worker heredaba el `HEALTHCHECK` HTTP del Dockerfile
  (`curl :8003/health/`) y quedaba `unhealthy`: un worker no sirve HTTP.
- No había ninguna tarea. FE-13 (lectura de correo) y el procesamiento de
  importaciones todavía no existen, y ninguna función estaba escrita
  esperando a Celery. `reintentar_revocaciones` es un comando de `manage.py`.

Al arreglarlo apareció un segundo riesgo: subscriptions usa el mismo Redis
(DB 0) con la cola y el canal de control por omisión (`celery`). Un worker de
connectors en esa cola recibiría las tareas del Temporizador y las
descartaría por no conocerlas, y a su `inspect ping` contestaría también el
worker de subscriptions.

## Qué se cambió

| Archivo | Estado | Cambio |
|---|---|---|
| `services/connectors/connectors_config/celery.py` | nuevo | La app `Celery("connectors")`: lee los settings con prefijo `CELERY_` y descubre las tareas solas |
| `services/connectors/connectors_config/__init__.py` | modificado | Carga la app junto con Django, para que un `.delay()` desde una vista use este broker |
| `services/connectors/connectors/tasks.py` | nuevo | Tarea `latido`: comprueba que beat programa y el worker ejecuta. Aquí van las tareas de FE-13 |
| `services/connectors/connectors_config/settings.py` | modificado | Bloque Celery: broker y backend desde el entorno, cola y canal de control propios (`connectors`), zona horaria y calendario con el latido |
| `docker-compose.yml` | modificado | `connectors-worker` usa `-A connectors_config`, guarda el estado de beat en `/tmp` y tiene un healthcheck con `celery inspect ping` |
| `infra/k8s/base/servicios.yaml` | modificado | Mismo comando en el Deployment `connectors-worker` |
| `.github/workflows/ci.yml` | modificado | `CELERY_BROKER_URL` en el entorno de las pruebas (connectors la exige al cargar los settings) |
| `services/connectors/tests/test_celery.py` | nuevo | 9 pruebas, detalladas abajo |
| `services/connectors/WORKER-CELERY.md` | nuevo | Este documento |

### Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `CELERY_BROKER_URL` | sí | Redis del broker. Ya estaba en `.env.example` y en `infra/k8s/base/config.yaml`. Si falta, el servicio no arranca, igual que sin `DATABASE_URL` |
| `CELERY_RESULT_BACKEND` | no | Backend de resultados. Por omisión, el mismo broker |
| `CONECTORES_LATIDO_SEGUNDOS` | no | Cada cuánto programa beat el latido. Por omisión, 60 |

## Cómo se verificó

### Pruebas (`services/connectors/tests/test_celery.py`)

- `test_compose_arranca_y_sondea_la_app_real` y `test_k8s_arranca_la_app_real`
  leen el comando y el healthcheck del worker y buscan la app tal como la
  busca el CLI con `-A` (`celery.app.utils.find_app`). Con `-A config` fallan.
  Dentro del contenedor se saltan, porque ahí no están esos archivos.
- `test_broker_y_backend_salen_del_entorno` y
  `test_sin_backend_propio_los_resultados_van_al_broker` cargan los settings
  en otro proceso con valores inventados en el entorno.
- `test_las_tareas_se_descubren_solas` (en un proceso donde nadie importó
  `connectors.tasks`), `test_beat_solo_programa_tareas_registradas`,
  `test_las_tareas_compartidas_usan_esta_app` y `test_el_latido_se_ejecuta`.
- `test_no_comparte_cola_ni_control_con_subscriptions`.

Resultado local (Python 3.13, entorno como el de CI, SQLite en memoria):
`tests/test_celery.py` 9 pasadas; suite completa de connectors 336 pasadas y
4 omitidas (las que exigen Postgres); `python manage.py check` sin problemas.

### El fallo en `origin/main`

Con la misma búsqueda que hace el CLI, el comando de `origin/main`
(`-A config`) falla con `AttributeError: module 'config' has no attribute
'celery'`, y `-A connectors_config` devuelve `<Celery connectors>`.

### Docker: no se pudo ejecutar

En este equipo Docker Desktop no arranca el motor: su registro dice
`Virtual Machine Platform not enabled` y `No virtualization available`, y
WSL no está instalado. Activarlo es un cambio del sistema que no se hizo.
**Falta comprobarlo en Docker**:

```bash
docker compose up -d --build connectors-worker
```

```bash
docker compose logs connectors-worker
```

```bash
docker compose exec connectors-worker celery -A connectors_config inspect ping --timeout 5
```

Lo esperado: en el log aparecen la cola `connectors`, la tarea
`connectors.tasks.latido`, `ready.` y un latido por minuto; el ping contesta
`pong`; y `docker compose ps` muestra el worker `healthy`.

### Worker real en Windows, sin Docker

Se levantó el worker real con la app de esta rama, en un entorno virtual
temporal fuera del repo. Hubo dos diferencias con el contenedor: en Windows
Celery no admite `--beat` dentro del worker, así que worker y beat corrieron
como dos procesos, y el pool fue `-P solo`. El latido se programó cada 5 s con
`CONECTORES_LATIDO_SEGUNDOS=5`.

1. **Con Redis emulado (`fakeredis`) en `redis://127.0.0.1:6390/0`:** el
   worker toma broker y backend del entorno, escucha la cola `connectors`,
   registra `connectors.tasks.latido` y queda `ready.`. Beat envía el latido
   cada 5 s y el worker lo ejecuta (`succeeded`, `{'servicio': 'connectors'}`).
   `inspect ping` no se pudo probar ahí: el emulador acepta `PUBLISH` pero no
   entrega los mensajes a los suscriptores.
2. **Con el transporte de archivos de kombu, que sí reparte la difusión:**
   - `celery inspect ping` con la app de connectors responde
     `celery@<equipo>: OK pong`, `1 node online`, y termina con 0.
   - El mismo ping desde una app con la configuración por omisión, como la de
     subscriptions, termina con `No nodes replied` (código 69): el canal de
     control está separado.
   - Una tarea `app.tasks.despachar_eventos_pendientes` encolada en la cola
     `celery` se quedó sin tocar mientras el worker seguía con sus latidos.
     Como contraste, el mismo worker escuchando `celery` la descartó:
     `Received unregistered task of type 'app.tasks.despachar_eventos_pendientes'.
     The message has been ignored and discarded.` Eso es lo que evita tener
     una cola propia.

## Choques con PR abiertos

Comprobado con `git merge-tree` contra las ramas de cada PR:

- **#132 (Victor, `victor/loteD(VI-13,14,15,16,23,24)`): conflicto en
  `docker-compose.yml`.** Cambia las mismas líneas de `connectors-worker`:
  pasa el comando a `entrypoint: ["celery", "-A", "config"]` y agrega un
  healthcheck con `-A config`. Al resolver, quien fusione segundo debe dejar
  `connectors_config` en los dos lugares. Si queda `config`,
  `test_compose_arranca_y_sondea_la_app_real` falla.
- **#120 (Felipe, FE-07):** se fusiona sin conflictos. Agrega el servicio
  `connectors-purga` después del worker y variables `IMPORTACION_*` en
  `settings.py`, en líneas distintas.
- **#133 (Felipe, FE-05):** cerrado y sin archivos en común.

## Fuera de D-01

- La primera tarea real es la lectura de correo (FE-13).
- La purga horaria de #120 y `reintentar_revocaciones` podrían programarse en
  beat. Se dejó como decisión del equipo: la revocación habla con el
  proveedor y por omisión corre en seco.
- `django-celery-beat` está en `requirements.txt` pero no se usa: beat guarda
  su calendario en `/tmp/celerybeat-schedule`.
- Los paquetes vacíos `services/connectors/config/` y `services/connectors/app/`
  siguen ahí; borrarlos evitaría que alguien vuelva a usar `-A config`.
- Los manifiestos en uso (`k8s/`) no despliegan connectors (D-03).
