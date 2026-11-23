
## Qué hace esta tarea
Cuando el usuario autoriza o cancela el acceso en Gmail u Outlook, el proveedor lo devuelve a la aplicación web (`/oauth/retorno`). Esta pantalla valida los parámetros recibidos, limpia la URL para no dejar códigos expuestos, confirma el resultado con el backend y permite volver al listado real de cuentas (`/cuentas`).

## Archivos creados y modificados

| Archivo | Qué hace |
| :--- | :--- |
| `frontend/shared/src/api/cuentas.ts` | Valida localmente `estado_oauth` y `codigo`/`error` (`esEntradaCallbackValida`) y envía el retorno al backend mediante `POST /api/conectores/autorizaciones/callback/` (`procesarCallbackOAuth`). |
| `frontend/web/src/pages/RetornoOAuthPage.tsx` | Pantalla de retorno en `/oauth/retorno`. Limpia los parámetros de la URL apenas los lee, evita doble ejecución en `StrictMode` y muestra tres estados claros: **cuenta conectada**, **autorización cancelada** o **error**. |
| `frontend/web/src/App.tsx` | Registra la ruta protegida `/oauth/retorno` dentro de `<RutaPrivada />` para garantizar que la llamada al backend viaje con la sesión del usuario. |
| `frontend/web/src/pages/RetornoOAuthPage.test.tsx` | Pruebas unitarias de éxito con limpieza de URL, cancelación del usuario y rechazo de parámetros manipulados sin llamar al servidor. |

## Flujo paso a paso (para explicar en defensa)
1. El usuario inicia la conexión desde `/cuentas` (`ConectarCorreo`), que llama a `POST /api/conectores/autorizaciones/` con `retorno = window.location.origin + '/oauth/retorno'`.
2. Google o Microsoft redirige al navegador a `/oauth/retorno?code=...&state=...` (o `?error=access_denied&state=...` si canceló).
3. `RetornoOAuthPage` captura los parámetros en memoria y ejecuta `navigate('/oauth/retorno', { replace: true })` para borrar `code` y `state` de la barra de direcciones e historial.
4. Valida el formato de `state` y `code`/`error`. Si fueron manipulados, detiene el flujo y muestra error sin contactar al servidor.
5. Llama a `POST /api/conectores/autorizaciones/callback/`:
   - Si el usuario aceptó, el backend canjea el código y devuelve la `CuentaConectada`.
   - Si canceló, el backend marca el intento como cancelado sin crear cuenta.
6. El botón **Volver a mis cuentas** navega a `/cuentas`, donde **AN-17** vuelve a consultar `GET /api/conectores/` desde el backend.

## Cómo probarlo
```bash
cd frontend/web && npx vitest run src/pages/RetornoOAuthPage.test.tsx
