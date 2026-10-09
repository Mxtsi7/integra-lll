# Sesión web: rutas privadas, recuperación al recargar y cierre de sesión

Rama: `Christopher/rutas_privadas/cierre_de_sesion_con_recarga`

Este documento explica las tres tareas *Must* de la planilla, qué archivo hace cada parte, cómo
funciona el flujo completo y cómo se verificó.

| # | Tarea | Estado |
|---|---|---|
| 1 | Protección de rutas privadas (impedir acceso a Home, Panel y Perfil sin sesión válida) | ✅ |
| 2 | Recuperación completa del estado de sesión al recargar (bootstrap de sesión + redirección si no hay token) | ✅ |
| 3 | Cierre de sesión completo en la UI (botón/flujo de "cerrar sesión") | ✅ |

---

## 1. Resumen de archivos

### Nuevos

| Archivo | Qué hace |
|---|---|
| `web/src/context/AuthContext.tsx` | `AuthProvider` + `useAuth()`. Guarda en memoria el estado de la sesión (`verificando` / `anonimo` / `autenticado`), hace el bootstrap al cargar la página, registra el manejador del 401, sincroniza pestañas y expone `iniciarSesion`, `cerrarSesion` y `verificarSesion`. |
| `web/src/components/RutaPrivada.tsx` | `<RutaPrivada>` (guarda de las rutas privadas), `<SoloInvitados>` (login/registro solo sin sesión) y `destinoTrasLogin()` (a dónde volver después del login). |
| `web/src/styles/RutaPrivada.css` | Pantalla con spinner "Verificando tu sesión" que se muestra mientras se valida la sesión al recargar. |
| `shared/src/auth.test.ts` | 9 tests de `tokenExpirado()` y `haySesionValida()`. |
| `web/src/components/RutaPrivada.test.tsx` | 13 tests de integración de las tres tareas (rutas, recarga, login, logout, pestañas). |

### Modificados

| Archivo | Cambio |
|---|---|
| `shared/src/auth.ts` | Se agregan `tokenExpirado(token)` y `haySesionValida()`. Se mantuvo el CRLF del archivo. Se exportan solas por el `export * from './auth'` que ya existía en `index.ts`. |
| `web/src/App.tsx` | Envuelve las rutas en `<AuthProvider>` y las agrupa: `/login` y `/registro` dentro de `<SoloInvitados>`; `/dashboard`, `/home`, `/perfil`, `/configuracion` y `/suscripciones/:id` dentro de `<RutaPrivada>`. La ruta `/Home` pasa a `/home` (igual que el enlace del Sidebar). |
| `web/src/main.tsx` | Se quita el `configurarManejador401(() => window.location.href = "/login")`: ahora lo registra el `AuthProvider` (ver §3.4). |
| `web/src/pages/Login.tsx` | En vez de `guardarTokens()` directo llama a `iniciarSesion()` del contexto, y navega a la página que se quiso abrir antes del login (o a `/dashboard`). |
| `web/src/components/layout/AppLayout.tsx` | Muestra el nombre y el plan reales del usuario (antes eran placeholders fijos) y contiene el flujo de cerrar sesión. |
| `web/src/components/layout/Sidebar.tsx` + `Sidebar.module.css` | Botón **"Cerrar sesión"** (icono `LogOut` de lucide) bajo la tarjeta del usuario. Se ve en todas las páginas privadas porque todas usan `AppLayout`. |

Todos los cambios a código existente llevan un comentario explicando el porqué.

---

## 2. Cómo se decide si "hay sesión válida"

Antes existía `hayTokenGuardado()`, que solo revisa si hay *algo* en `localStorage`. Al recargar eso
no sirve: el access token del backend dura **30 minutos** (`JWT_MINUTOS_ACCESO` en el servicio auth)
y puede quedar vencido, o puede haber basura guardada (por ejemplo la cadena `"undefined"`).

Por eso en `shared/src/auth.ts`:

```ts
tokenExpirado(token, ahoraMs = Date.now()): boolean
haySesionValida(ahoraMs = Date.now()): boolean   // hay access token y no está vencido
```

