# Conflictos y decisiones pendientes

**Proyecto:** Ojo al Gasto · **Fecha:** 1 de septiembre de 2026

---

## Para qué sirve este documento

El proyecto tiene hoy dos cuerpos de documentación elaborados en paralelo:

| Documento | Contiene |
|---|---|
| **Modelado de requisitos** | Historias de usuario, requisitos funcionales y no funcionales, y cinco diagramas UML |
| **Documentación de arquitectura** | Seis ADRs, modelo de datos, diagramas de componentes y despliegue, modelo de casos de uso, informe de validación de la problemática |

Ambos son sólidos por separado, pero **se contradicen en cuatro puntos que bloquean el trabajo de otros**. Este documento los enumera, explica qué está en juego en cada uno y propone una resolución.

> No es un documento para leer y archivar. Está pensado para resolverse en **una sola reunión de equipo**, dejando cada decisión anotada en el acta del final.

---

## Resumen

| # | Conflicto | Gravedad | Bloquea a |
|---|---|---|---|
| C-01 | Dos numeraciones de casos de uso incompatibles | 🔴 Alta | Todo el informe |
| C-02 | Sincronización bancaria: requisito vs. viabilidad económica | 🔴 Alta | Conectores, alcance |
| C-03 | ¿Usuario individual u hogar? | 🔴 Alta | Modelo de datos, backend |
| C-04 | Plan Premium y asistente con IA sin modelar | 🟡 Media | Modelo de datos, analytics |
| C-05 | Nombre del proyecto inconsistente | 🟡 Media | Portadas de todos los documentos |
| C-06 | Requisitos no funcionales no verificables | 🟡 Media | Defensa |
| C-07 | Casos de uso que en realidad son restricciones | 🟡 Media | Modelo de casos de uso |
| C-08 | Requisitos funcionales incompletos o cruzados | 🟢 Baja | — |
| C-09 | Falta matriz de trazabilidad | 🟡 Media | Evaluación |

---

# 🔴 C-01 · Dos numeraciones de casos de uso

## Qué pasa

El documento de requisitos referencia **CU-02, CU-04, CU-08, CU-12, CU-13, CU-15, CU-27, CU-28 y CU-29**. El modelo de casos de uso de la carpeta de arquitectura numera del **CU-01 al CU-25**, con significados distintos.

| Identificador | En el documento de requisitos | En el modelo de casos de uso |
|---|---|---|
| CU-08 | Visualizar el panel / dashboard | Editar suscripción |
| CU-15 | Asistente financiero con IA | Detectar cobros en el correo |
| CU-12 | Sincronización de movimientos | Conectar cuenta de Spotify |
| CU-27 a CU-29 | Trabajos automáticos | No existen |

## Por qué importa

Cada historia de usuario y varios requisitos no funcionales citan un número de caso de uso. Si ambos documentos entran al informe, **toda referencia cruzada apunta a dos cosas distintas**. Es de los errores que un evaluador detecta al primer cruce.

## Opciones

**A. Adoptar la numeración del documento de requisitos.** Es más completa —incluye el plan Premium y los casos iniciados por el sistema—, ya está referenciada desde las historias y los RNF, y es la que el equipo elaboró en conjunto.

**B. Adoptar la del modelo de casos de uso.** Tiene narrativas extendidas escritas para seis casos, con flujos alternativos y excepciones. Habría que renumerarlas y reescribir las referencias de las HU y los RNF.

> **Recomendación: opción A.** Se conserva la numeración del equipo y se **reescriben las narrativas extendidas** sobre ella. Se pierde menos trabajo: las narrativas son seis, las referencias cruzadas son muchas más.

## Qué hay que actualizar si se elige A

- `docs/diagramas/casos-de-uso.puml` — renumerar
- `docs/diagramas/casos-de-uso-narrativas.md` — renumerar las seis narrativas
- `Casos de uso.docx` — regenerar
- Las referencias a CU en los ADR-005 y ADR-006

---

# 🔴 C-02 · Sincronización bancaria

## Qué pasa

El documento de requisitos incorpora la sincronización de movimientos bancarios en **RF-05, RNF-01 y RNF-16**, en el caso de uso «Sincronizar movimientos bancarios», y como actor «Banco» en el diagrama de secuencia.

El **ADR-005** concluye, con datos verificados en agosto de 2026, que:

- Fintoc exige un mínimo de facturación de **6,5 UF mensuales** (≈ $316.000 con IVA), se use o no el servicio
- Belvo parte en **USD 1.000 mensuales**
- El **Sistema de Finanzas Abiertas** de la Ley Fintech no entra en operación hasta **julio de 2027**

## Por qué importa

