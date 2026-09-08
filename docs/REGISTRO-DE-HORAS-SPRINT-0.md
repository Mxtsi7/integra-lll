# Registro de horas — Sprint 0

**Integrante:** Felipe Orellana (filas 37 a 50 de la hoja `Sprint 0 - III`)
**Preparado:** 7 de septiembre de 2026
**Fuente:** fechas de modificación de los archivos del repositorio, historial de git y registros de las sesiones de trabajo.

---

## 1. Para qué sirve este documento

La planilla de sprint tiene las horas asignadas y usadas por tarea, pero la grilla de días —las columnas de lunes a domingo— está vacía. Este documento dice **en qué día va cada hora**, apoyado en evidencia verificable y no en memoria.

Cada fila de la sección 4 se puede comprobar abriendo el archivo que la respalda y mirando su fecha.

## 2. La regla del día anterior

Varios archivos quedaron guardados de madrugada:

| Archivo | Guardado | Sesión real |
|---|---|---|
| `investigacion de ambitos financieros.docx` | 29-08 a las 02:58 | **28-08** |
| `MATRIZ-DE-TRAZABILIDAD.md` | 05-09 a las 02:32 | **04-09** |
| `Conflictos y decisiones.docx` | 05-09 a las 02:42 | **04-09** |

Se trabajó pasada la medianoche, de modo que el archivo quedó fechado al día siguiente. La regla aplicada en todo el documento:

> **Todo archivo guardado entre las 00:00 y las 06:00 se cuenta al día anterior.**

Es lo que hace que el registro muestre el día en que efectivamente se trabajó, y no el día en que el reloj cambió de fecha.

## 3. Días de trabajo con evidencia

| Día | Qué quedó guardado ese día |
|---|---|
| **vie 14-08** | `01-crear-formulario.gs` y el README de la encuesta (16:50 y 16:52) |
| **sáb 15-08** | Sesión de trabajo registrada (4,9 MB de transcripción) |
| **mié 19-08** | `CONTRIBUTING.md`, `docs/README.md` y el árbol completo de carpetas del proyecto (21:18 a 21:19) |
| **vie 21-08** | `casos-de-uso.puml`, `Casos de uso.docx`, ADR-001 a ADR-004, `docker-compose.yml`, `shared/tenant/base.py`, los cinco servicios y el gateway (21:13 a 21:27) |
| **sáb 22-08** | `02-crear-analisis.gs` (20:19), `Encuesta - respuestas y analisis.xlsx` (20:27), commit «Estructura inicial del proyecto» (20:52), `Informe - Validacion de la problematica.docx` (21:04) |
| **vie 28-08** | Investigación del ámbito financiero (el PDF a las 18:55; el `.docx` figura el 29-08 a las 02:58) |
| **dom 30-08** | Sesión de trabajo larga (25,6 MB de transcripción) |
| **lun 31-08** | ADR-006, diagramas de arquitectura, `Documento de Arquitectura.pdf` (21:52 a 22:03) |
| **mar 01-09** | `modelo-datos.puml`, `render.py` y los cuatro PNG de diagramas (15:20 a 15:21) |
| **mié 02-09** | Las seis pantallas del mockup y sus capturas (11:43 a 12:00), `MODELADO-DE-REQUISITOS-v2.md` (14:26) |
| **vie 04-09** | Matriz de trazabilidad, requisitos vigentes, conflictos y reglas de negocio (guardados el 05-09 entre 02:32 y 02:42) |

## 4. Grilla para llenar

Cada fila indica en qué columna de fecha va cada hora.

| Fila | Tarea | Horas usadas | Día | Horas en ese día |
|---|---|---|---|---|
| 38 | Problemática del proyecto | 3 | vie **14-08** | 2 |
| 38 | *(continúa)* | | sáb **15-08** | 1 |
| 41 | Crear diagrama de Arquitectura de Carpeta | 2 | mié **19-08** | 2 |
| 45 | Readme.txt | 1 | mié **19-08** | 1 |
| 43 | casos de uso en la app | 2 | vie **21-08** | 2 |
| 46 | estudio de datos de la problemática | 1 | sáb **22-08** | 1 |
| 42 | Desarrollo de la problemática | 2 | sáb **22-08** | 2 |
| 40 | Investigación ámbito financiero | 1,5 | vie **28-08** | 1,5 |
| 50 | Creación de mockup | 0,5 | mié **02-09** | 0,5 |
| 39 | Script de lectura de correos | 2 | ⚠ **por definir** | — |
| 44 | Run requerimentos | 1 | ⚠ **por definir** | — |

