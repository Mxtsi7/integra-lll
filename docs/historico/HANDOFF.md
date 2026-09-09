# Estado del proyecto — Ojo al Gasto

**Actualizado:** 5 de septiembre de 2026
**Para:** quien retome este trabajo sin haber visto la conversación anterior.

---

## 1. Qué es

Proyecto semestral de **Ingeniería Civil Informática, Universidad Católica de Temuco**. Una aplicación multiplataforma para controlar y optimizar el gasto en suscripciones de pago, con asistente de IA.

**Equipo:** Maximiliano Sáez (Scrum Master), Christopher Solís, Felipe Orellana, Victor Gonzales, Andrea Travol, Sebastián Mena.

**Etapa actual:** modelado de requisitos y diseño. Todavía no se programa.

**Stack acordado:** Django + DRF —tambien el gateway—, PostgreSQL, RabbitMQ, Redis, Celery. Cliente web React + Vite; cliente móvil React Native + Expo, solo Android. Arquitectura de **microservicios** (exigencia del docente).

---

## 2. Lo primero que hay que saber: hay tres numeraciones de requisitos dando vueltas

Esta es la trampa que más tiempo ha costado. Existen tres documentos con identificadores `RF-nn` **incompatibles entre sí**:

| Documento | Contenido | ¿Es el vigente? |
|---|---|---|
| [`investigacion/requisitos-vigentes.md`](investigacion/requisitos-vigentes.md) | 5 HU, 20 RF, 20 RNF | ✅ **SÍ. Es el que evaluó el docente. Es la numeración oficial.** |
| [`MODELADO-DE-REQUISITOS-v2.md`](MODELADO-DE-REQUISITOS-v2.md) | 12 HU, 20 RF, 20 RNF, con evidencia y prioridad | ❌ No. Propuesta paralela; **sus RF-nn significan cosas distintas** |
| `investigacion/“Modelado de requisitos...docx.pdf` | 10 RF, con RF-09 y RF-10 vacíos | ❌ No. Versión antigua |

**Regla:** cualquier trabajo nuevo usa la numeración de `requisitos-vigentes.md`. El documento v2 sirve como **fuente de evidencia y de prioridades**, no como fuente de identificadores.

Los identificadores en el original vienen escritos de dos formas —`RF-01` y `RF - 11`, con espacios—. En `requisitos-vigentes.md` están normalizados; conviene corregir el original.

---

## 3. Orden de lectura recomendado

1. [`investigacion/requisitos-vigentes.md`](investigacion/requisitos-vigentes.md) — qué hay que construir
2. [`investigacion/evaluacion-swebok-docente.md`](investigacion/evaluacion-swebok-docente.md) — la evaluación del docente contra SWEBOK v4.0a
3. [`MATRIZ-DE-TRAZABILIDAD.md`](MATRIZ-DE-TRAZABILIDAD.md) — el catálogo de casos de uso, la matriz y los siete vacíos V-01 a V-07
4. [`REGLAS-DE-NEGOCIO.md`](REGLAS-DE-NEGOCIO.md) — las 25 reglas numeradas y los ocho conflictos que introducen
5. [`REVISION-MER.md`](REVISION-MER.md) — los diecinueve hallazgos sobre el modelo de datos
6. [`CONFLICTOS-Y-DECISIONES.md`](CONFLICTOS-Y-DECISIONES.md) — los conflictos C-01 a C-09
7. [`arquitectura/ADR-001..006`](arquitectura/) — las decisiones de arquitectura, **el ADR-005 es el que más consecuencias tiene**

---

## 4. Qué existe y en qué estado

### Documentos de requisitos

