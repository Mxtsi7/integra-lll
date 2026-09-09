# Matriz de trazabilidad

## 1. Propósito

Este documento establece las relaciones verificables entre las historias de usuario, los casos de uso, los requisitos funcionales, los requisitos no funcionales y los casos de prueba del proyecto **Ojo al Gasto**.

La trazabilidad cumple tres funciones concretas:

- **Hacia adelante** (requisito → diseño → prueba): permite comprobar que todo requisito acordado tiene una implementación prevista y una prueba que lo verifica.
- **Hacia atrás** (requisito → fuente): permite responder de dónde salió cada requisito, quién lo pidió y qué evidencia lo respalda.
- **Análisis de impacto**: permite determinar, cuando un requisito cambia, qué otros elementos quedan afectados.

Esta matriz no es un anexo decorativo. Su elaboración detectó siete inconsistencias reales del modelo de requisitos, listadas en la sección 10.

## 2. Documentos de referencia

| Documento | Versión | Aporta a esta matriz |
|---|---|---|
| Modelado de requisitos del proyecto Ojo al Gasto | Vigente | HU-01 a HU-05, RF-01 a RF-20, RNF-01 a RNF-20 |
| Diagrama de casos de uso (UML) | Vigente | Los casos de uso, hasta ahora sin identificador |
| Informe de validación de la problemática | 22-08-2026 | Evidencia empírica E1 a E16 (n = 38) |
| ADR-005, origen de los datos de cobros | Aceptada | Restricción sobre la conexión bancaria |
| Documento de conflictos y decisiones | Vigente | Conflictos abiertos C-01 y C-03; tabla R-01 a R-10 de valores propuestos pendientes de ratificación (5-09), citada por las secciones 5.2, 11 y 12 |

## 3. Notación

| Símbolo | Significado |
|---|---|
| **HU-nn** | Historia de usuario |
| **CU-nn** | Caso de uso |
| **RF-nn** | Requisito funcional |
| **RNF-nn** | Requisito no funcional |
| **TC-nn** | Caso de prueba funcional, derivado de un criterio de aceptación |
| **PNF-nn** | Prueba de verificación de un requisito no funcional |
| **E-nn** | Hallazgo del estudio de validación (n = 38) |
| ⚠ | Elemento con una inconsistencia declarada en la sección 10 |
| ✗ | Elemento sin cobertura |

**Prioridad.** Se emplea la escala MoSCoW (Must, Should, Could) derivada de dos variables medidas en el estudio de validación: la demanda declarada por los encuestados y la prevalencia del problema que el requisito resuelve. El criterio completo está en el informe de validación.

---

# 4. Catálogo de casos de uso

## 4.1 Por qué se numeran ahora

El diagrama de casos de uso vigente **no asigna identificadores**. Sin embargo, el documento de requisitos ya cita diez casos de uso por número: CU-02, CU-04, CU-08, CU-12, CU-13, CU-15, CU-27, CU-28, CU-29 y CU-30.

Es decir: el documento referencia identificadores que no existen en ninguna parte. Esa es la causa raíz de que la trazabilidad haya sido evaluada como débil, y no puede construirse una matriz sin resolverlo primero.

La numeración que sigue se derivó del diagrama actual y se ajustó de modo que **las diez referencias ya escritas resuelvan correctamente**. La verificación está en la sección 4.4. En consecuencia, no hay que corregir ninguna cita existente: basta con rotular el diagrama.

## 4.2 Casos de uso con actor humano

| ID | Caso de uso | Actor | Relación |
|---|---|---|---|
| CU-01 | Registrar usuario | Usuario no autenticado | — |
| CU-02 | Iniciar sesión | Usuario no autenticado | — |
| CU-03 | Gestionar perfil | Usuario autenticado | — |
| CU-04 | Eliminar cuenta y datos | Usuario autenticado | extiende CU-03 |
| CU-05 | Recuperar contraseña ★ | Usuario no autenticado | — |
| CU-06 | Registrar suscripción manualmente | Usuario autenticado | — |
| CU-07 | Editar suscripción | Usuario autenticado | — |
| CU-08 | Visualizar panel de suscripciones | Usuario autenticado | — |
| CU-09 | Visualizar calendario de pagos | Usuario autenticado | — |
| CU-10 | Marcar suscripción como cancelada | Usuario autenticado | extiende CU-07 |
| CU-11 | Eliminar suscripción | Usuario autenticado | extiende CU-07 |
| CU-12 | Vincular cuenta bancaria y sincronizar movimientos ⚠ | Usuario autenticado | — |
| CU-13 | Vincular cuenta de correo y sincronizar facturas | Usuario autenticado | — |
| CU-14 | Importar suscripciones desde archivo | Usuario autenticado | — |
| CU-15 | Interactuar con el asistente financiero | Usuario Premium | — |
| CU-16 | Solicitar recomendación de cancelación | Usuario Premium | extiende CU-15 |
| CU-17 | Explicar una recomendación | Usuario Premium | extiende CU-15 |
| CU-18 | Adquirir y gestionar el plan Premium | Usuario autenticado | — |
| CU-19 | Visualizar historial de ahorro ⚠ | Usuario autenticado | — |
| CU-20 | Configurar alertas ⚠ | Usuario autenticado | — |
| CU-21 | Definir presupuesto ideal | Usuario autenticado | — |
| CU-22 | Registrar uso manual | Usuario autenticado | — |
| CU-23 | Vincular rastreo automático de tiempo de uso | Usuario autenticado | — |
| CU-24 | Confirmar estado de suscripción dudosa | Usuario autenticado | — |
| CU-25 | Consultar guía de cancelación ★ | Usuario autenticado | extiende CU-10 |
| CU-26 | Exportar historial de gastos | Usuario autenticado | — |

