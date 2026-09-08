# Requisitos vigentes — Ojo al Gasto

Extraído del documento del equipo `“Modelado de requisitos para el proyecto #Ojo al gasto#”.docx`.
Es la versión que evaluó el docente. **Esta es la numeración oficial**: cualquier otro documento
que use IDs distintos está desalineado.

> **Nota sobre los identificadores.** En el original, RF-01 a RF-10 se escriben `RF-01` y
> RF-11 a RF-20 se escriben `RF - 11`, con espacios. Aquí se normalizaron todos a `RF-nn`.
> Conviene corregirlo en el documento fuente: rompe cualquier búsqueda por identificador.


---

# Modelado de requisitos para el proyecto

Nombre Proyecto: Ojo al Gasto
Idea del proyecto: Una App multiplataforma de gestión y optimización de gastos en subscripciones
Scrum Master: Maximiliano Sáez
Integrantes:  Christopher Solís, Felipe Orellana, Victor Gonzales, Andrea Travol, Sebastian Mena.

---

# HU-RF-RNF


---

# Historias de Usuario

## HU-01 — Usuario

> Como usuario, quiero iniciar sesión con mi correo/contraseña o con Google (CU-02), para acceder de forma segura a mis datos.

**Criterios de aceptación**

- Dado que estoy en la página de login, cuando ingresó credenciales válidas o me auténtico con Google, entonces el sistema me redirige al dashboard
- Dado que estoy en la página de login, cuando ingreso un correo o contraseña incorrectos, entonces el sistema muestra el error genérico "Usuario o contraseña inválidos" sin revelar cuál dato falló

## HU-02 — Usuario Autenticado

> Como usuario autenticado, quiero vincular mi cuenta bancaria (CU-12), para que el sistema detecte automáticamente mis suscripciones y cobros.

**Criterios de aceptación**

- La sincronización se completa en menos de 30 segundos por cuenta conectada (RNF-01).
- Los movimientos detectados quedan disponibles para clasificación.

## HU-03 — Usuario autenticado

> Como usuario autenticado, quiero ser alertado cuando se detecte un alza de tarifa o un posible doble cobro en mis suscripciones (CU-30), para identificar gastos inesperados y decidir a tiempo si mantengo el servicio.

**Nota de alcance.** Esta historia expresa la necesidad del usuario, beneficiario de la alerta. Las reglas de detección —qué constituye un alza de tarifa y qué constituye un posible doble cobro— las especifica RF-07; los canales de entrega y su configuración los especifica RF-09; los cobros que alimentan la detección provienen de las fuentes que especifica RF-05 (CSV, PDF de cartola, correo).

**Criterios de aceptación**

- Dado que una de mis suscripciones registra cobros de 10.000, 10.000 y 10.000 en los últimos 3 meses, cuando se registra un cobro de 10.600 del mismo servicio, entonces veo en mi panel una alerta "Alza de Tarifa" asociada a esa suscripción, y la recibo por el canal que tengo configurado según RF-09.
- Dado un cargo de un servicio el día 1, cuando se registra otro cargo del mismo servicio el día 4, entonces veo en mi panel una alerta "Posible Doble Cobro" asociada a esos dos cargos.
- Dado que se registra el primer cobro de una suscripción recién creada, entonces no veo ni recibo ninguna alerta de alza de tarifa: sin al menos 2 cobros previos no existe promedio de comparación (RF-07).
- Dado una alerta de anomalía pendiente, cuando la marco como revisada, entonces deja de mostrarse como pendiente en mi panel y el estado de la suscripción no cambia.
- Dado que no tengo ningún dispositivo con notificaciones push registrado, cuando se genera una de estas alertas, entonces la recibo igualmente por correo (RF-09).

## HU-04 — Usuario autenticado

> Como usuario autenticado, quiero visualizar el panel de suscripciones/Dashboard (CU-08), para entender de un vistazo cuánto estoy gastando.

**Criterios de aceptación**

- El panel carga en menos de 3 segundos en un dispositivo de gama media (RNF-05).
- Un usuario nuevo puede interpretar su resumen sin tutorial.

## HU-05 — Usuario (Premium)

> Como usuario premium, quiero interactuar con el asistente financiero por chat (CU-15), para recibir recomendaciones personalizadas de ahorro.

**Criterios de aceptación**

- Esta función solo está disponible si mi plan es Premium.
- El asistente responde en base a mis datos reales de suscripciones y cobros, no información genérica.


---

# Requisitos Funcionales

## RF-01 — Gestionar cuenta y sesión del usuario

Requisito agrupador. Comprende las siete operaciones sobre la cuenta y la sesión del usuario, especificadas en los sub-requisitos RF-01.1 a RF-01.7. Se desagrega para que cada operación pueda trazarse, modificarse y probarse por separado (SWEBOK: gestión y trazabilidad de requisitos), conservando el identificador RF-01, al que siguen resolviendo todas las referencias existentes (HU-01, CU-01 a CU-05, TC-01 a TC-04). RF-01 se considera cumplido cuando los siete sub-requisitos lo están.

| Sub-requisito | Operación | Caso de uso |
|---|---|---|
| RF-01.1 | Registrar cuenta | CU-01 |
| RF-01.2 | Iniciar sesión con correo y contraseña | CU-02 |
| RF-01.3 | Iniciar sesión con Google | CU-02 |
| RF-01.4 | Recuperar contraseña | CU-05 |
| RF-01.5 | Actualizar correo o contraseña | CU-03 |
| RF-01.6 | Cerrar sesión | — (sin caso de uso en el catálogo; ver matriz de trazabilidad) |
| RF-01.7 | Eliminar cuenta y datos personales | CU-04 |

## RF-01.1 — Registrar cuenta

Permite crear una cuenta con correo único, contraseña que cumpla la política definida (mínimo 8 caracteres, con al menos una letra y un número) y consentimiento de tratamiento de datos explícito, específico e informado (Ley 21.719). El consentimiento queda registrado con fecha, hora y versión del texto aceptado.

**Criterios de aceptación**

