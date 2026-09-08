# Revisión del modelo entidad-relación

**Fecha:** 4 de septiembre de 2026
**Objeto:** el MER propuesto por el equipo, transcrito en [mer-equipo.md](diagramas/mer-equipo.md)
**Contrastado contra:** [requisitos vigentes](investigacion/requisitos-vigentes.md) · [matriz de trazabilidad](MATRIZ-DE-TRAZABILIDAD.md) · [ADR-005](arquitectura/ADR-005-origen-datos-cobros.md)

---

## 1. Veredicto

El modelo está **bien construido**: nomenclatura consistente, claves primarias y foráneas declaradas, tabla puente para la relación muchos-a-muchos, historial de estados separado de la entidad principal. Como pieza de ingeniería está por encima de lo que suele verse en una primera versión.

El problema es de otro orden: **modela un producto distinto al que especifican los requisitos**.

Cuatro entidades cuelgan de `ORGANIZACION` —`SUSCRIPCION`, `CONECTOR`, `RECOMENDACION`, `NOTIFICACION`— y **no existe ninguna relación entre `USUARIO` y `SUSCRIPCION`**. El modelo describe un producto de equipos u hogares. Los requisitos y el diagrama de casos de uso describen un producto individual.

Además, **seis requisitos funcionales no pueden implementarse** con este modelo, porque los datos que exigen no tienen dónde vivir.

---

## 2. Lo que está bien y conviene no tocar

| Acierto | Por qué |
|---|---|
| `HISTORIAL_ESTADO` como entidad separada | Sirve a la vez a RF-03 (ciclo de vida) y a RNF-13 (auditoría). Separarlo de `SUSCRIPCION` es la decisión correcta |
| `RECOMENDACION_SUSCRIPCION` como tabla puente | Una recomendación puede abarcar varias suscripciones —el solapamiento de servicios de RF-18—. La relación M:N está bien vista |
| `glosa_original` **y** `glosa_normalizada` en `MOVIMIENTO` | Guardar ambas permite auditar la normalización cuando la detección falla. Es un detalle de oficio |
| `CATEGORIA` sin `id_organizacion` | Correcto: RF-06 define un catálogo fijo de diez categorías, no un catálogo por cliente |
| `credenciales_cifradas` nombrado explícitamente | Deja RNF-03 visible en el modelo en vez de dejarlo a criterio de quien implemente |
| `origen_deteccion` en `SUSCRIPCION` | Es exactamente lo que exige el criterio de RF-05: registrar si vino de csv, pdf o correo |
| `DISPOSITIVO` con `token_push` y `plataforma` | La estructura para el push móvil es correcta, aunque no se pueda conectar (ver M-06) |

---

## 3. Resumen de hallazgos

| ID | Hallazgo | Severidad | Rompe |
|---|---|---|---|
| **M-01** | Todo cuelga de `ORGANIZACION`; no hay relación `USUARIO`–`SUSCRIPCION` | Alta | RF-20, C-03 |
| **M-02** | No existe entidad de uso de un servicio | Alta | RF-04, CU-31 |
| **M-03** | No hay marca ni fecha de término de prueba gratuita | Alta | RF-02, CU-28 |
| **M-04** | No hay dónde guardar la configuración de alertas | Alta | RF-09 |
| **M-05** | No hay dónde guardar el presupuesto ideal | Alta | RF-13 |
| **M-06** | La cadena para enviar una notificación push está rota | Alta | RF-09 |
| **M-07** | No hay pago ni período pagado del plan Premium | Alta | RF-17 |
| **M-08** | Un cobro candidato no confirmado no tiene dónde guardarse | Alta | RF-05 |
| **M-09** | `MOVIMIENTO` no tiene moneda | Media | RF-11 |
| **M-10** | `NOTIFICACION.id_suscripcion` obligatoria deja fuera la alerta de presupuesto | Media | RF-13 |
| **M-11** | La guía de cancelación vive en `NOTIFICACION` | Media | RF-16 |
| **M-12** | `CONECTOR` sigue admitiendo bancos | Media | ADR-005 |
| **M-13** | No hay registro del consentimiento para leer el correo | Media | RF-05, Ley 21.719 |
| **M-14** | `RECOMENDACION` cuelga de la organización, pero el plan está en el usuario | Media | RF-18 |
| **M-15** | `RECOMENDACION_SUSCRIPCION` no declara clave primaria | Baja | — |
| **M-16** | Los estados y tipos son cadenas libres | Baja | RF-03 |
| **M-17** | `decimal` sin precisión declarada para dinero | Baja | — |
| **M-18** | `MENSAJE.rol` y `USUARIO.rol` significan cosas distintas | Baja | — |
| **M-19** | No hay campo de notas | Baja | RF-08 |

---

## 4. Detalle

### M-01 · Todo cuelga de ORGANIZACION y no hay relación USUARIO–SUSCRIPCION

**Severidad alta.** Es el hallazgo de fondo; los demás son consecuencias o detalles al lado de este.

`SUSCRIPCION`, `CONECTOR`, `RECOMENDACION` y `NOTIFICACION` tienen `id_organizacion` como clave foránea. Ninguna tiene `id_usuario`. La única forma de llegar de un usuario a una suscripción es pasando por la organización, lo que significa que **todos los usuarios de una organización comparten las mismas suscripciones**.

RF-20 dice:

> Toda consulta o cambio sobre suscripciones, cobros, uso, alertas, recomendaciones y chat aplica exclusivamente a la **cuenta autenticada**. Un usuario no puede acceder a recursos de otro, ni siquiera conociendo su identificador.

Con este modelo **eso no se puede cumplir**, porque la suscripción no sabe de qué usuario es. Las dos pruebas de la matriz que lo verifican —TC-51 y TC-52— no tienen forma de pasar.

Tampoco se puede responder «quién registró esta suscripción», que es una pregunta que el producto necesita responder en cuanto haya más de una persona.

Esto es el conflicto **C-03** —usuario individual u hogar— sin resolver, ahora incorporado a la base de datos. Y el resto del modelado apunta al otro lado: el diagrama de casos de uso tiene tres actores, Usuario, Usuario autenticado y Usuario Premium, y ninguno es una organización o un grupo.

**Corrección, según cómo se resuelva C-03:**

- **Si el producto es individual** (lo que hoy dicen los casos de uso y las historias): eliminar `ORGANIZACION` y `USUARIO.rol`, y reemplazar `id_organizacion` por `id_usuario` en las cuatro entidades. El modelo se simplifica y RF-20 pasa a cumplirse por construcción.
- **Si el producto es de hogar**: mantener `ORGANIZACION`, pero **agregar de todos modos `id_usuario` a `SUSCRIPCION`** para saber de quién es cada una, y **reescribir RF-20**, porque hoy prohíbe justamente lo que el modelo permite.

Lo que no se sostiene es dejarlo como está: el modelo y el requisito se contradicen.

### M-02 · No existe entidad de uso de un servicio

**Severidad alta.** RF-04 dice:

> Permite registrar uso manual (**minutos, veces o sí la usé / no la usé**) **en una fecha** para una suscripción propia.

El modelo solo tiene `SUSCRIPCION.fecha_ultimo_uso`: un único valor escalar. No hay historial, no hay cantidad, no hay unidad. Con eso:

- No se puede registrar «vi 90 minutos el 12 de agosto».
- No se puede calcular el **costo por hora de uso**, que aparece en las cuatro pantallas del mockup y es la métrica que diferencia el producto de una planilla de gastos.
- CU-31 «Detectar suscripción fantasma» solo puede mirar la última fecha, no un patrón de uso.
- RF-18 promete explicar una recomendación citando «último uso», con un solo dato disponible.

**Corrección.** Agregar:

```
USO
  id_uso            int   PK
  id_suscripcion    int   FK
  fecha             date
  cantidad          decimal      -- nulo si el registro es de tipo booleano
  unidad            string       -- minutos | veces | si_no
  origen            string       -- manual | conector
```

`SUSCRIPCION.fecha_ultimo_uso` puede quedarse como campo derivado por rendimiento, pero debe declararse como tal.

### M-03 · No hay marca ni fecha de término de prueba gratuita

**Severidad alta.** RF-02 exige registrar «si aplica, marca de prueba gratuita con su fecha de término», y su criterio de aceptación dice:

> Dado que marca prueba gratuita sin indicar fecha de término, entonces **se rechaza el registro**.

Ese criterio no se puede implementar: en `SUSCRIPCION` no existen ni la marca ni la fecha. `estado` podría valer «prueba», pero la **fecha de término** no tiene dónde guardarse.

Eso además deja sin datos a CU-28 «Notificar fin de prueba gratuita» y a RF-09. Las alertas de fin de prueba son el segundo hallazgo más pedido del estudio de validación —el 60,5%— y el 65,8% de los encuestados ya fue cobrado por una prueba que no canceló.

**Corrección.** Agregar a `SUSCRIPCION`:

```
  es_prueba_gratuita   boolean
  fecha_fin_prueba     date      -- obligatorio si es_prueba_gratuita
```

### M-04 · No hay dónde guardar la configuración de alertas

**Severidad alta.** RF-09 exige:

> activar o desactivar, **de forma independiente**, las alertas de próximo cobro, fin de prueba gratuita y alza de tarifa / doble cobro, con anticipación configurable **de 1 a 14 días** (por defecto 3).

`NOTIFICACION` guarda las alertas **ya emitidas**, no las preferencias. No hay ninguna entidad ni atributo para esa configuración, y RF-09 es el requisito de prioridad más alta del proyecto: lo pide el 76,3% de los encuestados.

**Corrección.** Agregar:

```
CONFIGURACION_ALERTA
  id_configuracion   int      PK
  id_usuario         int      FK
  tipo               string   -- proximo_cobro | fin_prueba | anomalia | presupuesto
  activa             boolean
  dias_anticipacion  int      -- 1 a 14, por defecto 3; nulo donde no aplique
```

### M-05 · No hay dónde guardar el presupuesto ideal

**Severidad alta.** RF-13 pide guardar «un monto mensual ideal mayor a 0 para el conjunto de suscripciones». No existe el campo en `USUARIO`, ni en `ORGANIZACION`, ni una entidad propia. RF-13 no se puede implementar.

**Corrección.** Un campo `presupuesto_mensual decimal` en el titular de la cuenta, o una entidad `PRESUPUESTO` si más adelante se quiere historial de presupuestos.

### M-06 · La cadena para enviar una notificación push está rota

**Severidad alta.** `DISPOSITIVO`, que contiene el `token_push`, cuelga de `USUARIO`. `NOTIFICACION` cuelga de `ORGANIZACION`. **No hay forma de unir las dos.**

Es decir: dada una notificación, el sistema **no puede saber a qué teléfono enviarla**. RF-09 exige el push en móvil, y el 84,2% de los encuestados usaría la solución en el teléfono.

**Corrección.** `NOTIFICACION` debe apuntar a `USUARIO`, no a `ORGANIZACION`. Se resuelve solo si se aplica M-01.

### M-07 · No hay pago ni período pagado del plan Premium

**Severidad alta.** RF-17 exige contratar Premium «con un método de pago válido» y establece:

