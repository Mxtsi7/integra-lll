# S3-FE-14 — Consultar los candidatos y los errores para la vista previa

**Qué hace.** Expone lo que quedó guardado después de leer un CSV o un correo,
para que la web pueda mostrarlo antes de que alguien decida. Es solo lectura:
confirmar y rechazar son S3-FE-15 y S3-FE-16, y tienen sus propias rutas.

Los dos criterios de la tarjeta:

| Criterio | Dónde se cumple |
|---|---|
| Chris puede listar ambos orígenes y errores reales | `GET /api/candidatos/` trae `csv` y `correo` en la misma lista; los errores por fila ya viajan en `GET /api/importaciones/<id>/` |
| Una organización no consulta resultados de otra | `MezclaTenant` filtra por `X-Organizacion-Id`; un candidato ajeno responde 404 |

**Dónde está.**

| Pieza | Archivo |
|---|---|
| La vista | `connectors/views.py` → `CobroCandidatoViewSet` |
| El serializer | `connectors/serializers.py` → `CobroCandidatoSerializer` |
| La ruta del servicio | `connectors/urls.py` |
| La ruta del gateway | `gateway/config/settings.py` → `RUTAS` |
| Las pruebas | `services/connectors/tests/test_candidatos_api.py`, 29, más 3 en `gateway/tests/test_gateway.py` |

## El flujo: de dónde vienen los datos

```
navegador
   │  GET /api/candidatos/?importacion=<id>
   ▼
gateway                                   ← valida el JWT (ADR-004)
   │   RUTAS["/api/candidatos/"] = connectors
   │   borra la identidad que venga del cliente
   │   inyecta X-Organizacion-Id del token
   ▼
connectors · CobroCandidatoViewSet
   │   MezclaTenant → .filter(organizacion_id=<la de la cabecera>)
   │   filtros: importacion, origen, estado
   ▼
tabla `cobro_candidato`                   ← la escribió S3-FE-10 (CSV)
                                             y la escribirá S3-FE-09 (correo)
```

Los datos no se calculan acá: ya están en la tabla. Esta tarjeta es contrato y
aislamiento, no lógica.

**La entrada en el gateway no es un detalle.** El gateway enruta por prefijo y
una ruta que no está en `RUTAS` es un 404 que desde afuera parece "la API no
existe". Hay una prueba del gateway que falla si se saca la entrada.

## Cómo se llaman los datos

### Lo que entra: los filtros

| Parámetro | Valores | Para quién |
|---|---|---|
| `importacion` | un UUID | S3-CH-06: las filas válidas de UN archivo, al lado de sus errores |
| `origen` | `csv` · `correo` | S3-CH-04; sin el filtro vienen los dos |
| `estado` | `propuesto` · `confirmado` · `rechazado` | S3-CH-09, para no mostrar lo ya rechazado |
| `page`, `page_size` | hasta 100 | la misma paginación que el resto del servicio |

Un valor que no existe es un **400 que dice qué campo está mal**, no un 500 ni
una lista completa. Un `importacion` que no es UUID también: dejarlo pasar al
ORM sería un 500 por algo que escribió el cliente.

Los filtros se aplican **solo al listado**. En el detalle no, porque `retrieve`
pasa por el mismo código y un parámetro colgado haría desaparecer el recurso
con un 404 inexplicable. Es el mismo cuidado que ya tenía `ImportacionViewSet`.

### Lo que sale: el candidato

17 campos, listados explícitos en el serializer:

| Campo | Qué es |
|---|---|
| `id` | UUID del candidato. Estable entre consultas |
| `importacion` | de qué lectura salió |
| `origen`, `origen_legible` | `csv` o `correo`, y su etiqueta |
| `identificador_origen` | el mismo para el mismo hecho leído dos veces: es lo que le permite a S3-CH-04 recargar sin duplicar |
| `servicio` | **`null`** cuando no se pudo resolver sin inventar |
| `servicio_texto` | la glosa tal cual venía. Siempre |
| `servicio_resultado` | `reconocido`, `ambiguo` o `desconocido`: el por qué del `null` |
| `importe` | **texto**, no número. Ver abajo |
| `moneda` | ISO 4217 |
| `fecha` | la del cobro |
| `tipo_mensaje`, `tipo_mensaje_legible` | `cobro_realizado`, `aviso_de_cobro` o `pago_fallido` |
| `estado`, `estado_legible` | `propuesto` al nacer |
| `evidencia` | `{"fila": "3", "descripcion_original": "PAYPAL *SPOTIFY"}` |
| `creado_en` | cuándo se detectó |

Hay una prueba que fija **el conjunto exacto** de campos: agregar o quitar uno
es cambiar el contrato, y la prueba obliga a que sea a propósito.

