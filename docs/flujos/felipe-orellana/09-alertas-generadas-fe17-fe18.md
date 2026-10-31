# FE-17 y FE-18 — Alertas de próximos cobros y avisos de fin de prueba

**Qué hace.** Un generador en notifications que, con un reloj que se le pasa,
recorre las suscripciones que conoce y crea alertas (`Alerta`, FE-16) cuando
un cobro cae dentro de la anticipación configurada (FE-17) o cuando una
prueba gratuita termina en menos de 48 h o de 24 h (FE-18). Respeta las
preferencias de FE-21 y nunca genera dos alertas para la misma ventana.

**Dónde está.**

| Pieza | Archivo |
|---|---|
| La proyección de suscripciones (lo que notifications sabe de cada una) | `notifications/models.py` → `SuscripcionVigilada`, migración `0004` |
| El adaptador de eventos a la proyección | `notifications/proyeccion.py` → `aplicar(sobre)` |
| El generador (reloj controlable, dedup por ventana) | `notifications/generador.py` |
| El comando para correrlo | `manage.py generar_alertas [--ahora ISO]` |

## Por dónde pasan los datos

```
subscriptions ─ suscripcion.creada / actualizada / estado_cambiado (MX-21 v2) ─▶ RabbitMQ
        │                                                                          │
        │   FE-24 (pendiente): el consumidor llama a proyeccion.aplicar(sobre) ◀───┘
        ▼
SuscripcionVigilada  ──▶  generador.generar(ahora)  ──▶  Alerta (pendiente)  ──▶  FE-19 lista, FE-20 cuenta
        ▲                        │
PreferenciaNotificacion ─────────┘  (FE-21: tipo encendido, canales, dias_anticipacion)
```

Notifications no consulta el esquema de subscriptions (ADR-002): sabe de las
suscripciones por los eventos, igual que analytics con el uso. Mientras FE-24
no conecte el consumidor, la proyección se llena solo con `aplicar()` en
pruebas; el comando corre igual y no inventa nada.

## Las reglas

**Próximo cobro (FE-17).** Para cada suscripción `activo` o `prueba` con
`proximo_cobro` de hoy en adelante, y para cada anticipación `d` que alguien
de la organización pidió: si faltan `d` días o menos, se crea la alerta. "O
menos" y no "exactamente", porque el job corre una vez al día y si un día no
corrió, el aviso igual sale al siguiente.

**Fin de prueba (FE-18).** Para cada suscripción `prueba` con `fin_prueba`:
la prueba termina a las 00:00 de ese día (hora de Chile); si faltan 48 h o
menos sale la alerta de 48 h, y si faltan 24 h o menos, la de 24 h. Sin fecha
no hay aviso.

**Preferencias (FE-21).** Se avisa si alguien de la organización tiene el tipo
encendido y al menos un canal elegido. Sin ninguna preferencia guardada valen
las de omisión (encendido, 3 días), que es lo que esa persona vería al abrir
la pantalla por primera vez. Con dos personas que piden 3 y 7 días, salen dos
alertas: una por ventana, porque las alertas son de la organización (FE-16),
no de la persona.

**Prioridad de reglas, documentada antes de activar el envío.** Las ventanas
de 48 h y 24 h del fin de prueba son fijas, las que piden los requisitos, y no
se mezclan con `dias_anticipacion`, que gobierna los cobros. Si alguien pidió
7 días para los cobros, el fin de prueba igual se avisa a las 48 h y a las 24 h.
Cuando FE-22 active el correo o el push, es la regla que hay que revisar.

**Cada ventana, a lo sumo una alerta.** La alerta lleva un `evento_id`
determinístico (UUID v5 de organización, suscripción, tipo, fecha y ventana) y
la restricción única de `Alerta` hace el resto: correr el generador diez
veces el mismo día deja una sola alerta, y correrlo mañana para el mismo
cobro, también. Cuando subscriptions mueve `proximo_cobro` al mes siguiente,
es otra ventana y corresponde otro aviso.

