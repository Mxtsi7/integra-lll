# MER corregido — diccionario de datos

**Diagrama:** [`mer-corregido.puml`](mer-corregido.puml) · imagen en [`png/mer-corregido.png`](png/mer-corregido.png)
**Origen:** aplica los 56 hallazgos de [`../REVISION-MER.md`](../REVISION-MER.md)
**Fecha:** 7 de septiembre de 2026

---

## 1. Supuesto declarado

> ⚠ **Este modelo asume producto INDIVIDUAL.** El titular de todo dato es el `USUARIO`.
>
> El conflicto **C-03** sigue abierto. Si el equipo lo resuelve como **hogar**, este modelo **no se redibuja**: se reemplaza el campo de titular según el delta de la sección 6. El resto de la estructura vale igual en los dos escenarios.

Se eligió individual porque es lo que dicen hoy las cinco historias de usuario, los veinte requisitos y los treinta y seis casos de uso, y porque **RF-20 prohíbe explícitamente** el acceso cruzado que el hogar necesita. El argumento completo, con los dos lados, está en la sección 6 de `REVISION-MER.md`.

## 2. Qué cambió

| | MER original | MER corregido |
|---|---|---|
| Entidades | 13 | **27** |
| Titular de los datos | `ORGANIZACION` | `USUARIO` |
| Relación usuario–suscripción | **No existía** | Directa, uno a muchos |
| Claves primarias | `int` secuencial | `uuid` |
| Instantes | `date` / `datetime` | `timestamptz` |
| Reglas de borrado | Ninguna declarada | Declaradas, sección 5 |
| Requisitos implementables | 10 de 20 no lo eran | Los 20 |

**Una entidad se elimina:** `ORGANIZACION`, junto con `USUARIO.rol`, por el supuesto de la sección 1.

**Quince entidades nuevas:** `IDENTIDAD_EXTERNA`, `TOKEN_VERIFICACION`, `CONSENTIMIENTO`, `INTENTO_ACCESO_CRUZADO`, `CONSUMO_IA`, `PROVEEDOR`, `GUIA_CANCELACION`, `PASO_CANCELACION`, `USO`, `INGESTA_DOCUMENTO`, `CONFIGURACION_ALERTA`, `ANTICIPACION_ALERTA`, `ANOMALIA`, `PRESUPUESTO`, `PLAN_CONTRATADO`.

Las doce del modelo original se conservan, con los campos y las relaciones corregidos.

---

## 3. Diccionario de datos

### 3.1 Cuenta, identidad y seguridad

**`USUARIO`** — la persona con cuenta. Es el titular de todo dato del sistema.

| Campo | Notas |
|---|---|
| `password_hash` | **Admite nulo**: la cuenta puede ser solo de Google (M-33) |
| `zona_horaria` | Sin este campo el horario de descanso de RN-09 es inimplementable (§8.5) |
| `ultima_actividad` | Se actualiza en cada emisión de token. Es la base del usuario activo mensual de RNF-20 (M-23) |
| `email` | **Único**. RF-01 exige correo único y el MER original no lo declaraba (M-49) |

**`IDENTIDAD_EXTERNA`** — vincula la cuenta con un proveedor de identidad. Resuelve M-33: RF-01.3 exige inicio de sesión con Google y el modelo original no lo contemplaba, lo que dejaba `password_hash` obligatorio de hecho. Único por `(proveedor, sub_externo)`.

**`TOKEN_VERIFICACION`** — enlaces de un solo uso. Resuelve M-32. RF-01.4 exige rechazar un enlace «ya utilizado», lo que es imposible sin persistir su consumo; `usado_en` nulo significa sin consumir. `dato_pendiente` guarda el correo nuevo mientras el vigente sigue operativo, como pide RF-01.5.

**`CONSENTIMIENTO`** — evidencia de la licitud del tratamiento. Resuelve M-13 y M-20.

Tiene una particularidad deliberada: **no lleva clave foránea a `USUARIO`**. RF-01.7 obliga a purgar el perfil en 72 horas, pero la tabla de retención conserva el consentimiento 6 años y disociado. Con borrado en cascada se destruiría la evidencia; con una clave foránea viva se retendría la asociación que la disociación prohíbe. La solución es `seudonimo_titular`, que al eliminar la cuenta reemplaza cualquier referencia directa.

