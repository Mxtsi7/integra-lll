# RF-14 — Publicar las órdenes de cobro y resolver el mismo cargo entre CSV y correo

**Qué hace.** Confirmar un cobro candidato ya dejaba la orden guardada en el
outbox de connectors (S3-FE-15), pero nadie la publicaba y subscriptions no
la recibía. Ahora el worker de connectors la publica en RabbitMQ y el
consumidor de subscriptions la aplica: crea o reutiliza la suscripción y
registra el cobro si el dinero ya salió. Después **contesta** qué hizo, y
connectors lo muestra. Si el mismo cargo llega por el correo y por la
cartola, quedan dos cobros con el aviso de **posible doble cobro**, y la
persona lo resuelve: «es el mismo» (queda **un** cobro con los **dos**
orígenes) o «son dos».

| Requisito | Dónde se cumple | ¿Demostrado? |
|---|---|---|
| RF-14: el cobro se registra tras la confirmación y conserva su origen | `connectors/publicacion.py` publica; `subscriptions/app/candidatos.py` aplica y guarda el origen en `CandidatoAplicado` | Sí, en pruebas y contra un RabbitMQ real |
| RN-DAT-004: conservar los identificadores para detectar duplicados | cada orden deja su fila con origen, identificador (huella de la línea o Message-ID), fecha e importe; conciliar la mueve, no la borra | Sí, en pruebas |
| El mismo cargo por las dos fuentes no se cuenta dos veces | se ve como posible doble cobro y se concilia explícitamente (`POST /api/hallazgos/<id>/conciliar/`) | Sí, en pruebas, y con dos conexiones a PostgreSQL |
| connectors sabe qué pasó con la orden | `candidato.aplicado` v1 de vuelta; `connectors/resultados.py` lo guarda | Sí, en pruebas y contra un RabbitMQ real |

## El recorrido

```
confirmar ─▶ outbox de connectors ─▶ despachar_eventos (beat, cada 10 s)
   ─▶ exchange connectors.eventos, clave candidato.confirmado.v1
   ─▶ cola subscriptions.candidatos ─▶ consumir_eventos ─▶ aplicar
                                    └▶ subscriptions.candidatos.fallidos (lo rechazado)

aplicar (o rechazar a fallos) ─▶ outbox de subscriptions ─▶ despacho
   ─▶ exchange suscripciones.ordenes, clave candidato.aplicado.v1
   ─▶ cola connectors.candidatos.resultados ─▶ recoger_resultados (beat, cada 10 s)
                                            └▶ connectors.candidatos.resultados.fallidos
```

- **El contrato vive en un solo archivo**:
  `shared/contratos/candidato_confirmado.py` (exchange, clave, colas) y
  `candidato-confirmado-v1.schema.json` (la forma del sobre). Los leen los
  dos lados; ya pasó una vez que cada lado tenía su copia de la clave y la
  cola nunca recibió nada.
- **Exchange propio**, como el de uso (ADR-009): si connectors publicara en
  `suscripciones`, un enlace con comodín de analytics o notifications
  recibiría órdenes de cobro.
- **El publicador** es el mismo patrón que el de subscriptions: cada fila se
  toma con `SKIP LOCKED`, el broker tiene que confirmar el mensaje
  (`mandatory` + confirms) y un fallo deja la fila con espera creciente
  (5 s … 15 min). Un sobre que no cumple el contrato no sale: queda en el
  outbox con su error, en vez de perderse en la cola de fallos de otro.
- **El consumidor** es el mismo proceso de siempre (`consumir_eventos`), con
  una segunda cola en el mismo canal: no hace falta otro contenedor, que en
  el clúster no sobran. Los desenlaces son los de siempre: ack solo con la
  orden escrita en la base; la base caída se reintenta; lo demás va a fallos.

## El mismo cargo por las dos fuentes: se ve y se resuelve, no se adivina

Las dos órdenes siguen existiendo en connectors (una por candidato, con su
identificador). Las dos primeras versiones las juntaban al aplicar: primero
con hasta 4 días de diferencia, después solo el mismo día. Las dos revisiones
de #242 mostraron el problema de fondo: **fecha, importe y moneda iguales no
prueban que sea el mismo cargo** (dos meses del mismo plan pagados el mismo
día, dos cuentas de la familia), y juntarlos en silencio esconde plata que
salió.

