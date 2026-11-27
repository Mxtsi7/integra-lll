# AN-19 — Eliminación de cuenta en la app móvil

**Responsable:** Andrea Trabol
**Ubicación en la app:** `Configuración → Eliminar Cuenta`
**Contrato backend:** `DELETE /api/usuarios/me/` (MX-07)

---

## ¿Qué hace y cómo funciona?

Permite que un usuario elimine permanentemente su cuenta desde el teléfono, replicando las reglas de seguridad de la versión web dentro de un formulario dedicado (totalmente separado del diálogo de retirar suscripciones).

Puntos clave para explicar en la defensa:

- **Doble validación antes de habilitar el envío:** La pantalla explica primero las consecuencias del borrado. El botón **"Eliminar mi cuenta"** permanece deshabilitado hasta que la persona ingresa su **contraseña actual** y escribe exactamente la palabra **`ELIMINAR`**.
- **Interruptor de despliegue (`Feature Flag`):** `ELIMINAR_CUENTA_DISPONIBLE` (en `shared/src/api/eliminarCuenta.ts`) está en `true`. Si se pone en `false`, la pantalla muestra *"estará disponible próximamente"* en lugar del formulario. La web usa otra bandera, `ELIMINAR_CUENTA_WEB_DISPONIBLE`.
- **Respuestas de otra sesión (S3-AN-03/AN-19):** al confirmar se anota la marca de sesión (`capturarSesion()` de `AuthContext`). Si al responder la marca cambió (salió la cuenta A y entró B), no se llama `cerrarSesion()`, no se avisa ni se muestra el error: `cerrarSesion()` cierra la sesión que haya en ese momento y cerraría la de B. Si la pantalla ya se cerró, tampoco se actualiza su estado.
- **Cierre de sesión solo tras confirmación del servidor:** La sesión local nunca se toca antes de tiempo. Únicamente cuando el backend responde con éxito (`204` o `202`), se ejecuta `cerrarSesion()`, que borra los tokens del almacenamiento seguro (`SecureStore`) y devuelve la app al login. Si el usuario cancela o ocurre cualquier error, la cuenta y la sesión siguen intactas.

---

## Manejo de respuestas y errores del backend

El hook `useEliminarCuenta` llama a `eliminarCuenta()` de `@ojoalgasto/shared` y distingue cada respuesta HTTP:

- **`204 No Content` / `202 Accepted`:** Ambos se tratan como borrado aceptado. Se cierra la sesión local y se muestra un `Alert` confirmando la eliminación (si respondió `202`, el aviso aclara que la eliminación quedó en proceso/pendiente).
- **`403 Forbidden`:** Contraseña actual incorrecta. Muestra el mensaje de error directamente junto al campo de contraseña sin cerrar la pantalla.
- **`409 Conflict` (Último titular):** Ocurre cuando el usuario es el único dueño de una organización. Al recibir este código, aparece una casilla adicional para confirmar explícitamente que también se eliminará la organización antes de reintentar.
- **`400`, `503` o fallo de red:** Muestra el mensaje correspondiente manteniendo la cuenta activa y sin tocar la sesión.

---

## Estructura de archivos

- `frontend/movil/src/screens/configuracion/EliminarCuentaScreen.tsx` — Pantalla conectada al menú de configuración.
- `frontend/movil/src/screens/components/eliminarCuenta/`
  - `useEliminarCuenta.ts` — Control de formulario, petición `DELETE`, manejo de `403`/`409` y cierre de sesión post-borrado.
  - `EliminarCuentaContenido.tsx` — Formulario con validación de contraseña, palabra clave `ELIMINAR` y casilla condicional de organización.
  - `reglasEliminacion.ts` — Validaciones locales y traducción de respuestas HTTP.
  - `estilos.ts` — Estilos del módulo.
  - `eliminarCuenta.test.tsx` — **10 pruebas unitarias** cubriendo validaciones, `204`/`202`, `403`, `409` y cancelación.

---

## Límites conocidos

- **Revocación de token al cerrar sesión:** Al ejecutar `cerrarSesion()` después de borrar la cuenta, la función intenta revocar los tokens en el backend; como el usuario ya fue eliminado, esa llamada falla internamente sin ningún efecto visible para la persona.