**`INTENTO_ACCESO_CRUZADO`** — registro de accesos denegados. Resuelve M-22. El punto 3 de RNF-19 exige marca de tiempo, cuenta autenticada, recurso solicitado y resultado; sin esta entidad, PNF-19 deja de ser ejecutable. Sin clave foránea al recurso: pertenece a otra cuenta y puede haber sido eliminado.

**`CONSUMO_IA`** — llamadas reales a la API externa, por usuario y mes. Resuelve M-23. Contar filas de `MENSAJE` no sirve: las respuestas degradadas de RN-24 generan mensajes sin llamar a la API, y las explicaciones de recomendaciones consumen API fuera del chat. Único por `(id_usuario, anio, mes)`.

**`DISPOSITIVO`** — el teléfono al que llega el push. `token_push` ahora es **único** (M-49).

### 3.2 Catálogo global

Estas tres entidades **no llevan campo de titular**: son compartidas. Netflix es Netflix para todos.

**`CATEGORIA`** — el catálogo fijo de RF-06. `nombre` único (M-49).

**`PROVEEDOR`** — resuelve M-27. Sin catálogo de servicios, `nombre_servicio` en texto libre impide reconocer «el mismo comercio», que es lo que RN-11 necesita para detectar recurrencia, y deja la guía de cancelación sin dónde anclarse. `alias_glosa` guarda las variantes con que el proveedor aparece en las cartolas.

**`GUIA_CANCELACION`** y **`PASO_CANCELACION`** — resuelven M-11. RF-16 pide **pasos ordenados**, no una sola dirección web, y la guía debe existir aunque nunca se haya emitido una notificación. `id_proveedor` nulo identifica la guía genérica de respaldo.

### 3.3 Suscripciones

**`SUSCRIPCION`** — el contrato con un proveedor.

| Campo | Resuelve |
|---|---|
| `id_usuario` | M-01 · el titular. Antes no existía relación con `USUARIO` |
| `id_categoria` | **Se mantiene pese a existir `PROVEEDOR`**. RF-06 exige que el usuario pueda cambiar la categoría cuando quiera; la del proveedor es solo el valor por defecto. Copiar el catálogo del puml sin esto rompe RF-06 (§8.5) |
| `es_prueba_gratuita`, `fecha_fin_prueba` | M-03 · RF-02 rechaza el registro si se marca prueba sin fecha de término |
| `notas` | M-19 · RF-08 permite editarlas |
| `fecha_cancelacion`, `ahorro_estimado` | M-40 · el cementerio de RF-14. Derivarlos del historial es frágil cuando hay ciclos de baja y reactivación (RN-21) |
| `fecha_eliminacion` | M-24 · borrado lógico, **independiente de `estado`**. «Eliminada» no es un estado del ciclo de vida, y si lo fuera, RN-21 resucitaría una suscripción eliminada al detectar un cobro nuevo |

Tres campos son **derivados almacenados**, y su regla de recálculo debe quedar escrita (M-41, M-42): `fecha_proximo_cobro`, `es_recurrente_variable` (por RN-12, variación superior al 30%) y `fecha_ultimo_uso` (el máximo de `USO.fecha`).

**`USO`** — resuelve M-02, el hallazgo con más consecuencias de producto.

RF-04 pide registrar uso en minutos, veces o sí/no, **con fecha**. El modelo original solo tenía un escalar `fecha_ultimo_uso`, lo que además hacía imposible calcular el **costo por hora de uso**, la métrica que aparece en las cuatro pantallas del mockup y lo que diferencia el producto de una planilla de gastos.

`id_conector` admite nulo y sirve al borrado selectivo: el mockup promete que al desconectar una cuenta se eliminan los datos obtenidos por esa vía, y sin este campo la revocación sería todo o nada (§8.5).

**`MOVIMIENTO`** — los cobros detectados.

| Campo | Resuelve |
|---|---|
| `id_suscripcion` **nulo** | M-08 · RF-05 exige que la detección quede pendiente hasta que el usuario la acepte; un candidato aún no confirmado no tiene suscripción |
| `id_conector` **nulo** | M-28 · el cobro manual y las cargas CSV o PDF no vienen de ningún conector, y son el piso obligatorio del ADR-005 |
| `moneda` | M-09 · RF-11 exige desglosar el total por moneda |
| `estado` | M-08 · candidato, confirmado o descartado |
| `hash_deteccion` | §8.5 · RF-05 exige que el candidato descartado «no se persista», pero sin rastro alguno la siguiente sincronización lo regenera indefinidamente. Un hash sin contenido resuelve ambas cosas |