Es un requisito que **no se puede implementar** dentro del proyecto. Dejarlo como requisito sin más significa entregar un sistema que incumple su propia especificación.

## Opciones

**A. Declararlo fuera del alcance de esta versión.** Se mantiene en el documento, marcado explícitamente como no implementado, con la justificación económica y regulatoria del ADR-005. Se documenta como trabajo futuro con fecha concreta: julio de 2027.

**B. Contratar un agregador.** Requiere presupuesto real y trámites con el proveedor.

**C. Eliminar el requisito.** Se pierde la trazabilidad de haberlo evaluado.

> **Recomendación: opción A.** Es la única viable, y además **suma en la defensa**: demuestra que el equipo evaluó la alternativa con datos de mercado y regulación, en vez de descartarla por intuición.

## Consecuencia práctica

El origen de los cobros queda en las tres vías del ADR-005: **entrada manual, importación CSV y lectura de correo**. El diagrama de secuencia debe ajustarse: el actor «Banco» sale, o queda marcado como no implementado.

---

# 🔴 C-03 · ¿Usuario individual u hogar?

## Qué pasa

| Documento | Modelo |
|---|---|
| Modelado de requisitos | Todo cuelga de «Usuario autenticado». **No existe el concepto de hogar** |
| Arquitectura | `organizacion` como hogar o grupo familiar; multi-tenancy; caso de uso «Compartir suscripción»; tabla `usuario_suscripcion` |

## Por qué importa

Es la decisión con **más consecuencias sobre el trabajo restante**. Afecta el modelo de datos, el servicio de autenticación, el aislamiento multi-tenant y varios casos de uso.

## Qué dicen los datos de la encuesta

- El **57,9%** comparte al menos una suscripción con familia o amigos
- Pero solo el **28%** de quienes comparten ha tenido problemas para cobrar o llevar la cuenta

O sea: compartir es una práctica extendida, pero el conflicto asociado **no es el dolor principal**. El dolor principal es pagar por lo que no se usa (68,4%) y los cobros tras pruebas gratuitas (65,8%).

## Opciones

**A. Usuario individual.** Se simplifica bastante: desaparece `organizacion`, el aislamiento pasa a ser por usuario, `usuario_suscripcion` deja de ser necesaria, y el caso de uso de compartir sale del alcance.

**B. Hogar / organización.** Se conserva el diferenciador respecto de la competencia, pero se agrega complejidad: gestión de integrantes, roles, reparto de gastos.

> **Recomendación: opción A para esta versión**, documentando el hogar como extensión futura. El modelo de datos ya está diseñado para admitirlo —basta que `organizacion` pase a tener un solo usuario— y así no se pierde el trabajo hecho.

⚠️ Si se elige A, el aislamiento multi-tenant **no desaparece**: sigue siendo obligatorio que ningún usuario vea datos de otro. Solo cambia el campo por el que se filtra.

---

# 🟡 C-04 · Plan Premium y asistente con IA

## Qué pasa

El documento de requisitos define un **plan Premium** (HU-05) con un **asistente financiero por chat**, más recomendaciones avanzadas, búsqueda de ofertas y configuración de alertas.

Nada de eso está en el modelo de datos, el glosario ni el modelo de casos de uso de la carpeta de arquitectura.

## Qué falta definir

1. **Cómo se representa el plan** y qué funcionalidades bloquea
2. **Si el chat conserva historial** — de ser así, hace falta una tabla de conversación
3. **Dónde vive el asistente**: ¿dentro del servicio `analytics` o como servicio propio?
4. **Cómo se controla el costo** de las llamadas a la API de IA (el RNF-20 lo menciona, pero sin mecanismo)

> **Recomendación:** el asistente vive dentro de `analytics`, que ya integra la API de IA para explicar recomendaciones. El plan se resuelve con un campo y una clase de permiso; no requiere servicio nuevo.

⚠️ **El costo de la IA no es teórico.** Cada conversación consume tokens que se pagan. Sin un límite por usuario, un solo usuario puede generar un gasto desproporcionado. Debe definirse un tope antes de implementar, no después.

---

# 🟡 C-05 · Nombre del proyecto

El documento de requisitos lo llama **«Ojo al Gasto»**. La documentación de arquitectura usa «Plataforma de control de suscripciones de pago».

> **Recomendación:** «Ojo al Gasto» como nombre del producto, y la descripción larga como subtítulo. Hay que actualizar las portadas de todos los documentos.

---

# 🟡 C-06 · Requisitos no funcionales no verificables

## Qué pasa

Varios RNF establecen métricas que **el proyecto no puede medir ni demostrar**:

| RNF | Exige | Problema |
|---|---|---|
| RNF-02 | 99,5% de disponibilidad mensual | Equivale a menos de 3,6 horas de caída al mes. Sobre infraestructura gratuita no es medible ni exigible |
| RNF-11 | Recuperación en 1 hora, sin perder 24 horas de transacciones | Implica respaldos y replicación que no están en la arquitectura |
| RNF-12 | 1.000 usuarios concurrentes | Requiere pruebas de carga que no están contempladas |

## Por qué importa

Un requisito no funcional que no se puede verificar **no es un requisito, es una aspiración**. Y si el informe los presenta como cumplidos sin evidencia, es exactamente lo que un evaluador con criterio va a preguntar.

## Opciones

**A. Declararlos como objetivos de diseño no verificados en esta versión.** Se mantienen, con una nota explícita de que no se midieron y por qué.

**B. Reemplazarlos por métricas demostrables.** Por ejemplo: «el panel responde en menos de 2 segundos con 50 suscripciones cargadas», que sí se puede mostrar en la defensa.

> **Recomendación: ambas.** Conservar los originales como objetivos declarados, y agregar para cada uno **una métrica verificable equivalente** que sí se pueda demostrar. Así el documento no pierde ambición y la entrega no queda expuesta.

---

# 🟡 C-07 · Casos de uso que son restricciones

En el diagrama de casos de uso aparecen tres elementos que no son casos de uso:

| Elemento | Qué es en realidad |
|---|---|
| Sanitizar datos personales (PII) | Requisito no funcional de seguridad |
| Limitar ingesta de documentos | Restricción operativa |
| Clasificar gasto recurrente variable | Paso interno de otro caso de uso |

Un caso de uso es **un objetivo con valor para un actor**. Estos son comportamientos internos del sistema que ningún actor persigue.

> **Recomendación:** moverlos a la sección de requisitos no funcionales. Es de los errores que más se penalizan en este entregable, y corregirlo cuesta cinco minutos.

---

# 🟢 C-08 · Requisitos funcionales incompletos

| Requisito | Problema |
|---|---|
| RF-09 y RF-10 | Están vacíos. Solo dicen «Baja» |
| RF-06 | Las celdas están cruzadas: la descripción dice «Media» —que es una prioridad— y el criterio corresponde a RF-07 |
| RF-07 | El criterio dice «según el SII». El Servicio de Impuestos Internos no tiene relación con el control de suscripciones de una persona |

También hay un desbalance: **cinco historias de usuario para diez requisitos funcionales y unos treinta casos de uso**. Lo habitual es lo contrario — más historias que requisitos.

---

# 🟡 C-09 · Falta la matriz de trazabilidad

Las historias de usuario referencian casos de uso, pero **los requisitos funcionales no apuntan a nada**. No existe una matriz que relacione historias, requisitos, requisitos no funcionales y casos de uso.

## Por qué importa

Es de lo primero que se revisa. Un requisito funcional sin caso de uso asociado indica una omisión en el modelo; un caso de uso sin requisito indica alcance no justificado.

> **Recomendación:** construir la matriz una vez resuelto el C-01. Antes de fijar la numeración no tiene sentido hacerla.

---

# Dos mejoras de bajo costo

Ninguna es un conflicto, pero ambas suben el nivel del documento con poco trabajo:

**RNF-19** (confidencialidad del historial financiero) describe exactamente el aislamiento multi-tenant. Debería **referenciar el ADR-004 y las pruebas automatizadas** de `shared/tenant`. Así deja de ser una declaración y pasa a ser algo verificable en vivo.

**RNF-10** (cumplimiento normativo) debería **nombrar la Ley 21.719** y su entrada en vigencia el 1 de diciembre de 2026 — durante el desarrollo del proyecto. Ya está investigado en el ADR-005. Citarlo lo vuelve concreto en lugar de genérico.

---

# Qué NO está en conflicto

Para no gastar tiempo de reunión en lo que ya coincide:

- La arquitectura de microservicios y el despliegue en Kubernetes
- Las notificaciones y alertas como funcionalidad central
- La lectura de correo como fuente de cobros
- El seguimiento del uso de servicios (RF-04 coincide con la tabla `uso` del modelo de datos)
- El cifrado de datos financieros en reposo (RNF-03 coincide con el ADR-005)
- La degradación controlada ante fallos de terceros (RNF-16 coincide con los casos de uso de conectores)
- Los dos clientes, web y móvil

---

---

# Valores propuestos pendientes de ratificación · 5 de septiembre de 2026

