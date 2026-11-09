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
| `inicio`, `fin` | Instantes UTC ISO 8601 terminados en `Z`; intervalo semiabierto `[inicio, fin)`; inicio < fin; contenido en un solo día de `zona_horaria` |
| `duracion_ms` | Entero no negativo, <= fin − inicio; tiempo observado, nunca reloj de procesamiento |
| `zona_horaria` | Nombre IANA; el receptor valida que exista; sirve para agrupación por día local |
| `cobertura` | `completa`, `parcial` o `sin_medicion` |
| `estado` | `activo`, `pausado`, `sin_permiso` o `revocado` |

Campos desconocidos se rechazan. No enviar dominio, URL, paquete, título, correo,
contenido, tokens dentro del cuerpo ni la lista de aplicaciones instalada.
La asociación explícita paquete/dominio → suscripción se resuelve antes de enviar.
Cada pendiente persiste **juntos** `suscripcion_id` (destino de la ruta) y `evento`
(cuerpo anterior), vinculados a la sesión/cuenta que lo creó. `suscripcion_id` no se
añade al cuerpo ni se sustituye al editar la asociación. Reintentar utiliza ese
destino y cuerpo inmutables; cambiar de cuenta nunca reasigna pendientes a la nueva.
Una corrección posterior requiere un flujo explícito de rectificación con el receptor:
no cambiar ruta, regenerar IDs ni reenviar silenciosamente un hecho ya aceptado.
Límites propuestos: un día local por intervalo y cuerpo de hasta 4 KiB. Un día local
puede durar 23, 24 o 25 horas; no fijar un máximo de 24 h que rechace un día válido.
Estos límites todavía requieren confirmación de Victor antes de integrar.

## Casos y respuesta

Los ejemplos de [uso-recolectores-v1.ejemplos.json](uso-recolectores-v1.ejemplos.json)
son fixtures sintéticas, **no uso capturado**. Cada ejemplo de envío es un pendiente
`{suscripcion_id, evento}`; solo `evento` se envía como cuerpo. Android y navegador
representan 120000 ms de actividad en el mismo intervalo.

### Emisión por día local

El emisor conserva los tramos temporales de actividad y observación hasta dividirlos:
construye los límites de cada fecha en la zona IANA y los convierte a UTC; no suma
86400000 ms ni usa la fecha UTC como día del usuario. Intersecta cada tramo real de
actividad con esas ventanas y **después** suma `duracion_ms` de cada segmento.
No repartir proporcionalmente un total escalar: no permite saber en qué día ocurrió
la actividad. Si el emisor perdió sus tramos, no inventar reparto ni cobertura.
Cada segmento resultante recibe su propio `event_id` antes de persistir el pendiente;
el mismo segmento conserva su ID en todos los reintentos. `fin` puede ser exactamente
la medianoche siguiente por ser exclusivo. El receptor rechaza un cuerpo que cruce
ese límite (`400 intervalo_cruza_dia_local`); no lo divide después de aceptar su ID.
La zona del segmento es inmutable; cambiar la zona del dispositivo no refecha pendientes.

Ejemplo `medianoche` (America/Santiago): observación desde `2026-11-09T02:59:30Z`
hasta `03:00:30Z`; actividad real únicamente desde `02:59:50Z` hasta `03:00:05Z`.

| Fecha local | Ventana emitida UTC | Actividad asignada | Minutos exactos |
| --- | --- | ---: | ---: |
| 2026-11-08 | [02:59:30, 03:00:00) | 10000 ms | 1/6 |
| 2026-11-09 | [03:00:00, 03:00:30) | 5000 ms | 1/12 |

Se conservan 15000 ms, sin duplicar el instante de medianoche. Dividir 7500/7500
sería incorrecto. Los dos intervalos observados de 30 s no acreditan días enteros.

`completa` significa observación continua del intervalo para esa suscripción;
`parcial` indica huecos y nunca permite inferir ausencia de uso en los huecos.
`sin_medicion` exige duración 0 y un estado distinto de activo. `completa` con
duración 0 y estado activo significa **cero observado**, distinto de dato ausente.
No hay evento de uso positivo al pausar, denegar o revocar. La señal de revocación
se comunica por el futuro control de consentimiento, no mediante un envío que
continúe después de revocar. Ningún extremo inventa cobertura por estar conectado.

### Precisión y proyección a los modelos vigentes

En esta rama, `RegistroUso.minutos` y `UsoMensual.minutos` son enteros; el serializer
manual exige al menos 1 y `Subscription.registrar_uso` convierte mediante `int`.
`CoberturaUso` acredita rangos de fechas, no segundos. Por ello esta propuesta
**requiere un adaptador de recepción de Victor**; no usar el POST manual para estos
cuerpos, ni pasarle `0.5`, `0` o los eventos crudos de recolectores.

El adaptador debe persistir el evento aceptado con milisegundos enteros y cobertura,
destino y zona originales como fuente exacta, en la misma operación idempotente.
La proyección exacta por suscripción/fecha/zona suma esos milisegundos una sola vez.
Para compatibilidad entera: `minutos_enteros = total_ms // 60000` y
`residuo_ms = total_ms % 60000`. Conservar el residuo por día; nunca trasladarlo al
día siguiente ni descartar una fracción al cerrar mes. Proyectar solo el incremento
de minutos enteros sobre lo ya proyectado, sin tocar los registros manuales.
Las horas se calculan desde el total exacto (`total_ms / 3600000`); redondear solo
al presentar, no al persistir cada tramo ni al sumar días.

