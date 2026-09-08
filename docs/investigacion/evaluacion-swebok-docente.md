Sí. Ya pude revisar el contenido completo de “Ojo al Gasto” contra SWEBOK Guide v4.0a, que es la edición vigente y fue liberada en agosto de 2026.

Una precisión importante: SWEBOK es un cuerpo de conocimiento, no una norma de certificación de documentos de requisitos. Por eso hablaré de grado de alineación con SWEBOK, no de “cumplimiento oficial”.

Evaluación general
Mi evaluación es de alineación media-alta, pero el documento todavía tiene varias brechas importantes antes de considerarlo una especificación de requisitos sólida.

Área	Evaluación	Comentario
Identificación de requisitos	🟢 Buena	HU, RF y RNF tienen IDs claros
Requisitos funcionales	🟢/🟡 Buena	En general expresan comportamientos observables
Criterios de aceptación	🟢 Buena	Hay bastante uso de Dado/Cuando/Entonces
Requisitos no funcionales	🟡 Media	Varios no son medibles o mezclan categorías
Trazabilidad	🔴 Débil	Faltan relaciones completas HU → RF → RNF → CU → pruebas
Fuente/rationale/prioridad	🔴 Ausente	SWEBOK recomienda estos atributos
Consistencia	🟡 Media	Hay algunas contradicciones y duplicidades
Validación	🟡 No demostrada	Los criterios ayudan, pero no se documenta revisión/validación
UML	⚪ No evaluable completamente	En el archivo recibido los diagramas aparecen como image
El documento define 5 historias de usuario y 20 requisitos funcionales. Los RF están además acompañados por criterios de aceptación, lo cual es una fortaleza clara.

1. La forma de escribir los requisitos está bastante bien alineada con SWEBOK
SWEBOK reconoce explícitamente la especificación mediante lenguaje natural estructurado, incluyendo formatos actor–acción, casos de uso y el formato de historia de usuario:

As a <role> I want <capability> so that <benefit>.

También reconoce especificaciones basadas en criterios de aceptación, incluyendo ATDD y BDD.

Esto significa que estructuras como:

“Como usuario autenticado, quiero visualizar el panel...”

y criterios tipo:

“Dado..., cuando..., entonces...”

son perfectamente compatibles con las técnicas descritas por SWEBOK.

Por ejemplo, HU-01, HU-02, HU-04 y HU-05 siguen bastante bien esa estructura.

HU-03 tiene un pequeño problema conceptual
Tienen:

Como sistema, quiero detectar y notificar anomalías...

No es necesariamente incorrecto, pero es más natural tratarlo como requisito funcional, porque no representa realmente una necesidad formulada desde un stakeholder.

Podría ser:

Como usuario autenticado, quiero ser alertado cuando se detecte un aumento anormal de precio o un posible doble cobro, para identificar gastos inesperados.

Y dejar:

El sistema detectará un alza cuando...

como RF-07.

2. Los requisitos funcionales están, en general, bien clasificados
SWEBOK v4.0a define los requisitos funcionales como comportamientos observables que el software proporciona, incluyendo políticas que debe aplicar y procesos que debe ejecutar.

Eso encaja muy bien con la mayoría de sus RF.

RF-02 “Registrar suscripción”, RF-06 “Clasificar gasto”, RF-07 “Detectar cambios de precio”, RF-09 “Configurar alertas”, RF-12 “Visualizar calendario”, RF-15 “Exportar historial”, RF-17 “Gestionar Premium” y RF-18 “Asistente financiero”, por ejemplo, son funcionalidades perfectamente razonables.

Hay, sin embargo, algunos RF que corregiría.

RF-01 está demasiado agregado
Actualmente RF-01 incluye:

registrar cuenta;

iniciar sesión;

autenticación Google;

recuperar contraseña;

actualizar correo;

actualizar contraseña;

cerrar sesión;

eliminar cuenta y datos.

Eso dificulta trazabilidad, cambios y pruebas.

SWEBOK destaca precisamente la utilidad de identificar y gestionar requisitos de forma que puedan trazarse hacia diseño y pruebas.

Sería mejor algo como:

ID	Requisito
RF-01	Registrar cuenta
RF-02	Autenticar usuario
RF-03	Autenticar mediante Google
RF-04	Recuperar contraseña
RF-05	Modificar credenciales
RF-06	Cerrar sesión
RF-07	Eliminar cuenta
No necesariamente necesitan llegar a ese nivel de granularidad, pero un RF con siete operaciones diferentes es excesivamente amplio.

3. RF-03 es actualmente el problema funcional más evidente
El propio documento deja el criterio como:

“no entendi vien esta revisa en txt”