> Si una renovación de Premium falla o el usuario cancela su suscripción Premium, el plan vuelve a gratuito **al finalizar el período ya pagado**, sin interrumpir el acceso de forma retroactiva.

`USUARIO.plan` es una cadena sin fecha de vencimiento. No hay método de pago, no hay pago confirmado ni rechazado, no hay período pagado. Los tres criterios de aceptación de RF-17 —TC-44, TC-45 y TC-46— no se pueden verificar.

**Corrección.** Agregar una entidad de suscripción al plan, con período de vigencia y estado de los pagos. Nota de seguridad: **no se almacenan datos de tarjeta**; solo el identificador que devuelve la pasarela de pago.

### M-08 · Un cobro candidato no confirmado no tiene dónde guardarse

**Severidad alta.** RF-05 establece:

> **Toda detección queda pendiente hasta que el usuario la acepte o la descarte**; el sistema no crea registros automáticos sin esa confirmación.

Pero `MOVIMIENTO.id_suscripcion` es clave foránea, y un candidato que todavía no se confirma **no tiene suscripción asociada**. No hay dónde dejarlo mientras espera la decisión del usuario. Y el criterio dice que si lo descarta «no se persiste en ningún lugar», lo que exige poder borrarlo.

**Corrección.** Dos opciones. La mínima es permitir `id_suscripcion` nulo y agregar un campo `estado` al movimiento —candidato, confirmado, descartado—. La más limpia es una entidad `CANDIDATO_COBRO` separada, que desaparece al confirmarse o descartarse.

### M-09 · MOVIMIENTO no tiene moneda

**Severidad media.** `SUSCRIPCION` tiene `moneda`, pero `MOVIMIENTO` no. Un cobro puede llegar en una moneda distinta a la declarada, y RF-11 exige:

> Si existen suscripciones en más de una moneda, el total se muestra **desglosado por moneda** en vez de sumarse en una sola cifra.

Sin moneda en el movimiento, ese desglose se calcula sobre un supuesto. **Corrección:** agregar `moneda` a `MOVIMIENTO`.

### M-10 · NOTIFICACION.id_suscripcion obligatoria deja fuera la alerta de presupuesto

**Severidad media.** RF-13 genera una alerta cuando el gasto proyectado supera el presupuesto. Esa alerta **no corresponde a ninguna suscripción en particular**, sino al total. Con la clave foránea obligatoria, no se puede registrar.

**Corrección.** `id_suscripcion` debe admitir nulo.

### M-11 · La guía de cancelación vive en NOTIFICACION

**Severidad media.** `url_cancelacion` está en `NOTIFICACION`. Pero RF-16 la describe como una consulta sobre la suscripción:

> Muestra, para una suscripción propia, **los pasos** para cancelar el servicio directamente en el proveedor (guía específica o genérica).

Dos problemas. Si nunca se emitió una notificación para esa suscripción, no hay guía que consultar. Y la guía son «pasos ordenados», no una sola dirección web.

**Corrección.** Una entidad `GUIA_CANCELACION` asociada al servicio, con pasos ordenados y una guía genérica de respaldo.

### M-12 · CONECTOR sigue admitiendo bancos

**Severidad media.** `CONECTOR.tipo` y `CONECTOR.proveedor` son cadenas libres, sin ninguna restricción que impida un conector bancario. El ADR-005 del propio proyecto ya descartó la conexión bancaria, y el vacío V-01 de la matriz recoge esa contradicción.

**Corrección.** Restringir `tipo` a los valores que el ADR-005 permite —correo, archivo—, o dejar constancia explícita de que el banco es un valor previsto pero fuera del alcance actual.

### M-13 · No hay registro del consentimiento para leer el correo

**Severidad media.** RF-05 exige consentimiento «**explícito y revocable, distinto de los términos generales de la cuenta**», y su criterio dice que aceptar solo los términos de la app no habilita la lectura del correo.

El modelo no registra ese consentimiento: ni cuándo se dio, ni sobre qué, ni cuándo se revocó. `CONECTOR.estado` puede decir si está conectado, pero no es lo mismo que el consentimiento, y la Ley 21.719 exige poder acreditarlo.

**Corrección.** Una entidad `CONSENTIMIENTO` con usuario, alcance, fecha de otorgamiento y fecha de revocación. Los registros de consentimiento se conservan aunque el conector se elimine: son la prueba de que el tratamiento fue lícito.

### M-14 · RECOMENDACION cuelga de la organización, pero el plan está en el usuario

**Severidad media.** `USUARIO.plan` determina si alguien tiene Premium. `RECOMENDACION.id_organizacion` hace que las recomendaciones pertenezcan a la organización. Si en una organización hay un usuario Premium y otro gratuito, no está definido quién puede ver las recomendaciones que se generaron. RF-18 exige que el plan gratuito vea la función bloqueada.

Se resuelve al aplicar M-01.

### M-15 · RECOMENDACION_SUSCRIPCION no declara clave primaria

**Severidad baja.** La tabla puente tiene dos claves foráneas y ninguna clave primaria, de modo que admite filas duplicadas. **Corrección:** clave primaria compuesta por las dos columnas.

### M-16 · Los estados y tipos son cadenas libres

**Severidad baja, pero conviene resolverla junto con RF-03.** `SUSCRIPCION.estado` admite cualquier texto, cuando RF-03 define una máquina de estados con valores cerrados: prueba, activa, dudosa, cancelada, fantasma. Lo mismo ocurre con `origen_deteccion`, `NOTIFICACION.canal`, `NOTIFICACION.tipo`, `USUARIO.plan` y `CONECTOR.tipo`.

Un tipo enumerado deja el conjunto de valores válidos en el modelo, donde se puede revisar, en vez de repartirlo por el código.

### M-17 · decimal sin precisión declarada para dinero

**Severidad baja.** `monto` y `ahorro_estimado` figuran como `decimal` a secas. Conviene declarar precisión y escala, y dejar dicho cómo se guardan las monedas sin decimales, como el peso chileno.

### M-18 · MENSAJE.rol y USUARIO.rol significan cosas distintas

**Severidad baja.** En `MENSAJE`, `rol` distingue quién habló en el chat —el usuario o el asistente—. En `USUARIO`, `rol` es un permiso. Mismo nombre, conceptos sin relación. **Corrección:** renombrar el del mensaje a `emisor` o `autor`.

### M-19 · No hay campo de notas

**Severidad baja.** RF-08 permite modificar «nombre, monto, frecuencia, fecha de cobro, categoría, **notas** y marca de prueba gratuita». El campo de notas no existe.

---

## 5. Cambios propuestos, en resumen

Consolida los 56 hallazgos: M-01 a M-19 de la primera revisión y M-20 a M-56 de la revisión paralela de la sección 8. **Es la lista de trabajo para redibujar el MER.**

Los marcados con 🔒 esperan una decisión abierta; el resto es ejecutable ya.

### 5.1 Entidades nuevas

| Entidad | Para qué | Hallazgo |
|---|---|---|
| `USO` | Registro de uso por fecha, cantidad y unidad. Sin esto no existe el costo por hora de uso | M-02 · RF-04, CU-31 |
| `CONFIGURACION_ALERTA` | Qué alertas están activas y con cuánta anticipación | M-04 · RF-09 |
| `SUSCRIPCION_PLAN` | Período pagado, estado del pago y renovación del plan Premium | M-07, M-35 · RF-17 |
| `CONSENTIMIENTO` | Alcance, fecha, hora y versión del texto aceptado. Sobrevive disociado a la eliminación de la cuenta | M-13, M-20 · RF-01.1, RF-05 |
| `GUIA_CANCELACION` | Pasos ordenados de cancelación, con guía genérica de respaldo | M-11 · RF-16 |
| `TOKEN_VERIFICACION` | Enlaces de un solo uso, su expiración y su consumo; correo pendiente de verificar | M-32 · RF-01.4, RF-01.5 |
| `INTENTO_ACCESO_CRUZADO` | Marca de tiempo, cuenta, recurso y resultado de cada acceso denegado | M-22 · RNF-19, PNF-19 |
| `CONSUMO_IA` | Llamadas reales a la API externa por usuario y mes | M-23 · RNF-20, PNF-20 |
| `PROVEEDOR` | Catálogo de servicios. Sin él no se reconoce «el mismo comercio» ni la guía tiene ancla | M-27 · RN-11 |

⚠ **Dos advertencias sobre esta tabla, de la sección 8.5:**

- `CONFIGURACION_ALERTA` tal como está propuesta **no puede expresar** el doble recordatorio anual de RN-02, la regla 48/24 de RN-04 ni el tope diario de RN-08. Si CN-01 y CN-02 se resuelven a favor de las reglas de negocio, esta entidad se rehace entera.
- Al adoptar `PROVEEDOR` hay que **mantener `id_categoria` en `SUSCRIPCION`**. Copiar el catálogo del puml sin más rompe RF-06, que exige una categoría por suscripción que el usuario puede cambiar cuando quiera.

### 5.2 Atributos nuevos

| Entidad | Campo | Hallazgo |
|---|---|---|
| `SUSCRIPCION` | `es_prueba_gratuita`, `fecha_fin_prueba` | M-03 · RF-02, CU-28 |
| `SUSCRIPCION` | `notas` | M-19 · RF-08 |
| `SUSCRIPCION` | `eliminada` o `fecha_eliminacion`, independiente de `estado` | M-24 · RF-10 |
| Titular de la cuenta | `presupuesto_mensual`, **con moneda y período** | M-05 · RF-13 |
| Titular de la cuenta | `ultima_actividad`, actualizado en cada emisión de token | M-23 · RNF-20 |
| `USUARIO` | Zona horaria. Sin ella el horario de descanso de RN-09 es inimplementable | 8.5 · RN-09 |
| `USUARIO` | Identidad de Google; hoy `password_hash` queda obligatorio de hecho | M-33 · RF-01.3 |
| `MOVIMIENTO` | `moneda` | M-09 · RF-11 |
| `MOVIMIENTO` | `estado`: candidato, confirmado, descartado | M-08 · RF-05 |
| `HISTORIAL_ESTADO` | `seudonimo` y `fecha_eliminacion_cuenta`, ambos nulos mientras la cuenta viva | M-21 · RF-01.7 |
| `NOTIFICACION` | Marca de leída o revisada; separar la anomalía detectada de la notificación emitida | M-36 |
| `CONECTOR` | `ultima_sincronizacion`, `ultimo_error`, `expira_en` | M-37 · RNF-16, RNF-17 |
| `CONECTOR` | `id_usuario`; y desglosar `credenciales_cifradas`, hoy multivaluado en un solo campo | M-38 |
| `MOVIMIENTO`, `HISTORIAL_ESTADO`, `RECOMENDACION_SUSCRIPCION` | **Campo de propietario.** Hoy no tienen ninguno: la propiedad solo se resuelve por JOIN | M-26 · RNF-19 |

### 5.3 Cambios en relaciones

