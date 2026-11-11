# Contrato de Integración y Evidencia: SE-16

**Tarjeta:** SE-16: Volver a Login cuando la sesión móvil no sea válida  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P0  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** SE-08 (Almacenamiento seguro y sesión móvil), MX-10 (Completar refresh, rotación y revocación de tokens)  

---

## 1. Resumen de Implementación (SE-16)

- **Tratamiento 401 con refresh controlado:** La función `pedir()` en `@ojoalgasto/shared` detecta respuestas HTTP 401. Si existe un refresh token, ejecuta `renovarSesion()` una única vez de forma síncrona/deduplicada. Si el refresh es exitoso (HTTP 200 con nuevos tokens), actualiza el almacenamiento y reintenta la petición original con el nuevo token Bearer sin alterar la UI ni cerrar sesión.
- **Detección de sesión inválida y retorno a Login:** Si el endpoint `/auth/refresh/` responde 401 (token de refresco expirado, revocado o inválido), `pedir()` invoca `logout()` y ejecuta `manejadorNoAutorizado()`. En la app móvil, `AuthContext.tsx` escucha este evento mediante `configurarManejador401` y ejecuta `cerrarLocalmente()`.
- **Desmontaje atómico y navegación única:** `cerrarLocalmente()` limpia el estado en memoria (`usuario = null`, `estado = 'anonimo'`) y purga `SecureStore` (`limpiarSesionSegura()`). Al pasar `haySesion` a `false`, `RootNavigator.tsx` desmonta inmediatamente el árbol privado de `AppTabNavigator` y monta `AuthNavigator` (Login), evitando bucles de navegación o pantallas residuales.
- **Diferenciación de errores de red y HTTP 403:** Un fallo de red o error de servidor (HTTP 503) durante el refresh mantiene los tokens guardados (`conservarSesion = true`) y no expulsa al usuario al Login. Respuestas HTTP 403 (Forbidden) lanzan `ErrorDeApi` con status 403 sin tocar la sesión ni activar el interceptor 401.
- **Prevención de reintentos infinitos:** La repetición de peticiones tras un 401 se ejecuta a lo sumo una sola vez; si la petición repetida vuelve a fallar con 401, no se intenta renovar nuevamente y se procesa el cierre definitivo de sesión.

---

## 2. Criterios de Aceptación Verificados

- [x] **Refresh válido mantiene sesión según contrato:**  
  Ante un HTTP 401 en una petición protegida, el cliente renueva el token mediante `/auth/refresh/`, repite la llamada con éxito y el usuario permanece en su pantalla activa sin volver a Login.
- [x] **Refresh inválido limpia tokens y vuelve a Login una sola vez:**  
  Si `/auth/refresh/` rechaza el refresh token con 401, se eliminan los tokens en memoria y en hardware (`SecureStore`), el estado conmuta a `anonimo` y `RootNavigator` muestra `LoginScreen` desmontando las rutas privadas en una sola transición.
- [x] **Diferenciación explícita (red y 403):**  
  Errores 403 y fallos transitorios de conectividad no eliminan credenciales ni redirigen al stack público.
- [x] **Evidencia enlazada y revisión por otra persona:**  
  Pruebas automatizadas aprobadas en suites de navegación, cliente HTTP y contexto de autenticación.

---

## 3. Matriz de Verificación y Pruebas Automatizadas

Comando de ejecución:
```bash
npm test --workspace=movil
```

- **Resultado general:** 11 archivos de prueba pasados (11/11), **166 pruebas aprobadas (166/166)**.
- **Pruebas específicas de SE-16:**
  1. `navigation.test.tsx` — `Criterio 1: Refresh válido ante un 401 mantiene la sesión y permanece en la pantalla privada`
  2. `navigation.test.tsx` — `Criterio 2: Refresh inválido ante un 401 limpia tokens y conmuta a Login una sola vez`
  3. `navigation.test.tsx` — `Diferenciación: Error 403 Forbidden o error de red NO cierra la sesión ni vuelve a Login`
  4. `AuthContext.test.tsx` — `interceptor 401: respuesta 401 en petición protegida cierra sesión y conmuta a anónimo`
  5. `AuthContext.test.tsx` — `un 503 temporal al renovar /me conserva los tokens y deja el perfil recuperable [P2]`
  6. `cliente.test.ts (@ojoalgasto/shared)` — `ante un 401 renueva y repite la petición con el token nuevo`
  7. `cliente.test.ts (@ojoalgasto/shared)` — `con un 403 tampoco cierra la sesión`
  8. `cliente.test.ts (@ojoalgasto/shared)` — `con un 500 no toca la sesión ni dispara el manejador`

Verificación global del monorepo:
- `npm test --workspace=@ojoalgasto/shared`: 17 suites, 255 pruebas aprobadas.
- `npm run typecheck`: 0 errores en `shared`, `web`, `movil`, `desktop`.
- `npm test`: Aprobado con código de salida 0 en todo el monorepo.

---

## 4. Ejemplo de Consumo del Contrato

En cualquier pantalla o servicio que invoque APIs protegidas mediante `@ojoalgasto/shared`, el tratamiento 401 opera de forma transparente:

```tsx
import { pedir } from '@ojoalgasto/shared';

export async function obtenerDatosPrivados() {
  // Si el access token expiró:
  // 1. pedir() intenta renovar con refresh token automáticamente.
  // 2. Si el refresh es válido, repite la petición y retorna los datos.
  // 3. Si el refresh es inválido, AuthContext limpia SecureStore y conmuta la app a Login.
  // 4. Si el servidor responde 403, lanza ErrorDeApi sin cerrar sesión.
  return await pedir('/suscripciones/');
}
```
