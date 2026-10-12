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

## Política de contraseña (MX-30 / RF-01.1)

Contrato para web (CH-04) y móvil (SE-12), centralizado en
`app/validators.py`: mínimo 8 caracteres, al menos una letra ASCII
(`[A-Za-z]`) y un número ASCII (`[0-9]`). Otros caracteres están permitidos,
pero no sustituyen esos requisitos. No usar `\d` ni categorías Unicode
para comprobar el número o la letra.

En JavaScript, la expresión equivalente es:

```js
const politicaContrasena = /^(?=[\s\S]*[A-Za-z])(?=[\s\S]*[0-9])[\s\S]{8,}$/u;
```

La bandera `u` cuenta los caracteres Unicode como el backend. Los espacios
cuentan y se conservan: validar y enviar el valor original, sin `trim()` ni
normalización. Por ejemplo, `" Abc123 "` es válida (8 caracteres, incluidos
los dos espacios); `"Abc123"`, `"ñáéíóúü1"` y `"Abcdefg١"` se rechazan.

Mostrar el mensaje centralizado del backend ante un rechazo:
«La contraseña debe tener al menos 8 caracteres, una letra y un número.»
La política se aplica al registro y a las contraseñas nuevas; no al login
ni a la comprobación de la contraseña actual.

### Alcance de los serializers de cambio y recuperación

`PasswordResetConfirmSerializer` y `PasswordChangeSerializer` son
prerrequisitos de MX-30 y aún no están conectados a vistas ni rutas.
Su existencia no completa ni implica avance funcional de MX-02, MX-03 o
MX-05: siguen pendientes los endpoints y, para recuperación, verificar el
enlace (identidad, expiración y un solo uso) antes de invocar el serializer.
>>>>>>> 5ab9f278f2c6f99f46958fc53ecf24ffdbb798f2
