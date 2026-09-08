# Casos de uso — narrativas

Complemento de [`casos-de-uso.puml`](casos-de-uso.puml).

> El diagrama es el 20% del trabajo; **las narrativas son el 80%** y es lo que
> se evalúa de verdad. El diagrama muestra *qué* hace el sistema, la narrativa
> muestra *cómo* y qué pasa cuando algo falla.

---

## Actores

| Actor | Tipo | Descripción |
|---|---|---|
| **Usuario** | Principal | Persona que administra sus suscripciones de pago |
| **Titular** | Principal | Usuario con permisos sobre los integrantes del hogar. Hereda de Usuario |
| **Tiempo** | Sistema | Actor temporal que dispara las tareas programadas (Celery Beat) |
| **API de Spotify** | Externo | Entrega historial de reproducción |
| **API de Gmail** | Externo | Entrega correos de cobro y renovación |
| **API de Claude** | Externo | Genera explicaciones en lenguaje natural |
| **Servicio de correo** | Externo | Envía las notificaciones por correo |
| **Expo Push** | Externo | Entrega las notificaciones al dispositivo móvil |

---

## Listado completo

| ID | Caso de uso | Actor principal | Prioridad |
|---|---|---|---|
| CU-01 | Registrarse | Usuario | Alta |
| CU-02 | Iniciar sesión | Usuario | Alta |
| CU-03 | Gestionar perfil | Usuario | Baja |
| CU-04 | Invitar integrante al hogar | Titular | Baja |
| CU-05 | Asignar roles | Titular | Baja |
| **CU-06** | **Registrar suscripción** | Usuario | **Alta** |
| CU-07 | Importar desde CSV | Usuario | Media |
| CU-08 | Editar suscripción | Usuario | Alta |
| CU-09 | Marcar como cancelada | Usuario | Media |
| **CU-10** | **Compartir suscripción** | Usuario | **Alta** |
| CU-11 | Registrar uso manual | Usuario | Media |
| **CU-12** | **Conectar cuenta de Spotify** | Usuario | **Alta** |
| CU-13 | Conectar cuenta de correo | Usuario | Alta |
| CU-14 | Sincronizar datos de uso | Tiempo | Alta |
| CU-15 | Detectar cobros en el correo | Tiempo | Alta |
| CU-16 | Desconectar cuenta | Usuario | Baja |
| **CU-17** | **Visualizar panel de gastos** | Usuario | **Alta** |
| CU-18 | Consultar costo por hora de uso | Usuario | Alta |
| **CU-19** | **Generar recomendaciones de cancelación** | Tiempo / Usuario | **Alta** |
| CU-20 | Explicar una recomendación | Usuario | Media |
| CU-21 | Detectar servicios solapados | Usuario | Baja |
| CU-22 | Configurar alertas | Usuario | Media |
| CU-23 | Notificar próximo cobro | Tiempo | Media |
| **CU-24** | **Notificar fin de prueba gratis** | Tiempo | **Alta** |
| CU-25 | Notificar alza de precio | Tiempo | Media |

Los marcados en negrita están detallados abajo.

---

## CU-06 · Registrar suscripción

| | |
|---|---|
| **Actor principal** | Usuario |
| **Actores secundarios** | — |
| **Objetivo** | Incorporar una suscripción de pago al sistema para llevar su control |
| **Precondiciones** | El usuario está autenticado y pertenece a una organización |
| **Postcondiciones** | Existe una suscripción activa asociada a la organización, con su próximo cobro calculado |
| **Frecuencia** | Alta al inicio; baja después |

### Flujo principal

1. El usuario selecciona "Agregar suscripción"
2. El sistema muestra el formulario con el catálogo de proveedores conocidos
3. El usuario selecciona un proveedor del catálogo
4. El usuario ingresa monto, ciclo de facturación y fecha del primer cobro
5. El sistema valida los datos
6. El sistema calcula la fecha del próximo cobro a partir del ciclo
7. El sistema guarda la suscripción asociada a la organización del usuario
8. El sistema muestra la suscripción en el panel

### Flujos alternativos

**3a. El proveedor no está en el catálogo**
1. El usuario selecciona "Otro" e ingresa el nombre manualmente
2. El sistema crea la suscripción con nombre libre y la marca para revisión
3. Continúa en el paso 4

**7a. El usuario comparte la suscripción**
1. El usuario activa "Compartida"
2. El sistema deriva a **CU-10 (Compartir suscripción)**

### Excepciones

**5a. Datos inválidos** — monto negativo, cero, o fecha futura como primer cobro.
El sistema muestra el error junto al campo y no guarda nada.

**7b. Suscripción duplicada** — ya existe una activa del mismo proveedor en la
organización. El sistema advierte y pide confirmación explícita.

**Requisitos relacionados:** RF-01, RF-02, RF-08

---

## CU-10 · Compartir suscripción