| Cambio | Hallazgo |
|---|---|
| 🔒 `SUSCRIPCION`, `CONECTOR`, `RECOMENDACION` y `NOTIFICACION` pasan a colgar de `USUARIO` | M-01, M-06, M-14, M-25, M-51 · RF-20 |
| Declarar la **regla de borrado de las quince relaciones**. Hoy no hay ninguna, y por eso RF-10 es inimplementable | M-24, M-25 |
| `NOTIFICACION.id_suscripcion` pasa a admitir nulo (la alerta de presupuesto no tiene suscripción) | M-10 · RF-13 |
| `MOVIMIENTO.id_suscripcion` pasa a admitir nulo (el candidato aún no confirmado) | M-08 · RF-05 |
| `MOVIMIENTO.id_conector` pasa a admitir nulo (el cobro manual y las cargas CSV o PDF no tienen conector) | M-28 · ADR-005 |
| `HISTORIAL_ESTADO.id_suscripcion` pasa a admitir nulo (la anonimización lo deja en nulo) | M-21 |
| `RECOMENDACION_SUSCRIPCION` recibe clave primaria compuesta | M-15 |
| Distinguir la clave foránea real de la referencia lógica que cruza servicios, conforme al ADR-002 | M-31 |

### 5.4 Dominios, tipos y restricciones

| Cambio | Hallazgo |
|---|---|
| 🔒 Enumerar `SUSCRIPCION.estado` con los **seis** estados de las reglas de negocio, no los cinco de RF-03 | M-46 · CN-03, CN-04 |
| 🔒 Cerrar el dominio de `CONECTOR.tipo` según lo que permita el ADR-005 | M-39 · V-01 |
| Cerrar los demás dominios de cadena libre: `ciclo_facturacion`, orígenes, `plataforma`, `canal` | M-16, M-53 |
| Declarar unicidad en `USUARIO.email`, `CATEGORIA.nombre` y `DISPOSITIVO.token_push` | M-49 · RF-01 |
| Instantes con zona horaria, como ya hace el puml | M-43 |
| Claves primarias `uuid` en vez de `int` secuencial, alineadas con la arquitectura | M-45 |
| `decimal` con precisión y escala declaradas; `moneda` tipada, no cadena libre | M-17, M-44 |
| Fijar los valores por defecto: estado inicial, plan, `es_recurrente_variable` | M-54 |
| Declarar la regla de recálculo de los derivados almacenados en vez de eliminarlos: `fecha_proximo_cobro`, `es_recurrente_variable`, `fecha_ultimo_uso` | M-41, M-42, 8.5 |

### 5.5 Reglas que hay que declarar en el modelo

No son campos ni entidades: son reglas que el modelo debe dejar dichas, o quedan a criterio de quien programe.

| Regla | Hallazgo |
|---|---|
| Restricción de coherencia entre las claves foráneas redundantes de `NOTIFICACION`, `RECOMENDACION` y `MOVIMIENTO`. Sin ella se puede cruzar de cuenta | M-30 |
| Qué significa «único origen» de un cobro, y qué se borra exactamente al revocar el correo | M-29 · RF-05 |
| Marca mínima de descarte —un hash de detección, sin contenido— para no regenerar eternamente el candidato que el usuario ya rechazó | 8.5 · RF-05 |
| Cómo se obtienen la fecha de cancelación y el ahorro del cementerio, hoy solo derivables y de forma frágil | M-40 · RF-14 |
| Qué campos son datos sensibles a sanear antes de llamar a la API de IA | M-47 · RN-23 |
| Dónde se registra el límite de tres subidas diarias del mismo PDF | M-48 · RN-25 |
| 🔒 Si el chat conserva historial, y con qué retención | M-34 · C-04 |
| 🔒 Marca en `MENSAJE` que distinga la respuesta predeterminada de la generada por la IA | M-55 · RN-24 |
| 🔒 Campo de tenant en el chat y en `DISPOSITIVO`, si C-03 se resuelve como hogar | M-52 |
| Renombrar `MENSAJE.rol` a `emisor`: hoy colisiona con `USUARIO.rol`, que significa otra cosa | M-18 |
| Eliminar del alcance el conector bancario, o dejarlo declarado como previsto y no implementado | M-12 · ADR-005 |

### 5.6 Cambios que corresponden a `modelo-datos.puml`, no al MER

La revisión encontró carencias del **modelo de arquitectura**, no del MER. Van aquí para que no se pierdan.

| Cambio | Hallazgo |
|---|---|
| El puml **no tiene ninguna entidad de auditoría** en sus cinco esquemas, pese a que RNF-13 la exige | M-21 |
| El puml **tampoco tiene** el registro de intentos de acceso cruzado de RNF-19 | M-22 |
| El `ultima_actividad` del puml está en `dispositivo` y mide el dispositivo push: los usuarios solo-web no registran ninguno, de modo que **no cumple RNF-20** | M-23 |
| El puml no puede representar la recomendación que abarca varias suscripciones que exige RN-16 | M-50 |
| El chat no existe en el puml | M-34, M-52 |
| Nomenclatura y tipos divergen entre ambos modelos, y cada uno tiene campos que el otro perdió | M-56 |

---

## 6. La decisión que hay que tomar antes de corregir nada

> **Corrección del 5 de septiembre.** La versión original de esta sección afirmaba que el MER «modela un producto distinto al que especifican los requisitos» y recomendaba producto individual sin haber contrastado el [glosario](glosario.md). Eso era incompleto y repartía mal la culpa. El MER **no se desvía del proyecto: implementa fielmente el vocabulario del glosario**, que define la organización como el eje del aislamiento y la suscripción como perteneciente a la organización, no a la persona. La contradicción no es entre el MER y el proyecto, sino **entre dos linajes de documentos del propio proyecto**. La sección 8.6 recalcula además el alcance del bloqueo: **22 de los 37 hallazgos nuevos no dependen de C-03** y se pueden corregir hoy.

### 6.1 Qué dice realmente el glosario

El glosario registra una decisión fechada el **2026-08-21**:

> El sistema se enfoca en B2C: personas y grupos familiares.

Conviene leerla con cuidado, porque **esa decisión resolvió B2C frente a B2B, no individual frente a hogar**. «Personas y grupos familiares» abarca las dos opciones de C-03. Y su fundamento declarado apunta, si acaso, al lado individual:

> la encuesta aplicada mide comportamiento de **consumidores individuales**. El segmento validado por los datos es el mismo que atiende el producto.

Lo que sí está del lado del hogar son los **términos** del glosario: la organización como eje del aislamiento, la suscripción perteneciente a la organización con la figura del pagador, los roles de titular e integrante, el ingreso freemium por organización. Pero el propio glosario explica de dónde vienen: se conservó el nombre neutro «organización» **a propósito**, para que el modelo de datos no cambie si algún día se atiende el segmento empresarial. Es decir, son vocabulario heredado del diseño anterior orientado a empresas, no una resolución de C-03.

**Conclusión: C-03 sigue abierto.** El glosario aporta vocabulario que hay que pesar, no una decisión que zanje el asunto. Quien defienda «individual» ante el docente **tiene que conocer este texto y poder explicar esta distinción**, o quedará expuesto.

### 6.2 Las dos opciones

| | Producto individual | Producto de hogar |
|---|---|---|
| `ORGANIZACION` | Se elimina | Se conserva |
| `USUARIO.rol` | Se elimina | Se conserva |
| Dueño de una suscripción | `USUARIO` | `ORGANIZACION`, más `id_usuario` para saber de quién es |
| RF-20 | Se cumple por construcción | **Hay que reescribirlo** |
| Casos de uso | Sin cambios | Hay que agregar invitar miembro, asignar roles, repartir gastos |
| Historias de usuario | Sin cambios | Faltan las de gestión de integrantes |
| Glosario | Hay que reescribir sus términos de dominio | Se cumple tal como está |
| MER y `modelo-datos.puml` | Hay que rehacerlos | Se cumplen tal como están |

### 6.3 Qué respalda cada lado

**A favor de individual**

- Los tres artefactos que el docente evaluó lo dicen: las **5 historias**, los **20 requisitos** y los **36 casos de uso**. Ninguno menciona hogar, integrantes ni reparto de gastos.
- **RF-20 prohíbe explícitamente** lo que el hogar necesita: «un usuario no puede acceder a recursos de otro, ni siquiera conociendo su identificador».
- El **fundamento declarado del glosario** para el segmento B2C es que la encuesta mide consumidores individuales.
- El dolor principal medido es individual: **E1**, el 68,4% paga por lo que no usa; **E3**, al 65,8% le cobraron tras una prueba. Compartir está extendido —**E13**, 57,9%— pero **solo el 28% de quienes comparten ha tenido conflictos de cobro**.

**A favor de hogar**

- Los **términos del glosario**, el **MER** y `modelo-datos.puml` ya lo implementan. Es el único lado que hoy tiene modelo de datos.
- **E13**: el 57,9% comparte alguna suscripción. Es un comportamiento mayoritario.
- El glosario le asigna **prioridad alta a «Compartir suscripción»** y define el ingreso como freemium por organización.
- Si se elige individual, hay que **rehacer el MER, el puml y los términos del glosario**, no solo el modelo de datos.

### 6.4 Recomendación

**Sigo recomendando producto individual, pero por una razón distinta a la que di antes.**

No es que la evidencia apunte ahí de forma limpia: no lo hace. El 57,9% que comparte es real y el glosario ya construyó el vocabulario del hogar. El argumento es de **coherencia con lo que se entrega y de costo**:

1. Los tres artefactos que evalúa el docente ya dicen individual, y **RF-20 no solo omite el hogar: lo prohíbe**. Elegir hogar obliga a reescribir un requisito que hoy está bien redactado y bien probado.
2. Elegir hogar exige además historias y casos de uso nuevos —invitar integrante, asignar roles, repartir un gasto— que **nadie ha escrito ni validado con la encuesta**.
3. El hogar se puede agregar después como una capa por encima del usuario sin invalidar nada de lo hecho. Lo contrario no es cierto.

**Pero la decisión es del equipo, y hay que tomarla con los dos lados a la vista.** Si se elige individual, hay que aceptar y declarar dos costos: se rehacen el MER, el puml y los términos del glosario, y se responde por qué un comportamiento del 57,9% queda fuera del alcance. La respuesta defendible existe —solo el 28% de quienes comparten reporta conflicto, frente al 68,4% del dolor principal— pero **hay que llevarla preparada**.

---

## 7. Estado de esta revisión

Los hallazgos M-01 a M-19 están verificados uno por uno contra el texto de los requisitos vigentes. No cambian con lo que sigue.

La **revisión paralela terminó el 5 de septiembre de 2026** y sus resultados están en la **sección 8**, como hallazgos M-20 a M-56. La primera pasada, lanzada el 4 de septiembre, se perdió por un corte de sesión antes de consolidar resultados; se re-ejecutó completa el 5 de septiembre, ya contra los requisitos actualizados ese mismo día —la desagregación RF-01.1 a RF-01.7 y las redefiniciones de RNF-19 y RNF-20—, de modo que la re-ejecución cubrió requisitos que la pasada perdida no conocía.

La sección 8 no repite ni corrige M-01 a M-19: los hallazgos nuevos que amplían uno anterior lo declaran («extiende M-nn»).

