# Sesión web: rutas privadas, recarga y cierre de sesión

**Rama:** `Christopher/rutas_privadas/cierre_de_sesion_con_recarga` · **PR:** #57

| # | Tarea | Estado |
|---|---|---|
| 1 | Protección de rutas privadas (Home, Panel y Perfil sin sesión válida) | ✅ |
| 2 | Recuperar la sesión al recargar (bootstrap + redirección si no hay token) | ✅ |
| 3 | Cierre de sesión en la UI (botón "Cerrar sesión") | ✅ |

## Dónde está cada tarea

Rutas relativas a `frontend/`.

| Tarea | Archivo | Qué hace |
|---|---|---|
| 1 | [web/src/App.tsx](web/src/App.tsx) | Agrupa las rutas en privadas e invitados |
| 1 | [web/src/components/RutaPrivada.tsx](web/src/components/RutaPrivada.tsx) | `RutaPrivada` (bloquea) y `SoloInvitados` (login/registro) |
| 1, 2 y 3 | [shared/src/auth.ts](shared/src/auth.ts) | `haySesionValida()` (¿token vigente?) y `revocarSesion()` (logout en el backend) |
| 2 | [web/src/context/AuthContext.tsx](web/src/context/AuthContext.tsx) | Estado de la sesión, recarga, 401 y pestañas |
| 2 | [shared/src/api/cliente.ts](shared/src/api/cliente.ts) | Un 401 de un token viejo no cierra la sesión nueva |
| 2 | [web/src/styles/RutaPrivada.css](web/src/styles/RutaPrivada.css) | Pantalla "Verificando tu sesión" |
| 3 | [web/src/components/layout/Sidebar.tsx](web/src/components/layout/Sidebar.tsx) | Botón "Cerrar sesión" (+ estilos en `Sidebar.module.css`) |
| 2 y 3 | [web/src/components/layout/AppLayout.tsx](web/src/components/layout/AppLayout.tsx) | Usuario real en el sidebar y flujo de logout |
| — | [web/src/pages/Login.tsx](web/src/pages/Login.tsx) | Usa el contexto y vuelve a la página pedida |

La sesión tiene tres estados, que cualquier componente lee con `useAuth()`:

```tsx
type EstadoSesion =
  | { tipo: "verificando" }                            // hay token, preguntando a /usuarios/me/
  | { tipo: "anonimo" }                                // sin sesión
  | { tipo: "autenticado"; usuario: Usuario | null };
```

---

## Tarea 1 — Protección de rutas privadas

En `App.tsx`, todo lo que está dentro de `<RutaPrivada />` exige sesión:

```tsx
<Route element={<SoloInvitados />}>
  <Route path="/login" element={<Login />} />
  <Route path="/registro" element={<Register />} />
</Route>

<Route element={<RutaPrivada />}>
  <Route path="/dashboard" element={<DashboardPage />} />
  <Route path="/home" element={<Homepage />} />
  <Route path="/perfil" element={<PerfilPage />} />
  <Route path="/configuracion" element={<ConfiguracionPage />} />
  <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />
</Route>
```

`RutaPrivada.tsx` decide qué mostrar según el estado:

```tsx
export function RutaPrivada() {
  const { estado, verificarSesion } = useAuth();
  const location = useLocation();

  // Si el token venció con la pestaña abierta, se detecta al cambiar de página.
  useEffect(() => { verificarSesion(); }, [location.pathname, verificarSesion]);

  if (estado.tipo === "verificando") return <PantallaVerificando />;
  if (estado.tipo === "anonimo") {
    return <Navigate to="/login" replace state={{ desde: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />; // la página pedida
}
```

- `replace`: el botón "atrás" no vuelve a la página protegida.
- `state.desde`: después del login, `destinoTrasLogin()` te devuelve a la página que querías abrir
  (solo rutas internas, nunca `//otro-sitio`).
- `SoloInvitados` hace lo inverso: con sesión, `/login` y `/registro` mandan al panel.

**"Sesión válida" no es solo tener un token:** también tiene que estar vigente. `auth.ts` lee la fecha
de vencimiento (`exp`) que viene dentro del JWT:

```ts
export function tokenExpirado(token: string, ahoraMs: number = Date.now()): boolean {
  const payload = decodificarPayloadJwt(token);
  if (!payload) return true;                          // no es un JWT → inválido
  if (typeof payload.exp !== "number") return false;  // sin exp → decide el backend
  return payload.exp * 1000 <= ahoraMs + MARGEN_EXPIRACION_MS; // margen de 10 s
}

export function haySesionValida(ahoraMs: number = Date.now()): boolean {
  const token = obtenerAccessToken();
  return token !== null && !tokenExpirado(token, ahoraMs + desfaseReloj());
}
```