## 5. Totales por día

Sirven para cuadrar la fila 37 y las sumas de la hoja.

| Día | Horas | De qué tareas |
|---|---|---|
| vie 14-08 | **2** | 38 |
| sáb 15-08 | **1** | 38 |
| mié 19-08 | **3** | 41, 45 |
| vie 21-08 | **2** | 43 |
| sáb 22-08 | **3** | 46, 42 |
| vie 28-08 | **1,5** | 40 |
| mié 02-09 | **0,5** | 50 |
| | **13,0** | **Subtotal con evidencia** |
| — | 3,0 | Filas 39 y 44, pendientes de ubicar |
| | **16,0** | **Total** |

## 6. Las dos tareas que hay que ubicar a mano

Ninguna de las dos dejó archivo en el repositorio, de modo que no se pueden fechar con evidencia.

**Fila 39 · Script de lectura de correos — 2 horas.** Figura «En proceso». No hay ningún script de lectura de correo en el repositorio. Si el trabajo ocurrió en las sesiones largas del **domingo 30-08** o del **lunes 31-08**, ahí van esas dos horas.

**Fila 44 · Run requerimentos — 1 hora.** No tiene artefacto propio. Por contenido encaja con el trabajo del **viernes 21-08**, donde se levantó la estructura de servicios y los ADR.

## 7. Tres cosas de la planilla que no cuadran

### 7.1 Faltan 0,5 horas

La suma de la columna «Horas usadas» de las filas 38 a 50 da **16,0**, pero la fila 37 muestra **15,5**. La diferencia está en la fila 39 o en la 50 — conviene revisar cuál de las dos tiene el valor mal copiado.

### 7.2 Dos tareas figuran como no terminadas, pero el entregable existe

| Fila | Tarea | Estado en la hoja | Realidad |
|---|---|---|---|
| **47** | Crear documento de la problemática | 0 horas usadas, 1,5 restantes | `Informe - Validacion de la problematica.docx` existe desde el **22-08**. Son 26 páginas con el análisis estadístico completo |
| **49** | Crear Matriz de Trazabilidad | «En proceso», 0 horas usadas | **Terminada** el 04-09, en `MATRIZ-DE-TRAZABILIDAD.md` y en Word. Son 20 páginas: catálogo de 36 casos de uso, 52 pruebas funcionales, 21 de requisitos no funcionales y siete vacíos documentados |

Si ambas pasan a «Listo» con sus horas, el sprint sube de 15,5 a **18 horas usadas**, y el avance del sprint queda reflejado como corresponde.

### 7.3 La fila 48 dejó de estar bloqueada

«Actualización y mejora de casos de uso y agregarlo al documento» figura como «sin empezar». Estaba detenida por el conflicto **C-01**, la numeración de casos de uso, que no existía en ninguna parte.

Eso quedó resuelto: la matriz de trazabilidad asigna los identificadores **CU-01 a CU-36**, y lo hace de forma que las diez citas de casos de uso ya escritas en el documento de requisitos resuelven sin necesidad de editarlas. La tarea se puede empezar.

---

## Anexo · Cómo se obtuvo esta evidencia

Tres fuentes, todas reproducibles:

1. **Fechas de modificación** de cada archivo del repositorio `proyecto-suscripciones` y de la carpeta `encuesta-problematica`.
2. **Historial de git:** el commit «Estructura inicial del proyecto», del 22-08 a las 20:52.
3. **Registros de las sesiones de trabajo**, que confirman actividad los días 09, 15, 19, 29, 30 y 31 de agosto y 01, 02, 03, 04 y 07 de septiembre.

Ninguna hora de este documento es una estimación. Las que no tienen respaldo están marcadas como pendientes de ubicar en la sección 6.