El registro fuente debe conservar también presencia positiva (`total_ms > 0`) y
su fecha, incluso cuando la proyección entera sea cero. Los consumidores de actividad,
recomendaciones e historial deben usar esa evidencia exacta: cero entero por redondeo
no significa ausencia de uso. Los modelos/consumidores actuales no lo garantizan;
su adaptación y pruebas por Victor son condición de integración, no algo implementado
por esta PR. No publicar fracciones o cobertura dentro de `uso.registrado` sin
versionar/validar primero su contrato y consumidores existentes.

| Caso sintético, mismo día | Fuente exacta | Proyección entera / residuo | Cobertura / efecto |
| --- | --- | --- | --- |
| Primer tramo de 30 s | 30000 ms = 0,5 min | 0 min / 30000 ms | Hay uso positivo; observar 30 s no acredita el día |
| Segundo tramo de 30 s | 60000 ms = 1 min acumulado | 1 min / 0 ms; incremento +1 | Sin perder los dos tramos ni duplicarlos al reintentar |
| Día completo observado, sin actividad | 0 ms = 0 min | 0 min / 0 ms | Acreditar ese día; no crear fila de uso positivo, reactivar ni cambiar última actividad |
| Día sin medición | Duración reportada 0; uso real desconocido | Sin incremento de uso | No acreditar cobertura ni presentar cero real; resultado `sin_datos` |

Para acreditar un día en `CoberturaUso`, la unión de intervalos `completa` debe cubrir
todo ese día local sin huecos. Fusionar solo tramos solapados/contiguos acreditados;
no convertir su mínimo/máximo en cobertura del hueco. `parcial` se conserva como tal
y no acredita una ventana completa; el emisor puede enviar subtramos efectivamente
observados como `completa`. `sin_medicion` no acredita nada. Cobertura y uso se
proyectan por separado: puede haber uso positivo sin cobertura del día completo.

| Resultado propuesto | Tratamiento del emisor |
| --- | --- |
| 201 `{event_id, suscripcion_id, estado: "aceptado", recibido_en}` | Retirar solo el pendiente cuyo ID **y destino** coinciden con el acuse |
| 200 `{event_id, suscripcion_id, estado: "duplicado", recibido_en}` | Misma clave, destino y cuerpo; retirar ese pendiente sin repetir efectos |
| 409 `event_id_conflictivo` | Misma clave con destino o cuerpo distinto; conservar para resolver, no reintentar automáticamente |
| 400 `evento_invalido` / `version_no_soportada` | Corregir; no reintentar automáticamente |
| 401 | Renovar según el contrato de sesión existente; no borrar una sesión nueva por respuesta tardía |
| 403 `consentimiento_requerido` / 404 | Detener envío; no revelar recursos de otra cuenta |
| 429 o 5xx, timeout o desconexión | Conservar ID y contenido, espera acotada y `Retry-After` |

El acuse lleva `recibido_en` UTC **del servidor**; una petición enviada no prueba
sincronización. Clave de deduplicación: identidad autenticada + recolector_id +
event_id, **sin añadir suscripcion_id a la clave**. El registro de deduplicación
vincula esa clave al destino de la ruta y a **todos** los campos validados del cuerpo:
version, event_id, recolector_id, origen, inicio, fin, duracion_ms, zona_horaria,
cobertura y estado. Comparar valores tipados normalizados (UUID e instantes), sin
depender del orden/espacios del JSON. Resolver autenticación, consentimiento y permiso
al destino antes de consultar duplicados para no revelar recursos ajenos.
Misma clave + mismo destino/cuerpo → 200 con los identificadores y `recibido_en`
del acuse original, y `estado: "duplicado"`; misma clave + otro destino **también autorizado** o cuerpo diferente
→ 409 sin efecto nuevo en ninguna suscripción. No devolver 200 por comparar solo
el cuerpo, ni 201 por incluir destino en la clave. Un destino ajeno sigue dando 404,
sin revelar si la clave existía. La aceptación, efectos, proyecciones y acuse deben
ser atómicos con unicidad y bloqueo adecuados; un timeout puede ocurrir tras persistir.
Conservación de la clave y pruebas concurrentes PostgreSQL las valida Victor.

En `duplicados` de las fixtures: primer envío Android al destino A → 201; repetir
el mismo pendiente en la misma ruta → 200 y el mismo acuse; reutilizarlo en destino B
autorizado → 409. No basta confirmar un event_id de otra ruta para borrar un pendiente.

## Recepción pendiente

- Victor: confirmar ruta, límites, códigos, deduplicación, validaciones semánticas
  y correspondencia con RegistroUso y cobertura; enlazar PR/commit en S3-VI-01.
- Chris: consumir estados y acuses para S3-CH-21, sin mostrar cero si falta medición.
- Maxi: probar las mismas fixtures contra el endpoint real al recibirlo.
- Hasta entonces no se afirma integración HTTP, publicación de eventos ni acuerdo del equipo.

## Evidencia y cierre de S3-MX-01

Comprobación reproducible de los ejemplos: `python -m unittest discover -s docs/contratos/tests -v`.
Es evidencia de cálculo/consistencia de fixtures, **no** de un endpoint, migración,
PostgreSQL o acuerdo humano. Registro de recepción a completar antes de cerrar:

| Validación requerida | Responsable | Evidencia | Estado |
| --- | --- | --- | --- |
| Reparto local, precisión, cobertura y deduplicación de esta versión | Victor | PR/commit revisado + aprobación explícita enlazada | Pendiente |
| Adaptador, casos HTTP y proyecciones reales sin pérdida | Victor y Maxi | Endpoint, commit y resultados reproducibles | Pendiente |

No cerrar S3-MX-01 por haber añadido esta tabla. La validación debe referirse al
commit corregido; una propuesta de Maxi no sustituye la aceptación del receptor.
