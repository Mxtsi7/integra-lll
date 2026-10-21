# Registro y recuperación de contraseña (web)

**Rama:** `Christopher/registro_web` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-04 | Alinear validaciones de registro web con la política del backend | ✅ |
| CH-05 | Mostrar u ocultar contraseña en Login y Registro | ✅ |
| CH-06 | Solicitar recuperación de contraseña desde web | ✅ |
| CH-07 | Restablecer contraseña y resolver enlace inválido en web | ✅ |

Dependencias que ya estaban en `main` y se usaron: **MX-02** y **MX-04** (endpoints de recuperación,
`services/auth/app/recuperacion.py`), **MX-30** (política de contraseña, `services/auth/app/passwords.py`)
y **AN-14** (pantallas de recuperación de Andrea).

## Dónde está cada tarea

Rutas relativas a `frontend/`.

| Tarea | Archivo | Qué hace |
|---|---|---|
| CH-04 | [shared/src/validaciones.ts](shared/src/validaciones.ts) | Reglas de contraseña, correo, nombre y consentimiento (iguales al backend) |
| CH-04 | [web/src/pages/register.tsx](web/src/pages/register.tsx) | Valida antes de enviar y muestra los errores bajo cada campo |
| CH-04, 06, 07 | [shared/src/auth.ts](shared/src/auth.ts) | `AuthError` con errores por campo y `code`; llamadas de recuperación |
| CH-05 | [web/src/components/ui/Campo.tsx](web/src/components/ui/Campo.tsx) | `CampoContrasena`: campo con botón de ver/ocultar |
| CH-05 | [web/src/pages/Login.tsx](web/src/pages/Login.tsx) | Usa `CampoContrasena` |
| CH-06 | [web/src/pages/RecuperarContrasenaPage.tsx](web/src/pages/RecuperarContrasenaPage.tsx) | Formulario de correo con confirmación neutra |
| CH-07 | [web/src/pages/RestablecerContrasenaPage.tsx](web/src/pages/RestablecerContrasenaPage.tsx) | Nueva contraseña; enlace vencido, inválido o usado |
| CH-06, 07 | [web/src/App.tsx](web/src/App.tsx) | Conecta las dos pantallas con el backend |
| CH-07 | [web/src/context/AuthContext.tsx](web/src/context/AuthContext.tsx) | `cerrarSesionLocal()` |

---

## CH-04 — Validaciones del registro

**Antes:** el registro solo revisaba que las contraseñas coincidieran y que se aceptaran los términos.
Del backend mostraba un solo error en un toast (`AuthError` guardaba solo el primer mensaje).

**La regla de contraseña es una copia fiel del backend** (`shared/src/validaciones.ts`):

```ts
const LETRA = /\p{L}/u;    // = Python str.isalpha()
const DIGITO = /\p{Nd}/u;  // dígitos de cualquier alfabeto, como str.isdigit()

export function validarPassword(password: string): string | null {
  // Python cuenta caracteres; .length de JS cuenta un emoji como 2.
  if ([...password].length < LARGO_MINIMO_PASSWORD) return MENSAJE_POLITICA_PASSWORD;
  if (!LETRA.test(password) || !DIGITO.test(password)) return MENSAJE_POLITICA_PASSWORD;
  return null;
}
```

- Mínimo 8 caracteres, una letra y un número, igual que `validar_password` (MX-30).
- No recorta espacios (el backend tampoco) y el mensaje es el mismo texto que devuelve el backend.

**En `register.tsx`**, si algo no cumple no se envía nada:

```tsx
const locales = validarRegistro({ nombre, correo, password, confirmacion: confirm, aceptaDatos: accepted });
setErrores(locales);
if (Object.keys(locales).length > 0) {
  enfocarPrimerError(locales);   // el foco va al primer campo con error
  return;                        // NO se envía el registro
}
```

**El backend sigue siendo la validación definitiva.** Si responde con errores, se reparten por campo y
lo que no es de ningún campo sale en un toast, así no se pierde ningún mensaje:

```tsx
const { porCampo, general } = err.campos
  ? erroresRegistroDesdeServidor(err.campos)   // email → correo, acepta_datos → aceptaDatos…
  : { porCampo: {}, general: [err.message] };
setErrores(porCampo);
if (general.length > 0) toast.error(general.join(" "));
```

Cada error se muestra bajo su campo con `aria-invalid`, y al corregir un campo se borra su error. El
formulario usa `noValidate` para mostrar nuestros mensajes y no los globos del navegador.

---

## CH-05 — Mostrar u ocultar contraseña

Un solo componente reutilizable en `Campo.tsx`, que se apoya en el `CampoTexto` existente:

```tsx
export function CampoContrasena({ id, disabled, ...resto }: CampoContrasenaProps) {
  const [visible, setVisible] = useState(false);            // empieza siempre oculta
  // …
  return (
    <CampoTexto
      {...resto}
      type={visible ? 'text' : 'password'}                  // solo cambia el type: el valor se conserva
      accesorio={
        <button
          type="button"                                     // nunca envía el formulario
          aria-label="Mostrar contraseña"
          aria-pressed={visible}                            // el estado, para lectores de pantalla
          aria-controls={idControl}
          onMouseDown={(e) => e.preventDefault()}           // el foco se queda en el campo
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      }
    />
  );
}
```

- Es un `<button>` nativo, así que funciona con teclado (Tab + Enter o Espacio).
- El nombre accesible no cambia; el estado lo da `aria-pressed`, que es el patrón de botón de alternancia
  de WAI-ARIA.
- Login lo usa en la contraseña; Registro en contraseña y confirmación, cada una con su propio botón.

---

## CH-06 — Solicitar recuperación de contraseña

