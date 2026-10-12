# Servicio de Autenticación (`auth`)

Puerto `8001`. Registro, login y datos de usuario. Firma los tokens que el
gateway valida en cada petición (ADR-004).

## Endpoints (a través del gateway)

| Método | Ruta | Público | Devuelve |
|---|---|:---:|---|
| `POST` | `/api/auth/register/` | Sí | usuario creado, sin password (`201`) |
| `POST` | `/api/auth/login/` | Sí | `access_token`, `refresh_token`, `usuario` (`200`) / `401` si no calza |
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