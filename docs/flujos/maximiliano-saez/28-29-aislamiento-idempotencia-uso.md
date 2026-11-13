# S3-MX-28/29 — Aislamiento e idempotencia de uso

## Flujo

La acción autenticada descrita en [MX-26/27](26-27-recepcion-validacion-uso.md)
comprueba destino, identidad, consentimiento y contrato antes de llamar a
`app/uso_recolectores/persistencia.py`. Esa función vuelve a leer y bloquea la
suscripción dentro de una transacción, y crea un `EventoUsoRecibido` con cuerpo
normalizado, usuario interno, organización, recolector, fecha local, destino,
correlación, hora original de recepción y marca durable de proyección pendiente.
El servicio responde 201 únicamente tras confirmar la fila.

La clave única de PostgreSQL es organización + usuario + recolector + event_id.
La suscripción queda guardada como destino inmutable, pero no cambia el ámbito
de la clave. Un reintento con el mismo cuerpo canónico y destino responde 200
con el acuse original; otra carga o destino con esa clave devuelve 409. Una
violación de otra restricción no se presenta como duplicado: solo se maneja la
restricción nombrada `uso_rx_evento_clave_unica`, y después se relee el hecho.
El 404 por suscripción ajena sucede antes de buscar la clave.

`EventoUsoRecibido` es una fuente durable pendiente, no la proyección de
`RegistroUso` ni un mensaje de RabbitMQ. No publica el evento incompatible con
el contrato del productor de Víctor. `app/eliminacion.py` añade la fila al
protocolo de purga por organización, valida que su suscripción pertenezca al
mismo tenant y la elimina antes de la suscripción.

## Pruebas y límites

`tests/test_persistencia_uso.py` prueba acuse después de persistencia, reintento,
conflicto por cuerpo/destino, aislamiento entre usuarios y organizaciones y
dos solicitudes simultáneas. La prueba concurrente exige que el motor sea
PostgreSQL y usa conexiones independientes. `tests/test_eliminacion.py` verifica
que la purga borra estos hechos solo para la organización afectada.

Las pruebas de API configuran un callback de consentimiento sintético porque
`main` no ofrece una autoridad vigente de consentimiento. En configuración real
la ausencia de ese proveedor conserva el 403 de cierre seguro. La asociación a
Analytics, la proyección a minutos, el transporte y la política de retención
siguen pendientes. El identificador interno de usuario sigue siendo el entero
del Gateway; no se transforma al UUID requerido por el DTO de Víctor.

Desde `services/subscriptions`, ejecutar:

```sh
python manage.py migrate --check
python -m pytest tests/test_persistencia_uso.py tests/test_recepcion_uso.py tests/test_eliminacion.py -q
```