### Los errores no están en esta ruta, y es deliberado

Un error de fila **no es un candidato**: no tiene servicio, ni importe, ni
fecha. Viven en `Importacion.errores` y ya se exponen en
`GET /api/importaciones/<id>/`:

```json
{
  "estado": "completada",
  "candidatos_detectados": 2,
  "errores_totales": 1,
  "errores": [{"fila": 3, "codigo": "importe_invalido", "mensaje": "..."}]
}
```

`errores` se corta en `Importacion.MAXIMO_ERRORES` (20) y `errores_totales`
dice cuántos hubo de verdad: un CSV de 5.000 filas malas no puede devolver
5.000 errores en un polling. Una ruta nueva para esto serían dos contratos
para el mismo dato.

## Las tres decisiones que conviene no deshacer

**Ruta propia, no anidada bajo `importaciones/`.** S3-CH-04 lista los
candidatos de los **dos orígenes juntos**, y los de correo no vienen de una
importación de archivo. Colgarlos de `importaciones/<id>/candidatos/`
obligaría a pedirlos archivo por archivo y dejaría los de correo sin dónde
vivir.

**Solo lectura: `POST`, `PATCH`, `PUT` y `DELETE` son 405.** Un candidato lo
escribe el lector que leyó su origen. Confirmar no es "editar un campo":
**crea suscripciones y cobros**, así que va por su propia ruta con su propia
revisión (S3-FE-15). Un `PATCH` abierto acá dejaría cambiarle el importe a un
candidato que se presenta como evidencia de lo que decía la cartola.

**El importe viaja como texto.** Lo decide `COERCE_DECIMAL_TO_STRING`, que DRF
trae en `True`. No es estético: en JSON un decimal lo lee el otro lado como
`float` y ahí se pierde la exactitud que se cuidó desde el parser. Si alguien
pone esa opción en `False`, el contrato cambia sin que nadie lo note; hay una
prueba que lo fija.

### El orden, que parece un detalle y no lo es

Cronológico por fecha de cobro, como venían en la cartola, y desempatado por
`creado_en` y por `id`. Los tres: el orden tiene que ser **total**, no solo
parecerlo.

La primera versión ordenaba por `fecha, creado_en` y eso **no alcanza**. Los
candidatos de un CSV entran con un solo `bulk_create`, así que comparten
`creado_en` al microsegundo; con el empate sin desempatar, PostgreSQL puede
devolverlos en distinto orden en cada consulta con `LIMIT/OFFSET`, y entonces
una página repite filas que ya salieron en la anterior y se salta otras.

Medido, no supuesto: 250 candidatos empatados, recorridos en 25 páginas de 10,
devolvían **239 ids únicos**. Once candidatos que la vista previa no mostraba
nunca, sin un solo error y con `count` diciendo 250. Lo encontró la revisión
de #155.

El `id` es un UUID, así que el desempate no significa nada para la persona. No
importa: lo que la paginación necesita no es que el orden sea bonito, es que
sea el mismo en las dos consultas.

## Lo que falta

- **Los candidatos de correo** (S3-FE-09) todavía no existen, así que hoy la
  lista trae solo `csv`. La ruta ya los soporta: es la misma tabla y el mismo
  contrato, y por eso una prueba crea uno de correo a mano para comprobar que
  el filtro `origen=correo` funciona antes de que haya un lector.
- **Confirmar y rechazar**: S3-FE-15 y S3-FE-16.
- **No duplicar entre archivos**: S3-FE-17, que usa el
  `identificador_origen` que esta ruta ya expone.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_candidatos_api.py -q
```

```bash
cd gateway && python -m pytest tests/test_gateway.py -q -k candidatos
```

29 pruebas acá y 3 en el gateway. Una sube un CSV por el endpoint real, corre
la tarea y lista por la API: con candidatos creados a mano, la prueba pasaría
igual aunque el cable estuviera cortado.

Dos cosas se comprobaron rompiendo el código a propósito:

- quitar la entrada del gateway en `RUTAS` hace fallar 2 de sus 3 pruebas;
- saltarse el filtro por organización hace fallar las **4** pruebas de
  aislamiento, que es el criterio que importa de esta tarjeta.

Y hay una que no vino de un chequeo sino de la revisión: la del recorrido
completo de páginas. **Solo muerde contra PostgreSQL** —en SQLite el plan es
estable y pasa aunque el orden no sea total—, así que en el entorno local no
avisa. La CI corre PostgreSQL.

Y una trampa que ya costó un rato: las pruebas de contrato miran
`respuesta.json()` y **no** `respuesta.data`. En `.data` todavía hay objetos de
Python —`importacion` viene como `UUID(...)`—, así que una comparación contra
texto falla aunque el JSON que recibe el frontend esté perfecto.
