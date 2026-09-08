# Matriz de trazabilidad

**Proyecto:** Ojo al Gasto  
**Version del modelo de requisitos:** 8 de septiembre de 2026, 42 paginas  
**Elementos trazados:** 24 HU · 26 RF · RNF con desdoblamiento · 24 reglas de negocio · CU hasta CU-31

> Esta matriz usa **la numeracion del documento vigente**. Cualquier matriz anterior,
> y los diagramas que usen otra numeracion, quedan reemplazados por esta.

---

## 1. Vista principal: historia de usuario

Consolida la trazabilidad que cada historia ya declara en su propia fila.

| HU | Prioridad | RF | RNF | Reglas de negocio | CU |
|---|---|---|---|---|---|
| **HU-01** | High | RF-01 | RNF-03A, RNF-10, RNF-13 | — | CU-01 |
| **HU-02** | High | RF-02 | RNF-03A, RNF-05A | — | CU-02 |
| **HU-03** | Medium | RF-03 | RNF-13 | — | CU-03 |
| **HU-04** | High | RF-05 | RNF-10, RNF-13 | RN-SEG-001 | CU-04 |
| **HU-05** | High | RF-06, RF-12 | RNF-14A | — | CU-05 |
| **HU-06** | Medium | RF-07 | — | — | CU-06 |
| **HU-07** | Medium | RF-09, RF-12 | — | — | CU-05 |
| **HU-08** | High | RF-09 | RNF-05A, RNF-05B, RNF-12 | RN-CIC-005 | CU-08 |
| **HU-09** | Medium | RF-10 | — | RN-NOT-003 | CU-09 |
| **HU-10** | Medium | RF-19 | — | RN-CIC-005 | CU-25 |
| **HU-11** | Medium | RF-11, RF-14 | — | RN-DAT-004, RN-IA-003 | CU-10 |
| **HU-12** | High | RF-14 | RNF-01, RNF-03B, RNF-10, RNF-16 | RN-DAT-001, RN-DAT-002, RN-DAT-005 | — |
| **HU-13** | High | RF-15, RF-16 | — | — | CU-14, CU-23 |
| **HU-14** ⚠ | High | — | — | — | — |
| **HU-15** | High | RF-17 | RNF-06 | RN-DAT-003, RN-DAT-005, RN-NOT-005 | CU-30 |
| **HU-16** | High | RF-18 | — | RN-NOT-001, RN-NOT-002, RN-NOT-004 | CU-18 |
| **HU-17** | Medium | RF-18 | — | RN-NOT-005, RN-NOT-006, RN-NOT-007 | CU-18 |
| **HU-18** | High | RF-13 | — | RN-CIC-001, RN-CIC-003, RN-CIC-004 | CU-24, CU-28, CU-31 |
| **HU-19** | Low | RF-20 | — | RN-CIC-002 | CU-19 |
| **HU-20** | Medium | RF-08, RF-21 | — | RN-CIC-002, RN-NOT-003 | CU-07, CU-20 |
| **HU-21** | Medium | RF-22 | RNF-10, RNF-14A | — | CU-21 |
| **HU-22** | High | RF-23 | — | — | CU-22 |
| **HU-23** | High | RF-24 | RNF-09, RNF-10 | RN-IA-001, RN-IA-002, RN-REC-001 | CU-15 |
| **HU-24** | Medium | RF-25 | — | RN-DAT-003, RN-REC-001, RN-REC-003 | CU-16, CU-17 |

## 2. Vista inversa: requisito funcional

Revela los requisitos que ninguna historia origina.