★ Caso de uso **que falta en el diagrama** y que debe agregarse: ambos están exigidos por un requisito funcional vigente. CU-05 lo exige RF-01 y CU-25 lo exige RF-16.

## 4.3 Casos de uso con actor Sistema

Se ejecutan sin interacción directa del usuario. Los tres primeros son tareas programadas.

| ID | Caso de uso | Disparador |
|---|---|---|
| CU-27 | Notificar próximo cobro | Programado, diario |
| CU-28 | Notificar fin de prueba gratuita | Programado, diario |
| CU-29 | Transitar suscripción post-trial a estado activo | Programado, diario |
| CU-30 | Detectar y notificar anomalías de cobro | Evento: cobro nuevo |
| CU-31 | Detectar suscripción fantasma | Programado |
| CU-32 | Cancelar suscripción por inactividad extendida ⚠ | Programado |
| CU-33 | Reactivar suscripción automáticamente ⚠ | Programado |
| CU-34 | Clasificar gasto recurrente variable | Evento: cobro nuevo |
| CU-35 | Sanitizar datos personales (PII) | Evento: ingesta |
| CU-36 | Limitar ingesta de documentos | Evento: ingesta |

## 4.4 Verificación de compatibilidad

Las diez referencias ya escritas en el documento de requisitos resuelven sin necesidad de editarlas:

| Cita existente | Dónde aparece | Resuelve a | Coherente |
|---|---|---|---|
| CU-02 | HU-01 | Iniciar sesión | Sí |
| CU-04 | RNF-10 | Eliminar cuenta y datos | Sí |
| CU-08 | HU-04, RNF-05 | Visualizar panel de suscripciones | Sí |
| CU-12 | HU-02, RNF-01 | Vincular cuenta bancaria | Sí |
| CU-13 | RNF-01 | Vincular cuenta de correo | Sí |
| CU-15 | HU-05 | Interactuar con el asistente financiero | Sí |
| CU-27, CU-28, CU-29 | RNF-02 | Las tres tareas programadas | Sí |
| CU-30 | HU-03, RNF-06 | Detectar y notificar anomalías de cobro | Sí |

## 4.5 Caso de uso retirado del diagrama

**Búsqueda avanzada de ofertas.** Aparece en el diagrama como extensión del asistente financiero, pero ningún requisito funcional la describe y no figura en el alcance del proyecto. Comparar precios de servicios de terceros exige una fuente de datos de tarifas que el proyecto no tiene.

Hay que decidir una de dos cosas, y la matriz no puede cerrarse mientras no se decida:

- **Escribirle un RF-21** que la especifique, junto con el origen de los datos de tarifas; o bien
- **retirarla del diagrama**, que es la opción recomendada.

---

# 5. Catálogo de casos de prueba

## 5.1 Pruebas funcionales

Cada caso de prueba deriva de un criterio de aceptación ya escrito en el documento de requisitos. Los criterios redactados en formato Dado / Cuando / Entonces se convierten en prueba de forma directa.