## Decisiones

- **El contrato MX-21 v2 no trae `fin_prueba`.** `Subscription` la tiene, pero
  `$defs/suscripcion` no. El adaptador la guarda si el sobre la trae
  (`datos.fin_prueba`) y la deja en NULL si no; sin ella no se avisa. Hay que
  acordar la extensión con VI-26 antes de que FE-18 avise de verdad. Es una
  diferencia con el texto de la tarjeta y queda registrada acá.
- **Un evento viejo no pisa uno nuevo.** La proyección guarda el `ocurrido_en`
  del último evento aplicado y la condición va en el WHERE, no en memoria.
  Una `actualizada` de ayer que llega después de la cancelación de hoy no
  puede resucitar la suscripción.
- **Las alertas de una suscripción que se cancela después** no se tocan acá:
  anularlas es FE-23.
- **Dónde se programa el comando** (CronJob de Kubernetes, beat) es una
  decisión aparte; el comando es idempotente, así que correrlo de más no
  cuesta nada.
- **Una organización eliminada no recibe filas nuevas.** La proyección es
  dato personal —nombre del servicio, monto, fecha de cobro—, así que entra
  en la limpieza de MX-07 junto con las alertas y las preferencias. Pero
  borrarla no alcanzaba: RabbitMQ entrega al menos una vez, y un evento que
  llega después del 204 volvía a escribir la fila; desde ahí el generador
  creaba alertas en un tenant borrado. Las dos escrituras —la del adaptador
  y la de cada alerta— toman ahora el estado de la organización con
  `bloquear_organizacion(compartido=True)` en la MISMA transacción que
  escriben: FOR SHARE, así que dos eventos de una organización viva siguen
  entrando en paralelo, y la limpieza —que toma FOR UPDATE— espera a que
  cierren y después borra también lo que escribieron.

  La guarda va pegada al INSERT y no arriba del bucle a propósito: entre una
  comprobación al empezar la corrida y el INSERT queda la misma ventana que
  se quería cerrar.

  Un evento para una organización eliminada **no** es un sobre roto: se
  descarta y se confirma (`aplicar` devuelve `False`), no se manda a la cola
  de fallidos, donde quedaría girando para siempre. El generador lo cuenta
  aparte como `omitidas` y el comando lo informa cuando hay.

## Cómo probarlo

```bash
cd services/notifications
ESQUEMA_BD=notifications SECRET_KEY=x DEBUG=False CLAVES_CIFRADO=x pytest tests/test_generador.py tests/test_proyeccion.py tests/test_eliminacion_proyeccion.py -q

# un día cualquiera, a mano:
python manage.py generar_alertas --ahora 2026-11-21T10:00:00-03:00
```

61 pruebas: las ventanas de cobro y de prueba con reloj fijo, preferencias
encendidas y apagadas, sin preferencias, dos personas con anticipaciones
distintas, dedup en la misma corrida y al día siguiente, aislamiento entre
organizaciones, el comando con `--ahora`, y el adaptador con eventos fuera de
orden y sobres rotos. Verificado que cada regla falla al romperla.

Las 10 de `test_eliminacion_proyeccion.py` cubren el cruce con MX-07: la
limpieza se lleva la proyección y deja intacta a la otra organización, el
evento reentregado y la actualización tardía no resucitan la fila, el
generador omite la organización eliminada y sigue avisando a la viva, y una
prueba exige que la limpieza declare los CUATRO modelos de tenant del
servicio —es la que faltaba cuando `SuscripcionVigilada` quedó fuera—.
El bloqueo en sí se comprobó con dos conexiones PostgreSQL reales: con una
escritura en vuelo, la limpieza esperó el `FOR UPDATE` y después borró la
fila recién escrita, sin dejar huérfanas; dos escrituras de una organización
viva entraron en paralelo.
