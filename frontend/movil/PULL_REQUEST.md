# SE-06: Configurar navegación principal móvil

**Responsable:** Sebastian Mena  
**Tipo:** CÓDIGO · **Prioridad:** P1  
**Stack:** React Navigation v7 (`@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`), Expo SDK 57, React 19, React Native 0.86, Node v22.23.

---

## Resumen del Cambio

Se implementó la arquitectura de navegación principal para la aplicación móvil (`frontend/movil`) utilizando **React Navigation**, organizando los flujos mediante Native Stacks y un Bottom Tab Navigator central. La solución separa estrictamente el acceso público del privado según el estado de la sesión, establece un único contenedor raíz (`NavigationContainer`) y deja registradas y tipadas las rutas base (stubs/placeholders) que desbloquean el trabajo de Sebastian y Andrea sin duplicación de contenedores.

> [!NOTE]
> **Aviso sobre el diseño visual:** El diseño actual de las pantallas y componentes es puramente **temporal y fue generado por IA** a modo de mock/placeholder. Su único propósito en esta tarjeta es validar técnicamente la navegabilidad, la tipificación de rutas y los contratos de integración. La maquetación, estilos definitivos y componentes finales serán desarrollados en las tarjetas de UI correspondientes a cada responsable.

---

## Alcance Concreto

### 1. Separación Pública / Privada (`RootNavigator`)
* **Público (`AuthNavigator`):** Flujo de Acceso para usuarios anónimos (`Login`, `Registro`, `RecuperarContrasena`, `VerificarCorreo`).
* **Privado (`AppTabNavigator`):** Layout inferior con 4 pestañas accesibles con un toque una vez autenticado.
* **Transición reactiva:** El cambio entre flujos se gestiona en `RootNavigator` a través de `useAuth()`. Cerrar sesión o iniciar sesión conmuta la navegación de inmediato sin depender de `navigate()` manuales.

### 2. Definición de Stacks y Tabs
* 🔓 **Stack Acceso (Público)**
  * `Login` (SE-09)
  * `Registro` (SE-11)
  * `RecuperarContrasena` (SE-14)
  * `VerificarCorreo` (AN-12)
* 🔒 **Tabs Principales (Privadas)**
  * 🏠 **Tab Home (`HomeNavigator`)**:
    * `HomeScreen` (SE-17)
    * `SuscripcionDetalle` (SE-21) — con parámetro tipado obligatorio `{ id: string }`
    * `SuscripcionNueva` (SE-22)
  * 📊 **Tab Panel (`PanelNavigator`)**:
    * `PanelScreen` (AN-01)
    * `Informes` (AN-23)
    * `Recomendaciones` (AN-05)
  * 📅 **Tab Calendario (`CalendarioNavigator`)**:
    * `CalendarioScreen` (AN-07)
  * ⚙️ **Tab Configuración (`ConfiguracionNavigator`)**:
    * `ConfiguracionScreen` (AN-04)
    * `Perfil` (AN-03)
    * `CuentasConectadas` (AN-06)
    * `Planes` (AN-08)
    * `Alertas` (AN-10)
    * `AutorizacionCorreo` (AN-09)
    * `RestriccionesPremium` (AN-11)
    * `EliminarCuenta` (AN-19)

### 3. Integración con `@ojoalgasto/shared`
* **Cliente API:** Inicializado con `configurarApi({ urlBase: ... })` y `configureAuthApi({ baseUrl: ... })` en `App.tsx`.
* **Autenticación y Sesión:** `AuthContext.tsx` valida la vigencia del JWT con `haySesionValida()`, obtiene el usuario actual con `getUsuarioActual()`, guarda credenciales con `guardarTokens()`, revoca la sesión en backend con `revocarSesion()` + `logout()` y captura 401 globales con `configurarManejador401()`.
* **Placeholders y Tipado:** Las pantallas de suscripciones (`HomeScreen` - SE-17, `SuscripcionDetalleScreen` - SE-21, `SuscripcionNuevaScreen` - SE-22) se mantienen como placeholders limpios en blanco para estructurar la navegación y su tipado (`{ id: string }`), dejando la lógica de negocio y consumo de API para sus respectivas tarjetas.

---

## Criterios de Aceptación

- [x] **Cada destino básico es navegable:** Las 4 pantallas públicas y las 14 pantallas privadas están registradas en sus respectivos Stacks y son accesibles mediante navegación directa o cambio de pestaña.
- [x] **No se duplican contenedores de navegación entre compañeros:** Se definió un único `<NavigationContainer>` en `App.tsx` envuelto por `SafeAreaProvider` y `AuthProvider`. Ninguna pantalla o stack secundario duplica contenedores.
- [x] **Evidencia y contrato de integración:** Contrato de tipos y directrices de integración documentadas en `CONTRATO_NAVEGACION.md`.

---

## Tareas Desbloqueadas