- Dado un correo no registrado, una contraseña que cumple la política y el consentimiento marcado, cuando envía el registro, entonces la cuenta se crea y puede iniciar sesión (RF-01.2).
- Dado un correo ya registrado, cuando intenta registrarse con él, entonces el registro se rechaza y no se crea una cuenta duplicada.
- Dado una contraseña que no cumple la política (menos de 8 caracteres, sin letra o sin número), entonces el registro se rechaza indicando la política exigida.
- Dado que no marca el consentimiento de datos, entonces el registro se rechaza y no se persiste ningún dato personal del formulario.
- Dado un registro exitoso, entonces queda almacenado el consentimiento con fecha, hora y versión del texto aceptado.

## RF-01.2 — Iniciar sesión con correo y contraseña

Permite autenticarse con el correo y la contraseña registrados. Ante credenciales incorrectas, la respuesta es genérica y no revela cuál dato falló.

**Criterios de aceptación**

- Dado credenciales válidas, cuando inicia sesión, entonces entra al dashboard.
- Dado correo o contraseña incorrectos, entonces muestra "Usuario o contraseña inválidos" sin revelar cuál falló.

## RF-01.3 — Iniciar sesión con Google

Permite autenticarse mediante la cuenta de Google. La autorización concedida en Google inicia sesión sobre la cuenta asociada a ese correo; la autorización denegada o cancelada no crea sesión.

**Criterios de aceptación**

- Dado Google autorizado para una cuenta existente, cuando inicia sesión, entonces entra al dashboard.
- Dado que el usuario cancela o Google deniega la autorización, entonces no se crea sesión y permanece en la pantalla de login con un mensaje claro.
- Dado un correo de Google sin cuenta asociada, entonces el sistema ofrece completar el registro (RF-01.1) y no crea la cuenta sin el consentimiento de datos.

## RF-01.4 — Recuperar contraseña

Permite solicitar el restablecimiento de contraseña por correo. El enlace de restablecimiento es de un solo uso y expira a los 60 minutos. La respuesta a la solicitud es idéntica exista o no el correo, para no revelar qué correos están registrados.

**Criterios de aceptación**

- Dado que solicita recuperar contraseña con un correo registrado, entonces recibe un enlace de restablecimiento de un solo uso válido por 60 minutos.
- Dado un enlace expirado o ya utilizado, cuando lo abre, entonces el sistema lo rechaza y ofrece solicitar uno nuevo.
- Dado un correo no registrado, cuando solicita la recuperación, entonces la interfaz muestra el mismo mensaje que para un correo registrado y no se envía ningún enlace.
- Dado un restablecimiento exitoso, entonces la contraseña anterior deja de autenticar y la nueva sí autentica.

## RF-01.5 — Actualizar correo o contraseña

Permite al usuario autenticado cambiar su correo o su contraseña, previa confirmación de identidad (reingreso de la contraseña vigente o reautenticación con Google). El cambio de correo exige verificar el correo nuevo mediante un enlace, y el correo anterior recibe aviso del cambio.

**Criterios de aceptación**

- Dado que confirma su identidad y define una contraseña nueva que cumple la política de RF-01.1, entonces la contraseña nueva autentica y la anterior no.
- Dado un intento de cambio sin confirmación de identidad, entonces la operación se rechaza y el dato no cambia.
- Dado un cambio de correo, entonces el correo nuevo solo queda activo tras abrir su enlace de verificación, y el correo anterior recibe una notificación del cambio.
- Dado un correo nuevo que ya pertenece a otra cuenta, entonces el cambio se rechaza.

## RF-01.6 — Cerrar sesión

Permite cerrar la sesión en el dispositivo actual. Tras el cierre, el token de esa sesión deja de ser aceptado por el sistema.

**Criterios de aceptación**

- Dado una sesión iniciada, cuando cierra sesión, entonces vuelve a la pantalla de login y no puede acceder al dashboard sin autenticarse de nuevo.
- Dado el token de una sesión cerrada, cuando se usa en una petición a la API, entonces el gateway responde "no autorizado" a más tardar 60 segundos después del cierre.

## RF-01.7 — Eliminar cuenta y datos personales

Permite eliminar la cuenta de forma permanente, previa confirmación de identidad (contraseña vigente o reautenticación con Google) y confirmación explícita de la acción. Antes de confirmar, el sistema informa qué se eliminará y qué se conservará anonimizado. La eliminación aplica la siguiente regla de retención, propuesta para hacer compatibles RF-01.7, RNF-10 (Ley 21.719: eliminación definitiva y retención acotada) y RNF-13 (auditoría); queda registrada como V-03 en la matriz de trazabilidad para ratificación del equipo en el acta:

| Dato | Acción al eliminar la cuenta | Plazo |
|---|---|---|
| Sesiones activas, credenciales y tokens de conectores (correo, Google) | Revocación, invalidación y eliminación definitiva | Revocación inmediata, en la misma confirmación; eliminación definitiva en máximo 72 horas |
| Perfil (nombre, correo, contraseña), suscripciones, cobros, registros de uso, conversaciones del chat, alertas, presupuesto y preferencias | Eliminación definitiva | Máximo 72 horas desde la confirmación |
| Registros de auditoría de cambios automáticos (RNF-13: cancelación, reactivación, transición post-trial) | Anonimización irreversible: se elimina toda referencia que permita reidentificar al titular (correo, nombre, identificador de usuario); se conserva solo tipo de evento, marca de tiempo, un seudónimo no reversible y la fecha de eliminación de la cuenta que los originó | Anonimización en máximo 72 horas; purga definitiva de todo registro anonimizado cuya fecha de eliminación supere los 12 meses |
| Comprobantes de pago del plan Premium (RF-17) | Conservación disociada del resto de los datos, solo con los campos exigidos por la obligación tributaria | 6 años [base legal por validar con la investigación legal del equipo]; luego eliminación definitiva |
| Registro del consentimiento (RF-01.1: fecha, hora y versión del texto aceptado) | Conservación disociada del resto de los datos, como evidencia de la licitud del tratamiento (Ley 21.719); no consultable ni exportable desde la aplicación | 6 años [base legal por validar con la investigación legal del equipo]; luego eliminación definitiva |
| Copias de respaldo | Los datos eliminados desaparecen con la rotación de respaldos | Máximo 30 días desde la eliminación |

**Criterios de aceptación**

