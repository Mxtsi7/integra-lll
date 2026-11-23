# S3-MX-05 · Lectura local de tramos de Android

Disponible como operación del control móvil. Para habilitarla desde una pantalla,
el anfitrión debe suministrar una sesión activa y consentimiento explícito vigente.
El alcance incluye un identificador distinto por aceptación o edición, el instante
desde el que se permite medir y la lista de paquetes elegidos. La ausencia de
alcance bloquea la lectura.

1. `crearControlUsoAndroid(...).leerTramos(inicioMs, finMs)` valida una ventana
   pasada de hasta 24 horas. Ajusta su inicio a la aceptación y comprueba sesión,
   alcance y permiso del sistema antes de llamar al módulo nativo.
2. `UsoAndroidModule.leerTramos` consulta `UsageStatsManager.queryEvents` en la
   ventana semiabierta. Solo empareja eventos de reanudación y pausa observados
   para el mismo paquete autorizado y clase. Los tramos sin pareja o ambiguos
   por instancias simultáneas se descartan, igual que aperturas que seguían
   pendientes al apagar, bloquear o dejar la pantalla no interactiva.
3. El control vuelve a comprobar sesión, generación de consentimiento y permiso.
   Entrega únicamente `{ paquete, inicioMs, finMs }` de los paquetes autorizados
   dentro de la ventana. La clase Android queda en memoria dentro de la consulta.
4. S3-MX-06 puede recibir estos tramos para agregar minutos por período.
   Una lista vacía no prueba cero observado ni cobertura completa. Los tramos
   que atraviesan el inicio o final sin ambos eventos observados quedan fuera.

La lectura es local y bajo demanda. Esta PR prepara el lector con su control de
acceso, sin activar la captura desde Perfil ni crear almacenamiento o envío.

## Verificación

Desde `frontend/`, ejecutar
`npm test --workspace movil -- src/services/usoAndroid.test.ts`.
El doble del módulo verifica el alcance, el inicio de la aceptación, límites y
cambios de autorización. Para probar Android, compilar la build de desarrollo,
conectar un anfitrión de prueba con el flujo de consentimiento aprobado y
alternar entre una app autorizada y una excluida. Comprobar los instantes de ambos
eventos, luego repetir con acceso denegado, revocado y una actividad abierta
fuera de la ventana. Registrar versión Android, commit, tiempos y resultado.
