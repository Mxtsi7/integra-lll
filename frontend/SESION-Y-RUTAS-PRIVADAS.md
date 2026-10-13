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
| 1 y 2 | [shared/src/auth.ts](shared/src/auth.ts) | `haySesionValida()`: ¿hay token y no está vencido? |
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
| Error de red / 500 | Sigues dentro: el problema es del servidor, no de tu sesión |

Mientras espera la respuesta se muestra el spinner "Verificando tu sesión", así no aparece por un
instante ni el login ni la página equivocada. El `id` / `ultimaPeticion` hace que solo cuente la última
petición: una respuesta vieja que llega tarde se ignora.

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

```tsx
<button type="button" className={styles.cerrarSesion} onClick={alCerrarSesion}>
  <LogOut size={16} aria-hidden="true" />
  Cerrar sesión
</button>
```

`AppLayout.tsx` le pasa la función que hace el trabajo:

```tsx
function manejarCerrarSesion() {
  cerrarSesion();                          // borra los tokens y pasa a "anonimo"
  toast.info('Cerraste sesión.');
  navigate('/login', { replace: true });   // "atrás" no vuelve al panel
}
```

El backend no tiene endpoint de logout, así que cerrar sesión es borrar los tokens locales con
`logout()` de `shared/src/auth.ts`. Después de eso, escribir `/dashboard` a mano o recargar te devuelve
a `/login`, y las otras pestañas también se cierran.

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

**shared:** 34 ✅ · **web:** 24 ✅

| Archivo | Tests | Qué cubre |
|---|---|---|
| `web/src/components/RutaPrivada.test.tsx` | 18 | Las 3 tareas: redirecciones, recarga, login, logout, pestañas, respuestas tardías |
| `shared/src/auth.test.ts` | 12 | Token vigente / vencido / inválido y desfase de reloj |
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

- **Refresh token:** aún no se usa; al vencer el access token (30 min) se cierra la sesión.
- **Móvil:** `haySesionValida()` ya está en `shared`; falta integrar la navegación y SecureStore.
- **Fuera de esta PR:** el merge `2a390ee` en `main` deshizo las PRs #53–#55 y volvió a subir
  `estudiantes-maximiliano.saez.kubeconfig`; se arregla con una PR propia sobre `main`.
