# Catalogo de casos de uso

**Proyecto:** Ojo al Gasto  
**Version del modelo de requisitos:** 8 de septiembre de 2026

> **Por que existe este documento.** El modelo de requisitos referencia **30 casos de uso**
> —CU-01 a CU-31, sin CU-11— pero no define el nombre de ninguno: solo aparecen como
> identificadores dentro de la trazabilidad. Sin un catalogo, `CU-27` no significa nada
> para quien lea el documento, y el diagrama es el unico lugar donde se veria el nombre.

**Las relaciones de este catalogo estan calculadas** desde la columna Fuente de la tabla de
requisitos funcionales y desde la trazabilidad declarada en cada historia. No se transcribieron.

**Los nombres, en cambio, son una propuesta.** Se dedujeron del requisito que cada caso de uso
realiza. Los marcados con ⚠ necesitan que el equipo los confirme, por las razones de la seccion 3.

---

## 1. Catalogo

| CU | Nombre | Actor | Realiza | Lo invocan |
|---|---|---|---|---|
| **CU-01** | Registrar cuenta | Usuario nuevo | RF-01 | HU-01 |
| **CU-02** | Iniciar sesion | Usuario registrado | RF-02 | HU-02 |
| **CU-03** | Gestionar credenciales | Usuario registrado | RF-03, RF-04 | HU-03 |
| **CU-04** | Eliminar cuenta y datos | Usuario autenticado | RF-05 | HU-04 |
| **CU-05** | Registrar suscripcion manualmente | Usuario autenticado | RF-06, RF-09, RF-12 | HU-05, HU-07 |
| **CU-06** | Editar suscripcion | Usuario autenticado | RF-07 | HU-06 |
| **CU-07** | Cancelar o eliminar suscripcion | Usuario autenticado | RF-08, RF-21 | HU-20 |
| **CU-08** | Visualizar panel de suscripciones | Usuario autenticado | RF-09 | HU-08 |
| **CU-09** | Visualizar calendario de pagos | Usuario autenticado | RF-10 | HU-09 |
| **CU-10** | Importar suscripciones desde CSV o PDF | Usuario autenticado | RF-11, RF-14 | HU-11 |
| **CU-12** | Vincular cuenta de correo | Usuario autenticado | RF-14 | HU-12 |
| **CU-13** | Confirmar cobros candidatos | Usuario autenticado | RF-14 | HU-12 |
| **CU-14** | Vincular conector de tiempo de uso | Usuario autenticado | RF-15, RF-16 | HU-13 |
| **CU-15** | Chatear con el asistente financiero | Usuario Premium | RF-24 | HU-23 |
| **CU-16** | Solicitar recomendacion ⚠ | Usuario Premium | RF-24, RF-25 | HU-24 |
| **CU-17** | Explicar una recomendacion | Usuario Premium | RF-25 | HU-24 |
| **CU-18** | Configurar alertas | Usuario autenticado | RF-18 | HU-16, HU-17 |
| **CU-19** | Consultar guia de cancelacion | Usuario autenticado | RF-20 | HU-19 |
| **CU-20** | Visualizar historial de ahorro | Usuario autenticado | RF-08, RF-21 | HU-20 |
| **CU-21** | Exportar historial de gastos | Usuario autenticado | RF-22 | HU-21 |
| **CU-22** | Contratar y gestionar el plan Premium | Usuario autenticado | RF-23 | HU-22 |
| **CU-23** | Registrar uso manual | Usuario autenticado | RF-15, RF-16 | HU-13 |
| **CU-24** | Transitar estado de la suscripcion | Temporizador | RF-13 | HU-18 |
| **CU-25** | Definir presupuesto ideal | Usuario autenticado | RF-19 | HU-10 |
| **CU-26** | Marcar suscripcion por confirmar | Temporizador | RF-13 | HU-18 |
| **CU-27** | Detectar suscripcion fantasma | Temporizador | RF-13 | HU-14 |
| **CU-28** | Cancelar por inactividad extendida | Temporizador | RF-13 | HU-18 |
| **CU-29** | Reactivar suscripcion automaticamente | Temporizador | RF-13 | HU-18 |
| **CU-30** | Detectar anomalias de cobro | Temporizador | RF-17 | HU-15 |
| **CU-31** | Transitar post-trial a estado activo | Temporizador | RF-13 | HU-18 |