| ID | Verifica | Descripción resumida | Tipo |
|---|---|---|---|
| TC-01 | RF-01.2 | Con credenciales válidas, el ingreso lleva al panel | Positiva |
| TC-02 | RF-01.2 | Con credenciales inválidas, el mensaje no revela qué dato falló | Negativa |
| TC-03 | RF-01.4 | La recuperación de contraseña envía un enlace de un solo uso válido por 60 minutos | Positiva |
| TC-04 | RF-01.7 | Tras confirmar la eliminación con identidad verificada, las sesiones quedan revocadas de inmediato y la cuenta no autentica; cumplidas 72 horas, ninguna consulta ni exportación de la aplicación devuelve datos personales del titular | Positiva |
| TC-05 | RF-02 | Con nombre, monto mayor a 0, frecuencia y fecha válidos, la suscripción queda activa | Positiva |
| TC-06 | RF-02 | Con prueba gratuita marcada sin fecha de término, el registro se rechaza | Negativa |
| TC-07 | RF-02 | Con monto igual o menor a 0, el registro se rechaza | Negativa |
| TC-08 | RF-03 | Transición prueba a activa. **Bloqueada: falta la regla** | Estado |
| TC-09 | RF-03 | Transición activa a dudosa. **Bloqueada: falta la regla** | Estado |
| TC-10 | RF-03 | Transición activa a fantasma por falta de uso. **Bloqueada: falta el umbral** | Estado |
| TC-11 | RF-03 | Transición de reactivación. **Bloqueada: no está definida** | Estado |
| TC-12 | RF-04 | Registrar que sí la usó hoy deja la fecha de último uso en hoy | Positiva |
| TC-13 | RF-04 | No se puede registrar uso sobre una suscripción de otra cuenta | Seguridad |
| TC-14 | RF-05 | Un CSV con 5 filas válidas y 2 sin monto crea exactamente 5 registros | Positiva |
| TC-15 | RF-05 | Un archivo con formato incorrecto se rechaza indicando el formato esperado | Negativa |
| TC-16 | RF-05 | Un candidato descartado no se persiste en panel ni historial | Positiva |
| TC-17 | RF-05 | Al revocar el correo se eliminan tokens y cobros de origen exclusivo correo | Seguridad |
| TC-18 | RF-06 | Una categoría del catálogo queda persistida y agrupa en el resumen | Positiva |
| TC-19 | RF-06 | Un valor fuera del catálogo se rechaza | Negativa |
| TC-20 | RF-07 | Con historial de 10.000 tres veces, un cobro de 10.600 genera alza de tarifa | Positiva |
| TC-21 | RF-07 | Dos cargos del mismo servicio a tres días de distancia generan posible doble cobro | Positiva |
| TC-22 | RF-07 | El primer cobro de una suscripción no genera alza de tarifa | Límite |
| TC-23 | RF-07 | Marcar una alerta como revisada no altera el estado de la suscripción | Positiva |
| TC-24 | RF-08 | Al cambiar el monto, el panel muestra el nuevo valor y los cobros pasados no cambian | Positiva |
| TC-25 | RF-08 | Editar una suscripción de otra cuenta se rechaza | Seguridad |
| TC-26 | RF-09 | Con anticipación de 3 días y prueba que termina el día 10, el día 7 existe la alerta | Positiva |
| TC-27 | RF-09 | Desactivar la alerta de próximo cobro impide que se genere | Negativa |
| TC-28 | RF-09 | Sin dispositivo con push, la alerta llega igual por correo | Alternativa |
| TC-29 | RF-10 | Una suscripción cancelada sale de activas y aparece en el historial de ahorro | Positiva |
| TC-30 | RF-10 | Al eliminarla, desaparece del panel pero los cobros históricos permanecen | Positiva |
| TC-31 | RF-10 | Sin confirmación del usuario, el registro no cambia | Negativa |
| TC-32 | RF-11 | Tres activas de 9.990, 5.000 y 12.000 dan un total de 26.990 | Positiva |
| TC-33 | RF-11 | Un usuario no ve las suscripciones de otro | Seguridad |
| TC-34 | RF-11 | Sin suscripciones, los totales son 0 y se ofrece registrar la primera | Límite |
| TC-35 | RF-11 | Con más de una moneda, el total se desglosa en vez de sumarse | Alternativa |
| TC-36 | RF-12 | Una mensual activa con cobro el día 12 aparece ese día con servicio y monto | Positiva |
| TC-37 | RF-12 | Una suscripción cancelada no genera evento futuro en el calendario | Negativa |
| TC-38 | RF-13 | Presupuesto 20.000 y proyectado 26.990 muestra exceso de 6.990 y genera alerta | Positiva |
| TC-39 | RF-14 | Una mensual de 9.990 cancelada hace 3 meses arroja un ahorro de 29.970 | Positiva |
| TC-40 | RF-15 | El CSV exportado contiene los cobros del período y las columnas declaradas | Positiva |
| TC-41 | RF-15 | Sin cobros en el período, el archivo entrega solo los encabezados | Límite |
| TC-42 | RF-16 | Un servicio con guía conocida muestra pasos ordenados y al menos un enlace | Positiva |
| TC-43 | RF-16 | Sin guía específica se muestra una guía genérica, no un error vacío | Alternativa |
| TC-44 | RF-17 | Con pago confirmado, el plan pasa a Premium y el chat queda habilitado | Positiva |
| TC-45 | RF-17 | Con pago rechazado, el plan permanece gratuito y se informa el error | Negativa |
| TC-46 | RF-17 | Al cancelar la renovación, conserva Premium hasta el fin del período pagado | Positiva |
| TC-47 | RF-18 | Un usuario Premium con Netflix a 9.990 recibe ese monto en la respuesta | Positiva |
| TC-48 | RF-18 | En plan gratuito el chat no responde y se ofrece Premium | Negativa |
| TC-49 | RF-18 | La explicación de una recomendación menciona la ausencia de uso y el monto | Positiva |
| TC-50 | RF-19 | La previsualización marca cada fila como válida o inválida con su motivo | Positiva |
| TC-51 | RF-20 | Solicitar el identificador de una suscripción ajena devuelve no autorizado | Seguridad |
| TC-52 | RF-20 | Al listar cualquier recurso, el usuario solo ve los suyos | Seguridad |
| TC-53 | RF-01.1 | Con correo no registrado, contraseña que cumple la política y consentimiento marcado, la cuenta se crea y puede iniciar sesión | Positiva |
| TC-54 | RF-01.1 | Con un correo ya registrado, el registro se rechaza y no se crea una cuenta duplicada | Negativa |
| TC-55 | RF-01.1 | Con una contraseña que no cumple la política, el registro se rechaza indicando la política exigida | Negativa |
| TC-56 | RF-01.1 | Sin el consentimiento marcado, el registro se rechaza y no se persiste ningún dato del formulario | Negativa |
| TC-57 | RF-01.1 | Tras un registro exitoso queda almacenado el consentimiento con fecha, hora y versión del texto aceptado | Positiva |
| TC-58 | RF-01.3 | Con autorización de Google concedida para una cuenta existente, el ingreso lleva al panel | Positiva |
| TC-59 | RF-01.3 | Con autorización de Google cancelada o denegada, no se crea sesión y se informa en la pantalla de login | Negativa |
| TC-60 | RF-01.3 | Con un correo de Google sin cuenta asociada, se ofrece completar el registro y no se crea la cuenta sin consentimiento | Alternativa |
| TC-61 | RF-01.4 | Un enlace de restablecimiento expirado o ya utilizado se rechaza y se ofrece solicitar uno nuevo | Negativa |
| TC-62 | RF-01.4 | Con un correo no registrado, la respuesta es idéntica a la de un correo registrado y no se envía ningún enlace | Seguridad |
| TC-63 | RF-01.4 | Tras un restablecimiento exitoso, la contraseña anterior no autentica y la nueva sí | Positiva |
| TC-64 | RF-01.5 | Con identidad confirmada y contraseña nueva que cumple la política, la nueva autentica y la anterior no | Positiva |
| TC-65 | RF-01.5 | Un cambio de correo o contraseña sin confirmación de identidad se rechaza y el dato no cambia | Negativa |
| TC-66 | RF-01.5 | El correo nuevo queda activo solo tras abrir su enlace de verificación y el correo anterior recibe aviso del cambio | Positiva |
| TC-67 | RF-01.5 | Un correo nuevo que ya pertenece a otra cuenta se rechaza | Negativa |
| TC-68 | RF-01.6 | Al cerrar sesión vuelve a la pantalla de login y no accede al dashboard sin autenticarse de nuevo | Positiva |
| TC-69 | RF-01.6 | El token de una sesión cerrada recibe "no autorizado" del gateway a más tardar 60 segundos después del cierre | Seguridad |
| TC-70 | RF-01.7 | Un registro de auditoría consultado tras la eliminación no contiene correo, nombre ni identificador que permita reidentificar al titular | Seguridad |
| TC-71 | RF-01.7 | Un registro anonimizado cuya fecha de eliminación de cuenta supera los 12 meses ya no existe | Límite |
| TC-72 | RF-01.7 | Sin confirmación de identidad, o si el usuario cancela, la cuenta y sus datos no cambian | Negativa |
| TC-73 | RF-09 | Con la alerta de alza de tarifa desactivada, una anomalía detectada no se notifica por ningún canal, pero sigue visible en el panel | Negativa |