| RF | Requisito | Lo origina | RNF que lo condicionan |
|---|---|---|---|
| RF-01 | Registrar cuenta con correo unico y contrasena | HU-01 | RNF-03A, RNF-10, RNF-13 |
| RF-02 | Iniciar sesion con correo/contrasena o con Google | HU-02 | RNF-03A, RNF-05A |
| RF-03 | Recuperar contrasena mediante enlace al correo | HU-03 | RNF-13 |
| RF-04 | Actualizar correo y/o contrasena del perfil propio | **ninguna** ✗ | — |
| RF-05 | Eliminar cuenta y todos los datos asociados | HU-04 | RNF-10, RNF-13 |
| RF-06 | Registrar suscripcion manual | HU-05 | RNF-14A |
| RF-07 | Editar nombre, monto, frecuencia, fecha y categoria | HU-06 | — |
| RF-08 | Marcar suscripcion como cancelada o eliminarla | HU-20 | — |
| RF-09 | Visualizar panel con listado y gasto del periodo | HU-07, HU-08 | RNF-05A, RNF-05B, RNF-12 |
| RF-10 | Visualizar calendario mensual de cobros proyectados | HU-09 | — |
| RF-11 | Importar suscripciones desde CSV o PDF | HU-11 | — |
| RF-12 | Clasificar cada suscripcion en una categoria unica | HU-05, HU-07 | RNF-14A |
| RF-13 | Gestionar la maquina de estados completa | HU-18 | — |
| RF-14 | Detectar cobros candidatos desde CSV, PDF o correo | HU-11, HU-12 | RNF-01, RNF-03B, RNF-10, RNF-16 |
| RF-15 | Vincular un conector externo de tiempo de uso | HU-13 | — |
| RF-16 | Registrar uso manual | HU-13 | — |
| RF-17 | Detectar alza de tarifa sobre 5% del promedio de 3 meses | HU-15 | RNF-06 |
| RF-18 | Activar o desactivar alertas | HU-16, HU-17 | — |
| RF-19 | Definir presupuesto mensual ideal y alertar su exceso | HU-10 | — |
| RF-20 | Mostrar guia de cancelacion paso a paso | HU-19 | — |
| RF-21 | Listar suscripciones canceladas con ahorro estimado | HU-20 | — |
| RF-22 | Exportar a CSV los cobros y suscripciones | HU-21 | RNF-10, RNF-14A |
| RF-23 | Contratar y gestionar el plan Premium | HU-22 | — |
| RF-24 | Chatear con el asistente financiero | HU-23 | RNF-09, RNF-10 |
| RF-25 | Explicar el motivo de una recomendacion | HU-24 | — |
| RF-26 | (no se pudo leer del PDF: completar) | **ninguna** ✗ | — |

## 3. Cobertura

| Indicador | Resultado |
|---|---|
| Historias con requisito funcional | **23 de 24** |
| Requisitos originados por alguna historia | **24 de 26** |
| Historias con prioridad asignada | 24 de 24 |
| Historias con caso de uso | 22 de 24 |
| Historias con regla de negocio | 14 de 24 |
| Historias con caso de prueba | **0 de 24** ✗ |

## 4. Vacios detectados

### V-01 · HU-14 tiene la celda de trazabilidad vacia

**Severidad alta.** La historia existe, tiene criterios de aceptacion y prioridad High,
pero su celda **Trazabilidad** esta rotulada y sin contenido. Es la unica de las 24.

Trata de la deteccion automatica de servicios sin uso durante 45 dias. Por contenido
deberia apuntar a **RF-13**, a la regla del umbral de 45 dias y al caso de uso de
deteccion de suscripcion fantasma.

### V-02 · Dos requisitos funcionales sin historia que los origine

| RF | Requisito |
|---|---|
| **RF-04** | Actualizar correo y/o contrasena del perfil propio |
| **RF-26** | (no se pudo leer del PDF: completar) |

RF-04 es el mas llamativo: actualizar el correo o la contrasena es una operacion que
el usuario hace, de modo que deberia nacer de una historia. O se le escribe, o se
declara como requisito derivado y se anota de donde sale.

### V-03 · Casos de uso que ninguna historia alcanza

**CU-12**, **CU-13**, **CU-27**. Existen en el modelo pero ninguna historia los referencia.

### V-04 · Una regla de negocio sin destinatario

**RN-REC-002** no la invoca ninguna historia. O falta la trazabilidad, o la regla sobra.

### V-05 · Falta la columna de pruebas

La cadena llega hasta el caso de uso y ahi se corta. La trazabilidad completa que pide
la evaluacion es **HU → CU → RF → RNF → prueba**, y el ultimo eslabon no existe.

Los criterios de aceptacion ya estan escritos en formato Dado / Cuando / Entonces, asi
que cada uno se convierte en un caso de prueba de forma directa. Es trabajo mecanico.

### V-06 · Identificadores escritos de dos formas

En el documento conviven `RF-11` y `RF - 11`, con espacios, y `RNF-09` con `RNF-9`.
Son el mismo identificador escrito distinto, y rompe cualquier busqueda o referencia
cruzada. Conviene normalizarlo a `RF-nn` y `RNF-nn` antes de entregar.

---

## 5. Como mantener esta matriz

La matriz pierde su valor en cuanto queda desactualizada, porque el analisis de impacto
pasa a apoyarse en relaciones falsas.

Como cada historia ya declara su propia trazabilidad dentro del documento, **esta matriz
se puede regenerar** a partir de esas celdas. La regla practica: ningun requisito se
considera terminado si su fila no esta actualizada.
