# Tanda completa de Notificaciones — Implementation Plan

> For agentic workers: usar superpowers:executing-plans para ejecutar y requesting-code-review antes de integrar.

**Goal:** entregar consumidor FE-24 y una tanda de Notificaciones reproducible sin sumar capacidad al namespace.
**Architecture:** conservar proyección/generador de main; extraer el consumidor necesario del WIP, inbox atómico y DLQ propia; API y consumidor comparten un pod, generador queda suspendido hasta la tanda.
**Tech Stack:** Django 5.1, PostgreSQL, Pika/RabbitMQ v2, Kubernetes, Bash.
**Spec:** plan de tandas aprobado por Maxi; criterios de Contexto_hilo_Integra_III_2026-10-28.md proporcionado por el usuario.

## Global Constraints
- No push directo a main; revisar y mergear mediante PR con checks.
- No pedir capacidad ni nuevos permisos; no afirmar aislamiento/despliegue no ejecutado.
- ACK después de commit, rechazo durable, tenant eliminado no resucita inbox/proyección.
- Conservar migraciones publicadas y auth-eliminaciones; no introducir FE-23/outbox de entrega incompleto.

## Review Focus
- Reentrega, rollback y errores de integridad ajenos al inbox.
- Eliminación concurrente/anterior y borrado completo del inbox.
- Routing v2 y DLQ separada de Subscriptions.
- API/consumidor/migración/Job efectivos dentro de todas las cuotas.
- Imágenes privadas, credenciales por servicio y restauración operativa explícita.

## Task 1 — Integrar base #139
- [x] Revisar HEAD, correcciones y checks; revisión independiente.
- [x] Aprobar y mergear #139 sin dar D-11 por cerrado.

## Task 2 — Completar consumidor mínimo FE-24
- [ ] Tests de reentrega, rollback, contrato, ACK/commit, reintentos y eliminación.
- [ ] Modelo inbox + migración nueva + limpieza; consumo aplica proyección actual.
- [ ] Comando Pika y topología propia; configuración/dependencias explícitas.
- [ ] Suite completa y recorrido con RabbitMQ real en CI; revisión independiente.

## Task 3 — Entregar tanda desplegable
- [ ] Test de perfil completo, secretos, puertos, comandos, imagen y presupuesto.
- [ ] Deployment/Service, construcción de imagen opcional y renderizado explícito de tanda.
- [ ] README de entrada/salida, recuperación y límites; perfil sin falsos faltantes.
- [ ] Tests de scripts/presupuesto y checks CI; revisión y PR, merge si cumple.
