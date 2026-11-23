# S3-MX-31/19 — Cobertura y sincronización del recolector

## Recorrido real disponible

Cada POST de uso aceptado por el receptor guarda su ventana, recolector,
origen, cobertura, estado y tramos exactos en `EventoUsoRecibido`. El nuevo
`GET /api/suscripciones/{uuid}/uso/cobertura/?fecha=YYYY-MM-DD` exige la misma
identidad autenticada que la escritura y pagina las observaciones del usuario
actual para esa suscripción y día. Devuelve cada ventana original; no rellena
los espacios entre eventos. Un hueco es falta de observación y se conserva por
recolector. Una fecha ausente o inválida responde 400 y una suscripción ajena
404.

En `frontend/shared/src/api/usoRecolectores.ts`, `enviarUsoPendiente()` llama
el POST mediante `pedir()`, que utiliza el Gateway y bearer actual. Acepta una
cancelación y aplica un timeout máximo de diez segundos. Solo considera válida
la respuesta si el event_id, destino, estado aceptado/duplicado y fecha UTC
coinciden. Captura identidad de sesión al iniciar; una respuesta de A no puede
llamar el guardado de última sincronización si cambió a B. El callback recibe
sesión, suscripción, recolector, evento y `recibido_en` del servidor; debe
guardar bajo esa clave. Errores HTTP, timeout, cancelación, acuse incorrecto o
cambio de sesión no actualizan esa marca.

## Integración que falta

El repo no contiene las dependencias Trello MX-16/17/18; sus referencias no
son accesibles desde esta cuenta. Tampoco hay aún una cola persistente de
eventos que invoque `enviarUsoPendiente()` o un almacenamiento durable del
callback. La utilidad de HTTP es código real y no un transporte simulado, pero
las pruebas de cliente sustituyen `fetch`, y no se declara una entrega móvil o
extensión integrada de punta a punta. Además, la autoridad de consentimiento
de telemetría sigue sin existir; en configuración real el receptor niega la
captura hasta que esa dependencia esté disponible.

Por esto se entrega el punto de integración y la lectura real de cobertura,
pero S3-MX-19 queda pendiente de completar la cola/almacenamiento de MX-16/17/18,
consentimiento y una prueba HTTP con Gateway+PostgreSQL usando esas piezas. No
se adelanta `última sincronización` con el reloj local ni se trata una semilla
como observación real.

## Cómo probar

Desde `frontend`, `npm exec --workspace=shared vitest run
src/api/usoRecolectores.test.ts` y `npm run typecheck --workspace=shared`.
Estas pruebas usan `fetch` doble y demuestran la validación del acuse, timeout,
fallo HTTP y aislamiento de sesiones; no demuestran conectividad de Gateway.
Desde `services/subscriptions`, `python -m pytest
tests/test_persistencia_uso.py -q` valida consulta paginada y filtro por usuario
contra PostgreSQL real del servicio.
