# Reglas de negocio

**Fuente:** `investigacion/Reglas de Negocio para la Plataforma de Gestión de Suscripciones y Finanzas Personales V2 (2).pdf`
**Transcrito y numerado:** 4 de septiembre de 2026

El documento original **no numera las reglas**, lo que impide referenciarlas desde los requisitos o desde las pruebas. Aquí se les asignan identificadores `RN-nn` respetando el orden y el texto del original, y se agrega la columna de trazabilidad hacia el requisito que cada una precisa.

> **Lo más importante de este documento:** contiene las reglas que faltaban para completar RF-03, que era el bloqueo de mayor prioridad de la matriz de trazabilidad (vacío V-02). Ver la sección 7.

---

## 1. Notificaciones y alertas

| ID | Regla | Precisa a |
|---|---|---|
| **RN-01** | La alerta de cobro mensual se envía exactamente **3 días antes** de la fecha estimada de renovación | RF-09, CU-27 |
| **RN-02** | El cobro anual genera **dos** recordatorios: **7 días antes** y **24 horas antes** | RF-09, CU-27 |
| **RN-03** | Las alertas se programan **solo para suscripciones activas**. Al pasar a pausada o cancelada, se eliminan de la cola todas las notificaciones pendientes | RF-09, RF-10 |
| **RN-04** | Regla 48/24: aviso **48 horas antes** y alerta crítica **24 horas antes** del vencimiento de una prueba gratuita | RF-09, CU-28 |
| **RN-05** | La notificación push debe incluir un enlace directo a la pantalla con los pasos de cancelación o la dirección del proveedor | RF-16, CU-25 |
| **RN-06** | Alza de tarifa: el monto supera en **5% o más** el promedio de los últimos 3 meses. Se dispara de forma inmediata | RF-07, CU-30 |
| **RN-07** | Posible doble cobro: **2 cargos del mismo comercio en menos de 5 días** para la misma cuenta | RF-07, CU-30 |
| **RN-08** | Tope diario: **máximo 2 notificaciones push externas por usuario y día**. Con varios eventos en cola, el orden de prioridad es: (1) vencimiento de prueba gratuita, (2) próximo cobro, (3) consejos de ahorro | ⚠ **sin requisito** |
| **RN-09** | Horario de descanso: no se envían push **entre las 22:00 y las 08:00**. Lo generado en esa ventana se encola y se despacha a las **09:00** | ⚠ **sin requisito** |
| **RN-10** | Las alertas críticas —prueba por vencer y alza de tarifa— van por **push y correo**. Los consejos de optimización se entregan **solo dentro de la app** | ⚠ **sin requisito** |

## 2. Categorización e ingesta de datos

| ID | Regla | Precisa a |
|---|---|---|
| **RN-11** | Un cargo se reconoce como suscripción solo si aparece el mismo comercio en al menos **2 períodos consecutivos**, con intervalo de **30 ± 4 días** (mensual) o **365 ± 15 días** (anual) | RF-05 |
| **RN-12** | Si el monto varía **más del 30%** entre meses, se clasifica como **gasto recurrente variable** y queda excluido de las sugerencias de planes fijos | RF-06, CU-34 |
| **RN-13** | Las glosas de las pasarelas de pago —por ejemplo `PAG*NETFLIX 1234`— se normalizan antes de guardarse | RF-05 |

## 3. Recomendaciones y oportunidades de ahorro

| ID | Regla | Precisa a |
|---|---|---|
| **RN-14** | Una recomendación de cambio de plan solo se genera si el ahorro supera el **15%** del costo actual, o un umbral mínimo de la plataforma | RF-18, CU-16 |
| **RN-15** | Un servicio pasa a **fantasma** si no se detecta uso ni confirmación durante **más de 45 días continuos** | RF-03, RF-04, CU-31 |
| **RN-16** | Si hay **dos o más servicios activos de la misma categoría**, se activa una recomendación de consolidación | RF-18 |

## 4. Gestión y ciclo de vida de suscripciones

| ID | Regla | Precisa a |
|---|---|---|
| **RN-17** | Al terminar la prueba gratuita, si el usuario no cancela manualmente, la suscripción pasa a **activa** con el valor del plan estándar | RF-03, CU-29 |
| **RN-18** | La confirmación manual del usuario cancela la suscripción **de forma inmediata** | RF-03, RF-10 |
| **RN-19** | Tras **60 días consecutivos sin cobros registrados**, la suscripción no se cancela: pasa a **por confirmar** y se despliega una verificación pasiva dentro de la app | RF-03 |
| **RN-20** | Tras **30 días adicionales en «por confirmar»** —90 días totales sin cobro— sin respuesta del usuario ni cargos nuevos, pasa a **cancelada** | RF-03, CU-32 |
| **RN-21** | Si en cualquier momento posterior se detecta un cobro nuevo del comercio, la suscripción vuelve a **activa** y se reajusta su regla de frecuencia | RF-03, CU-33 |
| **RN-22** | El gasto mensual proyectado considera **solo** suscripciones activas o en prueba gratuita. Las pausadas, por confirmar y canceladas se descuentan o etiquetan | RF-11, RF-13 |

