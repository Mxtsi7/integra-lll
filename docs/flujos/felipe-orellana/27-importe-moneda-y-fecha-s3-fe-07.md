# S3-FE-07 — Importe, moneda y fecha de los correos

**Qué hace.** Del texto de un correo (asunto + cuerpo) saca el importe, la
moneda y la fecha del cobro, y dice **cuánto se confía en cada uno**. No
guarda nada.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Los ejemplos válidos conservan precisión | importes en `Decimal`: `9.990` es 9990 y `1.234,56` es 1234.56, exactos |
| Los campos ambiguos quedan señalados para revisión | cada campo trae un estado; lo que no es `confirmado` sale en `para_revision` con su motivo |

## Cuatro estados por campo

| Estado | Qué significa |
|---|---|
| `confirmado` | se leyó sin dudas |
| `ambiguo` | hay más de una lectura posible; **no se elige** |
| `supuesto` | no venía y se usó un respaldo (la fecha en que llegó el correo) |
| `ausente` | no venía y no hay respaldo |

Cada campo trae además el `fragmento` de texto del que salió, para la
evidencia del candidato (S3-FE-09).

## Lo que queda para revisión

| El correo dice | Qué pasa |
|---|---|
| `Total: $9.990` | importe confirmado, **moneda ambigua**: `$` puede ser pesos o dólares |
| `Total: $9.990 CLP` | CLP confirmado: el código que viene después dice cuál `$` es |
| `Fecha: 01/10/2026` | **fecha ambigua**: 1 de octubre o 10 de enero |
| `Fecha: 15/10/2026` | confirmada: el 15 no puede ser un mes |
| `Total: CLP 9.990` y `Total: CLP 10.990` | **importe ambiguo**: dos totales distintos, no se elige |
| `Total: US$ 12.99` y `Total: CLP 12.990` | **moneda ambigua**: dos monedas |
| `Total: CLP 9.990,50` | importe ambiguo: el peso chileno no tiene centavos |
| `IVA: CLP 1.595` (solo eso) | importe ambiguo: un impuesto no es lo cobrado |
| sin ninguna fecha | **fecha supuesta**: el día en que llegó el correo, avisado |

## Cuál es el monto cobrado

Un recibo trae varios montos: el precio, el subtotal, el IVA y el total. Se
mira la etiqueta **más cercana** a cada monto, en su línea, comparada como
palabra:

- fuerte: «Total», «Monto total», «Total pagado», «Amount paid»… → gana;
- débil: «Monto», «Importe», «Cargo», «Price»…;
- negativa: «Subtotal», «IVA», «Impuesto», «Tax», «Descuento»… → no es el
  total.

Comparar como palabra importa dos veces: «Subtotal» contiene «total», y
«activación» contiene «iva». Las dos cosas las encontró la primera corrida
del extractor contra recibos de ejemplo, antes de escribir las pruebas.

## Los números

Las reglas de separadores son las del lector de CSV (S3-FE-12):

- el último separador seguido de 1 o 2 dígitos es el decimal;
- seguido de 3, es de miles;
- los miles agrupan de a 3, con un solo signo, distinto del decimal:
  `1.234,56` y `1,234.56` sí; `1.234,567` y `1.2.3` no;
- el espacio duro y el fino agrupan miles; el espacio común **no**: «$10 100
  productos» no es diez mil cien.

Un código de moneda pegado a otra palabra no es una moneda (`XCLP`, `CLPX`).

### Un monto negativo no es un cobro

La expresión del monto empieza después del signo, así que antes no se veía:
«Total: -9.990 CLP» salía como 9.990 **confirmado**, y un abono o una
devolución se proponía como gasto. Lo encontró la revisión de #184.

Ahora se mira alrededor de cada monto: un menos antes del número o del
símbolo (`-9.990 CLP`, `-$9.990`, `CLP -9.990`, también el menos tipográfico
`−`), uno entre el símbolo y el número (`$-9.990`), o el paréntesis contable
`(CLP 9.990)`. Un total negativo sale **ambiguo**, con su valor negativo y el
motivo: puede ser una devolución o un abono.

Cuando el código va **después** del número («($9.990 CLP)»), es parte del
monto: el paréntesis de cierre se busca después del código. Antes se buscaba
justo después del número, se veía «CLP)» y el abono salía positivo. Lo
encontró la segunda revisión de #184.

### `$` solo no hereda la moneda de otro total

«Total: USD 10» y, en otra línea, «Total: $10» confirmaban USD: el `$` sin
código se descartaba. Nada dice que ese `$` sea USD, así que ahora la moneda
queda ambigua. El `$` se ata a un código solo en el **mismo** monto
(«$10 USD»). También de la revisión de #184.

## Las fechas

Se reconocen `2026-10-01`, `01/10/2026` (y con `-` o `.`), «1 de octubre de
2026», «October 1, 2026», «Oct 1, 2026» y «1 Oct 2026». Si alguna línea tiene
una etiqueta de fecha («Fecha de cobro», «Billing date»…), se usan solo
esas: «Tu próximo cobro será el 2026-11-01» no compite con «Fecha de cobro:
2026-10-01».

### La fecha del próximo ciclo no es la del cobro

Un recibo suele traer «Next billing date: November 1, 2026», y la etiqueta
contiene «billing date»: se confirmaba el 1 de noviembre como fecha **del
cobro**, y el pago se habría corrido al ciclo siguiente. Lo encontró la
revisión de #184.

Ahora una fecha cuya línea dice que es del próximo ciclo («Next billing
date», «Tu próximo cobro», «Renews on», «Se cobrará el…», «Vence») nunca
es la del cobro: va a `fecha_proximo_cobro`, que le sirve a un aviso
(S3-FE-08) y no pide revisión. Si es la única fecha del correo, la del cobro
queda **supuesta** con la de recepción, y el motivo lo dice.

## Dónde está

| Pieza | Archivo |
|---|---|
| El extractor | `services/connectors/connectors/datos_del_cobro.py` |
| Las pruebas | `services/connectors/tests/test_datos_del_cobro_s3_fe_07.py` (87) |

Las tablas de monedas son las mismas de `csv_candidatos` (#147). Cuando esa PR
entre a `main`, se dejan en un solo lugar.

## Cómo se comprobaron las pruebas

Se rompió el código a propósito 37 veces y cada vez falló al menos una
prueba. Entre otras:

- tomar `$` como CLP, o elegir uno de dos totales o de dos monedas;
- aceptar un impuesto solo, o centavos en CLP;
- quitar las etiquetas negativas, o comparar etiquetas por subcadena;
- quedarse con la etiqueta más lejana;
- leer tres dígitos como decimales;
- aceptar miles con dos signos;
- agrupar con el espacio común;
- confirmar la fecha de recepción;
- elegir día-mes en una fecha ambigua;
- mezclar fechas sueltas con etiquetadas;
- no mirar el asunto;
- aceptar un código pegado a otra palabra.

Al principio tres no fallaban: faltaban los casos de «activación», de la
etiqueta más cercana y de los miles con dos signos.
