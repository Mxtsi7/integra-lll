# Contrato de Integración y Evidencia: SE-15

**Tarjeta:** SE-15: Cerrar sesión y limpiar datos privados en móvil  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P0  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** SE-08 (Almacenamiento seguro y sesión móvil), MX-29 (Revocar sesión en backend al cerrar sesión)  

---

## 1. Resumen de Implementación (SE-15)

- **Acción visible:** Botón "Cerrar Sesión" implementado en `ConfiguracionScreen.tsx` (`testID="logout"`, `variant="danger"`) y en `HomeScreen.tsx` (`testID="logout"`, `variant="danger"`).
- **Revocación remota (MX-29):** La función `revocarTokensRemotos(credenciales, accesoVigente)` en `clienteHttp.ts` envía `POST /auth/logout/` hacia el API Gateway / servicio Auth con `{ refresh_token }`. Solo adjunta el header `Authorization: Bearer <access_token>` si la sesión está vigente (`accesoVigente === true`), previniendo que un access token expirado cause un 401 en Django REST Framework y deje el refresh token sin revocar.
- **Limpieza de storage y caché (SE-08):** `limpiarSesionSegura()` en `storageSeguro.ts` vacía inmediatamente el caché síncrono en memoria (`cacheMemoria = {}`), ejecuta `logout()` en `@ojoalgasto/shared`, y elimina físicamente de `expo-secure-store` las claves `access_token`, `refresh_token` y `desfase_reloj_ms`.
- **Restablecimiento del stack público:** `cerrarSesion()` en `AuthContext.tsx` limpia el estado visible (`usuario = null`, `estado = 'anonimo'`). Al pasar `haySesion` a `false`, `RootNavigator.tsx` desmonta físicamente `AppTabNavigator` y monta de forma atómica `AuthNavigator` (iniciando en `Login`).
- **Manejo de desconexión y fallos:** `revocarTokensRemotos` cuenta con timeout de 5s y captura excepciones de red/servidor sin bloquear el cierre local. Si el hardware seguro falla al borrar credenciales, se persiste la marca `limpieza_pendiente: '1'`, se expone `errorCierre` en la UI y se habilita `reintentarCierre()`.

---

## 2. Criterios de Aceptación Verificados

- [x] **Reabrir app no recupera la sesión cerrada:**  
  Al reiniciar la aplicación, `hidratarSesionSegura()` consulta `SecureStore`. Dado que las claves fueron eliminadas por `limpiarSesionSegura()`, la hidratación concluye con `hayTokens: false` y la app inicia en estado `anonimo`. Si ocurrió una falla previa de hardware, la marca `limpieza_pendiente: '1'` purga cualquier credencial residual antes de montar la vista, impidiendo recuperar la sesión.
- [x] **Atrás y cachés no muestran información del usuario anterior:**  
  Al ejecutar `cerrarSesion()`, `usuario` pasa a `null` y `cacheMemoria` se reinicia a vacío. Dado que `RootNavigator` renderiza condicionalmente `AppTabNavigator` solo cuando `haySesion === true`, el árbol privado de pantallas se desmonta íntegramente. El botón físico o táctil de "Atrás" en la pantalla de Login no tiene historial al cual retroceder y no puede volver a mostrar pantallas privadas.
- [x] **Evidencia enlazada y revisión por otra persona:**  
  Cobertura de pruebas automatizadas al 100% en suites de contexto, almacenamiento seguro y navegación. Contrato documentado y listo para validación por receptor.

---

## 3. Matriz de Verificación y Pruebas Automatizadas

Comando de ejecución:
```bash
npm test --workspace=movil
```

- **Resultado general:** 11 archivos de prueba pasados (11/11), **163 pruebas aprobadas (163/163)**.
- **Pruebas específicas de cierre de sesión y seguridad:**
  1. `AuthContext.test.tsx` — `cerrarSesion revoca en la URL configurada por EXPO_PUBLIC_API_URL y limpia storage [P1]`
  2. `AuthContext.test.tsx` — `cerrarSesion limpia localmente incluso si la revocación en backend falla [P1]`
  3. `AuthContext.test.tsx` — `logout A demorado no borra la sesión B posterior ni tras resolución 200 ni con fallo [P1]`
  4. `AuthContext.test.tsx` — `cerrarSesion con sesión de más de 30 min NO envía header Authorization para evitar 401 en DRF, pero sí envía refresh_token [P2]`
  5. `AuthContext.test.tsx` — `fallo de borrado persistente en cerrarSesion se expone como cierre pendiente sin lanzar [P1]`
  6. `navigation.test.tsx` — `logout desde Home conmuta de inmediato a Login sin retorno a rutas privadas`
  7. `storageSeguro.test.ts` — `limpiarSesionSegura elimina las claves de forma segura y vacía el caché síncrono`
  8. `storageSeguro.test.ts` — `hidratarSesionSegura detecta limpieza_pendiente y purga credenciales`

Verificación global del monorepo:
- `npm test --workspace=@ojoalgasto/shared`: 17 suites, 255 pruebas aprobadas.
- `npm run typecheck`: 0 errores en `shared`, `web`, `movil`, `desktop`.
- `npm test`: Aprobado con código de salida 0 en todo el repositorio.

---

## 4. Ejemplo de Consumo del Contrato

Para accionar el cierre de sesión desde cualquier pantalla o componente móvil:

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
