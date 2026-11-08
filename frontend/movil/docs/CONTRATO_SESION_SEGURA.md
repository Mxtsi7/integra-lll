# Contrato de Integración: Almacenamiento Seguro y Sesión Móvil (SE-08)

**Responsable:** Sebastian Mena  
**Estado:** IMPLEMENTADO / VERIFICADO  
**Dependencias:** `expo-secure-store`, `@ojoalgasto/shared` (`configurarTokenStorage`, `guardarTokens`, `limpiarTokens`, `haySesionValida`, `obtenerAccessToken`, `obtenerRefreshToken`, `configurarManejador401`).  
**Tareas Desbloqueadas:** SE-10 (Conectar Login móvil con Auth), SE-15 (Dashboard), SE-16 (Listado suscripciones), SE-19 (Nueva suscripción), SE-23 (Detalle suscripción), AN-03, AN-19.

---

## 1. Resumen y Propósito

El módulo de almacenamiento seguro móvil (`src/services/storageSeguro.ts`) implementa la persistencia cifrada de credenciales y tokens JWT para la aplicación móvil Expo / React Native, resolviendo la discrepancia entre:
1. La API síncrona de almacenamiento de tokens requerida por `@ojoalgasto/shared` (`TokenStorage`).
2. La API asíncrona obligatoria de `expo-secure-store` (Keychain en iOS, EncryptedSharedPreferences / KeyStore en Android).

**Garantías clave:**
- **Cero lectura de `localStorage`:** Los navegadores web usan `window.localStorage`; en móvil nunca se invoca ni se asume su existencia.
- **Sin exposición de secretos en el build:** Los tokens no viajan en variables públicas, se almacenan exclusivamente en el enclave cifrado del hardware del dispositivo.
- **Sin parpadeo de rutas (No flash of unauthenticated content):** Hidratación asíncrona atómica durante el arranque (bootstrap) antes de montar las rutas privadas o públicas.
- **Limpieza coherente en cascada:** Logout manual o respuesta 401 del servidor purgan atómicamente la memoria RAM y el almacenamiento seguro de disco.

---

## 2. Arquitectura de Adaptación: Memoria Síncrona + Persistencia Asíncrona

```
 +-------------------------------------------------------------------+
 |                      Aplicación Móvil (React Native)              |
 +-------------------------------------------------------------------+
             |                                          |
             | Lee / Escribe síncrono                   | Hidrata / Purga asíncrono
             v                                          v
 +---------------------------+              +------------------------+
 |   Caché Síncrona en RAM   | <=========== |   expo-secure-store    |
 |  (TokenStorage de shared) |  Hidratación |  (Keychain / KeyStore) |
 +---------------------------+  al arrancar +------------------------+
             |                                          ^
             | Replicación en segundo plano             |
             +------------------------------------------+
```

### El Adaptador Síncrono (`adaptadorStorageSincrono`)
Satisface la interfaz `TokenStorage` de `@ojoalgasto/shared`:
```typescript
interface TokenStorage {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}
```
1. Al invocar `getItem`, devuelve inmediatamente el valor desde la memoria RAM.
2. Al invocar `setItem`, actualiza la memoria RAM de inmediato y despacha asíncronamente `SecureStore.setItemAsync`.
3. Al invocar `removeItem`, borra la clave de la memoria RAM de inmediato y despacha asíncronamente `SecureStore.deleteItemAsync`.

---

## 3. Claves de Persistencia Segura

Las constantes exportadas en `CLAVES_SEGURAS` definen las claves canónicas:

| Constante | Clave en SecureStore | Descripción |
|---|---|---|
| `CLAVES_SEGURAS.ACCESS_TOKEN` | `'access_token'` | Token JWT de acceso para peticiones autorizadas (`Bearer <token>`). |
| `CLAVES_SEGURAS.REFRESH_TOKEN` | `'refresh_token'` | Token de refresco de larga duración para renovar credenciales. |
| `CLAVES_SEGURAS.DESFASE_RELOJ` | `'desfase_reloj_ms'` | Desfase temporal calculado con el servidor para evaluar expiración de JWT. |

---

## 4. Ciclo de Vida de la Sesión y Estados de Autenticación

El estado del contexto de autenticación (`AuthContext.tsx`) gobierna la navegación reactiva en `RootNavigator`:

```
                 +-------------------+
                 |     cargando      |  <-- Pantalla de carga / Splash
                 +-------------------+
                   /               \
 (tokens válidos) /                 \ (sin tokens o expirado)
                 v                   v
        +-----------------+    +-----------------+
        |   autenticado   |    |     anonimo     |
        |  (Tabs/Stacks)  |    |  (Login/Público)|
        +-----------------+    +-----------------+
             |        ^             |
             | logout | login(SE-10)|
             v        |             |
        +-----------------+         |
        |     anonimo     | <-------+
        +-----------------+
```