| Archivo | Estado |
|---|---|
| [`investigacion/requisitos-vigentes.md`](investigacion/requisitos-vigentes.md) | Vigente. **RF-03 está incompleto en el original** |
| [`MATRIZ-DE-TRAZABILIDAD.md`](MATRIZ-DE-TRAZABILIDAD.md) | Completa (v1.1, 5-09). **El Word sigue en v1.0 del 4-09: regenerarlo antes de entregar** |
| [`REGLAS-DE-NEGOCIO.md`](REGLAS-DE-NEGOCIO.md) | Completa. 25 reglas numeradas |
| [`REVISION-MER.md`](REVISION-MER.md) | Hallazgos M-01 a M-19 verificados + sección 8 (5-09): M-20 a M-56 y 12 vacíos de cobertura |
| [`MODELADO-DE-REQUISITOS-v2.md`](MODELADO-DE-REQUISITOS-v2.md) | Propuesta alternativa. **Ojo con la numeración** |
| [`CONFLICTOS-Y-DECISIONES.md`](CONFLICTOS-Y-DECISIONES.md) | 9 conflictos, varios sin resolver |
| [`glosario.md`](glosario.md) | Vigente |

### Investigación

| Archivo | Qué aporta |
|---|---|
| `investigacion/Encuesta - respuestas y analisis.xlsx` | 38 respuestas reales, con análisis estadístico y 12 gráficos |
| `investigacion/Informe - Validacion de la problematica.docx` | 26 páginas. Los hallazgos **E1 a E16** que justifican cada requisito |
| `investigacion/investigacion de ambitos financieros.docx` | Ley Fintech 21.521, Sistema de Finanzas Abiertas, Ley 21.719 |

Los códigos de evidencia **E1 a E16** están tabulados en la sección 1 de `MODELADO-DE-REQUISITOS-v2.md`. Son la respuesta a «¿de dónde salió este requisito?», que es lo que el docente marcó como ausente.

Los tres datos que más pesan:

- **E1** — el 68,4% paga por servicios que no usa
- **E5** — el 76,3% pide aviso previo a cada cobro. Es la demanda más alta
- **E16** — el 75% acierta su tramo de gasto. **La hipótesis de que el problema es de información quedó rechazada**: el problema es de oportunidad de decisión, no de desconocimiento

### Arquitectura

Seis ADR en [`arquitectura/`](arquitectura/), del ADR-001 al ADR-006. Diagramas PlantUML en [`diagramas/`](diagramas/) con `render.py` para generarlos.

**El ADR-005 es el que más consecuencias tiene:** descartó la conexión bancaria automática por tres razones —el Sistema de Finanzas Abiertas de la Ley Fintech 21.521 no es exigible hasta julio de 2027, los agregadores comerciales cuestan más de lo que el proyecto puede pagar, y los datos bancarios activan obligaciones de la Ley 21.719—. La detección de cobros queda por carga manual de CSV, PDF de cartola y correo electrónico.

**Media especificación todavía no refleja esa decisión.** Ver el punto 6.

### Mockup

Seis pantallas en [`mockup/`](mockup/): cuatro de móvil y dos de web, más capturas a 2×. La métrica **costo por hora de uso** aparece en las cuatro pantallas móviles: es lo que diferencia el producto de una planilla de gastos.

---

## 5. Decisiones abiertas, en orden de urgencia

| # | Decisión | Qué bloquea |
|---|---|---|
| **1** | **C-03 · ¿usuario individual u hogar?** | Es la decisión de más consecuencias. **Antes de votarla, leer `glosario.md` y la sección 6 de `REVISION-MER.md`.** Bloquea menos de lo que parecía: 22 de los 37 hallazgos nuevos son ejecutables sin ella |
| **2** | **V-01 · ¿camino A o B para la conexión bancaria?** | HU-02, CU-12, RF-05, RNF-01, RNF-16, el diagrama de secuencia y las reglas RN-19, RN-20 y RN-21 |
| **3** | **CN-01 · ¿las alertas son configurables o fijas?** | RF-09 y las reglas RN-01, RN-02 y RN-04 se contradicen |
| **4** | **CN-03 y CN-04 · el conjunto definitivo de estados** | RF-03. Falta decidir si existe «pausada», y si el estado se llama «dudosa» o «por confirmar» |
| **5** | **Las tres transiciones que faltan en RF-03** | Salida de «fantasma», respuesta afirmativa en «por confirmar», y entrada y salida de «pausada» |
| ~~6~~ | ~~Los valores de RNF-07, RNF-09 y RNF-20~~ | ✅ Valores propuestos y aplicados el 5-09; ratificación en el acta (R-01 a R-03) |
| **7** | **C-01 · la numeración de casos de uso** | Ya resuelta de hecho en la matriz, falta que el equipo la valide |

