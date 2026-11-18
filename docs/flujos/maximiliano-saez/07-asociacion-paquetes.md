# S3-MX-07 — Asociación explícita paquete/suscripción

## Estado y alcance

Implementa selección manual de un nombre de paquete Android y su asociación con una suscripción propia, almacenada en SecureStore por identidad de sesión. La pantalla no enumera aplicaciones instaladas, no llama al módulo de estadísticas, no inicia captura y no envía nombres de paquete a un endpoint. La captura real sigue condicionada al permiso Android y a una fuente de consentimiento vigente, pendiente de integración.

## Recorrido

1. Configuración abre `AsociarPaqueteAndroidScreen` mediante `ConfiguracionNavigator`; la pantalla carga la lista desde `getSuscripciones()` y las asociaciones de `controlAsociacionPaquetes`.
2. La persona escribe el nombre de paquete exacto y elige una suscripción. `crearControlAsociacionPaquetes.asociar` valida la sintaxis Android y consulta `getSuscripcion(id)` otra vez. La API autenticada autoriza la pertenencia; una respuesta para otro ID se rechaza.
3. El control captura `sesionDelToken(obtenerAccessToken())` antes de la consulta. Comprueba que la sesión siga igual antes de leer y persistir. Las mutaciones se serializan para no perder asociaciones cuando hay dos escrituras cercanas.
4. `guardarDatoSeguro` persiste el JSON en la clave `ASOCIACIONES_PAQUETES_USO` de `storageSeguro`. El documento separa asociaciones por identidad de sesión. Logout elimina esa clave con las credenciales; una escritura tardía de una generación anterior se descarta.
5. Se permite que una suscripción tenga varios paquetes, pero un mismo paquete solo puede señalar a una suscripción. `quitar` borra una asociación explícitamente.

## Validaciones y alternativas

El paquete debe seguir formato de segmentos separados por punto, sin espacios internos, comodines, rutas ni URL. La sesión ausente, cambio durante validación/escritura, formato de almacenamiento incompatible, referencia ajena y conflicto de paquete son errores explícitos; no se presentan como una asociación vacía.

## Pruebas

Las pruebas de `asociacionPaquetes.test.ts` usan un backend en memoria y un validador de suscripción simulado; cubren pertenencia rechazada, separación de sesiones, cambio de sesión tardío, colisión y mutaciones simultáneas. `storageSeguro.test.ts` verifica eliminación de la clave al cerrar sesión. Son pruebas con dobles: la autorización HTTP real y cifrado/Keystore de Android requieren backend y dispositivo.
