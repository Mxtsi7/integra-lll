# MX-29 y MX-10 — cierre y renovación de sesión

Trello: [MX-29](https://trello.com/c/LKvkdcZ9), [MX-10](https://trello.com/c/dlybrwRf).
RF-01.6 (Must, matriz de trazabilidad). La renovación conserva ese contrato de sesión.

1. Login bloquea el usuario y crea `Sesion` con UUID `sid`, JTI de refresh y vencimiento.
2. Los JWT incluyen `sid`, `session_version`, usuario, organización y rol. Redis conserva
   la versión de credenciales y una entrada por dispositivo hasta vencer el refresh.
3. Gateway exige ambos registros en cada petición protegida. Borra las cabeceras de
   identidad recibidas y propaga `X-Sesion-Id` del JWT, además de usuario/organización/rol.
4. `POST /api/auth/logout/` es público en el Gateway y exige
   `{"refresh_token":"..."}` en el body. Auth comprueba firma, tipo refresh,
   expiración, usuario propietario, `sid` y JTI vigente bajo bloqueo. No usa
   `X-Sesion-Id` ni otra cabecera del cliente como prueba de identidad.
   Devuelve 204; el access y refresh de ese dispositivo dejan de funcionar
   inmediatamente (límite RF: 60 s), sin afectar otras sesiones u organizaciones.
5. `POST /api/auth/refresh/` es público; recibe `{"refresh_token":"..."}` y devuelve
   `access_token` y `refresh_token`. La rotación guarda un nuevo JTI bajo bloqueo.
   Reutilizar un refresh revoca toda esa familia, sin cerrar otros dispositivos.

El vencimiento de la sesión es fijo desde login. Un access vencido no impide renovar
con refresh vigente. Reset/cambio de contraseña invalida las familias al sustituir la
versión global. Un usuario inactivo o una pertenencia/rol cambiados no puede renovar.
La pérdida de Redis rechaza sesiones; un error de conexión devuelve 503 sin autorizar.
Los JWT anteriores sin `sid` requieren iniciar sesión nuevamente al desplegar.

Las rutas públicas son coincidencias exactas; `/api/auth/` ya no es un prefijo público.
Los servicios siguen confiando en el Gateway y deben permanecer en la red interna.

## Contrato de logout con CH-03 y SE-15

Se adopta la opción de revocar por refresh en el body, compatible con
`frontend/shared/src/auth.ts::revocarSesion()` de main después de #75.
El access es opcional y puede estar vencido: no es necesario renovarlo para salir.
Se eliminan igualmente las cabeceras de identidad falsificadas en el Gateway.
Un logout repetido con el mismo refresh aún vigente devuelve 204.

| Respuesta | Significado para el cliente |
|---|---|
| 204 | Revocación confirmada; borrar tokens y datos locales. |
| 400 | Falta el refresh o el body no cumple el contrato. |
| 401 | Refresh inválido, vencido o JTI anterior; no confirma una nueva revocación. |
| 503 | No se pudo persistir la revocación por fallo de Redis; se permite reintentar. |

El cliente web actual cierra localmente incluso ante una revocación no confirmada
y avisa del fallo. Esa política de UI pertenece a CH-03/SE-15. No se cambia en este PR.
Antes de cerrar sesión, el cliente debe esperar cualquier refresh en vuelo y usar
el último refresh guardado: un refresh anterior ya rotado se rechaza sin cerrar
una familia con otro JTI. Las pruebas de Auth y Gateway cubren el body que envía
CH-03, sin Authorization y también con access vencido. Falta la aceptación humana
del receptor; no se da por recibida ni se cierra la tarjeta automáticamente.

## Contrato de refresh para web, SE-16 y VI-16

`POST /api/auth/refresh/` recibe `{"refresh_token":"..."}` sin exigir access.
La respuesta 200 contiene `access_token` **y un nuevo `refresh_token`**. El cliente
debe guardar los dos antes de liberar la operación o reintentar peticiones.
La rotación mantiene el vencimiento original de la sesión.

- Mantener **una sola petición de refresh en vuelo por sesión**. Las peticiones
  paralelas de API deben esperar la misma operación de renovación.
- Coordinar también entre pestañas del mismo navegador: exclusión mutua para
  renovar, releer el último par de tokens al tomar el turno y comunicar el par
  actualizado a las demás pestañas. Un bloqueo solo en memoria de una pestaña
  no basta.
- Dos refresh concurrentes con el mismo token cierran la familia: uno puede
  rotar y el otro detecta reutilización y revoca también el access recién emitido.
- **401:** no reintentar el mismo refresh; descartar la sesión y volver a Login.
- **503:** conservar ambos tokens y reintentar con espera acotada. Auth revierte
  el cambio de JTI; no borrar la sesión por una indisponibilidad temporal.
- Si se pierde una respuesta 200 en la red, el cliente puede conservar un token
  ya consumido. No asumir que ese caso equivale a un 503: repetirlo puede cerrar
  la familia y requerir Login.

Este PR entrega y prueba el contrato del servidor; no añade el interceptor de
refresh ni navegación/UI móvil o web. OpenAPI consolidado corresponde a MX-14.

## Migraciones y coordinación con #77

**Decisión de compatibilidad:** se conserva `0008_sesion`, ya referenciada por las
ramas apiladas #69–#73. No se renombra una migración de forma aislada ni se alteran
sus dependencias en otros PR. Django ordena por dependencias, no por el número
del nombre. En esta rama hay una única hoja Auth:
`0005_token_recuperacion_usado → 0008_sesion`.

Orden de integración definido para esta entrega:

1. Integrar #68 antes de sus dependientes #69, #70, #71, #72 y #73.
2. Actualizar #77 contra ese main antes de integrar su catálogo. Si se integra
   solo sobre #68, añadir una migración de unión con dependencias
   `0008_sesion` y `0006_catalogo_paises`.
3. Si ya entró toda la pila, la unión debe depender de la última hoja de Auth
   (actualmente `0010_retencion_consentimiento` en #72/#73) y
   `0006_catalogo_paises`. Elegir el siguiente nombre libre al preparar esa unión.
4. Verificar `makemigrations --check --dry-run`, migración desde cero y actualización
   desde una base con #68 aplicado. No integrar #77 dejando dos hojas de Auth.
   En Subscriptions debe conciliar además su catálogo con `0007_transicionestado`
   de #66, ya presente en main.

La unión corresponde al segundo PR que entra, porque #68 no puede depender de una
migración de países que todavía no existe en main. Este documento fija la
coordinación y el criterio verificable; no afirma que #77 ni la pila estén
integrados o que sus migraciones ya se hayan modificado.

## Limpieza operativa de sesiones

`python manage.py limpiar_sesiones --dry-run` informa cuántas filas retiraría.
`python manage.py limpiar_sesiones` elimina sesiones vencidas hace al menos siete
días, tanto revocadas como no revocadas. Se puede ajustar con
`--dias-retencion N` (cero permite limpiar todo lo vencido).
Nunca elimina sesiones vigentes ni usuarios. Las entradas Redis ya expiran por
TTL al vencer la sesión. Ejecutar el comando periódicamente desde la operación
del despliegue; este PR no instala un scheduler nuevo.

## Seguimientos de seguridad

La carrera entre emisión/login y revocación global, y el throttling de login,
refresh y logout, deben trazarse a [#68](https://github.com/Mxtsi7/integra-lll/pull/68),
donde nacen `emitir_tokens` y el login de sesiones; la revisión de #69 no cambia
ese origen. Los consumidores futuros de `emitir_tokens` deben conservar el
bloqueo de usuario y el límite transaccional. No se afirma resolver todos esos
seguimientos en esta corrección ni se ha abierto una tarjeta sin asignación.

La confirmación pública de verificación de correo se retira de esta rama:
corresponde añadir su ruta exacta al integrar #70, junto con su endpoint.

Aplicar `python manage.py migrate` en Auth antes de desplegar. Se reutiliza
`SESSION_REDIS_URL` existente; no hay secretos nuevos.

Verificación: `pytest tests/test_sesiones.py tests/test_limpiar_sesiones.py tests/test_confirmacion_recuperacion.py`
en Auth con PostgreSQL; `pytest` en Gateway. Se cubren revocación por dispositivo,
reutilización, expiración, fallo de Redis y cabeceras falsificadas.

Corrección de revisión sobre main `e6156d3` (#66 y #75 incluidos): suite Auth
completa, **141 pruebas** con PostgreSQL 16 y PBKDF2 predeterminado; prueba
adicional de refresh concurrente, **1 aprobada** con PostgreSQL. Gateway:
**37 aprobadas**. Frontend de main: **84 shared + 79 web**, TypeScript y build
correctos. También pasaron Django `check`, `makemigrations --check --dry-run`,
OpenAPI `--validate --fail-on-warn`, actualización desde la migración `0005`
y `git diff --check`. Redis se sustituye por LocMem en las pruebas; los errores
de conexión se inyectan para comprobar 503 y rollback. No se afirma una prueba
con Redis de producción ni aceptación humana de CH-03.
