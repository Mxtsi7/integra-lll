# Contrato de Integración y Evidencia: SE-15 (Cerrar sesión y limpiar datos privados en móvil)

**Tarea:** SE-15: Cerrar sesión y limpiar datos privados en móvil  
**Responsable:** Sebastian Mena  
**Estado:** **COMPLETADO / VERIFICADO**  
**Dependencias previas satisfechas:** SE-08 (Almacenamiento seguro móvil) y MX-29 (Revocación en backend `/api/auth/logout/`).

---

## 📋 Resumen del Cumplimiento de Alcance

| Requisito de la Tarjeta | Estado | Implementación en Código |
|---|---|---|
| **Acción visible** | **CUMPLIDO** | Botón de "Cerrar Sesión" (`variant="danger"`) en `ConfiguracionScreen.tsx` (`testID="logout"`) y en `HomeScreen.tsx` (`testID="btn-logout"`). |
| **Revocar sesión remota** | **CUMPLIDO** | `clienteHttp.ts::revocarTokensRemotos(credenciales, accesoVigente)` ejecuta `POST /api/auth/logout/` hacia el Gateway con `{ refresh_token }`. |
| **Limpiar storage/caché** | **CUMPLIDO** | `storageSeguro.ts::limpiarSesionSegura()` vacía `cacheMemoria = {}`, purga `@ojoalgasto/shared` (`logout()`) y elimina las claves en hardware con `expo-secure-store`. |
| **Restablecer stack público** | **CUMPLIDO** | `AuthContext.tsx::cerrarSesion()` conmuta `setEstado('anonimo')`. `RootNavigator.tsx` desmonta `AppTabNavigator` y monta `AuthNavigator` (Login). |
| **Manejo de desconexión explícito** | **CUMPLIDO** | `revocarTokensRemotos` atrapa errores de red y timeouts sin bloquear; `cerrarSesion()` destruye la sesión local incondicionalmente aunque no haya internet. |

---

## ✅ Cumplimiento de Criterios de Aceptación

### 1. [x] Reabrir app no recupera la sesión cerrada
* **Implementación:** Al ejecutar `limpiarSesionSegura()`, se eliminan físicamente de `SecureStore` las claves `access_token`, `refresh_token` y `desfase_reloj_ms`.
* **Prueba de hidratación:** Al reiniciar la app, `hidratarSesionSegura()` lee valores nulos y arranca en estado `'anonimo'`.
* **Política durable:** Si el borrado físico en hardware fallara, se escribe la marca `limpieza_pendiente: '1'`. Al reabrir la app, esta marca destruye cualquier credencial residual sin recuperarla.
* **Evidencia:** `storageSeguro.test.ts` ("limpiarSesionSegura elimina las claves de forma segura y vacía el caché síncrono") y `AuthContext.test.tsx`.

### 2. [x] Atrás y cachés no muestran información del usuario anterior
* **Implementación:** 
  1. En `AuthContext.tsx`: `setUsuario(null)`, `setEstado('anonimo')`, `setEstadoPerfil('inactivo')`.
  2. En `RootNavigator.tsx`:
     ```tsx
     {!haySesion ? (
       <Stack.Screen name="Auth" component={AuthNavigator} />
     ) : (
       <Stack.Screen name="App" component={AppTabNavigator} />
     )}
     ```
  3. Al cambiar `haySesion` a `false`, **React Navigation desmonta físicamente todas las pantallas privadas** de la memoria.
* **Comportamiento del botón Atrás:** Al presionar el botón de retroceso nativo de Android en la pantalla de Login, no hay pantallas previas en el historial de navegación (la app no vuelve al Home).
* **Evidencia:** `src/navigation/navigation.test.tsx`:
  - Test: *"logout desde Home conmuta de inmediato a Login sin retorno a rutas privadas"* (Líneas 295–313).
  - Aserciones: `expect(screen.queryByTestId('screen-home')).toBeNull()` y `expect(screen.queryByTestId('screen-detalle')).toBeNull()`.

### 3. [x] Evidencia enlazada y pruebas automatizadas
Todas las pruebas unitarias y de integración pasan al 100%:

```bash
npm test --workspace=movil
```
* **Resultado:** 8 archivos de prueba pasados (8/8), **101 pruebas aprobadas (101/101)**.
* **Pruebas específicas de cierre de sesión:**
  1. `AuthContext.test.tsx::cerrarSesion revoca en la URL configurada por EXPO_PUBLIC_API_URL y limpia storage [P1]`
  2. `AuthContext.test.tsx::cerrarSesion limpia localmente incluso si la revocación en backend falla [P1]`
  3. `AuthContext.test.tsx::logout A demorado no borra la sesión B posterior ni tras resolución 200 ni con fallo [P1]`
  4. `AuthContext.test.tsx::cerrarSesion con sesión de más de 30 min NO envía header Authorization para evitar 401 en DRF, pero sí envía refresh_token [P2]`
  5. `navigation.test.tsx::logout desde Home conmuta de inmediato a Login sin retorno a rutas privadas`

---

## 💻 Ejemplo de Uso del Contrato

Para accionar el cierre de sesión desde cualquier pantalla móvil:

```tsx
import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { NavButton } from '../components/NavButton';

export function ComponenteConLogout() {
  const { cerrarSesion } = useAuth();

  return (
    <View>
      <NavButton
        testID="logout"
        title="Cerrar Sesión"
        variant="danger"
        onPress={() => void cerrarSesion()}
      />
    </View>
  );
}
```
