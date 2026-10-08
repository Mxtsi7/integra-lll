# Estado de la arquitectura — qué está declarado y qué está corriendo

**Fecha de la medición:** 2026-10-07 · **Entorno:** `https://ojoalgasto-forellana.dev.censei.cl`

Los ADR describen la arquitectura **decidida**. Este documento describe la
arquitectura **desplegada**, y señala dónde las dos todavía no coinciden.

Existe por una razón concreta: un ADR en estado «aceptada» se lee como «esto ya
está hecho», y en Sprint 1 no todo lo está. Antes que descubrirlo en una demo,
preferimos dejarlo escrito.

Todo lo que dice esta tabla se midió contra el despliegue real. Los comandos
para volver a comprobarlo están al final, para que cualquiera del equipo pueda
repetir la verificación en vez de confiar en este archivo.

---

## Lo que está corriendo

| Componente | Declarado en | Estado al 2026-10-07 |
|---|---|---|
| `web` (frontend) | ADR-006 | **Funcionando.** Sirve el bundle compilado y proxea `/api/` hacia el gateway. |
| `gateway` | ADR-001, ADR-004 | **Funcionando.** Valida el JWT, descarta cabeceras de identidad del cliente e inyecta `X-Usuario-Id`, `X-Organizacion-Id` y `X-Rol`. |
| `auth` | ADR-001, ADR-004 | **Funcionando.** 8 usuarios y 8 organizaciones; ninguno sin organización. |
| `subscriptions` | ADR-001, ADR-002 | **Funcionando.** 6 migraciones aplicadas, 29 suscripciones reales. |
| `postgres` | ADR-002 | **Funcionando.** Un esquema por servicio, vía `ESQUEMA_BD`. |
| `redis` + Celery | ADR-001 | **Funcionando como infraestructura.** Ver la nota de abajo. |

El circuito completo está verificado de punta a punta: registro, inicio de
sesión, lectura del perfil y listado paginado de suscripciones responden a
través del ingress, el nginx de `web` y el gateway.

### Nota sobre Celery

El actor Temporizador (RF-13) está **montado y operativo**: `subscriptions-beat`
programa y `subscriptions-worker` ejecuta, usando Redis como intermediario. La
cadena funciona de principio a fin.

Lo que todavía no existe es la lógica de negocio colgada de ella: la única tarea
registrada es `latido`, que solo escribe en el registro. No hay cobros
automáticos, ni detección de suscripciones fantasma, ni avisos de fin de prueba.

---

## Lo que está declarado y todavía no existe

| Componente | Declarado en | Estado al 2026-10-07 |
|---|---|---|
| `connectors` | ADR-001 | **No implementado.** Sin Deployment ni Service; el nombre no resuelve en el clúster. |
| `analytics` | ADR-001 | **No implementado.** Ídem. |
| `notifications` | ADR-001 | **No implementado.** Ídem. |
| Eventos por RabbitMQ | ADR-003, `shared/events/catalogo.md` | **Desplegado pero sin uso.** Ver abajo. |

### RabbitMQ

El pod corre y está sano, pero nunca ha transportado nada:

- 0 conexiones
- 0 colas
- 7 exchanges, **todos** los que RabbitMQ crea por omisión (`amq.*` más el
  exchange sin nombre)
- el exchange `suscripciones` que declara `shared/events/catalogo.md` **no
  existe**

Es decir: el catálogo de eventos es un contrato acordado, no un contrato en uso.
Ningún servicio publica ni consume todavía.

### Consecuencia visible hoy

El gateway rutea cuatro prefijos hacia servicios que no existen:

| Ruta | Servicio destino |
|---|---|
| `/api/conectores/` | `connectors` |
| `/api/recomendaciones/` | `analytics` |
| `/api/asistente/` | `analytics` |
| `/api/alertas/` | `notifications` |

Sin sesión iniciada devuelven `401`, porque el gateway corta antes de intentar
el reenvío. **Con sesión iniciada devuelven `502`**, y los enlaces
correspondientes del menú lateral llevan a pantallas que no cargan.

---

## Qué queda para el Sprint 2

Se difiere de forma **deliberada**, no por olvido:

1. **Implementar `analytics`**, que es el primer consumidor real de eventos. Sin
   un consumidor, el bus no se puede demostrar ni probar.
2. **Publicar el primer evento de verdad** desde `subscriptions` (el candidato
   natural es `uso.registrado`, que ya existe como escritura) y declarar el
   exchange `suscripciones`.
3. **Implementar `connectors` y `notifications`**, en ese orden.
4. **Decidir qué hacer mientras tanto con las cuatro rutas muertas**: devolver
   `501 Not Implemented` desde el gateway, u ocultar las entradas del menú. Hoy
   el usuario recibe un `502`, que parece una falla y no una funcionalidad
   pendiente.

La decisión de ADR-003 **no cambia**: la regla de cuándo usar HTTP y cuándo
eventos sigue siendo la correcta. Lo que cambia es el reconocimiento de que su
mitad asíncrona todavía no está construida.

---

## Cómo volver a verificar esto

Con el contexto de Kubernetes del ramo apuntando a `student-forellana`:

```bash
# Qué pods existen de verdad
kubectl get pods

# Qué rutas expone el gateway y hacia qué servicio va cada una
kubectl exec deploy/gateway -- python -c "
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
django.setup()
from django.conf import settings
for p, s in settings.RUTAS.items(): print(p, '->', s)"

# Si un servicio existe, aparece su endpoint; si no, el comando falla
kubectl get endpoints analytics

# Estado real de RabbitMQ
kubectl exec deploy/rabbitmq -- rabbitmqctl list_connections
kubectl exec deploy/rabbitmq -- rabbitmqctl list_queues name messages
kubectl exec deploy/rabbitmq -- rabbitmqctl list_exchanges name type
```

Si alguno de estos resultados ya no coincide con lo que dice este documento,
**el documento está desactualizado**: corrígelo en el mismo cambio que movió la
realidad.
