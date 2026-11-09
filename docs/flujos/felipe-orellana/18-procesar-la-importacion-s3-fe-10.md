# S3-FE-10 — El cable entre el archivo subido y el parser

**Qué hace.** Cuando alguien sube un CSV, FE-07 lo guarda y contesta un id.
Esto es lo que ocurre después: una tarea toma ese archivo, lo pasa por el
parser de S3-FE-11/12/13 y deja los candidatos guardados para que una persona
los mire. Sigue sin crear ni tocar ninguna suscripción.

Los dos criterios de la tarjeta:

| Criterio | Dónde se cumple |
|---|---|
| Un archivo aceptado llega al parser real | `SubirArchivoView` encola `procesar_importacion`, que llama a `csv_candidatos.leer` |
| El estado refleja inicio y final del procesamiento | `pendiente` → `procesando` → `completada` o `fallida`, y `rescatar_importaciones_estancadas` cierra lo que se quedó a medias |

**Dónde está.**

| Pieza | Archivo |
|---|---|
| La tarea que procesa | `connectors/tasks.py` → `procesar_importacion` |
| El rescate de lo estancado | `connectors/tasks.py` → `rescatar_importaciones_estancadas` |
| El encolado | `connectors/views.py` → `_encolar_procesamiento` |
| Donde quedan los candidatos | `connectors/models.py` → `CobroCandidato` |
| La migración | `connectors/migrations/0005_cobro_candidato.py` |
| Las pruebas | `services/connectors/tests/test_procesar_importacion.py`, 33 |

## El flujo: de dónde vienen los datos

```
POST /api/importaciones/archivos/      ← FE-07
   │   valida, guarda ArchivoImportacion, crea Importacion `pendiente`
   │   contesta 201 con el id  ← ACÁ TERMINA LA PETICIÓN
   │
   └── transaction.on_commit → procesar_importacion.delay(id)
                                 │
   (otro proceso: connectors-worker)│
                                 ▼
   Importacion `pendiente` ──→ avanzar_a(`procesando`)        ← inicio
                                 │
                                 ├── archivos.validar(bytes)  → separador
                                 │
                                 └── csv_candidatos.leer(...) ← S3-FE-11/12/13
                                       │
                                       ├── candidatos → CobroCandidato
                                       └── errores    → Importacion.errores
                                 │
                                 ▼
                           avanzar_a(`completada`)            ← final
```

El dato que falta por el camino es el **separador**: lo detectó FE-07 al
validar y no quedó guardado en `ArchivoImportacion`. La tarea vuelve a pasar
los mismos bytes por `archivos.validar`, que es una función pura, así que
devuelve el mismo separador que entonces. Adivinarlo otra vez con otra regla
sería la forma más fácil de leer el archivo distinto de como se validó.

El tope de tamaño de esa segunda validación es el del propio archivo y no el
de `settings`: la cuota de tamaño ya se aplicó al subir, y si alguien bajó el
máximo entremedio, un archivo que entró legítimamente no tiene por qué
fallar recién ahora.

## Cómo se llaman los datos

### Lo que entra a la tarea

Un solo argumento: el **id de la importación**. No el archivo, no los bytes.
Un mensaje de Celery viaja por Redis y se serializa a JSON; mandar 5 MB de
cartola por ahí sería guardar el archivo dos veces y en el lugar equivocado.
De ese id sale todo el resto:

| Dato | De dónde | Para qué |
|---|---|---|
| `organizacion_id` | `Importacion` | de quién es cada candidato (RF-26) |
| `nombre_archivo` | `Importacion` | revalidar la extensión |
| `contenido` | `ArchivoImportacion` | los bytes, en la base |
| `sha256` | `ArchivoImportacion` | la mitad del identificador de cada candidato |
| `formato` | `ArchivoImportacion` | hoy solo `csv` tiene lector |

### Lo que se guarda: `CobroCandidato`

La tabla `cobro_candidato` es la forma persistida de `candidatos.Candidato`,
el dataclass de S3-FE-01: los mismos doce campos, uno por columna.

Hace falta porque `Importacion.candidatos_detectados` es un **contador** y
sirve solo para la barra de progreso. La vista previa (S3-FE-14) necesita las
filas, y volver a leer el archivo no es una opción: `ArchivoImportacion` es
almacenamiento temporal y la purga lo borra a los
`IMPORTACION_DIAS_RETENCION` días. Lo que sobra es el archivo; el resultado
queda.