Así que ese requisito está evidentemente incompleto.

Pero hay algo más importante: RF-03 define una máquina de estados:

prueba → activa → dudosa → cancelada
activa → fantasma

Para este tipo de requisito, SWEBOK contempla explícitamente la especificación basada en modelos y señala que modelos más formales reducen ambigüedad; incluso menciona UML statecharts como una alternativa útil.

Aquí recomiendo una tabla de transición:

Estado actual	Evento/condición	Estado resultante
Prueba	[definir]	Activa
Activa	[definir condición de dudosa]	Dudosa
Dudosa	[definir]	Cancelada
Activa	[regla de falta de uso]	Fantasma
Fantasma	Usuario vuelve a utilizar servicio	[definir]
El problema es que yo no llenaría esas reglas sin preguntarle al dueño del producto, porque serían decisiones de negocio que el documento todavía no define.

Además, RNF-13 habla de registrar eventos de “reactivación”, pero el flujo de RF-03 no especifica ninguna transición de reactivación.

Eso es una inconsistencia real.

4. Encontré una brecha de trazabilidad importante con la conexión bancaria
HU-02 dice:

“quiero vincular mi cuenta bancaria (...) para que el sistema detecte automáticamente mis suscripciones y cobros”.

Pero RF-05, que debería parecer el candidato natural, define detección mediante:

CSV,

PDF de cartola,

correo electrónico.

No menciona explícitamente la conexión a cuenta bancaria.

Sin embargo, los RNF vuelven a hablar de movimientos bancarios y conectores de banco/correo.

Eso deja esta situación:

HU-02 → ¿qué RF implementa realmente la vinculación bancaria?

Debería existir algo como:

RF-XX — Vincular cuenta bancaria
El sistema permitirá al usuario autenticado autorizar la conexión con una entidad bancaria compatible mediante el mecanismo de autorización definido...

Después RF-05 podría encargarse específicamente de detectar candidatos provenientes de esa conexión.

Este es exactamente el tipo de problema que la trazabilidad ayuda a descubrir. SWEBOK explica que debe ser posible relacionar requisitos con los elementos de diseño que los satisfacen y, hacia atrás, con sus fuentes; también permite hacer análisis de impacto cuando un requisito cambia.

5. Aquí está la mayor brecha respecto a SWEBOK: faltan atributos de los requisitos
Actualmente tienen principalmente:

ID + requisito + descripción + criterio.

Es un buen comienzo.

Pero SWEBOK v4.0a menciona como posibles atributos adicionales:

identificador/tag de trazabilidad;

descripción;

rationale o justificación;

fuente/stakeholder;

caso de uso o evento;

tipo;

dependencias;

conflictos;

criterios de aceptación;

prioridad;

estabilidad;

material de soporte;

historial de cambios.

Por lo tanto, recomendaría evolucionar la tabla hacia:

ID	Tipo	Requisito	Fuente	Prioridad	Dependencias	Criterio aceptación	Estado/versión
RF-07	Funcional	Detectar anomalías	HU-03	Must	RF-05, RF-09	...	v1.1
No es necesario incluir todos los atributos que enumera SWEBOK, porque el propio texto los presenta como posibles atributos. Pero para este proyecto yo añadiría como mínimo:

Fuente, prioridad, dependencias y versión.

6. La trazabilidad HU → RF actualmente es incompleta
Con lo que aparece en el documento puedo reconstruir aproximadamente esto:

Historia	RF relacionado	Evaluación
HU-01 Login	RF-01	✅
HU-02 Vinculación bancaria	RF-05 (?)	⚠️ Incompleto
HU-03 Anomalías	RF-07 + RF-09	✅
HU-04 Dashboard	RF-11	✅
HU-05 Asistente	RF-17 + RF-18	✅
El problema no son solamente esas cinco relaciones.

Tienen 20 RF, pero únicamente cinco HU documentadas.

Eso no significa que los otros RF sean incorrectos. SWEBOK contempla requisitos derivados. El problema es que el documento no permite saber si:

RF-06, por ejemplo, procede de una necesidad de usuario, de un caso de uso, de una decisión del Product Owner o fue derivado durante el diseño.

SWEBOK recomienda precisamente registrar la fuente de cada requisito.

7. Los RNF necesitan bastante más trabajo
SWEBOK hace una distinción muy útil que ahora mismo su documento no hace.

Los RNF pueden dividirse en:

Technology Constraints: obligan o prohíben una tecnología concreta, plataforma o infraestructura.

Quality of Service Constraints: establecen niveles de rendimiento, precisión, fiabilidad, escalabilidad, etc.

Sus 20 RNF están todos juntos en una única categoría.

