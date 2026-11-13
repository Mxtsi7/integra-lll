# Flujos de mis tareas del Sprint 1 — Felipe Orellana

Documentación de cómo funciona el código que me tocó en el Sprint 1
(infraestructura, gateway, Celery) y de cómo viajan las consultas entre el
frontend y el backend. Cada archivo explica **qué hace**, **por dónde pasan los
datos**, **qué archivos lo implementan** y **cómo probarlo**.

Las tareas son las de mi fila en `docs/investigacion/Integra III.xlsx`, hoja
*Sprint 1 - IIl*. El estado de la planilla quedó desactualizado: acá va el
estado real contrastado con `main`.

| Tareas de la planilla | Estado real | Documento |
|---|---|---|
| Dejar Postgres usable en docker-compose · Testear conexión a la base · Completar `.env.example` y lectura de env · Test de que Auth lee el env | Hecho (el test del env es parcial) | [01-base-de-datos-y-entorno.md](01-base-de-datos-y-entorno.md) |
| Dockerfile de Auth · Dockerfile de Subscriptions · Red Docker Auth + Subscriptions + Postgres · Test que ambos hablan con la DB · Comando migrate al levantar compose · Test migraciones aplicadas · Seed de un usuario y datos mínimos | Hecho. Pendiente: test de imagen de Auth y de Subscriptions | [02-contenedores-y-arranque.md](02-contenedores-y-arranque.md) |
| Gateway: proxy reverso base · leer y decodificar JWT · validar firma · extraer X-Usuario-Id, X-Organizacion-Id y X-Rol · inyectar cabeceras · devolver 401/403 · documentación técnica y variables | Hecho, 17 pruebas | [03-gateway.md](03-gateway.md) |
| Probar el aislamiento (RF-26) | Hecho, cubierto por tests en gateway y subscriptions | [04-aislamiento-rf26.md](04-aislamiento-rf26.md) |
| Celery worker en compose · Celery beat en compose · tarea básica de prueba | Hecho (solo el latido; sin tareas de dominio todavía) | [05-celery-worker-y-beat.md](05-celery-worker-y-beat.md) |
| Cómo se piden las consultas entre frontend y backend (pendiente del profe, 08-10-2026) | Explicado con un ejemplo de punta a punta | [06-consultas-frontend-backend.md](06-consultas-frontend-backend.md) |
| **Sprint 2 · FE-06** Cifrar tokens de conectores y gestionar claves | Hecho, 32 pruebas, PR abierto | [07-cifrado-de-tokens-fe06.md](07-cifrado-de-tokens-fe06.md) |
| **Sprint 2 · FE-12** Normalizar nombres de proveedores | Hecho, 80 pruebas | [08-normalizacion-de-proveedores-fe12.md](08-normalizacion-de-proveedores-fe12.md) |
| **Sprint 2 · FE-17 y FE-18** Alertas de próximos cobros y avisos de fin de prueba | Generador implementado; `fin_prueba` ya declarado; evidencia de tanda pendiente | [09-alertas-generadas-fe17-fe18.md](09-alertas-generadas-fe17-fe18.md) |
| **Sprint 2 · FE-07** Validar y recibir archivos CSV y cartolas | Hecho, 68 pruebas | [10-subida-de-archivos-fe07.md](10-subida-de-archivos-fe07.md) |
| **FE-24 · ingesta y tanda** | Ingesta implementada; emisión alert.due y evidencia pendientes | [11-alcance-fe24-tanda.md](11-alcance-fe24-tanda.md) |
| **Sprint 2 · FE-01 a FE-05** Cuentas conectadas: modelo, listado, OAuth y desconexión | Hecho, 145 pruebas (más 3 que necesitan PostgreSQL) | [12-cuentas-conectadas-fe01-fe05.md](12-cuentas-conectadas-fe01-fe05.md) |
| **Sprint 2 · FE-08** Modelar importaciones y exponer su progreso | Hecho, 48 pruebas | [13-progreso-de-importaciones-fe08.md](13-progreso-de-importaciones-fe08.md) |
| **Sprint 2 · FE-16, FE-19, FE-20 y FE-21** Alertas: estados, listado, contador y preferencias | Hecho, 86 pruebas | [14-alertas-y-preferencias-fe16-fe21.md](14-alertas-y-preferencias-fe16-fe21.md) |
| **Sprint 2 · FE-28 y FE-29** Uso por periodo y puntaje de bajo uso | Hecho, 130 pruebas; el consumidor de eventos todavía no está conectado | [15-uso-por-periodo-y-bajo-uso-fe28-fe29.md](15-uso-por-periodo-y-bajo-uso-fe28-fe29.md) |
| **Sprint 2 · Pedido del profesor** Snapshot en vivo de la comparación con y sin RabbitMQ, con autoscaling | Hecho, 24 pruebas nuevas y opción 12 del menú; falta una corrida real en el cluster | [16-snapshot-comparacion-rabbitmq-y-hpa.md](16-snapshot-comparacion-rabbitmq-y-hpa.md) |
| **Sprint 3 · S3-FE-02** Consultar los mensajes autorizados de Gmail: filtros, paginación, límites y solo cuentas conectadas de la organización | Hecho, 82 pruebas; falta la corrida contra una cuenta de prueba real | [23-leer-gmail-s3-fe-02.md](23-leer-gmail-s3-fe-02.md) |

Fuera de la planilla, pero del mismo sprint y míos: el CI
(`.github/workflows/ci.yml`), el despliegue en Kubernetes (`k8s/`, con su
`README.md`) y las pruebas de carga (`k8s/pruebas/`). Esos ya tienen su
documentación en sus carpetas, así que no se repite aquí.

## El mapa en una línea

```
navegador ─▶ ingress ─▶ nginx (web) ─▶ gateway ─▶ auth | subscriptions ─▶ Postgres (un esquema por servicio)
                                          │
                                          └─ valida JWT, pone X-Usuario-Id / X-Organizacion-Id / X-Rol
```

En local no hay ingress ni nginx: la web en `localhost:5173` llama directo al
gateway en `localhost:8000`. Del gateway hacia adentro es idéntico en los dos
entornos.