S3-FE-09 va a escribir en esta misma tabla con `origen="correo"`: el punto de
S3-FE-01 era justamente que los dos orígenes produzcan lo mismo.

| Columna | Qué es |
|---|---|
| `importacion` | de qué lectura salió (CASCADE: sin ella no significa nada) |
| `origen` | `csv` o `correo` |
| `identificador_origen` | en CSV, `<sha256>:<número de fila>` |
| `servicio` | NULL cuando no se pudo resolver sin inventar |
| `servicio_texto` | la glosa tal cual venía, siempre |
| `servicio_resultado` | `reconocido`, `ambiguo` o `desconocido` |
| `importe` | NUMERIC(14,2), nunca float |
| `moneda` | ISO 4217 |
| `fecha` | la del cobro |
| `tipo_mensaje` | de CSV, siempre `cobro_realizado` |
| `estado` | `propuesto` al nacer |
| `evidencia` | `{"fila": "3", "descripcion_original": "PAYPAL *SPOTIFY"}` |

La unicidad en la base es **(organización, origen, identificador de origen)**:
exactamente lo que devuelve `Candidato.clave_deduplicacion()`. Va en la base y
no solo en el código porque una unicidad que se comprueba leyendo antes de
escribir deja pasar dos tareas simultáneas.

### Lo que sale mal: tres códigos nuevos

Los de fila los pone el parser. Estos son los del trabajo, y son estables
igual que los otros porque el frontend decide por ellos:

| Código | Cuándo |
|---|---|
| `archivo_no_disponible` | la purga ya borró el archivo; hay que volver a subirlo |
| `formato_sin_lector` | es un PDF, que se admite al subir pero todavía nadie lee |
| `procesamiento_interrumpido` | se quedó `procesando` y nadie lo terminó |

## Las tres decisiones que conviene no deshacer

**El 201 contesta antes de procesar.** Leer el archivo dentro de la petición
dejaría al navegador esperando y haría inútil toda la máquina de estados de
`Importacion`: el progreso y el polling de FE-08 existen porque el trabajo
ocurre en otra parte.

**Reprocesar no duplica, así que se puede reintentar sin revisar nada.** El
identificador de cada candidato sale del sha256 del archivo y del número de
fila, y la tabla tiene esa unicidad; el `bulk_create` va con
`ignore_conflicts`. Dos corridas de la misma importación escriben las mismas
filas, no el doble. Lo mismo con los errores: se reemplazan en vez de
sumarse, o `errores_totales` crecería en cada pasada.

**El resultado se publica entero o no se publica.** El cierre se *reclama*
primero, con el estado esperado en el `WHERE`, y dentro de la misma
transacción que inserta los candidatos. Si otra corrida ya cerró la
importación —el rescate, típicamente—, el `UPDATE` afecta 0 filas y no se
escribe nada: ni candidatos, ni contadores, ni errores, ni estado.

Esto lo encontró la revisión de #147 y era un error real. Antes el worker
publicaba su resultado sin preguntar y después intentaba mover el estado:

```
rescate: la cierra FALLIDA · procesamiento_interrumpido
worker:  sigue vivo, escribe 2 candidatos, contadores y errores=[]
queda:   FALLIDA, 2 candidatos, errores_totales=0
```

Una terminal mentirosa, y terminal significa que no se corrige nunca más. El
mismo cuidado va en `_terminar_mal`, que escribe el motivo y el estado en una
sola operación condicionada, y por eso el rescate puede volver a usarla.

El `UPDATE` condicionado también **bloquea la fila** hasta el commit, así que
en PostgreSQL nadie se mete entre el cierre y la inserción: el que llega
segundo reevalúa el `WHERE` con la fila ya cambiada y se encuentra 0 filas.

**Ningún estado se queda sin final.** El broker es Redis y Redis no es
durable: si el worker se cae con la tarea tomada, el mensaje se pierde. Sin
nada más, esa importación se queda `pendiente` o `procesando` para siempre, y
el criterio de la tarjeta es justamente que el estado refleje el final. Un
estado que no avanza nunca no refleja nada, y el frontend hace polling eterno.