No verifica la firma (eso lo hace el gateway); solo evita mostrar pantallas con un token que ya
sabemos vencido. `desfaseReloj()` corrige el reloj del PC si está desajustado: al iniciar sesión se
compara el `iat` del token (hora del servidor) con la hora local.

---

## Tarea 2 — Recuperar la sesión al recargar

Al cargar la página, `AuthContext.tsx` hace el *bootstrap*:

```tsx
useEffect(() => {
  if (!haySesionValida()) {
    logout();        // token vencido o basura: se limpia
    return;          // estado "anonimo" → RutaPrivada manda a /login
  }
  void cargarUsuario();   // GET /api/usuarios/me/
}, [cargarUsuario]);
```

`cargarUsuario()` decide según la respuesta:

```tsx
try {
  const usuario = await getUsuarioActual();
  if (id !== ultimaPeticion.current || estadoRef.current.tipo === "anonimo") return;
  cambiarEstado({ tipo: "autenticado", usuario });
} catch (err: unknown) {
  if (id !== ultimaPeticion.current || estadoRef.current.tipo === "anonimo") return;
  if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
    logout();
    cambiarEstado({ tipo: "anonimo" });                 // la sesión no sirve → /login
  } else {
    cambiarEstado({ tipo: "autenticado", usuario: null }); // red/500: no se echa al usuario
  }
}
```

| `/usuarios/me/` responde | Resultado |
|---|---|
| 200 | Entras y el sidebar muestra tu nombre y plan reales |
| 401 / 404 | Se borra la sesión y vas a `/login` |
| Error de red / 5xx | Sigues dentro y **se reintenta solo** hasta recuperar tus datos |
| 403 u otro 4xx | Sigues dentro, sin reintentar (reintentar no lo arregla) |

Mientras espera la respuesta se muestra el spinner "Verificando tu sesión", así no aparece por un
instante ni el login ni la página equivocada. El `id` / `ultimaPeticion` hace que solo cuente la última
petición: una respuesta vieja que llega tarde se ignora.

**Reintento sin pedir login (revisión CH-02).** Si `/usuarios/me/` falla por algo temporal (sin red,
timeout, 5xx), `cargarUsuario()` vuelve a intentar con esperas crecientes:

```tsx
export const ESPERAS_REINTENTO_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

// dentro del catch de cargarUsuario():
if (!esErrorTemporal(err) || intento >= ESPERAS_REINTENTO_MS.length) return;
await new Promise((resolver) => setTimeout(resolver, ESPERAS_REINTENTO_MS[intento]));
if (!vigente()) return;   // si cerraste sesión o hubo otra petición, se corta
```

Tras 5 reintentos (≈1 min) deja de insistir, y vuelve a probar apenas el navegador avisa que hay
conexión (evento `online`). Nunca te pide volver a iniciar sesión por esto.

**Token vencido mientras usas la app (401).** Antes `main.tsx` hacía
`window.location.href = "/login"`, que recargaba toda la app. Ahora lo maneja el contexto:

```tsx
configurarManejador401(() => {
  if (estadoRef.current.tipo === "anonimo") return;
  toast.info("Tu sesión expiró. Inicia sesión de nuevo.");
  quedarAnonimo();   // RutaPrivada redirige a /login sin recargar
});
```

Y `pedir()` en `cliente.ts` solo borra la sesión si el token rechazado sigue siendo el actual:

```ts
if (res.status === 401 && obtenerAccessToken() === token) {
  logout();
  manejadorNoAutorizado?.();
}
```

**Varias pestañas:** con el evento `storage` del navegador, si cierras sesión en una pestaña las demás
también salen, y si en otra pestaña entra otra cuenta, esta recarga el usuario.

---

## Tarea 3 — Cerrar sesión en la UI

El botón está en `Sidebar.tsx`, así que aparece en todas las páginas privadas:

Mientras el backend responde, el botón se deshabilita y dice "Cerrando sesión…" (un doble clic no
manda dos revocaciones). `AppLayout.tsx` le pasa la función que hace el trabajo:

```tsx
async function manejarCerrarSesion() {
  if (cerrandoSesion) return;
  setCerrandoSesion(true);
  const { revocada } = await cerrarSesion();   // revoca en el backend y borra los tokens
  if (revocada) {
    toast.info('Cerraste sesión.');
  } else {
    toast.error('Cerraste sesión en este equipo, pero no pudimos confirmarlo con el servidor.');
  }
  navigate('/login', { replace: true });       // "atrás" no vuelve al panel
}
```

**Revocación en el backend (revisión CH-03).** Borrar los tokens locales no invalida el refresh token
en el servidor (dura 7 días). Por eso `cerrarSesion()` primero llama a `revocarSesion()` de
`shared/src/auth.ts` y recién después borra los tokens:

```ts
// shared/src/auth.ts — POST /api/auth/logout/  { refresh_token }
const res = await fetch(`${apiUrl}${endpoints.logout}`, {
  method: "POST",
  headers,                                       // Authorization solo si el access sigue vigente
  body: JSON.stringify({ refresh_token: refresh }),
  signal: controlador.signal,                    // se corta a los 5 s
});
return res.ok;                                   // solo un 2xx confirma la revocación
```

| Respuesta del backend | Resultado |
|---|---|
| 2xx | Sesión revocada → toast "Cerraste sesión." |
| 401, 403, 404, 5xx, sin red o timeout (5 s) | Igual se cierra la sesión en este equipo, y se avisa con un error que el servidor no lo confirmó |

Un 401 **no** cuenta como revocada: no garantiza que el refresh token haya quedado invalidado (lo pudo
provocar, por ejemplo, un access token vencido). Por lo mismo, el access token solo se manda en
`Authorization` si sigue vigente; la sesión a revocar la identifica el `refresh_token` del body.

La sesión local se cierra **siempre**: quien aprieta "Cerrar sesión" (por ejemplo en un PC compartido)
tiene que quedar fuera aunque el servidor falle. `revocarSesion()` usa `fetch` directo y no `pedir()`,
para que un 401 no muestre "Tu sesión expiró".

> **Depende de MX-29 (Maximiliano).** El endpoint `POST /api/auth/logout/` todavía no existe en el
> backend (el gateway ya enruta `/api/auth/*` a auth). Hasta que MX-29 entre, cada logout mostrará el
> aviso de "no pudimos confirmarlo". Contrato propuesto: recibe `{ "refresh_token": "…" }`, lo agrega a
> la blacklist de SimpleJWT y responde 205/200. Debe identificar la sesión por ese refresh token y **no
> exigir un access token vigente** (si no, pasados 30 min ya no se podría revocar). Si el backend usa
> otra ruta se cambia con
> `configureAuthApi({ endpoints: { logout: "…" } })` en `main.tsx`.

Después de cerrar sesión, escribir `/dashboard` a mano o recargar te devuelve a `/login`, y las otras
pestañas también se cierran.

---

## Login

`Login.tsx` ya no guarda los tokens directo: pasa por el contexto para que la app sepa al instante que
hay sesión.

```tsx
const { access_token, refresh_token } = await login({ correo, password });
iniciarSesion({ access_token, refresh_token });           // valida y guarda
navigate(destinoTrasLogin(location), { replace: true });  // vuelve a la página pedida
```

Si el servidor devolviera un token inválido, `iniciarSesion()` lanza un error y Login muestra
"No se pudo iniciar sesión" en vez de dejarte entrar.

---

## Tests

**shared:** 43 ✅ · **web:** 32 ✅

| Archivo | Tests | Qué cubre |
|---|---|---|
| `web/src/components/RutaPrivada.test.tsx` | 26 | Las 3 tareas: redirecciones, recarga, reintentos de `/usuarios/me/`, login, logout con revocación, pestañas, respuestas tardías |
| `shared/src/auth.test.ts` | 21 | Token vigente / vencido / inválido, desfase de reloj y `revocarSesion()` (solo 2xx confirma; 401/403/404/5xx, sin red y timeout no) |
| `shared/src/api/cliente.test.ts` | 7 | Interceptor 401 (+1: un token viejo no borra la sesión nueva) |
| `web/src/context/ToastContext.test.tsx` | 6 | Avisos (antes el archivo estaba vacío) |

Se comprobó que los tests sirven: al romper a propósito cada parte del código, siempre falló al menos
un test.

## Cómo probarlo

```bash
npm ci && npm run typecheck && npm test && npm run build
```

Manual (`npm run dev`): sin sesión, abrir `/perfil` → `/login`; iniciar sesión → vuelve a `/perfil`;
recargar → sigue con sesión y muestra tu nombre; "Cerrar sesión" → `/login`.

## Pendientes

- **MX-29:** coordinar con Maximiliano el endpoint `POST /api/auth/logout/` (ver Tarea 3). Con eso la
  tarea CH-03 queda completa sin cambios en el frontend.
- **Refresh token:** aún no se usa; al vencer el access token (30 min) se cierra la sesión.
- **Móvil:** `haySesionValida()` ya está en `shared`; falta integrar la navegación y SecureStore.
- **Fuera de esta PR:** el merge `2a390ee` en `main` deshizo las PRs #53–#55 (el `kubeconfig` ya se
  borró en `91e3030`); restaurarlas corresponde a una PR propia sobre `main`.
