# Contrato de Integración: Conectar Login móvil con Auth (SE-10)

**Responsable:** Sebastian Mena  
**Tipo:** CÓDIGO · **Prioridad:** P0  
**Estado:** IMPLEMENTADO / VERIFICADO  
**Dependencias Previas:** SE-07 (Cliente HTTP por entorno), SE-08 (Almacenamiento seguro y sesión móvil), SE-09 (Pantalla móvil Iniciar sesión).  
**Tareas Desbloqueadas:** SE-15 (Dashboard), SE-16 (Listado suscripciones), SE-19 (Nueva suscripción), SE-21 (Detalle suscripción), SE-23 (Creación suscripción), AN-03 (Perfil), AN-19 (Métricas).

---

## 1. Resumen y Propósito

La tarjeta **SE-10** conecta de extremo a extremo la pantalla de acceso móvil (`LoginScreen.tsx` / `LoginForm`) con el servicio de autenticación compartido (`@ojoalgasto/shared`), el cliente HTTP móvil (`clienteHttp.ts`) y el almacenamiento seguro nativo (`storageSeguro.ts`).

### Flujo Completo de Autenticación

```
 +---------------------------------------------------------------------------------+
 | Usuario ingresa credenciales en LoginScreen (correo / password)                 |
 +---------------------------------------------------------------------------------+
                                         |
                                         v
 +---------------------------------------------------------------------------------+
 | login({ correo, password }) en @ojoalgasto/shared                               |
 | (Traduce automáticamente a payload HTTP DRF: { email: correo, password })       |
 +---------------------------------------------------------------------------------+
                  /                                              \
    (Éxito: 200 OK)                                       (Error HTTP / Red)
                 v                                                v
 +-----------------------------------------------+   +-----------------------------+
 | AuthResponse:                                 |   | Distinción estricta:        |
 | - access_token                                |   | 1. 401 Credenciales:        |
 | - refresh_token                               |   |    "Usuario o contraseña    |
 | - usuario { id, nombre, correo }              |   |    inválidos"               |
 +-----------------------------------------------+   | 2. Error de Red:            |
                 |                                   |    "No se pudo conectar con |
                 v                                   |    el servidor..."          |
 +-----------------------------------------------+   +-----------------------------+
 | iniciarSesion(tokens) en AuthContext:         |
 | 1. Persiste AMBOS tokens en SecureStore y RAM |
 | 2. Conmuta reactivamente a 'autenticado'      |
 | 3. RootNavigator desmonta Login y monta Home  |
 | 4. Dispara /usuarios/me/ con Bearer token     |
 | 5. Reconstruye Usuario completo (rol/plan/org)|
 +-----------------------------------------------+
```

---

## 2. Consumo y Traducción de Credenciales

En [`LoginScreen.tsx`](src/screens/auth/LoginScreen.tsx):
```typescript
import { login, AuthError } from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { esErrorDeRed, adaptarErrorRed } from '../../services/clienteHttp';

const handleLogin = async (credenciales: { correo: string; password: string }) => {
  if (loading) return;

  setLoading(true);
  setError(null);

  try {
    // 1. Invoca login() de shared traduciendo 'correo' al contrato backend 'email'
    const res = await login({
      correo: credenciales.correo,
      password: credenciales.password,
    });

    // 2. Inicia sesión persistiendo ambos tokens de forma segura
    iniciarSesion({
      access_token: res.access_token,
      refresh_token: res.refresh_token,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError && err.status === 401) {
      setError('Usuario o contraseña inválidos');
    } else if (err instanceof AuthError) {
      setError(err.message);
    } else if (esErrorDeRed(err)) {
      setError(
        adaptarErrorRed(err) ??
          'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.'
      );
    } else {
      setError('No se pudo iniciar sesión. Intenta de nuevo.');
    }
  } finally {
    setLoading(false);
  }
};
```

---

## 3. Matriz de Errores y Distinción Estricta (Criterio 1)

El sistema garantiza que **errores de credenciales** y **errores de red/conexión** entregan mensajes claramente distintos y mutuamente excluyentes:

| Tipo de Error | Condición Técnica | Mensaje Renderizado en Pantalla | Comportamiento |
|---|---|---|---|
| **Credenciales Incorrectas** | `err instanceof AuthError && err.status === 401` | `"Usuario o contraseña inválidos"` | Permanece en Login. No persiste ningún token. Limpia el error automáticamente al volver a tipear. |
| **Error de Conexión / Transporte** | `esErrorDeRed(err)` (`TypeError: Network request failed`, timeout, offline) | `"No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo."` | Permanece en Login. No persiste tokens. Permite reintentar de inmediato pulsando el botón al volver la señal. |
| **Validación de Campos Vacíos** | Validación previa en cliente en `LoginForm` | `"Ingresa tu correo electrónico."`<br>`"Ingresa tu contraseña."` | Bloquea la petición HTTP y señala el campo requerido sin salto de layout. |
| **Otros Errores de Servidor** | `AuthError` (400, 403, 500) | `err.message` provisto por DRF | Muestra el detalle específico entregado por el backend. |

