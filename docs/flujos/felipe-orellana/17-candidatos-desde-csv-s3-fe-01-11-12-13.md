# S3-FE-01, 11, 12 y 13 — De una cartola a candidatos de cobro

**Qué hace.** Toma el CSV que FE-07 ya recibió y validó, lo lee fila por fila
y devuelve **candidatos de cobro** y **errores por fila**. No crea ni toca
ninguna suscripción: un candidato es una propuesta que alguien va a mirar
después.

Son cuatro tarjetas que en el código son dos archivos, porque son una sola
pasada sobre el archivo:

| Tarjeta | Qué aporta |
|---|---|
| S3-FE-01 | el **formato** del candidato, común a CSV y a correo |
| S3-FE-11 | ¿están las columnas? ¿esta fila tiene la forma correcta? |
| S3-FE-12 | convertir `1.234,56`, `$` y `03/04/2026` a valores canónicos |
| S3-FE-13 | juntar los errores **sin** botar las filas buenas |

**Dónde está.**

| Pieza | Archivo |
|---|---|
| El candidato común | `connectors/candidatos.py` |
| La lectura del CSV | `connectors/csv_candidatos.py` |
| La decodificación compartida con FE-07 | `connectors/archivos.py` → `decodificar` |
| El catálogo de proveedores que se reutiliza | `connectors/normalizacion.py` (FE-12) |
| Las pruebas | `services/connectors/tests/test_csv_candidatos.py`, 51 |

## El flujo: de dónde vienen los datos

```
persona sube un archivo
   │
   ▼
POST /api/importaciones/archivos/        ← FE-07, SubirArchivoView
   │   valida extensión, tamaño y contenido real
   │   guarda el archivo en ArchivoImportacion
   │   crea la Importacion en `pendiente`
   │   devuelve 201 con el id
   │
   │   ArchivoValidado{ nombre, formato, tamano, sha256, filas, separador }
   ▼
csv_candidatos.leer(contenido, separador=…, sha256=…, organizacion_id=…)
   │
   ├── mapear_columnas(cabecera)         ← S3-FE-11, falla el ARCHIVO entero
   ├── detectar_orden_fecha(columna)     ← S3-FE-12, mira todas las filas
   │
   └── por cada fila:
         detectar_moneda → convertir_importe → convertir_fecha   ← S3-FE-12
         normalizacion.normalizar(glosa)                         ← FE-12
         │
         ├── salió bien  → Candidato                             ← S3-FE-01
         └── salió mal   → ErrorFila{ fila, codigo, mensaje }    ← S3-FE-13
   │
   ▼
ResultadoLectura{ candidatos, errores, filas_totales }
   │
   ▼
S3-FE-10: la tarea que guarda los candidatos, vuelca los errores en
   Importacion.errores y mueve la Importacion a `completada`
```

Los dos datos que vienen de FE-07 y que hay que pasarle sí o sí son el
**separador** (lo detectó al validar; volver a adivinarlo acá podría dar otro)
y el **sha256** del archivo, que es de lo que se arma el identificador de cada
candidato.

## Cómo se llaman los datos

### Lo que entra: las columnas del CSV

Cada banco le pone otro nombre a lo mismo. Se comparan sin tildes, sin
mayúsculas y sin espacios de más.

| Campo canónico | ¿Obligatorio? | Nombres que se aceptan |
|---|---|---|
| `fecha` | sí | Fecha · Fecha Movimiento · Fecha de Movimiento · Fecha Transacción · Fecha Operación · Fecha Contable · Date |
| `descripcion` | sí | Descripción · Detalle · Glosa · Concepto · Comercio · Description |
| `monto` | sí | Monto · Importe · Cargo · Valor · Monto Total · Amount |
| `moneda` | no | Moneda · Divisa · Currency |

Si una columna obligatoria no está, **no se lee nada**: el error es del
archivo y dice cuál falta. Si `moneda` no está, se usa la que declare quien
importa (`moneda_por_defecto`); si tampoco hay, cada fila se rechaza.

### Lo que sale: el candidato

`Candidato` es inmutable y es el **mismo** para CSV y para correo. Ese es el
punto de S3-FE-01: de acá en adelante —vista previa, confirmación, duplicados,
creación de suscripciones— nadie tiene que preguntar de dónde vino.

| Campo | Qué es |
|---|---|
| `origen` | `csv` o `correo` |
| `identificador_origen` | en CSV, `<sha256 del archivo>:<número de fila>`; en correo, el Message-ID |
| `organizacion_id` | de quién es |
| `servicio` | nombre canónico del proveedor, o `None` si no se pudo resolver sin inventar |
| `servicio_texto` | la glosa tal cual venía. **Siempre**, aunque se haya reconocido |
| `servicio_resultado` | `reconocido`, `ambiguo` o `desconocido` |
| `importe` | `Decimal`. Nunca `float`: el constructor lo rechaza |
| `moneda` | ISO 4217 en mayúsculas. Nunca un símbolo |
| `fecha` | `date` |
| `tipo_mensaje` | `cobro_realizado`, `aviso_de_cobro` o `pago_fallido` |
| `estado` | `propuesto` al nacer; `confirmado` o `rechazado` los pone una persona |
| `evidencia` | lo mínimo para comprobarlo: en CSV, número de fila y glosa original |

