# Correcciones PR 72

**Objetivo:** completar la integración Gmail y el presupuesto del escenario de carga sin perder reintentos, evidencia ni credenciales reconectadas.

**Referencia:** plan adjunto del 30-10-2026 y revisión de `fdea757` en PR #72.

**Arquitectura:** integrar FE-05 (#133) en la rama de MX-07; solo una respuesta exitosa acredita revocación. El generador corre en otro namespace usando el destino completo y Host del servicio; el presupuesto recibe explícitamente manifiesto y namespace de carga.

**Restricciones:** mantener CAS por credenciales_version, transacciones por cuenta, Outlook intacto ante 409 y revocado_en exclusivo del proveedor. No modificar migraciones publicadas ni fabricar aceptación del equipo.

- [x] Gmail: reproducir selección incorrecta, integrar #133, corregir invalid_token conservando pendiente o intentando el access de la misma instantánea; probar reconexión entre intentos y desaparición de fila.
- [x] Presupuesto: reproducir 13 pods y 2816 MiB; añadir argumentos explícitos para el Job y namespace, rechazar sobrecuota local y comprobar alternativa externa. Alinear CI, guion y documentación sin apagar workers.
- [x] Secretos: comprobar entrega pendiente; sacar los parches de secretos de argv con archivo temporal privado, probar con valores ficticios y limpieza al salir.
- [x] Validación: suites Connectors/PostgreSQL completas y eliminación en los otros servicios, checks y migraciones; conservar evidencia y límites del recorrido con dobles.
- [x] Outlook: registrar ratificación solo si el responsable la aporta; de lo contrario mantener pendiente explícito y draft.

**Foco de revisión:** refresh inválido con access utilizable; reconexión entre llamadas; ciphertext ilegible; caída de la segunda cuenta con evidencia previa confirmada; carga en namespace compartido frente a externo.

**Decisiones:** copia aislada creada mediante Git porque la herramienta de la aplicación responde «Not a git repository» desde la raíz del proyecto. Cambios previos conservados.

Validación local: 497 pruebas aprobadas, build web y migraciones correctos; arneses de rotación 79/0 y comparación 45/0. Recorrido HTTP real de cinco servicios documentado en docs/revisiones/pr72-correcciones-20261030.md. La ratificación se registra con las condiciones posteriores del usuario y solo cubre Outlook. Los checks del commit publicado se consultan en GitHub Actions.
