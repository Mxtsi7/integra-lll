# S3-MX-05 · Lectura local de tramos de Android

Desde **Configuración → Acceso de uso**, la persona concede el permiso Android,
escribe el identificador del paquete y pulsa **Acepto autorizar la consulta local**.
La pantalla informa qué datos lee y conserva el alcance solo en memoria. Registra
la sesión, un identificador por aceptación y el instante desde el que permite
medir. **Consultar intervalos** ejecuta la lectura bajo demanda y muestra cuántos
tramos completos encontró. Retirar la autorización o salir de la pantalla borra
el alcance. Una nueva aceptación empieza en un instante nuevo.

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

La autorización vive únicamente en esta pantalla. Los tramos se usan para mostrar
el resultado de la consulta y quedan fuera del almacenamiento y del envío. La
política de conservación y purga para historial persistente sigue pendiente de
MX-02. El [contrato v1](../../contratos/uso-recolectores-v1.md) de MX-01/VI-01
rige una futura integración con el receptor.

## Verificación

Desde `frontend/`, ejecutar
`npm test --workspace movil -- src/services/usoAndroid.test.ts src/screens/configuracion/UsoRecolectoresScreen.test.tsx`.
El doble del módulo verifica el alcance, el inicio de la aceptación, límites y
cambios de autorización. La prueba de pantalla comprueba la aceptación, la
consulta manual y el descarte de una respuesta tardía tras retirar. Para validar
Android, instalar la build de desarrollo, autorizar un paquete en la pantalla,
alternar entre esa app y una excluida, volver y consultar los intervalos. Comprobar los instantes de ambos
eventos, luego repetir con acceso denegado, revocado y una actividad abierta
fuera de la ventana. Registrar versión Android, commit, tiempos y resultado.