- Dado que confirma la eliminación con su identidad verificada, entonces sus sesiones y tokens quedan revocados de inmediato y ya no puede autenticar.
- Dado que transcurren 72 horas desde la confirmación, entonces ninguna consulta ni exportación de la aplicación devuelve datos personales del titular, y su correo puede registrarse como cuenta nueva sin heredar ningún dato.
- Dado un registro de auditoría de esa cuenta consultado después de la eliminación, entonces no contiene correo, nombre ni identificador que permita reidentificar al titular.
- Dado un registro de auditoría anonimizado cuya fecha de eliminación de cuenta supere los 12 meses, entonces ya no existe; la purga opera por esa fecha, sin necesidad de identificar la cuenta de origen.
- Dado que el usuario no completa la confirmación de identidad o cancela la operación, entonces la cuenta y sus datos no cambian.

## RF-02 — Registrar suscripción manualmente

Permite al usuario autenticado registrar una suscripción con nombre del servicio, monto mayor a 0, moneda, frecuencia (semanal, mensual o anual), fecha del próximo cobro y, si aplica, marca de prueba gratuita con su fecha de término.

**Criterios de aceptación**

- Dado un usuario autenticado, cuando envía nombre, monto > 0, frecuencia y fecha de cobro válidos, entonces la suscripción se persiste en estado activa (o en prueba si marcó prueba gratuita) y aparece en su panel.
- Dado que marca prueba gratuita sin indicar fecha de término, entonces se rechaza el registro.

## RF-03 — Gestionar el estado del ciclo de vida de una suscripción

**(sin descripción en el documento original)**

**Criterios de aceptación**

- ⚠️ **INCOMPLETO.** El documento dice literalmente: «no entendi vien esta revisa en txt»

## RF-04 — Registrar y detectar uso de un servicio

Permite registrar uso manual (minutos, veces o «sí la usé / no la usé») en una fecha para una suscripción propia y, si hay consentimiento, recibir uso desde un conector externo. Este dato alimenta la transición a fantasma definida en RF-03.

**Criterios de aceptación**

- Dado una suscripción activa, cuando el usuario registra «sí la usé» hoy, entonces la fecha de último uso queda en hoy.
- No se puede registrar uso sobre una suscripción de otra cuenta.

## RF-05 — Detectar cobros y suscripciones desde fuentes externas

Identifica cobros o suscripciones candidatas desde CSV, PDF de cartola (subida en la web) o correo electrónico con consentimiento explícito y revocable, distinto de los términos generales de la cuenta. Toda detección queda pendiente hasta que el usuario la acepte o la descarte; el sistema no crea registros automáticos sin esa confirmación. No se almacena el archivo completo ni el buzón completo; al revocar el correo se eliminan los tokens y los cobros cuyo único origen sea el correo.

**Criterios de aceptación**

- Dado un CSV con 5 filas válidas y 2 sin monto, cuando el usuario confirma las válidas, entonces se crean 5 registros y las 2 inválidas no se guardan; un archivo con formato incorrecto se rechaza e indica el formato esperado.
- Dado un candidato detectado por CSV, PDF o correo, cuando el usuario lo confirma, entonces se registra con su origen correspondiente (csv, pdf o correo); si lo descarta, no se persiste en ningún lugar del panel ni del historial.
- Dado que Google autoriza el acceso de lectura, entonces el conector queda conectado y pueden aparecer candidatos; aceptar solo los términos de la app no habilita la lectura del correo.
- Al desconectar el correo, el conector queda revocado, no se leen mensajes nuevos y se eliminan los tokens y cobros de origen exclusivo correo.

## RF-06 — Clasificar el gasto por categoría

Permite asociar cada suscripción a exactamente una categoría del catálogo (streaming, música, productividad, nube, juegos, educación, salud, noticias, IA u otro). El usuario puede cambiar la categoría en cualquier momento; el panel y los informes agrupan montos según esa clasificación. .

**Criterios de aceptación**

- Dado el registro o edición de una suscripción, cuando se elige una categoría del catálogo, entonces queda persistida y el resumen por categoría la incluye.
- Un valor fuera del catálogo se rechaza.

## RF-07 — Detectar cambios de precio y anomalías de cobro

Compara cada cobro nuevo con el historial del mismo servicio y genera dos tipos de alerta: alza de tarifa (el monto supera en más de 5% el promedio de los últimos 3 meses, con mínimo 2 cobros previos) y posible doble cobro (2 cargos del mismo servicio en menos de 5 días). Estas alertas se entregan por el mismo canal configurado en RF-09 y el usuario puede marcarlas como revisadas para descartarlas sin que afecten el estado de la suscripción.

**Criterios de aceptación**

- Dado cobros de 10.000, 10.000 y 10.000, cuando llega uno de 10.600, entonces se crea la alerta "Alza de Tarifa".
- Dado un cobro el día 1, cuando llega otro del mismo servicio el día 4, entonces se crea "Posible Doble Cobro".
- El primer cobro de una suscripción no genera alza de tarifa.
- Dado una alerta de doble cobro que el usuario marca como revisada, entonces deja de mostrarse como pendiente sin alterar el estado de la suscripción.

## RF-08 — Editar suscripción

Permite al usuario autenticado modificar nombre, monto, frecuencia, fecha de cobro, categoría, notas y marca de prueba gratuita de una suscripción propia. Los cobros ya registrados no se reescriben; el nuevo monto aplica solo a cobros futuros.

**Criterios de aceptación**

- Dado una suscripción propia, cuando cambia el monto y guarda, entonces el panel muestra el nuevo valor.
- Si intenta editar una suscripción de otra cuenta, la operación se rechaza.

## RF-09 — Configurar y emitir alertas

Permite activar o desactivar, de forma independiente, las alertas de próximo cobro, fin de prueba gratuita y alza de tarifa/doble cobro, con anticipación configurable de 1 a 14 días (por defecto 3) para las que aplican. El correo siempre está disponible como canal; el push es adicional en el móvil. Si no hay dispositivo con push, la alerta se envía igual por correo.

**Criterios de aceptación**

- Dado anticipación de 3 días y una prueba que termina el día 10, cuando llega el día 7, entonces existe alerta de fin de prueba.
- Si el usuario desactiva la alerta de próximo cobro, no se genera esa alerta.
- Si el usuario desactiva la alerta de alza de tarifa, las anomalías detectadas en RF-07 no se notifican, aunque sigan visibles en el panel.

## RF-10 — Eliminar o cancelar suscripción