## 5.2 Pruebas de requisitos no funcionales

| ID | Verifica | Procedimiento | Estado |
|---|---|---|---|
| PNF-01 | RNF-01 | Medir el tiempo de sincronización por cuenta conectada | ⚠ Falta definir carga normal |
| PNF-02 | RNF-02 | Medición mensual de disponibilidad sobre el endpoint de salud | ⚠ Falta definir punto y ventana |
| PNF-03a | RNF-03a | Inspección del cifrado en reposo: consulta SQL a la tabla de tokens y configuración de cifrado del volumen | Ejecutable |
| PNF-03b | RNF-03b | Escaneo TLS del gateway (testssl.sh o sslyze) e inspección de la configuración de despliegue | Ejecutable |
| PNF-04a | RNF-04a | Levantar una segunda réplica de worker con tareas encoladas y verificar el consumo compartido de la cola | Ejecutable |
| PNF-04b | RNF-04b | Comparar lotes de 200 tareas / 1 worker y 400 tareas / 2 workers; se acepta si T2 ≤ 1,1 × T1 | Ejecutable (valores por ratificar) |
| PNF-05a | RNF-05a | Percentil 95 del tiempo de carga del panel: 20 cargas, cuenta de 50 suscripciones, dispositivo de gama media definido | Ejecutable (valores por ratificar) |
| PNF-05b | RNF-05b | Prueba con al menos 5 usuarios nuevos sin tutorial: el 80% identifica las tres cifras en 3 minutos (redondeo hacia arriba) | Ejecutable (valores por ratificar) |
| PNF-06 | RNF-06 | Tasa de falsos positivos sobre un conjunto de validación | ⚠ Falta el conjunto y la periodicidad |
| PNF-07 | RNF-07 | Revisión del diff del conector nuevo (0 líneas modificadas en auth, subscriptions, analytics, notifications, gateway y el código existente de connectors) y registro de esfuerzo ≤ 5 días-persona | Ejecutable |
| PNF-08a | RNF-08a | Batería funcional móvil en emulador API 29, última API estable y dispositivo físico de referencia; incluye RNF-05a | Ejecutable |
| PNF-08b | RNF-08b | Inspección del repositorio: un único proyecto móvil y APK construido desde él | Ejecutable |
| PNF-09 | RNF-09 | Prueba de carga: 50 solicitudes de chat concurrentes durante 10 minutos; promedio ≤ 2,5 s, p95 ≤ 4 s, errores < 1%; válida solo si las respuestas predeterminadas de RN-24 son ≤ 10% | Ejecutable |
| PNF-10 | RNF-10 | Auditoría de retención y eliminación frente a la Ley 21.719, contrastando el registro de actividades de tratamiento con la tabla de retención de RF-01.7 | Ejecutable |
| PNF-11 | RNF-11 | Simulacro de caída y restauración | Ejecutable |
| PNF-12 | RNF-12 | Prueba de carga con 1.000 usuarios concurrentes | ⚠ Falta definir degradación perceptible |
| PNF-13 | RNF-13 | Verificar la integridad de los registros durante la vida de la cuenta y, tras la eliminación, la anonimización a las 72 horas y la purga de los registros anonimizados con fecha de eliminación mayor a 12 meses | Ejecutable |
| PNF-14a | RNF-14a | Cambiar la configuración regional de es-CL a en-US y verificar montos y fechas | Ejecutable |
| PNF-14b | RNF-14b | Región no usada en desarrollo (pt-BR) con git diff vacío, más revisión estática de formatos codificados | Ejecutable |
| PNF-15 | RNF-15 | Batería de humo (TC-32 a TC-35 y TC-50) en las dos últimas versiones estables de Chrome, Edge, Firefox y Safari, en cuatro viewports | Ejecutable |
| PNF-16 | RNF-16 | Simular la caída de un conector y verificar la degradación controlada | Ejecutable |
| PNF-17 | RNF-17 | Comparar cifras entre panel, calendario y chat tras una sincronización | ⚠ Falta el modelo de consistencia |
| PNF-18 | RNF-18 | Ejecutar las pruebas de un módulo con los demás detenidos | Ejecutable |
| PNF-19 | RNF-19 | Inspección estática del filtro de tenant (mecanismo de `shared/tenant`, herencia de la clase base o equivalente documentado), suite de aislamiento en la integración continua y verificación del registro de intentos (reutiliza el escenario de TC-51) | Ejecutable |
| PNF-20 | RNF-20 | Planilla mensual: costo total (infra + APIs) / usuarios activos ≤ US$ 0,10, con usuarios activos contados sobre el registro de última actividad de auth; tope individual de US$ 0,50 verificado con el contador de llamadas | Ejecutable |

---

# 6. Matriz principal

Vista por requisito funcional. Es la vista de referencia: contiene los atributos que permiten responder de dónde salió cada requisito, qué lo condiciona y cómo se comprueba.

