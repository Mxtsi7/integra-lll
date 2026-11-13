# Asistente financiero: interfaz del chat y conexión con el asistente (web)

**Ramas:** `Christopher/chat_asistente` (S3-CH-14 y S3-CH-15) y `Christopher/chat_respaldo` (S3-CH-17) · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| S3-CH-14 | Construir la interfaz web del chat de IA | Hecha; en `main` (PR #154) |
| S3-CH-15 | Enviar preguntas y mostrar respuestas del asistente existente | Hecha; en `main` (PR #154) |
| S3-CH-17 | Mostrar errores y respuestas de respaldo del asistente | Hecha en su rama con el contrato que hoy está en `main`. Falta la revisión de otra persona y S3-VI-21 (Victor), que no está entregada |

**Dependencias, ya en `main`:**
- VI-22 (Victor): `POST /api/asistente/` en Analytics (`services/analytics/analytics/views.py`, función `asistente`),
  enrutada por el gateway (`gateway/config/settings.py`). La tarjeta de S3-CH-15 todavía lo lista como pendiente,
  pero el código ya está en `main`.
- MX-09 (Maximiliano): permisos por plan. El gateway deja pasar `/api/asistente/` solo con el plan Premium.
- MX-24 (Maximiliano): tiempo máximo de la IA. Con el proveedor lento o caído la API responde igual, con un resumen de respaldo.
- MX-24 (Maximiliano) y VI-22/VI-24 (Victor, PR #132): la respuesta `estado: "degradado"` con su `motivo`
  (`services/analytics/analytics/politica_ia.py` y `asistente.py`). Los motivos que manda `POST /api/asistente/` son
  `no_configurado`, `timeout`, `proveedor_no_disponible`, `cuota_agotada`, `cuota_no_disponible`, `capacidad` y
  `respuesta_invalida`. La cuota es por persona y por mes calendario.
- Gateway (`gateway/app/proxy.py`): responde 403 sin Premium, 502 si Analytics no está disponible, 504 si no
  respondió a tiempo y 503 si no pudo comprobar la sesión o los permisos.

**Dependencia que falta:** S3-VI-21 (Victor), «Resolver consultas de IA cuando faltan datos o falla el proveedor».
No tiene PR ni commits en `main` (revisado el 13 de noviembre de 2026, `main` en `2b2676f`). Su criterio «error, cuota y
ausencia de datos tienen resultado explícito» puede sumar un motivo o un estado para la falta de datos. S3-CH-17 se
hizo con lo que ya existe; cuando llegue S3-VI-21 hay que agregar su texto en `avisosDeRespaldo.ts` y validar el
contrato con Victor. Mientras tanto, un motivo nuevo muestra el aviso general.

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Nuevo o modificado | Qué hace |
|---|---|---|
| [shared/src/api/asistente.ts](shared/src/api/asistente.ts) | Nuevo | `consultarAsistente(pregunta)`, `RespuestaAsistente` y `LIMITE_PREGUNTA_ASISTENTE` (500, el máximo del backend) |
| [shared/src/api/asistente.test.ts](shared/src/api/asistente.test.ts) | Nuevo | Pruebas del cliente |
| [shared/src/index.ts](shared/src/index.ts) | Modificado | Exporta el cliente del asistente |
| [web/src/components/asistente/ChatAsistente.tsx](web/src/components/asistente/ChatAsistente.tsx) | Nuevo | S3-CH-14: la interfaz. Solo dibuja y recoge la pregunta |
| [web/src/components/asistente/ChatAsistente.module.css](web/src/components/asistente/ChatAsistente.module.css) | Nuevo | Estilos con los colores del tema |
| [web/src/components/asistente/mensajesChat.ts](web/src/components/asistente/mensajesChat.ts) | Nuevo | El tipo `MensajeChat` |
| [web/src/components/asistente/ChatAsistente.test.tsx](web/src/components/asistente/ChatAsistente.test.tsx) | Nuevo | Pruebas de la interfaz, con funciones falsas |
| [web/src/hooks/useAsistente.ts](web/src/hooks/useAsistente.ts) | Nuevo | S3-CH-15: manda la pregunta, arma la conversación, errores, reintento y sesión |
| [web/src/hooks/useAsistente.test.tsx](web/src/hooks/useAsistente.test.tsx) | Nuevo | Pruebas del hook |
| [web/src/pages/AsistentePage.tsx](web/src/pages/AsistentePage.tsx) | Nuevo | Une el hook con la interfaz |
| [web/src/pages/AsistentePage.test.tsx](web/src/pages/AsistentePage.test.tsx) | Nuevo | Flujo completo con el teclado, respaldo, errores y reintento |
| [web/src/pages/AsistentePage.sesion.test.tsx](web/src/pages/AsistentePage.sesion.test.tsx) | Nuevo | Cambio de sesión con una respuesta pendiente |
| [web/src/test/tokensDePrueba.ts](web/src/test/tokensDePrueba.ts) | Nuevo | `crearTokenDePrueba`: un JWT de prueba para las pruebas de sesión |
| [web/src/App.tsx](web/src/App.tsx) | Modificado | La ruta `/asistente` |
| [web/src/components/layout/BarraLateral.tsx](web/src/components/layout/BarraLateral.tsx) | Modificado | El destino «Asistente» en el menú |

**S3-CH-17** (rama `Christopher/chat_respaldo`):

| Archivo | Nuevo o modificado | Qué hace |
|---|---|---|
| [web/src/components/asistente/avisosDeRespaldo.ts](web/src/components/asistente/avisosDeRespaldo.ts) | Nuevo | El texto de cada motivo de respaldo: por qué no contestó la IA y qué hacer. `textoDeRespaldo(motivo)` |
| [web/src/components/asistente/avisosDeRespaldo.test.ts](web/src/components/asistente/avisosDeRespaldo.test.ts) | Nuevo | Pruebas de los textos: los 7 motivos del backend, motivo nulo o desconocido |
| [web/src/components/asistente/mensajesChat.ts](web/src/components/asistente/mensajesChat.ts) | Modificado | `esRespaldo: boolean` pasa a `respaldo: { motivo } \| null` |
| [web/src/components/asistente/ChatAsistente.tsx](web/src/components/asistente/ChatAsistente.tsx) | Modificado | Muestra el aviso según el motivo |
| [web/src/components/asistente/ChatAsistente.test.tsx](web/src/components/asistente/ChatAsistente.test.tsx) | Modificado | Pruebas del aviso por motivo |
| [web/src/hooks/useAsistente.ts](web/src/hooks/useAsistente.ts) | Modificado | Guarda el motivo en el mensaje y distingue 502, 503 y 504 |
| [web/src/hooks/useAsistente.test.tsx](web/src/hooks/useAsistente.test.tsx) | Modificado | Pruebas del motivo y de los estados 502, 503 y 504 |
| [web/src/pages/AsistentePage.test.tsx](web/src/pages/AsistentePage.test.tsx) | Modificado | El aviso con el motivo `cuota_agotada`, y un 504 que al reintentar trae el respaldo |

## Qué hace

- **Conversación (S3-CH-14).** Una lista de mensajes con el autor de cada uno («Tú» y «Asistente»). Vive solo en la
  vista: al salir de la página o recargarla se pierde, y el backend no recibe el historial, así que cada pregunta se
  responde sola. Sin mensajes, la pantalla dice qué hacer.
- **Formulario.** Cuadro «Tu pregunta» con etiqueta, máximo de 500 caracteres y contador (`aria-describedby`).
  **Enter** envía y **Mayús + Enter** baja de línea; con un método de entrada activo (IME), Enter confirma la palabra y no envía.
  Una pregunta en blanco no se puede enviar. El cuadro se vacía al enviar.
- **Teclado y lectores de pantalla.** El cuadro y el botón «Enviar» son controles nativos, alcanzables con Tab. La
  conversación es un `role="log"` con `aria-live="polite"` y `aria-relevant="additions"`: anuncia lo que se agrega sin
  interrumpir. La espera es un `role="status"` y los errores un `role="alert"`. Después de enviar o de reintentar,
  el foco vuelve al cuadro: «Enviar» se deshabilita y «Reintentar» desaparece mientras se espera, y sin esto el foco
  caía al inicio de la página.
- **Envío (S3-CH-15).** `POST /api/asistente/` con `{ mensaje }`. La pregunta aparece enseguida; mientras llega la
  respuesta se avisa «El asistente está respondiendo…», el botón se bloquea y el cuadro sigue activo (deshabilitarlo
  le quitaría el foco a quien escribe). Un doble Enter no manda dos preguntas.
- **Respaldo (S3-CH-17).** Si la API responde `estado: "degradado"`, el texto se muestra igual y no es un error. Debajo
  va un aviso que empieza con «Resumen automático.» y dice por qué la IA no contestó y qué hacer, según el `motivo`.
  Los textos están en `avisosDeRespaldo.ts`:

  | Motivo | Por qué | Qué hacer |
  |---|---|---|
  | `timeout` | El asistente con IA tardó demasiado en responder. | Puedes volver a preguntar. |
  | `respuesta_invalida` | El asistente con IA devolvió una respuesta que no se pudo usar. | Puedes volver a preguntar. |
  | `proveedor_no_disponible` | El asistente con IA no está disponible ahora. | Vuelve a preguntar en unos minutos. |
  | `capacidad` | El asistente con IA está atendiendo muchas consultas. | Vuelve a preguntar en unos minutos. |
  | `cuota_no_disponible` | No pudimos comprobar tu cuota de consultas con IA. | Vuelve a preguntar en unos minutos. |
  | `cuota_agotada` | Ya usaste tus consultas con IA de este mes. | Hasta el próximo mes recibirás este resumen automático. |
  | `no_configurado` | El asistente con IA no está activado en este momento. | Por ahora recibirás este resumen automático. |
  | Sin motivo o desconocido | El asistente con IA no estuvo disponible. | Puedes volver a preguntar. |

  Con `cuota_agotada` y `no_configurado` no se invita a volver a preguntar, porque no cambiaría el resultado. La
  falta de datos no tiene hoy un motivo propio: el backend la dice dentro del texto del resumen («Todavía no hay datos
  de uso ni recomendaciones…»). Por eso el encabezado ya no dice «con tus datos».
- **Errores.** Sin red: el mensaje de conexión de siempre. Un 403: «No tienes acceso al asistente financiero con tu
  cuenta.». Un 504 (el servicio no respondió a tiempo): «El asistente tardó demasiado en responder.». Un 502 o 503
  (el servicio no está disponible o no se pudieron comprobar los permisos): «El asistente no está disponible ahora.».
  Cualquier otro fallo: un mensaje general. Una respuesta sin texto no se muestra como mensaje vacío: es un
  error. En todos los casos la pregunta se queda en la conversación y **Reintentar** la manda otra vez sin repetirla.
- **Sesión.** El hook anota la sesión con la que se montó. Con la sesión ya cambiada no manda ni reintenta, y la
  respuesta o el error que llegan tarde no se aplican. Además, `<RutaPrivada>` vuelve a montar la página al cambiar de sesión.
- **Mocks de maquetación (criterio de S3-CH-14).** No hay ningún mock en el código de producción. Las funciones
  falsas `alEnviarFalso` y `alReintentarFalso` solo existen en `ChatAsistente.test.tsx`; el resto de las pruebas
  simulan únicamente la red.

## Cómo se comprobó

- **Pruebas nuevas:** `shared` 3 (cliente) y `web` 58: interfaz 18, hook 27, página 9 y sesión de la página 4.
  S3-CH-17 sumó 30 en `web` (textos de respaldo 17, interfaz 6, hook 6 y página 1): en total `web` tiene 88 pruebas
  del chat (textos de respaldo 17, interfaz 24, hook 33, página 10 y sesión 4).
- **Hallazgo en las pruebas de sesión.** Las pruebas de la página (A pendiente, entra B, llega la respuesta de A)
  pasaban aunque se quitara la comprobación de sesión del hook: al cambiar de sesión la página se vuelve a montar y
  React descarta lo que llega a la versión vieja. Por eso se agregaron 4 pruebas en el hook, que se queda montado:
  la respuesta y el error de A que llegan con B ya dentro no se aplican, y con la sesión cambiada no se envía ni se reintenta.
- **Mutaciones.** Se rompió a propósito cada comportamiento y en las 19 falla alguna prueba: respuesta y error de otra
  sesión, envío y reintento con la sesión cambiada, segundo envío sin frenar, envío bloqueado para siempre tras
  responder, respuesta vacía como mensaje, reintento que repite la pregunta, respaldo sin marcar y sin aviso, pregunta
  sin recortar o más larga que el máximo, Enter durante la composición, Mayús + Enter que envía, cuadro deshabilitado
  al esperar, conversación que no se anuncia, cuadro que no se vacía y foco que no vuelve al cuadro al enviar o al
  reintentar.
- **Mutaciones de S3-CH-17.** Se rompió a propósito cada comportamiento y en las 18 falla alguna prueba:
  - Hook: no guarda el motivo, trata toda respuesta como del asistente, deja pasar un motivo que no es texto, y el
    403, el 502, el 503 o el 504 caen en el mensaje general, o el 504 dice lo mismo que el 502.
  - Chat: ignora el motivo, el aviso pierde el encabezado o la recuperación, y la respuesta normal también lleva aviso.
  - Textos: la cuota agotada o la falta de configuración invitan a volver a preguntar, la capacidad no invita, un
    motivo desconocido no da el texto general, el `timeout` dice la causa del proveedor caído y el encabezado vuelve a
    decir «con tus datos».
- **Suites de S3-CH-17** sobre `main` (2b2676f) con estos cambios: pasan las 669 pruebas de `web` (45 archivos), las 276
  de `shared` (19 archivos) y el typecheck de los dos. `movil` y `desktop` no se corrieron.
- **Navegador (S3-CH-17):** se probó a mano en el navegador de la aplicación con una API falsa local (no con el backend
  real ni el gateway). Se vieron los 7 motivos con su aviso, el respaldo sin motivo y con un motivo desconocido (aviso
  general), el resumen sin datos y una respuesta normal sin aviso. Los errores 504, 502 y 503 mostraron su mensaje con
  **Reintentar**; con el teclado real (Mayús + Tab y Enter) la pregunta no se repitió y el foco volvió al cuadro. El
  contraste del aviso es 6,8:1 en tema oscuro y 6,66:1 en claro. Con 375 px de ancho el aviso baja de línea y no hay
  desplazamiento horizontal. No se probó con lector de pantalla.
- **Suites completas** de S3-CH-14 y S3-CH-15 sobre `main` (0e70d60) con esos cambios: `shared` 271 pruebas (18 archivos) y el typecheck de `shared` y `web`. En la última corrida de `web`
  pasaron 636 de 639: las 3 que fallan son de `CalendarioPage.test.tsx` y fallan por superar los 5 s de espera
  con la máquina cargada, no por una aserción. Ese archivo no tiene cambios en esta rama y, corrido aparte, pasa (30 de 30). En
  corridas completas anteriores pasó una vez entera y otra falló 1 de esas pruebas por lo mismo. No se comprobó si
  también ocurre sobre `main` sin estos cambios. `movil` y `desktop` no se corrieron.
- **Navegador (S3-CH-14 y S3-CH-15):** se probó a mano en el navegador de la aplicación, con una API falsa que imita `POST /api/asistente/` (no con
  el backend real). Se vio el chat vacío, la pregunta con Enter, la respuesta, la espera («El asistente está
  respondiendo…»), la respuesta de respaldo con su aviso, el error 500 con **Reintentar** (la pregunta no se
  repite) y el 403 con su mensaje. Se revisó en tema oscuro y claro y con 375 px de ancho, sin desplazamiento
  horizontal en la página. Con el teclado real, Tab va del cuadro a «Enviar» y Mayús + Tab a «Reintentar»; después
  de pulsar cualquiera de los dos con Enter el foco queda en el cuadro (antes de corregirlo caía al inicio de la
  página). No se probó con lector de pantalla.

## Fuera de estas tareas

- **S3-CH-16** (restricción Premium y límite de consultas): el menú muestra «Asistente» a todas las cuentas y un 403
  se dice con un mensaje general. No hay bloqueo previo para el plan gratuito ni contador de consultas.
- **La falta de datos como estado propio:** espera a S3-VI-21. Hoy solo se ve en el texto del resumen de respaldo;
  cuando el asistente con IA sí contesta, la web no sabe si había datos.
- **Reintentar una respuesta de respaldo:** el aviso dice cuándo conviene volver a preguntar, pero no hay un botón
  para repetir la pregunta; solo los errores lo tienen.
- **El 403 con «Reintentar»:** sin Premium, reintentar no sirve. Quitar el botón y explicar el plan es de S3-CH-16.
- **S3-CH-23:** las pruebas de conjunto con errores y datos vacíos.
- **Historial que se conserve** al recargar o entre dispositivos: el backend no lo guarda.
- **Cancelar y límite de tiempo en el cliente:** `pedir` no los admite. Una pregunta en vuelo cuando se sale de la
  página termina igual, pero su respuesta no se muestra. El backend corta al proveedor en pocos segundos.
- **Los `datos`** que la API devuelve junto a la respuesta (el contexto con el que respondió) no se usan ni se tipan.
