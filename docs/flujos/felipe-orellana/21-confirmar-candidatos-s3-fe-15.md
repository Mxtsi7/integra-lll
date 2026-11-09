# S3-FE-15 — Confirmar un candidato: el único paso que mueve plata

**Qué hace.** Marca el candidato como `confirmado` y, **en la misma
transacción**, deja escrita la orden de crear la suscripción —y el cobro, si
corresponde— en un outbox durable.

Hasta acá nada tocaba nada: FE-07 recibió un archivo, S3-FE-10 lo leyó,
S3-FE-14 lo mostró y S3-FE-16 descartó lo que no servía. Esto es el "sí".

Los dos criterios de la tarjeta:

| Criterio | Dónde se cumple |
|---|---|
| Confirmar es atómico según el contrato | el estado del candidato y la orden se escriben en una sola transacción: los dos o ninguno |
| Un aviso futuro no genera un pago realizado | `CREA_COBRO` decide por tipo de mensaje, y la decisión viaja resuelta en el sobre |

**Dónde está.**

| Pieza | Archivo |
|---|---|
| La operación | `connectors/confirmacion.py` |
| El endpoint | `connectors/views.py` → `CobroCandidatoViewSet.confirmar` |
| El outbox | `connectors/models.py` → `OutboxEvento` |
| La migración | `connectors/migrations/0008_outbox_de_connectors.py` |
| Las pruebas | `services/connectors/tests/test_confirmar_candidatos.py`, 26 |

## Lo primero, porque cambia cómo se lee todo lo demás

**La suscripción NO queda creada cuando este endpoint responde 200.**

Las suscripciones y los cobros viven en `subscriptions`, y este servicio no
conoce su esquema (ADR-002). O sea que confirmar cruza una frontera de
servicio, y **una transacción no cruza fronteras**: no existe un commit que
deje el candidato confirmado y la suscripción creada a la vez.

Lo que sí se puede hacer en una sola transacción es dejar **el candidato
confirmado y la orden de crear**. Eso es lo que hay, y eso es lo que el
criterio llama atómico: después de un commit no existe un candidato
confirmado sin su orden, ni una orden sin su candidato.

Lo que falta es una pieza y está identificada: **no hay publicador en
connectors**, así que las filas se acumulan durables hasta que exista quien
las drene y un consumidor en `subscriptions` que las aplique. Nada se pierde y
nada se finge.

### Por qué no se resolvió con una llamada HTTP

Se consideró y se descartó para esta tarjeta:

- **no hay precedente**: en todo el repo no hay una sola llamada de un
  servicio a otro. El gateway hace proxy, y connectors llama a proveedores
  externos de OAuth. Nada más;
- habría que resolver cómo viaja la identidad entre servicios internos, que
  es una decisión de arquitectura y no de esta tarjeta;
- y "atómico" pasaría a ser "local atómico más una llamada remota con
  compensación si falla", que es más frágil que una fila durable.

El outbox, en cambio, es el patrón que **el repo ya usa**: es el mismo sobre
que `subscription_event_outbox` (MX-21), campo por campo.

## El flujo: de dónde vienen los datos

```
navegador                                      ← S3-CH-08
   │  POST /api/candidatos/<id>/confirmar/      (cuerpo vacío)
   ▼
gateway                                        ← valida el JWT (ADR-004)
   │   inyecta X-Organizacion-Id y X-Usuario-Id
   ▼
CobroCandidatoViewSet.confirmar
   │   get_object() → 404 si es de otra organización
   ▼
confirmacion.confirmar(candidato, por=<usuario>)
   │
   ├── ¿rechazado?            → 409 candidato_rechazado
   ├── ¿ya confirmado?        → False, 200, y NO se escribe otra orden
   ├── ¿sin servicio?         → 409 servicio_sin_resolver
   ├── ¿tipo sin regla?       → 409 tipo_sin_regla
   │
   └── una sola transacción:
         UPDATE candidato ... WHERE estado = 'propuesto'
            0 filas → otra corrida ganó; no se escribe la orden
            1 fila  → INSERT en el outbox con el sobre completo
   ▼
200 con el candidato (el mismo contrato de S3-FE-14)
   │
   ▼
(pendiente) publicador → subscriptions crea la suscripción y el cobro
```

## Cómo se llaman los datos

### La decisión: qué es un pago y qué no

Una sola tabla, en un solo lugar:

| `tipo_mensaje` | ¿suscripción? | ¿cobro? | Por qué |
|---|---|---|---|
| `cobro_realizado` | sí | **sí** | ya pasó |
| `aviso_de_cobro` | sí | **no** | "te vamos a cobrar": no pasó |
| `pago_fallido` | sí | **no** | no se pudo cobrar: no pasó |

Contar un aviso como cobro lo contaría **dos veces** cuando después llegue el
recibo de verdad, y haría cuadrar mal el presupuesto de la persona. Es
exactamente el criterio de la tarjeta.

