# Servicio de Autenticación (`auth`)

Puerto `8001`. Registro, login y datos de usuario. Firma los tokens que el
gateway valida en cada petición (ADR-004).

## Endpoints (a través del gateway)

| Método | Ruta | Público | Devuelve |
|---|---|:---:|---|
| `POST` | `/api/auth/register/` | Sí | usuario creado, sin password (`201`) |
| `POST` | `/api/auth/login/` | Sí | `access_token`, `refresh_token`, `usuario` (`200`) / `401` si no calza |
| `POST` | `/api/auth/password-reset/` | Sí | respuesta neutra (`200`) / correo inválido (`400`) |
| `POST` | `/api/auth/password-reset/confirm/` | Sí | contraseña actualizada (`200`) / validación o enlace inválido (`400`) / sesiones no disponibles (`503`) |
| `GET` | `/api/usuarios/<id>/` | No, exige `Authorization: Bearer` | usuario, sin password (`200`) / `404` |

`/api/auth/` es pública (`RUTAS_PUBLICAS` en el gateway); `/api/usuarios/` no.

### Login — ejemplo

\`\`\`json
// POST /api/auth/login/
{ "email": "ana@ejemplo.com", "password": "ClaveSegura123" }

// 200 OK
{
  "access_token": "…",
  "refresh_token": "…",
  "usuario": { "id": 1, "nombre": "Ana", "correo": "ana@ejemplo.com" }
}
\`\`\`

Coincide con `frontend/shared/src/auth.ts` (`login()`), así que el frontend
web ya lo consume sin cambios.

### Solicitar recuperación de contraseña

`POST /api/auth/password-reset/` recibe `{"email": "ana@ejemplo.com"}`.
Para cualquier correo válido devuelve `200` con el mismo cuerpo:

```json
{"detail": "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña."}
```

Solo se envía correo a usuarios activos con contraseña utilizable. Un fallo
SMTP conserva la respuesta neutra y registra únicamente el identificador del
usuario, sin el token ni el cuerpo del correo. El token caduca al cumplir
60 minutos y se invalida cuando cambia la contraseña.

Configura `FRONTEND_URL` con la URL pública de la web y las variables
`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`,
`EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_TIMEOUT` y `DEFAULT_FROM_EMAIL`
descritas en `.env.example`. TLS y SSL son alternativas: activa solo una.
El backend predeterminado es SMTP; no uses el backend de consola porque
expone el enlace de recuperación en los logs. Sin un servidor SMTP
configurado no se entregan correos. Las pruebas usan correo en memoria.

Esta ruta solicita el enlace. La conexión del formulario web (CH-06/CH-07)
corresponde a tareas separadas.

Pruebas del endpoint, la caducidad y la protección del token:

```bash
docker compose run --rm auth pytest tests/test_recuperacion.py -v
```


### Confirmar recuperación (MX-03)

`POST /api/auth/password-reset/confirm/` recibe el parámetro `token` del
correo, sin modificarlo, y `password` con la nueva contraseña:

```json
{"token": "<uid>.<token-firmado>", "password": "NuevaClave123"}
```

Reutiliza la política RF-01.1 del registro: mínimo 8 caracteres, una letra
y un número. Se conservan los espacios de la contraseña. Responde `200`
con `{"detail": "Contraseña restablecida. Inicia sesión nuevamente."}`;
no entrega JWT ni inicia sesión automáticamente. Los errores de campos
usan las claves `token`/`password`. Un enlace inválido, expirado o usado
responde `400` con `{"detail": "El enlace es inválido o expiró. Solicita uno nuevo."}`.

El bloqueo `select_for_update()` dentro de `transaction.atomic()` hace que
la segunda petición valide el token contra el hash ya actualizado: solo
una puede cambiar la contraseña. Todos los enlaces emitidos con el hash
anterior quedan invalidados, incluso si la nueva contraseña es igual.

El login incluye `session_version` tanto en access como en refresh. Auth
publica en Redis una versión HMAC del hash de contraseña; el gateway
comprueba esa versión en cada petición privada, sin consultar la base de
Auth ni reenviar JWT a los servicios. Un reset cambia la versión antes de
guardar la contraseña: los JWT anteriores dejan de autorizar de inmediato.
La base Redis debe ser la misma en auth/gateway (`SESSION_REDIS_URL`),
y el futuro endpoint de refresh debe comprobar `sesion_vigente()` antes de
emitir tokens. Esta rama todavía no implementa refresh ni logout por sesión.

Si Redis no está disponible, login/reset responden `503`; un reset fallido
conserva contraseña y enlace. El gateway devuelve `503` y no reenvía la
petición. Una clave ausente en Redis exige nuevo login: perder el estado
no reactiva JWT revocados. Las sesiones de otros usuarios no cambian.
**Despliegue:** reconstruir auth y gateway e iniciarlos con Redis; los JWT
anteriores a este contrato no incluyen versión y exigen iniciar sesión otra vez.

Pruebas (PostgreSQL real para el caso de peticiones simultáneas):

```bash
docker compose run --rm auth pytest tests/test_recuperacion.py tests/test_confirmacion_recuperacion.py -v
docker compose run --rm gateway pytest -v
```
