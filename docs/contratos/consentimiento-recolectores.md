# Consentimiento de uso v1

`POST /api/suscripciones/{id}/uso/consentimiento/` usa la misma autenticación del receptor. Cuerpo: `recolector_id` UUID, `origen` android/navegador, `version_texto` uso-v1 y `accion` aceptar/pausar/reanudar/revocar. No recibe identidad del cuerpo.

Respuesta 200: recolector_id, origen, estado (activo/pausado/revocado), version_texto, desde (inicio de la última ventana activa o null), actualizado_en, servidor_ahora y zona_horaria del informe. `GET` con recolector_id devuelve únicamente el consentimiento del usuario y organización actuales; 404 si no existe. Acciones repetidas son idempotentes; aceptar un registro pausado/revocado responde 409. Tras revocar se debe crear otro UUID y obtener otra aceptación explícita. Revocar un UUID desconocido impide que una aceptación en vuelo lo active después.

Pausar cierra la ventana de captura y permite sincronizar pendientes anteriores. Reanudar abre otra ventana; no autoriza el intervalo de pausa. El receptor exige que todo el intervalo del evento esté dentro de una sola ventana autorizada y no sea futuro. Revocar bloquea todos los nuevos envíos del recolector, incluyendo pendientes; no borra hechos ya aceptados. El cliente debe detener captura y envíos antes de esperar la revocación remota y reintentar su confirmación si pierde la conexión.

La misma transacción mantiene bloqueada la suscripción al comprobar consentimiento y persistir el hecho/outbox. Las modificaciones de consentimiento adquieren ese mismo bloqueo: una revocación confirmada no puede competir con una inserción posterior autorizada con estado antiguo. El contrato de uso v1 no cambia.
