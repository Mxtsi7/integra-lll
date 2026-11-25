# S3-MX-15 · Corrección de asociaciones Android

En Configuración → Asociar paquete Android, elegir **Corregir asociación**.
El formulario carga el paquete registrado. Se puede corregir el nombre y
elegir otra suscripción visible antes de pulsar **Confirmar corrección**.
Cancelar descarta el formulario sin escribir.

El servicio valida el destino con la API autenticada y comprueba que la
asociación original siga vigente en la sesión que inició la operación.
La corrección reemplaza la asociación en una única escritura cifrada.
Si el destino es ajeno, la sesión cambia o el original ya fue editado, se
rechaza la corrección. El cambio no autoriza la captura.

Las pruebas cubren el botón de confirmación, la escritura única y el rechazo
de destinos ajenos y ediciones obsoletas. El alcance de dominios en navegador
requiere una fuente autenticada de suscripciones para la extensión.