**`HISTORIAL_ESTADO`** — la auditoría del ciclo de vida. Resuelve M-21.

RF-01.7 ordena que al eliminar la cuenta estos registros se anonimicen conservando solo tipo de evento, marca de tiempo, un seudónimo no reversible y la fecha de eliminación, y que la purga a los 12 meses opere por esa fecha. Por eso: `id_suscripcion` **admite nulo** (la anonimización lo vacía), aparecen `seudonimo` y `fecha_eliminacion_cuenta`, y `motivo` pasa a ser **tipado** — como texto libre podía contener datos reidentificables.

### 3.4 Fuentes externas

**`CONECTOR`** — resuelve M-12, M-37, M-38.

Cuelga de `USUARIO`, no de la organización: RF-05 exige consentimiento explícito de una persona, y sin este campo no se sabe quién consintió. Las credenciales se desglosan en `token_cifrado`, `refresco_cifrado` y `expira_en` en vez de un único campo de texto multivaluado. `ultima_sincronizacion` y `ultimo_error` son los datos que RNF-16 y RNF-17 necesitan como referencia.

`tipo` tiene **dominio cerrado** según lo que permita el ADR-005. Ver la sección 7: esto depende de V-01.

**`INGESTA_DOCUMENTO`** — resuelve M-48. RN-25 limita a tres subidas diarias del mismo PDF por usuario, y no había dónde llevar la cuenta.

### 3.5 Alertas y notificaciones

**`CONFIGURACION_ALERTA`** y **`ANTICIPACION_ALERTA`** — resuelven M-04 y el conflicto que la sección 8.5 había dejado abierto.

La corrección original proponía una sola entidad con un campo de días de anticipación. Eso **no podía expresar** el doble recordatorio anual de RN-02 (7 días y 24 horas antes) ni la regla 48/24 de RN-04. Separar la anticipación en su propia entidad, con una fila por recordatorio, resuelve las dos.

> **Ventaja secundaria:** esta estructura sirve tanto si CN-01 se resuelve a favor del requisito —anticipación configurable de 1 a 14 días— como si se resuelve a favor de las reglas de negocio, con valores fijos. En el segundo caso las filas simplemente no se editan desde la interfaz. **El modelo no bloquea esa decisión.**

**`ANOMALIA`** — resuelve M-36. El modelo original confundía la anomalía detectada con la notificación emitida. Son cosas distintas: RF-07 dice que si el usuario desactiva la alerta de alza de tarifa, las anomalías **siguen visibles en el panel** aunque no se notifiquen. Con una sola entidad eso es inexpresable. `revisada_en` es la marca de «revisada» que RF-07 pide.

**`NOTIFICACION`** — resuelve M-06 y M-10.

Ahora cuelga de `USUARIO`. Antes colgaba de `ORGANIZACION` mientras `DISPOSITIVO` colgaba de `USUARIO`, de modo que **no había forma de saber a qué teléfono enviar un push** — y RF-09 lo exige en móvil, donde está el 84,2% de los encuestados.

`id_suscripcion` **admite nulo**: la alerta de presupuesto excedido de RF-13 no corresponde a ninguna suscripción.

### 3.6 Asistente, plan y presupuesto

**`PRESUPUESTO`** — resuelve M-05 y el vacío de §8.5. Lleva `moneda` y período (`anio`, `mes`): sin moneda, la comparación con un gasto proyectado que RF-11 obliga a desglosar por moneda queda matemáticamente indefinida. Único por `(id_usuario, anio, mes)`.

**`PLAN_CONTRATADO`** — resuelve M-07 y M-35. RF-17 exige que al fallar una renovación el plan vuelva a gratuito **al terminar el período ya pagado**; sin período ni estado de pago, sus tres criterios de aceptación son inverificables.

**Nunca almacena datos de tarjeta**: solo `referencia_pasarela`, el identificador que devuelve el proveedor de pago.

