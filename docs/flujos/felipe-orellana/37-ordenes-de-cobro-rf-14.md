# RF-14 — Publicar las órdenes de cobro y no duplicar el cargo entre CSV y correo

**Qué hace.** Confirmar un cobro candidato ya dejaba la orden guardada en el
outbox de connectors (S3-FE-15), pero nadie la publicaba y subscriptions no
la recibía. Ahora el worker de connectors la publica en RabbitMQ y el
consumidor de subscriptions la aplica: crea o reutiliza la suscripción y
registra el cobro si el dinero ya salió. Si el mismo cargo llega por el
correo y por la cartola, queda **un** cobro con los **dos** orígenes.

| Requisito | Dónde se cumple | ¿Demostrado? |
|---|---|---|
| RF-14: el cobro se registra tras la confirmación y conserva su origen | `connectors/publicacion.py` publica; `subscriptions/app/candidatos.py` aplica y guarda el origen en `CandidatoAplicado` | Sí, en pruebas y contra un RabbitMQ real |
| RN-DAT-004: conservar los identificadores para detectar duplicados | cada orden deja su fila con origen, identificador (huella de la línea o Message-ID), fecha e importe, también la que se juntó | Sí, en pruebas |
| El mismo cargo por las dos fuentes no genera dos cobros | `aplicar` busca el mismo cargo antes de crear, con un lock por organización | Sí, en pruebas, y con dos conexiones a PostgreSQL |

## El recorrido

```
confirmar ─▶ outbox de connectors ─▶ despachar_eventos (beat, cada 10 s)
   ─▶ exchange connectors.eventos, clave candidato.confirmado.v1
   ─▶ cola subscriptions.candidatos ─▶ consumir_eventos ─▶ aplicar
                                    └▶ subscriptions.candidatos.fallidos (lo rechazado)
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

## Cuándo dos órdenes son el mismo cargo

Las dos órdenes siguen existiendo en connectors (una por candidato, con su
identificador). Se juntan al **aplicarlas**, sin preguntar, solo si:

1. son de la misma suscripción, con el mismo importe exacto y la misma moneda;
2. tienen **la misma fecha**;
3. el cobro que ya estaba **no tiene todavía un origen de la misma fuente**.

**Con fechas distintas no se juntan.** La primera versión juntaba hasta 4
días de diferencia, pensando en que la cartola asienta el cargo después del
correo; la revisión de #242 mostró que un correo del 01-11 y una línea del
04-11 por $9.990 pueden ser dos pagos distintos, y juntarlos los escondía sin
ningún aviso. Ahora quedan los dos cobros, cada uno con su origen, y sale el
aviso de **posible doble cobro** (ventana de 5 días de `anomalias.py`): esa
es la conciliación explícita, la persona lo revisa y lo marca. Juntar de más
esconde plata que salió; separar de más se ve y se corrige (RF-07).

El punto 3 evita tapar un doble cobro aun el mismo día: si la cartola trae
dos líneas de $9.990 del 05-11, la primera se junta con el correo y la
segunda ve que ese cobro ya tiene un origen `csv`, así que se registra aparte
y sale el aviso. Un cobro ingresado a mano el mismo día también se junta.

**No** se junta un cargo en USD que la cartola muestra en CLP: no hay tipo de
cambio en el sistema.

El lock `ordenes_de_cobro` por organización hace que dos órdenes del mismo
cargo procesadas a la vez se vean entre sí. Lo prueba
`test_ordenes_de_cobro_carrera_postgres.py`: con el lock, la segunda espera a
la primera y se junta; si se quita el lock, la prueba falla.

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
otra. **Si llega un cobro nuevo con fecha posterior a la cancelación**, la
siguen cobrando: se aplica la transición de RF-03 `cobro_nuevo_detectado`
(→ activo), con su auditoría (`TransicionEstado`, actor `sistema`) y su
evento. No la reactiva un aviso ni un pago fallido, un cobro de antes o del
mismo día de la cancelación, una reentrega ni el segundo origen de un cobro
que ya existía.

## El importe

`Cobro.monto` y `Subscription.monto` son NUMERIC(10,2), y los lectores de
connectors admiten hasta 12 enteros. Un candidato de más de **99.999.999,99**
ya no se confirma: responde 409 `importe_fuera_de_rango`, sigue propuesto y se
puede rechazar. El contrato tiene el mismo tope, así que una orden aceptada
siempre cabe; una prueba de cada lado amarra el tope con las columnas.

## Qué muestra la web

connectors no puede ver si subscriptions ya aplicó la orden (ADR-002), así
que `aplicacion` dice solo lo que sabe:

| Valor | Cuándo | Texto |
|---|---|---|
| `por_enviar` | la orden sigue en el outbox | «orden por enviar a Suscripciones» |
| `enviada` | el broker la confirmó (`orden_enviada_en`, lo escribe el publicador en la misma transacción) | «orden enviada: revisa la suscripción y el cobro en Suscripciones» |

Antes decía `pendiente`, «todavía no hay suscripción ni cobro creados», que con
el consumidor andando pasaba a ser falso a los segundos. Ningún valor afirma
que la suscripción exista ni que falte.

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
  `connectors/migrations/0013_candidato_orden_enviada.py`.
- **CI**: los trabajos de connectors ahora levantan RabbitMQ para las pruebas
  de punta a punta.

## Cómo probarlo

```bash
# subscriptions (PostgreSQL)
pytest services/subscriptions/tests/test_ordenes_de_cobro_rf14.py \
       services/subscriptions/tests/test_ordenes_de_cobro_carrera_postgres.py
# connectors
pytest services/connectors/tests/test_publicacion_rf14.py
# los dos, contra un RabbitMQ real
RABBITMQ_PRUEBA_URL=amqp://usuario:clave@127.0.0.1:5673/ pytest \
  services/connectors/tests/test_publicacion_extremo_a_extremo.py \
  services/subscriptions/tests/test_ordenes_de_cobro_extremo_a_extremo.py
```

## Lo que queda abierto

- **Las órdenes que ya están en el outbox** (confirmadas antes de esto) se
  publican solas en cuanto el worker tenga `RABBITMQ_URL`. Conviene mirar
  cuántas hay antes de desplegar.
- **La pantalla de un cobro todavía no muestra sus orígenes** (la
  exportación sí). Están en `CandidatoAplicado`; falta decidir dónde se ven.
- **Que connectors sepa si la orden quedó aplicada** necesita un aviso de
  vuelta de subscriptions (otro evento y un consumidor en connectors). Hoy
  se dice `enviada` y se manda a revisar en Suscripciones.
- **Pruebas contra Gmail y una cartola reales**: todo lo de arriba corre con
  sobres armados por el código real de connectors, pero no con un correo y un
  banco de verdad.
