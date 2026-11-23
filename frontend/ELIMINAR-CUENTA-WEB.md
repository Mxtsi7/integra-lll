# Eliminar cuenta en web

## Qué cambió
- `ELIMINAR_CUENTA_DISPONIBLE` pasa a `true` (`shared/src/api/eliminarCuenta.ts`). Es una bandera **compartida**: habilita el botón en Perfil y Ajustes (web) y la pantalla AN-19 en móvil.
- `EliminarCuenta.tsx` anota la sesión (`capturarSesion()`) antes de pedir el borrado. Si cuando llega la respuesta ya hay otra sesión (otra cuenta entró o se cerró), **no** cierra sesión, no avisa y no redirige; tampoco muestra errores de la sesión anterior.

## Cómo funciona el diálogo
1. Se abre desde Perfil o Ajustes y pide contraseña actual y escribir `ELIMINAR`.
2. `DELETE /api/usuarios/me/`:
   - **204** → "eliminada": cierra la sesión local y va a `/login`.
   - **202** → "pendiente": cierra la sesión y avisa que la eliminación de la organización **todavía no termina** (no se muestra como completada).
   - **409** → último titular: pide marcar que también se elimina la organización y reenvía con `confirmacion_organizacion`.
   - **403 / 400 / 503 / red** → error visible; la sesión y la cuenta siguen igual.
3. Doble envío bloqueado con una ref; Cancelar y Escape no llaman a nada.

## Configuración verificada en el repo (lectura, no ejecución)
- Backend MX-07 en `main` (DELETE + limpieza duradera).
- `docker-compose.yml`: `ELIMINACION_INTERNA_SECRET` obligatorio y servicio `auth-eliminaciones` (`procesar_eliminaciones --continuo`).
- Endpoints internos `/internal/organizaciones/<uuid>/` en suscripciones, conectores, analítica y notificaciones.

## Pendiente / límites
- **No se probó de punta a punta** (cuenta real + worker + 4 servicios). Antes de usarlo en un entorno real, quien despliegue debe confirmar que `.env` tiene `ELIMINACION_INTERNA_SECRET` y `ELIMINACION_DESTINOS` y que el worker corre. Si falta configuración el backend responde 503 y la cuenta sigue activa.
- Outlook: se destruyen las credenciales guardadas, pero Microsoft no revoca el acceso solo (el diálogo ya lo explica).
- Para apagar la función rápido: `ELIMINAR_CUENTA_DISPONIBLE = false`.

## Pruebas
- `EliminarCuenta.test.tsx`: 409 (primer envío sin confirmación de organización), doble clic, respuesta y error tardíos de otra sesión, además de 204/202/403/503/red.
- `EliminarCuenta.sesion.test.tsx`: con `AuthProvider` real, otra cuenta entra mientras se espera → no se cierra ni redirige.
- `PerfilPage.test.tsx` y `ConfiguracionPage.eliminar.test.tsx`: el diálogo abre desde Perfil y desde Ajustes.