| RF | Requisito | Fuente | Prioridad | HU | CU | RNF | Pruebas |
|---|---|---|---|---|---|---|---|
| RF-01 | Gestionar cuenta y sesión (agrupador de RF-01.1 a RF-01.7) | HU-01, Ley 21.719 | Must | HU-01 | CU-01 a CU-05 | RNF-03, RNF-10 | Ver sub-requisitos |
| RF-01.1 | Registrar cuenta | Ley 21.719, derivado de RF-01 | Must | ✗ | CU-01 | RNF-03, RNF-10 | TC-53 a TC-57 |
| RF-01.2 | Iniciar sesión con correo y contraseña | HU-01 | Must | HU-01 | CU-02 | RNF-03 | TC-01, TC-02 |
| RF-01.3 | Iniciar sesión con Google | HU-01 | Must | HU-01 | CU-02 | RNF-03, RNF-10 | TC-58 a TC-60 |
| RF-01.4 | Recuperar contraseña | Derivado de RF-01 | Must | ✗ | CU-05 | RNF-03 | TC-03, TC-61 a TC-63 |
| RF-01.5 | Actualizar correo o contraseña | Derivado de RF-01 | Must | ✗ | CU-03 | RNF-03 | TC-64 a TC-67 |
| RF-01.6 | Cerrar sesión | Derivado de RF-01 | Must | ✗ | ✗ sin CU en el catálogo | RNF-03 | TC-68, TC-69 |
| RF-01.7 | Eliminar cuenta y datos personales | Ley 21.719 | Must | ✗ | CU-04 | RNF-03, RNF-10, RNF-13 | TC-04, TC-70 a TC-72 |
| RF-02 | Registrar suscripción manualmente | E4, E15 | Must | ✗ | CU-06 | RNF-05, RNF-14 | TC-05 a TC-07 |
| RF-03 | Gestionar ciclo de vida ⚠ | E1, E3 | Must | ✗ | CU-24, CU-29, CU-31, CU-32, CU-33 | RNF-13 | TC-08 a TC-11 ⚠ |
| RF-04 | Registrar y detectar uso | E8, E1 | Must | ✗ | CU-22, CU-23 | RNF-16, RNF-17 | TC-12, TC-13 |
| RF-05 | Detectar cobros desde fuentes externas ⚠ | E4, ADR-005 | Should | HU-02 ⚠ | CU-13, CU-14, CU-35, CU-36 | RNF-01, RNF-03, RNF-10, RNF-16 | TC-14 a TC-17 |
| RF-06 | Clasificar el gasto por categoría | E7 | Should | ✗ | CU-34 | RNF-17 | TC-18, TC-19 |
| RF-07 | Detectar cambios de precio y anomalías | HU-03, E1 | Should | HU-03 | CU-30 | RNF-06, RNF-16 | TC-20 a TC-23 |
| RF-08 | Editar suscripción | Derivado de RF-02 | Must | ✗ | CU-07 | RNF-17 | TC-24, TC-25 |
| RF-09 | Configurar y emitir alertas | **E5 76,3%**, **E6 60,5%** | Must | HU-03 | CU-20, CU-27, CU-28 | RNF-02, RNF-16 | TC-26 a TC-28, TC-73 |
| RF-10 | Eliminar o cancelar suscripción | E11 | Must | ✗ | CU-10, CU-11 | RNF-13 | TC-29 a TC-31 |
| RF-11 | Visualizar panel de suscripciones | HU-04, E7 | Must | HU-04 | CU-08 | RNF-05, RNF-12, RNF-15, RNF-17 | TC-32 a TC-35 |
| RF-12 | Visualizar calendario de pagos | E5 | Should | ✗ | CU-09 | RNF-05, RNF-17 | TC-36, TC-37 |
| RF-13 | Definir presupuesto ideal y alertar exceso | Decisión del Product Owner | Could | ✗ | CU-21 | RNF-14 | TC-38 |
| RF-14 | Visualizar historial de ahorro | Decisión del Product Owner | Could | ✗ | CU-19 | RNF-14 | TC-39 |
| RF-15 | Exportar historial de gastos | Derivado, portabilidad de datos | Could | ✗ | CU-26 | RNF-14, RNF-19 | TC-40, TC-41 |
| RF-16 | Consultar guía de cancelación | **E11 36,8%**, E10, E12 | Should | ✗ | CU-25 | — | TC-42, TC-43 |
| RF-17 | Adquirir y gestionar el plan Premium | **E14 73,7%** | Should | ✗ | CU-18 | RNF-10 | TC-44 a TC-46 |
| RF-18 | Recomendaciones y chat del asistente | HU-05, **E1 68,4%**, E9 | Should | HU-05 | CU-15, CU-16, CU-17 | RNF-09, RNF-16, RNF-20 | TC-47 a TC-49 |
| RF-19 | Importar desde archivo con previsualización | E15, derivado de RF-05 | Should | ✗ | CU-14 | RNF-15 | TC-50 |
| RF-20 | Aislar datos por cuenta | Ley 21.719, seguridad | Must | ✗ | Transversal | RNF-03, RNF-10, RNF-19 | TC-51, TC-52 |

**Distribución de prioridades:** 9 Must, 8 Should, 3 Could. Los nueve Must constituyen la definición del producto mínimo viable.

# 7. Vista por historia de usuario

Es la vista que exige la especificación: HU, CU, RF, RNF y prueba.

| HU | Historia | CU | RF | RNF | Pruebas |
|---|---|---|---|---|---|
| HU-01 | Iniciar sesión de forma segura | CU-02 | RF-01.2, RF-01.3 | RNF-03, RNF-10 | TC-01, TC-02, TC-58 |
| HU-02 | Vincular cuenta bancaria ⚠ | CU-12 ⚠ | **ninguno** ✗ | RNF-01, RNF-16 | ✗ |
| HU-03 | Ser alertado de alzas de tarifa y posibles dobles cobros | CU-30 | RF-07, RF-09 | RNF-06 | TC-20 a TC-23, TC-28 |
| HU-04 | Visualizar el panel | CU-08 | RF-11 | RNF-05, RNF-12 | TC-32 a TC-35 |
| HU-05 | Interactuar con el asistente financiero | CU-15 | RF-17, RF-18 | RNF-09 | TC-44, TC-47 a TC-49 |