Yo los evaluaría así:

RNF	Evaluación SWEBOK	Problema principal
RNF-01	🟡 QoS/Rendimiento	“carga normal” no está definida
RNF-02	🟢 QoS/Disponibilidad	Falta definir cómo y dónde se mide el 99,5%
RNF-03	🟡 Mixto	TLS 1.2+ es restricción tecnológica; cifrado es seguridad
RNF-04	🟡 Technology + QoS	“Celery” es tecnología concreta; “sin degradar” no está cuantificado
RNF-05	🟡 Dos requisitos juntos	Mezcla rendimiento con usabilidad
RNF-06	🟢 QoS/Precisión	<10% FP es bueno; falta definir dataset/procedimiento
RNF-07	🔴 Poco verificable	“tiempo estimable y acotado” no significa nada medible
RNF-08	🟡	Mezcla portabilidad con decisión de una sola base de código
RNF-09	🔴 Incompleto	Dice “umbral definido”, pero el umbral no está definido
RNF-10	🟡	“normativa vigente” necesita jurisdicción/normas concretas
RNF-11	🟢/🟡 Recuperabilidad	Buen máximo de 1 hora; debe aclararse pérdida admisible de datos
RNF-12	🟡 Capacidad	“sin degradación perceptible” no es verificable
RNF-13	⚠️	Puede contradecir la eliminación definitiva de cuenta
RNF-14	🟡	Mezcla formato regional con mantenibilidad
RNF-15	🔴	“cualquier navegador” es demasiado amplio
RNF-16	🟢/🟡 Resiliencia	Buena idea, pero mezcla comportamiento funcional con calidad
RNF-17	🟡	“en todo momento” requiere modelo de consistencia preciso
RNF-18	🟡 Testabilidad	Razonable, pero falta criterio concreto
RNF-19	🔴 Duplicado	Prácticamente duplica RF-20
RNF-20	🔴	Valor objetivo no definido y parece más requisito de proyecto/económico
8. RNF-05 debería dividirse
Ahora dice:

El panel debe cargar en menos de 3 segundos [...] y permitir a un usuario nuevo interpretar su resumen sin necesidad de tutorial.

Son dos propiedades diferentes.

Rendimiento
RNF-05a: El 95 % de las solicitudes del dashboard deberá completar su carga en ≤ 3 segundos bajo [condiciones definidas].

Usabilidad
RNF-05b: En una prueba con usuarios nuevos, al menos [X]% deberá identificar correctamente el gasto mensual, la suscripción de mayor costo y el gasto por categoría sin utilizar tutorial, en un máximo de [Y] minutos.

Los [X] e [Y] deben decidirlos ustedes; no los inventaría yo porque representan el nivel de calidad que el stakeholder exige.

Esto vuelve el requisito verificable.

9. RNF-07, RNF-09 y RNF-20 no están terminados
Estos tres merecen corrección prioritaria.

RNF-07 dice:

“en un tiempo de desarrollo estimable y acotado”.

¿Acotado a qué? ¿2 horas? ¿2 días? ¿2 sprints?

RNF-09 dice:

“sin que el tiempo de respuesta promedio supere un umbral definido”.

Pero no define el umbral.

RNF-20 dice:

“dentro de un margen definido mensualmente”.

Pero tampoco especifica ese margen.

En su forma actual los tres son difíciles o imposibles de verificar objetivamente.

10. RNF-15 debería corregirse
Dice:

“las últimas dos versiones estables de cualquier navegador”.

Eso crea una obligación prácticamente ilimitada.

SWEBOK considera explícitamente la compatibilidad con navegadores concretos como una technology constraint.

Mejor:

La interfaz web deberá soportar las dos últimas versiones estables de Chrome, Firefox, Edge y Safari disponibles al inicio de cada release.

Entonces el conjunto es finito y comprobable.

11. RF-20 sí puede ser funcional; RNF-19 sobra
RF-20 establece:

toda consulta o modificación aplica exclusivamente a la cuenta autenticada.

RNF-19 prácticamente vuelve a decir lo mismo:

ningún usuario puede acceder al historial de otro usuario.

Aquí conservaría RF-20.

Esto puede sorprender porque solemos aprender que “seguridad = RNF”. Pero SWEBOK es más matizado: define como funcionales también las políticas que el sistema debe hacer cumplir, y señala explícitamente que una preocupación no funcional de seguridad puede inducir requisitos funcionales concretos en el dominio de seguridad.

Por tanto:

“El sistema debe garantizar confidencialidad” → RNF de seguridad.

“Usuario A no puede consultar los recursos pertenecientes a usuario B” → política funcional de autorización.

