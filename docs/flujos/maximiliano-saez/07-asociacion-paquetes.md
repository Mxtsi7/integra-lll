# S3-MX-07 — Asociación explícita paquete/suscripción

## Estado y alcance

Implementa selección manual de un nombre de paquete Android y su asociación con una suscripción propia, almacenada en SecureStore por identidad de sesión. La pantalla no enumera aplicaciones instaladas, no llama al módulo de estadísticas, no inicia captura y no envía nombres de paquete a un endpoint. La captura real sigue condicionada al permiso Android y a una fuente de consentimiento vigente, pendiente de integración.

## Recorrido

1. Configuración abre `AsociarPaqueteAndroidScreen` mediante `ConfiguracionNavigator`; la pantalla carga la lista desde `getSuscripciones()` y las asociaciones de `controlAsociacionPaquetes`.
2. La persona escribe el nombre de paquete exacto y elige una suscripción. `crearControlAsociacionPaquetes.asociar` valida la sintaxis Android y consulta `getSuscripcion(id)` otra vez. La API autenticada autoriza la pertenencia; una respuesta para otro ID se rechaza.
3. Al asociar o quitar un paquete, el control captura `sesionDelToken(obtenerAccessToken())` antes de encolar la mutación. Si la sesión cambió al sacar la operación de la cola o antes de persistir, se rechaza. Las mutaciones se serializan para conservar ambas asociaciones cuando se piden dos escrituras en la misma sesión.
4. `guardarDatoSeguro` persiste el JSON en la clave `ASOCIACIONES_PAQUETES_USO` de `storageSeguro`. El documento separa asociaciones por identidad de sesión. Logout elimina esa clave con las credenciales; una escritura tardía de una generación anterior se descarta.
5. Se permite que una suscripción tenga varios paquetes, pero un mismo paquete solo puede señalar a una suscripción. `quitar` borra una asociación explícitamente.

## Validaciones y alternativas

El paquete debe seguir formato de segmentos separados por punto, sin espacios internos, comodines, rutas ni URL. La sesión ausente, cambio durante validación/escritura, formato de almacenamiento incompatible, referencia ajena y conflicto de paquete son errores explícitos; no se presentan como una asociación vacía.

## Pruebas

Las pruebas de `asociacionPaquetes.test.ts` usan almacenamiento en memoria y un validador de suscripción simulado. Cubren pertenencia rechazada, separación de sesiones, validación tardía, colisiones y operaciones de asociación o retiro que siguen en cola al cambiar de A a B. `storageSeguro.test.ts` verifica que cerrar la sesión elimina la clave. La autorización HTTP y el almacenamiento en Android requieren pruebas con backend y dispositivo.
