# Documentos superados

Todo lo que hay en esta carpeta **usa numeraciones anteriores** de historias de usuario, requisitos, casos de uso o reglas de negocio. Ninguno está vigente.

El documento válido es **[`../Modelado de requisitos - Ojo al Gasto.docx`](../Modelado%20de%20requisitos%20-%20Ojo%20al%20Gasto.docx)**, que contiene la especificación completa: las dos situaciones, las reglas de negocio, las historias, los requisitos funcionales y no funcionales, el catálogo de casos de uso, la matriz de trazabilidad, los diagramas y el registro de validación.

> ⚠️ **No usar estos archivos como referencia.** Un `RF-11` o un `CU-27` de aquí significa algo distinto que en el documento vigente. Esa confusión ya costó tiempo antes.

---

## Por qué se conservan

Estos documentos son el **registro del proceso de validación**. La sección 11 del documento vigente afirma que hubo cinco revisiones entre el 22 de agosto y el 8 de septiembre de 2026; esta carpeta es la evidencia de esas revisiones.

Varios contienen análisis que no está recogido en ningún otro lado.

## Qué hay aquí

| Archivo | Qué contiene | Por qué quedó superado |
|---|---|---|
| `REVISION-MER.md` | 56 hallazgos sobre el modelo de datos, con la corrección propuesta para cada uno | Referencia los requisitos por la numeración anterior |
| `CONFLICTOS-Y-DECISIONES.md` | Los conflictos detectados entre el modelo de requisitos y la arquitectura, con opciones y recomendación | Ídem |
| `MATRIZ-DE-TRAZABILIDAD.md` | La primera matriz, con el catálogo CU-01 a CU-36 | La matriz vigente es la sección 9 del documento, y se recalcula desde las fichas |
| `REGLAS-DE-NEGOCIO.md` | Las reglas transcritas y numeradas RN-01 a RN-25 | El documento usa el esquema del equipo: `RN-NOT-001`, `RN-DAT-001`, etc. |
| `MODELADO-DE-REQUISITOS-v2.md` | Propuesta paralela con 12 historias y evidencia empírica por requisito | No se adoptó; su numeración es incompatible |
| `HANDOFF.md` | Estado del proyecto para retomarlo en otra sesión | Describe un estado anterior |
| `mer-equipo.md` | Transcripción del modelo entidad-relación que se revisó | El modelo cambió |
| `mer-corregido.md`, `flujo-corregido.md` | Propuestas de corrección del MER y del diagrama de flujo | Los diagramas del documento son los del equipo |

## Lo que sigue vigente en `docs/`

- `Modelado de requisitos - Ojo al Gasto.docx` — **la especificación**
- `CATALOGO-CASOS-DE-USO.md` y su versión en Word — los 30 casos de uso, con la numeración actual
- `REGISTRO-DE-HORAS-SPRINT-0.md` — el registro de horas, independiente de la numeración
- `glosario.md` — el vocabulario del proyecto
- `arquitectura/` — los seis ADR
- `diagramas/` — las fuentes y las imágenes de los diez diagramas
- `investigacion/` — la encuesta anonimizada, el informe de validación y la evaluación del docente
- `mockup/` — las seis pantallas
