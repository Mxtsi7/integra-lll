# MX-17 / MX-18 — Contratación y confirmación de pago demo

[MX-17](https://trello.com/c/mhEXuxIA), [MX-18](https://trello.com/c/GR6fDDrU).
Base: Maxi-permisos-planes (#86), a integrar después de #85.

## Decisión y entorno

Se entrega un proveedor **mock ejecutable**, sin cargos ni proveedor comercial.
No se declara una compra real. Está deshabilitado por defecto. En un entorno
de desarrollo aislado, aplicar migraciones y configurar en `.env`:

```dotenv
PAGOS_MOCK_HABILITADO=True
PAGOS_WEBHOOK_SECRET=<secreto aleatorio local de al menos 32 caracteres>
PAGOS_URL_PUBLICA=http://localhost:8000
PAGOS_URL_RETORNO=http://localhost:5173/planes/retorno
```

Generar el secreto localmente y no subirlo. La URL pública es el origen del
Gateway; retorno permite HTTPS o HTTP loopback. No se admite un retorno del
cuerpo del navegador. La pantalla de retorno pertenece a SE-03/AN-08 y debe
consultar el estado persistido, aunque la URL diga éxito. No usar filas demo
como evidencia de cobros ni migrarlas a una base productiva.

## Contrato para web/móvil

`POST /api/contrataciones/` exige sesión y titular vigente. Recibe
`{plan_codigo:"premium", clave_idempotencia:"<uuid>"}`. La clave se conserva
durante los reintentos; el servidor congela importe/moneda/demo desde catálogo.
Devuelve 201 al crear y 200 al repetir la misma intención. Otra clave mientras
hay una intención pendiente devuelve 409. Campos adicionales se rechazan.

La respuesta contiene id, estado, plan_id, importe decimal string, moneda,
precio_demo, vigente_desde/hasta y URL de checkout/retorno controladas.
`GET /api/contrataciones/<uuid>/` permite consultar solo su organización.
`POST .../<uuid>/cancelar/` exige titular, es idempotente y conserva un periodo
ya pagado. Los adapters y tipos están en `frontend/shared/src/api/planes.ts`.

Abrir `url_checkout` muestra un formulario rotulado «Simulación de pago».
Su capacidad firmada vence a los 15 minutos; no lleva credenciales del usuario.
GET no modifica el plan. POST aprobado/rechazado/cancelado pasa por la misma
validación del webhook y luego redirige 303 al retorno configurado. No hay
secretos de firma en HTML, JS ni URL. La capacidad de checkout es de uso demo;
no guardar su URL en logs ni compartirla. El HTML usa no-store/no-referrer/CSP.

## Webhook

`POST /api/pagos/webhook/` es público exclusivamente para verificar firma.
JSON: evento_id, contratacion_id, organizacion_id (UUID), estado
exitosa/cancelada/fallida, importe decimal y moneda del snapshot. Cabeceras:
`X-Pagos-Instante` (epoch segundos) y `X-Pagos-Firma` (hex HMAC SHA-256 de
`instante + "." + cuerpo UTF-8 exacto`). Ventana de entrega ±300 segundos.
Reintentar conserva evento_id y datos; puede renovar instante/firma.

Firma/instante inválidos dan 403; importe/tenant/moneda incompatibles dan 400.
Evento repetido idéntico se reconoce sin otro efecto; reutilizar su id con
otros datos da 409. Org/contrato/evento se serializan en PostgreSQL y se guardan
en la misma transacción. Un evento válido fuera de orden se registra con
aplicado=false, sin reactivar una cancelada ni degradar un periodo confirmado.
La pasarela real futura deberá conciliar reembolsos/eventos tardíos; aquí no
existen cargos reales que reembolsar.

Solo las rutas exactas `/api/pagos/mock/` y `/api/pagos/webhook/` son públicas.
Los servicios internos siguen privados. No se implementa renovación/cargo
automático: una nueva intención confirmada suma un mes de calendario UTC al
fin ya pagado. Cancelación o fallo de renovación no quita acceso retroactivo.

## Reproducción y evidencia

`pytest tests/test_contratacion.py`: precio/estado/tenant/retorno falsificados,
firma/caducidad, duplicados y eventos tardíos, aislamiento, formulario demo,
concurrencia real de inicio y webhook, y vencimiento del plan sin otra escritura.
El test concurrente usa PostgreSQL; el proveedor es el mock declarado.
OpenAPI documenta el webhook firmado; checkout HTML queda fuera del schema API.
Revisión humana/recepción por Sebastian y Andrea siguen pendientes.
