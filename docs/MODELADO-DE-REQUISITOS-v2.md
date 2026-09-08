# Modelado de requisitos — versión 2

**Proyecto:** Ojo al Gasto · **Fecha:** 2 de septiembre de 2026

---

## Qué cambia respecto de la versión anterior

Esta versión reelabora el modelado de requisitos incorporando la evidencia del estudio de validación de la problemática (n = 38 usuarios con suscripciones, sobre 49 respuestas).

| Cambio | Motivo |
|---|---|
| **Cada requisito cita la evidencia que lo justifica** | Antes la prioridad era una opinión; ahora es un dato |
| **Priorización derivada de la demanda medida** | La funcionalidad más pedida obtuvo 76,3%; la que se creía central, 21,1% |
| Requisitos funcionales completados: de 10 a **20** | RF-09 y RF-10 estaban vacíos; RF-06 tenía las celdas cruzadas |
| Historias de usuario ampliadas: de 5 a **12** | Cinco historias no cubren veinte requisitos |
| Cada RNF suma una **métrica verificable en esta versión** | Varios objetivos originales no son medibles en el proyecto |
| **Matriz de trazabilidad** HU ↔ RF ↔ RNF | No existía; es lo primero que se revisa |
| Sincronización bancaria movida a **alcance excluido** | Inviable económica y regulatoriamente (ADR-005) |

---

# 1. Fundamento empírico

Todo requisito de este documento se apoya en uno o más de estos hallazgos.

| Código | Hallazgo | Dato |
|---|---|---|
| **E1** | Paga por servicios que no usa | 68,4% (26 de 38); 36,8% en más de una ocasión |
| **E2** | El desperdicio escala con la cantidad de suscripciones | 100% de quienes tienen 3 o más (χ² = 8,81; p = 0,003) |
| **E3** | Cobrado tras una prueba gratuita no cancelada | 65,8%; al 44,7% más de una vez |
| **E4** | No lleva ningún control de sus suscripciones | 65,8%; solo el 5,3% usa una herramienta |
| **E5** | Demanda: aviso previo a cada cobro | 76,3% |
| **E6** | Demanda: aviso de término de prueba gratuita | 60,5% |
| **E7** | Demanda: ver el total mensual | 34,2% |
| **E8** | Demanda: conocer el uso real de cada servicio | 23,7% |
| **E9** | Demanda: recomendación de cancelación | 21,1% |
| **E10** | Demanda: ayuda para cancelar | 13,2% |
| **E11** | Continuó pagando por no realizar el trámite de cancelación | 36,8% |
| **E12** | Dificultad percibida para cancelar | 2,68 sobre 5 |
| **E13** | Comparte alguna suscripción | 57,9%; de ellos, 28% con conflictos de cobro |
| **E14** | Disposición a pagar por la solución | 73,7% considera algún esquema de pago |
| **E15** | Dispositivo de uso | 84,2% teléfono · 47,4% computador · 21,1% televisor |
| **E16** | Conoce su gasto mensual con precisión | 75% acertó su tramo (hipótesis H1 **rechazada**) |

> **E16 es determinante.** El problema no es de información —los usuarios saben cuánto gastan— sino de oportunidad de decisión: el cobro automático ocurre sin que medie un momento en que evalúen si continúan.

---

# 2. Priorización basada en evidencia

La prioridad de cada requisito se deriva de dos variables medidas: **cuánta gente lo pide** y **cuánta gente sufre el problema que resuelve**. No siempre coinciden, y esa divergencia es en sí un hallazgo.

| Nivel | Criterio | Ejemplos |
|---|---|---|
| **Crítica** | Demanda declarada superior al 50% **o** problema que afecta a más de dos tercios | Aviso de cobro (E5), aviso de prueba (E6, E3) |
| **Alta** | Habilita una funcionalidad crítica, o resuelve un problema de alta prevalencia con demanda menor | Registro de uso (E8), recomendación (E1, E9) |
| **Media** | Demanda entre 10% y 35% | Panel de gastos (E7), guía de cancelación (E10) |
| **Baja** | Demanda inferior al 10%, o funcionalidad de apoyo | Presupuesto, informes por período |

⚠️ **La divergencia entre lo pedido y lo necesario debe declararse explícitamente.** El 76,3% pide alertas y solo el 21,1% pide recomendaciones de cancelación, pero es el 68,4% el que paga por servicios que no usa. Los usuarios solicitan la solución que conocen; el estudio revela un problema que las alertas por sí solas no resuelven.