---

## 8. Revisión paralela — resultados (5 de septiembre de 2026)

### 8.1 Cómo se hizo

Cinco revisores independientes recorrieron el MER desde ángulos distintos —cobertura de requisitos, integridad referencial, normalización, seguridad y aislamiento, y consistencia con la matriz y los diagramas de arquitectura—, cada uno seguido de un **escéptico** que verificó cada hallazgo contra los archivos del proyecto (citas textuales, campo por campo) e intentó refutarlo; un **crítico de completitud** buscó después lo que ningún ángulo cubrió. De **71 hallazgos brutos, 70 quedaron confirmados y ninguno refutado**; ocho salieron con la severidad rebajada por su escéptico, y esa severidad ajustada es la que se usa aquí. Como los ángulos se solapan a propósito, los 70 se consolidan en **37 hallazgos únicos: M-20 a M-56**. Ninguno repite M-01 a M-19: los que amplían un hallazgo previo lo declaran como «extiende M-nn».

### 8.2 Resumen

| ID | Severidad | Hallazgo | Depende de | Relación con M-01..19 |
|---|---|---|---|---|
| **M-20** | Alta | El consentimiento de RF-01.1 (fecha, hora y versión del texto) no tiene dónde guardarse; la entidad de M-13 no basta | V-03 (solo el plazo de 6 años) | Extiende M-13 |
| **M-21** | Alta | `HISTORIAL_ESTADO` no soporta la anonimización irreversible ni la purga a 12 meses de RF-01.7; el puml no tiene auditoría | V-03 (solo los plazos) | Nuevo |
| **M-22** | Alta | No existe entidad para el registro de intentos de acceso cruzado de RNF-19; PNF-19 deja de ser ejecutable | V-03 (plazo y destino); C-03 (solo la referencia de cuenta) | Nuevo |
| **M-23** | Alta | Sin `ultima_actividad` por usuario ni contador de llamadas a la API de IA: RNF-20/PNF-20 sin datos que consultar | Ninguna | Nuevo |
| **M-24** | Alta | RF-10 (eliminar suscripción) es inimplementable: cuatro FK obligatorias hacia `SUSCRIPCION`, sin regla de borrado ni borrado lógico | Ninguna | Nuevo |
| **M-25** | Alta | La eliminación de cuenta en 72 h (RF-01.7) no tiene camino de borrado: los datos del titular cuelgan de `ORGANIZACION` | C-03 | Extiende M-01 |
| **M-26** | Alta | `MOVIMIENTO`, `HISTORIAL_ESTADO` y `RECOMENDACION_SUSCRIPCION` no tienen ningún campo de propietario | C-03 (solo el nombre del campo) | Nuevo |
| **M-27** | Media | Sin catálogo de servicio/proveedor: `nombre_servicio` libre impide reconocer «el mismo comercio»; la guía de M-11 no tiene ancla | Ninguna | Extiende M-11 |
| **M-28** | Media | `MOVIMIENTO.id_conector` obligatoria excluye el cobro manual y las cargas CSV/PDF, el piso obligatorio del ADR-005 | Ninguna | Nuevo |
| **M-30** | Media | FK redundantes sin restricción de coherencia permiten cruzar tenants en `NOTIFICACION`, `RECOMENDACION` y `MOVIMIENTO` | Ninguna | Nuevo |
| **M-31** | Media | El MER declara FK que cruzan fronteras de servicio, contra el ADR-002; no distingue FK real de referencia lógica | C-03 (solo el campo de aislamiento) | Nuevo |
| **M-32** | Media | Sin persistencia para enlaces de un solo uso, correo pendiente de verificación ni revocación de sesiones (RF-01.4/5/6/7) | Ninguna | Nuevo |
| **M-33** | Media | La identidad de Google (RF-01.3) no está modelada; `password_hash` queda implícitamente obligatorio | Ninguna | Nuevo |
| **M-34** | Media | El MER decide de hecho que el chat conserva historial con C-04 abierto; la arquitectura no modela el chat | C-04 | Nuevo |
| **M-35** | Media | Los comprobantes de pago Premium deben sobrevivir disociados 6 años a la eliminación de la cuenta | V-03 (solo el plazo) | Extiende M-07 |
| **M-36** | Media | `NOTIFICACION` confunde la anomalía detectada con la notificación emitida; sin marca de leída/revisada | Ninguna | Nuevo |
| **M-37** | Media | `CONECTOR` sin `ultima_sincronizacion`, `ultimo_error` ni `expira_en`: RNF-16/RNF-17 sin dato de referencia | Ninguna | Nuevo |
| **M-38** | Media | `CONECTOR` sin `id_usuario` y con credenciales monolíticas en un solo string | C-03 (solo `id_usuario`) | Nuevo |
| **M-39** | Media | Tipos de `CONECTOR`: adoptar el dominio cerrado que el puml ya fija (spotify, correo, csv) | V-01 | Extiende M-12 |
| **M-40** | Media | RF-14: la fecha de cancelación y el ahorro del cementerio solo se pueden derivar, y de forma frágil | Ninguna | Nuevo |
| **M-41** | Media | `fecha_proximo_cobro` es un derivado almacenado sin regla de recálculo | Ninguna | Nuevo |
| **M-42** | Media | `es_recurrente_variable` es un derivado de RN-12 sin regla de recálculo | Ninguna | Nuevo |
| **M-44** | Media | `moneda` como cadena libre; el dinero es decimal en el MER e integer en el puml | Ninguna | Extiende M-17 |
| **M-50** | Media | El puml no puede representar la recomendación multi-suscripción que RN-16 exige | Ninguna | Nuevo |
| **M-51** | Media | El plan vive en `USUARIO` en el MER y en `organizacion` en el puml: titulares contradictorios | C-03 | Extiende M-14 |
| **M-52** | Media | Chat y `DISPOSITIVO` sin campo de tenant si C-03 se resuelve como hogar; el chat no existe en el puml | C-03 | Nuevo |
| **M-29** | Baja | La revocación del correo exige modelar «único origen» del cobro y declarar la regla de revocación | Ninguna | Nuevo |
| **M-43** | Baja | Instantes modelados como `date`/`datetime` sin zona horaria; el puml usa timestamptz | Ninguna | Nuevo |
| **M-45** | Baja | Claves primarias `int` secuenciales contra el `uuid` de arquitectura | Ninguna | Nuevo |
| **M-46** | Baja | El enum de `SUSCRIPCION.estado` debe fijarse contra los seis estados de RN §6, no los cinco de RF-03 | CN-03, CN-04 | Extiende M-16 |
| **M-47** | Baja | Los datos sensibles que RN-23 obliga a sanear no están identificados ni separados en el modelo | Ninguna | Nuevo |
| **M-48** | Baja | El límite de 3 subidas diarias del mismo PDF (RN-25) no tiene registro que lo sostenga | Ninguna | Nuevo |
| **M-49** | Baja | Unicidades ausentes: `USUARIO.email`, `CATEGORIA.nombre`, `DISPOSITIVO.token_push` | Ninguna | Nuevo |
| **M-53** | Baja | Dominios de cadena libre que M-16 no cubrió: `ciclo_facturacion`, orígenes, estados, plataforma | C-03 (solo `ORGANIZACION.tipo`) | Extiende M-16 |
| **M-54** | Baja | Valores por defecto sin definir: estado inicial, plan, `es_recurrente_variable` | Ninguna | Nuevo |
| **M-55** | Baja | La respuesta predeterminada de RN-24 no existe como catálogo y `MENSAJE` no la distingue | C-04 (solo la marca en `MENSAJE`) | Nuevo |
| **M-56** | Baja | Nomenclatura y tipos divergen entre MER y puml; cada modelo tiene campos que el otro perdió | Ninguna | Nuevo |

### 8.3 Hallazgos de severidad alta

#### M-20 · El consentimiento de RF-01.1 no tiene dónde guardarse (extiende M-13)

El MER no tiene ninguna entidad de consentimiento —su propia sección «Lo que NO aparece» solo menciona el del correo, objeto de M-13—. RF-01.1, nuevo del 5-09, exige registrar el consentimiento de tratamiento de datos del registro de cuenta: «El consentimiento queda registrado con **fecha, hora y versión del texto aceptado**» (criterio TC-57). Y la tabla de retención de RF-01.7 agrega: «Registro del consentimiento (RF-01.1) | Conservación **disociada del resto de los datos**, como evidencia de la licitud del tratamiento (Ley 21.719); **no consultable ni exportable desde la aplicación** | 6 años».

La entidad `CONSENTIMIENTO` propuesta en M-13 no basta por tres lados: su alcance era el conector de correo, sus campos no incluyen ni la hora ni la versión del texto, y no contempla la supervivencia a la eliminación de la cuenta. Una FK dura a `USUARIO` es incompatible con esa supervivencia: el perfil se purga en 72 horas y el consentimiento debe permanecer 6 años — con borrado en cascada se destruye la evidencia de licitud; sin cascada se retiene la asociación que la disociación prohíbe.

**Corrección.** Ampliar la `CONSENTIMIENTO` de M-13: `alcance` tipado (tratamiento_datos_cuenta, lectura_correo, uso_conector —este último por RF-04—), `otorgado_en` y `revocado_en` como timestamp con zona horaria, `version_texto` obligatorio; referencia al titular disociable (al eliminar la cuenta se reemplaza por un seudónimo, sin FK con cascada) y purga a los 6 años. Ningún endpoint de la aplicación lo consulta ni lo exporta.

**Depende de:** solo el plazo de 6 años queda sujeto a la ratificación de V-03/R-07; la obligación de registrar fecha, hora y versión está en el texto vigente de RF-01.1 y es ejecutable ya.

#### M-21 · La anonimización y purga de auditoría de RF-01.7 son inejecutables sobre HISTORIAL_ESTADO

`HISTORIAL_ESTADO` es la única entidad de auditoría del MER (sirve a RNF-13) y tiene exactamente `id_historial`, `id_suscripcion` FK, `estado_anterior`, `estado_nuevo`, `fecha_cambio` y `motivo`. RF-01.7 ordena que al eliminar la cuenta esos registros se anonimicen en 72 horas conservando «solo tipo de evento, marca de tiempo, un **seudónimo no reversible** y la **fecha de eliminación de la cuenta** que los originó», y que la purga a los 12 meses «opera por esa fecha, sin necesidad de identificar la cuenta de origen» (TC-71).

Tres imposibilidades: (1) las suscripciones se eliminan definitivamente en 72 horas, así que el historial —con `id_suscripcion` como FK obligatoria— o cae en cascada, violando la retención de 12 meses de RNF-13/RF-01.7, o queda con la FK rota; (2) el seudónimo y la fecha de eliminación no existen como campos: la purga no tiene columna sobre la cual ejecutarse; (3) mientras la FK viva, `id_suscripcion` es una cadena de reidentificación (suscripción → organización → usuarios), con lo cual la anonimización no es irreversible. `motivo` es además texto libre que puede contener datos reidentificables sin regla de depuración. TC-70, TC-71 y PNF-13 no pueden pasar. Y hay una divergencia peor: **modelo-datos.puml no contiene ninguna entidad de auditoría** en sus cinco esquemas, pese a que RNF-13 exige conservar los registros durante toda la vida de la cuenta — el MER al menos tiene la tabla; la arquitectura no tiene dónde cumplir RNF-13.