Permite al usuario marcar como cancelada una suscripción (deja de proyectar cobros y pasa al historial de ahorro) o eliminarla del panel (los cobros históricos asociados se conservan para no alterar informes pasados, pero la suscripción deja de listarse en cualquier vista).

**Criterios de aceptación**

- Dado una suscripción activa, cuando se marca cancelada, entonces no aparece en activas ni en cobros futuros y sí en el cementerio de suscripciones.
- Dado una suscripción cancelada, cuando el usuario la elimina, entonces desaparece del panel y del cementerio, pero los cobros históricos permanecen en los informes ya generados.
- Si el usuario no confirma la acción, el registro no cambia.

## RF-11 — Visualizar panel de suscripciones

Muestra al usuario autenticado el listado de suscripciones no canceladas, el gasto del periodo, el gasto proyectado, el conteo por estado y el desglose por categoría. El móvil muestra la vista resumida; la web, la vista completa con filtros.

**Criterios de aceptación**

- Dado tres activas de 9.990, 5.000 y 12.000 mensuales en la misma moneda, cuando abre el panel, entonces el total es 26.990 y aparecen las tres.
- Un usuario no ve las suscripciones de otro.
- Sin suscripciones, los totales son 0 y se ofrece registrar la primera.
- Si existen suscripciones en más de una moneda, el total se muestra desglosado por moneda en vez de sumarse en una sola cifra.

## RF-12 — Visualizar calendario de pagos

Muestra en un calendario mensual las fechas de cobro proyectadas de suscripciones activas o en prueba gratuita, con servicio y monto. No proyecta cobros de suscripciones canceladas.

**Criterios de aceptación**

- Dado una mensual activa con cobro el día 12, cuando abre ese mes, entonces el día 12 muestra servicio y monto.
- Una suscripción cancelada no genera evento futuro en el calendario.

## RF-13 — Definir presupuesto ideal y alertar su exceso

Permite guardar un monto mensual ideal mayor a 0 para el conjunto de suscripciones. El panel muestra la diferencia entre el gasto proyectado y ese presupuesto. Cuando el gasto proyectado supera el presupuesto definido, el sistema genera una alerta por el canal configurado en RF-09.

**Criterios de aceptación**

- Dado presupuesto 20.000 y proyectado 26.990, cuando abre el panel, entonces muestra un exceso de 6.990 y se genera una alerta de presupuesto excedido.

## RF-14 — Visualizar historial de ahorro (cementerio de suscripciones)

Lista las suscripciones canceladas con fecha, monto y frecuencia, y el ahorro estimado desde la cancelación (monto por ciclo × ciclos transcurridos).

**Criterios de aceptación**

- Dado una mensual de 9.990 cancelada hace 3 meses, cuando abre el cementerio, entonces aparece esa suscripción y el ahorro estimado es 29.970.

## RF-15 — Exportar historial de gastos

Genera un CSV descargable con los cobros y suscripciones del usuario en un periodo dado: servicio, categoría, monto, moneda, fecha, origen y estado. No incluye datos de otras cuentas ni tokens de conectores.

**Criterios de aceptación**

- Dado cobros entre marzo y agosto, cuando exporta ese periodo, entonces el CSV contiene exactamente esos cobros y las columnas declaradas.
- Si no hay cobros en el periodo, entrega solo los encabezados.

## RF-16 — Consultar guía de cancelación

Muestra, para una suscripción propia, los pasos para cancelar el servicio directamente en el proveedor (guía específica o genérica). El sistema no cancela el servicio externo, solo informa.

**Criterios de aceptación**

- Dado un servicio con guía conocida, cuando la abre, entonces ve pasos ordenados y al menos un enlace o instrucción del proveedor.
- Si no hay guía específica, muestra una guía genérica en vez de un error vacío.

## RF-17 — Adquirir y gestionar el plan Premium

Permite contratar el plan Premium con un método de pago válido. El chat y las recomendaciones automáticas quedan habilitados solo tras el pago confirmado. Si el pago falla, el plan permanece gratuito. Si una renovación de Premium falla o el usuario cancela su suscripción Premium, el plan vuelve a gratuito al finalizar el periodo ya pagado, sin interrumpir el acceso de forma retroactiva.

**Criterios de aceptación**

- Dado un pago confirmado, entonces el plan es Premium y el chat queda habilitado.
- Dado un pago rechazado, el plan permanece gratuito y se informa el error.
- Dado un usuario Premium que cancela su renovación, entonces conserva el acceso Premium hasta el fin del periodo ya pagado y luego pasa a gratuito automáticamente.

## RF-18 — Generar recomendaciones y chat del asistente financiero

En plan Premium, permite chatear con el asistente sobre las suscripciones reales del usuario, consultar recomendaciones de cancelación, ahorro o solapamiento, y pedir la explicación de cada una citando datos reales (montos, frecuencia, último uso, solapamiento o desvío del presupuesto). El plan gratuito ve la función bloqueada. El asistente no usa datos de otras cuentas ni inventa montos.

**Criterios de aceptación**

- Dado un usuario Premium con Netflix a 9.990, cuando pregunta cuánto paga de Netflix, entonces la respuesta incluye 9.990.
- Dado plan gratuito, cuando abre el chat, entonces no obtiene respuesta y se ofrece Premium.
- Dado una recomendación de cancelar un servicio sin uso en 45 días, cuando el usuario pide "¿por qué?", entonces la explicación menciona la ausencia de uso y el monto que se dejaría de pagar.

## RF-19 — Importar suscripciones desde archivo (previsualización web)

Desde la web, permite subir un CSV (columnas mínimas: nombre, monto, fecha_cobro) o un PDF de cartola, previsualizar las filas válidas e inválidas antes de confirmar, y guardar solo las que el usuario confirme. Este requisito cubre la experiencia de previsualización; la creación efectiva de los registros confirmados sigue la regla de RF-05.

**Criterios de aceptación**

- Dado un CSV con filas válidas e inválidas, cuando se previsualiza, entonces cada fila se marca como válida o inválida con el motivo del rechazo antes de confirmar.

## RF-20 — Aislar datos por cuenta

Toda consulta o cambio sobre suscripciones, cobros, uso, alertas, recomendaciones y chat aplica exclusivamente a la cuenta autenticada. Un usuario no puede acceder a recursos de otro, ni siquiera conociendo su identificador.

