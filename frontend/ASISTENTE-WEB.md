# Asistente financiero: interfaz del chat y conexión con el asistente (web)

**Rama:** `Christopher/chat_asistente` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| S3-CH-14 | Construir la interfaz web del chat de IA | Hecha en su rama; falta la revisión de otra persona |
| S3-CH-15 | Enviar preguntas y mostrar respuestas del asistente existente | Hecha en su rama; falta la revisión de otra persona |

**Dependencias, ya en `main`:**
- VI-22 (Victor): `POST /api/asistente/` en Analytics (`services/analytics/analytics/views.py`, función `asistente`),
  enrutada por el gateway (`gateway/config/settings.py`). La tarjeta de S3-CH-15 todavía lo lista como pendiente,
  pero el código ya está en `main`.
- MX-09 (Maximiliano): permisos por plan. El gateway deja pasar `/api/asistente/` solo con el plan Premium.
- MX-24 (Maximiliano): tiempo máximo de la IA. Con el proveedor lento o caído la API responde igual, con un resumen de respaldo.

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
- **Respaldo.** Si la API responde `estado: "degradado"` (sin clave, tiempo agotado, cuota o capacidad), el texto se
  muestra igual, con el aviso «Resumen automático con tus datos: el asistente con IA no estuvo disponible.». No es un error.
- **Errores.** Sin red: el mensaje de conexión de siempre. Un 403: «No tienes acceso al asistente financiero con tu
  cuenta.». Cualquier otro fallo: un mensaje general. Una respuesta sin texto no se muestra como mensaje vacío: es un
  error. En todos los casos la pregunta se queda en la conversación y **Reintentar** la manda otra vez sin repetirla.
- **Sesión.** El hook anota la sesión con la que se montó. Con la sesión ya cambiada no manda ni reintenta, y la
  respuesta o el error que llegan tarde no se aplican. Además, `<RutaPrivada>` vuelve a montar la página al cambiar de sesión.
- **Mocks de maquetación (criterio de S3-CH-14).** No hay ningún mock en el código de producción. Las funciones
  falsas `alEnviarFalso` y `alReintentarFalso` solo existen en `ChatAsistente.test.tsx`; el resto de las pruebas
  simulan únicamente la red.

## Cómo se comprobó

- **Pruebas nuevas:** `shared` 3 (cliente) y `web` 58: interfaz 18, hook 27, página 9 y sesión de la página 4.
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
- **Suites completas** sobre `main` (0e70d60) con estos cambios: `shared` 271 pruebas (18 archivos) y el typecheck de `shared` y `web`. En la última corrida de `web`
  pasaron 636 de 639: las 3 que fallan son de `CalendarioPage.test.tsx` y fallan por superar los 5 s de espera
  con la máquina cargada, no por una aserción. Ese archivo no tiene cambios en esta rama y, corrido aparte, pasa (30 de 30). En
  corridas completas anteriores pasó una vez entera y otra falló 1 de esas pruebas por lo mismo. No se comprobó si
  también ocurre sobre `main` sin estos cambios. `movil` y `desktop` no se corrieron.
- **Navegador:** se probó a mano en el navegador de la aplicación, con una API falsa que imita `POST /api/asistente/` (no con
  el backend real). Se vio el chat vacío, la pregunta con Enter, la respuesta, la espera («El asistente está
  respondiendo…»), la respuesta de respaldo con su aviso, el error 500 con **Reintentar** (la pregunta no se
  repite) y el 403 con su mensaje. Se revisó en tema oscuro y claro y con 375 px de ancho, sin desplazamiento
  horizontal en la página. Con el teclado real, Tab va del cuadro a «Enviar» y Mayús + Tab a «Reintentar»; después
  de pulsar cualquiera de los dos con Enter el foco queda en el cuadro (antes de corregirlo caía al inicio de la
  página). No se probó con lector de pantalla.

## Fuera de estas tareas

- **S3-CH-16** (restricción Premium y límite de consultas): el menú muestra «Asistente» a todas las cuentas y un 403
  se dice con un mensaje general. No hay bloqueo previo para el plan gratuito ni contador de consultas.
- **S3-CH-17** (errores y respuestas de respaldo): aquí hay un solo aviso para toda respuesta degradada. El `motivo`
  (`cuota_agotada`, `timeout`, etc.) llega en la respuesta pero no se muestra.
- **S3-CH-23:** las pruebas de conjunto con errores y datos vacíos.
- **Historial que se conserve** al recargar o entre dispositivos: el backend no lo guarda.
- **Cancelar y límite de tiempo en el cliente:** `pedir` no los admite. Una pregunta en vuelo cuando se sale de la
  página termina igual, pero su respuesta no se muestra. El backend corta al proveedor en pocos segundos.
- **Los `datos`** que la API devuelve junto a la respuesta (el contexto con el que respondió) no se usan ni se tipan.
