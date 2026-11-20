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
`USO_PERSISTIR_EVENTO`, configurado en esta entrega para guardar el hecho en
PostgreSQL y proyectar el uso exacto dentro de la misma transacción. El nuevo
evento obtiene 201, el reintento idéntico obtiene 200 con el acuse original y
el conflicto de contenido o destino obtiene 409. Si se desconfigura el escritor,
el receptor devuelve 503 sin acusar recepción.

Los flujos de [idempotencia](28-29-aislamiento-idempotencia-uso.md),
[lectura exacta](30-persistencia-uso.md) y
[cobertura y envío](31-19-cobertura-sincronizacion.md) detallan las entregas
incorporadas a esta misma rama.

## Errores y límites

El Gateway es el límite de autenticación de producción; las pruebas directas
del servicio inyectan sus cabeceras internas y no prueban la firma JWT del
Gateway. Una referencia de otra organización se responde como 404. JSON
incompatible, zona desconocida, intervalo inválido o datos de identidad del
cliente se rechazan con 400. Consentimiento no confirmado devuelve 403 y
almacenamiento no configurado devuelve 503.

Falta conectar una autoridad real de consentimiento de telemetría. Las pruebas
inyectan un proveedor sintético. Queda por verificar el recorrido con bearer
por Gateway y consentimiento vigente. El esquema canónico vive en el paquete
`shared` y el archivo en `docs/contratos` lo referencia.

## Cómo probar

Desde `services/subscriptions`, ejecutar
`python manage.py check` y, con PostgreSQL:

```sh
python -m pytest tests/test_recepcion_uso.py tests/test_persistencia_uso.py tests/test_proyeccion_uso_recolector.py -q
```

Las pruebas cubren contrato, rechazo de fechas fuera de rango, aislamiento de
identidad y destino, cierre seguro sin consentimiento, acuses idempotentes,
persistencia, lectura exacta y cobertura.