**Criterios de aceptación**

- Dado el id de una suscripción del usuario B, cuando el usuario A la solicita, entonces la respuesta es "no autorizado" o "no existe".
- Al listar cualquier recurso, el usuario A solo ve los suyos.


---

# Requisitos No Funcionales

## RNF-01 — Rendimiento de sincronización

La sincronización de movimientos bancarios o correos (CU-12, CU-13) debe completarse en menos de 30 segundos por cuenta conectada, medido bajo carga normal.

## RNF-02 — Disponibilidad del sistema

La plataforma debe tener una disponibilidad mínima de 99.5% mensual, dado que los jobs automáticos (CU-27, CU-28, CU-29) dependen de ejecuciones programadas continuas.

## RNF-03a — Cifrado de la información financiera en reposo

Toda la información financiera del usuario (suscripciones, cobros, montos, historial de uso) y los secretos de conectores (tokens OAuth del conector de correo) deben almacenarse cifrados en reposo con un algoritmo estándar de cifrado autenticado; ninguno de esos datos se persiste en claro en la base de datos ni en los respaldos.

**Categoría (SWEBOK v4.0a):** calidad de servicio — seguridad (confidencialidad en reposo).

**Verificación (PNF-03a):** consulta SQL directa a la tabla de tokens: ningún valor aparece en claro (el dato almacenado no coincide con el token emitido); inspección de la configuración de cifrado del volumen de datos. Mecanismos aceptados: cifrado de volumen del proveedor de infraestructura o LUKS; para los tokens, además, cifrado a nivel de aplicación con algoritmo mínimo AES-256-GCM.

**Trazabilidad:** desagregado de RNF-03 según la evaluación SWEBOK del docente («TLS 1.2+ es restricción tecnológica; cifrado es seguridad»). La inclusión de los tokens está respaldada por el ADR-005, sección Cifrado de credenciales («los tokens de los conectores se almacenan cifrados y nunca se exponen»). Toda referencia existente a RNF-03 comprende RNF-03a y RNF-03b.

## RNF-03b — Cifrado en tránsito (TLS 1.2 o superior)

Toda transmisión de datos entre los clientes (web y móvil) y el gateway, y toda comunicación entre servicios que salga del clúster de despliegue, debe realizarse exclusivamente sobre TLS 1.2 o superior. Se considera límite no confiable todo tráfico que cruce la red pública o salga del clúster/host de despliegue, condición verificable por inspección de la configuración de despliegue. Los intentos de negociación con TLS 1.0 o 1.1 se rechazan; una petición HTTP plana a un endpoint expuesto no entrega datos: responde con redirección a HTTPS o con rechazo.

**Categoría (SWEBOK v4.0a):** restricción tecnológica.

**Verificación (PNF-03b):** escaneo de la configuración TLS del gateway con una herramienta estándar (testssl.sh o sslyze): el handshake con TLS 1.0 y 1.1 es rechazado y TLS 1.2+ es aceptado; una petición HTTP plana no entrega datos (redirección a HTTPS o rechazo); inspección de la configuración de despliegue para confirmar que ningún servicio expone tráfico con datos financieros fuera del clúster sin TLS.

**Trazabilidad:** desagregado de RNF-03; ver la nota en RNF-03a.

## RNF-04a — Capacidad de escalar el procesamiento asíncrono

La infraestructura de procesamiento asíncrono (Celery sobre RabbitMQ) debe permitir agregar réplicas de worker sin modificar código ni reiniciar los servicios en ejecución: un worker nuevo se registra en el broker y comienza a consumir tareas de las colas existentes.

**Categoría (SWEBOK v4.0a):** restricción tecnológica — arquitectura de escalabilidad horizontal.

**Verificación (PNF-04a):** con el sistema en ejecución y tareas encoladas, se levanta una segunda réplica del worker; se verifica en el broker (o con Flower) que ambas réplicas consumen tareas de la misma cola, sin reinicio de ningún otro servicio y sin tareas perdidas.

**Trazabilidad:** desagregado de RNF-04 según la evaluación SWEBOK del docente («“Celery” es tecnología concreta; “sin degradar” no está cuantificado»). Toda referencia existente a RNF-04 comprende RNF-04a y RNF-04b.

## RNF-04b — Elasticidad: mantenimiento del tiempo de ejecución al escalar

Ante un aumento de usuarios activos, duplicar la carga de trabajo duplicando en la misma proporción los workers no debe degradar el tiempo de procesamiento en más de un 10%. Escenario de referencia: un lote de 200 tareas de detección procesado con 1 worker define el tiempo base T1; un lote de 400 tareas con 2 workers debe completarse en un tiempo T2 ≤ 1,1 × T1, medido en el mismo entorno.

**Categoría (SWEBOK v4.0a):** calidad de servicio — elasticidad y rendimiento.

**Verificación (PNF-04b):** ejecución de ambos escenarios en el entorno de pruebas y comparación de los tiempos totales de lote; se acepta si T2 ≤ 1,1 × T1.

**Trazabilidad:** desagregado de RNF-04; ver la nota en RNF-04a. Los valores 200 tareas y 10%, y las condiciones «sin modificar código ni reiniciar los servicios en ejecución» de RNF-04a, son operacionalizaciones propuestas del texto oficial y deben ser ratificados por el equipo.

## RNF-05a — Rendimiento de carga del panel

El 95% de las cargas del panel principal (CU-08) debe completarse en 3 segundos o menos, medido sobre 20 cargas consecutivas con una cuenta de prueba de 50 suscripciones y 12 meses de historial de cobros. Condiciones de medición: en móvil, un dispositivo Android de gama media (4 GB de RAM; referencia: Samsung Galaxy A15 o emulador equivalente); en web, navegador con limitación de red «Fast 4G» de las herramientas de desarrollo.

**Categoría (SWEBOK v4.0a):** calidad de servicio — rendimiento (tiempo de respuesta).

**Verificación (PNF-05a):** medición del percentil 95 del tiempo de carga en las condiciones descritas; se acepta si p95 ≤ 3 s.

**Trazabilidad:** desagregado de RNF-05 según la evaluación SWEBOK del docente (punto 8: «Son dos propiedades diferentes», con la plantilla RNF-05a/RNF-05b). Conserva los 3 segundos y la gama media que cita HU-04. Toda referencia existente a RNF-05 comprende RNF-05a y RNF-05b.