`rescatar_importaciones_estancadas` corre cada 5 minutos:

| Lo que encuentra | Qué hace | Plazo |
|---|---|---|
| `pendiente` hace rato | la vuelve a encolar | `IMPORTACION_REENCOLAR_TRAS_MINUTOS`, 5 |
| `procesando` hace mucho | la marca `fallida` | `IMPORTACION_ESTANCADA_TRAS_MINUTOS`, 30 |

Los dos plazos son asimétricos a propósito. Reencolar es gratis: si la tarea
original estaba en vuelo, la guarda de `avanzar_a` deja pasar solo a una.
Marcar `fallida` es irreversible —es un estado terminal—, así que ese límite
está muy por encima de lo que tarda un archivo grande, o se mataría trabajo
que iba a terminar bien.

Solo se reencolan las de origen `csv`: una importación de correo (FE-13)
también nace `pendiente` y esta tarea no sabe leerla.

### Lo que el archivo no dice y hay que configurar

| Variable | Por omisión | Qué pasa si está mal |
|---|---|---|
| `IMPORTACION_MONEDA_POR_DEFECTO` | `CLP` | sin ella, cada fila de una cartola chilena normal se rechaza con `moneda_no_indicada` |
| `IMPORTACION_ORDEN_FECHA` | vacío = deducirlo | un orden declarado que el archivo no usa corre todas las fechas un mes |

Las dos se validan **al cargar el módulo**, no al usarlas: con un valor
escrito de otra forma —`DMY` en mayúsculas, una moneda que no está en la
tabla— el parser no lanza nada, cae en la rama de "no se pudo desambiguar" y
rechaza calladamente fila por fila. Un error de configuración que se
manifiesta como "tu cartola está mala" es lo peor de los dos mundos, así que
el proceso no arranca con un valor que no existe.

## Lo que falta

**En el cluster no hay quién ejecute esto.** `connectors` todavía no tiene
Deployment en `k8s/` (está en la lista de `k8s/tandas/perfiles.yaml`), y sin
`connectors-worker` la importación se queda `pendiente`. En
`docker-compose.yml` el worker sí existe y el circuito corre completo.

**Falta la vista previa**: S3-FE-14 expone estos candidatos y estos errores,
S3-FE-15 y S3-FE-16 los confirman o los rechazan, y S3-FE-17 los deduplica
entre archivos, que es para lo que existe la unicidad de la tabla.

**El PDF sigue sin lector.** Se admite al subir desde FE-07 y acá termina en
`formato_sin_lector`. Es honesto, pero es una puerta que promete algo que no
está.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_procesar_importacion.py -q
```

33 pruebas. La primera sube un CSV por el endpoint real con Celery en modo
síncrono y comprueba que lo que queda en la base salió del archivo que se
subió: sin eso, "llega al parser real" no se puede afirmar.

Tres de ellas se comprobaron rompiendo el código a propósito, porque una
prueba que pasa igual con el error puesto no prueba nada:

- la que exige que los números se escriban **antes** del estado terminal
  pasaba con el orden invertido, porque el espía anotaba en cada transición y
  la segunda pisaba la primera. Ahora anota solo la primera vez y falla.
- la de no duplicar falla con `IntegrityError` si se le quita
  `ignore_conflicts`, que es lo que demuestra que la unicidad hace algo.
- la de la carrera entre el rescate y el worker vivo encontró un error de
  verdad: el rescate escribía el motivo antes de reclamar la transición, y
  con eso le borraba los errores reales a una importación que terminó bien.
- y la revisión de #147 encontró **la misma carrera al revés**, que estas
  pruebas no cubrían: el worker tardío publicando sobre un cierre ajeno. Hay
  dos pruebas nuevas que paran el parser a mitad, corren el rescate de verdad
  y comprueban que el worker no toca nada al volver — una por el camino bueno
  y otra por el de error de archivo.

Lo que estas pruebas NO cubren es PostgreSQL: acá corren en SQLite. Dos cosas
solo se ven allá —`BinaryField` devuelve `memoryview` y no `bytes`, y
`ignore_conflicts` se traduce a `ON CONFLICT DO NOTHING`—, y de eso se
encarga la CI, que levanta un Postgres 16 de verdad.
