# [ESTUDIO + CÓDIGO] VI-08 — Precisar e implementar máquina de estados

## Propósito

Precisar RF-03 y aplicar transiciones explícitas al ciclo de vida de una
suscripción. El estado representa la situación funcional del servicio; no es una
secuencia lineal y no equivale al campo `activo`, que conserva el significado de
disponibilidad/borrado lógico del registro.

## Flujo de ejecución

### Solicitud de una persona

1. El gateway entrega el contexto de organización, usuario y rol en las cabeceras
   `X-Organizacion-Id`, `X-Usuario-Id` y `X-Rol`.
2. `TenantViewSet` limita la consulta a la organización y el `ViewSet` excluye
   los registros con `activo=false`.
3. Para transicionar por API, la persona llama a
   `POST /api/suscripciones/<id>/transiciones/`. El serializer acepta únicamente
   `confirmacion_usuario` o `cancelacion_usuario`.
4. La vista exige un UUID de usuario y el rol `titular` o `integrante`. Si la
   solicitud es inválida o no autorizada, se responde con error y no se
   registra transición.
5. `Subscription.transicionar()` abre una transacción, bloquea la fila con
   `select_for_update()`, verifica que siga activa, consulta si el evento está
   permitido desde el estado actual y valida los umbrales temporales aplicables.
6. Si pasa la validación, actualiza el estado y crea un registro
   `TransicionEstado` en la misma transacción. Si algo falla, se revierte tanto
   el cambio como la auditoría.
7. La API devuelve la transición realizada. `GET
   /api/suscripciones/<id>/transiciones/` permite consultar el historial
   cronológico.

### Registro de uso

`POST /api/suscripciones/<id>/uso/` valida minutos y fecha; después, el modelo
bloquea y vuelve a cargar la suscripción para evitar escribir con una instancia
obsoleta. Actualiza última actividad y horas del mes, crea `RegistroUso` y, si
el estado actual es `fantasma`, aplica y audita `uso_registrado → activo`.
Una suscripción `activo=false` no admite uso ni transiciones.

### Eventos de sistema y cobros

Eventos como fin de prueba, fallo/regularización de cobro, detección de un
cobro nuevo y vencimiento de umbrales llaman al mismo método
`Subscription.transicionar(evento)`. Este método contiene las reglas de estado,
tiempo, bloqueo y auditoría, para que los llamadores futuros reutilicen la misma
validación.

**Alcance:** esta entrega no crea consumidores de eventos, tareas Celery ni un
programador para invocar automáticamente los eventos temporizados. Tampoco
afirma que esos procesos se hayan ejecutado. Las tareas de integración deben
invocar el método de dominio cuando reciban el evento correspondiente.

## Matriz de transiciones

| Estado inicial | Evento | Condición adicional | Estado resultante |
|---|---|---|---|
| `prueba` | `fin_prueba` | `fin_prueba` existe y llegó su fecha | `activo` |
| `prueba` | `fallo_cobro_inicial` | Ninguna adicional | `por_confirmar` |
| `prueba`, `activo`, `por_confirmar`, `fantasma` | `cancelacion_usuario` | Solicitud de titular o integrante | `cancelado` |
| `activo` | `fallo_cobro` | Ninguna adicional | `por_confirmar` |
| `activo` | `sin_cobros_60_dias` | Al menos 60 días desde el último cobro; si no hay cobros, desde la creación | `por_confirmar` |
| `por_confirmar` | `cobro_regularizado` | Ninguna adicional | `activo` |
| `por_confirmar` | `confirmacion_usuario` | Solicitud de titular o integrante | `activo` |
| `por_confirmar` | `sin_respuesta_30_dias` | Al menos 30 días en `por_confirmar` y 90 días sin cobros | `cancelado` |
| `activo`, `por_confirmar` | `sin_uso_45_dias` | Más de 45 días sin uso ni confirmación (mínimo 46 días calendario) | `fantasma` |
| `fantasma` | `uso_registrado` | Se registra uso válido | `activo` |
| Cualquiera de los cinco estados | `cobro_nuevo_detectado` | Cobro nuevo del mismo comercio | `activo` |

Toda combinación evento/estado no mostrada en la matriz se rechaza y no añade
una fila de auditoría. Los eventos de sistema no se exponen como eventos
arbitrarios en el endpoint público: el serializer de la API solo permite
confirmación de vigencia y cancelación voluntaria.

Una suscripción nueva solo puede iniciar en `prueba` o `activo`. Para iniciar
en `prueba`, debe incluir `fin_prueba`.

## Estado de negocio y borrado lógico

- `estado="cancelado"` expresa una cancelación funcional. Mantiene `activo=true`,
  conserva la fila y permite que un `cobro_nuevo_detectado` la reactive según
  CU-29/RN-21.
- `activo=false` es desactivación lógica ejecutada por `DELETE`. No es un estado
  de la máquina, oculta el registro de las vistas de suscripciones y bloquea
  nuevas transiciones o registros de uso.
- `pausada` no pertenece al enumerado de cinco estados implementado.

## Contrato API

Todas las rutas requieren `X-Organizacion-Id`. Las solicitudes manuales de
transición/cancelación también requieren un UUID en `X-Usuario-Id` y un
`X-Rol` igual a `titular` o `integrante`.

Confirmar que una suscripción `por_confirmar` continúa vigente:

```http
POST /api/suscripciones/<id>/transiciones/
Content-Type: application/json
X-Organizacion-Id: <organizacion-uuid>
X-Usuario-Id: <usuario-uuid>
X-Rol: titular

{"evento":"confirmacion_usuario"}
```

Solicitar cancelación mediante el mismo endpoint:

```json
{"evento":"cancelacion_usuario"}
```