**Sobre la 1, y esto importa antes de la reunión.** El `glosario.md` registra una decisión fechada el **2026-08-21** —«el sistema se enfoca en B2C: personas y grupos familiares»— y define la organización como el eje del aislamiento, con la suscripción perteneciendo a la organización y no a la persona. **El MER y `modelo-datos.puml` implementan eso fielmente**: no se desviaron por su cuenta.

Ahora bien, esa decisión del 21-08 resolvió **B2C frente a B2B, no individual frente a hogar** —«personas y grupos familiares» abarca ambas—, y su fundamento declarado es que «la encuesta mide comportamiento de consumidores individuales». Los términos del hogar vienen del diseño anterior orientado a empresas, conservados con nombre neutro a propósito. **C-03 sigue abierto.**

La recomendación se mantiene en **producto individual**, pero apoyada en coherencia y costo, no en la evidencia: los tres artefactos que evalúa el docente ya lo dicen, **RF-20 prohíbe explícitamente el acceso cruzado** que el hogar necesita, y el hogar se puede agregar después como capa. A cambio hay que aceptar dos costos y declararlos: se rehacen el MER, el puml y los términos del glosario, y hay que responder por qué queda fuera un comportamiento del 57,9%. La respuesta defendible es que solo el 28% de quienes comparten reporta conflicto, frente al 68,4% del dolor principal — **pero hay que llevarla preparada**. El detalle completo, con los argumentos de los dos lados, está en la sección 6 de [`REVISION-MER.md`](REVISION-MER.md).

---

## 6. Los restos de la conexión bancaria

El ADR-005 la descartó, pero sigue presente en seis lugares. Al resolver la decisión 2, hay que limpiarlos todos:

- **HU-02** — «quiero vincular mi cuenta bancaria»
- **CU-12** — «Vincular cuenta bancaria y sincronizar movimientos»
- **RNF-01 y RNF-16** — hablan de movimientos bancarios y de conectores de banco
- **Diagrama de secuencia** — el actor Banco, con «Solicita movimientos bancarios»
- **MER** — `CONECTOR.tipo` y `CONECTOR.proveedor` admiten un banco sin restricción
- **RN-06, RN-19, RN-20 y RN-21** — se basan en la presencia o ausencia de cobros «en las cartolas» durante ventanas de 60 y 90 días

El último es el más serio: **con carga manual, tres reglas del ciclo de vida no pueden ejecutarse solas.** Si el usuario deja de subir su cartola dos meses, el sistema cancelará suscripciones que siguen activas.

---

## 7. Lo que pidió el docente y qué falta

Su evaluación completa está en [`investigacion/evaluacion-swebok-docente.md`](investigacion/evaluacion-swebok-docente.md). Evaluó **alineación media-alta** con SWEBOK v4.0a.

| Lo que marcó | Estado |
|---|---|
| Trazabilidad 🔴 débil | ✅ Resuelto — matriz completa HU → CU → RF → RNF → prueba |
| Fuente, rationale y prioridad 🔴 ausentes | ✅ Resuelto — evidencia E1–E16 y prioridad MoSCoW en la matriz |
| Falta una matriz de trazabilidad (su punto 14) | ✅ Resuelto |
| Completar RF-03 y su tabla de estados | 🟡 Casi — las reglas de negocio aportan casi todo, faltan **tres transiciones** |
| Crear el RF de vinculación bancaria para HU-02 | ⏸ Bloqueado por la decisión 2 |
| RNF-07, RNF-09 y RNF-20 sin métricas | ✅ Resuelto el 5-09 — valores propuestos, ratificación pendiente (acta R-01 a R-03) |
| Separar los RNF que mezclan dos propiedades (03, 04, 05, 08, 14) | ✅ Resuelto el 5-09 — desdoblados en a/b; RNF-08 quedó alineado a solo Android (ADR-006) |
| Eliminar la duplicidad RF-20 / RNF-19 | ✅ Resuelto el 5-09 — RNF-19 redefinido: aislamiento verificado en capa de datos (ADR-004, shared/tenant) |
| Resolver eliminación de cuenta frente a retención de auditoría | ✅ Resuelto el 5-09 — regla de retención en RF-01.7; base legal de los 6 años por validar (acta R-07) |
| RNF-15: acotar «cualquier navegador» a un conjunto finito | ✅ Resuelto el 5-09 — Chrome, Edge, Firefox y Safari, 2 últimas versiones estables |
| **Desagregar RF-01** — hoy tiene siete operaciones en un requisito | ✅ Resuelto el 5-09 — RF-01.1 a RF-01.7 con TC-53 a TC-72; RF-01.6 exige enmienda al ADR-004 o criterio por TTL |
| **Reescribir HU-03** — hoy dice «Como sistema, quiero...» | ✅ Resuelto el 5-09 — actor Usuario autenticado; TC-73 nueva para el criterio 3 de RF-09 |