**Corrección.** Agregar a `HISTORIAL_ESTADO`: `seudonimo` (identificador aleatorio no reversible, nulo mientras la cuenta viva) y `fecha_eliminacion_cuenta` (nula mientras la cuenta viva, con índice para la purga); volver `id_suscripcion` anulable (la anonimización la pone en nulo); tipar o depurar `motivo` (las causas de transición están cerradas en RN-15 y RN-17 a RN-21). Agregar la entidad de auditoría equivalente a modelo-datos.puml.

**Depende de:** V-03 solo en los plazos (72 h / 12 meses, propuesta R-07 por ratificar); los campos y el desacople son necesarios con cualquier valor que se ratifique.

#### M-22 · No existe entidad para el registro de intentos de acceso cruzado (RNF-19)

El RNF-19 redefinido el 5-09 dejó de ser un duplicado de RF-20 y exige evidencia persistente, punto 3: «Todo intento denegado de acceder a un recurso de otra cuenta queda registrado con **marca de tiempo, identificador de la cuenta autenticada, recurso solicitado y resultado**». PNF-19 lo verifica repitiendo el escenario de TC-51 «y comprobando que el intento queda registrado con los cuatro campos exigidos».

Ninguna entidad del MER puede alojarlo: `NOTIFICACION` es mensajería hacia el usuario e `HISTORIAL_ESTADO` audita transiciones de suscripción. Y **modelo-datos.puml tampoco la tiene** en ninguno de sus cinco esquemas: la carencia es de ambos modelos, no una divergencia entre ellos. Sin la entidad, el punto 3 de un requisito de seguridad vigente es incumplible y PNF-19 —marcada «Ejecutable» en la matriz— deja de serlo.

**Corrección.** Agregar en ambos modelos la entidad `INTENTO_ACCESO_CRUZADO`: id PK, `marca_tiempo` (timestamp con zona), `id_cuenta_autenticada` como **referencia débil sin cascada** (coherente con la anonimización de RF-01.7), `tipo_recurso`, `id_recurso` solicitado y `resultado` (denegado, no_existe). Sin FK dura al recurso: pertenece a otra cuenta y puede eliminarse. Probablemente en el esquema auth o en uno transversal de seguridad.

**Depende de:** V-03 fija el plazo de conservación y el destino del registro al eliminarse la cuenta (la propia matriz, sección 12 punto 3, lo dice); C-03 solo afecta el destino de la referencia de cuenta. La entidad es exigible desde ya, con la regla de retención anotada como pendiente.

#### M-23 · Sin ultima_actividad por usuario ni contador de llamadas a la API de IA (RNF-20)

`USUARIO` solo tiene `fecha_registro`. El RNF-20 con métricas del 5-09 define usuario activo mensual sobre un registro persistente: «el servicio auth registra por usuario la fecha de la última emisión de token (**campo ultima_actividad o registro equivalente**), y el conteo mensual es una consulta reproducible sobre ese registro»; PNF-20 cuenta los usuarios activos sobre él y de eso depende la verificación del tope de US$ 0,10 por usuario. El `ultima_actividad` que sí existe en el puml no sirve: está en `dispositivo` (esquema notifications), mide actividad del dispositivo push, y los usuarios solo-web ni siquiera registran dispositivo — **ni el modelo de arquitectura cumple el requisito**.

Segundo dato ausente: RNF-20 impone un tope de 200 llamadas a la API de IA por usuario y mes, y su criterio consulta «el contador de llamadas a la API de IA por usuario» al cierre del mes. No hay ninguna entidad de consumo, y contar filas de `MENSAJE` no equivale: las respuestas en degradación (RN-24, y el propio RNF-20: «responde con datos ya calculados, sin llamar a la API externa») generan mensajes sin llamada, y las explicaciones de recomendaciones consumen API fuera del chat.

Las cinco pasadas que lo detectaron oscilaron entre alta y baja; se consolida en **alta** con el criterio de M-05: un campo faltante que vuelve inejecutable una verificación de la matriz.

**Corrección.** Agregar `ultima_actividad` (timestamp) a `USUARIO` en el MER y a `usuario` del puml (esquema auth), actualizado en cada emisión de token —o una entidad de emisión de tokens si se quiere histórico—. Agregar la entidad `CONSUMO_IA` (`id_usuario`, `anio`, `mes`, `llamadas`) con unicidad por usuario-mes, alimentada solo con llamadas reales a la API externa. El valor vigente del tope puede vivir en configuración del backend: su auditoría mensual la exige RNF-20 en la planilla de costos, no en el modelo de datos.

**Depende de:** ninguna. Los valores concretos (200 llamadas, US$ 0,10) son la propuesta R-03 por ratificar, pero la estructura hace falta con cualquier valor.

#### M-24 · RF-10 es inimplementable: cuatro FK obligatorias y ninguna regla de borrado

RF-10 distingue cancelar (la suscripción persiste en el cementerio) de eliminar: «desaparece del panel y del cementerio, pero **los cobros históricos permanecen en los informes ya generados**» (TC-30). El MER no puede expresarlo: no declara semántica de borrado en **ninguna de sus quince relaciones**, no tiene borrado lógico, y cuatro FK obligatorias apuntan a `SUSCRIPCION` — `MOVIMIENTO.id_suscripcion`, `HISTORIAL_ESTADO.id_suscripcion`, `NOTIFICACION.id_suscripcion` y `RECOMENDACION_SUSCRIPCION.id_suscripcion`. Un DELETE físico o viola las FK, o exige una cascada que borra exactamente los movimientos que RF-10 manda conservar (y el historial que RNF-13 obliga a retener); un RESTRICT impide eliminar.

Reutilizar `estado` tampoco sirve: «eliminada» no pertenece al ciclo de vida que enumera la sección 6 de REGLAS-DE-NEGOCIO (prueba gratuita, activa, pausada, por confirmar, fantasma, cancelada), y RN-21 —«si en cualquier momento posterior se detecta un cobro nuevo del comercio, la suscripción vuelve a activa»— resucitaría una suscripción eliminada si la eliminación fuera un estado.

**Corrección.** Borrado lógico en `SUSCRIPCION` (`eliminada` boolean o `fecha_eliminacion`), independiente de `estado` y excluido de toda vista y proyección; precisar que RN-21 no reactiva eliminadas. Declarar en el MER la regla de borrado de cada relación: `MOVIMIENTO` e `HISTORIAL_ESTADO` se conservan; `NOTIFICACION` pendiente en cola se elimina (RN-03) y la enviada se conserva; `RECOMENDACION_SUSCRIPCION` elimina la fila puente y revisa recomendaciones que queden sin suscripciones. La eliminación física completa queda reservada al flujo de RF-01.7.

**Depende de:** ninguna.

#### M-25 · La eliminación de cuenta en 72 h no tiene camino de borrado (extiende M-01)

RF-01.7 exige eliminar en máximo 72 horas «perfil, suscripciones, cobros, registros de uso, conversaciones del chat, alertas, presupuesto y preferencias» del titular, y revocar **de inmediato** los tokens de sus conectores. Pero en el MER `SUSCRIPCION`, `CONECTOR`, `MOVIMIENTO` (vía suscripción), `NOTIFICACION` y `RECOMENDACION` cuelgan de `ORGANIZACION` y ninguna tiene `id_usuario`; el propio MER declara: «No existe ninguna relación directa entre USUARIO y SUSCRIPCION. Todo pasa por ORGANIZACION». Con más de un usuario por organización (la cardinalidad es 1 a muchos), borrar la cuenta de uno no puede arrastrar esas entidades sin destruir datos de los demás, y el modelo no permite identificar qué suscripciones, movimientos ni conectores son del titular: la revocación inmediata de «sus» tokens es **indecidible**. Solo las ramas `USUARIO`→`DISPOSITIVO` y `USUARIO`→`CONVERSACION`→`MENSAJE` tienen camino, y ni ahí la regla está declarada.

M-01 probó que el modelo no soporta la lectura aislada (RF-20); este hallazgo prueba que tampoco soporta el borrado por titular del requisito nuevo del 5-09.

**Corrección.** Declarar la cadena de borrado de cuenta en el MER y, según C-03: o reasignar `SUSCRIPCION`/`CONECTOR`/`NOTIFICACION`/`RECOMENDACION` a `USUARIO` con cascada (individual), o agregar `id_usuario` y definir por entidad si al eliminar al titular se borra, se transfiere o se anonimiza (hogar). Documentar la tabla de retención de RF-01.7 como reglas de borrado del modelo. Precisión del escéptico por ADR-002: las «cascadas» que cruzan esquemas (`USUARIO`→`DISPOSITIVO` va de auth a notifications) no pueden ser ON DELETE CASCADE del motor —no existen FK entre esquemas— sino reglas lógicas sostenidas por eventos (ver M-31); el MER debe decir cuáles ejecuta el motor y cuáles el mecanismo de eventos.

**Depende de:** C-03.

#### M-26 · MOVIMIENTO, HISTORIAL_ESTADO y RECOMENDACION_SUSCRIPCION no tienen campo de propietario

Estas tres entidades no tienen **ni `id_organizacion` ni `id_usuario`**: la propiedad solo se resuelve con JOIN a `SUSCRIPCION`. Es distinto de M-01, que discute quién es el dueño correcto en las entidades que sí tienen `id_organizacion`; aquí no hay campo de tenant de ninguna clase, cualquiera sea la resolución de C-03.

Consecuencias: (1) el filtro obligatorio de tenant de RNF-19.1/ADR-004 («toda consulta sobre tablas con datos de propiedad de una cuenta pasa por el filtro obligatorio de tenant») no tiene campo por el cual filtrar, y la inspección estática de PNF-19 —«el 100% de los modelos **con campo de propietario** aplica el filtro»— ni siquiera alcanza a estas tablas: escapan a la verificación; (2) `MOVIMIENTO` son los «cobros» que RF-20 y RNF-19 enumeran expresamente entre los recursos aislados; (3) bajo ADR-002 el JOIN de rescate ni siquiera está garantizado: `MOVIMIENTO` ya referencia `CONECTOR`, que vive en otro servicio. El puml sí cumple: `cobro` lleva `organizacion_id` conforme a su regla transversal («toda tabla con datos de clientes lleva organizacion_id y toda consulta filtra por él»).

**Corrección.** Agregar el campo de tenant a las tres entidades, desnormalizado a propósito como hace el puml con `cobro`, de modo que toda fila sea filtrable sin JOIN y la inspección de PNF-19 las cubra.

**Depende de:** C-03 solo para el nombre del campo (`id_organizacion` o `id_usuario`); la ausencia total de propietario es hallazgo en ambos escenarios.

### 8.4 Hallazgos medios y bajos

#### Medios