- Decodifica el payload del JWT (base64url → `atob`) y lee el claim `exp`.
- Si el token **no es un JWT legible** → se considera vencido.
- Si `exp` ya pasó **o pasa en los próximos 10 s** → vencido (margen para que la siguiente petición
  no llegue al gateway con el token ya muerto).
- Si el JWT **no trae `exp`** → se da por vigente y decide el backend.
- **No verifica la firma.** Eso solo lo puede hacer el gateway (es el único que conoce la clave).
  Es una comprobación barata para no mostrar pantallas que van a fallar. Si un token "parece" bueno
  pero el backend lo rechaza, el interceptor 401 de `pedir()` cierra la sesión igual.
- `haySesionValida()` **no borra nada** (es una pregunta, sin efectos secundarios). Limpiar los
  tokens es decisión de quien llama (el `AuthContext`).

Está en `shared` y no en `web` porque es lógica sin UI que también va a necesitar la app móvil
(regla shared vs web del proyecto).

---

## 3. Cómo funciona cada tarea

### 3.1 Estado de la sesión (`AuthContext`)

```ts
type EstadoSesion =
  | { tipo: "verificando" }                            // hay token vigente, preguntando a /usuarios/me/
  | { tipo: "anonimo" }                                // sin sesión
  | { tipo: "autenticado"; usuario: Usuario | null };  // con sesión
```

`useAuth()` entrega:

| Campo | Para qué |
|---|---|
| `estado` | El estado de arriba. |
| `usuario` | El `Usuario` de `/usuarios/me/` o `null`. |
| `estaAutenticado` | `true` solo en `autenticado`. |
| `iniciarSesion(tokens)` | Guarda los tokens y carga el usuario. Lo usa `Login.tsx`. |
| `cerrarSesion()` | `logout()` de shared + estado `anonimo`. |
| `verificarSesion()` | Si el token venció con la pestaña abierta, cierra la sesión y avisa. |

Las pantallas nunca tocan `localStorage`: los tokens siguen viviendo solo en `shared/auth.ts`
(un único lugar conoce las claves), y el contexto solo guarda en memoria *lo que sabemos* de la sesión.

El valor del contexto está memorizado con `useMemo`, igual que `ToastContext`, para no re-renderizar
consumidores si la sesión no cambió. `AuthProvider` va **dentro** de `ToastProvider` porque avisa por
toast cuando la sesión expira.

### 3.2 Tarea 1 — Protección de rutas privadas

`<RutaPrivada>` es una *layout route* de React Router v7 (renderiza `<Outlet />`):

| Estado | Qué muestra |
|---|---|
| `verificando` | Spinner a pantalla completa "Verificando tu sesión". |
| `anonimo` | `<Navigate to="/login" replace state={{ desde: "/ruta/pedida" }} />` |
| `autenticado` | La página pedida. |

Rutas protegidas: **`/home` (Home), `/dashboard` (Panel), `/perfil` (Perfil)**, y además
`/configuracion` y `/suscripciones/:id`, que tampoco tienen sentido sin sesión. `/` y `*` redirigen a
`/dashboard`, así que también pasan por la guarda.

- Se usa `replace` para que el botón "atrás" del navegador no vuelva a la página protegida.
- En cada cambio de página llama a `verificarSesion()`: si el token venció mientras la pestaña estaba
  abierta, cierra la sesión **antes** de mostrar una pantalla que fallaría con 401.

`<SoloInvitados>` envuelve `/login` y `/registro`: con sesión activa redirige al destino del login,
así un usuario logueado que recarga `/login` no ve el formulario.

**Volver a la página pedida:** si alguien abre `/perfil` sin sesión, la guarda guarda `desde: "/perfil"`
en el `state` de la navegación. Tras el login, `destinoTrasLogin()` lo lee y vuelve ahí. Solo acepta
rutas internas (`/algo`, nunca `//otro-sitio.com`) para evitar redirecciones abiertas.

### 3.3 Tarea 2 — Recuperación del estado al recargar (bootstrap)

Al cargar o recargar cualquier página, `AuthProvider` hace esto:

```
                 ┌─────────────────────────┐
  recarga ──────▶│ haySesionValida()?      │
                 └────────┬───────┬────────┘
                       no │       │ sí
                          ▼       ▼
              logout() (limpia    estado = "verificando" (spinner)
              tokens vencidos     GET /api/usuarios/me/
              o basura)                │
              estado = "anonimo"       ├── 200 ─────────▶ "autenticado" con usuario real
              → RutaPrivada            ├── 401 / 404 ───▶ logout() + "anonimo" → /login
                manda a /login         └── red / 500 ───▶ "autenticado" con usuario = null
```

Decisiones:

- **No hay parpadeo.** Mientras se valida se ve el spinner; nunca se ve un instante la página privada
  ni el login equivocado.
- **401 o 404 cierran la sesión.** 401 = el gateway rechazó el token; 404 = el usuario del token ya
  no existe.
- **Red caída o 500 NO echan al usuario.** El token sigue siendo válido; el problema es del servidor,
  no de la sesión (mismo criterio que el interceptor: 403 y 500 no cierran sesión). Solo nos quedamos
  sin los datos del perfil y el sidebar muestra los valores por defecto.
- **Se recupera el usuario real.** El sidebar ahora muestra el nombre y el plan (`Plan Premium` /
  `Plan Gratuito`) del usuario logueado, también después de recargar. Antes eran placeholders fijos.
- **Si se cierra la sesión mientras `/usuarios/me/` está en vuelo**, la respuesta que llega tarde no
  "revive" la sesión.

**Sincronización entre pestañas:** se escucha el evento `storage` del navegador (solo llega a las
*otras* pestañas). Si en una pestaña se cierra sesión, las demás pasan a `anonimo` y van a `/login`;
si en otra pestaña se inicia sesión, esta lo detecta y carga el usuario.

### 3.4 Interceptor 401 integrado al contexto

Antes, `main.tsx` registraba:

```ts
configurarManejador401(() => { window.location.href = "/login"; });
```

Eso recargaba la app completa y se perdía el aviso al usuario. Ahora lo registra `AuthProvider`:

1. `pedir()` recibe un 401 → `logout()` (ya lo hacía) → llama al manejador.
2. El manejador muestra el toast **"Tu sesión expiró. Inicia sesión de nuevo."** (solo si había
   sesión; un anónimo no ve ese mensaje) y pasa el estado a `anonimo`.
3. `<RutaPrivada>` redirige a `/login` sin recargar la página.

Lo que **no** cambió: `login()` y `register()` siguen usando su propio `postJSON`, así que una
contraseña incorrecta (401 del login) no dispara este flujo; sigue mostrando "Usuario o contraseña
inválidos".

### 3.5 Tarea 3 — Cierre de sesión en la UI

Botón **"Cerrar sesión"** en el Sidebar, debajo de la tarjeta del usuario. Está en todas las páginas
privadas porque todas usan `AppLayout`. Al hacer clic (`AppLayout.manejarCerrarSesion`):

1. `cerrarSesion()` → `logout()` de shared borra `access_token` y `refresh_token` de `localStorage`.
2. El contexto pasa a `anonimo`.
3. Toast informativo **"Cerraste sesión."**
4. `navigate("/login", { replace: true })` → el botón "atrás" no vuelve al panel.
5. Si después se escribe a mano `/dashboard` o se recarga, la guarda vuelve a mandar a `/login`
   (ya no hay token).
6. Las demás pestañas abiertas también se cierran (evento `storage`).

El backend **no tiene endpoint de logout** ni lista negra de tokens (los JWT no se invalidan en el
servidor), así que cerrar sesión en el cliente = borrar los tokens locales. Si en el futuro se agrega
`/auth/logout/` o blacklist del refresh token, se llama dentro de `cerrarSesion()` sin tocar las
pantallas.

En pantallas angostas (≤ 900 px) el botón se acomoda en la fila del sidebar junto a la tarjeta del
usuario.

---

## 4. Contrato del backend que se usó

Verificado en `services/auth/app/views.py`:

- `POST /api/auth/login/` → `200 { access_token, refresh_token, usuario: { id, nombre, correo } }`.
  Los tokens ya son JWT reales con claims `organizacion_id` y `rol`.
- `GET /api/usuarios/me/` → usuario actual (el gateway valida el JWT y pasa `X-Usuario-Id`).
  Responde 401 si el token no sirve y 404 si el usuario ya no existe.
- Vida del access token: 30 min (`JWT_MINUTOS_ACCESO`).

---

## 5. Cómo se verificó

Todo desde `frontend/`:

```bash
npm run typecheck   # shared + web: sin errores
npm test            # shared: 27 tests ✅ (9 nuevos) · web: 13 tests ✅ (todos nuevos)
npm run build       # ✅ (solo el aviso de tamaño de chunk que ya existía)
```

### Tests nuevos

`shared/src/auth.test.ts` (9):
- token con `exp` futuro → vigente; con `exp` pasado → vencido; que vence dentro del margen → vencido
- algo que no es JWT (`"undefined"`, base64 inválido, vacío) → vencido
- JWT sin `exp` → vigente
- `haySesionValida()`: sin token, con token vigente, con token vencido (sin borrar nada), tras `logout()`

`web/src/components/RutaPrivada.test.tsx` (13), con la misma estructura de rutas que `App.tsx`:

| Tarea | Test |
|---|---|
| 1 | Sin sesión, `/home`, `/dashboard` y `/perfil` redirigen a `/login` (3 casos) |
| 1 | Token vencido → `/login` y borra los tokens |
| 1 | Token basura (no JWT) → `/login` |
| 1 | Con sesión, `/login` manda al panel |
| 2 | Token vigente: primero spinner, después la página con nombre y plan reales |
| 2 | `/usuarios/me/` responde 401 → cierra sesión y va a `/login` |
| 2 | `/usuarios/me/` falla por red → **no** echa al usuario |
| 1+2 | Abrir `/perfil` sin sesión → login → vuelve a `/perfil` |
| 3 | Botón "Cerrar sesión" borra tokens, muestra el toast y va a `/login` |
| 3 | Tras cerrar sesión, volver a una ruta privada no deja entrar |
| 3 | Si otra pestaña cierra sesión, esta vuelve a `/login` |

Solo se simulan las llamadas de red (`getUsuarioActual`, `login`); los tokens, `logout()` y la
validación del JWT son los reales de shared sobre el `localStorage` de jsdom.

**Prueba de que los tests sirven (mutation testing):** se desactivó a propósito la redirección de
`<RutaPrivada>` y fallaron 9 de los 13 tests. Se restauró el código y vuelven a pasar los 13.

### Prueba manual en el navegador (`npm run dev`, backend apagado)

1. `localStorage` vacío → abrir `/perfil` → termina en `/login`. ✅
2. Guardar un JWT con `exp` a 30 min → abrir `/dashboard` → se ve el panel (el `/usuarios/me/` falla
   por red y, como corresponde, no expulsa). ✅
3. Clic en "Cerrar sesión" → URL `/login`, `access_token` = `null`, toast "Cerraste sesión." visible. ✅

---

## 6. Notas y pendientes

- **Refresh token:** todavía no se usa. Cuando vence el access token (30 min) se cierra la sesión.
  Cuando el backend exponga `/auth/refresh/`, el lugar para renovarlo es `cerrarSesion`/`verificarSesion`
  del contexto y el interceptor 401 de `pedir()`.
- **Móvil:** `tokenExpirado()` / `haySesionValida()` ya están en shared y sirven para la app móvil
  (usa `atob`, disponible en Hermes desde RN 0.74 / Expo SDK 51). Falta integrar la navegación y
  SecureStore.
- **`/registro` exitoso:** no inicia sesión automáticamente (register no devuelve tokens); sigue
  mostrando la pantalla "¡Cuenta creada!" → "Ir a iniciar sesión".
- `PerfilPage` sigue pidiendo `/usuarios/me/` por su cuenta. Podría leer `useAuth().usuario` para
  ahorrar una petición; se dejó igual para no tocar una página que no era parte de estas tareas.
