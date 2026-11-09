# Flujo de Inicio de Sesión Móvil (Especificación Técnica Detallada)

Este documento detalla con **máxima precisión técnica** el recorrido completo del inicio de sesión en la aplicación móvil:
`Formulario Móvil` ➔ `Cliente Compartido` ➔ `Backend Auth Valida` ➔ `Devuelve Tokens` ➔ `App Consulta Perfil y Abre Navegación Privada`.

---

## 🧭 Resumen de Funciones Relevantes y Puntos de Entrada de Datos

| Etapa | Archivo / Capa | Función / Componente Relevante | Dónde y qué datos recibe | Qué hace / Por qué es relevante |
| :--- | :--- | :--- | :--- | :--- |
| **1. UI** | `LoginScreen.tsx` | `handleFormSubmit()` y `handleLogin()` | Recibe strings de los inputs: `correoValue` y `passwordValue`. | Valida sintaxis localmente y despacha la petición asíncrona. |
| **2. Red** | `shared/src/auth.ts` | `login(payload)` y `postJSON()` | Recibe `{ correo, password }` en `LoginPayload`. | Construye el cuerpo JSON `{ email, password }` y hace `fetch` al Gateway. |
| **3. Backend** | `services/auth` | Endpoint `POST /api/auth/login/` | Recibe JSON `{ email, password }`. | Comprueba hash PBKDF2 en Postgres, genera JWTs y guarda versión en Redis. |
| **4. Preval.** | `storageSeguro.ts` | `validarFormatoToken(token)` | Recibe `tokens.access_token` como string. | Valida 3 partes JWT y `exp > iat` sin sesgo de reloj del teléfono. |
| **5. Persist.** | `storageSeguro.ts` | `guardarTokensSeguros(tokens)` | Recibe `{ access_token, refresh_token }`. | Escribe en RAM, calcula desfase de reloj y persiste atómicamente en hardware (`SecureStore`). |
| **6. Contexto** | `AuthContext.tsx` | `iniciarSesion(tokens, usuario?)` | Recibe los tokens del backend y usuario opcional. | Coordina prevalidación, hardware, rollback y cambio de estado a `'autenticado'`. |
| **7. Perfil** | `AuthContext.tsx` | `cargarPerfil(idSesion)` | Recibe `idSesion: number` (generación). | Invoca `getUsuarioActual()`, inyecta el `Usuario` real y previene *race conditions*. |
| **8. Nav.** | `RootNavigator.tsx` | `<RootNavigator />` | Lee `haySesion` desde `useAuth()`. | Render condicional: desmonta `AuthNavigator` y monta `AppTabNavigator`. |

---

## 🔎 Recorrido Detallado con Código Relevante

---

### Paso 1: Formulario Móvil y Captura de Entradas
* **Archivo:** [`frontend/movil/src/screens/auth/LoginScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/auth/LoginScreen.tsx)
* **Funciones clave:** `handleFormSubmit` (líneas 87–103) y `handleLogin` (líneas 252–279).

#### ¿Dónde se reciben los datos?
En el componente `LoginForm`, el usuario escribe en los `TextInput`. Las funciones `setInternalCorreo` y `setInternalPassword` almacenan los datos en el estado local de React.

#### Código Relevante:
```tsx
// frontend/movil/src/screens/auth/LoginScreen.tsx (Líneas 87-103)
const handleFormSubmit = () => {
  if (isBloqueado) return;

  if (!correoValue.trim()) {
    setInternalError('Ingresa tu correo electrónico.');
    return;
  }
  if (!passwordValue) {
    setInternalError('Ingresa tu contraseña.');
    return;
  }

  setInternalError(null);
  if (onSubmit) {
    // Pasa los datos limpios al manejador del contenedor
    onSubmit({ correo: correoValue.trim(), password: passwordValue });
  }
};
```

En el contenedor conectado al contexto (`LoginScreen`):
```tsx
// frontend/movil/src/screens/auth/LoginScreen.tsx (Líneas 252-261)
const handleLogin = async (credenciales: { correo: string; password: string }) => {
  if (loading) return;
  setLoading(true);
  setError(null);

  try {
    // 1. Envía credenciales al cliente compartido
    const res = await login({ correo: credenciales.correo, password: credenciales.password });
    // 2. Entrega los tokens al contexto de autenticación
    await iniciarSesion({ access_token: res.access_token, refresh_token: res.refresh_token });
  } catch (err: unknown) {
    // Mapeo exhaustivo de errores (401 credenciales vs sin red)
    ...
  } finally {
    setLoading(false);
  }
};
```

---

### Paso 2: Cliente Compartido y Despacho HTTP
* **Archivo:** [`frontend/shared/src/auth.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/auth.ts)
* **Función clave:** `login(payload: LoginPayload)` (líneas 123–128).