Hay una prueba que compara `CREA_COBRO` contra **todos** los tipos que
existen: si mañana se agrega uno y nadie toca esta tabla, falla ahí en vez de
decidir por omisión si hubo un pago.

### El sobre: lo que viaja

`evento = "candidato.confirmado"`, `version = 1`. Los dos son contrato:
cambiarlos es cambiar el contrato y necesita una versión nueva.

```json
{
  "candidato_id": "...", "importacion_id": "...",
  "origen": "csv", "identificador_origen": "<sha256>:3",
  "servicio": "Netflix", "servicio_texto": "NETFLIX.COM",
  "importe": "9990.00", "moneda": "CLP", "fecha": "2026-10-01",
  "tipo_mensaje": "cobro_realizado",
  "crear_cobro": true,
  "decidido_por": "42",
  "evidencia": {"fila": "3", "descripcion_original": "NETFLIX.COM"}
}
```

Va **completo** a propósito: un sobre que solo llevara el id obligaría al
consumidor a consultar el esquema de otro servicio, que es justo lo que
ADR-002 prohíbe.

Dos detalles del formato que importan a quien lo consuma:

**`crear_cobro` viaja resuelto.** Quien drene el sobre no vuelve a mirar el
tipo de mensaje para adivinar si hubo un pago. Si esa regla viviera en los dos
lados, se separarían, y el día que se separen el síntoma es un cobro inventado
en la cuenta de alguien.

**`importe` es texto y SIEMPRE trae dos decimales**, también en pesos: `9990`
sale `"9990.00"`. No es una decisión, es que la columna es `NUMERIC(14,2)` y
el importe vuelve de la base como `Decimal("9990.00")`. Comprobado igual en
PostgreSQL y en SQLite. El valor es exacto, pero quien lo consuma no puede
suponer que un CLP viene sin decimales.

### Lo que sale mal

| Código HTTP | `codigo` | Cuándo |
|---|---|---|
| `409` | `candidato_rechazado` | ya se descartó (S3-FE-16) |
| `409` | `servicio_sin_resolver` | no se reconoció el proveedor |
| `409` | `tipo_sin_regla` | no debería pasar; ver arriba |
| `404` | — | el candidato es de otra organización, o no existe |
| `403` | — | falta la cabecera de organización o la de usuario |
| `405` | — | GET, PATCH o DELETE sobre esta ruta |

## Las tres decisiones que conviene no deshacer

**Sin proveedor resuelto no se confirma.** Si `servicio` es `None`, lo único
que hay para nombrar la suscripción es la glosa de la cartola, y una
suscripción llamada `PAYPAL *SPOTIFY` no es un dato: es basura con forma de
dato, y una vez creada queda en el presupuesto de la persona. El 409 dice si
fue `ambiguo` o `desconocido`, para que se pueda arreglar.

Falta la tarjeta que permita asignar el proveedor a mano; hoy el camino es
corregir el catálogo de FE-12 y volver a importar.

**Repetir la confirmación no deja dos órdenes.** Dos órdenes son dos cobros.
La guarda va en el `WHERE`: dos peticiones simultáneas leen las dos
`propuesto`, y sin el filtro las dos escribirían su decisión **y las dos
dejarían su orden**. Es el criterio de S3-CH-08.

**Sin `set_rollback`.** Cuando el `UPDATE` afecta 0 filas no hay nada escrito
que deshacer, y marcar la transacción para rollback deja el bloque
inutilizable: el `refresh_from_db` siguiente moría con
`TransactionManagementError`. Lo encontró la prueba de la carrera, antes de
que lo encontrara una revisión.

## Lo que falta

- **El publicador** y el consumidor en `subscriptions`. Es la pieza que hace
  que la suscripción exista de verdad, y es de otra tarjeta: necesita que
  Víctor valide el contrato de arriba y declare el enlace de la cola.
- **Asignar el proveedor a mano**, para los candidatos que hoy dan
  `servicio_sin_resolver`.
- **Confirmar varios de una vez.** Hoy es una petición por candidato, igual
  que rechazar. S3-CH-07 selecciona varios.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_confirmar_candidatos.py -q
```

26 pruebas. Tres cosas se comprobaron rompiendo el código a propósito:

- sacar la transacción común hace fallar la que revienta la escritura del
  outbox y exige que el candidato **no** quede confirmado;
- poner `crear_cobro = True` fijo hace fallar las dos del aviso futuro;
- y una prueba que **no mordía** se reescribió: comprobaba
  `transaction.get_autocommit()` desde adentro, y pytest ya envuelve cada
  prueba en una transacción, así que daba lo mismo estuviera el código bien o
  mal. Ahora comprueba lo que sí se puede ver desde ahí —que el candidato ya
  está confirmado cuando se escribe la orden— y la atomicidad la prueba el
  caso del rollback.