Las correcciones de la evaluación SWEBOK (RNF sin métricas, RNF dobles, duplicidad RF-20/RNF-19, desagregación de RF-01, HU-03, RNF-15, eliminación vs. auditoría) ya están aplicadas en `requisitos-vigentes.md` y en la matriz v1.1. Los valores concretos que las vuelven verificables son **propuestas por defecto**: el docente fue explícito en que los niveles de calidad los decide el equipo. Ratificar o corregir en la próxima reunión:

| # | Propuesta aplicada | Valor por ratificar | Dónde quedó |
|---|---|---|---|
| R-01 | Métricas de RNF-07 | Conector nuevo: 0 líneas fuera de `connectors` y ≤ 5 días-persona | RNF-07, PNF-07 |
| R-02 | Métricas de RNF-09 | 50 chats concurrentes, promedio ≤ 2,5 s, p95 ≤ 4 s, errores < 1% | RNF-09, PNF-09 |
| R-03 | Métricas de RNF-20 | ≤ US$ 0,10/usuario activo/mes; tope individual US$ 0,50 y 200 llamadas de IA/mes | RNF-20, PNF-20 |
| R-04 | Valores de los RNF desdoblados | 80% de usuarios nuevos en ≤ 3 min sin tutorial (05b); p95 ≤ 3 s (05a); lote de 200 tareas (04b); AES-256-GCM y cifrado de volumen (03a) | RNF-03a a RNF-14b |
| R-05 | RNF-08 alineado a solo Android | Se retira iOS del texto, aplicando el ADR-006 ya aceptado | RNF-08a, RNF-08b |
| R-06 | TLS solo en los bordes | RNF-03b exime el tráfico interno del clúster; el texto original no lo eximía | RNF-03b |
| R-07 | Regla de eliminación vs. auditoría (V-03) | Anonimización irreversible en 72 h; purga a los 12 meses; comprobantes Premium 6 años **(base legal por validar)**; consentimientos 6 años disociados | RF-01.7, RNF-10, RNF-13 |
| R-08 | Valores de RF-01.1 a RF-01.6 | Contraseña ≥ 8 con letra y número; enlace de recuperación 60 min un solo uso; cierre de sesión efectivo ≤ 60 s | RF-01.x, TC-53 a TC-69 |
| R-09 | RNF-19 redefinido | Aislamiento verificado en capa de datos (ADR-004, `shared/tenant`) + registro de intentos cruzados | RNF-19, PNF-19 |
| R-10 | Navegadores de RNF-15 | Chrome, Edge, Firefox y Safari, dos últimas versiones estables al inicio de la fase de pruebas de cada release | RNF-15, PNF-15 |

**Dos consecuencias técnicas que exigen acción aparte:**

- **RF-01.6 requiere enmendar el ADR-004:** el cierre de sesión efectivo en ≤ 60 s necesita una lista de revocación de tokens (Redis) que el ADR-004 no contempla —hoy el gateway valida solo la firma JWT—. Alternativa sin tocar el ADR: redactar el criterio por TTL del token. Además RF-01.6 no tiene caso de uso propio en el catálogo.
- **Impacto en el MER:** RF-01.1 exige registrar el consentimiento (fecha, hora, versión) y RF-01.7 exige campos de anonimización en la tabla de auditoría. Pasar a la revisión del MER.

**Divergencia menor detectada:** HU-04 dice «en menos de 3 segundos» absoluto y RNF-05a verifica por percentil 95; conviene alinear HU-04 al p95. Y el umbral de alza de tarifa difiere entre RF-07 («más de 5%») y RN-06 («5% o más»): fijar el caso límite.

# Acta de la reunión

Para completar durante la sesión:

| # | Decisión | Resuelto | Responsable | Fecha |
|---|---|---|---|---|
| C-01 | Numeración de casos de uso | | | |
| C-02 | Sincronización bancaria | | | |
| C-03 | Usuario individual u hogar | | | |
| C-04 | Premium y asistente con IA | | | |
| C-05 | Nombre del proyecto | | | |
| C-06 | RNF no verificables | | | |
| C-07 | Casos de uso mal clasificados | | | |
| C-08 | RF incompletos | | | |
| C-09 | Matriz de trazabilidad | | | |
| R-01 a R-10 | Valores propuestos el 5-09 (tabla anterior) | | | |
| — | Enmienda al ADR-004 por RF-01.6 (o criterio por TTL) | | | |

## Orden sugerido

Resolver **C-03 primero**. Es la decisión de la que dependen las demás: si el sistema es de usuario individual, cambia el modelo de datos, cambian varios casos de uso y se simplifica el alcance.

Después **C-01 y C-02**, que definen qué documentos hay que rehacer.

El resto son ajustes que puede aplicar una persona sin volver a reunir al equipo.