## 2. Casos de uso por actor

| Actor | Casos de uso |
|---|---|
| Usuario nuevo | CU-01 |
| Usuario registrado | CU-02, CU-03 |
| Usuario autenticado | CU-04, CU-05, CU-06, CU-07, CU-08, CU-09, CU-10, CU-12, CU-13, CU-14, CU-18, CU-19, CU-20, CU-21, CU-22, CU-23, CU-25 |
| Usuario Premium | CU-15, CU-16, CU-17 |
| Temporizador | CU-24, CU-26, CU-27, CU-28, CU-29, CU-30, CU-31 |

Los actores humanos se generalizan: **Usuario autenticado** es un Usuario registrado, y
**Usuario Premium** es un Usuario autenticado. Cada uno hereda los casos de uso del anterior.

## 3. De donde salen los nombres

### 3.1 Los seis del ciclo de vida - RESUELTO

**CU-24, CU-26, CU-27, CU-28, CU-29 y CU-31** nacen todos de RF-13, que especifica la maquina
de estados completa. El documento los enumera juntos sin distinguirlos, de modo que hubo que
determinar cual era cual.

**CU-27 quedo fijado por evidencia**: HU-14 habla de los servicios sin usar en 45 dias y
declara CU-27 junto a la regla RN-REC-002. Es la deteccion de suscripcion fantasma.

**Los otros cinco los decidio el equipo el 8 de septiembre**, siguiendo el orden del ciclo:

| CU | Nombre | Momento del ciclo |
|---|---|---|
| CU-24 | Transitar estado de la suscripcion | Caso general; los demas lo extienden |
| CU-31 | Transitar post-trial a estado activo | Termina la prueba gratuita sin cancelacion |
| CU-27 | Detectar suscripcion fantasma | 45 dias sin uso registrado |
| CU-26 | Marcar suscripcion por confirmar | Periodo sin cobros detectados |
| CU-28 | Cancelar por inactividad extendida | Periodo adicional sin respuesta ni cargos |
| CU-29 | Reactivar suscripcion automaticamente | Aparece un cobro nuevo del mismo comercio |

En la misma decision, **HU-18 paso a declarar las cinco transiciones** que le corresponden
-CU-24, CU-26, CU-28, CU-29 y CU-31- en vez de tres. Su historia ya decia que gestiona los
estados en plural, y CU-26 y CU-29 no los invocaba ninguna historia.

### 3.2 CU-12 y CU-13 - RESUELTO

Ambos nacen de RF-14, que cubre a la vez conectar la fuente de datos y confirmar los cobros
que se detectan. El equipo fijo el reparto el 8 de septiembre: **CU-12 es vincular la cuenta
de correo** y **CU-13 es confirmar los cobros candidatos**. Es coherente con HU-12, que
declara los dos juntos y habla de vincular el correo para que el sistema detecte cobros.

### 3.3 CU-16, el unico que queda

Sale de RF-24 y RF-25 a la vez, igual que CU-15 y CU-17. Se asumio que es el paso intermedio
entre chatear con el asistente y recibir la explicacion: **solicitar la recomendacion**.

No bloquea nada. Si el equipo lo recuerda de otra forma, es cambiar una celda.

## 4. Lo que este catalogo deja a la vista

| Hallazgo | Detalle |
|---|---|
| CU-11 no existe | La numeracion salta de CU-10 a CU-12. Conviene dejarlo dicho para que nadie lo busque |
| RF-13 concentra seis casos de uso | Es el requisito de la maquina de estados. Que un solo requisito gobierne seis casos de uso confirma que es el mas critico del sistema |
| RF-03 y RF-12 no declaran caso de uso | RF-03 figura como «Derivado» y RF-12 como «Derivado (gap: falta CU propio)». El propio documento reconoce el segundo |

---

## 5. Como mantenerlo

Las cuatro ultimas columnas de la seccion 1 se regeneran desde el documento de requisitos.
Lo unico que se edita a mano son el nombre y el actor. Si manana cambia la trazabilidad de una
historia, este catalogo la recoge sin que nadie lo retoque.
