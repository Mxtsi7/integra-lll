# MX-24 — Timeout y cupo de ingesta

[Tarjeta](https://trello.com/c/Ehiy29mN). Base main a7d4950: VI-27 está
implementada; Analytics tiene settings/DB/health. Todavía no hay endpoints
de chat ni ingesta en este servicio. Se entrega la política reutilizable,
sin crear un asistente ficticio ni sustituir VI-22/VI-23.

## Configuración y contrato

`IA_TIMEOUT_SEGUNDOS=8`, `IA_MAX_DOCUMENTOS_USUARIO=20` y
`IA_MAX_LLAMADAS_SIMULTANEAS=4` son valores operativos iniciales configurables,
no cuotas comerciales ni cifras atribuidas al adjunto. Crear una instancia
`PoliticaIA` por worker y reutilizarla. Los límites deben ser positivos/finitos.

- `await politica.ejecutar(proveedor_async, datos_calculados)` limita tiempo y
  llamadas simultáneas por proceso; no reserva un documento para un chat.
- `await politica.procesar_documento(org, usuario, documento_uuid, proveedor_async,
  datos_calculados)` reserva cupo en PostgreSQL **antes** del proveedor. Usa
  únicamente identidad validada por Gateway, nunca ids libres del body.
- El proveedor es una función `async` cancelable que recibe el timeout. Debe
  configurar también el timeout del SDK/transporte y desactivar reintentos
  ocultos; no envolver un cliente síncrono bloqueante ni suprimir cancelación.

Resultados: `{estado, motivo, datos}`. En éxito, datos del proveedor; ante
timeout, cuota/capacidad agotada o fallo externo/DB, se conservan exactamente
los datos calculados suministrados. No inventa texto, puntajes, ceros ni ahorro.
El motivo permite informar degradación sin impedir consultar esos datos.
`CancelledError` del request se propaga y libera su reserva.

El cupo cuenta documentos completados y reservas activas por usuario/tenant.
Repetir un UUID completado no llama al proveedor y devuelve `ya_procesado`
con los datos calculados actuales; no afirma recuperar una respuesta IA guardada.
Un duplicado en curso tampoco ejecuta otra llamada. Error/timeout libera la
reserva; una caída del proceso la conserva hasta expirar (mínimo 60 s o doble
timeout). El límite se serializa por usuario con bloqueo real de PostgreSQL.

## Datos e integración

Solo se guardan ids internos, UUID de documento, estado y vencimiento. No se
persisten archivos, texto ni respuesta del proveedor. No hay FK entre esquemas.
Aplicar la migración de Analytics antes de incorporar esta política en VI-22
y en ingesta. VI-23 debe aprobar el contexto permitido antes de conectar un
proveedor real; este componente recibe un callback y no envía datos por sí solo.

`purgar_cuotas_organizacion(uuid)` elimina los metadatos de ese tenant y sus
reservas/completados. Al integrar MX-07/#72, su consumidor Analytics debe invocar
este hook o incluir CupoIngesta en su limpieza; actualmente #72 declara Analytics
sin modelos de dominio. Esa reconciliación es obligatoria antes del despliegue
con ingesta real, y no se atribuye a esta rama una integración que aún no existe.

## Validación

`pytest -q` desde services/analytics contra PostgreSQL. Incluye concurrencia
real del último cupo, timeout/cancelación, saturación sin bloquear el loop,
cuota agotada sin llamada, aislamiento A/B, idempotencia, caída de DB/proveedor,
reservas abandonadas, purga y entradas/configuración inválidas. Los proveedores
son dobles async explícitos; no se probó Anthropic ni una carga distribuida.
Analytics se añade al CI existente y health queda descrito en OpenAPI estricto.
Revisión humana y recepción de Victor/ingesta pendientes.