Así que subscriptions **no decide**. Cada orden con cobro registra su cobro,
con su origen, y la detección de anomalías levanta el **posible doble cobro**
(otro cobro de la suscripción a menos de 5 días, el mismo día incluido). La
persona lo resuelve con una de las dos acciones del hallazgo:

| Acción | Quiere decir | Queda |
|---|---|---|
| `POST /api/hallazgos/<id>/conciliar/` | «es el mismo cargo» | **un** cobro, el de fecha más temprana, con los orígenes de los dos; el otro se borra y queda descrito en `detalle.cobro_conciliado`; `detalle.resolucion = mismo_cargo` |
| `POST /api/hallazgos/<id>/revisar/` | «son dos cargos» | los dos cobros |

Hasta que lo resuelva, los dos cobros cuentan: es lo que dicen los datos, y el
aviso dice que puede sobrar uno. El **caso inverso** sale igual: el mismo cargo
con fecha distinta en cada fuente (el correo del 01-11 y la cartola que lo
asienta el 03-11) queda en dos cobros con su aviso y se concilia igual.

Conciliar exige el mismo importe y la misma moneda (409 `importes_distintos`
si no: juntarlos haría desaparecer la diferencia), es idempotente, y se puede
hacer aunque el hallazgo ya estuviera revisado como «son dos». Después se
vuelve a analizar el cobro que queda, para que un tercer cobro cercano no
pierda su aviso con el que se borró.

El lock `ordenes_de_cobro` por organización hace que dos órdenes del mismo
proveedor procesadas a la vez se vean entre sí: sin él crearían dos
suscripciones y el aviso no saldría (se busca dentro de la misma). Lo prueba
`test_ordenes_de_cobro_carrera_postgres.py`. Conciliar toma el mismo lock.

## Qué hace con la suscripción

Busca una vigente (`activo=True`) de la organización con la misma moneda y el
mismo proveedor (por catálogo, o por nombre si se creó a mano). Si no hay,
la crea:

| Campo | Valor | Por qué |
|---|---|---|
| nombre, proveedor | el nombre canónico que reconoció connectors | coinciden con el catálogo de subscriptions (FE-12) |
| frecuencia | mensual | un cobro suelto no dice el ciclo y casi todos lo son |
| próximo cobro | un mes después del cobro; en un aviso, la fecha avisada | |
| estado | activo; `por_confirmar` si lo único que se sabe es un pago fallido | |

No cambia el próximo cobro de una suscripción que ya existía (registrar un
cobro a mano tampoco lo hace). Una suscripción cancelada se usa solo si no hay
otra. El estado cambia solo con un **pago nuevo**, y con la transición que
RF-03 ya tiene, con su auditoría (`TransicionEstado`, actor `sistema`) y su
evento:

| Estado | Transición | → |
|---|---|---|
| cancelado | `cobro_nuevo_detectado`: la siguen cobrando | activo |
| por confirmar | `cobro_regularizado`: el pago volvió a pasar | activo |

«Pago nuevo» es un `cobro_realizado` con fecha **posterior** al día en que la
suscripción entró a ese estado (o a su creación, si nació así), que no sea una
reentrega. Un aviso o un pago fallido no son plata que salió; un cobro de antes
o del mismo día es historia (puede ser justamente el que falló). `prueba` y
`fantasma` no salen por un cobro.

## El importe

`Cobro.monto` y `Subscription.monto` son NUMERIC(10,2), y los lectores de
connectors admiten hasta 12 enteros. Un candidato de más de **99.999.999,99**
ya no se confirma: responde 409 `importe_fuera_de_rango`, sigue propuesto y se
puede rechazar. El contrato tiene el mismo tope, así que una orden aceptada
siempre cabe; una prueba de cada lado amarra el tope con las columnas.

## Qué muestra la web