**M-27 · Sin catálogo de servicio/proveedor (extiende M-11).** `SUSCRIPCION.nombre_servicio` es texto libre y el servicio no existe como entidad: «Netflix», «NETFLIX.COM» y «PAG*NETFLIX» son tres servicios distintos, la guía específica de RF-16 no tiene clave a la cual anclarse —M-11 propuso `GUIA_CANCELACION` «asociada al servicio» sin advertir que el servicio no existe como clave— y RN-07, RN-11 y RN-21, que operan sobre «el mismo comercio», quedan reducidas a comparar glosas. El puml ya lo resolvió: catálogo global `proveedor` con nombre único y `url_cancelacion` («Netflix es Netflix para todas las organizaciones»). Una pasada lo traía como alta; el escéptico lo dejó en media: RN-16 opera sobre `id_categoria`, que ya existe, y la `glosa_normalizada` de RN-13 da una clave de comparación — las reglas degradan en confiabilidad, no en posibilidad. **Corrección:** entidad `PROVEEDOR` como catálogo global con FK opcional desde `SUSCRIPCION` más `nombre_libre` para servicios no catalogados; anclar la guía de M-11 a `PROVEEDOR` y resolver «mismo comercio» contra el catálogo más la glosa normalizada.

**M-28 · `MOVIMIENTO.id_conector` obligatoria.** Un cobro manual o proveniente de CSV/PDF (RF-05, RF-19) no nace de un conector persistente, y el ADR-005 §1.1 define la entrada manual como «el piso obligatorio del sistema». Con la FK obligatoria, ese cobro no puede registrarse o exige filas ficticias en `CONECTOR`. Además `origen` e `id_conector` son redundantes sin regla: nada impide `origen='manual'` con conector poblado. El puml lo modela bien: `conector_id` como UUID suelto y «origen: manual | correo | conector». Distinto de M-08, que trata `id_suscripcion`. **Corrección:** `id_conector` anulable, cardinalidad 0..1, y regla de coherencia con `origen` tipado como enum (manual, csv, pdf, correo).

**M-30 · FK redundantes permiten cruzar tenants.** `NOTIFICACION` llega a la organización por dos caminos que nada obliga a coincidir (su propio `id_organizacion` y el de su suscripción): el modelo admite una notificación de la organización A apuntando a una suscripción de la B. Lo mismo en `RECOMENDACION` (vía tabla puente) y `MOVIMIENTO` (suscripción y conector de organizaciones distintas). Son las mezclas que RF-20 y RNF-19 prohíben, y el filtro del ADR-004 no las detecta porque cada fila parece pertenecer al tenant filtrado. Independiente de C-03: con `id_usuario` el problema persiste. **Corrección:** eliminar la FK redundante donde se derive, o declarar la coherencia (FK compuesta contra clave única `(id_suscripcion, id_organizacion)` en `SUSCRIPCION`); si se aplica M-10, exigir la coherencia solo cuando `id_suscripcion` no sea nulo.

**M-31 · FK que cruzan fronteras de servicio (ADR-002).** El ADR-002 dice «No existen claves foráneas entre esquemas» y el puml lo respeta distinguiendo FK real (línea continua) de UUID suelto (punteada). El MER declara como FK, sin distinción, referencias que cruzan servicio: `MOVIMIENTO.id_conector`, `NOTIFICACION.id_suscripcion`, los `id_organizacion` de cuatro entidades, `DISPOSITIVO.id_usuario`, `CONVERSACION.id_usuario`, `RECOMENDACION_SUSCRIPCION.id_suscripcion`. Ninguna podrá existir como restricción del motor: la integridad pasa a eventos que el MER no define, y los huérfanos entre servicios quedan posibles por diseño sin que el documento lo advierta. **Corrección:** anotar qué referencias son FK reales y cuáles identificadores lógicos, con el evento que mantiene cada una y su regla de limpieza — o declarar el MER como conceptual y el puml como físico vinculante. Ojo del escéptico: el puml tampoco está limpio — dibuja `usuario`→`dispositivo` y `usuario`→`alerta` como FK reales cruzando auth↔notifications, contra su propio ADR-002; corregirlo antes de usarlo como plantilla. C-03 decide solo el campo de aislamiento.

**M-32 · Tokens de un solo uso y revocación de sesiones.** «De un solo uso y expira a los 60 minutos» (RF-01.4) exige persistir emisión, expiración y consumo de cada enlace —rechazar uno «ya utilizado» (TC-61) es imposible sin ese estado—; RF-01.5 exige guardar el correo pendiente mientras el vigente sigue operativo (TC-66); y con el ADR-004 (el gateway solo valida la firma del JWT), la revocación a 60 segundos de RF-01.6 y la inmediata de RF-01.7 requieren estado persistente que el gateway consulte. Nada de eso existe en el MER. **Corrección:** `TOKEN_VERIFICACION` (tipo restablecimiento/verificación, hash del token, `expira_en`, `usado_en` nulo, `dato_pendiente` con el correo nuevo) es incondicional. Para sesiones, engancharse al pendiente ya registrado en CONFLICTOS-Y-DECISIONES («enmienda al ADR-004 por RF-01.6, o criterio por TTL»): si se enmienda, `SESION` o denylist en auth; si se opta por TTL, RF-01.6 se reescribe y solo la revocación de RF-01.7 sigue necesitando estado para los tokens de refresco.

**M-33 · Identidad de Google no modelada (RF-01.3).** `USUARIO` solo tiene `email` y `password_hash`: no hay proveedor de autenticación ni identificador externo (sub de Google), y una cuenta creada solo con Google no tiene contraseña, con `password_hash` implícitamente obligatorio. RF-01.5 y RF-01.7 aceptan «reautenticación con Google» como confirmación de identidad sin tener contra qué verificar; TC-58 a TC-60 no tienen datos que los sostengan. **Corrección:** entidad `IDENTIDAD_FEDERADA` (`id_usuario`, `proveedor`, `id_externo`, `fecha_vinculacion`) o, mínimo, `proveedor_auth` e `id_google` en `USUARIO`; declarar `password_hash` anulable para cuentas solo-Google.

**M-34 · El historial del chat decidido con C-04 abierto.** C-04 deja explícitamente abierta la pregunta «si el chat conserva historial — de ser así, hace falta una tabla de conversación». El MER la responde de hecho con `CONVERSACION` y `MENSAJE`, mientras el puml no tiene ninguna tabla de chat: una decisión de producto quedó tomada implícitamente en un diagrama y los dos modelos divergen. **Corrección:** llevar C-04 a acta. Si se ratifica el historial: mantener ambas entidades, incorporarlas al puml en el esquema del servicio que aloje al asistente (analytics según la recomendación de C-04), con la referencia a usuario como UUID sin FK (ADR-002) y su retención definida en la tabla de RF-01.7 —que ya ordena eliminar «conversaciones del chat» en 72 horas—. Si no: retirarlas del MER.

**M-35 · Comprobantes Premium sobreviven 6 años (extiende M-07).** La tabla de retención de RF-01.7 ordena conservar los comprobantes de pago del plan Premium «disociados del resto de los datos, solo con los campos exigidos por la obligación tributaria» durante 6 años tras eliminar la cuenta, mientras el perfil se purga en 72 horas. La entidad de pagos que M-07 pide crear debe cumplirlo desde su diseño: con FK en cascada al usuario, el comprobante cae con la cuenta o retiene el vínculo reidentificable. **Corrección:** separar el comprobante tributario (campos mínimos legales, referencia disociable, `fecha_eliminacion_cuenta` para la purga) del registro operativo del pago, que sí se purga en 72 horas. El plazo de 6 años tiene base legal por validar (V-03).

**M-36 · `NOTIFICACION` confunde anomalía con notificación.** TC-73 exige que una anomalía con la alerta desactivada «no se notifica por ningún canal, pero sigue visible en el panel»: ese objeto sin emisión no tiene `canal` ni `fecha_envio` que poner. Y RF-07 permite marcarla como revisada (TC-23), estado ortogonal al de entrega —enviada y pendiente de revisión a la vez—, dos valores simultáneos que el único campo `estado` no puede representar. El puml ya insinúa la separación: `alerta` tiene `leida : boolean` y `mensaje`. **Corrección:** separar la alerta (detección: tipo, fecha, `revisada` boolean, FK anulable según M-10) de su emisión (canal, fechas, estado de entrega — posible entidad de emisión 1:N); como mínimo, `revisada` boolean y `canal`/`fecha_envio` nulos para anomalías no notificadas.

**M-37 · `CONECTOR` sin datos operativos de sincronización.** RNF-16 exige degradar mostrando «el último dato disponible con marca de tiempo» y RNF-17 mide la consistencia contra «la última sincronización registrada»: esa marca no existe — `fecha_conexion` registra cuándo se vinculó, no cuándo sincronizó, y `estado` no detalla el fallo. La narrativa del conector (excepción 7a) exige el estado «pendiente de sincronización» con reintento, y PNF-16 simula la caída de un conector. El puml ya trae los tres campos. **Corrección:** agregar `ultima_sincronizacion`, `ultimo_error` (nulo) y `expira_en` (vencimiento del token OAuth), alineando con el puml.

**M-38 · `CONECTOR` sin `id_usuario` y credenciales monolíticas.** Dos diferencias con el puml. (1) El conector de correo lee el buzón de una persona y su consentimiento es personal y revocable (ADR-005); si C-03 se resuelve como hogar, un conector colgado solo de la organización no registra quién autorizó ni quién revoca — el puml sí trae `usuario_id`. (2) El MER colapsa token de acceso, token de refresco y expiración en un solo `credenciales_cifradas` string (el puml separa `token_cifrado` y `refresco_cifrado` como bytea más `expira_en`); el escéptico degradó este aspecto aislado a baja —ningún requisito queda inimplementable con el blob—, pero la rotación por expiración y las columnas identificables que supone PNF-03a sostienen la corrección. **Corrección:** separar los tokens en campos binarios con `expira_en`; agregar `id_usuario` si C-03 mantiene la organización, enlazado al consentimiento de M-13/M-20.

**M-39 · Tipos de `CONECTOR`: adoptar el cierre del puml (extiende M-12).** La corrección de M-12 proponía el dominio (correo, archivo) sin saber que el puml ya lo fija: «tipo: spotify | correo | csv». El MER con tipo libre ni siquiera reconoce el conector de Spotify que las narrativas (CU-12, actor «API de Spotify») dan por central para medir uso; el campo `proveedor` no existe en el puml, donde `tipo` basta. **Corrección:** restringir `tipo` al dominio del puml; agregar banco_sandbox solo si se ratifica la prioridad 3 del ADR-005 (Fintoc sandbox, «producción fuera de alcance por costo»), marcado fuera de producción; eliminar o justificar `proveedor`. Depende de V-01: el camino B (RF-21 bancario) cambiaría el dominio.