Una fila de cartola siempre nace como `cobro_realizado`: registra algo que ya
pasó. Los avisos y los fallos llegan por correo y los distingue S3-FE-08.

### Lo que sale mal: los códigos de error

Son estables; el frontend decide por ellos.

**Del archivo entero** (`CsvInvalido`, no hay filas que rescatar):

| Código | Cuándo |
|---|---|
| `faltan_columnas` | falta `fecha`, `descripcion` o `monto` |
| `cabecera_vacia` | la primera fila no tiene encabezados |
| `orden_fecha_inconsistente` | hay filas que solo se explican como día/mes y otras solo como mes/día |

**De una fila** (`ErrorFila{ fila, codigo, mensaje }`, las otras filas siguen):

| Código | Cuándo |
|---|---|
| `fila_incompleta` | menos columnas que las obligatorias |
| `descripcion_vacia` | no se sabe a quién se le pagó |
| `fecha_invalida` | no se entiende, o no existe (`31/02`) |
| `fecha_ambigua` | puede ser día/mes o mes/día y nada lo aclara |
| `importe_invalido` | no se entiende, o lleva más decimales de los que admite la moneda |
| `importe_cero` | una línea en cero no es un cobro |
| `moneda_ambigua` | dice `$`, que no distingue pesos de dólares |
| `moneda_desconocida` | un código que no está en la tabla |
| `moneda_no_indicada` | la fila no la trae y no se declaró una por omisión |

`fila` es la línea **física** del archivo contando la cabecera como 1: la
misma que la persona ve al abrir el CSV en su planilla, que es la única que le
sirve para ir a arreglarlo. Sale del contador del lector de CSV y no de un
contador propio, porque una glosa con un salto de línea entre comillas ocupa
dos líneas del archivo y una sola fila.

## Las tres decisiones que conviene no deshacer

**Una fila mala no arruina el archivo.** Un CSV de 200 filas con 3 malas
entrega 197 candidatos y 3 rechazos trazables. Lo contrario obliga a corregir
el archivo a ciegas, una fila por intento. Lo único que detiene la lectura es
que falte una columna: ahí no hay nada que leer.

**Lo ambiguo se rechaza, no se adivina.** `03/04/2026` es 3 de abril o 4 de
marzo; `$ 1.500` son mil quinientos pesos o mil quinientos dólares. Las dos
lecturas son defendibles, y elegir en silencio mete un error que nadie
encuentra después: la suscripción queda con la fecha corrida un mes, o con el
monto 900 veces mayor.

Para la fecha se resuelve en tres pasos, el primero que sirva:

1. lo que declare quien importa (`orden_fecha`)
2. lo que el archivo demuestre: si **alguna** fila trae un día mayor que 12,
   el orden queda fijado para todas
3. si no hay ninguna de las dos, la fila se rechaza con su motivo

El paso 2 es lo que lo hace usable en la práctica: una cartola real casi
siempre tiene algún día 13 o más, y basta una fila para desambiguar el resto.

**La plata es `Decimal`.** `0.1 + 0.2` en binario no da `0.3`, y esto es
dinero de otra persona. Entra como `Decimal`, sale como `Decimal`, y
`como_json` lo serializa como **texto**: en JSON un decimal lo lee el otro
lado como `float` y ahí se pierde lo que se cuidó todo el camino.

### El separador decimal, que es el caso que más rompe

Si vienen los dos, manda **el último**: en `1.234,56` la coma, en `1,234.56`
el punto. Si viene uno solo, deciden los dígitos que lo siguen:

| Dígitos después del separador | Qué es | Ejemplo |
|---|---|---|
| 1 o 2 | decimal | `1500,5` → 1500.5 |
| 3 | miles | `1,500` → 1500 |
| otro | inválido | |

El grupo de tres es miles porque ninguna de las monedas aceptadas tiene tres
decimales. Si alguna vez entra una que sí —el dinar kuwaití tiene tres—, hay
que revisar **esta regla**, no solo la tabla de monedas.

Y el peso chileno no tiene centavos: `1500,50` en CLP se rechaza en vez de
redondearse.

## Quién lo usa, y lo que falta

**S3-FE-10** es el cable: `procesar_importacion` toma el archivo que
guardó la subida, lo pasa por acá y deja los candidatos en
`CobroCandidato` (ver
[18-procesar-la-importacion-s3-fe-10.md](18-procesar-la-importacion-s3-fe-10.md)).

Después vienen **S3-FE-14** (exponer candidatos y errores para la vista
previa), **S3-FE-15 y S3-FE-16** (confirmar y rechazar) y **S3-FE-17**
(no duplicar), que es para lo que existe `clave_deduplicacion()`.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_csv_candidatos.py -q
```

51 pruebas, todas funciones puras: sin base, sin red y sin API. Cubren un
caso por criterio de aceptación de cada tarjeta, más los que rompen una
cartola real: separadores al revés, el `$` solo, la fecha que solo se entiende
mirando el archivo entero, una cartola en Latin-1 y una glosa con un salto de
línea entre comillas.
