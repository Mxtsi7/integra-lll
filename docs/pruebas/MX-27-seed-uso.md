# MX-27: simulación reproducible de uso

Tarjeta: https://trello.com/c/WR5yF8UG

Desde `services/subscriptions`, con la configuración habitual de una base local
de demostración migrada:

```sh
python manage.py seed_uso --fecha-ref 2026-10-29
python manage.py seed_uso --fecha-ref 2026-10-29
pytest tests/test_seed_uso.py
```

La salida JSON identifica dos organizaciones ficticias y cuatro suscripciones
por organización: `alto` (120 minutos en hasta diez días de cada mes), `bajo`
(cinco minutos el primer día de cada mes), `sin_uso` (sin registros) y `reciente`
(45 minutos en la fecha de corte). La ventana incluye el mes de corte y los dos
anteriores. Las fechas nunca superan el corte, incluso el primer día del mes.
El corte no puede superar la fecha local actual del servicio; una fecha futura
se rechaza antes de escribir datos.
Los UUID dependen de versión, corte, organización y escenario. Repetir los mismos
parámetros conserva los identificadores, registros y minutos. Otro corte crea
otro conjunto aislado. No se reciben UUID de organizaciones reales.

La carga usa `Subscription.registrar_uso()` y una transacción con bloqueo por
suscripción. No sobrescribe usos modificados ni crea registros de cero minutos.
Al repetir, compara todos los registros de cada suscripción existente con las
fechas y minutos esperados, incluidos duplicados, registros extra o ausentes y
el conjunto vacío de `sin_uso`. Cualquier diferencia produce `CommandError` y
revierte toda la ejecución: conserva las ediciones previas y no rellena usos
eliminados ni borra registros adicionales para forzar el escenario.
Tras validar los usos, el comando fija `ultima_actividad` al inicio del día del
último registro en la zona horaria del servicio; queda nula en `sin_uso`.
Con corte 2026-01-29, las últimas actividades son 2026-01-10 para `alto`,
2026-01-01 para `bajo` y 2026-01-29 para `reciente`. Repetir una carga anterior
con usos intactos corrige también su actividad histórica, sin recrear registros
ni cambiar sus fechas o minutos. Esta excepción es exclusiva del seed demo;
`Subscription.registrar_uso()` conserva la semántica de ingestión de VI-10.
`reciente` significa uso reciente al corte,
no una fecha de alta simulada. La organización es un UUID de demostración: el
comando no crea usuarios ni organizaciones en la base de Auth.

Consultar `GET /api/suscripciones/{id}/uso/` con el tenant demo comprueba el
histórico; un tenant distinto obtiene 404. El serializer recalcula horas del mes
actual, por lo que un histórico de enero no se presenta como uso de febrero.
`horas_uso_mes` siempre corresponde al mes de hoy, no al mes de `--fecha-ref`.
Para ver los cuatro escenarios de horas en la app, utiliza como corte la fecha
local actual del servicio. Un corte histórico sirve para probar antigüedad de
actividad y su histórico; si no hay registros en el mes actual, muestra cero
horas en ese mes.
Estos son registros fuente de Subscriptions. No se certifica cobertura ni se
escriben proyecciones de Analytics: sin una ingesta acreditada, FE-29 debe seguir
respondiendo `sin_datos`. Esta carga no prueba transporte RabbitMQ ni IA.