**Cobertura:** 4 de 5 historias derivan en al menos un requisito funcional. HU-02 no tiene ninguno, y ese vacío se analiza en la sección 10.

**Nota sobre la fila HU-03.** La marca ⚠ que acompañaba a esta fila correspondía a la observación del docente sobre el actor de la historia («Como sistema, quiero detectar y notificar anomalías...», evaluación SWEBOK, sección 1) y quedó resuelta con la reescritura de HU-03 con actor Usuario autenticado, por lo que se retira. La sección 10 no declaraba ninguna entrada para esta marca; si el autor de la matriz la registró por otro motivo, debe reponerla y declararlo allí. La fila además deja de listar TC-26, que verifica la alerta de fin de prueba gratuita (RF-09, primer criterio) y no deriva de esta historia; TC-26 mantiene su trazabilidad en la fila RF-09 de la sección 6.

# 8. Vista por requisito no funcional

Muestra qué requisitos funcionales condiciona cada RNF. Un RNF que no condiciona nada es un RNF sin destinatario.

| RNF | Categoría | Condiciona a | Prueba |
|---|---|---|---|
| RNF-01 | Rendimiento | RF-05 | PNF-01 |
| RNF-02 | Disponibilidad | RF-09 | PNF-02 |
| RNF-03a | Seguridad (QoS, confidencialidad en reposo) | RF-01, RF-05, RF-20 | PNF-03a |
| RNF-03b | Restricción tecnológica (TLS 1.2+) | RF-01, RF-05, RF-20 | PNF-03b |
| RNF-04a | Restricción tecnológica (escalabilidad horizontal) | Transversal, infraestructura | PNF-04a |
| RNF-04b | Elasticidad (QoS) | Transversal, infraestructura | PNF-04b |
| RNF-05a | Rendimiento (QoS) | RF-02, RF-11, RF-12 | PNF-05a |
| RNF-05b | Usabilidad (QoS) | RF-02, RF-11, RF-12 | PNF-05b |
| RNF-06 | Precisión | RF-07 | PNF-06 |
| RNF-07 | Mantenibilidad | RF-05 | PNF-07 |
| RNF-08a | Portabilidad y compatibilidad (QoS) | Transversal, cliente móvil | PNF-08a |
| RNF-08b | Restricción tecnológica (base de código única) | Transversal, cliente móvil | PNF-08b |
| RNF-09 | Capacidad | RF-18 | PNF-09 |
| RNF-10 | Cumplimiento normativo | RF-01.1, RF-01.7, RF-05, RF-17, RF-20 | PNF-10 |
| RNF-11 | Recuperabilidad | Transversal | PNF-11 |
| RNF-12 | Capacidad | RF-11 | PNF-12 |
| RNF-13 | Auditoría | RF-03, RF-10, RF-01.7 | PNF-13 |
| RNF-14a | Adaptabilidad regional (QoS) | RF-02, RF-13, RF-14, RF-15 | PNF-14a |
| RNF-14b | Mantenibilidad (QoS) | RF-02, RF-13, RF-14, RF-15 | PNF-14b |
| RNF-15 | Compatibilidad (restricción tecnológica) | RF-11, RF-19 | PNF-15 |
| RNF-16 | Resiliencia | RF-04, RF-05, RF-07, RF-09, RF-18 | PNF-16 |
| RNF-17 | Consistencia | RF-04, RF-06, RF-08, RF-11, RF-12 | PNF-17 |
| RNF-18 | Testabilidad | Transversal | PNF-18 |
| RNF-19 | Seguridad (aseguramiento del aislamiento) | RF-15, RF-20 | PNF-19 |
| RNF-20 | Costo operativo | RF-18 | PNF-20 |

# 9. Cobertura de casos de uso

Todo caso de uso debe estar respaldado por al menos un requisito funcional que lo especifique.

| CU | RF que lo especifica | CU | RF que lo especifica |
|---|---|---|---|
| CU-01 | RF-01.1 | CU-19 | RF-14 |
| CU-02 | RF-01.2, RF-01.3 | CU-20 | RF-09 |
| CU-03 | RF-01.5 | CU-21 | RF-13 |
| CU-04 | RF-01.7 | CU-22 | RF-04 |
| CU-05 | RF-01.4 | CU-23 | RF-04 |
| CU-06 | RF-02 | CU-24 | RF-03 |
| CU-07 | RF-08 | CU-25 | RF-16 |
| CU-08 | RF-11 | CU-26 | RF-15 |
| CU-09 | RF-12 | CU-27 | RF-09 |
| CU-10 | RF-10 | CU-28 | RF-09 |
| CU-11 | RF-10 | CU-29 | RF-03 |
| CU-12 | **ninguno** ✗ | CU-30 | RF-07 |
| CU-13 | RF-05 | CU-31 | RF-03 |
| CU-14 | RF-05, RF-19 | CU-32 | RF-03 |
| CU-15 | RF-18 | CU-33 | RF-03 ⚠ |
| CU-16 | RF-18 | CU-34 | RF-06 |
| CU-17 | RF-18 | CU-35 | RF-05 |
| CU-18 | RF-17 | CU-36 | RF-05 |

**Resultado:** 35 de 36 casos de uso están especificados por algún requisito funcional. CU-12 no lo está, lo que confirma el vacío detectado en HU-02.

---

# 10. Vacíos e inconsistencias detectados