**Lo más rentable ahora:** los RNF restantes. Quince de veinte ya tienen prueba ejecutable; faltan valores medibles en RNF-02, RNF-06, RNF-12 y RNF-17 (RNF-01 depende de la decisión 2). No hay que escribir requisitos nuevos, solo fijar los valores que faltan en los que ya existen.

---

## 8. Trampas conocidas

**El repositorio de GitHub es PÚBLICO** y `docs/` está excluido en `.gitignore`. La razón: el Excel de la encuesta contiene **16 direcciones de correo personales** de los encuestados. **No revertir esa exclusión.**

**El diagrama de casos de uso no tiene números.** El documento de requisitos cita diez casos de uso por número —CU-02, CU-04, CU-08, CU-12, CU-13, CU-15, CU-27, CU-28, CU-29, CU-30— que no existían en ninguna parte. La sección 4 de la matriz asigna los treinta y seis identificadores de forma que **esas diez citas resuelven sin editarlas**. Solo falta rotular el diagrama.

**El documento de reglas de negocio no numera sus reglas.** Los identificadores RN-01 a RN-25 se asignaron en `REGLAS-DE-NEGOCIO.md`; hay que llevarlos al documento original.

**El encabezado de las reglas de negocio está desactualizado:** nombra Flutter, que se descartó en el ADR-006, describe un stack monolítico cuando la arquitectura es de microservicios, y menciona Gemini o Groq sin que exista un ADR que registre esa elección.

**Los diagramas viven en Eraser** y llegan al documento como imágenes. Por eso el docente no pudo evaluar el UML. Conviene exportarlos también como texto —PlantUML o Mermaid— para que sean revisables.

---

## 9. Trabajo en curso

**La revisión paralela del MER terminó el 5-09** y sus resultados están en la sección 8 de [`REVISION-MER.md`](REVISION-MER.md): 37 hallazgos consolidados (M-20 a M-56, de 70 confirmados tras refutación adversarial), más 12 vacíos de cobertura que el crítico de completitud dejó anotados. Los cuatro requisitos nuevos del 5-09 (consentimiento RF-01.1, anonimización RF-01.7, intentos cruzados RNF-19, última actividad RNF-20) no tienen soporte en el MER: son 4 de los hallazgos de severidad alta. La primera pasada del 4-09 se perdió por un corte de sesión y se re-ejecutó completa.

**Ojo:** la sección 8.6 afina la recomendación anterior: C-03 sigue siendo la decisión que hay que tomar primero, pero **22 de los 37 hallazgos nuevos son ejecutables ya** sin esperar ninguna decisión (anonimización de auditoría, registro de accesos cruzados, borrado de RF-10, infraestructura de RF-01.x). Solo 6 están bloqueados enteros.

**Correcciones SWEBOK aplicadas el 5-09** (sección 7): 73 TC y 25 PNF en la matriz v1.1; RNF verificables 15 de 20. Los valores concretos quedaron como propuestas en la tabla R-01 a R-10 de [`CONFLICTOS-Y-DECISIONES.md`](CONFLICTOS-Y-DECISIONES.md), pendientes de ratificación del equipo.