**M-40 · RF-14: fecha de cancelación y ahorro derivables frágiles.** RF-14 lista las canceladas «con fecha, monto y frecuencia» y calcula el ahorro como monto por ciclo × ciclos desde la cancelación (TC-39). La fecha de cancelación no existe: habría que derivarla de `HISTORIAL_ESTADO` filtrando cadenas libres y eligiendo el último evento cuando hubo ciclos cancelada→activa→cancelada (RN-21). Y el `monto` es editable (RF-08): una edición posterior alteraría retroactivamente el ahorro exhibido. El puml ya lo resolvió con la entidad `cancelacion` (`fecha_cancelacion`, `ahorro_estimado`, `motivo`). **Corrección:** incorporar `CANCELACION` del puml (o, mínimo, `fecha_cancelacion` y `monto_al_cancelar` en `SUSCRIPCION`) como instantánea tomada al cancelar, que RN-21 cierra o reemplaza al reactivar.

**M-41 · `fecha_proximo_cobro` sin regla de actualización.** Es un derivado almacenado sin declarar cuándo ni cómo se recalcula: si al confirmarse un `MOVIMIENTO` nadie lo avanza, las alertas de RN-01/RN-02 se emiten sobre una fecha vencida y el calendario de RF-12 proyecta mal. RN-21 agrava: «se reajusta su regla de frecuencia» al reactivar, operación tampoco definida. **Corrección:** declarar la derivación (último cobro confirmado + ciclo, o `fecha_inicio` + n·ciclo) y sus eventos de recálculo (confirmación de movimiento, edición RF-08, reactivación RN-21); o no almacenarla y calcularla en consulta.

**M-42 · `es_recurrente_variable` sin regla de recálculo.** Materializa la clasificación de RN-12 (variación de monto > 30% entre meses) sin declarar quién la calcula, con qué ventana, ni si puede volver a false al estabilizarse el monto. Como la marca excluye la suscripción «de las sugerencias de planes fijos» y RF-18 recomienda sobre esa base, un valor desactualizado produce recomendaciones incorrectas. **Corrección:** documentar la derivación (umbral 30%, ventana, evento de recálculo por movimiento confirmado, transición de vuelta a false) o eliminar el campo y derivarlo en consulta sobre `MOVIMIENTO`.

**M-44 · Moneda libre y dinero divergente (extiende M-17).** `moneda` es string sin dominio: RF-11 desglosa el total «por moneda», y agrupar sobre texto libre («CLP», «clp», «peso») fragmenta el desglose; RNF-14a formatea por código de moneda («CLP 9,990»), lo que pide ISO 4217. Y los dos modelos no pueden estar vigentes a la vez: el MER usa decimal sin precisión (M-17) y el puml integer en unidad mínima con `moneda : char(3)`. **Corrección:** `moneda` como char(3) ISO 4217 en toda entidad monetaria (incluida `MOVIMIENTO` al aplicar M-09) y una sola representación de montos documentada en ambos diagramas; en el puml, `cancelacion.ahorro_estimado` también necesita moneda si el cementerio hereda el desglose de RF-11.

**M-50 · Recomendación multi-suscripción no representable en el puml.** Divergencia inversa: el MER tiene la tabla puente `RECOMENDACION_SUSCRIPCION` (acierto reconocido en la sección 2), pero el puml modela `recomendacion` con un único `suscripcion_id` a la vez que declara el tipo solapamiento. Una consolidación por RN-16 involucra dos o más servicios: el modelo de arquitectura no puede registrarla, y si el MER se corrige tomando el puml como referencia, el retroceso se importa. **Corrección:** agregar la tabla puente al esquema analytics del puml (con PK compuesta, aplicando también M-15).

**M-51 · El plan vive en `USUARIO` en el MER y en `organizacion` en el puml (extiende M-14).** La tensión que M-14 detectó dentro del MER, elevada a contradicción entre diagramas: según cuál se implemente, Premium lo contrata una persona o un hogar completo, con efecto directo sobre RF-17 (quién paga y quién pierde acceso) y RF-18 (quién ve el chat). Los criterios de ambos requisitos están formulados sobre la persona. **Corrección:** resolver con C-03 y unificar: individual → plan en el usuario y se corrige el puml; hogar → definir la titularidad (¿un Premium por hogar o por persona?) y corregir el diagrama desalineado. En cualquier caso el plan necesita la vigencia de M-07, no una cadena suelta.

**M-52 · Chat y `DISPOSITIVO` sin campo de tenant.** RF-20 y RNF-19 incluyen el chat entre los recursos aislados. `CONVERSACION`, `MENSAJE` y `DISPOSITIVO` no llevan `id_organizacion`: si C-03 se resuelve como individual, el aislamiento por `id_usuario` es correcto por construcción y el hallazgo se disuelve; si es hogar, las tres violan la regla transversal del puml y el filtro del ADR-004 no puede aplicarse a chat ni dispositivos (el puml pone `organizacion_id` y `usuario_id` en `dispositivo`). Divergencia adicional en ambos escenarios: el puml no modela el chat en ningún esquema, pese a que RF-01.7 ordena eliminar «conversaciones del chat» — no tiene dónde operar (ver M-34). **Corrección:** según C-03; y en ambos escenarios, agregar el chat al puml.

#### Bajos

**M-29 · Revocación del correo: «único origen» sin datos.** RF-05 ordena, al revocar el consentimiento de correo, eliminar los tokens y solo los cobros «cuyo único origen sea el correo». El escéptico degradó el hallazgo de media a baja: el trilema de borrado que traía era falso —RF-05 no elimina la fila `CONECTOR`, que «queda revocado» con las credenciales vaciadas, y borrar hijos selectivamente jamás viola una FK—. Lo que sobrevive es real: el MER no puede representar «único origen» (un movimiento tiene un solo string `origen`, sin segunda fuente registrada) y la regla de revocación no está declarada. **Corrección:** conservar el `CONECTOR` con estado revocado y credenciales eliminadas; borrar los `MOVIMIENTO` de origen exclusivo correo; modelar cómo se determina «único origen» (marca de confirmación del usuario o registro de segunda fuente) y declarar la regla en el MER.

**M-43 · Instantes sin zona horaria.** El MER mezcla `date` y `datetime` sin zona donde el puml usa timestamptz de forma consistente (`fecha_conexion` ni siquiera tiene hora). Degradado de media a baja: los requisitos que el hallazgo citaba rigen entidades que otros hallazgos ya corrigen con timestamptz, y RN-09 (ventana 22:00–08:00) es una regla sin requisito (CN-02) que rige el despacho, no el almacenamiento. Queda precisión de tipos y consistencia con el puml, clase M-17. **Corrección:** timestamptz para instantes, `date` solo para fechas civiles, y declarar America/Santiago como zona de referencia de RN-09.

**M-45 · PK `int` contra el `uuid` de arquitectura.** Todas las PK del MER son int; todas las del puml, uuid. Degradado de media a baja: RF-20 se cumple por autorización —TC-51 verifica que la respuesta sea «no autorizado» o «no existe», no que el id sea inadivinable— y el seudónimo de RF-01.7 es un campo nuevo de auditoría (M-21), independiente del tipo de las PK. Queda la divergencia documental. **Corrección:** adoptar uuid alineando con el puml, o dejar constancia escrita de la divergencia y de cómo se mitiga la enumerabilidad.

**M-46 · El enum de estados debe fijarse contra RN §6 (extiende M-16).** M-16 citaba los cinco estados de RF-03; las reglas de negocio enumeran seis —agregan «pausada» (CN-03) y renombran «dudosa» a «por confirmar» (CN-04)—, así que el enum no puede cerrarse hasta resolver ambos conflictos y debe apuntar a esa lista. El mismo dominio aparece sin catálogo compartido en `SUSCRIPCION.estado`, `HISTORIAL_ESTADO.estado_anterior` y `estado_nuevo`, con riesgo de transiciones con valores inadmisibles que corrompen el gasto proyectado de RN-22. Degradado a baja: mismo problema de fondo que M-16, y lo accionable hoy es solo documental. **Corrección:** un único catálogo `ESTADO_SUSCRIPCION` referenciado por los tres campos, con el conjunto condicionado a CN-03/CN-04, y la regla de que `estado` coincida con el último `estado_nuevo` del historial.

**M-47 · Datos sensibles de RN-23 sin identificar.** RN-23 obliga a eliminar RUT, tarjetas, nombres reales y saldos antes de enviar texto a la API de IA; esos datos viven en `USUARIO.nombre`, `MOVIMIENTO.glosa_original` (RN-13: «PAG*NETFLIX 1234») y `MENSAJE.contenido`, y el modelo no distingue crudo de saneado. Degradado a baja: RN-23 es una regla del borde de salida hacia la API —el MER no la contradice, solo no la evidencia— y CU-35 se prueba interceptando el payload saliente. **Corrección (mejora de auditabilidad):** `contenido_saneado` en `MENSAJE` o registrar solo la versión saneada saliente; definir que `glosa_normalizada` excluye dígitos de tarjeta; anexar al MER una clasificación de sensibilidad por campo, insumo del registro de tratamiento de RNF-10.

**M-48 · Límite de ingesta de RN-25 sin registro.** RN-25 restringe la subida repetida de un mismo PDF a 3 intentos diarios por usuario (CU-36; RNF-20 se apoya en ese límite para contener costo). Distinguir «un mismo PDF» exige una huella del archivo —hash, porque RF-05 prohíbe almacenar el archivo completo— con usuario y fecha; ni el MER ni el puml tienen entidad de ingesta (`MOVIMIENTO` registra cobros ya derivados, no subidas). **Corrección:** entidad `INGESTA_ARCHIVO` (`id_usuario`, `hash_archivo`, tipo csv/pdf, `fecha_hora`, `resultado`), con retención corta declarada en la tabla de RF-01.7; el tope se verifica contando por usuario, hash y día.

**M-49 · Unicidades ausentes.** RF-01.1 rechaza el registro con un correo ya usado y RF-01.5 el cambio a un correo ajeno: exige UNIQUE sobre `USUARIO.email`, que el MER no declara (el puml sí: `<<UQ>>`). Mismo defecto en `CATEGORIA.nombre` (el catálogo cerrado de diez valores de RF-06 admite hoy «Streaming» y «streaming» como filas distintas, rompiendo el resumen por categoría) y `DISPOSITIVO.token_push` (duplicado = push duplicado). Degradado de media a baja: garantía ausente, no requisito bloqueado — clase M-15/M-16. **Corrección:** UNIQUE en los tres (el token, único por usuario o global según el proveedor de push); anotar `CATEGORIA` como datos semilla sin altas desde la aplicación, y que la unicidad de email aplica sobre cuentas vivas (compatible con el re-registro tras purga de RF-01.7).

**M-53 · Dominios de cadena libre restantes (extiende M-16).** Fuera de los seis campos de M-16 quedan: `ciclo_facturacion` (RF-02 fija semanal/mensual/anual, y RN-01/RN-02/RN-11 aplican reglas distintas por ciclo — un valor fuera de dominio deja el cobro sin regla de alerta), `MOVIMIENTO.origen`, `RECOMENDACION.tipo` y `estado`, `NOTIFICACION.estado` y `CONECTOR.estado` (sin dominio declarado en ningún documento: hay que definirlo primero), `DISPOSITIVO.plataforma` y `ORGANIZACION.tipo` (sin dominio y cuya existencia depende de C-03). **Corrección:** tipar cada uno como enum o catálogo con su dominio documentado; de paso, el puml restringe `recomendacion.tipo` a «cancelar | solapamiento» sin «ahorro», otra divergencia con RF-18 que fijar.