| | |
|---|---|
| **Actor principal** | Usuario |
| **Objetivo** | Registrar que una suscripción se comparte y quién la paga, para repartir el gasto |
| **Precondiciones** | Existe la suscripción y el hogar tiene más de un integrante |
| **Postcondiciones** | La suscripción queda asociada a varios usuarios, con un pagador identificado |
| **Frecuencia** | Media |

### Flujo principal

1. El usuario abre el detalle de una suscripción
2. Selecciona "Compartir"
3. El sistema muestra los integrantes del hogar
4. El usuario selecciona con quiénes la comparte
5. El usuario indica quién es el pagador
6. El sistema crea los vínculos usuario–suscripción con la marca de pagador
7. El sistema recalcula el gasto individual de cada integrante involucrado

### Flujos alternativos

**4a. La persona no está en el hogar**
1. El usuario selecciona "Invitar"
2. El sistema deriva a **CU-04 (Invitar integrante)**

### Excepciones

**5a. Ningún pagador seleccionado** — el sistema exige al menos uno antes de
guardar.

> **Justificación:** este caso de uso responde a la hipótesis H4 de la encuesta.
> Es un diferenciador respecto de la competencia, que trata las suscripciones
> como individuales.

**Requisitos relacionados:** RF-09, RF-10

---

## CU-12 · Conectar cuenta de Spotify

| | |
|---|---|
| **Actor principal** | Usuario |
| **Actores secundarios** | API de Spotify |
| **Objetivo** | Autorizar al sistema a leer el historial de reproducción para medir el uso real |
| **Cliente** | **Solo web.** El flujo OAuth no se implementa en móvil (ADR-006) |
| **Precondiciones** | El usuario está autenticado en el cliente web y tiene una cuenta de Spotify |
| **Postcondiciones** | Existe un conector activo con su token almacenado cifrado, y se ejecutó una primera sincronización |
| **Frecuencia** | Una vez por usuario |

### Flujo principal

1. El usuario selecciona "Conectar Spotify" **desde el cliente web**
2. El sistema redirige al flujo de autorización OAuth de Spotify
3. El usuario se autentica en Spotify y concede los permisos solicitados
4. Spotify redirige al sistema con un código de autorización
5. El sistema intercambia el código por un token de acceso y uno de refresco
6. El sistema almacena los tokens **cifrados** y crea el conector en estado activo
7. El sistema ejecuta **CU-14 (Sincronizar datos de uso)** por primera vez
8. El sistema confirma la conexión y muestra los datos obtenidos

### Flujos alternativos

**3a. El usuario rechaza los permisos**
1. Spotify redirige con un error
2. El sistema informa que sin autorización no puede medir el uso y ofrece
   el registro manual (**CU-11**)

### Excepciones

**5a. El código expiró o es inválido** — el sistema informa y ofrece reintentar.

**7a. Spotify no responde** — el conector queda en estado "pendiente de
sincronización" y la tarea se reintenta automáticamente. **El usuario no queda
bloqueado.**

> **Nota de diseño:** los tokens nunca se muestran en la interfaz ni se
> registran en los logs. Ver `docs/arquitectura/`.
>
> **Por qué solo en web (ADR-006):** el retorno de OAuth en móvil exige
> *deep linking*, mecanismo frágil y costoso. El usuario vincula sus cuentas
> una vez, en una sesión de configuración, y luego opera desde el teléfono.

**Requisitos relacionados:** RF-11, RF-12, RNF-03 (seguridad)

---

## CU-17 · Visualizar panel de gastos

| | |
|---|---|
| **Actor principal** | Usuario |
| **Objetivo** | Conocer de una sola mirada cuánto gasta y en qué |
| **Precondiciones** | El usuario está autenticado y tiene al menos una suscripción registrada |
| **Postcondiciones** | Ninguna: es una consulta, no modifica el estado |
| **Frecuencia** | Muy alta — es la pantalla principal |

### Flujo principal

1. El usuario ingresa al sistema
2. El sistema obtiene las suscripciones activas de su organización
3. El sistema calcula el gasto mensual y anual proyectado
4. El sistema identifica el próximo cobro y los días restantes
5. El sistema muestra: total mensual, total anual, próximo cobro, desglose por
   categoría y listado de suscripciones ordenado por monto
6. El sistema destaca las suscripciones con recomendación de cancelación pendiente

### Flujos alternativos

**2a. El usuario no tiene suscripciones**
1. El sistema muestra una pantalla de bienvenida con las tres formas de empezar:
   registro manual, importar CSV o conectar una cuenta

### Excepciones

**3a. Suscripciones sin monto registrado** — se excluyen del total y se marcan
como "monto pendiente". **El total nunca se muestra incompleto sin avisarlo.**

**Requisitos relacionados:** RF-15, RF-16, RNF-01 (la pantalla carga en menos de 2 s)

---

## CU-19 · Generar recomendaciones de cancelación

> **Es el caso de uso central del sistema.** Es la razón de existir del producto
> y lo que lo diferencia de una planilla de gastos.