## 5. Asistente de IA, seguridad y privacidad

| ID | Regla | Precisa a |
|---|---|---|
| **RN-23** | Antes de enviar cualquier texto a la API de IA, el backend **elimina los datos sensibles**: RUT, números de tarjeta, nombres reales y saldos | RF-20, RNF-10, CU-35 |
| **RN-24** | Si la API de IA no responde en **3,5 segundos**, se interrumpe la solicitud y se entrega una respuesta predeterminada desde la base de datos | RF-18, RNF-16 |
| **RN-25** | Se restringe la subida repetida de un mismo PDF a **3 intentos diarios por usuario** | CU-36, RNF-20 |

---

# 6. Lo que estas reglas resuelven

## 6.1 RF-03 queda casi completo

RF-03 era el vacío **V-02** de la matriz: el requisito más importante sin especificar, con cuatro pruebas bloqueadas y cinco casos de uso dependiendo de él. Las reglas RN-15 y RN-17 a RN-22 aportan las transiciones y los umbrales que faltaban.

**Tabla de transición de estados, reconstruida:**

| Estado actual | Evento o condición | Estado resultante | Regla |
|---|---|---|---|
| Prueba gratuita | Termina el período y el usuario no cancela | Activa, con el valor del plan estándar | RN-17 |
| Prueba gratuita | El usuario cancela manualmente | Cancelada | RN-18 |
| Activa | **45 días** sin uso ni confirmación | Fantasma | RN-15 |
| Activa | **60 días** sin cobros registrados | Por confirmar | RN-19 |
| Por confirmar | **30 días más** sin respuesta ni cargos | Cancelada | RN-20 |
| Cualquiera | Se detecta un cobro nuevo del comercio | Activa | RN-21 |
| Cualquiera | El usuario confirma la baja | Cancelada | RN-18 |

**Faltan tres transiciones** que ninguna regla define:

- **Fantasma → ?** RN-15 define cómo se entra al estado fantasma, pero **ninguna regla dice cómo se sale**. ¿Vuelve a activa si el usuario registra uso? ¿Cuánto tiempo permanece?
- **Por confirmar → activa por respuesta del usuario.** RN-19 despliega una verificación pasiva, pero no dice qué ocurre si el usuario **responde que sigue vigente**. Solo está definido el caso en que no responde.
- **Pausada, entrada y salida.** RN-03 y RN-22 mencionan el estado pausada, pero **ninguna regla dice cómo se entra ni cómo se sale**. El diagrama de flujo del equipo sí lo contempla, con una «fecha de reactivación» que ninguna regla ni requisito define.

## 6.2 Otros vacíos que se cierran

| Vacío | Cómo se cierra |
|---|---|
| `SUSCRIPCION.estado` como cadena libre (M-16 del MER) | Los estados quedan enumerados: prueba gratuita, activa, pausada, por confirmar, fantasma, cancelada |
| `es_recurrente_variable` sin criterio | RN-12 lo define: variación superior al 30% entre meses |
| Umbral del alza de tarifa | RN-06 confirma el 5% que ya decía RF-07 |
| RNF-09 sin umbral | RN-24 aporta un timeout de 3,5 segundos, **pero no es lo mismo** que el umbral bajo carga que pedía RNF-09. Ver CN-07, resuelto el 5-09 con las métricas de RNF-09 |

---

# 7. Conflictos que estas reglas introducen

Ocho. Todos son reales y hay que resolverlos, porque una regla de negocio que contradice un requisito deja el sistema sin criterio.

## CN-01 · Las alertas son fijas en las reglas y configurables en el requisito

**Severidad alta.** RF-09 dice:

> anticipación **configurable de 1 a 14 días** (por defecto 3)

Las reglas dicen otra cosa: RN-01 fija exactamente 3 días para el cobro mensual, RN-02 fija 7 días y 24 horas para el anual, y RN-04 fija 48 y 24 horas para las pruebas. **Ninguna es configurable.**

Además, RN-02 y RN-04 generan **dos alertas por evento**, algo que RF-09 no contempla en ninguna parte.

Hay que decidir: o las alertas son configurables y las reglas pasan a ser los valores por defecto, o son fijas y RF-09 se reescribe. La segunda opción es más simple de implementar; la primera responde mejor a lo que pidió el 76,3% de los encuestados.

## CN-02 · Tres reglas de notificación no tienen requisito

**Severidad alta.** RN-08 (tope de 2 push diarias con orden de prioridad), RN-09 (horario de descanso de 22:00 a 08:00) y RN-10 (canal según criticidad) **no aparecen en ningún requisito funcional ni no funcional**.

