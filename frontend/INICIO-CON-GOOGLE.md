# S3-AN-07 — Iniciar sesión con Google (web)

**Responsable:** Andrea Travola · **Pantalla:** Login · **Contrato:** MX-11 (identidad) y MX-10 (tokens)

Es **solo identidad**: no pide permiso para leer Gmail (eso es la conexión de cuentas, AN-15).

## Cómo funciona
1. Al abrir el Login se pide un nonce: `GET /api/auth/google/nonce/` (con cookies; el backend lo liga al navegador). Responde `nonce`, `client_id` y `vence_en_segundos` (5 minutos).
2. Se carga el script oficial de Google (`accounts.google.com/gsi/client`) y se dibuja su botón con ese `client_id` y `nonce`.
3. Al elegir una cuenta, Google devuelve un ID token. Se manda a `POST /api/auth/google/` con el nonce.
4. El backend lo valida y responde con los tokens propios de la app. Se guardan con `iniciarSesion` del `AuthContext`, igual que el login con contraseña, y se vuelve al destino anterior al login.

## Casos
| Respuesta | Qué pasa |
|---|---|
| 200 | Sesión propia y vuelta al destino |
| 401 `vincular_google` | La cuenta ya existe con correo y contraseña: se pide la contraseña **una vez** para vincular |
| 409 `completar_registro` | No hay cuenta con ese correo: se avisa y se ofrece "Crear una cuenta" |
| 400 `google_cancelado` | "Cancelaste el inicio con Google." |
| 401 `google_invalido` | "No pudimos validar tu cuenta de Google." |
| 503 `google_no_disponible` | Mensaje del servidor |
| 503 `google_no_configurado` | No se muestra el botón |
| Sin red | Mensaje de conexión y botón para reintentar |

Cancelar o fallar **nunca** crea sesión ni muestra éxito.

## Por qué un nonce nuevo en cada intento
El backend **gasta el nonce apenas lo recibe**, incluso si responde `vincular_google`. Por eso, después de cualquier respuesta que no inicie sesión, se pide un nonce nuevo y se vuelve a dibujar el botón. En el caso de vincular, la persona escribe la contraseña y toca el botón de Google otra vez.

## Reglas
- Una credencial de un intento anterior se ignora.
- Dos toques seguidos mandan una sola solicitud.
- Si mientras se esperaba la respuesta cambió la sesión (otra pestaña), esa respuesta se descarta.
- Nunca se escribe el ID token ni la contraseña en consola.

## Configuración
- Servidor: `GOOGLE_CLIENT_ID` en el servicio de auth (ver `.env.example`). Vacío = el botón no aparece.
- En Google Cloud Console, el cliente OAuth debe tener los **orígenes autorizados** de la web (p. ej. `http://localhost:5173` y el dominio de producción).
- En desarrollo la web (`:5173`) llama al gateway (`:8000`): el gateway ya permite cookies (`CORS_ALLOW_CREDENTIALS`). En producción nginx deja ambos en el mismo origen.

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `shared/src/auth.ts` | `pedirNonceGoogle()` y `loginConGoogle()` |
| `web/src/utils/googleIdentity.ts` | Carga el script de Google una sola vez |
| `web/src/components/Acceso/InicioConGoogle.tsx` | El botón, la vinculación y los avisos |
| `web/src/pages/Login.tsx` | Lo monta bajo el formulario |

## Pruebas
`InicioConGoogle.test.tsx` y `googleLogin.test.ts` (shared).

## Pendiente / no verificado
- **No se probó con Google real:** necesita un `client_id` y un dominio autorizado. Las pruebas usan un Google simulado.
- Si la persona cierra la ventana de Google sin elegir, Google no avisa y la pantalla queda como estaba.