## RNF-05b — Usabilidad del panel sin tutorial

Un usuario nuevo debe poder interpretar su resumen de gastos sin tutorial. En una prueba de usabilidad con al menos 5 usuarios sin exposición previa a la aplicación, al menos el 80% de los participantes debe identificar correctamente, sin tutorial ni asistencia y en un máximo de 3 minutos por participante, las tres cifras del panel: (1) el gasto mensual total, (2) la suscripción de mayor costo y (3) el gasto de una categoría indicada por el evaluador.

**Categoría (SWEBOK v4.0a):** calidad de servicio — usabilidad (facilidad de aprendizaje).

**Verificación (PNF-05b):** sesión de prueba moderada con protocolo escrito y registro de aciertos y tiempos por participante; se acepta si al menos el 80% de los participantes (mínimo 5 participantes; el número de aciertos exigido se redondea hacia arriba) completa las tres identificaciones sin asistencia en un máximo de 3 minutos cada uno.

**Trazabilidad:** desagregado de RNF-05; ver la nota en RNF-05a. Los valores 80% y 3 minutos son propuestos: el docente indicó que «representan el nivel de calidad que el stakeholder exige», por lo que el Product Owner debe ratificarlos o ajustarlos.

## RNF-06 — Precisión del motor de detección

Los algoritmos de detección de recurrencia y anomalías de cobro (CU-30) deben mantener una tasa de falsos positivos inferior al 10%, verificable mediante métricas de validación periódicas.

## RNF-07 — Mantenibilidad de conectores

La arquitectura debe permitir agregar un nuevo conector de ingesta de cobros (por ejemplo, el formato de cartola PDF de otro banco, otro proveedor de correo o una variante de CSV: las fuentes definidas en el ADR-005) cumpliendo dos condiciones medibles. **Criterio estructural:** el cambio no modifica ni elimina líneas en los módulos del núcleo del sistema —los servicios `auth`, `subscriptions`, `analytics` y `notifications` (ADR-001), el gateway, y el código existente del servicio `connectors` fuera del paquete de conectores—; se limita a archivos nuevos que implementan la interfaz común de conectores y a su registro en la configuración del servicio `connectors`. **Criterio de esfuerzo:** el desarrollo completo del conector, incluidas sus pruebas automatizadas, no supera **5 días-persona (40 horas)**.

**Criterios de aceptación**

- Dado el conjunto de cambios (diff) con que se agregó el último conector, cuando se revisa en la revisión de código, entonces contiene 0 líneas modificadas o eliminadas en los servicios `auth`, `subscriptions`, `analytics` y `notifications`, en el gateway y en el código existente de `connectors` fuera del paquete de conectores: solo archivos nuevos que implementan la interfaz común de conectores y su registro en la configuración del servicio `connectors` (verificación PNF-07).
- Dado el registro de horas del equipo para ese conector, cuando se suma el esfuerzo desde el inicio hasta que sus pruebas pasan, entonces el total es menor o igual a 5 días-persona.
- Si al momento de la verificación no se ha agregado ningún conector real, la prueba se ejecuta desarrollando un conector de demostración (por ejemplo, el formato de cartola de un segundo banco) como ejercicio medido con las mismas dos condiciones.

## RNF-08a — Comportamiento consistente del cliente móvil Android

La aplicación móvil debe ofrecer el mismo comportamiento funcional en todo el rango de versiones Android soportado: desde Android 10 (API 29) hasta la última versión estable publicada al inicio del release. Los casos de prueba funcionales aplicables al cliente móvil deben pasar sin fallos en la versión mínima y en la última, y el tiempo de carga del panel debe cumplir RNF-05a en el dispositivo de referencia.

**Alcance:** la entrega móvil es únicamente para Android, conforme al ADR-006 (React Native + Expo; iOS descartado porque la distribución requiere una cuenta de Apple Developer de costo anual). iOS queda declarado fuera del alcance de esta versión, como trabajo futuro condicionado a presupuesto.

**Categoría (SWEBOK v4.0a):** calidad de servicio — portabilidad y compatibilidad.

**Verificación (PNF-08a):** ejecución de la batería funcional móvil en un emulador con API 29, en uno con la última API estable y en el dispositivo físico de referencia; se acepta con el 100% de los casos aplicables aprobados en los tres entornos y con el cumplimiento de RNF-05a verificado en el dispositivo físico de referencia (PNF-05a).

**Trazabilidad:** desagregado de RNF-08 según la evaluación SWEBOK del docente («Mezcla portabilidad con decisión de una sola base de código»). El texto original prometía «Android e iOS»; aquí se alinea con la decisión vigente del ADR-006 y el cambio de alcance debe validarse en acta del equipo. Toda referencia existente a RNF-08 comprende RNF-08a y RNF-08b.

## RNF-08b — Base de código única del cliente móvil

El cliente móvil se implementa en una única base de código React Native + Expo (TypeScript), conforme al ADR-006. No se admiten proyectos móviles paralelos ni bifurcaciones por plataforma; el APK entregado se genera desde esa única base.

**Categoría (SWEBOK v4.0a):** restricción tecnológica.

**Verificación (PNF-08b):** inspección del repositorio: existe un único proyecto móvil (`movil/`), el APK de la entrega se construye desde él (registro del build) y no hay módulos nativos mantenidos fuera del flujo de Expo.

**Trazabilidad:** desagregado de RNF-08; ver la nota en RNF-08a.

## RNF-09 — Capacidad de la API de IA

La función de chat del asistente financiero (RF-18) debe sostener **50 solicitudes de chat concurrentes** manteniendo un **tiempo de respuesta promedio ≤ 2,5 segundos** y un **percentil 95 ≤ 4 segundos**, medidos en el gateway, con una tasa de errores inferior al 1%. El valor de 50 es un parámetro de dimensionamiento derivado de RNF-12: equivale al 5% de los 1.000 usuarios activos simultáneos, un techo conservador dado que el chat es exclusivo del plan Premium (RF-17, RF-18). El umbral de 4 segundos es coherente con RN-24: si la API de IA externa no responde en 3,5 segundos, la llamada se interrumpe y se entrega la respuesta predeterminada, de modo que el usuario siempre recibe una respuesta —del asistente o predeterminada— dentro del umbral. Las respuestas predeterminadas cuentan en la medición de tiempos y se reportan por separado.