Como `CONSENTIMIENTO`, **no lleva clave foránea dura a `USUARIO`**: `id_usuario` admite nulo y se vacía al eliminar la cuenta, momento en que `seudonimo_titular` toma su lugar. `fecha_eliminacion_cuenta` y `purga_en` son las columnas sobre las cuales se ejecuta la purga: sin ellas, el plazo de conservación no tendría desde cuándo contarse.

**`RECOMENDACION`** y **`RECOMENDACION_SUSCRIPCION`** — la tabla puente recibe **clave primaria compuesta** (M-15); sin ella admitía filas duplicadas. Lleva además campo de titular propio (M-26). `RECOMENDACION` gana `moneda` para el ahorro estimado.

**`CONVERSACION`** y **`MENSAJE`** — `rol` pasa a llamarse **`emisor`** (M-18): colisionaba con el rol de `USUARIO`, que significa otra cosa. `es_degradada` marca la respuesta predeterminada de RN-24, que no consumió la API — sin esa marca, el contador de `CONSUMO_IA` sería incorrecto.

---

## 4. Enumerados

Todos los campos de dominio cerrado del modelo, incluidos los seis que nombra M-16 y los de M-53. Antes eran cadenas libres.

| Campo | Valores |
|---|---|
| `SUSCRIPCION.estado` | `prueba_gratuita` · `activa` · `pausada` · `por_confirmar` · `fantasma` · `cancelada` |
| `SUSCRIPCION.ciclo_facturacion` | `semanal` · `mensual` · `anual` |
| `SUSCRIPCION.origen_deteccion` | `manual` · `csv` · `pdf` · `correo` |
| `MOVIMIENTO.estado` | `candidato` · `confirmado` · `descartado` |
| `USO.unidad` | `minutos` · `veces` · `si_no` |
| `USO.origen` | `manual` · `conector` |
| `CONECTOR.tipo` | `correo` · `archivo` — ver sección 7 |
| `CONFIGURACION_ALERTA.tipo` | `proximo_cobro` · `fin_prueba` · `anomalia` · `presupuesto` |
| `NOTIFICACION.canal` | `correo` · `push` · `in_app` |
| `ANOMALIA.tipo` | `alza_tarifa` · `doble_cobro` |
| `MENSAJE.emisor` | `usuario` · `asistente` |
| `CONSENTIMIENTO.alcance` | `tratamiento_datos_cuenta` · `lectura_correo` · `uso_conector` |
| `PLAN_CONTRATADO.estado_pago` | `confirmado` · `rechazado` · `pendiente` |
| `INTENTO_ACCESO_CRUZADO.resultado` | `denegado` · `no_existe` |
| `USUARIO.plan` | `gratuito` · `premium` |
| `NOTIFICACION.tipo` | `proximo_cobro` · `fin_prueba` · `alza_tarifa` · `doble_cobro` · `presupuesto` |
| `NOTIFICACION.estado` | `programada` · `enviada` · `fallida` · `cancelada` |
| `MOVIMIENTO.origen` | `manual` · `csv` · `pdf` · `correo` · `conector` |
| `CONECTOR.estado` | `conectado` · `expirado` · `revocado` · `con_error` |
| `RECOMENDACION.tipo` | `cancelar` · `solapamiento` · `cambio_plan` |
| `RECOMENDACION.estado` | `pendiente` · `aceptada` · `descartada` |
| `DISPOSITIVO.plataforma` | `android` · `ios` · `web` |
| `CONFIGURACION_ALERTA.canal` | `correo` · `push` · `in_app` |
| `HISTORIAL_ESTADO.motivo` | Las causas de RN-15 y RN-17 a RN-21: `fin_prueba` · `sin_uso_45d` · `sin_cobro_60d` · `sin_cobro_90d` · `cobro_detectado` · `baja_manual` · `pausa_manual` |

⚠ El enumerado de `SUSCRIPCION.estado` usa los **seis estados de las reglas de negocio**, no los cinco de RF-03, y llama al estado dudoso `por_confirmar`. Ambas cosas dependen de CN-03 y CN-04. Ver sección 7.

---

## 5. Reglas de borrado

Resuelven M-24 y M-25. El modelo original no declaraba semántica de borrado en **ninguna** de sus quince relaciones, y por eso RF-10 era inimplementable: un borrado físico o violaba las claves foráneas, o exigía una cascada que eliminaba justo los cobros que RF-10 manda conservar.