**Decisión de producto:** las alertas constituyen la propuesta de valor de entrada; la medición de uso y la recomendación de cancelación son la capacidad diferenciadora. Ambas se construyen; el orden de implementación sigue la evidencia de demanda.

---

# 3. Historias de usuario

## Acceso y cuenta

**HU-01 · Iniciar sesión**
*Como usuario, quiero iniciar sesión con mi correo y contraseña o con Google, para acceder de forma segura a mis datos.*

- Dado que estoy en la pantalla de acceso, cuando ingreso credenciales válidas, entonces el sistema me lleva al panel.
- Dado que ingreso datos incorrectos, entonces el sistema muestra «Usuario o contraseña inválidos», sin revelar cuál de los dos falló.

**HU-02 · Eliminar mi cuenta y mis datos**
*Como usuario, quiero eliminar mi cuenta y todo lo asociado a ella, para ejercer mi derecho a que dejen de tratar mis datos.*

- Dado que solicito la eliminación, cuando confirmo, entonces el sistema elimina mis suscripciones, cobros, registros de uso y credenciales de conectores.
- El sistema me informa qué se eliminará antes de confirmar.

> Evidencia: obligación de la Ley 21.719, vigente desde el 1 de diciembre de 2026.

## Registro de suscripciones

**HU-03 · Registrar una suscripción a mano**
*Como usuario, quiero registrar una suscripción manualmente, para tener el control sin depender de conectar ninguna cuenta.*

- Dado el formulario, cuando ingreso servicio, monto, ciclo y fecha del primer cobro, entonces el sistema calcula y muestra la fecha del próximo cobro.
- Dado que el monto es cero o negativo, entonces el sistema lo rechaza indicando el campo.

> Evidencia: **E4** — el 65,8% no lleva ningún control. Es el punto de partida obligatorio: el sistema debe ser funcional sin ningún conector.

**HU-04 · Importar varias de una vez**
*Como usuario, quiero importar mis suscripciones desde un archivo, para no cargarlas una por una.*

- Dado un archivo con columnas reconocibles, cuando lo subo, entonces el sistema muestra una vista previa antes de guardar.
- Las filas con errores se informan sin bloquear la importación del resto.

## Alertas

**HU-05 · Recibir aviso antes de cada cobro**
*Como usuario, quiero que me avisen antes de que me cobren, para decidir a tiempo si quiero seguir pagando.*

- Dado que una suscripción se cobra en 2 días, entonces recibo una notificación con el servicio, el monto y la fecha.
- La alerta llega por notificación push y por correo; si el dispositivo no está disponible, el correo se envía igualmente.

> Evidencia: **E5** — 76,3%. La funcionalidad más demandada del estudio.

**HU-06 · Recibir aviso antes de que termine una prueba gratuita**
*Como usuario, quiero que me avisen antes de que una prueba gratuita se convierta en cobro, para no pagar algo que no quería.*

- Dado que una prueba termina en 2 días, entonces recibo una alerta indicando el monto que se cobrará y cómo cancelar.
- Si ya se envió la alerta, no se repite.

> Evidencia: **E3** — 65,8% ha sido cobrado así, el 44,7% más de una vez. **E6** — 60,5% lo pide.

**HU-07 · Enterarme de un alza de precio**
*Como usuario, quiero saber cuándo un servicio sube de precio, para reevaluar si lo mantengo.*

- Dado un cobro superior al anterior del mismo proveedor, entonces el sistema me notifica indicando el monto anterior, el nuevo y la diferencia anual.

## Uso y recomendación

**HU-08 · Saber cuánto uso realmente cada servicio**
*Como usuario, quiero ver cuánto uso cada suscripción, para saber cuáles me convienen.*

- Dado que autoricé una cuenta o registré uso manual, entonces el panel muestra las horas del mes y el **costo por hora de uso**.
- Dado que una suscripción no tiene datos de uso, entonces se identifica como «sin datos» y no se le calcula la métrica.

> Evidencia: **E8** — 23,7%.

**HU-09 · Que me digan qué conviene cancelar**
*Como usuario, quiero que el sistema me señale qué suscripciones no me compensan, para dejar de pagar lo que no uso.*

- Dado que una suscripción supera el umbral de desperdicio, entonces aparece una recomendación con el motivo y el ahorro anual estimado.
- La recomendación explica en qué se basa: días sin uso, costo por hora y tendencia.
- Dado que no hay datos de uso, no se genera recomendación.

