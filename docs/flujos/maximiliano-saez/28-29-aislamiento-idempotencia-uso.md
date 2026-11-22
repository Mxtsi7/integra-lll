# S3-MX-28/29 — Aislamiento e idempotencia de uso

## Flujo

La acción autenticada descrita en [MX-26/27](26-27-recepcion-validacion-uso.md)
comprueba destino, identidad, consentimiento y contrato antes de llamar a
`app/uso_recolectores/persistencia.py`. Esa función vuelve a leer y bloquea la
suscripción dentro de una transacción, y crea un `EventoUsoRecibido` con cuerpo
normalizado, usuario interno, organización, recolector, fecha local, destino,
correlación y hora original de recepción. El escritor calcula la proyección
exacta y limpia la marca de proyección pendiente en esa misma transacción.
El servicio responde 201 tras confirmar el hecho y su proyección.

La clave única de PostgreSQL es organización + usuario + recolector + event_id.
La suscripción queda guardada como destino inmutable, pero no cambia el ámbito
de la clave. Un reintento con el mismo cuerpo canónico y destino responde 200
con el acuse original; otra carga o destino con esa clave devuelve 409. Una
violación de otra restricción no se presenta como duplicado: solo se maneja la
restricción nombrada `uso_rx_evento_clave_unica`, y después se relee el hecho.
El 404 por suscripción ajena sucede antes de buscar la clave.

`EventoUsoRecibido` conserva los hechos que alimentan
[la proyección exacta y RegistroUso](30-persistencia-uso.md). La publicación a
Analytics por RabbitMQ sigue siendo una integración aparte.
`app/eliminacion.py` incorpora los hechos y sus proyecciones a la purga por
organización y valida los destinos antes de eliminarlos.

## Pruebas y límites

`tests/test_persistencia_uso.py` prueba acuse después de persistencia, reintento,
conflicto por cuerpo/destino, aislamiento entre usuarios y organizaciones y
dos solicitudes simultáneas. La prueba concurrente exige que el motor sea
PostgreSQL y usa conexiones independientes. `tests/test_eliminacion.py` verifica
que la purga borra estos hechos solo para la organización afectada.

Las pruebas de API configuran un proveedor de consentimiento sintético. La
ausencia de una autoridad real conserva el 403. Quedan pendientes el recorrido
con bearer y consentimiento real, la publicación a Analytics y la política de
retención. La persistencia usa el identificador entero que entrega el Gateway.

Desde `services/subscriptions`, ejecutar:

```sh
python manage.py migrate --check
python -m pytest tests/test_persistencia_uso.py tests/test_recepcion_uso.py tests/test_eliminacion.py -q
```
