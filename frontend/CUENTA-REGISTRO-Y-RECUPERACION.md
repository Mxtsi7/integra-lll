# Registro y recuperación de contraseña (web)

**Rama:** `Christopher/registro_web` · Tarjetas **CH-04, CH-05, CH-06 y CH-07** (Christopher Solís)

Un commit por tarjeta, más uno de base común en `shared`.

| Tarjeta | Qué hace | Archivos principales |
|---|---|---|
| CH-04 Validaciones del registro | Política común de contraseña, correo, nombre y consentimiento; errores por campo y del servidor | `shared/src/validaciones.ts`, `web/src/pages/register.tsx` |
| CH-05 Ver/ocultar contraseña | Botón accesible por campo en Login y Registro | `web/src/components/ui/Campo.tsx` (`CampoContrasena`) |
| CH-06 Solicitar recuperación | Conecta la pantalla de AN-14 con `POST /api/auth/password-reset/` | `web/src/pages/RecuperarContrasenaPage.tsx`, `App.tsx` |
| CH-07 Restablecer contraseña | Conecta con `POST /api/auth/password-reset/confirm/`; vencido, inválido y usado | `web/src/pages/RestablecerContrasenaPage.tsx`, `App.tsx` |

Dependencias usadas (ya en `main`): MX-02 y MX-04 (`services/auth/app/recuperacion.py`), MX-30
(`services/auth/app/passwords.py`) y AN-14 (pantallas de Andrea).

---

## Contrato (para quien lo reciba)

### `shared` — `@ojoalgasto/shared`

```ts
validarPassword(password: string): string | null       // misma regla que validar_password (MX-30)
validarCorreo(correo: string): string | null
validarRegistro(datos: DatosRegistro): ErroresRegistro  // {} = se puede enviar
erroresRegistroDesdeServidor(campos): { porCampo, general }

solicitarRecuperacion(correo: string): Promise<{ detail: string }>   // MX-02
restablecerContrasena(token: string, password: string): Promise<void> // MX-04

class AuthError { status; codigo?: string; campos?: Record<string, string[]> }
```

| Llamada | Backend responde | En la web |
|---|---|---|
| `solicitarRecuperacion` | 200 siempre igual (exista o no el correo) | Confirmación neutra |
| | 400 correo mal formado | Mensaje del backend, se puede reintentar |
| `restablecerContrasena` | 200 | Borra la sesión local y va al Login con toast |
| | 400 `code=token_invalido` | "Enlace inválido" |
| | 410 `code=token_expirado` / `token_usado` | "Enlace vencido" / "Enlace ya utilizado" |
| | 400 `password: [...]` | Error bajo el campo |
| | 503 o sin red | Aviso y reintento |

### `CampoContrasena` (web)

```tsx
<CampoContrasena
  id="password"
  etiqueta="Contraseña"
  autoComplete="new-password"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  error={errores.password}
/>
```

Mismas props que `CampoTexto` salvo `type`. Empieza oculta; el botón es `type="button"` (no envía),
no le quita el foco al campo, se llama "Mostrar contraseña" y usa `aria-pressed` para el estado.

---

## Evidencia

Desde `frontend/`: `npm ci && npm run typecheck && npm test && npm run build` → shared **84** ✅ ·
web **79** ✅ · build ✅.

**Casos límite UI = API (CH-04).** Se pasaron 17 contraseñas por el `validar_password` real de Python y
por `validarPassword()`; dieron el mismo resultado en los 17. Están fijados en
`shared/src/validaciones.test.ts`. Algunos:

| Contraseña | Backend | UI | Por qué importa |
|---|---|---|---|
| `abcd1234` | ✅ | ✅ | exactamente 8 |
| `   abc1 ` | ✅ | ✅ | los espacios cuentan |
| `contraseña٣` | ✅ | ✅ | dígito árabe: el validador anterior (`/\d/`) lo rechazaba |
| `😀😀😀a1` | ❌ | ❌ | 5 caracteres: el validador anterior (`.length`) lo aceptaba |

**Criterios de aceptación → tests**

| Criterio | Test |
|---|---|
| CH-04 No se envía registro inválido | `register.test.tsx` › "con el formulario vacío no envía…", casos de contraseña |
| CH-04 No se pierde el error del servidor | `register.test.tsx` › errores del servidor (por campo, general, 500, sin red) |
| CH-05 Alternar conserva el valor y no envía | `Campo.test.tsx`, `register.test.tsx` › ver/ocultar |
| CH-05 Nombre accesible y teclado | `Campo.test.tsx` › "tiene nombre accesible…" |
| CH-06 Misma confirmación con y sin cuenta | `RecuperarContrasenaPage.test.tsx` › "…muestran la misma confirmación" |
| CH-06 Carga y error no bloquean | `RecuperarContrasenaPage.test.tsx` › "Enviando…", sin red + reintento |
| CH-07 Enlace válido termina en Login con confirmación | `RestablecerContrasenaPage.test.tsx` › enlace válido |
| CH-07 Enlace inválido no altera sesión ni deja sin salida | `RestablecerContrasenaPage.test.tsx` › enlace que no sirve |

Cada arreglo se verificó quitándolo a propósito: en todos los casos falló al menos un test.

**Pendiente de las tarjetas:** la revisión por otra persona. Andrea debería validar los cambios en sus
pantallas de AN-14 y Maxi el uso de los endpoints de MX-02/MX-04.

---

## Diferencias con el texto original

- **CH-04:** el backend también acepta dígitos "decorativos" (`²`, `①`) por `isdigit()`; la UI pide un
  dígito común. Es el único caso donde difieren, y si pasara, el backend sigue siendo el que decide.
- **CH-05:** el teclado se verifica comprobando que es un `<button>` nativo y enfocable (el navegador lo
  activa con Enter/Espacio); no se agregó `user-event` para no tocar el lockfile. `CampoContrasena`
  también se reutiliza en Restablecer contraseña.
- **CH-06:** el texto de confirmación de AN-14 ("Enviamos las instrucciones a…") pasó a uno neutro, porque
  afirmaba un envío que el backend no confirma.
- **CH-07:** la pantalla de éxito de AN-14 se reemplazó por la redirección al Login con un toast, como pide
  el criterio. Se agregó el estado "Enlace ya utilizado", que no existía.
