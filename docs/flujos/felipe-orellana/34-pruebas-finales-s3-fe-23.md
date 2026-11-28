# S3-FE-23 — Pruebas finales: detección, CSV, duplicados, reintentos y avisos obsoletos

**Qué es.** Los casos de la tarjeta recorridos **de punta a punta**, con los
módulos reales encadenados: desde que llega el correo o el archivo hasta la
orden de crear el cobro, y desde el evento de la suscripción hasta el correo
del aviso. Cada pieza ya tenía sus pruebas por tarjeta; esto prueba que
juntas hacen lo que promete el sprint.

| Criterio de la tarjeta | Dónde se cumple | ¿Demostrado? |
|---|---|---|
| Quedan pruebas reproducibles positivas y negativas | 15 pruebas en dos archivos (abajo), cada uno con su control positivo o negativo | Sí, en local y en la CI |
| Se identifican mocks y evidencia de entrega real cuando corresponda | la columna «Doble» de cada caso; la sección «Lo que NO se probó con un proveedor real» | Sí. **No hay evidencia con proveedores reales**: falta una cuenta de prueba |
| Evidencia enlazada; revisión y validación del receptor | — | Falta la PR y su revisión |

> **Depende de #214 y #215.** Los casos 4, 5 y 6 usan la lectura programada
> (S3-FE-18/20) y la invalidación de avisos (S3-FE-22), que todavía no están
> en `main`. La rama de esta tarjeta las trae fusionadas para poder correrlas
> juntas. Cuando entren, el diff de la PR queda solo en lo de FE-23.

## Entorno