### 5.1 Al eliminar una suscripción (RF-10)

| Entidad | Qué ocurre |
|---|---|
| `SUSCRIPCION` | Se marca `fecha_eliminacion`. **No se borra físicamente** |
| `MOVIMIENTO` | **Se conserva.** RF-10 dice que los cobros históricos permanecen en los informes ya generados |
| `HISTORIAL_ESTADO` | **Se conserva.** RNF-13 obliga a retenerlo |
| `NOTIFICACION` pendiente en cola | Se elimina (RN-03) |
| `NOTIFICACION` ya enviada | Se conserva |
| `USO` | Se conserva mientras exista el movimiento asociado |
| `RECOMENDACION_SUSCRIPCION` | Se elimina la fila puente. Si la recomendación queda sin suscripciones, se revisa |

**Regla adicional:** RN-21 —«si se detecta un cobro nuevo, la suscripción vuelve a activa»— **no reactiva una suscripción eliminada**.

### 5.2 Al eliminar la cuenta (RF-01.7, en 72 horas)

| Entidad | Qué ocurre |
|---|---|
| `USUARIO`, `IDENTIDAD_EXTERNA`, `TOKEN_VERIFICACION`, `DISPOSITIVO` | Se eliminan |
| `SUSCRIPCION`, `USO`, `MOVIMIENTO`, `PRESUPUESTO`, `CONFIGURACION_ALERTA`, `NOTIFICACION`, `ANOMALIA`, `RECOMENDACION`, `CONVERSACION`, `MENSAJE`, `INGESTA_DOCUMENTO` | Se eliminan en cascada desde `id_usuario` |
| `CONECTOR` | Tokens revocados **de inmediato**, antes que el resto |
| `HISTORIAL_ESTADO` | **Se anonimiza**: `id_usuario` **y** `id_suscripcion` a nulo —ambos son identificadores reidentificables— y se llenan `seudonimo` y `fecha_eliminacion_cuenta`. Desde ese momento el filtro de la sección 5.4 opera sobre `seudonimo`. Purga a los 12 meses por esa fecha |
| `CONSENTIMIENTO` | **Sobrevive disociado 6 años.** No se consulta ni se exporta desde la aplicación |
| `PLAN_CONTRATADO`, registro operativo | `id_usuario` **a nulo** a las 72 h. No hay clave foránea dura a `USUARIO`: con cascada se destruiría la evidencia tributaria, y con clave foránea viva no se podría eliminar la cuenta |
| `PLAN_CONTRATADO`, comprobante | **Sobrevive disociado** por `seudonimo_titular`. `fecha_eliminacion_cuenta` marca desde cuándo se cuentan los 6 años y `purga_en` fija la eliminación definitiva |
| `INTENTO_ACCESO_CRUZADO` | La referencia de cuenta se disocia; el registro sobrevive |
| `CONSUMO_IA` | Se elimina |

> **Precisión técnica (M-25, por ADR-002).** Las cascadas que cruzan esquemas de servicio **no pueden ser `ON DELETE CASCADE` del motor**, porque no hay claves foráneas entre esquemas. Son reglas lógicas sostenidas por eventos. Al llevar este modelo a la implementación hay que decir cuáles ejecuta el motor y cuáles el mecanismo de eventos.

### 5.3 Al revocar un conector (M-29)

Se eliminan los movimientos **cuyo único origen sea ese conector** — los de origen manual, CSV o PDF permanecen — y los registros de `USO` con ese `id_conector`. El `CONSENTIMIENTO` correspondiente **no se borra**: se le pone `revocado_en`.

### 5.4 Coherencia de titular (M-30)

Donde una entidad lleva a la vez campo de titular y una clave foránea a otra entidad con titular —`NOTIFICACION`, `MOVIMIENTO`, `USO`, `ANOMALIA`, `RECOMENDACION_SUSCRIPCION`—, debe verificarse que **ambos titulares coincidan**. Sin esa restricción, las claves foráneas redundantes permiten cruzar de cuenta.

### 5.5 Campos con datos sensibles (M-47)

