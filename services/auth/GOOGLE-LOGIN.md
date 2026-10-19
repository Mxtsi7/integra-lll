# MX-11 · Inicio de sesión con Google

Decisión: implementar verificación OIDC real en Auth. La dependencia oficial
`google-auth` valida el ID token firmado por Google. Las pruebas sustituyen
únicamente al proveedor externo con mocks; sus tokens de ejemplo no sirven en
producción. No se solicita autorización de Gmail ni se leen mensajes.

## Configuración y contrato

Configurar `GOOGLE_CLIENT_ID` con el client ID de Google Identity Services
destinado a este backend. Vacío deshabilita ambas rutas con HTTP 503 y
`code=google_no_configurado`. Aplicar las migraciones de Auth antes del uso.
La comunicación del cliente con el gateway debe usar HTTPS en producción.

1. El cliente llama **GET `/api/auth/google/nonce/`** con cookies habilitadas.
   Obtiene `nonce`, `client_id` y `vence_en_segundos=300`; la respuesta establece
   una cookie HttpOnly, SameSite=Lax y Secure fuera de DEBUG. No se cachea.
   En web debe usar `fetch(url, {credentials: 'include'})` tanto en este GET
   como en el POST posterior. El gateway admite credenciales CORS solo para
   `CORS_ALLOWED_ORIGINS`, cuyo valor por defecto es `http://localhost:5173`.
2. El cliente entrega ese nonce a la opción `nonce` de Google Identity Services.
   En caso de cancelar o denegar autorización, permanece en login. Puede enviar
   `{"error":"access_denied"}` al POST para obtener `google_cancelado`, sin sesión.
3. Tras recibir el ID token, envía **POST `/api/auth/google/`** con JSON
   `{"id_token":"<credential>","nonce":"<nonce>"}` y la cookie del primer paso.
   El cliente no envía access tokens de Gmail ni identificadores de usuario.
4. Auth valida firma, emisor Google, audiencia configurada, vigencia,
   `email_verified=true`, email válido, `sub` no vacío y coincidencia del nonce.
   Comprueba la cookie y bloquea el intento en PostgreSQL. Un intento vencido,
   eliminado o ya consumido se rechaza; dos solicitudes simultáneas no lo reutilizan.
5. Una identidad previamente vinculada se resuelve exclusivamente por `sub`.
   El email de Google no sustituye el correo local ni cambia organización o rol.
   Para vincular por primera vez una cuenta local existente, el mismo POST debe
   incluir `password` correcto. Coincidir por email no basta para apropiarse de una
   cuenta. Otra identidad Google no reemplaza una vinculación existente.
   Si falta la contraseña o es incorrecta, devuelve `vincular_google` y debe
   iniciarse otro intento desde el primer paso antes de reenviar credenciales.
6. Auth bloquea `User`, crea o reutiliza la vinculación y usa el emisor común de
   sesiones para devolver access/refresh con `proveedor=google`, `sid`,
   `session_version`, `organizacion_id` y `rol`. Refresh conserva el proveedor.
   Las cuentas inactivas no autentican. Redis no disponible devuelve 503 y
   revierte la vinculación y el consumo del intento.

Un email sin cuenta local devuelve **409 `completar_registro`** sin crear usuario,
organización, vinculación ni sesión. El cliente debe presentar el registro normal,
con contraseña y consentimiento; después puede iniciar de nuevo el flujo Google.
El inicio de sesión no interpreta el consentimiento de Google como consentimiento
del tratamiento de datos de Ojo al Gasto.

## Persistencia y alcance

`IdentidadGoogle` vincula de forma única un `sub` a un usuario y se elimina en
cascada al borrar este último. `IntentoGoogle` conserva solo huellas SHA-256 del
nonce y del secreto de navegador y su vencimiento. Se consume dentro de la misma
transacción del login; al emitir un nuevo intento se purgan los vencidos. No se
guardan ID tokens, claves de Google ni contraseñas en estas tablas. Una nueva
solicitud de nonce reemplaza la cookie del intento anterior en ese navegador.

Estas rutas implementan el contrato backend. El botón y la configuración de
Google Identity Services en web/móvil quedan para sus tareas de frontend. No hay
intercambio de authorization code, scopes de Gmail ni creación federada automática.
El gateway debe declarar públicas exactamente las dos rutas indicadas.

## Verificación

```bash
docker compose run --rm auth python manage.py migrate
docker compose run --rm auth pytest tests/test_google.py -v
docker compose run --rm gateway pytest -v
```

Se cubren claims inválidos, firma rechazada, caída del proveedor, cookie ajena,
nonce vencido/reutilizado, primera vinculación, identidad estable por `sub`,
consentimiento, cuenta inactiva y fallo de Redis. PostgreSQL es real; Google se
simula explícitamente y no se realiza un inicio de sesión contra su servicio.

Referencias primarias: [verificación de ID tokens y vinculación por sub](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[OpenID Connect y nonce](https://developers.google.com/identity/openid-connect/openid-connect),
[API google-auth](https://googleapis.dev/python/google-auth/latest/reference/google.oauth2.id_token.html).