**Criterios de aceptación**

- Dada una prueba de carga (k6 o Locust) con 50 clientes virtuales sostenidos durante 10 minutos contra el endpoint de chat —con la API de IA real, o con un simulador configurado con la latencia real medida de esa API—, cuando termina la ejecución, entonces el promedio es ≤ 2,5 s, el percentil 95 es ≤ 4 s y los errores son menos del 1% (verificación PNF-09).
- La ejecución es válida solo si las respuestas predeterminadas por el timeout de RN-24 no superan el 10% del total; si con la API real se supera ese porcentaje, la prueba se repite contra el simulador configurado con la latencia real medida de la API.
- El reporte de la prueba indica por separado qué porcentaje de las respuestas fue predeterminado por el timeout de RN-24.

## RNF-10 — Cumplimiento normativo de datos

El almacenamiento y procesamiento de datos personales y financieros debe cumplir la Ley 21.719 de protección de datos personales, vigente en Chile desde el 1 de diciembre de 2026 (ligado a CU-04): consentimiento específico, informado y revocable (RF-01.1, RF-05); derechos de acceso, rectificación, cancelación y oposición; retención acotada y documentada por tipo de dato; y eliminación definitiva conforme a la tabla de retención de RF-01.7. Se verifica mediante auditoría (PNF-10) contrastando el registro de actividades de tratamiento con los plazos declarados en esa tabla.

## RNF-11 — Recuperación ante fallos

Ante una caída del servicio, el sistema debe restaurar su operación en un máximo de 1 hora, y no debe perder transacciones o cobros ya sincronizados en las últimas 24 horas previas a la falla.

## RNF-12 — Concurrencia de usuarios

El sistema debe soportar al menos 1,000 usuarios activos simultáneos sin degradación perceptible en los tiempos de respuesta del dashboard y del chat con IA.

## RNF-13 — Persistencia y retención de registros de auditoría

Los registros de cambios automáticos del sistema (cancelación, reactivación, transición post-trial) deben conservarse sin pérdida ni corrupción durante toda la vida de la cuenta del usuario, independiente del volumen de eventos generados. La obligación de conservación termina al eliminarse la cuenta: en ese momento aplica la regla de retención de RF-01.7, que anonimiza los registros de forma irreversible dentro de 72 horas y purga definitivamente todo registro anonimizado cuya fecha de eliminación de cuenta supere los 12 meses.

## RNF-14a — Adaptación automática al formato regional

La representación de montos y fechas debe ajustarse automáticamente a la configuración regional del dispositivo (móvil) o del navegador (web), usando los formatos estándar de la región activa, sin que el usuario deba configurar nada dentro de la aplicación.

**Categoría (SWEBOK v4.0a):** calidad de servicio — adaptabilidad.

**Verificación (PNF-14a):** con una suscripción de 9.990 CLP y cobro el 12-10-2026, se cambia la configuración regional del dispositivo de es-CL a en-US: el monto y la fecha pasan a mostrarse en el formato de la nueva región (CLP 9,990 y 10/12/2026) sin reinstalar la aplicación ni reiniciar sesión. Implementación de referencia: formatos CLDR vía la API Intl de ECMAScript, disponible en React y en Hermes/React Native.

**Trazabilidad:** desagregado de RNF-14 según la evaluación SWEBOK del docente («Mezcla formato regional con mantenibilidad»). Toda referencia existente a RNF-14 comprende RNF-14a y RNF-14b.

## RNF-14b — Soporte de nuevas regiones sin cambios de código

Soportar una región adicional no debe requerir modificación alguna del código fuente: los formatos regionales provienen exclusivamente de la capa de internacionalización estándar y no existen formatos de moneda o fecha codificados a mano fuera de ella.

**Categoría (SWEBOK v4.0a):** calidad de servicio — mantenibilidad.

**Verificación (PNF-14b):** se selecciona una región no utilizada durante el desarrollo ni en pruebas anteriores (por ejemplo pt-BR) y se verifica que montos y fechas se muestran en su formato correcto con el repositorio sin ninguna modificación (git diff vacío); una revisión estática confirma que no hay cadenas de formato regional codificadas fuera de la capa de internacionalización.

**Trazabilidad:** desagregado de RNF-14; ver la nota en RNF-14a. La región de control pt-BR es propuesta y puede sustituirse por otra que no se haya usado en desarrollo.

## RNF-15 — Compatibilidad de navegadores y dispositivos

La interfaz web debe funcionar sin pérdida de funcionalidad visual ni de interacción en las **dos últimas versiones estables** de los siguientes cuatro navegadores, tomadas a la fecha de inicio de la fase de pruebas de cada release: **Google Chrome, Microsoft Edge, Mozilla Firefox y Apple Safari**. Las versiones exactas evaluadas quedan registradas en el plan de pruebas de la release. La obligación cubre el rango de viewport de 360×640 a 1920×1080 píxeles, verificado en cuatro puntos: 360×640 (móvil), 768×1024 (tablet), 1366×768 (escritorio) y 1920×1080 (escritorio grande, extremo superior del rango declarado).

**Justificación del conjunto.** Chrome y Edge comparten el motor Blink y concentran la mayoría del uso de navegadores en Chile (StatCounter Chile); Firefox aporta el motor Gecko; Safari aporta WebKit y es obligatorio porque el proyecto no contempla cliente móvil iOS (ADR-006), de modo que los usuarios de iPhone, iPad y macOS acceden por la web. Con esos cuatro navegadores quedan cubiertos los tres motores de renderizado vigentes; los navegadores no listados que usan esos mismos motores (Brave, Opera, Vivaldi) quedan fuera de la obligación exigible, aunque se benefician de la cobertura por motor. Este requisito aplica solo al cliente web; la compatibilidad del cliente móvil se rige por RNF-08.

**Verificación (PNF-15)**