La elaboración de esta matriz sacó a la luz siete problemas. Ninguno es de forma: todos afectan a la especificación.

## V-01 · HU-02 no tiene ningún requisito funcional

**Severidad alta.** HU-02 pide vincular la cuenta bancaria. El único candidato, RF-05, especifica detección por CSV, PDF de cartola y correo electrónico, nunca conexión bancaria. RNF-01 y RNF-16 sí hablan de movimientos bancarios, y CU-12 existe en el diagrama. La cadena queda rota justo en el requisito funcional.

Hay un contexto que la especificación no refleja: el ADR-005 del propio proyecto ya resolvió que la conexión bancaria no es viable en este alcance. La investigación estableció tres razones. El Sistema de Finanzas Abiertas de la Ley Fintech 21.521 no será exigible hasta julio de 2027; los agregadores comerciales tienen un costo incompatible con el proyecto; y el tratamiento de datos bancarios activa obligaciones de la Ley 21.719.

Existen por tanto dos caminos coherentes, y hay que elegir uno:

- **Camino A**, recomendado y coherente con el ADR-005: reescribir HU-02 en términos de las fuentes que sí se implementan, esto es cartola, CSV y correo; retirar CU-12; y eliminar la mención a movimientos bancarios de RNF-01, de RNF-16 y del diagrama de secuencia.
- **Camino B**: crear el RF-21 de vinculación bancaria, revertir el ADR-005 y asumir el costo del agregador.

Lo que no es sostenible es el estado actual: una historia, un caso de uso, dos requisitos no funcionales y un diagrama de secuencia que describen una funcionalidad que ningún requisito funcional especifica y que una decisión de arquitectura ya descartó.

## V-02 · RF-03 está incompleto

**Severidad alta.** El requisito conserva el texto «no entendí bien esta, revisa en txt» en lugar de su criterio de aceptación, y su descripción está vacía. Es el único requisito de los veinte en esa condición y, a la vez, el que más casos de uso gobierna: CU-24, CU-29, CU-31, CU-32 y CU-33 dependen de él. Cuatro casos de prueba, TC-08 a TC-11, están bloqueados por esta causa.

RF-03 define una máquina de estados y debe especificarse como tal, con una tabla de transición:

| Estado actual | Evento o condición | Estado resultante |
|---|---|---|
| Prueba | Llega la fecha de término de la prueba | Activa |
| Activa | Sin uso registrado durante N días | Fantasma |
| Activa | Condición por definir | Dudosa |
| Dudosa | El usuario confirma que ya no la paga | Cancelada |
| Dudosa | El usuario confirma que sigue vigente | Activa |
| Fantasma | El usuario vuelve a registrar uso | Activa |
| Cancelada | Reactivación por el usuario | Activa |

El valor de N y la condición de estado dudoso son decisiones de negocio, no técnicas: las define el Product Owner.

## V-03 · RNF-13 contradice a RF-01 — regla propuesta, pendiente de ratificación

**Severidad media.** RF-01 establecía que al eliminar la cuenta se borran de forma permanente las suscripciones, cobros, uso, chat y tokens. RNF-13 establecía que los registros de auditoría de cambios automáticos se conservan durante toda la vida de la cuenta, sin decir qué ocurre en el instante de la eliminación.

La regla explícita que faltaba quedó propuesta en RF-01.7: revocación e invalidación inmediata de sesiones y tokens, con eliminación definitiva en máximo 72 horas; eliminación definitiva de los datos personales en máximo 72 horas; anonimización irreversible de los registros de auditoría en máximo 72 horas, con purga definitiva de los registros anonimizados cuya fecha de eliminación de cuenta supere los 12 meses; conservación disociada de los comprobantes Premium por 6 años [base legal por validar]; y desaparición de los datos eliminados de las copias de respaldo en máximo 30 días. RNF-10 y RNF-13 quedaron redactados en consecuencia y PNF-13 pasó a ser ejecutable.

La regla es una propuesta del equipo de requisitos, no una decisión cerrada: la determina el requisito legal y de negocio, con la Ley 21.719 —vigente desde el 1 de diciembre de 2026— como marco aplicable. La decisión 3 de la sección 12 se cierra solo cuando el acta de la reunión la ratifique.

## V-04 · RNF-19 duplica a RF-20 — resuelto por redefinición

**Severidad baja. Cerrado.** RF-20 establece que toda consulta o cambio aplica exclusivamente a la cuenta autenticada; en su redacción original, RNF-19 volvía a decir lo mismo como requisito no funcional.

Como la numeración oficial es inmutable, en lugar de retirar el identificador se redefinió RNF-19 como una propiedad de aseguramiento distinta y verificable: aplicación del aislamiento en la capa de datos (ADR-004, `shared/tenant`), suite de pruebas de aislamiento en la integración continua y registro de los intentos de acceso cruzado. RF-20 conserva la política funcional de autorización, probada por TC-51 y TC-52; PNF-19 pasa a ser ejecutable. Esta salida recoge la mejora de bajo costo ya propuesta en el documento de conflictos —referenciar el ADR-004 y las pruebas automatizadas de `shared/tenant`—, la amplía con el registro de intentos cruzados y coincide con la alternativa que ofreció la evaluación SWEBOK: «convertirse en una propiedad de seguridad de más alto nivel».

## V-05 · CU-33 no tiene regla que lo gobierne

**Severidad media.** El diagrama incluye la reactivación automática de suscripciones y RNF-13 exige registrar los eventos de reactivación. Pero RF-03, que define el ciclo de vida, no contempla ninguna transición de reactivación. Se resuelve al completar V-02.

## V-06 · El diagrama asigna a Premium funciones que son generales