RF-20 está bien ubicado.

RNF-19 debería convertirse en una propiedad de seguridad de más alto nivel o eliminarse para evitar duplicidad.

12. Existe una posible contradicción de retención de datos
RF-01 establece que al eliminar una cuenta se eliminan permanentemente sus:

suscripciones, cobros, uso, chat y tokens.

Pero RNF-13 establece que determinados registros de auditoría deberán conservarse:

“durante toda la vida de la cuenta”.

Y RNF-10 introduce requisitos legales de retención y eliminación.

Aquí necesitan una regla explícita:

¿Qué ocurre con los logs de auditoría al eliminar la cuenta?

Podría ser:

Los registros se eliminan junto con la cuenta.

o podría existir una obligación legal de conservación/anomización.

Eso lo debe determinar el requisito legal y de negocio, no el diseño técnico.

SWEBOK indica que en la validación se debe comprobar precisamente si los requisitos son comprensibles, consistentes y completos.

13. Las prioridades están ausentes
No encontré prioridad explícita en los RF ni en los RNF.

Para un proyecto Scrum esto es especialmente útil.

SWEBOK dedica una sección específica a Requirements Prioritization y plantea métodos como:

Must / Should / Nice to have;

escala numérica;

ordenación por prioridad.

También recomienda considerar valor, costo, riesgo técnico, mantenimiento y satisfacción del stakeholder.

Yo añadiría una columna:

Prioridad: Must / Should / Could

Con eso también podrían definir el MVP.

14. El documento necesita una matriz de trazabilidad
Probablemente sería la mejora con más valor académico.

Algo como:

HU	CU	RF	RNF	Prueba
HU-01	CU-02	RF-01	RNF-03	TC-01, TC-02
HU-02	CU-12	RF-XX, RF-05	RNF-01, RNF-04	TC-10
HU-03	CU-30	RF-07, RF-09	RNF-06	TC-20
HU-04	CU-08	RF-11	RNF-05	TC-30
HU-05	CU-15	RF-17, RF-18	RNF-09	TC-40
SWEBOK explica que la trazabilidad permite comprobar tanto:

requisito → diseño → código → pruebas

como:

requisito → fuente/stakeholder, y además facilita analizar el impacto de cambios.

15. Sobre los diagramas UML
El documento incluye secciones para:

casos de uso;

MER;

flujo;

arquitectura;

secuencia.

Pero en el archivo que recibí el contenido aparece únicamente representado como image, por lo que no puedo comprobar si los actores, relaciones, entidades y secuencias son consistentes con los RF.

Eso es importante porque SWEBOK contempla precisamente la model-based requirements specification como complemento de los requisitos escritos.

Qué corregiría primero
Si este documento fuera a entregarse ahora, este sería mi orden de prioridad:

Completar RF-03 y crear su diagrama/tabla de estados.

Crear el RF faltante de vinculación bancaria asociado a HU-02.

Añadir fuente, prioridad y dependencias a los RF/RNF.

Crear una matriz HU → CU → RF → RNF.

Corregir RNF-07, RNF-09 y RNF-20 porque actualmente no tienen métricas suficientes.

Separar RNF que mezclan dos propiedades diferentes, especialmente RNF-03, RNF-04, RNF-05, RNF-08 y RNF-14.

Eliminar la duplicidad RF-20 / RNF-19.

Resolver la política de eliminación vs. retención/auditoría.

Definir de forma finita la compatibilidad de RNF-15.

Hacer una revisión de consistencia final. SWEBOK considera las revisiones/inspecciones el mecanismo más común de validación y recomienda buscar errores, omisiones, supuestos inválidos y falta de claridad.

Conclusión
No veo un documento mal hecho. De hecho, la parte funcional y el uso de criterios de aceptación están por encima de lo que suele verse en una primera especificación: los RF tienen bastante detalle y muchas reglas de negocio están expresadas de manera comprobable.

La principal diferencia entre este documento y uno fuertemente alineado con SWEBOK no está en agregar muchos más requisitos, sino en mejorar clasificación, verificabilidad, trazabilidad, fuente, prioridad, dependencias y consistencia.

Si quieren ajustarlo para una entrega universitaria basada en SWEBOK, yo lo dejaría con esta estructura:

Historias de usuario → Casos de uso → RF → RNF clasificados en Technology Constraints / Quality of Service → criterios de aceptación → matriz de trazabilidad → UML.

Con esas correcciones, la especificación quedaría considerablemente más sólida y mucho más fácil de defender frente a un profesor que pregunte “¿por qué esto es un RF?”, “¿cómo verifican este RNF?” o “¿de dónde salió este requisito?”.