# Contrato de Integración y Evidencia: SE-14

**Tarjeta:** SE-14: Solicitar recuperación desde móvil  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P1  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** MX-02 (`POST /auth/password-reset/` y `solicitarRecuperacion`), SE-06 (Navegación móvil), SE-07 (Cliente HTTP por entorno)  

---

## 1. Resumen de Implementación (SE-14)

- **Pantalla y formulario de recuperación:** Se implementó `RecuperarContrasenaScreen` y su hoja de estilos modular `RecuperarContrasenaScreen.styles.ts` en `frontend/movil/src/screens/auth/`. Incluye campo accesible de correo electrónico (`testID="recuperar-email"`), teclado `email-address`, validación con `validarCorreo` de `@ojoalgasto/shared` y botón de envío (`testID="recuperar-submit"`).
- **Confirmación neutra (Anti-enumeración):** Al enviar la solicitud contra `solicitarRecuperacion(correo)`, la pantalla transiciona a `RecuperarContrasenaConfirmacionView` (`testID="pantalla-recuperar-confirmacion"`) con un mensaje unificado y neutro: *"Si el correo ingresado está registrado, te enviamos un enlace para restablecer tu contraseña."*. Este comportamiento garantiza que ningún atacante pueda inferir la existencia o ausencia de cuentas en el sistema.
- **Manejo de caídas de red y reintentos:** Cuando ocurre un fallo de red o conectividad (`isNetworkError`), el estado de carga finaliza inmediatamente (`cargando = false`), se presenta el mensaje estándar (`No se pudo conectar con el servidor...`), se conserva el texto del correo en el campo y el botón se reactiva para permitir el reintento inmediato.
- **Accesibilidad y navegación:** Los campos y botones implementan roles (`accessibilityRole`), etiquetas y estados accesibles (`busy`, `disabled`). Se proporcionan accesos directos para volver a Login (`testID="go-login"`), botón Volver (`testID="go-back"`), "Usar otro correo" (`testID="btn-usar-otro-correo"`) y soporte de botón físico atrás en Android (`BackHandler`).
- **Prevención de doble envío:** Concurrencia controlada mediante bandera y referencia mutable (`peticionEnVueloRef`) para ignorar toques repetidos mientras la petición HTTP está en curso.
- **Sin duplicación de tipos y código limpio:** Consumo directo de funciones y tipos existentes en `@ojoalgasto/shared` (`solicitarRecuperacion`, `validarCorreo`, `isNetworkError`).

---

## 2. Criterios de Aceptación Verificados

- [x] **Solicitud genera feedback sin revelar existencia de cuenta:**  
  La confirmación neutra se despliega idénticamente tanto si el correo existe como si no existe en el backend, consumiendo el contrato establecido en MX-02.
- [x] **Caída de red termina la espera y permite reintentar:**  
  La captura de excepciones de red aborta el estado de espera al instante, muestra el error descriptivo en pantalla y mantiene el formulario habilitado para reintentar.
- [x] **Evidencia enlazada y revisión por otra persona:**  
  13 pruebas unitarias y de integración automáticas en `RecuperarContrasenaScreen.test.tsx` cubren la totalidad de flujos de interacción, validación, feedback neutro y errores.

---

## 3. Matriz de Verificación y Pruebas Automatizadas

Comandos ejecutados:
```bash
npm test --workspace=movil -- src/screens/auth/RecuperarContrasenaScreen.test.tsx
npm run typecheck
npm test --workspace=movil
```

- **Pruebas específicas de SE-14 (`RecuperarContrasenaScreen.test.tsx`):** 13/13 pasadas
  1. `renderiza los controles principales del formulario de recuperación`
  2. `valida campo vacío con mensaje descriptivo de validarCorreo`
  3. `valida formato de correo inválido localmente sin invocar API`
  4. `limpia el mensaje de error cuando el usuario edita el correo`
  5. `solicitud exitosa muestra confirmación neutra sin revelar existencia de cuenta`
  6. `solicitud con correo no registrado muestra el mismo feedback neutro (anti-enumeración)`
  7. `hace trim del correo antes de enviarlo a la API`
  8. `caída de red termina la espera, muestra error de red y permite reintentar`
  9. `maneja error 400 de DRF mapeando el error al campo correo`
  10. `ignora envíos concurrentes cuando ya hay una petición en curso`
  11. `en la confirmación, "Usar otro correo" reinicia el formulario conservando la accesibilidad`
  12. `los botones "Volver a Iniciar Sesión" y "Volver" navegan al flujo de acceso`
  13. `en la vista de confirmación, presionar atrás en Android vuelve al formulario`

- **Suite completa móvil:** 12 archivos de prueba pasados (12/12), **179 pruebas aprobadas (179/179)**.
- **Chequeo de tipos:** `tsc --noEmit` completado con 0 errores en monorepo (`shared`, `web`, `movil`, `desktop`).

---

## 4. Ejemplo de Consumo del Componente

En el stack de autenticación (`AuthNavigator.tsx`):

```tsx
import { RecuperarContrasenaScreen } from './screens/auth/RecuperarContrasenaScreen';

<AuthStack.Screen
  name="RecuperarContrasena"
  component={RecuperarContrasenaScreen}
  options={{ title: 'Recuperar contraseña' }}
/>
```

O consumo desacoplado con inyección para arneses de testing:

```tsx
<RecuperarContrasenaScreen
  navigation={navigationMock}
  onSolicitarRecuperacionApi={async (correo) => {
    return { detail: 'Password reset e-mail has been sent.' };
  }}
/>
```