Los que RN-23 obliga a sanear antes de enviar cualquier texto a la API de IA: `MOVIMIENTO.glosa_original`, `MOVIMIENTO.glosa_normalizada`, `SUSCRIPCION.notas` y `MENSAJE.contenido`. `HISTORIAL_ESTADO.motivo` ya no aplica: pasó a ser tipado.

---

## 6. Delta si C-03 se resuelve como hogar

**No hay que redibujar el modelo.** Los cambios son estos:

1. **Agregar `ORGANIZACION`** con `id_organizacion`, `nombre`, `fecha_creacion`.
2. **Agregar `USUARIO.id_organizacion`** y **`USUARIO.rol`** con valores `titular` e `integrante`.
3. **Reemplazar `id_usuario` por `id_organizacion`** como campo de titular en: `SUSCRIPCION`, `USO`, `MOVIMIENTO`, `HISTORIAL_ESTADO`, `CONECTOR`, `PRESUPUESTO`, `RECOMENDACION`, `RECOMENDACION_SUSCRIPCION`, `ANOMALIA`.
4. **Mantener además `id_usuario` en `SUSCRIPCION`** para saber de quién es cada una, y agregar `es_pagador` si se quiere la figura del pagador que define el glosario.
5. **`NOTIFICACION`, `DISPOSITIVO`, `CONVERSACION`, `MENSAJE`, `CONSUMO_IA` y `CONFIGURACION_ALERTA` siguen colgando de `USUARIO`**: una notificación va a una persona, no a un hogar (M-52).
6. **Rehacer las reglas de borrado de la sección 5.2**: al eliminar a un integrante hay que decidir, entidad por entidad, si el dato se borra, se transfiere al titular o se anonimiza.
7. **Reescribir RF-20**, que hoy prohíbe exactamente lo que el hogar necesita.
8. **Escribir las historias y casos de uso que faltan**: invitar integrante, asignar rol, repartir un gasto.

Los puntos 7 y 8 son el costo real de esta opción, y no son de modelado de datos.

---

## 7. Lo que este modelo NO decide

Tres puntos quedaron resueltos **de una manera concreta porque un diagrama no puede quedar en blanco**, pero la decisión sigue siendo del equipo. Si se resuelven al revés, hay que ajustar:

| Decisión abierta | Lo que este modelo asumió | Qué cambia si se decide al revés |
|---|---|---|
| **C-03** · individual u hogar | Individual | El delta completo de la sección 6 |
| **V-01** · alcance de conectores | `CONECTOR.tipo` = `correo` \| `archivo`, aplicando el ADR-005 | Si se revierte el ADR-005, se agrega `banco` y vuelve `CU-12` |
| **CN-03 / CN-04** · los estados | Los seis de las reglas de negocio, con `por_confirmar` | Si RF-03 gana, son cinco y el estado se llama `dudosa`; habría que eliminar `pausada` |
| **C-04** · alcance del chat | El chat conserva historial | Si no lo conserva, `CONVERSACION` y `MENSAJE` se reducen o desaparecen |

Además, **tres transiciones de estado siguen sin regla** y este modelo no las inventa: cómo se sale de `fantasma`, qué ocurre si el usuario responde que su suscripción sigue vigente en `por_confirmar`, y cómo se entra y se sale de `pausada`. El enumerado las admite; la regla la tiene que escribir el Product Owner.

---

## 8. Trabajo que queda en `modelo-datos.puml`

Seis hallazgos son del **modelo de arquitectura**, no de este MER, y siguen abiertos:

| Hallazgo | Qué falta en el puml |
|---|---|
| M-21 | No tiene ninguna entidad de auditoría en sus cinco esquemas, pese a RNF-13 |
| M-22 | Tampoco tiene el registro de intentos de acceso cruzado de RNF-19 |
| M-23 | Su `ultima_actividad` está en `dispositivo` y mide el dispositivo push; los usuarios solo-web no registran ninguno, de modo que no cumple RNF-20 |
| M-50 | No puede representar la recomendación que abarca varias suscripciones de RN-16 |
| M-34, M-52 | El chat no existe en el puml |
| M-56 | Nomenclatura y tipos divergen entre ambos modelos, y cada uno tiene campos que el otro perdió |

Lo razonable es **regenerar `modelo-datos.puml` desde este MER**, repartiendo las entidades por esquema de servicio según el ADR-002, en vez de corregir los dos modelos por separado y que vuelvan a divergir.
