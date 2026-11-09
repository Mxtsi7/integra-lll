# Consentimiento de seguimiento — S3-MX-02

Propuesta de producto para validar con Victor y Chris. No constituye acuerdo de
retención ni una afirmación de cumplimiento legal. Se apoya en RF-04 y RNF-03 de
[requisitos vigentes](../investigacion/requisitos-vigentes.md).

## Activación y finalidad

El seguimiento automático es opcional, desactivado al instalar y separado del
consentimiento general de registro, login y conexión OAuth. Su finalidad es mostrar
uso de las suscripciones elegidas y apoyar recomendaciones con cobertura explícita.
No aceptar por casillas premarcadas, instalación o inicio de sesión.
La pantalla debe explicar datos, destino, conservación y retirada antes de aceptar.
Registrar versión del texto, instante UTC y selección de servicios. La futura
persistencia backend de esta aceptación corresponde a su integración, no existe
por publicar este documento.

| Control | Qué permite | Qué no demuestra |
| --- | --- | --- |
| Consentimiento de seguimiento | Capturar solo servicios seleccionados | Permiso del sistema o acceso al backend |
| Acceso de uso Android | Consultar API nativa | Consentimiento informado ni aprobación de todas las apps |
| Permiso de host del navegador | Leer dominio autorizado | Consentimiento de seguimiento ni asociación a suscripción |
| Sesión de Ojo al Gasto | Acceso autenticado a recursos propios | Autorización de captura |

## Minimización y conservación

| Dato | Tratamiento propuesto |
| --- | --- |
| Paquete Android / hostname exacto | Local, elegido por usuario; nunca rutas, parámetros, títulos ni contenido |
| Asociación a suscripción | Confirmación explícita; no inferir por nombre parecido |
| Intervalo, duración, origen, zona, cobertura e ID aleatorio | Entrada mínima descrita en contrato v1 |
| Identidad y organización | Derivadas por el servidor de la sesión autenticada |
| Tokens | Almacenamiento de sesión existente; nunca en eventos ni registros de diagnóstico |

**Plazo del historial persistente: pendiente de acuerdo del equipo.** No se fija
un número de días ni se implementa historial duradero/envío habilitado por defecto
antes de aprobar plazo, purga y texto. Esto bloquea el cierre completo de S3-MX-02
y la integración persistente de S3-MX-16/19; permite preparar sus componentes.
La extensión inicial funciona únicamente en una sesión temporal de navegador,
con consentimiento específico para esa modalidad: configuración y observación
en storage.session, sin disco local, servidor ni ejecución en incógnito.
Cerrar el navegador, recargar/deshabilitar la extensión o retirar consentimiento
descarta esa sesión. No confundir esta modalidad con historial productivo.
La eliminación de cuenta conserva la política y barreras existentes; este texto
no amplía plazos ni cambia retención de auditoría o consentimiento de la cuenta.

## Pausar y retirar

- Pausa: cerrar tramo activo y no abrir otro; conservar consentimiento. Su hueco
  se expresa como no medido, nunca cero observado. Reanudar inicia un tramo nuevo.
- Retirada: detener captura y envíos, invalidar respuestas tardías, cancelar trabajo
  programado y descartar pendientes locales. Requiere consentimiento nuevo para volver.
- Falta/revocación del permiso: detener captura y señalar `sin_permiso`.
- La retirada futura en servidor debe bloquear ingesta; borrar historial ya recibido
  requiere el flujo de eliminación correspondiente, no afirmar que parar el emisor lo borra.

## Recepción y cierre

Victor debe validar el contrato, almacenamiento y purga. Chris debe validar texto
y estados visibles en S3-CH-21. Registrar aprobación con PR/commit y el plazo acordado;
no inventar una reunión o consentimiento ajeno. Esta propuesta deja esos acuerdos pendientes.

### Registro obligatorio antes de cerrar S3-MX-02

| Acuerdo/validación | Contenido y evidencia que debe registrarse | Estado |
| --- | --- | --- |
| Plazo del historial persistente | Duración y unidad por tipo de dato; inicio del cómputo; responsable; acta/PR y fecha | Pendiente, sin plazo aprobado |
| Purga | Qué se elimina, cuándo corre, máximo de demora y pendientes/reintentos; prueba y responsable | Pendiente |
| Texto informado | Texto completo y versión aceptada; datos, finalidad, destino, plazo, pausa y retirada | Pendiente |
| Recepción de Victor | Aprobación explícita de plazo/purga y su implementación, con PR/commit o acta | Pendiente |
| Validación con Chris | Aprobación del texto/versión y estados visibles, con PR/commit o acta | Pendiente |

Las evidencias deben referirse a esta versión del contrato y conservar quién aprobó,
cuándo y qué acordó. Mantener la tarjeta abierta hasta completar este registro.
Corregir documentación o pasar ejemplos no certifica estas aprobaciones; tampoco
habilita automáticamente captura persistente, envíos ni el cierre de S3-MX-01.
