# PR #72 — correcciones y evidencia del 30-10-2026

Base revisada: `fdea7579440c788e9fffd7aa0a5fe970f6172062`.
Dependencia integrada: FE-05 / #133, `c932cab31cec3784826d71ba1a57c033400f3e3b`.
No se repiten las cuatro P2 ya corregidas en esa base.

## Correcciones recibidas

- Se integra la rama FE-05 conservando las reglas Outlook y los dos resultados
  `no_soportada` / `ya_no_existe`. Se prefiere refresh legible, con access como
  alternativa cuando no hay refresh legible. El rechazo `invalid_token` no
  acredita la autorización completa: conserva tokens y pendiente incluso si
  se envió refresh. Solo el éxito del proveedor acredita `revocado_en`.
- Permanecen el CAS por versión, la omisión de reconexiones anteriores al
  turno y la conservación de credenciales nuevas durante la llamada. Cada
  cuenta confirmada sigue teniendo su propia transacción durable.
- El presupuesto recibe explícitamente el Job y su namespace. No suma ejemplos
  indiscriminadamente; incluye los recursos del Job si comparte cuota y rechaza
  un namespace declarado que contradice el argumento. Prueba CPU, memoria y pods.
- El escenario anunciado usa carga externa: DNS completo y `Host: gateway`,
  `NS_CARGA` distinto del namespace de aplicación y todas las operaciones del
  generador dirigidas allí. El menú no apaga workers para acomodar el generador;
  su limpieza también apunta al namespace externo.
- Los parches de DATABASE_URL, CLAVES_CIFRADO y ELIMINACION_INTERNA_SECRET usan
  archivo temporal con umask 077, eliminación al salir y JSON por stdin. Las
  claves no viajan en los argumentos de `kubectl patch`. El arnés usa valores
  ficticios y verifica éxito y error; Linux comprueba permisos 600.
- Ratificación de Outlook registrada en decisión, RF-01.7, MX-22 y
  [tarjeta MX-07](https://trello.com/c/50Mkov2i), limitada a la excepción Outlook.
  El aviso web incluye cuentas personales y corporativas (My Apps y administrador).
  El log dice `resultado=cierre_local`; nunca registra una revocación Microsoft.
  No se atribuyen avisos ni aceptaciones retrospectivos a operaciones antiguas.

## Pruebas locales

Python 3.12, Django 5.1.5, PostgreSQL 16 y Node 20. Resultados de las suites
afectadas, sin omisiones por falta de PostgreSQL:

| Comprobación | Resultado |
|---|---:|
| Connectors completo, incluida FE-05 integrada | 331 aprobadas |
| Auth: eliminación y retención de consentimiento | 33 aprobadas |
| Subscriptions: eliminación y concurrencia | 23 aprobadas |
| Notifications: eliminación y preferencias | 36 aprobadas |
| Analytics: eliminación | 4 aprobadas |
| Gateway: test_gateway | 55 aprobadas |
| Web: diálogo EliminarCuenta | 11 aprobadas |
| Presupuesto con Job explícito | 4 aprobadas |

Total: **497 pruebas**. Build web y comprobación TypeScript correctos.
`makemigrations --check --dry-run` sin cambios en los cinco servicios.
Arneses de carga externa y parches privados aprobados. Arneses existentes:
rotación **79 bien, 0 mal, 1 omitido** (permisos Linux no disponibles en Windows),
comparación de cola **45 bien, 0 mal**. Los checks nuevos quedan en CI Linux.
Se ejecutaron las pruebas PostgreSQL existentes de reconexiones, coordinación
de escrituras y conexión terminada durante la segunda revocación, con evidencia
de la primera conservada. Los nuevos recorridos HTTP firmados usan el adaptador
FE-05 real y solo simulan `requests.post` de Google: refresh rechazado, red y
503 mantienen Gmail y Outlook; el siguiente éxito responde 204 con la misma
operación y sin afectar otra organización.

La selección incorrecta falló antes de integrar. La inferencia insegura de
`invalid_token` de #133 falló en una prueba antes de corregirla. También se
reprodujeron el presupuesto que omitía Jobs, el lanzamiento local incompatible,
los secretos en argv y la falta de instrucciones corporativas antes de corregirlos.

## Recorrido con cinco servidores HTTP locales

Se migraron cinco bases PostgreSQL desechables y se levantaron Auth,
Subscriptions, Connectors, Analytics y Notifications como procesos HTTP
independientes. Se ejecutó el comando real `procesar_eliminaciones`, con todos
los destinos configurados:

1. DELETE real a Auth devuelve 202 y elimina al titular de la organización A.
2. Google simulado responde 503: Connectors devuelve 409 y conserva las dos
   credenciales Gmail y las dos Outlook. Los otros servicios dan 204.
3. Auth conserva solo Connectors pendiente y el mismo `operacion_id`
   `39fc5dc4-6765-4a08-a9a7-0edc9952cd8b`.
4. El segundo ciclo recibe confirmación 204 de Google, Connectors devuelve 204,
   Auth vacía pendientes y guarda `completado_en=2026-10-30T20:22:48.264342Z`.
5. La operación Outlook creada con fecha anterior, `f14b09c8-3888-40c0-a367-5c0944f7a3c4`,
   también termina con su mismo identificador. No genera avisos retroactivos.
6. Las filas y el usuario de la organización B permanecen en los cinco servicios.

En esta demo **solo Google OAuth y la caché de sesiones son dobles**: Google
503/204; caché LocMem. Transporte HTTP, HMAC, PostgreSQL, migraciones y worker
son reales. No acredita revocación OAuth externa, Redis, RabbitMQ, despliegue
Kubernetes ni una medición operativa de 72 horas. Las bases/procesos de la demo
se cerraron al terminar. Los instantes miden esta ejecución; no una promesa de plazo.

## Presupuesto y operación

| Escenario HPA máximo | Pods | Límite memoria | Límite CPU | Resultado |
|---|---:|---:|---:|---|
| Aplicación + Job local | 13 / 12 | 2816 / 2752 MiB | 1950 / 2000m | Rechazado |
| Aplicación + generador externo | 12 / 12 | 2688 / 2752 MiB | 1750 / 2000m | Cabe en la cuota de aplicación |

Antes de la demostración hay que disponer de cuota propia y conectividad en
el namespace externo. El CI comprueba el escenario externo y las regresiones
que exigen rechazar el local; el worker de eliminación permanece incluido.

La ratificación no aprueba el resto de la PR. AN-18/AN-19 mantienen su seguimiento
de habilitación; el aviso debe conservarse al activarlas. Para operaciones
antiguas, soporte comunica la limitación solo si tiene un canal autorizado;
no se exige respuesta para borrar, no se recrean identidades ni se simula un
envío. La desconexión Outlook ordinaria continúa a cargo de Felipe en FE-05.
