# S3-FE-17 — Evitar duplicados al importar o confirmar de nuevo

**Qué hace.** Garantiza que un cobro real termine en **una sola** orden de
crear, por más veces que se importe o se confirme.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Repetir o confirmar en paralelo no duplica suscripciones ni cobros | la huella del cobro (esta tarjeta) + la confirmación idempotente con guarda en el `WHERE` (S3-FE-15) |
| El mismo origen en organizaciones distintas permanece aislado | la restricción única lleva la organización |

## Lo que faltaba: reimportar

Confirmar dos veces, o en paralelo, ya dejaba una sola orden desde S3-FE-15.
Lo que no estaba cubierto era **volver a importar**.

El identificador de una fila CSV era `<sha256 del archivo>:<número de fila>`.
Eso solo deduplicaba si se subía **el mismo archivo, byte por byte**. Lo normal
es otra cosa:

```
cartola de octubre            → 2026-10-01 NETFLIX.COM 9990
cartola de octubre-noviembre  → 2026-10-01 NETFLIX.COM 9990   ← el mismo cobro
                                2026-11-01 NETFLIX.COM 9990
```

Archivos distintos, dos candidatos para el mismo cobro del 1 de octubre, y al
confirmarlos, **dos órdenes de crear el mismo cobro**. Se reprodujo así antes
de cambiar nada.

## La huella del cobro

Ahora el identificador de una fila CSV sale **del cobro**, no del archivo:

```
csv:sha256( fecha | importe con 2 decimales | moneda | glosa normalizada | ocurrencia )
```

| Parte | Por qué |
|---|---|
| fecha, importe, moneda | lo que el lector **entendió**: `9.990`, `9990` y `01/10/2026` contra `2026-10-01` coinciden |
| glosa normalizada | sin mayúsculas, tildes ni espacios de más, pero **entera** |
| ocurrencia | la primera fila con esos datos dentro del archivo es la 1, la segunda la 2 |

La unicidad de la base sigue siendo la misma —(organización, origen,
identificador)— así que una segunda importación que trae el mismo cobro choca
con el que ya está y **no lo vuelve a proponer**, esté propuesto, confirmado o
rechazado.

### Dos cobros iguales el mismo día siguen siendo dos

Dos licencias del mismo plan cobradas el mismo día son posibles. Por eso entra
la ocurrencia: dentro de un archivo, el segundo cobro idéntico es la
ocurrencia 2 y no choca con el primero. Si la primera exportación trae uno y
la segunda los dos (el segundo se cobró después de exportar), el primero
coincide y el segundo entra como nuevo.

### La procedencia no se pierde

El archivo y la fila exactos ya no van en el identificador: quedan en la
evidencia del candidato, `{"fila": "2", "archivo_sha256": "…", "descripcion_original": "…"}`.
El candidato que sobrevive es el de la **primera** lectura, con su archivo y
su fila.

## Lo que ve la vista previa

Una reimportación cuenta como `candidatos_detectados` **solo los cobros
nuevos**. Las filas que ya estaban no son errores ni candidatos, así que se
deducen:

```
ya importadas = filas_totales − candidatos_detectados − errores_totales
```

Subir dos veces la misma cartola de 10 filas da `10 / 0 / 0`: diez filas
leídas, ninguna nueva, ningún error. Conviene que S3-CH-04 lo muestre así
(«10 filas ya importadas») y no como «no se detectó nada».

## El límite, dicho

- **Dos cuentas con el mismo cobro.** Si dos cuentas distintas tienen el mismo
  cobro el mismo día, por el mismo monto y con la misma glosa, y se importan en
  archivos separados, la segunda se toma por la primera. Se eligió así porque
  la exportación traslapada es lo común y un cobro duplicado entra al
  presupuesto; el caso contrario es raro y queda contado como «ya importada».
- **Bancos que escriben distinto la glosa.** `NETFLIX.COM` y `NETFLIX.CL` son
  dos candidatos. Ante la duda se propone de más: un candidato sobrante se
  rechaza con un clic, uno perdido no se ve nunca.
- **Del otro lado.** Esto garantiza **una orden por cobro**. Que la orden cree
  una sola suscripción y un solo cobro en `subscriptions` le toca al consumidor
  de VI-09: el sobre trae `candidato_id`, que es la llave para aplicarla una
  sola vez.

## Concurrencia

Dos importaciones que se traslapan pueden procesarse a la vez, en workers
distintos. Ninguna ve a la otra al leer, porque la otra no ha confirmado; lo
que lo sostiene es la restricción única: el segundo `INSERT` del mismo
identificador **espera** a que el primero confirme o revierta.

- Si el primero confirma, el segundo descarta su copia y guarda solo lo nuevo.
- Si el primero revierte, el segundo se queda con el cobro: no se pierde.

### Siempre en el mismo orden

Esperar solo es seguro si todos esperan en el mismo orden. Dos cartolas pueden
compartir **dos** cobros y traerlos al revés: la de A trae X y después Y, la
de B trae Y y después X. Si cada worker insertara en el orden de su archivo,
uno tomaría X y esperaría Y mientras el otro tomó Y y espera X. Es un ciclo:
PostgreSQL mata a uno y esa importación entera se revierte, también sus
cobros propios.

Por eso los candidatos se insertan **ordenados por la llave única**, no por
el orden del archivo. Dentro de una importación la organización y el origen
son los mismos, así que basta el identificador. La ocurrencia ya se asignó al
leer, en el orden del archivo, y ordenar después no la cambia. Lo encontró la
revisión de #171; se reprodujo el bloqueo con dos conexiones antes de
corregirlo (`deadlock detected`).

Las tres salidas —el primero confirma, el primero revierte, y dos cobros
compartidos en orden inverso— están probadas con dos conexiones a PostgreSQL
en `test_carrera_reimportar_postgres.py`. SQLite no puede mostrarlo: bloquea
la base entera.

## Dónde está

| Pieza | Archivo |
|---|---|
| La huella | `connectors/csv_candidatos.py` → `huella_csv`, `_con_huella` |
| El texto de ayuda del campo | migración `0009_identificador_es_la_huella_del_cobro` (sin cambios en la base) |
| Las pruebas | `tests/test_duplicados_s3_fe_17.py` (22) y `tests/test_carrera_reimportar_postgres.py` (3) |

Las pruebas se comprobaron rompiendo el código a propósito: volver al
identificador por archivo, no contar la ocurrencia, no normalizar la glosa,
no fijar los decimales del importe, sacar la moneda o la fecha de la huella,
usar un separador que se confunde con los datos y sacar el archivo de la
evidencia. Cada una hace fallar al menos una prueba.