> Evidencia: **E1** — 68,4% ha incurrido en este gasto. **E2** — el 100% de quienes tienen 3 o más suscripciones.

**HU-10 · Saber cómo cancelar**
*Como usuario, quiero instrucciones para dar de baja un servicio, porque el trámite me da lata y termino pagando de más.*

- Dado que abro una suscripción, entonces puedo ver los pasos de cancelación y el enlace directo al portal del proveedor.
- Dado que la marco como cancelada, entonces el sistema registra la fecha y el ahorro estimado.

> Evidencia: **E11** — 36,8% siguió pagando por no hacer el trámite. **E10** — 13,2% lo pide explícitamente. **E12** — la dificultad percibida es moderada (2,68/5): el obstáculo es conductual antes que técnico.

## Panel y configuración

**HU-11 · Ver cuánto gasto en total**
*Como usuario, quiero ver mi gasto mensual y anual en un solo lugar, para dimensionar lo que destino a suscripciones.*

- El panel carga en menos de 3 segundos con 50 suscripciones cargadas.
- Muestra total mensual, proyección anual, próximo cobro y desglose por categoría.
- Las suscripciones sin monto se excluyen del total y se identifican como pendientes.

> Evidencia: **E7** — 34,2%.

**HU-12 · Conectar mis cuentas para automatizar**
*Como usuario, quiero conectar mi correo y mis servicios, para no tener que registrar todo a mano.*

- Dado que autorizo una cuenta, entonces el sistema realiza una primera sincronización y me muestra lo detectado.
- Dado que rechazo los permisos, entonces el sistema ofrece el registro manual sin bloquearme.
- Dado que desconecto una cuenta, entonces se eliminan los datos obtenidos por esa vía, no solo el acceso.

---

# 4. Requisitos funcionales

| ID | Requisito | Prioridad | Evidencia | HU |
|---|---|---|---|---|
| **RF-01** | Registrar una suscripción manualmente, con servicio, monto, ciclo y fecha de primer cobro | Alta | E4 | HU-03 |
| **RF-02** | Importar suscripciones desde archivo CSV, con vista previa y reporte de errores | Media | E4 | HU-04 |
| **RF-03** | Clasificar cada suscripción en una categoría | Baja | — | HU-11 |
| **RF-04** | Calcular la fecha del próximo cobro a partir del ciclo, y notificar con antelación configurable | **Crítica** | **E5 (76,3%)** | HU-05 |
| **RF-05** | Registrar el período de prueba y notificar antes de su término | **Crítica** | **E3, E6** | HU-06 |
| **RF-06** | Detectar alzas de precio comparando cada cobro con el anterior del mismo proveedor | Media | — | HU-07 |
| **RF-07** | Registrar el uso de un servicio, desde API externa, dispositivo o ingreso manual | Alta | E8 | HU-08 |
| **RF-08** | Calcular el costo por hora de uso de cada suscripción | Alta | E8 | HU-08 |
| **RF-09** | Generar recomendaciones de cancelación con puntaje, motivo y ahorro estimado | Alta | **E1, E2** | HU-09 |
| **RF-10** | Explicar una recomendación en lenguaje natural | Media | E9 | HU-09 |
| **RF-11** | Detectar suscripciones sin uso registrado durante un período prolongado | Alta | E1 | HU-09 |
| **RF-12** | Entregar la guía de cancelación correspondiente a cada proveedor | Media | **E10, E11** | HU-10 |
| **RF-13** | Marcar una suscripción como cancelada y registrar la fecha, el motivo y el ahorro | Media | E11 | HU-10 |
| **RF-14** | Presentar el panel de gastos con total mensual, proyección anual y próximo cobro | Alta | E7 | HU-11 |
| **RF-15** | Generar un informe de gastos por período seleccionado, exportable | Baja | — | HU-11 |
| **RF-16** | Gestionar el registro, el inicio de sesión y la sesión del usuario | Alta | — | HU-01 |
| **RF-17** | Eliminar la cuenta y todos los datos asociados de forma definitiva | Alta | Ley 21.719 | HU-02 |
| **RF-18** | Conectar y desconectar cuentas externas mediante autorización delegada | Media | E8 | HU-12 |
| **RF-19** | Configurar qué alertas se reciben, por qué canal y con cuánta antelación | Media | E5, E6 | HU-05, HU-06 |
| **RF-20** | Definir un tope de gasto mensual y notificar cuando se supera | Baja | — | HU-11 |

### Cambios respecto de la versión anterior

