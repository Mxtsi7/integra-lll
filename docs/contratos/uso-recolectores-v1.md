# Uso de recolectores v1 — S3-MX-01

Propuesta para recepción por Victor (S3-VI-01); **pendiente de su validación**.
No documenta un endpoint ya implementado ni modifica `uso.registrado` de RabbitMQ.
El receptor convierte la entrada al modelo existente y publica su evento de dominio.
Android y navegador usan el mismo formato, con `origen` distinto.

## Entrada autenticada propuesta

`POST /api/suscripciones/{suscripcion_id}/uso/recolector/`, Bearer de la sesión.
Ruta propuesta, pendiente de implementación/confirmación por Victor.
Un objeto por petición; el emisor puede agrupar peticiones, sin asumir atomicidad de lote.
`usuario_id` y `organizacion_id` nunca provienen del cliente: el servidor los resuelve
desde la sesión, comprueba pertenencia de la suscripción y consentimiento vigente.
No aceptar IDs de una asociación de otra cuenta aunque el UUID sea válido.

| Campo | Regla v1 |
| --- | --- |
| `version` | Entero `1`; otra versión se rechaza |
| `event_id` | UUID creado una vez y persistido antes de enviar; igual en cada reintento |
| `recolector_id` | UUID aleatorio de instalación, sin identificador físico del dispositivo |
| `origen` | `android` o `navegador` |
| `inicio`, `fin` | Instantes UTC ISO 8601 terminados en `Z`; intervalo semiabierto `[inicio, fin)`; inicio < fin |
| `duracion_ms` | Entero no negativo, <= fin − inicio; tiempo observado, nunca reloj de procesamiento |
| `zona_horaria` | Nombre IANA; el receptor valida que exista; sirve para agrupación por día local |
| `cobertura` | `completa`, `parcial` o `sin_medicion` |
| `estado` | `activo`, `pausado`, `sin_permiso` o `revocado` |

Campos desconocidos se rechazan. No enviar dominio, URL, paquete, título, correo,
contenido, tokens dentro del cuerpo ni la lista de aplicaciones instalada.
La asociación explícita paquete/dominio → suscripción se resuelve antes de enviar.
Límites propuestos: intervalo de hasta 24 horas, cuerpo de hasta 4 KiB; el servidor
debe confirmarlos antes de integrar. Separar intervalos mayores sin perder identidad
de los segmentos; no truncarlos ni reutilizar un ID para un contenido distinto.

## Casos y respuesta

Los ejemplos de [uso-recolectores-v1.ejemplos.json](uso-recolectores-v1.ejemplos.json)
son fixtures sintéticas, **no uso capturado**. Android y navegador representan
120000 ms de actividad en el mismo intervalo. Minutos = duracion_ms / 60000, sin
redondear cada tramo; sumar primero. Una sesión que cruza medianoche se reparte
por intersección con días de `zona_horaria`, respetando sus cambios de horario.

`completa` significa observación continua del intervalo para esa suscripción;
`parcial` indica huecos y nunca permite inferir ausencia de uso en los huecos.
`sin_medicion` exige duración 0 y un estado distinto de activo. `completa` con
duración 0 y estado activo significa **cero observado**, distinto de dato ausente.
No hay evento de uso positivo al pausar, denegar o revocar. La señal de revocación
se comunica por el futuro control de consentimiento, no mediante un envío que
continúe después de revocar. Ningún extremo inventa cobertura por estar conectado.

| Resultado propuesto | Tratamiento del emisor |
| --- | --- |
| 201 `{event_id, estado: "aceptado", recibido_en}` | Retirar pendiente tras confirmar el ID |
| 200 `{event_id, estado: "duplicado", recibido_en}` | Mismo contenido y clave ya aceptados; retirar pendiente |
| 409 `event_id_conflictivo` | Mismo ID con contenido distinto; detener y mostrar error |
| 400 `evento_invalido` / `version_no_soportada` | Corregir; no reintentar automáticamente |
| 401 | Renovar según el contrato de sesión existente; no borrar una sesión nueva por respuesta tardía |
| 403 `consentimiento_requerido` / 404 | Detener envío; no revelar recursos de otra cuenta |
| 429 o 5xx, timeout o desconexión | Conservar ID y contenido, espera acotada y `Retry-After` |

El acuse lleva `recibido_en` UTC **del servidor**; una petición enviada no prueba
sincronización. Clave de deduplicación: identidad autenticada + recolector_id +
event_id. La aceptación y su efecto se guardan atómicamente; validar contenido
también en duplicados. Un timeout puede ocurrir después de persistir el registro.
El mecanismo y conservación de esta clave los valida Victor con su endpoint.

## Recepción pendiente

- Victor: confirmar ruta, límites, códigos, deduplicación, validaciones semánticas
  y correspondencia con RegistroUso y cobertura; enlazar PR/commit en S3-VI-01.
- Chris: consumir estados y acuses para S3-CH-21, sin mostrar cero si falta medición.
- Maxi: probar las mismas fixtures contra el endpoint real al recibirlo.
- Hasta entonces no se afirma integración HTTP, publicación ni acuerdo del equipo.