**M-54 · Valores por defecto sin definir.** Los requisitos los fijan y el MER no los declara: RF-02 establece el estado inicial («activa», o «prueba» si marcó prueba gratuita), RF-17 implica que toda cuenta nace en plan gratuito, y RN-12 implica `es_recurrente_variable` en false. Sin defaults, cada implementador decide, y un plan nulo deja indefinido el bloqueo de RF-18. **Corrección:** `estado` DEFAULT 'activa' con la regla de RF-02, `plan` DEFAULT 'gratuito' NOT NULL, `es_recurrente_variable` DEFAULT false (el default de `dias_anticipacion` ya está en M-04).

**M-55 · Respuesta predeterminada de RN-24 sin catálogo ni marca.** RN-24 entrega ante timeout «una respuesta predeterminada **desde la base de datos**» —la localización es literal— y no existe entidad que las contenga. RNF-09 exige que «se reportan por separado» y PNF-09 invalida la prueba si superan el 10%: distinguirlas requiere una marca en `MENSAJE` que no existe. **Corrección:** catálogo `RESPUESTA_PREDETERMINADA` (exigible en cualquier caso) y `es_predeterminada` boolean en `MENSAJE` — esta marca presupone que el chat conserva historial, es decir, C-04.

**M-56 · Nomenclatura y tipos divergen entre MER y puml.** Los dos modelos nombran distinto lo mismo (`MOVIMIENTO`/`cobro`, `NOTIFICACION`/`alerta`, `ciclo_facturacion`/`ciclo`, PK int/uuid, decimal/integer) y cada uno tiene campos que el otro perdió: el MER tiene `origen_deteccion` (exigido por RF-05), `es_recurrente_variable` (RN-12) y las glosas de RN-13, ausentes del puml; el puml tiene `medio_pago_alias` y `es_prueba`/`fin_prueba` (M-03). Sin tabla de equivalencias, la trazabilidad requisito→modelo apunta a nombres que no existen en el modelo que se implemente. **Corrección:** tabla de equivalencias en el glosario, elegir un modelo canónico y completar el otro; adoptar la convención de tipos del puml cierra de paso M-17.

### 8.5 Lo que esta revisión no cubrió

El crítico de completitud identificó doce vacíos. Ninguno invalida los hallazgos anteriores; varios son conflictos **entre correcciones ya propuestas** que la síntesis final debe resolver.

- **Eliminación selectiva del uso obtenido por conector (Spotify, CU-23).** La corrección `USO` de M-02 (`origen`: manual | conector, sin `id_conector`) no permite saber qué registros borrar al desconectar Spotify, pese a que el mockup promete «al desconectar una cuenta, se eliminan los datos obtenidos por esa vía». Si se aplica M-02 tal como está, la revocación queda incumplible para esa vía: todo o nada. Cuesta una FK opcional ahora y una migración después. No depende de decisiones abiertas.
- **Las correcciones nunca se contrastaron contra RN-01 a RN-10.** La `CONFIGURACION_ALERTA` de M-04 (días de 1 a 14, una alerta por tipo) no puede expresar el doble recordatorio del cobro anual (RN-02: 7 días y 24 horas antes), la regla 48/24 de pruebas (RN-04) ni el tope de 2 push diarias con prioridad (RN-08). Depende de CN-01/CN-02: si se resuelven a favor de las reglas, la corrección de M-04 se rehace entera — y es el requisito de mayor prioridad del proyecto (76,3% de los encuestados).
- **El catálogo `PROVEEDOR` del puml entra en conflicto con RF-06.** En el puml la categoría vive en el proveedor y `suscripcion` no tiene campo de categoría, pero RF-06 exige una categoría por suscripción «que el usuario puede cambiar en cualquier momento» — el MER actual sí lo cumple. Al adoptar el catálogo (M-27) hay que **mantener `id_categoria` en `SUSCRIPCION`**, con la del proveedor como valor por defecto; copiar el puml sin más rompe RF-06.
- **El glosario quedó fuera del contraste.** Registra una decisión fechada (2026-08-21: «El sistema se enfoca en B2C: personas y grupos familiares») y define la suscripción como de la organización, con relación M:N usuario–suscripción y figura de pagador (`es_pagador` en el puml). Ni la sección 6 de este documento ni C-03 pesaron esa evidencia — la más fuerte del lado «hogar» —, lo que expone la recomendación a reabrirse en la defensa. Y si C-03 sale hogar, la corrección de M-01 (1:N vía `id_usuario`) y el M:N del glosario/puml son incompatibles entre sí.
- **Re-detección de candidatos descartados.** RF-05 exige que el candidato descartado «no se persiste en ningún lugar», pero sin rastro alguno la siguiente sincronización re-genera el mismo candidato indefinidamente; y la opción mínima de M-08 (estado descartado) conserva datos que el usuario rechazó, contra la minimización del ADR-005. Falta una marca de descarte mínima (hash de detección sin contenido). No depende de decisiones abiertas.
- **La zona horaria del usuario no existe en ningún modelo.** RN-09 (silencio 22:00–08:00, despacho a las 09:00) y los avisos «24/48 horas antes» requieren la hora local de cada usuario en el servidor; `USUARIO` y `DISPOSITIVO` no la guardan. Distinto de M-43, que trata cómo se almacenan los instantes, no dónde vive la zona del destinatario. Depende de CN-02: si RN-08/09/10 se incorporan a RF-09, el horario de descanso es inimplementable sin ese dato.
- **El presupuesto de M-05 no fija moneda ni período.** Nadie evaluó cómo se compara con un gasto proyectado que RF-11 obliga a desglosar por moneda: con suscripciones en CLP y USD, la alerta de RF-13 queda matemáticamente indefinida. El puml modela otra cosa (presupuesto por organización/año/mes con moneda): dos estructuras divergentes y ninguna resuelve la comparación multi-moneda. C-03 decide solo el titular; la falta de moneda es hallazgo en cualquier escenario.
- **Las recomendaciones de cambio de plan no tienen datos de oferta.** RN-14 (cambio solo si el ahorro supera el 15%) y el mockup («el plan anual sale más barato. Ahorro: $11.800 al año») presuponen conocer el precio del plan alternativo; ni el MER ni el puml tienen entidad de planes/precios. Hay que decidir si eso viene de un catálogo curado (`PLAN_PROVEEDOR`), de la API de IA (RF-18 prohíbe inventar montos) o si el tipo sale del alcance.
- **Los atributos del estado «pausada».** Si CN-03 lo incorpora, el enum corregido de M-46 seguirá incompleto: el diagrama de flujo del equipo le asocia «una fecha de reactivación que ninguna regla ni requisito define», sin campo en `SUSCRIPCION`, y sin definir su efecto sobre `fecha_proximo_cobro` y RN-03.
- **El barrido sistemático mockup→MER no lo hizo nadie.** Quedan campos visibles sin correlato evaluado: el formulario pide «fecha del primer cobro» y calcula el próximo (el MER guarda `fecha_inicio` y `fecha_proximo_cobro`, RF-02 pide la fecha del próximo cobro: tres definiciones sin conciliar); el panel muestra uso «Continuo», inexpresable en las unidades de M-02; hay una alerta «se cobró correctamente» que no existe en RF-09 ni en el catálogo del puml. Hallazgos menores uno a uno, pero el ángulo completo quedó sin dueño y son seis pantallas.
- **Rendimiento de consultas (RNF-05a).** Nadie evaluó si el modelo sirve las agregaciones del dashboard en p95 ≤ 3 s con 50 suscripciones y 12 meses de cobros, ni qué derivados o vistas de lectura lo exigen. La crítica «derivado almacenado sin regla» (M-41, M-42) y RNF-05a empujan en direcciones opuestas: la síntesis debe fijar el criterio —derivados permitidos con regla de actualización explícita— en vez de sugerir implícitamente eliminarlos.
- **Dónde vive la tabla de retención por tipo de dato.** La revisión cubrió cada dato retenido por separado, pero el artefacto agregado —el registro de actividades de tratamiento con los plazos por tipo de dato, contra el que PNF-10 audita— no tiene representación ni en el modelo ni como documento identificado. Sin él, PNF-10 no tiene contra qué auditar y la Ley 21.719 exige acreditar los plazos. Probablemente sea un documento, no una entidad, pero alguien debe decidirlo y hoy no está en ninguna lista de pendientes.

**Resumen del crítico.** La revisión combinada es amplia: las trece entidades del MER fueron tocadas por al menos un hallazgo, los cuatro requisitos nuevos del 5-09 (RF-01.1, RF-01.7, RNF-19, RNF-20) están cubiertos de forma redundante por varias pasadas, y la divergencia MER↔puml quedó bien mapeada. Los vacíos que restan son de otro tipo: nadie contrastó las correcciones propuestas entre sí ni contra las reglas RN-01 a RN-10, los mockups y el glosario, y varias entran en conflicto con requisitos o con decisiones abiertas. La encuesta y el ángulo de migraciones no aportan hallazgos estructurales adicionales: la primera solo sostiene prioridades ya citadas y el segundo está razonablemente cubierto por la sección 6 y la divergencia int→uuid ya señalada.

### 8.6 Relación con las decisiones abiertas

Igual que en la sección 6: los hallazgos que dependen de una decisión lo declaran y **no la deciden**. La mayoría tiene un núcleo ejecutable ya.

| Decisión | Hallazgos que la esperan | De ellos, bloqueados enteros |
|---|---|---|
| **C-03** (individual u hogar) | 8 — M-22, M-25, M-26, M-31, M-38, M-51, M-52, M-53 | 3 (M-25, M-51, M-52); en los otros cinco la decisión fija solo el nombre del campo de tenant, el destino de una referencia o un dominio |
| **V-03 / R-07** (plazos de retención) | 4 — M-20, M-21, M-22, M-35 | 0: en los cuatro solo los plazos; los campos y el desacople se necesitan con cualquier valor ratificado |
| **V-01** (alcance de conectores) | 1 — M-39 | 1 |
| **C-04** (alcance del chat) | 2 — M-34, M-55 | 1 (M-34); de M-55 solo la marca en `MENSAJE` |
| **CN-03 / CN-04** (estados en disputa) | 1 — M-46 | 1 |
| **Ninguna** | 22 hallazgos sin dependencia alguna | — |

En total: **22 de los 37 hallazgos son ejecutables ya** sin esperar ninguna decisión, y otros 9 lo son en su núcleo (solo un detalle queda pendiente). Solo 6 —M-25, M-34, M-39, M-46, M-51 y M-52— están bloqueados enteros, y 4 de esos 6 por C-03 o C-04. La conclusión de la sección 6 se mantiene y se afina: C-03 sigue siendo la decisión que hay que tomar primero, pero ya no es excusa para no tocar nada — la anonimización de auditoría (M-21), el registro de accesos (M-22), el borrado de RF-10 (M-24) y la infraestructura de RF-01.x (M-20, M-23, M-32, M-33) se pueden corregir hoy.