No son detalles: cambian el comportamiento observable del sistema y son perfectamente verificables. Deben incorporarse a RF-09 o convertirse en requisitos propios.

## CN-03 · El estado «pausada» no existe en RF-03

**Severidad alta.** RN-03 y RN-22 tratan «pausada» como un estado del sistema. RF-03 solo define prueba, activa, dudosa, cancelada y fantasma. El diagrama de flujo del equipo sí incluye pausar, con una fecha de reactivación.

O se agrega a RF-03 con sus reglas de entrada y salida, o se elimina de las reglas de negocio.

## CN-04 · «Dudosa» y «por confirmar» son el mismo estado con dos nombres

**Severidad media.** RF-03 lo llama **dudosa**. RN-19 lo llama **por confirmar**. El diagrama de casos de uso tiene «Confirmar estado de suscripción dudosa». Hay que fijar un solo nombre y usarlo en todas partes.

## CN-05 · Tres reglas del ciclo de vida exigen datos bancarios continuos

**Severidad alta.** RN-19, RN-20 y RN-21 se basan en la **ausencia o aparición de cobros en las cartolas** durante ventanas de 60 y 90 días.

Eso presupone un flujo continuo de movimientos bancarios. El **ADR-005 descartó la conexión bancaria**, y RF-05 solo contempla carga manual de CSV, PDF de cartola y correo electrónico.

Con carga manual, estas tres reglas **no pueden ejecutarse de forma automática**: dependen de que el usuario suba la cartola con regularidad. Si deja de subirla durante dos meses, el sistema cancelará suscripciones que siguen activas.

Es la misma raíz del vacío **V-01** de la matriz. Mientras no se resuelva, tres reglas del ciclo de vida quedan sin base de datos que las alimente.

## CN-06 · RN-06 vuelve a hablar de cartola bancaria

**Severidad media.** Misma raíz que CN-05. La regla del alza de tarifa dice «el monto registrado en la cartola bancaria». Con carga manual de PDF sigue siendo posible, pero la redacción debe reflejar que la fuente no es una conexión al banco.

## CN-07 · RN-24 no llena el vacío de RNF-09

**Severidad baja.** RNF-09 pide un umbral de **tiempo de respuesta promedio bajo carga concurrente**. RN-24 define un **timeout por solicitud individual** de 3,5 segundos. Son cosas distintas: un sistema puede cumplir el timeout y aun así tener un promedio inaceptable bajo carga.

Resuelto el 5-09: RNF-09 fijó 50 chats concurrentes con promedio ≤ 2,5 s y p95 ≤ 4 s, coherente con el timeout de 3,5 s de RN-24 (valores por ratificar, acta R-02 de CONFLICTOS-Y-DECISIONES).

## CN-08 · El encabezado del documento contradice las decisiones de arquitectura

**Severidad media.** El documento se presenta como especificación para «Django REST Framework, Celery, Postgres, Redis» y clientes «React Native / **Flutter**», y nombra «las APIs de **Gemini o Groq**».

Tres problemas: Flutter se descartó en el ADR-006, que fijó React Native con Expo; el stack descrito es el de un monolito, mientras que la arquitectura acordada es de microservicios; y la elección del proveedor de IA no está registrada en ningún ADR.

---

# 8. Reglas que no tienen requisito que las sostenga

Cinco reglas describen comportamientos que **ningún requisito funcional menciona**. Cada una necesita, o bien un requisito que la respalde, o bien ser retirada.

| Regla | Qué introduce | Acción |
|---|---|---|
| RN-08 | Tope de 2 push diarias con orden de prioridad | Incorporar a RF-09 |
| RN-09 | Horario de descanso 22:00–08:00 | Incorporar a RF-09 |
| RN-10 | Canal según criticidad de la alerta | Incorporar a RF-09 |
| RN-11 | Umbral de recurrencia: 2 períodos, 30 ± 4 o 365 ± 15 días | Incorporar a RF-05 |
| RN-14 | Ahorro mínimo del 15% para generar una recomendación | Incorporar a RF-18 |

---

# 9. Qué hacer con este documento

1. **Numerar las reglas en el documento original** con los identificadores `RN-01` a `RN-25` de aquí. Sin identificadores no se pueden referenciar desde los requisitos ni desde las pruebas.
2. **Completar RF-03** con la tabla de transición de la sección 6.1, y definir las tres transiciones que faltan.
3. **Resolver CN-01**: decidir si las alertas son configurables o fijas.
4. **Resolver CN-03 y CN-04**: fijar el conjunto definitivo de estados y un solo nombre para cada uno.
5. **Incorporar las cinco reglas huérfanas** de la sección 8 a sus requisitos.
6. **Corregir el encabezado** del documento original: Flutter, el stack monolítico y el proveedor de IA.
7. **Agregar la columna RN a la matriz de trazabilidad**, para que cada requisito muestre qué reglas lo precisan.