**Severidad baja.** El diagrama sitúa la configuración de alertas y el historial de ahorro bajo el actor Usuario Premium. Pero RF-09 establece que el correo siempre está disponible como canal de alertas, y RF-14 no condiciona el historial de ahorro a ningún plan.

Solo el asistente financiero y las recomendaciones son exclusivos de Premium, según RF-17 y RF-18. CU-19 y CU-20 deben quedar bajo Usuario autenticado.

## V-07 · Tres requisitos no funcionales no eran verificables — resuelto con métricas, pendiente de ratificación

**Severidad media. Resuelto el 5-09.** RNF-07, RNF-09 y RNF-20 no admitían prueba: hablaban de un tiempo «acotado», de «un umbral definido» y de «un margen definido», sin fijar ninguno. El 5-09 se les fijaron métricas medibles (R-01 a R-03 del acta de CONFLICTOS-Y-DECISIONES: ≤ 5 días-persona y 0 líneas fuera de `connectors`; 50 chats concurrentes con promedio ≤ 2,5 s y p95 ≤ 4 s; ≤ US$ 0,10 por usuario activo al mes) y PNF-07, PNF-09 y PNF-20 pasaron a ejecutables. Los valores quedan pendientes de ratificación del equipo. RNF-19, que figuraba en esta lista como el duplicado de V-04, salió de ella al resolverse V-04 por redefinición.

---

# 11. Resumen de cobertura

| Indicador | Resultado |
|---|---|
| Requisitos funcionales con fuente identificada | 20 de 20 |
| Requisitos funcionales con prioridad asignada | 20 de 20 |
| Requisitos funcionales con caso de uso asociado | 20 de 20 — RF-01.6 (cerrar sesión) hereda los CU de RF-01 pero no tiene CU propio en el catálogo |
| Requisitos funcionales con caso de prueba | 20 de 20, con RF-03 bloqueado |
| Historias de usuario con requisito funcional | 4 de 5, falta HU-02 |
| Casos de uso especificados por un requisito | 35 de 36, falta CU-12 |
| Requisitos no funcionales con prueba ejecutable | 15 de 20 — varios con valores propuestos pendientes de ratificación del equipo (ver acta de CONFLICTOS-Y-DECISIONES) |
| Requisitos no funcionales que condicionan algún RF | 20 de 20 |
| Casos de prueba definidos | 73 funcionales y 25 no funcionales |
| Casos de prueba bloqueados | 4 funcionales (TC-08 a TC-11, por RF-03) y 5 no funcionales (PNF-01, PNF-02, PNF-06, PNF-12, PNF-17) |

Los requisitos no funcionales verificables subieron de 8 a 15 de 20 con la corrección de los pendientes de la evaluación SWEBOK (RNF-07, 09, 20 con métricas; RNF-03, 04, 05, 08 y 14 desdoblados; RNF-15 acotado; RNF-19 redefinido; V-03 resuelto con la regla de retención de RF-01.7). De los cinco restantes, RNF-01 depende de la decisión V-01 (conexión bancaria) y RNF-02, RNF-06, RNF-12 y RNF-17 siguen sin valores medibles: son el siguiente trabajo de mayor rendimiento.

# 12. Decisiones que la matriz no puede tomar

Esta matriz queda abierta hasta que el equipo resuelva cinco puntos. Los cinco son decisiones de negocio o de producto, no de ingeniería.

| Nº | Decisión | Bloquea |
|---|---|---|
| 1 | Camino A o B para la conexión bancaria, V-01 | HU-02, CU-12, RF-05, RNF-01, RNF-16, diagrama de secuencia |
| 2 | Las reglas de transición de estado y el valor de N, V-02 | RF-03, cinco casos de uso, TC-08 a TC-11 |
| 3 | Qué ocurre con los registros de auditoría y con el registro de intentos de acceso cruzado (RNF-19, punto 3) al eliminar la cuenta, V-03 — regla propuesta en RF-01.7, registrada para ratificación en el acta; incluye el plazo de conservación del registro de intentos; se cierra solo cuando el acta la ratifique | RF-01.7, RNF-13, RNF-19 (punto 3) |
| 4 | Ratificar los valores propuestos el 5-09 para RNF-07, RNF-09 y RNF-20 (R-01 a R-03 del acta), V-07; se cierra solo cuando el acta los ratifique | Cierre definitivo de V-07; PNF-07, PNF-09 y PNF-20 ya son ejecutables con valores por ratificar |
| 5 | Escribir el RF de búsqueda de ofertas o retirarla del diagrama, 4.5 | Diagrama de casos de uso |

# 13. Control del documento

| Campo | Valor |
|---|---|
| Versión | 1.1 |
| Fecha | 5 de septiembre de 2026 |
| Elementos trazados | 5 HU, 36 CU, 20 RF (RF-01 desagregado en RF-01.1 a RF-01.7), 20 RNF (RNF-03, 04, 05, 08 y 14 desdoblados en a/b), 98 pruebas |
| Actualización | Toda alta, baja o modificación de un requisito obliga a actualizar esta matriz en el mismo sprint |

**Historial de cambios.**

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 4 de septiembre de 2026 | Versión inicial |
| 1.1 | 5 de septiembre de 2026 | Correcciones de la evaluación SWEBOK: RF-01 desagregado (TC-53 a TC-72), HU-03 reescrita con actor usuario (TC-73), métricas de RNF-07/09/20, desdoblamiento de RNF-03/04/05/08/14, RNF-15 acotado, RNF-19 redefinido, V-03, V-04 y V-07 resueltos. Valores nuevos pendientes de ratificación del equipo |

**Regla de mantenimiento.** La matriz pierde su valor en cuanto queda desactualizada, porque el análisis de impacto pasa a apoyarse en relaciones falsas. Se recomienda incorporar a la Definición de Terminado del equipo un punto explícito: ningún requisito se considera terminado si su fila de la matriz no está actualizada.
