# Servicio de Autenticación (`auth`)

Puerto `8001`. Registro, login y datos de usuario. Firma los tokens que el
gateway valida en cada petición (ADR-004).

## Endpoints (a través del gateway)

| Método | Ruta | Público | Devuelve |
|---|---|:---:|---|
| `POST` | `/api/auth/register/` | Sí | usuario creado, sin password (`201`) |
| `POST` | `/api/auth/login/` | Sí | `access_token`, `refresh_token`, `usuario` (`200`) / `401` si no calza |
| `POST` | `/api/auth/password-reset/` | Sí | respuesta neutra (`200`) / correo inválido (`400`) |
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

Esta ruta solicita el enlace. La conexión del formulario web (CH-06) y el
endpoint que confirma la nueva contraseña corresponden a tareas separadas.

Pruebas del endpoint, la caducidad y la protección del token:

```bash
docker compose run --rm auth pytest tests/test_recuperacion.py -v
```