#### ¿Dónde se reciben los datos?
`login()` recibe el objeto `{ correo, password }` con tipado estricto `LoginPayload`.

#### Código Relevante:
```typescript
// frontend/shared/src/auth.ts (Líneas 123-128)
export function login(payload: LoginPayload): Promise<AuthResponse> {
  return postJSON<AuthResponse>(endpoints.login, {
    email: payload.correo,      // Traduce 'correo' al campo 'email' que espera Django
    password: payload.password,
  });
}
```
* `postJSON` despacha la petición POST a `${apiUrl}/auth/login/` (por defecto `http://10.0.2.2:8000/api/auth/login/` en emulador Android o la IP LAN configurada).

---

### Paso 3: Validación y Generación de Tokens en Backend
* **Servicio:** `gateway` (:8000) y `services/auth` (:8001).
* **Algoritmo de Clave:** `PBKDF2Configurable` (100.000 iteraciones con HMAC-SHA256).

#### ¿Dónde se reciben los datos?
El endpoint Django REST Framework `/api/auth/login/` recibe el JSON `{ "email": "...", "password": "..." }`.

#### Qué ocurre en el servidor:
1. Consulta `User.objects.filter(email=email).first()`.
2. Ejecuta `user.check_password(password)` validando contra el hash `pbkdf2_sha256$...` almacenado en PostgreSQL.
3. Si es válido:
   - Firma el **Access Token** con `JWT_SECRET` (algoritmo `HS256`, 30 min) inyectando los claims:
     ```json
     {
       "user_id": 1,
       "organizacion_id": "org-1",
       "rol": "titular",
       "session_version": "hash-sesion-vigente",
       "iat": 1730590000,
       "exp": 1730591800
     }
     ```
   - Emite el **Refresh Token** (7 días).
   - Publica `session_version` en **Redis** (`SESSION_REDIS_URL`).
4. Retorna el payload `AuthResponse` (`200 OK`).

---

### Paso 4: Prevalidación Estructural del Token
* **Archivo:** [`frontend/movil/src/services/storageSeguro.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/services/storageSeguro.ts)
* **Función clave:** `validarFormatoToken(token: string)` (líneas 448–461).

#### ¿Dónde se reciben los datos?
Llamado en el Paso 1 de `iniciarSesion` recibiendo `tokens.access_token`.

#### Código Relevante:
```typescript
// frontend/movil/src/services/storageSeguro.ts (Líneas 448-461)
export function validarFormatoToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;

  const payload = decodificarPayloadJwt(token);
  if (!payload) return false;

  // Comprueba coherencia intrínseca: la expiración debe ser posterior a la emisión
  if (typeof payload.exp === 'number' && typeof payload.iat === 'number') {
    if (payload.exp <= payload.iat) {
      return false;
    }
  }
  return true;
}
```
> **Por qué es relevante:** No compara contra `Date.now()` del celular. Si el teléfono tiene el reloj adelantado 40 minutos, no rechaza falsamente un token recién emitido.

---

### Paso 5: Persistencia Segura y Desfase de Reloj
* **Archivo:** [`frontend/movil/src/services/storageSeguro.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/services/storageSeguro.ts) y [`frontend/shared/src/auth.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/auth.ts).
* **Funciones clave:** `guardarTokensSeguros(tokens)` y `guardarDesfaseReloj(accessToken)`.

#### ¿Dónde se reciben los datos?
`guardarTokensSeguros` recibe el objeto `{ access_token, refresh_token }`.

#### Código Relevante:
```typescript
// frontend/movil/src/services/storageSeguro.ts (Líneas 307-354)
export async function guardarTokensSeguros(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  if (!storageInicializado) inicializarStorageSeguro();

  // Incrementa la generación para aislar operaciones concurrentes
  const gen = ++generacionActual;
  promesasPorGeneracion.set(gen, []);

  try {
    // 1. Guarda en memoria RAM y calcula desfase_reloj_ms en shared
    guardarTokens(tokens);

    // 2. Borra marca de limpiezas pendientes previas
    encolarDelete(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE, gen);

    // 3. Espera a que el chip físico (SecureStore) confirme la escritura de todas las claves
    const promesas = promesasPorGeneracion.get(gen) ?? [];
    await Promise.all(promesas);
  } catch (err) {
    // Rollback atómico: si el guardado falla y esta operación sigue vigente, purga la RAM y el chip
    if (gen === generacionActual) {
      cacheMemoria = {};
      logout();
      ...
    }
    throw new Error(`Fallo al persistir tokens en almacenamiento seguro: ...`);
  }
}
```

En `@ojoalgasto/shared/src/auth.ts`, `guardarTokens` calcula el desfase:
```typescript
function guardarDesfaseReloj(accessToken: string) {
  const payload = decodificarPayloadJwt(accessToken);
  if (payload && typeof payload.iat === "number") {
    // Diferencia entre la hora del servidor y la hora de este teléfono
    storage.setItem(DESFASE_RELOJ_KEY, String(payload.iat * 1000 - Date.now()));
  }
}
```

---

### Paso 6: Orquestación de Sesión en Contexto
* **Archivo:** [`frontend/movil/context/AuthContext.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/context/AuthContext.tsx)
* **Función clave:** `iniciarSesion(tokens, u?)` (líneas 153–221).