| | Local | CI |
|---|---|---|
| Sistema | Windows 11, Python 3.14.0 | GitHub Actions, Ubuntu |
| Base | SQLite en memoria (el `conftest` la cambia) | PostgreSQL 16 |
| Pruebas con dos conexiones | se saltan | se corren |
| Commit | `a949221` (main + #214 + #215) más esta tarjeta | el de la PR |

Para repetirlas:

```bash
cd services/connectors    && pytest tests/test_pruebas_finales_s3_fe_23.py
cd services/notifications && pytest tests/test_pruebas_finales_s3_fe_23.py
```

En local hacen falta `SECRET_KEY`, `DATABASE_URL` y, en connectors,
`CELERY_BROKER_URL` con cualquier valor: la base de las pruebas es SQLite y
nadie se conecta a esas URL.

## Qué es un doble y qué es real

| Lado | Doble | Real |
|---|---|---|
| connectors | solo `requests.get` del lector de Gmail (`GoogleFalso`, con las respuestas copiadas de la API de Gmail) | el lector, la lectura programada, el guardado de candidatos, la tarea que procesa el CSV, la confirmación, el outbox y la API de desconexión |
| notifications | el proveedor de correo es el buzón en memoria de Django (`locmem`), y el directorio de personas y correos de auth (`tests/directorio_falso.py`, desde S3-FE-21) | la proyección, el generador, la invalidación, la planificación, el despacho completo y la API de la campana |

## Los casos

### Caso 1 — Un correo autorizado termina en un candidato con su evidencia

| | |
|---|---|
| Pasos | una cuenta de Gmail conectada con dos correos: un recibo de Netflix y un boletín sin cobro. Se lee la cuenta con `leer_cuenta` |
| Esperado | un candidato `propuesto`: Netflix, 9.990 CLP, 01-10-2026, con el Message-ID como evidencia. El boletín no deja nada. Ninguna orden, porque leer no confirma |
| Obtenido | igual. La importación queda `completada` con 1 candidato y 0 errores, y la cuenta queda `al_dia` |
| Negativo | el mismo recibo, pero llegado un año **antes** del cobro que declara: no hay candidato, y queda el error `fecha_no_indicada` con el identificador del mensaje |
| Repetido | leer otra vez 15 minutos después no duplica el candidato |

### Caso 2 — Un CSV mixto

| | |
|---|---|
| Pasos | un archivo de 6 filas: Netflix válido, una sin glosa, una con fecha ilegible, una con monto ilegible y dos cobros iguales de Spotify |
| Esperado | 3 candidatos (los dos de Spotify son dos cobros: S3-FE-17) y 3 rechazos, cada uno con su fila y su motivo |
| Obtenido | igual: `descripcion_vacia` en la fila 3, `fecha_invalida` en la 4 e `importe_invalido` en la 5 |
| Negativo | un archivo con todas las fechas `dd/mm` de día 12 o menos no adivina: cada fila sale con `fecha_ambigua` |
| Repetido | subir el mismo archivo y volver a confirmar todo no agrega candidatos ni órdenes: siguen 3 |

### Caso 3 — Confirmar dos veces deja una sola orden

| | |
|---|---|
| Pasos | se lee un recibo y se confirma su candidato dos veces seguidas. Después se vuelve a leer el correo y se confirma todo otra vez |
| Esperado | la primera confirmación devuelve `True` y la segunda `False`. Una sola orden, que apunta al candidato |
| Obtenido | igual |
| En paralelo | con dos conexiones a PostgreSQL: `test_carrera_confirmar_rechazar_postgres.py` (S3-FE-15), que corre en la CI |

### Caso 4 — Un fallo temporal de Google se reintenta sin perder nada

| | |
|---|---|
| Pasos | Google responde 503 a la lista de mensajes. Mientras la cuenta espera, pasan un tick del beat y una tarea suelta. Al vencer la espera, la cadena dueña reintenta y Google ya responde |
| Esperado | primer intento: `reintentar_en` 60 s, código `falla_del_proveedor` y la cuenta `reintentando`. Mientras espera, nadie la lee. El reintento deja el candidato y la cuenta `al_dia` con 0 fallos |
| Obtenido | igual |
| Además | el tope, el `Retry-After` de una hora y la toma tras un mensaje perdido están en `test_lectura_programada_s3_fe_18_20.py` |

### Caso 5 — Desconectar la cuenta detiene la lectura

| | |
|---|---|
| Pasos | se lee un recibo y después se desconecta la cuenta con `DELETE /api/conectores/<id>/`. Pasa una hora y llega una tarea de lectura |
| Esperado | la cuenta queda `desconectada`, el beat no la programa y la tarea no le pide nada a Google. El candidato ya leído se conserva |
| Obtenido | igual: 200, `{"omitida": "no_conectada"}` y ninguna petición nueva a Google |
| En paralelo | desconectar mientras se guarda una página, con dos conexiones a PostgreSQL: `test_carrera_desconexion_postgres.py` |

### Caso 6 — Cancelar o cambiar la fecha antes del envío del aviso

| | |
|---|---|
| Control | sin cambios, el aviso sale: un correo a la persona, con la fecha 23-11-2026, y la entrega `aceptada`. Sin este control, los demás pasarían aunque el despacho no mandara nunca nada |
| Pasos | una suscripción con cobro pasado mañana, su aviso generado y su correo planificado. Antes del despacho llega una cancelación |
| Esperado | no sale ningún correo, la entrega queda `descartada / alerta_obsoleta`, la campana cuenta 0 y la siguiente corrida del generador no recrea el aviso |
| Obtenido | igual |
| Cambio de fecha | sale un solo correo, con la fecha nueva (22-11-2026) y no la vieja |
| Repetido | la misma cancelación dos veces: la segunda no cambia nada y no sale ningún correo |
| En paralelo | el generador contra una cancelación, con dos conexiones a PostgreSQL: `test_carrera_generador_postgres.py` (revisión de #215) |

## Hallazgo: el mismo cobro por correo y por CSV deja dos órdenes

> **Resuelto en RF-14** ([37-ordenes-de-cobro-rf-14.md](37-ordenes-de-cobro-rf-14.md)):
> las dos órdenes siguen saliendo, cada una con su identificador. subscriptions
> no las junta sola (fecha, importe y moneda iguales no prueban que sea el mismo
> cargo): registra los dos cobros, levanta el posible doble cobro y la persona
> lo concilia en uno, con los dos orígenes, o lo deja como dos. La prueba de
> abajo dejó de ser `xfail` y ahora fija lo que tiene que viajar para eso.

Si el recibo de Netflix del 01-10-2026 llega por correo, y la cartola del
banco trae la misma fila, quedan **dos candidatos**, y confirmar los dos
emite **dos órdenes** de crear el cobro. La unicidad de S3-FE-17 es por
origen: (organización, origen, identificador), y un Message-ID y la huella de
una fila de CSV nunca coinciden.

Hoy no se nota, porque nadie drena esas órdenes todavía (subscriptions no
consume `candidato.confirmado`). Se va a notar en cuanto alguien las drene.

Reconocerlo no es obvio: la fecha del recibo y la de la cartola pueden
diferir en uno o dos días, y la glosa del banco no es el nombre del servicio.
No se arregló dentro de esta tarjeta porque es una decisión de diseño:
avisar «posible duplicado» al confirmar, o deduplicar al drenar con una
ventana de fechas. Queda reproducido en
`test_el_mismo_cobro_por_correo_y_por_csv_deja_una_sola_orden`, marcada
`xfail(strict=True)`. Cuando se arregle, la prueba empieza a pasar, el
`strict` la hace fallar y obliga a quitar la marca.

## Lo que NO se probó con un proveedor real

- **Gmail y Outlook reales.** Ninguna de estas pruebas lee una cuenta real.
  Lo que habla con Google o Microsoft es un doble con respuestas copiadas de
  sus API. Falta una corrida con una cuenta de prueba, que necesita el OAuth
  configurado en un entorno con connectors deployado (hoy no lo está en el
  clúster).
- **Un correo real saliendo.** El aviso se «manda» al buzón en memoria de
  Django. La corrida con un SMTP real es la que S3-FE-21 dejó pendiente.

## Cómo se comprobaron las pruebas

Antes de escribir cada aserción se corrió el flujo real y se miró lo que
devolvía. Dos aserciones cambiaron por eso:
- el recibo con una fecha de llegada mal puesta se rechaza, y quedó como caso
  negativo;
- las fechas `dd/mm` ambiguas no se adivinan, y quedó como el otro negativo
  del CSV.

Después se rompieron a propósito seis guardas del camino. Mueren tres:
- la lectura con un reintento pendiente;
- leer una cuenta desconectada;
- que la proyección no revise los avisos.

Sobreviven tres, porque son capas dobles que el camino completo no
distingue:
- el retorno temprano de `confirmar`, que la actualización condicional
  respalda;
- el descarte de los correos en `revisar` y en `reclamar`: cada uno cubre al
  otro con el mismo motivo.

Cada una de esas capas sí tiene una prueba propia que la mata, en su
tarjeta (S3-FE-15 y S3-FE-22).

Resultado en la rama de integración: connectors, 1336 pasan, 23 se saltan
(las de PostgreSQL) y 1 `xfail` (el hallazgo); notifications, 363 pasan y 14
se saltan.
