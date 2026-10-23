# MX-19 / MX-20 — Sincronización y aceptación de planes

[MX-19](https://trello.com/c/lN3zwhlC), [MX-20](https://trello.com/c/KC6lAfT3).
Base: Maxi-contratacion (#87); orden #85 → #86 → #87 → este PR.

`permisos_vigentes` es el único servicio que arma el contrato de features.
Lo reutilizan GET permisos y las respuestas de contratación/webhook. No hay
un endpoint duplicado ni una caché que invalidar. Perfil y permisos responden
`Cache-Control: no-store`; Gateway vuelve a consultar Auth en cada operación
Premium. Un JWT emitido cuando era Free sirve tras confirmar el pago; el mismo
JWT pierde acceso al vencer el periodo sin esperar refresh, cron u otra escritura.

Cancelación/fallo no inventan permisos: cancelar un periodo confirmado conserva
acceso hasta su fin; fallar/cancelar una intención pendiente mantiene Free.
Web/móvil deben releer `getPermisosPlan` al volver del checkout, al recuperar
el foco y ante un rechazo Premium; no deben guardarlo como un claim autorizante.

`tests/test_aceptacion_planes.py` atraviesa Gateway y Auth reales con JWT y
PostgreSQL. El transporte HTTP se despacha a Auth real mediante un doble; el
dominio Analytics responde con un doble explícito. No demuestra chat/IA reales
ni una compra comercial. Redis de sesión usa LocMem de pruebas.

Matriz: confirmación/fallo/cancelación; retorno sin efecto; webhook repetido;
datos falsos; organizaciones A/B; id de evento reutilizado; acceso directo Free;
mismo JWT antes/después; periodo cancelado que vence; pertenencia modificada.
Las regresiones de concurrencia de inicio/webhook siguen en el PR anterior.

Ejecutar `pytest tests/test_aceptacion_planes.py tests/test_contratacion.py`
contra PostgreSQL y la suite de Auth completa; validar también Gateway,
OpenAPI estricto y tipos compartidos. La revisión humana y recepción de los
clientes permanecen pendientes; estos tests no atribuyen aprobación del equipo.
