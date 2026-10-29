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
Los UUID dependen de versión, corte, organización y escenario. Repetir los mismos
parámetros conserva los identificadores, registros y minutos. Otro corte crea
otro conjunto aislado. No se reciben UUID de organizaciones reales.

La carga usa `Subscription.registrar_uso()` y una transacción con bloqueo por
suscripción. No sobrescribe usos modificados ni crea registros de cero minutos.
`ultima_actividad` refleja la ingestión actual, según el dominio VI-10; `fecha`
conserva el día histórico de uso. `reciente` significa uso reciente al corte,
no una fecha de alta simulada. La organización es un UUID de demostración: el
comando no crea usuarios ni organizaciones en la base de Auth.

Consultar `GET /api/suscripciones/{id}/uso/` con el tenant demo comprueba el
histórico; un tenant distinto obtiene 404. El serializer recalcula horas del mes
actual, por lo que un histórico de enero no se presenta como uso de febrero.
Estos son registros fuente de Subscriptions. No se certifica cobertura ni se
escriben proyecciones de Analytics: sin una ingesta acreditada, FE-29 debe seguir
respondiendo `sin_datos`. Esta carga no prueba transporte RabbitMQ ni IA.
