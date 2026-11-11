# Contrato de Integración y Entrega: SE-13 (Mostrar cuenta creada y continuar a Login móvil)

**Tarea:** SE-13: Mostrar cuenta creada y continuar a Login móvil  
**Responsable:** Sebastian Mena  
**Tipo:** CÓDIGO  
**Prioridad:** P1 / Must  
**Estado:** **COMPLETADO / VERIFICADO**  
**Dependencias satisfechas:** SE-12 (Conectar Registro móvil y validaciones del servidor), MX-30 (Alinear política de contraseña backend), SE-07 (Cliente HTTP por entorno)  
**Entrega y desbloquea:** Flujo de autenticación completo (Registro exitoso → Confirmación → Login)

---

## 📋 Resumen del Cumplimiento de Alcance

| Requisito de la Tarjeta | Estado | Implementación en Código |
|---|---|---|
| **Mostrar cuenta creada solo ante respuesta exitosa** | **CUMPLIDO** | `RegistroScreen.tsx` conmuta condicionalmente al componente `CuentaCreadaView` únicamente cuando `register()` resuelve con éxito (`201 Created` / `RegisterResponse`). Cualquier error (400 DRF, 500, fallo de red o validación local) mantiene el formulario visible con los datos y errores específicos. |
| **Continuar hacia Login** | **CUMPLIDO** | Se provee el botón principal `btn-continuar-login` ("Continuar a Iniciar Sesión") que ejecuta `navigation.navigate('Login')`. Además, se incluye el botón secundario `btn-volver-login` ("Volver") con el mismo destino seguro. |
| **Atrás no reenvía ni duplica registro** | **CUMPLIDO** | Al mostrarse la confirmación, el formulario se desmonta por completo. Adicionalmente, se suscribe un listener de `BackHandler.addEventListener('hardwareBackPress')` en Android que intercepta el retroceso físico para dirigir a `Login`, retornando `true` y previniendo cualquier re-ejecución de la llamada a la API. |
| **Evitar crear sesión ficticia si register no emite tokens** | **CUMPLIDO** | Siguiendo el contrato de Django REST Framework donde `/auth/register/` devuelve `{ id, email, nombre }` sin tokens JWT (estos son emitidos exclusivamente por `/auth/login/`), `CuentaCreadaScreen` y `RegistroScreen` no tocan el contexto ni guardan tokens provisionales en `storageSeguro` o memoria. |
| **Cero duplicación de tipos** | **CUMPLIDO** | No se crean interfaces ad-hoc de usuario o credenciales. Se reutiliza `DatosCuentaConfirmada = Pick<RegisterResponse, 'nombre' | 'email'>` de `@ojoalgasto/shared`, y `DestinoConfiguracion = Exclude<keyof ConfiguracionStackParamList, 'ConfiguracionScreen'>` para la navegación. |
| **Código limpio y legible para estudio** | **CUMPLIDO** | Separación clara de responsabilidades: componente presentacional puro (`CuentaCreadaView`), pantalla conectada a navegación (`CuentaCreadaScreen`), estilos desacoplados (`CuentaCreadaScreen.styles.ts`), y tipado estricto con accesibilidad nativa (`role="alert"`, `accessibilityLiveRegion="polite"`). |

---

## ✅ Cumplimiento de Criterios de Aceptación

### 1. [x] Solo respuesta exitosa muestra cuenta creada
* **Comportamiento ante éxito:**
  - `RegistroScreen` ejecuta `onRegisterApi` con los datos validados.
  - Al resolverse la promesa con `RegisterResponse` (`{ id, email, nombre }`), se guarda en `cuentaCreadaInterna`.
  - El renderizado conmuta inmediatamente a `CuentaCreadaView` con el nombre del usuario y su correo.
* **Comportamiento ante error:**
  - Error 400 DRF (correo en uso, contraseña débil, org inválida): `setCuentaCreadaInterna` no se llama; se despliegan los errores por campo y el formulario permanece activo con los valores tipeados.
  - Error 500 / Fallo de red: `setCuentaCreadaInterna` no se llama; se despliega la alerta general y el botón queda listo para reintentar.
  - Validación local previa (campos vacíos, contraseñas no coincidentes, consentimiento desmarcado): no se invoca la API y no se muestra la confirmación.
* **Evidencia en pruebas:**
  - `RegistroScreen.test.tsx`:
    - *"Criterio 1: Solo respuesta exitosa muestra cuenta creada con nombre y correo"*
    - *"Criterio 1: Rechazo API 400 por correo en uso NO muestra cuenta creada"*
    - *"Criterio 1: Rechazo API 500 o error de red NO muestra cuenta creada"*
    - *"Criterio 1: Fallo de validación local (campos incompletos) NO invoca API ni muestra cuenta creada"*

