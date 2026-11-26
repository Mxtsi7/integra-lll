# Cierre de recolectores de Maxi

Base: main c3353692. Alcance: S3-MX-08 y S3-MX-16–21. Reutilizar contrato v1, asociaciones, lector Android, medición del navegador y enviarUsoPendiente. No modificar recomendaciones ni infraestructura.

## Entregas

1. `Maxi-consentimiento-recolectores`: consentimiento servidor por organización, usuario, suscripción, origen y recolector; aceptar, pausar, reanudar y revocar. Ventanas autorizadas impiden cargar actividad del período pausado. Revocar es terminal para ese recolector. Verificación y recepción comparten transacción y bloqueo con las modificaciones del consentimiento. Cliente compartido para este contrato.
2. `Maxi-sincronizacion-recolectores`: eventos inmutables con UUID, cursor y cola guardados juntos antes de enviar. Reintentos mantienen el mismo cuerpo; solamente un acuse validado elimina pendientes y actualiza última sincronización. Adaptadores Android y MV3, consentimiento explícito, asociación autorizada y controles visibles. Sin sumar períodos desconocidos como cero.

## Límites

Android consulta UsageEvents con la app abierta; no se promete un servicio Android permanente. El navegador usa observación conservadora y no sincroniza el último minuto que el detector de inactividad aún puede corregir. Las credenciales del navegador viven en storage.session y requieren login tras reiniciar Chrome; pendientes y cursores viven en storage.local separados por cuenta y servidor. Revocar detiene primero la captura local y luego confirma el retiro servidor, con reintento si no hay conexión. No enviar dominios ni paquetes en el contrato de uso.

## Revisión

Enfocar aislamiento de identidad, carrera revocar/enviar, escrituras antes del cursor, reintentos tras reinicio, corte por día local/DST y ausencia de captura durante pausa. Validar código con suites dirigidas, typecheck y lint; no declarar ejecución en hardware ni infraestructura que no esté disponible.