- **RF-09 y RF-10**, que estaban vacíos, se completan con la generación y explicación de recomendaciones — el núcleo funcional del producto
- **RF-06** tenía la descripción y el criterio intercambiados; se reescribe
- **RF-07** contenía el criterio «según el SII», que no aplica al ámbito de un consumidor individual; se elimina
- Se incorporan **RF-11 a RF-20**, que existían implícitamente en el diagrama de casos de uso pero no estaban especificados
- **Se elimina** «Detectar movimientos o cobros» en su acepción bancaria (ver capítulo 6)

---

# 5. Requisitos no funcionales

Cada requisito conserva su objetivo original y suma una **métrica verificable dentro del alcance del proyecto**. La distinción es deliberada: el objetivo declara la aspiración de diseño; la métrica es lo que se demuestra en la entrega.

| ID | Requisito | Objetivo declarado | Métrica verificable en esta versión |
|---|---|---|---|
| **RNF-01** | Rendimiento de sincronización | Menos de 30 s por cuenta conectada | Sincronización de una cuenta de correo con 200 mensajes en menos de 30 s, medida en el entorno de desarrollo |
| **RNF-02** | Disponibilidad | 99,5% mensual | **No verificable en esta versión.** Se declara como objetivo de diseño; la infraestructura del proyecto no permite medirlo |
| **RNF-03** | Cifrado de datos | Cifrado en reposo y TLS 1.2+ | Los tokens de conectores se almacenan cifrados; se demuestra inspeccionando la base de datos |
| **RNF-04** | Escalabilidad horizontal | Agregar workers sin degradar | Se demuestra levantando una segunda réplica del worker y verificando el reparto de tareas |
| **RNF-05** | Usabilidad del panel | Carga en menos de 3 s en gama media | Panel con 50 suscripciones cargadas en menos de 2 s, medido con las herramientas del navegador |
| **RNF-06** | Precisión del motor de detección | Falsos positivos bajo 10% | Conjunto de prueba de 50 correos etiquetados a mano; se reporta la tasa obtenida |
| **RNF-07** | Mantenibilidad de conectores | Agregar un conector sin tocar el núcleo | Los conectores implementan una interfaz común; se demuestra con el código de los tres existentes |
| **RNF-08** | Portabilidad multiplataforma | Android e iOS desde una base de código | **Ajustado: solo Android.** La distribución en iOS requiere cuenta de pago, fuera del presupuesto (ADR-006) |
| **RNF-09** | Capacidad de la API de IA | Umbral de respuesta bajo carga | **Tope de consumo por usuario**, definido y aplicado. Se demuestra con el límite configurado |
| **RNF-10** | Cumplimiento normativo | Normativa vigente del país | **Ley 21.719**, vigente desde el 1 de diciembre de 2026: minimización, derechos ARCO, eliminación definitiva y notificación de vulneraciones en 72 horas |
| **RNF-11** | Recuperación ante fallos | Restaurar en 1 h sin perder 24 h de datos | **No verificable en esta versión.** Objetivo de diseño; requiere réplicas y respaldos fuera del alcance |
| **RNF-12** | Concurrencia | 1.000 usuarios simultáneos | **No verificable en esta versión.** Objetivo de diseño; no se contemplan pruebas de carga |
| **RNF-13** | Retención de registros de auditoría | Sin pérdida durante la vida de la cuenta | Los cambios automáticos quedan registrados con marca de tiempo; se demuestra consultando la tabla |
| **RNF-14** | Formato regional | Montos y fechas según la configuración del dispositivo | Se demuestra cambiando el idioma del dispositivo y verificando el formato |
| **RNF-15** | Compatibilidad de navegadores | Últimas dos versiones estables | Se verifica en las dos versiones vigentes de un navegador basado en Chromium y uno en Gecko |
| **RNF-16** | Resiliencia ante fallos de terceros | Degradación controlada | Se demuestra desconectando una API externa: el sistema muestra el último dato con su marca de tiempo y no bloquea el resto |
| **RNF-17** | Consistencia entre módulos | Sin discrepancias mayores a la última sincronización | Se demuestra comparando el panel y el informe tras una sincronización |
| **RNF-18** | Facilidad de prueba | Cada módulo probable de forma aislada | Cada servicio ejecuta su suite de pruebas sin los demás levantados |
| **RNF-19** | Confidencialidad del historial | Acceso restringido a la propia cuenta | **Pruebas automatizadas de aislamiento**: un usuario no puede ver, editar ni eliminar datos de otro por ningún medio de la API (ADR-004) |
| **RNF-20** | Costo operativo por usuario | Margen mensual definido | Tope de llamadas a la API de IA por usuario y por mes, aplicado en el código |