### 2. [x] Atrás no reenvía el formulario ni duplica registro
* **Desmontaje y aislamiento del estado:**
  - Al conmutar a `CuentaCreadaView`, el árbol del formulario `RegistroForm` se desmonta. Los botones de submit y los manejadores de inputs ya no existen en el DOM/árbol de vistas.
* **Navegación controlada a Login:**
  - Al pulsar `btn-continuar-login` ("Continuar a Iniciar Sesión"), se invoca `navigation.navigate('Login')`. La API no se vuelve a llamar.
  - Al pulsar `btn-volver-login` ("Volver"), se invoca `navigation.navigate('Login')`.
* **Interceptación de botón físico de Android (`BackHandler`):**
  - Mientras la confirmación esté visible, se activa el listener de `BackHandler`:
    ```tsx
    useEffect(() => {
      if (!cuentaCreada) return;
      const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
        handleVolverLogin();
        return true; // Previene el retroceso al formulario para no duplicar peticiones
      });
      return () => suscripcion.remove();
    }, [cuentaCreada, navigation]);
    ```
* **Evidencia en pruebas:**
  - `RegistroScreen.test.tsx`:
    - *"Criterio 2: Al presionar 'Continuar a Iniciar Sesión' navega a Login sin reenviar formulario"*
    - *"Criterio 2: Al presionar 'Volver' desde la confirmación navega a Login sin duplicar registro"*
    - *"Criterio 2: Retroceso físico de Android (BackHandler) redirige a Login sin reenviar el formulario ni duplicar registro"*
  - `CuentaCreadaScreen.test.tsx`:
    - *"navega a Login al pulsar Continuar a Iniciar Sesión usando navigation.navigate"*
    - *"navega a Login al pulsar el botón Volver"*
    - *"registra el listener de BackHandler para que el botón físico atrás redirija a Login"*

### 3. [x] Evitar crear sesión ficticia si register no emite tokens
* **Contrato de tokens DRF respetado:**
  - El backend DRF emite tokens (`access_token`, `refresh_token`) únicamente tras autenticarse mediante `/auth/login/`.
  - El flujo de registro móvil no inventa tokens temporales ni invoca `iniciarSesion` en el contexto.
  - Se verificó con `obtenerAccessToken()` que ningún token es persistido en `storageSeguro` durante ni después de la confirmación.
* **Evidencia en pruebas:**
  - `RegistroScreen.test.tsx`: *"Criterio de Aceptación: No crea sesión ficticia tras register() (tokens nulos en auth)"*.
  - `CuentaCreadaScreen.test.tsx`: *"Criterio de Aceptación: Evitar crear sesión ficticia si register no emite tokens"*.

---

## 🏗️ Arquitectura de Componentes y Reutilización de Tipos

```
@ojoalgasto/shared
  ├── RegisterResponse { id, email, nombre }
  └── RegisterPayload
            │
            ▼ (Reutilización limpia con Pick)
DatosCuentaConfirmada = Pick<RegisterResponse, 'nombre' | 'email'>
            │
            ├──► CuentaCreadaScreen.styles.ts (Estilos temáticos desacoplados)
            │
            ├──► CuentaCreadaView (Presentacional puro)
            │      - Encabezado de éxito accesible (role="alert")
            │      - Icono de check (✓) con badge circular
            │      - Nombre personalizado del usuario
            │      - Correo confirmado
            │      - Botones accesibles: 'Continuar a Iniciar Sesión' y 'Volver'
            │
            ├──► CuentaCreadaScreen (Contenedor React Navigation)
            │      - Lectura de route.params o props
            │      - Interceptación de BackHandler en Android
            │      - Ruteo a AuthNavigator 'Login'
            │
            └──► RegistroScreen (Integración en flujo de registro)
                   - Monta RegistroForm inicialmente
                   - Tras API 201 exitoso -> Conmuta a CuentaCreadaView
                   - Limpieza de sesión y redirección protegida
```

---

## 🧪 Resumen de Verificación y Cobertura

- **Pruebas en Móvil:** 47 pruebas ejecutadas y aprobadas en la suite de autenticación (38 en `RegistroScreen.test.tsx`, 9 en `CuentaCreadaScreen.test.tsx`). Total del workspace `movil`: 163 pruebas verdes (11 archivos).
- **Pruebas en Monorepo:** 255 pruebas verdes en `@ojoalgasto/shared`.
- **Verificación de Tipos:** `npm run typecheck` aprobado al 100% en los 4 workspaces (`shared`, `web`, `movil`, `desktop`) con 0 errores TypeScript.