- La batería de humo de la web —como mínimo TC-32 a TC-35 (RF-11) y TC-50 (RF-19)— se ejecuta sobre cada navegador del conjunto, en sus dos últimas versiones estables y en los cuatro viewports declarados; el criterio de éxito es el 100 % de los casos aprobados.
- La ejecución automatizada cubre los motores Chromium, Firefox y WebKit (por ejemplo, con Playwright); Edge se cubre con el canal `msedge` de la misma herramienta o con una pasada de humo manual documentada.
- El informe de pruebas de la release registra navegador, versión, viewport y resultado. Una release no se publica con casos fallidos en esta matriz de navegadores.

## RNF-16 — Resiliencia ante fallos de terceros

Si un conector externo (banco, correo, API de la ia) no responde o falla, el sistema debe degradar la funcionalidad de forma controlada (mostrar el último dato disponible con marca de tiempo) en vez de bloquear o hacer fallar el resto de la aplicación.

## RNF-17 — Consistencia de datos entre módulos

Los datos de cobros y uso mostrados en el dashboard, el calendario de pagos y el chat de IA deben ser consistentes entre sí en todo momento, sin discrepancias mayores a la última sincronización registrada.

## RNF-18 — Facilidad de prueba

Cada módulo del backend debe poder probarse de forma aislada mediante pruebas automatizadas, sin depender de que los demás módulos estén operativos.

## RNF-19 — Confidencialidad del historial financiero

El aislamiento por cuenta que RF-20 define como política funcional debe estar garantizado en la capa de datos y verificado de forma continua, no solo implementado en los controladores. Este requisito fija el nivel de aseguramiento de esa política:

1. **Aplicación en la capa de datos.** Toda consulta de los servicios sobre tablas con datos de propiedad de una cuenta (suscripciones, cobros, uso, alertas, recomendaciones y chat) pasa por el filtro obligatorio de tenant definido en el ADR-004 (`shared/tenant`); ningún modelo con campo de propietario accede a los datos fuera de ese filtro.
2. **Verificación continua.** Una suite automatizada de pruebas de aislamiento intenta, por cada endpoint expuesto de la API que devuelve o modifica recursos de una cuenta, el acceso cruzado con credenciales de una segunda cuenta. La suite se ejecuta en cada integración continua y la release no se publica si detecta una o más fugas.
3. **Registro de intentos cruzados.** Todo intento denegado de acceder a un recurso de otra cuenta queda registrado con marca de tiempo, identificador de la cuenta autenticada, recurso solicitado y resultado. El plazo de conservación de ese registro y su destino al eliminarse la cuenta se fijan junto con la resolución de V-03, cuya decisión (sección 12 de la matriz, punto 3) debe ampliarse para cubrir también este registro.

**Distinción con RF-20.** RF-20 especifica el comportamiento observable —qué respuesta recibe el usuario A al pedir un recurso del usuario B— y lo prueban TC-51 y TC-52. RNF-19 especifica con qué garantía se implementa y se comprueba esa política: dónde se aplica (capa de datos), con qué frecuencia se verifica (cada integración continua) y qué evidencia deja (el registro de intentos). Con esta redacción desaparece la duplicidad señalada en el punto 11 de la evaluación SWEBOK y en V-04 de la matriz de trazabilidad.

**Verificación (PNF-19)**

- Inspección estática: el 100 % de los modelos con campo de propietario aplica el filtro de tenant mediante el mecanismo de `shared/tenant` (herencia de la clase base o mecanismo equivalente documentado por el servicio); cualquier modelo fuera de ese mecanismo hace fallar la verificación.
- Suite de aislamiento: cero fugas sobre el total de endpoints expuestos, ejecutada en la integración continua.
- Registro: repetir el escenario de TC-51 y comprobar que el intento queda registrado con los cuatro campos exigidos.

## RNF-20 — Costo operativo por usuario

El costo operativo mensual total —infraestructura (cómputo, base de datos, almacenamiento, colas) más llamadas a APIs externas, incluida la API de IA— dividido por el número de usuarios activos del mes no debe superar **US$ 0,10 por usuario activo** (≈ $100 CLP). Se define usuario activo mensual como una cuenta con al menos una solicitud autenticada en el mes; para hacerlo medible, el servicio `auth` registra por usuario la fecha de la última emisión de token (campo `ultima_actividad` o registro equivalente), y el conteo mensual es una consulta reproducible sobre ese registro. Adicionalmente, ningún usuario individual puede generar más de **US$ 0,50** de costo de APIs externas en un mes; el sistema lo garantiza con un tope de **200 llamadas a la API de IA por usuario y mes** aplicado en el backend (valor por defecto configurable, que debe cumplir: 200 × costo promedio por llamada ≤ US$ 0,50 con el proveedor contratado) y con el límite de ingesta de RN-25. Alcanzado el tope individual, el asistente responde con datos ya calculados, sin llamar a la API externa y sin bloquear el resto de la aplicación, en degradación controlada coherente con RNF-16. Si la medición mensual cierra sobre US$ 0,10 por usuario activo, el tope configurable de llamadas por usuario se reduce para el mes siguiente hasta volver al margen, y la desviación queda registrada en la planilla de costos. El tope de US$ 0,10 es conservador para un proyecto estudiantil: con la infraestructura en niveles gratuitos o de bajo costo, el costo queda dominado por la API de IA, y el tope por usuario permite proyectar el costo total de forma lineal al crecer la base de usuarios.

**Criterios de aceptación**

- El primer día hábil de cada mes se registra en la planilla de costos del proyecto: el monto facturado por cada proveedor (hosting, base de datos, colas, API de IA) durante el mes anterior, el número de usuarios activos de ese mes (consulta sobre el registro de última actividad de `auth`) y el cociente entre ambos. La verificación aprueba si el cociente es ≤ US$ 0,10 (verificación PNF-20).
- Dado el contador de llamadas a la API de IA por usuario, cuando se consulta al cierre del mes, entonces ningún usuario supera el tope mensual configurado.
- Dado un usuario Premium que alcanzó su tope mensual, cuando envía un mensaje al chat, entonces recibe una respuesta generada desde datos ya calculados, sin llamada a la API externa y sin error.
- Dado un mes cerrado sobre el margen de US$ 0,10, cuando se prepara el mes siguiente, entonces la planilla de costos registra la desviación y el nuevo valor reducido del tope de llamadas por usuario.


---

# Modelado UML

Diagrama de casos de uso

---

# Diagrama MER


---

# Diagrama de Flujo


---

# Diagrama de Arquitectura de Software

Diagrama de Secuencia