El `PATCH /api/suscripciones/<id>/` mantiene compatibilidad para solicitar
cancelación con `{"estado":"cancelado"}` (también normaliza `cancelada`).
Cambiar directamente a otro estado se rechaza con `400`. Consultar auditoría:

```http
GET /api/suscripciones/<id>/transiciones/
X-Organizacion-Id: <organizacion-uuid>
```

La respuesta de transición contiene `id`, `evento`, `estado_anterior`,
`estado_nuevo`, `actor_id`, `actor_rol` y `ocurrido_en`. Los errores de evento o
estado no permitido responden `400`; la falta de identidad/rol de usuario para
la acción manual responde `403`; una suscripción ajena o no visible responde
`404`.

## Auditoría y persistencia

`TransicionEstado` guarda organización, suscripción, evento, estado anterior y
nuevo, actor (si lo proporciona la operación), rol y fecha/hora. La vista
requiere identidad para las acciones manuales. Los procesos de sistema pueden
registrar `actor_rol="sistema"` y el actor puede quedar nulo.

La tabla de auditoría se crea con la migración `0007_transicionestado.py`.
Cambios de estado y fila de auditoría se guardan atómicamente. El registro de
uso también bloquea la suscripción y actualiza desde el estado persistido para
no sobrescribir una transición concurrente.

## Decisiones y diferencias registradas

- RF-03 estaba vacío y conservaba la nota «no entendi vien esta revisa en txt».
  Esta tarea escribe la matriz usando RN-15 y RN-17–RN-21, los casos de uso
  documentados y la definición funcional confirmada durante la tarea.
- Se precisan eventos de fallo y regularización de cobro, además de la
  confirmación manual de vigencia.
- `por_confirmar` también puede pasar a `fantasma` tras el umbral de inactividad.
- Se sigue CU-29/RN-21 para reactivar con cobro nuevo, incluso desde
  `cancelado`; no se usa reactivación manual de cancelados.
- La entrada temporal a `fantasma`, `por_confirmar` y `cancelado` queda
  implementada y validable, pero no programada en un job Celery.
- La cancelación no equivale a `activo=false`; únicamente `DELETE` desactiva.

## Archivos de la tarea

### Implementación y contrato

| Archivo | Participación |
|---|---|
| [`services/subscriptions/app/models.py`](../services/subscriptions/app/models.py) | Enumera estados y eventos; matriz; validaciones temporales; transición transaccional con bloqueo y auditoría; registro de uso concurrente seguro; modelo `TransicionEstado`. |
| [`services/subscriptions/app/views.py`](../services/subscriptions/app/views.py) | Publica endpoints de historial/transición; valida rol e identidad; conserva `PATCH` para cancelación; conecta registro de uso con la transición de `fantasma`. |
| [`services/subscriptions/app/serializers.py`](../services/subscriptions/app/serializers.py) | Restringe estados iniciales, exige fin de prueba, limita eventos manuales y serializa el historial. |
| [`services/subscriptions/app/migrations/0007_transicionestado.py`](../services/subscriptions/app/migrations/0007_transicionestado.py) | Crea la tabla e índices del historial de transiciones. |

### Pruebas

| Archivo | Participación |
|---|---|
| [`services/subscriptions/tests/test_state_machine.py`](../services/subscriptions/tests/test_state_machine.py) | Comprueba combinaciones permitidas/prohibidas, umbrales, baja lógica, API, auditoría y regresión de escritura concurrente/instancia obsoleta. |
| [`services/subscriptions/tests/test_serializers.py`](../services/subscriptions/tests/test_serializers.py) | Prueba los estados iniciales admitidos y rechaza estados no iniciales o prueba sin fecha final. |
| [`services/subscriptions/tests/test_views.py`](../services/subscriptions/tests/test_views.py) | Verifica compatibilidad de cancelación por PATCH, auditoría, conservación de `activo=true` y flujos de registro de uso. |

### Requisitos y uso

| Archivo | Participación |
|---|---|
| [`docs/investigacion/requisitos-vigentes.md`](investigacion/requisitos-vigentes.md) | Resuelve RF-03 y deja explícitos matriz, umbrales, límites de automatización y diferencias frente al texto fuente. |
| [`docs/historico/REGLAS-DE-NEGOCIO.md`](historico/REGLAS-DE-NEGOCIO.md) | Registra la resolución VI-08 de los vacíos previos y aclara que `pausada` queda fuera de los estados vigentes. |
| [`services/subscriptions/README.md`](../services/subscriptions/README.md) | Documenta endpoints, autorización, ejemplos de uso y separación entre estado de negocio y borrado lógico. |

### Infraestructura existente reutilizada (sin cambios en VI-08)

| Archivo | Relación con el flujo |
|---|---|
| [`services/subscriptions/config/urls.py`](../services/subscriptions/config/urls.py) | El router registra el `SubscriptionViewSet`; las acciones agregan las rutas `/transiciones/` y `/uso/`. |
| [`shared/tenant/base.py`](../shared/tenant/base.py) | El middleware lee cabeceras de contexto y `TenantViewSet` aplica aislamiento por organización. |
| [`services/subscriptions/config/settings.py`](../services/subscriptions/config/settings.py) | Define timezone y agenda de Celery. La agenda existente no ejecuta las nuevas transiciones temporizadas. |

## Verificación

Comando para correr todas las pruebas del servicio:

```powershell
Set-Location services\subscriptions
.\venv\Scripts\pytest.exe -q
```

Evidencia de la última ejecución tras la revisión: **184 pruebas pasaron**. La
comprobación de migraciones con `manage.py makemigrations app --check --dry-run`
reportó **No changes detected**. En este entorno Django mostró una advertencia
de conectividad al host PostgreSQL `postgres` al revisar el historial remoto de
migraciones; las pruebas locales sí terminaron correctamente.