subscriptions contesta cada orden con `candidato.aplicado` v1
(`shared/contratos/candidato_aplicado.py`): `aplicado` (`cobro_creado` o
`sin_cobro`) o `fallido` (`contrato_invalido` o `no_aplicable`, cuando la
aparta a su cola de fallos). La respuesta lleva el `correlation_id` de la orden
y el `id` de su sobre (`orden_id`), se escribe en la **misma transacción** que
la aplica (una reentrega no contesta otra vez), y connectors la recoge con una
tarea del worker que lee la cola con `basic_get`: no hace falta otro proceso.
connectors la guarda una vez: un `aplicado` corrige un `fallido` (alguien
reprocesó la cola de fallos), un `fallido` nunca pisa un `aplicado`.

| `aplicacion` | Cuándo | Texto |
|---|---|---|
| `por_enviar` | la orden sigue en el outbox | «orden por enviar a Suscripciones» |
| `enviada` | el broker la confirmó y subscriptions todavía no contesta | «orden enviada, esperando respuesta de Suscripciones» |
| `aplicada` | subscriptions la aplicó | «aplicada en Suscripciones» |
| `fallida` | subscriptions la apartó sin aplicarla | «Suscripciones no pudo aplicar la orden» |

No se contesta si la base de subscriptions sigue caída después de los
reintentos (no hay dónde escribir la respuesta: la orden queda `enviada`, que
sigue siendo verdad) ni si la organización se eliminó.

La **exportación de cobros** dice el origen real: `manual`, `csv`, `correo`
o `correo+csv` cuando el mismo cargo llegó por las dos (una sola fila). El
filtro `origen` acepta `manual`, `csv` y `correo`.

## Despliegue

- **Compose**: no cambia; connectors y subscriptions ya reciben
  `RABBITMQ_URL`.
- **Kubernetes**: el worker de connectors, que corre en el namespace de Cris,
  recibe `RABBITMQ_URL` (`desplegar-satelite.sh` copia ahora
  `ojoalgasto-rabbitmq` también para connectors) y `40-red.yaml` le abre el
  5672 **solo a él** desde ese namespace. La API de connectors no publica y
  no recibe la credencial.
- **Migraciones**: `subscriptions/app/migrations/0022_candidato_aplicado.py` y
  `connectors/migrations/0013_candidato_orden_enviada.py` (envío y respuesta).
- **La respuesta** no necesita nada nuevo en el clúster: la publica el despacho
  de subscriptions, que ya tiene `RABBITMQ_URL`, y la recoge el mismo worker de
  connectors que publica las órdenes.
- **CI**: los trabajos de connectors ahora levantan RabbitMQ para las pruebas
  de punta a punta.

## Cómo probarlo

```bash
# subscriptions (PostgreSQL)
pytest services/subscriptions/tests/test_ordenes_de_cobro_rf14.py \
       services/subscriptions/tests/test_ordenes_de_cobro_carrera_postgres.py
# connectors
pytest services/connectors/tests/test_publicacion_rf14.py \
       services/connectors/tests/test_resultados_rf14.py
# los dos, contra un RabbitMQ real
RABBITMQ_PRUEBA_URL=amqp://usuario:clave@127.0.0.1:5673/ pytest \
  services/connectors/tests/test_publicacion_extremo_a_extremo.py \
  services/connectors/tests/test_resultados_rf14.py \
  services/subscriptions/tests/test_ordenes_de_cobro_extremo_a_extremo.py
```

## Lo que queda abierto

- **Las órdenes que ya están en el outbox** (confirmadas antes de esto) se
  publican solas en cuanto el worker tenga `RABBITMQ_URL`. Conviene mirar
  cuántas hay antes de desplegar.
- **La pantalla de un cobro todavía no muestra sus orígenes** (la
  exportación sí). Están en `CandidatoAplicado`; falta decidir dónde se ven.
- **La web no tiene pantalla de hallazgos**: `revisar` y `conciliar` existen en
  la API de subscriptions, pero ninguna vista los llama todavía (`revisar`
  tampoco tenía una).
- **Pruebas contra Gmail y una cartola reales**: todo lo de arriba corre con
  sobres armados por el código real de connectors, pero no con un correo y un
  banco de verdad.