### Las tres advertencias

⚠️ **RNF-02, RNF-11 y RNF-12 no se pueden medir en este proyecto.** Se conservan como objetivos de diseño y se declara explícitamente que no fueron verificados. Presentarlos como cumplidos sin evidencia es lo que un evaluador con criterio va a cuestionar.

⚠️ **RNF-08 cambió de alcance.** El documento anterior comprometía Android e iOS; el ADR-006 restringe la entrega a Android por el costo de la cuenta de desarrollador de Apple. Debe corregirse en ambos documentos.

⚠️ **RNF-09 y RNF-20 requieren un mecanismo, no una aspiración.** Cada conversación con el asistente consume tokens que se pagan. Sin un tope por usuario aplicado en el código, un solo usuario puede generar un gasto desproporcionado.

---

# 6. Alcance excluido

Se documenta lo que **no** se construye y por qué. Un alcance recortado y justificado se evalúa mejor que uno prometido y no cumplido.

| Excluido | Motivo | Referencia |
|---|---|---|
| **Sincronización de movimientos bancarios** | La agregación bancaria exige un mínimo de 6,5 UF mensuales (≈ $316.000). El Sistema de Finanzas Abiertas de la Ley Fintech no entra en operación hasta julio de 2027 | ADR-005 |
| **Distribución en iOS** | Requiere cuenta de Apple Developer de costo anual, no contemplada en el presupuesto | ADR-006 |
| **Aplicación para televisor** | Solo el 21,1% de los encuestados la usaría en ese dispositivo | E15 |
| **Gestión de gastos compartidos entre integrantes** | El 57,9% comparte suscripciones, pero solo el 28% de ellos reporta conflictos: no es el problema principal | E13 |

Los cuatro se documentan como **trabajo futuro**, y el primero con fecha conocida.

---

# 7. Matriz de trazabilidad

Cada requisito funcional se rastrea hacia la historia que lo origina, la evidencia que lo justifica y el requisito no funcional que lo condiciona.

| RF | Historia | Evidencia | RNF que lo condiciona |
|---|---|---|---|
| RF-01 | HU-03 | E4 | RNF-05, RNF-14 |
| RF-02 | HU-04 | E4 | RNF-05 |
| RF-03 | HU-11 | — | — |
| RF-04 | HU-05 | **E5** | RNF-02, RNF-13 |
| RF-05 | HU-06 | **E3, E6** | RNF-02, RNF-13 |
| RF-06 | HU-07 | — | RNF-06 |
| RF-07 | HU-08 | E8 | RNF-01, RNF-16 |
| RF-08 | HU-08 | E8 | RNF-17 |
| RF-09 | HU-09 | **E1, E2** | RNF-06, RNF-17 |
| RF-10 | HU-09 | E9 | RNF-09, RNF-16, RNF-20 |
| RF-11 | HU-09 | E1 | RNF-06 |
| RF-12 | HU-10 | E10, E11 | — |
| RF-13 | HU-10 | E11 | RNF-13 |
| RF-14 | HU-11 | E7 | RNF-05, RNF-15, RNF-17 |
| RF-15 | HU-11 | — | RNF-14 |
| RF-16 | HU-01 | — | RNF-03, RNF-19 |
| RF-17 | HU-02 | Ley 21.719 | RNF-10 |
| RF-18 | HU-12 | E8 | RNF-01, RNF-03, RNF-07, RNF-16 |
| RF-19 | HU-05, HU-06 | E5, E6 | — |
| RF-20 | HU-11 | — | — |

**Verificación de completitud:** los veinte requisitos funcionales se originan en alguna historia de usuario, y las doce historias derivan en al menos un requisito. No hay requisitos huérfanos ni historias sin implementación.

---

# 8. Pendiente de resolver

Este documento **no** puede cerrarse hasta que el equipo resuelva dos puntos del documento de conflictos:

**C-01 · La numeración de casos de uso.** Este documento referencia los casos de uso por nombre, no por identificador, porque existen dos numeraciones incompatibles. Una vez fijada, hay que agregar la columna de casos de uso a la matriz de trazabilidad.

**C-03 · Usuario individual u hogar.** Este documento asume **usuario individual**, que es lo que refleja el diagrama de casos de uso del equipo. Si se opta por el modelo de hogar, hay que incorporar las historias de gestión de integrantes y reparto de gastos, hoy en alcance excluido.