### A. Inicialización Temprana en `App.tsx`
Antes de renderizar cualquier pantalla, se inicializa el adaptador en `App.tsx`:
```tsx
import { inicializarStorageSeguro } from './src/services/storageSeguro';
import { configurarClienteHttp } from './src/services/clienteHttp';

// 1. Configurar Gateway unificado
configurarClienteHttp();

// 2. Conectar adaptador seguro a @ojoalgasto/shared
inicializarStorageSeguro();
```

### B. Hidratación en Arranque (`verificarSesionInicial`)
Al montar `AuthProvider`:
1. El estado inicial es `'cargando'` (evita redirigir a Login o a Home antes de tiempo).
2. Se ejecuta `await hidratarSesionSegura()`:
   - Lee concurrentemente `access_token`, `refresh_token` y `desfase_reloj_ms` desde `SecureStore`.
   - Carga los valores en la memoria RAM del adaptador.
3. Se evalúa `haySesionValida()`:
   - **Válida (no expirada):** Transiciona a `'autenticado'`. Dispara la carga no bloqueante del perfil en segundo plano (`/usuarios/me/`).
   - **Inválida o expirada:** Ejecuta `await limpiarSesionSegura()` para purgar tokens viejos de `SecureStore` y transiciona a `'anonimo'`.

### C. Inicio de Sesión (`iniciarSesion`)
Invocado tras un login exitoso (ej. en SE-10):
```tsx
await iniciarSesion({ access_token, refresh_token });
```
1. Invoca `await guardarTokensSeguros(tokens)`.
2. Persiste atómicamente en memoria y `SecureStore`.
3. Actualiza el estado reactivo a `'autenticado'` y consulta `/usuarios/me/`.

### D. Cierre de Sesión y Manejador 401
Invocado por logout manual o por el interceptor 401 global de `@ojoalgasto/shared`:
```tsx
await cerrarSesion();
```
1. Notifica al backend vía `logout()` (`/api/auth/logout/`).
2. Ejecuta `await limpiarSesionSegura()`:
   - Vacía la memoria síncrona.
   - Elimina `access_token`, `refresh_token` y `desfase_reloj_ms` de `SecureStore`.
3. Resetea `usuario` a `null` y conmuta el estado a `'anonimo'`.
4. El `RootNavigator` desmonta inmediatamente las rutas privadas y monta el flujo público de acceso.

---

## 5. Guía de Integración para Otras Fichas

### Para SE-10: Conectar Login móvil con Auth
Al procesar el formulario de inicio de sesión:
```tsx
import { useAuth } from '../context/AuthContext';
import { login } from '@ojoalgasto/shared';

const { iniciarSesion } = useAuth();

const onSubmit = async () => {
  try {
    const credenciales = { email: correo.trim(), password: clave };
    const tokens = await login(credenciales);
    await iniciarSesion(tokens);
    // RootNavigator cambiará automáticamente de Login a MainTabs
  } catch (err) {
    // Manejar AuthError con errores de dominio
  }
};
```

### Para SE-15, SE-16, SE-19, SE-23: Peticiones Protegidas
Todas las llamadas a funciones de `@ojoalgasto/shared` (`getSuscripciones()`, `crearSuscripcion()`, etc.) automáticamente:
- Inyectan el encabezado `Authorization: Bearer <access_token>` obtenido de la memoria síncrona.
- En caso de recibir un `401 Unauthorized`, disparan el `configurarManejador401` que invoca `limpiarSesionSegura()` y redirige al usuario a la pantalla de Login sin fugas de datos.

---

## 6. Verificación y Pruebas Automatizadas

| Archivo de Prueba | Casos Cubiertos | Estado |
|---|---|---|
| `src/services/storageSeguro.test.ts` | 7 pruebas: inicialización de adaptador, hidratación asíncrona, guardado de tokens, eliminación segura, sincronización memoria-SecureStore. | APROBADO (7/7) |
| `context/AuthContext.test.tsx` | 13 pruebas: bootstrap con tokens válidos, purga de tokens expirados en SecureStore, revocación remota y local, protección ante race conditions en `/me`, interceptor 401. | APROBADO (13/13) |
| `src/navigation/navigation.test.tsx` | 14 pruebas: transición reactiva login -> pestañas privadas -> logout -> pantalla pública. | APROBADO (14/14) |