| | |
|---|---|
| **Actor principal** | Tiempo (programado) / Usuario (a solicitud) |
| **Actores secundarios** | API de Claude |
| **Objetivo** | Identificar qué suscripciones no compensan lo que cuestan y sugerir cancelarlas |
| **Precondiciones** | Existen suscripciones con al menos 30 días de datos de uso |
| **Postcondiciones** | Se generan recomendaciones con puntaje y motivo, visibles en el panel |
| **Frecuencia** | Semanal automática; bajo demanda cuando el usuario la solicita |

### Flujo principal

1. El planificador dispara la tarea semanal
2. El sistema recorre las suscripciones activas de cada organización
3. Para cada una calcula:
   - costo por hora de uso del último mes
   - días transcurridos desde el último uso registrado
   - tendencia de uso respecto del mes anterior
4. El sistema asigna un puntaje de "candidata a cancelar" (0 a 100)
5. Para las que superan el umbral, invoca **CU-20** para generar la explicación
6. El sistema guarda las recomendaciones y las muestra en el panel
7. Si el usuario tiene la alerta activada, envía la notificación

### Flujos alternativos

**3a. La suscripción no tiene datos de uso**
1. El sistema la marca como "sin datos" y sugiere conectar una cuenta o
   registrar el uso manualmente
2. **No genera recomendación**: no se recomienda cancelar sobre datos
   inexistentes

**5a. La API de Claude no está disponible**
1. El sistema guarda la recomendación con una explicación generada por
   plantilla
2. **El valor principal se entrega igual**; la IA mejora la explicación, no la
   sustituye

### Excepciones

**2a. La organización no tiene suscripciones activas** — se omite sin error.

> **Justificación:** responde al hallazgo principal de la encuesta — el 72,7% de
> los encuestados ha pagado por una suscripción que no usaba, y entre quienes
> tienen 3 o más servicios, el 100%.

**Requisitos relacionados:** RF-20, RF-21, RF-22

---

## CU-24 · Notificar fin de prueba gratis

| | |
|---|---|
| **Actor principal** | Tiempo |
| **Actores secundarios** | Servicio de correo · Expo Push |
| **Objetivo** | Avisar antes de que una prueba gratuita se convierta en cobro |
| **Precondiciones** | Existe una suscripción en período de prueba con fecha de término registrada |
| **Postcondiciones** | Se envió la notificación y quedó registrada |
| **Frecuencia** | Diaria |

### Flujo principal

1. El planificador ejecuta la revisión diaria
2. El sistema busca suscripciones en prueba que terminan en 2 días o menos
3. Para cada una, verifica que no se haya notificado ya
4. El sistema envía la alerta por **ambos canales** — notificación push al
   dispositivo móvil y correo — con: servicio, fecha de término, monto que se
   cobrará y enlace a las instrucciones de cancelación
5. El sistema registra la alerta como enviada

### Flujos alternativos

**3a. Ya se notificó** — se omite, para no enviar duplicados.

### Excepciones

**4a. Falla uno de los canales** — se reintenta hasta 3 veces con espera
creciente. Si el push falla pero el correo llega, o al revés, la alerta se
considera entregada. Si fallan ambos, se registra el error y **la alerta queda
visible dentro de la aplicación**.

**4b. El usuario no tiene la app móvil instalada** — se envía solo por correo.
El push es un canal adicional, nunca el único.

> **Justificación:** en la encuesta, esta fue una de las funcionalidades más
> solicitadas en la P19.

**Requisitos relacionados:** RF-25, RF-26

---

## Errores frecuentes que se penalizan

Cuando revisen el diagrama antes de entregar, verifiquen esto:

1. **Convertir el diagrama en descomposición funcional.** Un caso de uso es un
   **objetivo con valor para un actor**, no un paso. "Validar formulario" o
   "Guardar en base de datos" **no** son casos de uso — son pasos dentro de uno.

2. **Abusar de `<<include>>` y `<<extend>>`.** Es el error más marcado. Si el
   diagrama tiene más flechas punteadas que sólidas, algo está mal. `include` es
   para comportamiento **siempre** ejecutado y reutilizado; `extend` para
   comportamiento **opcional**.

3. **Olvidar los actores no humanos.** El tiempo y los sistemas externos son
   actores. Sin ellos, las tareas programadas quedan sin origen.

4. **Narrativas sin excepciones.** Un flujo principal sin flujos alternativos ni
   excepciones se lee como que no pensaron en qué pasa cuando algo falla. **Ahí
   está la mitad de la nota.**

> **Pendiente cerrado (2026-08-21):** el segmento del producto quedó definido
> como B2C. Una "organización" es un hogar o grupo familiar. Ver
> [`docs/glosario.md`](../glosario.md).

5. **Incoherencia con los requisitos.** Cada caso de uso debe poder rastrearse a
   uno o más requisitos funcionales, y viceversa. Si hay un RF sin caso de uso,
   falta uno.
