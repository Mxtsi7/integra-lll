# S3-MX-30 — Persistencia de uso en el modelo vigente

## Recorrido

Después de validar autenticación, consentimiento y contrato, la transacción de
`persistencia.py` guarda el hecho recibido y llama a
`app/uso_recolectores/proyeccion.py` antes de devolver el acuse. La proyección
consulta los tramos exactos de esa organización, usuario, suscripción y fecha
local, y calcula su unión en milisegundos. Fuentes que se solapan no suman dos
veces. Un bloqueo de la fila de suscripción serializa las escrituras del mismo
destino; las dos pruebas de eventos simultáneos comprueban el residuo en
PostgreSQL.

`ProyeccionUsoRecolector` persiste el total exacto del día, su usuario, zona y
el vínculo al `RegistroUso` derivado. El modelo existente incorpora `origen`,
`usuario_id` y `duracion_ms`; las filas manuales conservan sus valores y nunca
se actualizan desde este flujo. Se escribe una fila de recolector cuando la
unión alcanza al menos un minuto completo, y sus minutos son
`total_ms // 60000`. Los milisegundos restantes quedan en la proyección del
día. Una actividad positiva subminuto queda guardada en el hecho y proyección,
sin convertirse en un minuto ni en un cero de uso observado.

La actividad positiva actualiza `Subscription.ultima_actividad` con el final
real más reciente, y el total mensual se vuelve a calcular desde
`RegistroUso`. Las transiciones de una suscripción fantasma reutilizan
`Subscription.transicionar()` y su outbox ya existente. La eliminación de una
organización borra también los hechos y proyecciones después de validar que sus
suscripciones pertenezcan al mismo tenant.

## Límites y validación

La cobertura y el estado (completa, parcial, sin medición, permiso revocado)
siguen en `EventoUsoRecibido.cuerpo`; el total de actividad no reemplaza esa
evidencia. Esta rama no publica el evento al transporte ni confirma una
sincronización. No cambia la identidad entera de Auth al UUID exigido por el
DTO de Víctor. El consentimiento en las pruebas es un doble; sin autoridad
configurada la ruta real sigue devolviendo 403.

Desde `services/subscriptions`, ejecutar:

```sh
python manage.py makemigrations --check --dry-run
python -m pytest tests/test_proyeccion_uso_recolector.py tests/test_persistencia_uso.py tests/test_recepcion_uso.py tests/test_eliminacion.py -q
```

Las pruebas cubren 30 s + 30 s, ventanas solapadas cuya unión es 180 s y 50 s,
residuo inferior al minuto, eventos concurrentes distintos, conservación de
uso manual, mes agregado y purga. Las pruebas de concurrencia exigen
PostgreSQL; las de consentimiento usan un callback sintético.
