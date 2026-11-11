# Entrega SE-13: Mostrar cuenta creada, retorno a Login y limpieza de código

**Tarjeta:** SE-13: Mostrar cuenta creada y continuar a Login móvil  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Estado:** COMPLETADO Y VERIFICADO  

---

## 1. Resumen de Implementación (SE-13)

- **Pantalla de Confirmación:** Se creó `CuentaCreadaView` (presentacional puro con rol `alert`) y `CuentaCreadaScreen` (contenedor de React Navigation), mostrando saludo personalizado con el nombre del usuario y el correo confirmado.
- **Transición tras Registro:** `RegistroScreen` evalúa la respuesta de `register()`: únicamente ante HTTP 201 exitoso desmonta el formulario y muestra la confirmación. Si el backend rechaza la solicitud (400, 500, red o validación local), mantiene el formulario visible con los errores correspondientes.
- **Prevención de Reenvío y Retroceso Seguro:** Tanto el botón principal ("Continuar a Iniciar Sesión") como el secundario ("Volver") navegan a `Login`. Se implementó un listener de `BackHandler` en Android que intercepta el botón físico de atrás mientras la confirmación está activa, impidiendo reintentar o duplicar la petición.
- **Sin Sesiones Ficticias:** Se respeta el contrato de Django REST Framework (que no emite tokens en `/auth/register/`). No se crean tokens provisionales en almacenamiento ni en `AuthContext`.

---

## 2. Criterios de Aceptación Verificados

- [x] **Solo respuesta exitosa muestra cuenta creada:** Validado ante HTTP 201 (`RegisterResponse`). Errores 400 (correo en uso, clave débil, organización inválida), 500, de red o campos vacíos nunca muestran la pantalla de confirmación.
- [x] **Atrás no reenvía el formulario ni duplica registro:** Al conmutar a la confirmación, el formulario se desmonta. Al pulsar "Continuar", "Volver" o el botón físico de Android (`BackHandler`), el usuario es llevado a `Login` sin disparar nuevas llamadas a la API.
- [x] **Evitar crear sesión ficticia si register no emite tokens:** Verificado con `obtenerAccessToken() === null` en almacenamiento tras mostrar la confirmación.

---

## 3. Resumen de Limpieza de Código y Tipos en Móvil

Se eliminaron declaraciones redundantes e inline para asegurar código limpio, legible y con una única fuente de verdad:

- **`movil/src/screens/components/ScreenPlaceholder.tsx`:**  
  Se eliminó el tipo huérfano e inutilizado `type ActionButtonProps`.
- **`movil/src/screens/configuracion/secciones.ts`:**  
  Se reemplazaron las uniones manuales derivando los tipos directamente de la navegación y los botones:
  - `DestinoConfiguracion = Exclude<keyof ConfiguracionStackParamList, 'ConfiguracionScreen'>`
  - `variant?: NavButtonProps['variant']`
- **`movil/src/screens/auth/LoginScreen.tsx`:**  
  Se sustituyó el tipo inline `{ correo: string; password: string }` por `LoginPayload` importado desde `@ojoalgasto/shared`.
- **`movil/context/AuthContext.tsx`:**  
  Se sustituyó la firma duplicada `{ access_token: string; refresh_token: string }` por `Pick<AuthResponse, 'access_token' | 'refresh_token'>`.
- **`movil/src/screens/auth/CuentaCreadaScreen.tsx` y `RegistroScreen.tsx`:**  
  Se unificó la información confirmada mediante `type DatosCuentaConfirmada = Pick<RegisterResponse, 'nombre' | 'email'>`, evitando interfaces paralelas.

---

## 4. Resultados de Verificación

- **Pruebas en Móvil (`movil`):** 163 pruebas aprobadas en 11 suites (incluyendo 38 en `RegistroScreen.test.tsx` con 8 pruebas dedicadas a SE-13, y 9 en `CuentaCreadaScreen.test.tsx`).
- **Pruebas Compartidas (`@ojoalgasto/shared`):** 255 pruebas aprobadas en 17 suites.
- **Verificación de Tipos (`npm run typecheck`):** 0 errores TypeScript en todo el monorepo (`shared`, `web`, `movil`, `desktop`).
- **Suite General Monorepo (`npm test`):** Aprobado con código de salida 0.