---

## 4. Persistencia de Tokens y Reconstrucción del Usuario (Criterio 2)

### A. Persistencia Atómica de Ambos Tokens
Al llamar `iniciarSesion({ access_token, refresh_token })`:
1. `guardarTokensSeguros(tokens)` almacena simultáneamente:
   - `CLAVES_SEGURAS.ACCESS_TOKEN` (`'access_token'`) en hardware seguro nativo (`SecureStore`) y memoria RAM.
   - `CLAVES_SEGURAS.REFRESH_TOKEN` (`'refresh_token'`) en hardware seguro nativo (`SecureStore`) y memoria RAM.
   - `CLAVES_SEGURAS.DESFASE_RELOJ` (`'desfase_reloj_ms'`) para verificar vigencia sin asumir sincronía perfecta con el reloj del teléfono.
2. Cero invocaciones a `window.localStorage`.

### B. Navegación Reactiva sin Salto
1. El estado conmuta inmediatamente a `'autenticado'`.
2. `RootNavigator` evalúa reactivamente `estado === 'autenticado'` y desmonta la pantalla pública `Login`, montando el contenedor principal de pestañas (`MainTabs`: Home, Panel, Calendario, Configuración).

### C. Reconstrucción Completa del Usuario
1. De manera coordinada y no bloqueante, `cargarPerfil(idSesion)` invoca `getUsuarioActual()`.
2. El cliente inyecta automáticamente el encabezado:
   `Authorization: Bearer <access_token>`
3. El endpoint `/api/usuarios/me/` responde con la entidad completa:
   ```json
   {
     "id": "usr-10",
     "nombre": "Sebastian Mena",
     "correo": "sebastian.mena@ojoalgasto.cl",
     "rol": "titular",
     "organizacion_id": "org-seba-10",
     "plan": "premium"
   }
   ```
4. `setUsuario(u)` hidrata el contexto, dejando disponibles el rol (`titular` o `integrante`), el `plan` y la `organizacion_id` para todas las pantallas privadas.

---

## 5. Guía de Uso para Tarjetas Desbloqueadas

### Para SE-15 (Dashboard) y SE-16 (Listado Suscripciones)
Las pantallas autenticadas pueden consumir directamente la API o los datos de sesión:
```tsx
import { useAuth } from '../../context/AuthContext';
import { getSuscripciones } from '@ojoalgasto/shared';

export function SuscripcionesScreen() {
  const { usuario } = useAuth();

  useEffect(() => {
    async function cargar() {
      // Tokens Bearer se inyectan automáticamente desde storageSeguro
      const datos = await getSuscripciones();
      // Si el token expira o es revocado (401), el interceptor conmuta a anonimo
    }
    cargar();
  }, []);
}
```

---

## 6. Verificación y Pruebas Automatizadas

| Archivo de Prueba | Pruebas | Aspectos Validados | Estado |
|---|---|---|---|
| [`src/screens/auth/LoginAuth.test.tsx`](src/screens/auth/LoginAuth.test.tsx) | 6 | - Distinción de 401 ("Usuario o contraseña inválidos") vs error de red.<br>- Error de conexión física (`Network request failed`) con mensaje de red.<br>- Mutua exclusión de mensajes.<br>- Traducción de payload `correo` -> `email`.<br>- Persistencia de AMBOS tokens en `SecureStore` y RAM.<br>- Reconstrucción de usuario desde `/usuarios/me/` con `Bearer` token y navegación reactiva a Home. | APROBADO (6/6) |
| [`src/navigation/navigation.test.tsx`](src/navigation/navigation.test.tsx) | 14 | Flujo público, validación cliente, 401, login exitoso con conmutación a Home y logout reactivo. | APROBADO (14/14) |
| [`context/AuthContext.test.tsx`](context/AuthContext.test.tsx) | 13 | Hidratación bootstrap, reinicio de sesión, purga de tokens expirados, perfil y 401 interceptor. | APROBADO (13/13) |
| [`src/screens/auth/LoginScreen.test.tsx`](src/screens/auth/LoginScreen.test.tsx) | 12 | Maqueta, a11y, usabilidad con teclado abierto y prevención de doble submit. | APROBADO (12/12) |
| **Suite Total Móvil** | **70** | Suite completa móvil ejecutada y aprobada al 100%. | **APROBADO (70/70)** |
| **Typecheck TypeScript** | - | `npm run typecheck` en todos los workspaces (`shared`, `web`, `movil`). | **0 ERRORES** |