#### ¿Dónde se reciben los datos?
Recibe `tokens: Tokens` y `u?: Usuario` pasados desde `LoginScreen.tsx`.

#### Código Relevante:
```tsx
// frontend/movil/context/AuthContext.tsx (Líneas 153-221)
const iniciarSesion = useCallback(
  async (tokens: Tokens, u?: Usuario) => {
    // 0. Identificador de generación para cancelar respuestas lentas desfasadas
    const idSesion = ++sesionVigente.current;
    ultimaPeticion.current++;
    const esVigente = () => idSesion === sesionVigente.current;

    // 1. Prevalidación de formato
    if (!tokens.access_token || !validarFormatoToken(tokens.access_token)) {
      throw new Error('Token inválido o expirado');
    }

    // 2. Persistencia segura en hardware
    await guardarTokensSeguros(tokens);
    if (!esVigente()) return; // Aborta si durante la espera se inició otra sesión

    // 3. Validación de vigencia ajustada por desfase
    if (!haySesionValida()) {
      try { await limpiarSesionSegura(); } catch {}
      throw new Error('Token inválido o expirado');
    }
    if (!esVigente()) return;

    // 4. Conmuta el estado público a autenticado
    setEstado('autenticado');

    // 5. Carga del perfil del usuario (SE-10)
    if (u) {
      setUsuario(u);
      setEstadoPerfil('cargado');
    } else {
      setUsuario(null);
      void cargarPerfil(idSesion);
    }
  },
  [cargarPerfil]
);
```

---

### Paso 7: Carga del Perfil Real (SE-10)
* **Archivo:** [`frontend/movil/context/AuthContext.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/context/AuthContext.tsx)
* **Función clave:** `cargarPerfil(idSesion: number)` (líneas 65–98).

#### ¿Dónde se reciben los datos?
Invoca `getUsuarioActual()` de `@ojoalgasto/shared`. Esta hace `GET /api/usuarios/yo/` enviando `Authorization: Bearer <access_token>`.

#### Código Relevante:
```tsx
// frontend/movil/context/AuthContext.tsx (Líneas 65-80)
const cargarPerfil = useCallback(async (idSesion: number) => {
  const idPeticion = ++ultimaPeticion.current;
  const esVigente = () =>
    idSesion === sesionVigente.current && idPeticion === ultimaPeticion.current;

  setEstadoPerfil('cargando');
  setErrorPerfil(null);

  try {
    // Petición real al backend: obtiene { id, nombre, correo, rol, plan, organizacion_id }
    const u = await getUsuarioActual();
    if (!esVigente()) return;

    // Inyecta el usuario real en el estado global
    setUsuario(u);
    setEstadoPerfil('cargado');
    setErrorPerfil(null);
  } catch (err: unknown) {
    if (!esVigente()) return;
    // Si el token fue revocado en backend (401), cierra la sesión limpiamente
    if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
      void limpiarSesionSegura().catch(() => {});
      setUsuario(null);
      setEstado('anonimo');
    }
  }
}, []);
```

---

### Paso 8: Apertura de la Navegación Privada (SE-06)
* **Archivo:** [`frontend/movil/src/navigation/RootNavigator.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/navigation/RootNavigator.tsx)
* **Componente clave:** `<RootNavigator />` (líneas 11–32).

#### ¿Dónde se reciben los datos?
`RootNavigator` se suscribe a los cambios reactivos de `useAuth()`:
```tsx
const { estado, haySesion } = useAuth();
```

#### Código Relevante:
```tsx
// frontend/movil/src/navigation/RootNavigator.tsx (Líneas 23-31)
return (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    {!haySesion ? (
      // Si haySesion es false: se monta la pila pública (Login, Registro)
      <Stack.Screen name="Auth" component={AuthNavigator} />
    ) : (
      // Apenas haySesion pasa a true: se desmonta Auth y se monta AppTabNavigator
      <Stack.Screen name="App" component={AppTabNavigator} />
    )}
  </Stack.Navigator>
);
```

#### ¿Por qué es relevante esta parte del código?
1. **Inmutabilidad de retroceso:** Al no usar `navigation.navigate('Home')`, sino un renderizado condicional de pantallas en el `Stack.Navigator`, la pila de `AuthNavigator` **deja de existir en memoria**.
2. El usuario no puede presionar la flecha de "Atrás" de Android para volver al formulario de login una vez autenticado.
3. Se montan directamente las 4 pestañas de la app privada: **Home**, **Panel**, **Calendario** y **Configuración**.