La pantalla de Andrea (AN-14) existía pero **no estaba conectada** ("Esta función todavía no está
disponible"). En `App.tsx` se le pasa el handler real:

```tsx
async function pedirEnlaceRecuperacion(email: string): Promise<void> {
  await solicitarRecuperacion(email);   // POST /api/auth/password-reset/
}
// …
<RecuperarContrasenaPage onSolicitarRecuperacion={pedirEnlaceRecuperacion} />
```

Cambios en la pantalla:

```tsx
if (!onSolicitarRecuperacion || isLoading) return;   // se envía una sola vez
const errorCorreo = validarCorreo(email);            // misma validación que el registro
// …
} catch (err: unknown) {
  setError(mensajeDeError(err));   // el formulario queda habilitado (finally) para reintentar
}
```

- **Confirmación neutra:** el backend responde igual exista o no la cuenta (anti-enumeración), y la
  pantalla también dice lo mismo para cualquier correo: *"Si hay una cuenta con ana@…, te enviamos un
  enlace…"*. Antes decía "Enviamos las instrucciones a…", que afirmaba un envío.
- **Errores en español:** sin red → *"No pudimos conectar con el servidor…"* (antes salía
  "Failed to fetch"); un 400 muestra el mensaje del backend.
- Mientras espera muestra "Enviando…" con el botón deshabilitado.

---

## CH-07 — Restablecer contraseña

También estaba sin conectar. En `App.tsx`:

```tsx
function cambiarContrasena(password: string, token: string): Promise<void> {
  return restablecerContrasena(token, password);   // POST /api/auth/password-reset/confirm/
}
```

**Antes** la pantalla adivinaba el error por el status (401 = vencido) o buscando la palabra "vencido"
en el mensaje, y no existía el caso "ya utilizado". **Ahora** usa el `code` que manda el backend (MX-04):

```tsx
const ESTADO_POR_CODIGO: Record<CodigoErrorEnlace, EstadoEnlace> = {
  token_expirado: 'vencido',
  token_invalido: 'invalido',
  token_usado: 'usado',      // estado nuevo: "Enlace ya utilizado"
};
```

| Respuesta del backend | Pantalla |
|---|---|
| 200 | Va al **Login** con el aviso "Contraseña actualizada. Inicia sesión con tu contraseña nueva." |
| 410 `token_expirado` | "Enlace vencido" + pedir uno nuevo |
| 410 `token_usado` | "Enlace ya utilizado" + pedir uno nuevo |
| 400 `token_invalido` o sin token en la URL | "Enlace inválido" + ir a recuperación |
| 400 con error de `password` | Error bajo el campo, se puede corregir |
| 503 o sin red | Aviso y reintento |

**Al terminar bien:**

```tsx
await onSubmitNewPassword(password, token);
cerrarSesionLocal();                     // el backend revocó todas las sesiones
toast.exito(MENSAJE_EXITO);
navigate('/login', { replace: true });
```

El backend revoca todas las sesiones al cambiar la clave. Si en ese navegador había una abierta, ya no
sirve; por eso se borra con `cerrarSesionLocal()` (nuevo en `AuthContext`), que no llama al backend.
Sin esto, `/login` te habría mandado al panel con una sesión muerta. **Ningún error toca la sesión:** un
enlace malo no le cierra la sesión a nadie, y todas las pantallas de error tienen salida.

La contraseña nueva usa la misma regla que el registro (`validarPassword`) y el campo `CampoContrasena`.

---

## Contrato

```ts
// @ojoalgasto/shared
validarPassword(password): string | null
validarCorreo(correo): string | null
validarRegistro(datos): ErroresRegistro                 // {} = se puede enviar
solicitarRecuperacion(correo): Promise<{ detail: string }>
restablecerContrasena(token, password): Promise<void>
class AuthError { status; codigo?: string; campos?: Record<string, string[]> }
```

`CampoContrasena` recibe las mismas props que `CampoTexto`, salvo `type`.

## Tests

**shared:** 84 ✅ · **web:** 79 ✅

| Archivo | Tests | Qué cubre |
|---|---|---|
| `shared/src/validaciones.test.ts` | 34 | Política de contraseña (17 casos límite verificados contra el backend), correo, registro, errores del servidor |
| `shared/src/auth.test.ts` | +5 | Errores por campo y `code` en `AuthError`; llamadas de recuperación |
| `web/src/components/ui/Campo.test.tsx` | 7 | CH-05: oculta al inicio, conserva valor, no envía, foco, teclado |
| `web/src/pages/register.test.tsx` | 14 | CH-04: no envía inválidos, errores por campo, errores del servidor, doble envío |
| `web/src/pages/RecuperarContrasenaPage.test.tsx` | 8 | CH-06: confirmación neutra, una sola vez, errores y reintento |
| `web/src/pages/RestablecerContrasenaPage.test.tsx` | 14 | CH-07: éxito al Login, vencido / inválido / usado, sesión intacta en errores |

**Casos límite UI = API (CH-04):** se pasaron 17 contraseñas por el `validar_password` real de Python y
por `validarPassword()`, y dieron lo mismo en las 17. Por ejemplo, `contraseña٣` (dígito árabe) y
`😀😀😀a1` (5 caracteres) fallaban con el validador anterior de la pantalla, y ahora coinciden.

Además, en cada arreglo se quitó el cambio a propósito y se comprobó que fallara al menos un test.

## Cómo probarlo

```bash
npm ci && npm run typecheck && npm test && npm run build
```

Manual (`npm run dev`):
- `/registro` vacío → "Crear cuenta" → errores bajo cada campo y el foco en "Nombre".
- El ojo en la contraseña → la muestra sin enviar el formulario.
- `/recuperar-contrasena` → correo → "Si hay una cuenta con…".
- `/restablecer-contrasena` sin token → "Enlace inválido".

## Diferencias con el texto de las tarjetas

- **CH-04:** el backend acepta dígitos decorativos (`²`, `①`) y la UI no; es el único caso distinto, y ahí
  decide el backend.
- **CH-05:** el teclado se prueba verificando que es un `<button>` nativo enfocable (no se agregó
  `user-event` para no tocar el lockfile). El componente también se reutiliza en Restablecer.
- **CH-06:** el texto de confirmación de AN-14 pasó a ser neutro.
- **CH-07:** la pantalla de éxito de AN-14 se reemplazó por ir al Login con un aviso, como pide el criterio.

## Pendiente

- **Revisión por otra persona** (lo piden las cuatro tarjetas): Andrea, por los cambios en sus pantallas
  de AN-14, y Maxi, por el uso de los endpoints de MX-02 y MX-04.
