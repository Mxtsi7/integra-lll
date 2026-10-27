# MX-24 — Timeout y cuotas de IA

[Tarjeta](https://trello.com/c/Ehiy29mN). Base main a7d4950: VI-27 está
implementada; Analytics tiene settings/DB/health. No hay endpoints de chat ni
ingesta: se entrega una política reutilizable para esos componentes.

## Reglas y contrato

- [RN-24](../../historico/REGLAS-DE-NEGOCIO.md): timeout máximo **3,5 segundos**.
- [RN-25](../../historico/REGLAS-DE-NEGOCIO.md): **tres intentos del mismo PDF
  por día y usuario**. No es un máximo de documentos distintos ni vitalicio.
- [RNF-20 vigente](../../investigacion/requisitos-vigentes.md): **200 llamadas
  por usuario al mes** como control inicial de costo. Una llamada fallida o
  cancelada puede haber sido facturada: consume cuota y no se reembolsa.

Variables: `IA_TIMEOUT_SEGUNDOS=3.5`, `IA_MAX_INTENTOS_PDF_DIA=3`,
`IA_MAX_LLAMADAS_MES=200`, `IA_MAX_LLAMADAS_SIMULTANEAS=4`. Las tres primeras
pueden reducirse; se rechazan valores que superen esas reglas. La concurrencia
es un límite operativo por proceso, no una medición de capacidad distribuida.
Crear y reutilizar una instancia `PoliticaIA` por worker.

```python
resultado = await politica.ejecutar(
    proveedor_async, datos_calculados,
    organizacion_id=org_validada, usuario_id=usuario_validado,
)
resultado = await politica.procesar_documento(
    org_validada, usuario_validado, documento_uuid,
    proveedor_async, datos_calculados, huella_pdf=sha256_pdf,
)
```

La identidad procede del Gateway, nunca del body libre. La huella SHA-256 se
calcula sobre el PDF validado por el servicio receptor; el componente persiste
un HMAC de esa huella y del usuario, no el archivo. La misma huella y usuario
comparten contador aunque cambien de organización. Día y mes corresponden a
la zona configurada de Django (America/Santiago). Los contadores se serializan
con bloqueo transaccional de PostgreSQL por usuario, sin FK hacia Auth.

Repetir el UUID completado devuelve `ya_procesado` con datos calculados actuales,
sin otra llamada ni intento; no recupera una respuesta IA guardada. Un UUID en
curso tampoco ejecuta otra llamada. Error/timeout/cancelación liberan la reserva
del documento, pero conservan sus contadores de intento y consumo externo.
Las reservas abandonadas vencen al menos a los 60 segundos.

El proveedor debe ser una función async con I/O cancelable, configurar el
timeout del SDK/transporte y desactivar reintentos ocultos. No debe bloquear
el event loop ni suprimir cancelación. La espera del proveedor está limitada
a 3,5 s; este componente no acredita la latencia total de red/DB ni RNF-09
(50 usuarios, promedio 2,5 s y p95 4 s).

Resultados: `{estado, motivo, datos}`. Ante timeout, cuota/capacidad agotada,
respuesta inválida o fallo DB/proveedor, devuelve una copia exacta de los datos
calculados. No inventa explicaciones, puntajes, ceros ni ahorro. No llama al
proveedor si no puede comprobar el consumo mensual. La cancelación del request
se propaga. No se almacena texto, archivo ni respuesta externa.

## Integración y límites de entrega

Aplicar las migraciones 0001 y 0002 de Analytics. VI-22 y el componente de ingesta
deben envolver sus llamadas con esta política; VI-23 debe validar la sanitización
antes de habilitar un proveedor real. Este componente recibe un callback y no
envía datos por sí solo. No acredita costo real de USD 0,50 por ejecución ni
promedio USD 0,10 por usuario: requiere medición de tokens/modelo/precios.

`purgar_cuotas_organizacion(uuid)` elimina sus cupos, documentos y contadores en
cascada. Al integrar MX-07/#72, su consumidor Analytics debe invocar el hook
o incluir CupoIngesta en su limpieza; #72 parte de Analytics sin modelos de
dominio. Esa reconciliación es obligatoria antes del despliegue con ingesta real.
La eliminación de datos prima sobre conservar historial de cuotas de ese tenant.

## Validación

27 pruebas de Analytics pasan contra PostgreSQL: concurrencia real entre
organizaciones para el último cupo, timeout/cancelación, capacidad, tres intentos
del mismo PDF, otros PDFs/usuarios, cambio de día/mes, cuota mensual, idempotencia,
fallos DB/proveedor, reservas abandonadas, purga y entradas inválidas.
Proveedores async simulados explícitamente; no Anthropic ni carga distribuida.
Analytics se añade al CI existente y health tiene OpenAPI estricto.
Revisión humana y recepción de Victor/ingesta pendientes.
