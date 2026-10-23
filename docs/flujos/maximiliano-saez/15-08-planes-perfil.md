# MX-15 / MX-08 — Contratación y plan vigente

Tarjetas: [MX-15](https://trello.com/c/bKmWM5xh), [MX-08](https://trello.com/c/rM7nrprc).
Base: main a7d4950. Contrata el titular para su organización; todos sus miembros
comparten el plan. Auth conserva catálogo y contrataciones en su propio esquema.

`GET /api/usuarios/me/` añade `plan: free | premium`, de solo lectura. Una
contratación pendiente o fallida nunca lo habilita. No se toma del JWT ni del
cuerpo del cliente. Se consulta el periodo confirmado vigente en cada lectura;
al vencer, vuelve a free sin esperar un cron ni una nueva escritura.

Estados: pendiente → exitosa/cancelada/fallida; exitosa → cancelada. Cancelada
y fallida son finales. Repetir el mismo estado es idempotente. Cancelar una
exitosa conserva acceso hasta su vencimiento. Renovar amplía el periodo desde
el último fin ya pagado. Un mes se cuenta por calendario UTC, ajustando el día
cuando el mes siguiente es más corto; el límite final es exclusivo.

El catálogo inicial es **demostrativo**: free 0.00 y premium 4990.00 CLP al mes.
No son precios comerciales acordados ni habilitan cobros. La API de catálogo,
gating y checkout son entregas posteriores MX-09/16 y MX-17/18. Solo la
confirmación del proveedor/mocking explícito podrá invocar la transición exitosa.

Aplicar migraciones antes de desplegar Auth. La rama parte de las sesiones
0008 de main; al integrar #70–#73/#77, unir hojas de migración sin reescribir
migraciones ya aplicadas. No existe una FK entre esquemas.

Validar con `pytest tests/test_planes.py tests/test_user_detail.py` contra
PostgreSQL, `manage.py check`, `makemigrations --check --dry-run` y OpenAPI.
Revisión humana y aceptación de los consumidores pendientes.
