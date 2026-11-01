# Seguimiento FE-24 — ingesta y tanda de Notificaciones (#140)

[Tarjeta FE-24](https://trello.com/c/KVs2FHQq) · [PR #140](https://github.com/Mxtsi7/integra-lll/pull/140).
Estado: implementación parcial; no cerrar la tarjeta con esta PR.

| Alcance de la tarjeta | Entrega en #140 | Pendiente |
|---|---|---|
| Recibir eventos de suscripción v2 | Inbox, proyección y ACK tras commit | Evidencia real del clúster |
| ACK/retry/cola de fallos | Tres intentos con espera, DLQ propia y `reprocesar_fallidos --limite N` | Ejecutar recuperación y guardar efecto final |
| Emitir `alert.due` (`alerta.activada.v2`) | No incluido | Integrar productor/outbox y entrega con FE-23, con IDs e idempotencia; probar contrato y canal |
| Alerta visible en aplicación | Generador y API existentes conectados a la ingesta | Captura de alerta/contador/lectura en la campana |

La ingesta reimplementada a partir del WIP no acredita la emisión del contrato de alerta
ni email/push. La emisión sigue dentro del alcance original FE-24; excluirla de
esta PR no la convierte en terminada ni la reasigna automáticamente a FE-23.
Registrar este enlace y la diferencia al actualizar la tarjeta. No se ha
modificado su estado ni atribuido aceptación a Felipe/Victor.

El contrato compartido declara `datos.fin_prueba` opcional (fecha o null) y
conserva mensajes previos sin ella. Notificaciones la acepta; Analytics no valida
estos snapshots en su consumidor de solapamientos, que usa otro contrato. Esto
no sustituye la aceptación de los receptores de MX-21: queda pendiente su revisión.

Seguir [entrada, recuperación y salida de la tanda](../../../k8s/tandas/README.md).
La validación PostgreSQL/RabbitMQ de CI y el smoke SQLite de la imagen deben
reportarse por separado de migrar con datos y demostrar la campana en el clúster.
No se adjunta evidencia de infraestructura que no se ha ejecutado.

Diferencias respecto del WIP: se conserva la proyección/generador de main y se
implementa inbox propio. La columna `consumidor` se incorpora con migración 0007
sin reescribir 0006 publicada; no se persiste `hubo_efecto` (el retorno de aplicar
indica efecto/no efecto, y el inbox acredita recepción incluso para obsoletos).
El outbox de entrega/alert.due del WIP sigue fuera de este incremento.

## Brechas que limitan la demostración

- **RN-03 / DELETE de suscripciones:** `perform_destroy` desactiva la fila sin
  evento; MX-21 v2 todavía no expresa la eliminación. La proyección y alertas
  existentes pueden conservarse. No demostrar ni afirmar este caso como resuelto;
  no borrar suscripciones en la tanda. Limpiar la organización por Auth con ACK.
  Pendiente: acordar hecho de baja con MX-21/productor y receptor, y probar la
  desactivación de proyección/avisos. No introducir un estado inventado.
- **Disponibilidad:** API y consumidor comparten pod; caída AMQP puede ponerlo
  NotReady/CrashLoopBackOff. No hay reconexión interna ni disponibilidad separada.
- **Despacho:** el modo síncrono no publica RabbitMQ; Beat debe estar activo.
  Con el generador: 12 pods, 2752 Mi, 1950m CPU límite, sin margen de memoria.
- **Deuda previa:** publicador de Subscriptions sin blocked_connection_timeout;
  una alarma RabbitMQ puede atascar despacho. No se acredita recuperación acotada.