| Tarea | Responsable | Pantalla / Ruta | Archivo Creado |
|---|---|---|---|
| **SE-09** | Sebastian Mena | `Login` | `src/screens/auth/LoginScreen.tsx` |
| **SE-11** | Sebastian Mena | `Registro` | `src/screens/auth/RegistroScreen.tsx` |
| **SE-14** | Sebastian Mena | `RecuperarContrasena` | `src/screens/auth/RecuperarContrasenaScreen.tsx` |
| **AN-12** | Andrea Travola | `VerificarCorreo` | `src/screens/auth/VerificarCorreoScreen.tsx` |
| **SE-17** | Sebastian Mena | `HomeScreen` | `src/screens/home/HomeScreen.tsx` |
| **SE-21** | Sebastian Mena | `SuscripcionDetalle` | `src/screens/home/SuscripcionDetalleScreen.tsx` |
| **SE-22** | Sebastian Mena | `SuscripcionNueva` | `src/screens/home/SuscripcionNuevaScreen.tsx` |
| **AN-01** | Andrea Travola | `PanelScreen` | `src/screens/panel/PanelScreen.tsx` |
| **AN-23** | Andrea Travola | `Informes` | `src/screens/panel/InformesScreen.tsx` |
| **AN-05** | Andrea Travola | `Recomendaciones` | `src/screens/panel/RecomendacionesScreen.tsx` |
| **AN-07** | Andrea Travola | `CalendarioScreen` | `src/screens/calendario/CalendarioScreen.tsx` |
| **AN-04** | Andrea Travola | `ConfiguracionScreen` | `src/screens/configuracion/ConfiguracionScreen.tsx` |
| **AN-03** | Andrea Travola | `Perfil` | `src/screens/configuracion/PerfilScreen.tsx` |
| **AN-06** | Andrea Travola | `CuentasConectadas` | `src/screens/configuracion/CuentasConectadasScreen.tsx` |
| **AN-08** | Andrea Travola | `Planes` | `src/screens/configuracion/PlanesScreen.tsx` |
| **AN-10** | Andrea Travola | `Alertas` | `src/screens/configuracion/AlertasScreen.tsx` |
| **AN-09** | Andrea Travola | `AutorizacionCorreo` | `src/screens/configuracion/AutorizacionCorreoScreen.tsx` |
| **AN-11** | Andrea Travola | `RestriccionesPremium` | `src/screens/configuracion/RestriccionesPremiumScreen.tsx` |
| **AN-19** | Andrea Travola | `EliminarCuenta` | `src/screens/configuracion/EliminarCuentaScreen.tsx` |

---

## Archivos Clave Modificados / Agregados

* `frontend/movil/package.json`: Agregadas dependencias oficiales de React Navigation y peer dependencies nativas.
* `frontend/movil/App.tsx`: Configuración de proveedores raíz y único `NavigationContainer`.
* `frontend/movil/context/AuthContext.tsx`: Contexto de autenticación móvil con bootstrap y llamadas a `@ojoalgasto/shared`.
* `frontend/movil/src/navigation/types.ts`: Tipado estricto de rutas, parámetros y props para toda la app.
* `frontend/movil/src/navigation/RootNavigator.tsx`: Enrutador raíz con control de acceso público/privado.
* `frontend/movil/src/navigation/AuthNavigator.tsx`: Stack público de autenticación.
* `frontend/movil/src/navigation/AppTabNavigator.tsx`: Bottom Tabs con las 4 pestañas requeridas.
* `frontend/movil/src/navigation/*Navigator.tsx`: Stacks independientes para Home, Panel, Calendario y Configuración.
* `frontend/movil/src/screens/`: 18 pantallas stub con `testID` inequívocos y acciones de navegación listas.
* `frontend/movil/CONTRATO_NAVEGACION.md`: Documento de directrices y ejemplos para el equipo.

---

## Cómo Probarlo

### 1. Verificación Estática de Tipos (TypeScript)
Desde el directorio `frontend/`:
```bash
npm run typecheck
```
*Valida que `shared`, `web` y `movil` compilan con 0 errores.*

### 2. Verificación Manual en la App
```bash
npm start --workspace=movil
```
1. **Flujo Público:** La app arranca en `LoginScreen` (SE-09). Navegar a `Registro` (SE-11), `Recuperar Contraseña` (SE-14) o `Verificar Correo` (AN-12) y presionar "Volver" comprueba el stack de acceso.
2. **Sesión Aislada:** La aplicación no expone puertas traseras de login simulado en la UI pública. Para validar las rutas privadas en modo desarrollo/pruebas, se inyecta la sesión a través de los props de arnés (`<App initialEstado="autenticado" initialUsuario={...} />`).
3. **Tabs y Stacks:**
   * Alternar entre las pestañas **Home**, **Panel**, **Calendario** y **Configuración**.
   * En **Home**, presionar *"Ver Detalle Suscripción #1"*.
   * En **Detalle**, probar los botones `+` y `-` para verificar el cálculo en vivo de `costoPorHora` y `formatearMonto` de `shared`.
   * En **Configuración**, entrar a subpantallas como *"Mi Perfil"* o *"Planes"* y verificar el botón de volver.
4. **Cierre de Sesión:** Presionar *"Cerrar Sesión"* en Home o Configuración. La app revoca la sesión contra `EXPO_PUBLIC_API_URL`, limpia los tokens compartidos y vuelve de inmediato a `LoginScreen`.

### 3. Ejecución de Pruebas Automatizadas
Desde el directorio raíz:
```bash
npm test --workspace=movil
```
*Ejecuta 15 pruebas automatizadas (AuthContext + árbol de navegación) con Vitest en entorno jsdom.*
