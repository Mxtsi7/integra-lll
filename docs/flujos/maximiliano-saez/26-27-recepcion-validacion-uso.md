# S3-MX-26/27 — Recepción y validación de uso

## Flujo disponible en esta rama

El Gateway valida el bearer y entrega `X-Organizacion-Id` y `X-Usuario-Id` como
identidad interna confiable. El cliente solicita
`POST /api/suscripciones/{uuid}/uso/recolector/`; el UUID de destino se resuelve
con el filtro de organización de `SubscriptionViewSet.get_object()`. El
identificador de usuario es el entero positivo recibido del Gateway. Ningún
identificador de identidad del cuerpo del evento se acepta.

`SubscriptionViewSet.recibir_uso_recolector()` exige esa identidad y pasa el
cuerpo a `app/uso_recolectores/recepcion.py`. La capa comprueba el máximo de
4 KiB, carga el esquema v1 compartido desde `shared/contratos`, y aplica las
reglas de `validacion.py`: UUID v4, origen y estado permitidos, marcas UTC con
milisegundos, zona IANA, ventana contenida en un solo día local, tramos
ordenados y sin solapamientos, y suma exacta en milisegundos. La duración solo
representa los tramos recibidos; no se infiere actividad de huecos.

Tras validar, el flujo llama a `USO_VERIFICAR_CONSENTIMIENTO` con suscripción,
usuario y evento. Si no existe una autoridad configurada o no confirma
consentimiento vigente, devuelve 403. Verifica además que la zona coincide con
la zona común de informes configurada. Finalmente delega en
`USO_PERSISTIR_EVENTO`; si falta un receptor durable, devuelve 503 y no acusa
recepción. La persistencia, idempotencia y respuesta 201/200/409 corresponden
a las ramas siguientes MX-28/29.

## Errores y límites

El Gateway es el límite de autenticación de producción; las pruebas directas
del servicio inyectan sus cabeceras internas y no prueban la firma JWT del
Gateway. Una referencia de otra organización se responde como 404. JSON
incompatible, zona desconocida, intervalo inválido o datos de identidad del
cliente se rechazan con 400. Consentimiento no confirmado devuelve 403 y
almacenamiento no configurado devuelve 503.

En `main` no existe todavía una autoridad de consentimiento de telemetría ni
un almacenamiento durable para este contrato. El callback de consentimiento
usado en pruebas es un doble; no implica consentimiento real. La zona de
informe común requiere acuerdo explícito. El esquema se sirve desde el paquete
`shared` para evitar una segunda copia en la imagen del servicio; el archivo en
`docs/contratos` referencia esa fuente canónica.

## Cómo probar

Desde `services/subscriptions`, ejecutar
`python -m pytest tests/test_recepcion_uso.py -q` y
`python manage.py check`. Las pruebas de integración del servicio deben usar
PostgreSQL. Las pruebas de esta rama cubren fixtures canónicas, mutaciones
inválidas, identidad requerida, aislamiento de destino, cierre seguro sin
consentimiento ni almacenamiento y validación anterior al callback. No
acreditan todavía persistencia de uso ni integración real con consentimiento.
