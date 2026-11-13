# AN-12 — Verificación de correo desde la app móvil

**Responsable:** Andrea Trabol
**Ruta / Deep Link:** `ojoalgasto://verificar-correo?token=...`
**Contrato backend:** `POST /api/auth/email-verification/confirm/` (MX-28)

---

## ¿Qué hace y cómo funciona?

Cuando una persona abre el enlace de verificación desde su correo, la aplicación captura el `token` y lo valida directamente contra el backend usando `confirmarCorreo()` de `@ojoalgasto/shared`.

Puntos clave para explicar en la defensa:

- **Sin activación local por URL:** El correo jamás se marca como verificado solo por abrir la pantalla o leer el parámetro `?token=...`. El cambio ocurre únicamente cuando el servidor responde con éxito.
- **Una sola ejecución por token:** El hook `useVerificarCorreo` controla que el envío del token se dispare una única vez por enlace abierto, evitando peticiones duplicadas por re-renderizados.
- **Sincronización real del perfil:** Si el usuario ya tenía sesión iniciada al verificar, la pantalla ejecuta `recargarPerfil()` para traer el estado actualizado desde el servidor en lugar de asumirlo localmente.

---

## Estados que maneja la pantalla

La interfaz cubre 7 escenarios distintos para que el usuario nunca quede frente a una pantalla en blanco o un error genérico:

1. **Verificando:** Spinner de espera mientras responde el backend.
2. **Verificado:** Confirmación exitosa del correo.
3. **Vencido:** El enlace superó su tiempo de vigencia.
4. **Usado:** El token ya fue consumido anteriormente.
5. **Inválido:** El enlace está mal formado, alterado o no existe.
6. **Correo no disponible:** El estado de verificación no puede completarse para esa cuenta.
7. **Error recuperable (`503` o sin conexión):** Muestra un botón **"Reintentar"** para volver a consultar sin perder el token.

### Recuperación cuando el enlace falla (`vencido`, `usado` o `inválido`)

- **Con sesión activa:** Muestra el componente `ReenviarEnlace`, que llama a `POST /auth/email-verification/request/` para enviar un nuevo correo. También controla el límite de frecuencia (**HTTP `429`**) avisando si se pidieron demasiados reenvíos seguidos.
- **Sin sesión activa:** Como no sabemos a qué cuenta reenviarle sin exponer datos, ofrece un botón directo para **"Iniciar sesión"**.

---

## Estructura de archivos

- `frontend/movil/src/screens/auth/VerificarCorreoScreen.tsx` — Pantalla contenedora conectada a la navegación.
- `frontend/movil/src/screens/components/verificacionCorreo/`
  - `useVerificarCorreo.ts` — Lógica de confirmación única por token, reenvío y manejo de estados.
  - `VerificarCorreoContenido.tsx` — Renderizado condicional según el estado de la verificación.
  - `ReenviarEnlace.tsx` — Botón y flujo de solicitud de nuevo correo (incluye control de `429`).
  - `reglasVerificacion.ts` — Mapeo de errores HTTP a los estados de interfaz.
  - `estilos.ts` — Estilos del módulo.
  - `verificacionCorreo.test.tsx` — **14 pruebas unitarias** cubriendo todos los estados, reenvíos y límites.

---
