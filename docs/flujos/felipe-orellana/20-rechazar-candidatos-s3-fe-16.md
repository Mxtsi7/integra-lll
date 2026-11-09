# S3-FE-16 — Rechazar un candidato sin mover un peso

**Qué hace.** Marca un cobro candidato como `rechazado`. Eso es todo lo que
hace, y es a propósito: no crea ni toca ninguna suscripción, ningún cobro, y
no borra el candidato.

Los dos criterios de la tarjeta:

| Criterio | Dónde se cumple |
|---|---|
| Un rechazo no crea suscripción ni cobro | solo cambia el `estado` de esa fila; `Importacion.confirmada_en` sigue en `null` |
| Rechazar nuevamente tiene resultado definido | 200 las dos veces, y la segunda **no mueve** `decidido_en` ni `decidido_por` |

**Dónde está.**

| Pieza | Archivo |
|---|---|
| La decisión | `connectors/models.py` → `CobroCandidato.rechazar` |
| El endpoint | `connectors/views.py` → `CobroCandidatoViewSet.rechazar` |
| El conflicto | `connectors/models.py` → `CandidatoYaConfirmado` |
| La migración | `connectors/migrations/0006_decision_del_candidato.py` |
| Las pruebas | `services/connectors/tests/test_rechazar_candidatos.py`, 20, más 1 en el gateway |

## El flujo: de dónde vienen los datos

```
navegador                                    ← S3-CH-09
   │  POST /api/candidatos/<id>/rechazar/    (cuerpo vacío)
   ▼
gateway                                      ← valida el JWT (ADR-004)
   │   misma entrada de RUTAS que S3-FE-14
   │   inyecta X-Organizacion-Id y X-Usuario-Id del token
   ▼
CobroCandidatoViewSet.rechazar
   │   get_object() → 404 si es de otra organización
   │   _usuario_de(request) → 403 si no hay usuario
   ▼
CobroCandidato.rechazar(por=<usuario>)
   │
   ├── ¿ya está confirmado?  → CandidatoYaConfirmado → 409
   ├── UPDATE ... WHERE estado = 'propuesto'
   │      1 fila → primera vez, queda la decisión
   │      0 filas → ya estaba rechazado: nada que hacer, 200 igual
   └── ¿quedó confirmado?    → CandidatoYaConfirmado → 409
   ▼
200 con el candidato entero (el mismo contrato de S3-FE-14)
```

El cuerpo de la petición **se ignora**: no hay nada que mandar. Lo único que
se lee de afuera es la cabecera de usuario, porque queda guardado quién
decidió. Hay una prueba que manda `{"estado": "confirmado", "importe": "1"}`
y comprueba que no cambia nada de eso.

## Cómo se llaman los datos

Dos columnas nuevas en `cobro_candidato`, que **S3-FE-15 va a reutilizar** al
confirmar: es la misma pregunta —quién decidió esto y cuándo— y tener una
pareja de campos por decisión las separaría con el tiempo.

| Campo | Qué es |
|---|---|
| `decidido_en` | `null` mientras está `propuesto`. La fecha de la **primera** decisión |
| `decidido_por` | `""` mientras está `propuesto`. El `X-Usuario-Id` crudo, sin interpretar (ADR-002) |

Los dos entran en el contrato que lista S3-FE-14, así que la vista previa
puede mostrar "rechazado por X el Y" sin pedir nada más.

### Lo que sale mal

| Código HTTP | Cuándo |
|---|---|
| `404` | el candidato es de otra organización, o no existe |
| `403` | falta la cabecera de organización o la de usuario |
| `405` | GET, PATCH o DELETE sobre la ruta de rechazar |
| `409` | `codigo: candidato_ya_confirmado` |

El 404 para un candidato ajeno y no un 403: un 403 confirmaría que ese id es
de alguien.

## Las tres decisiones que conviene no deshacer

**El candidato NO se borra.** Queda `rechazado` y sigue consultable con
`?estado=rechazado`. Borrarlo tendría dos consecuencias, y la segunda es la
grave: se pierde la trazabilidad, y **S3-FE-17 lo volvería a proponer**. El
identificador de origen es `<sha256 del archivo>:<fila>`; si la fila
desapareciera de la tabla, releer el mismo archivo la propondría de nuevo como
si nadie la hubiera visto nunca.

**Rechazar de nuevo da 200, no un error.** Y la segunda petición no reescribe
la auditoría: `decidido_en` y `decidido_por` son los de la primera. La
decisión es la primera, no la última petición que llegó. Es lo que le permite
a S3-CH-09 reintentar sin cuidarse de los dobles envíos, que es literalmente
el nombre de esa tarjeta.

La guarda va en el `WHERE` y no en memoria: dos peticiones simultáneas sobre
la misma fila leen las dos `propuesto`, y sin el filtro las dos escribirían su
propia fecha.

**Un confirmado no se rechaza.** Confirmar no es cambiar un campo: crea o
actualiza suscripciones y cobros de verdad (S3-FE-15). Dejar que un rechazo
posterior lo moviera a `rechazado` daría un candidato que dice "no" con
movimientos creados a partir de él. Deshacer eso es otra operación, con su
propia tarjeta, y no un efecto de este endpoint.

La comprobación está **dos veces** a propósito: antes del `UPDATE`, para dar
un 409 claro, y después, porque el `WHERE` filtra por `propuesto` y alguien
pudo confirmarlo justo entremedio. Hay una prueba que mete la confirmación en
ese hueco exacto.

### Lo que este servicio puede afirmar sobre "no crea suscripción ni cobro"

Nada de plata vive acá. Las suscripciones y los cobros están en
`subscriptions` y `connectors` no conoce su esquema (ADR-002), no publica
ningún evento al rechazar, y no hay ningún cliente HTTP de por medio. Lo
único que este servicio **podría** haber movido es
`Importacion.confirmada_en`, que es su marca interna de "la persona aceptó
estos candidatos y recién ahí se crean suscripciones" (FE-08). La prueba
comprueba que sigue en `null`, y que la importación no cambió de estado.

## Lo que falta

- **Rechazar varios de una vez.** Hoy es una petición por candidato.
  S3-CH-07 permite seleccionar varios, así que puede hacer falta un
  `POST /api/candidatos/rechazar/` con una lista de ids; ningún criterio de
  esta tarjeta lo pide, así que quedó para cuando el frontend lo necesite.
- **Un motivo del rechazo.** No se agregó una columna que nadie escribe.
  Cuando se necesite es una migración de un campo.
- **S3-FE-15**, confirmar, que es la otra mitad y la que sí crea movimientos.

## Cómo probarlo

```bash
cd services/connectors && python -m pytest tests/test_rechazar_candidatos.py -q
```

```bash
cd gateway && python -m pytest tests/test_gateway.py -q -k candidato
```

20 pruebas acá y 1 en el gateway, que comprueba que el POST llega como POST:
es la única ruta de candidatos que escribe, y reenviada como GET el rechazo se
perdería en silencio desde el punto de vista del frontend.

La idempotencia se comprobó rompiendo el código a propósito: quitarle al
`UPDATE` el filtro `estado='propuesto'` hace fallar tres pruebas, entre ellas
la que exige que la segunda petición no mueva la fecha de la decisión.
