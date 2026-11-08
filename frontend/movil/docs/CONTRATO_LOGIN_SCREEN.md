# Contrato de Componente y Diseño: Pantalla Iniciar Sesión Móvil (SE-09)

**Responsable:** Sebastian Mena  
**Tipo:** DISEÑO · **Prioridad:** P1  
**Estado:** IMPLEMENTADO / VERIFICADO  
**Dependencias Previas:** SE-06 (Navegación principal móvil), SE-07 (Cliente HTTP por entorno), SE-08 (Almacenamiento seguro).  
**Tarea Desbloqueada:** SE-10 (Conectar Login móvil con Auth - Sebastian Mena).

---

## 1. Resumen y Propósito

La tarjeta **SE-09** entrega la arquitectura de diseño, componentes visuales, gestión de foco/teclado y accesibilidad de la pantalla de acceso móvil para Expo / React Native (`frontend/movil`).

Para facilitar el trabajo independiente y desacoplar la maqueta del servicio de autenticación de backend (a implementar/cerrar en **SE-10**), el módulo [`src/screens/auth/LoginScreen.tsx`](src/screens/auth/LoginScreen.tsx) se diseñó bajo el patrón de **Presentación desacoplada / Contenedor**:
1. **`LoginForm` (Componente Presentacional Puro):** Expone un contrato de props tipado (`LoginFormProps`) que controla estados de carga, mensajes de error, navegación de foco, teclado y accesibilidad.
2. **`LoginScreen` (Contenedor de Pantalla):** Envuelve `LoginForm`, conectándolo con React Navigation y el estado de sesión de `AuthContext`.

---

## 2. Contrato de Props (`LoginFormProps`)

El receptor de esta entrega (**SE-10**) puede inyectar props directamente o consumir el contenedor:

```typescript
export interface LoginFormProps {
  /** Correo controlado (opcional, opera en modo no controlado si se omite) */
  correo?: string;
  /** Callback al cambiar el texto de correo */
  onCorreoChange?: (correo: string) => void;
  /** Contraseña controlada (opcional, opera en modo no controlado si se omite) */
  password?: string;
  /** Callback al cambiar el texto de contraseña */
  onPasswordChange?: (password: string) => void;
  /** Estado de carga asíncrona (bloquea controles y activa spinner) */
  loading?: boolean;
  /** Mensaje de error para anunciar en la región de alerta accesible */
  error?: string | null;
  /** Callback invocado únicamente tras validar que correo y clave no están vacíos */
  onSubmit?: (credenciales: { correo: string; password: string }) => void | Promise<void>;
  /** Callback de navegación a Registro */
  onNavigateRegistro?: () => void;
  /** Callback de navegación a Recuperar Contraseña */
  onNavigateRecuperar?: () => void;
  /** Callback de navegación a Verificar Correo */
  onNavigateVerificar?: () => void;
  /** Deshabilita toda interacción en el formulario */
  disabled?: boolean;
  /** Identificador para pruebas de integración */
  testID?: string;
}
```

---

## 3. Usabilidad con Teclado Abierto (Criterio 1)

### A. Prevención de Oclusión con `KeyboardAvoidingView`
- Envuelve la pantalla completa utilizando:
  ```tsx
  <KeyboardAvoidingView
    style={styles.keyboardAvoiding}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
  >
  ```
- En Android delega en el ajuste nativo de ventana (`adjustResize`), y en iOS compensa el espacio del teclado para que ni los inputs ni los botones queden tapados.

### B. Persistencia de Toques (`keyboardShouldPersistTaps="handled"`)
- El contenedor `ScrollView` configura:
  ```tsx
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="on-drag"
  ```
- **Garantía:** Cuando el usuario tiene el teclado virtual abierto y presiona el botón "Iniciar sesión" o alguno de los enlaces secundarios, la acción se dispara inmediatamente en el primer toque (en lugar de perderse cerrando únicamente el teclado).

### C. Encadenamiento de Foco y Teclas de Acción
1. **Campo de Correo (`input-correo`):**
   - `returnKeyType="next"`
   - `blurOnSubmit={false}`
   - `onSubmitEditing={() => passwordInputRef.current?.focus()}`
   - Al pulsar "Siguiente" o Enter en el teclado, el foco salta suavemente al campo de contraseña sin cerrar el teclado virtual.
2. **Campo de Contraseña (`input-password`):**
   - Asignado a `ref={passwordInputRef}`.
   - `returnKeyType="done"`
   - `onSubmitEditing={handleFormSubmit}`
   - Al pulsar "Listo" o Enter en el teclado, se ejecuta la validación y el envío del formulario.

---

## 4. Errores y Espera sin Saltos ni Envío Duplicado (Criterio 2)

### A. Prevención Estricta de Envío Duplicado
- El botón base [`NavButton.tsx`](src/screens/components/NavButton.tsx) incorpora soporte nativo para `disabled` y `loading`:
  ```tsx
  const isBloqueado = Boolean(disabled || loading);
  ```
- Mientras `loading === true`:
  - El botón aplica estilo visual atenuado (`opacity: 0.55`).
  - Renderiza un `ActivityIndicator` accesible.
  - El manejador `onPress` ignora cualquier pulsación repetida.
  - `handleFormSubmit` en `LoginForm` implementa una guarda temprana `if (isBloqueado) return;`.

### B. Estabilidad Visual del Área de Error (Sin Saltos de Layout)
- El contenedor de avisos se ubica en un área de feedback estructurada:
  ```tsx
  <View
    style={styles.feedbackContainer}
    accessibilityRole="alert"
    accessibilityLiveRegion="polite"
  >
    {activeError ? (
      <View style={styles.errorBox} testID="login-error">
        <Text style={styles.errorText} testID="login-error-text">
          {activeError}
        </Text>
      </View>
    ) : null}
  </View>
  ```
- Los inputs aplican un borde sutil de error (`styles.inputErrorBorder`) sin modificar su altura (`minHeight: 46`).
- Al comenzar a escribir en cualquier campo, el error se limpia reactivamente de forma suave sin alterar abruptamente el flujo de los controles.

---

## 5. Accesibilidad Móvil (a11y) y Semántica

| Control | Atributo / Prop | Valor | Propósito Accesible |
|---|---|---|---|
| Input Correo | `accessibilityLabel`<br>`autoComplete`<br>`textContentType`<br>`keyboardType` | `"Correo electrónico"`<br>`"email"`<br>`"emailAddress"`<br>`"email-address"` | Anuncia el propósito al lector de pantalla y activa el autocompletado del sistema operativo móvil. |
| Input Contraseña | `accessibilityLabel`<br>`autoComplete`<br>`textContentType`<br>`secureTextEntry` | `"Contraseña"`<br>`"password"`<br>`"password"`<br>`!showPassword` | Permite a gestores de contraseñas de iOS/Android sugerir credenciales guardadas y enmascara el texto. |
| Botón Ver Contraseña | `accessibilityRole`<br>`accessibilityLabel`<br>`hitSlop` | `"button"`<br>`showPassword ? 'Ocultar contraseña' : 'Ver contraseña'`<br>`{ top: 8, bottom: 8, left: 8, right: 8 }` | Anuncia la acción de alternar visibilidad y amplía el área táctil sin deformar el icono. |
| Botón Submit | `accessibilityRole`<br>`accessibilityState`<br>`minHeight` | `"button"`<br>`{ disabled: isBloqueado, busy: loading }`<br>`48` | Cumple con la pauta WCAG de tamaño de destino táctil mínimo (48x48 dp) y anuncia el estado ocupado. |
| Contenedor de Error | `accessibilityRole`<br>`accessibilityLiveRegion` | `"alert"`<br>`"polite"` | Los lectores de pantalla (VoiceOver / TalkBack) leen el mensaje de error de inmediato sin necesidad de mover el foco manualmente. |

---

## 6. Guía de Conexión para SE-10 (Conectar Login con Auth)

En la tarea **SE-10**, el responsable puede conectar el formulario directamente consumiendo `LoginForm` o el contenedor `LoginScreen`:

```tsx
import React, { useState } from 'react';
import { LoginForm } from './LoginScreen';
import { login, AuthError } from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { esErrorDeRed, adaptarErrorRed } from '../../services/clienteHttp';

export function LoginScreenConectado({ navigation }: any) {
  const { iniciarSesion } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async ({ correo, password }: { correo: string; password: string }) => {
    setLoading(true);
    setError(null);

    try {
      // 1. Llamar al cliente de autenticación compartido
      const res = await login({ correo, password });
      
      // 2. Persistir sesión de forma segura y navegar a rutas privadas
      await iniciarSesion({ access_token: res.access_token, refresh_token: res.refresh_token });
    } catch (err: unknown) {
      if (err instanceof AuthError && err.status === 401) {
        setError('Usuario o contraseña inválidos');
      } else if (err instanceof AuthError) {
        setError(err.message);
      } else if (esErrorDeRed(err)) {
        setError(adaptarErrorRed(err) ?? 'Error de conexión con el servidor.');
      } else {
        setError('No se pudo iniciar sesión. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginForm
      loading={loading}
      error={error}
      onSubmit={handleSubmit}
      onNavigateRegistro={() => navigation.navigate('Registro')}
      onNavigateRecuperar={() => navigation.navigate('RecuperarContrasena')}
      onNavigateVerificar={() => navigation.navigate('VerificarCorreo')}
    />
  );
}
```

---

## 7. Verificación y Pruebas Automatizadas

| Archivo de Prueba | Pruebas | Aspectos Validados | Estado |
|---|---|---|---|
| [`src/screens/auth/LoginScreen.test.tsx`](src/screens/auth/LoginScreen.test.tsx) | 12 | Maqueta completa, labels/roles accesibles, toggle dinámico de clave, teclado (`email-address`, `next`, foco automático a contraseña), bloqueo contra doble envío durante carga, estabilidad de layout de error, validación previa en cliente y callbacks de navegación. | APROBADO (12/12) |
| [`src/navigation/navigation.test.tsx`](src/navigation/navigation.test.tsx) | 14 | Flujo público, validación en formulario integrado, error 401 y login exitoso hacia `Home`. | APROBADO (14/14) |
| **Suite Total Móvil** | **64** | `clienteHttp.test.ts` (18) + `storageSeguro.test.ts` (7) + `AuthContext.test.tsx` (13) + `navigation.test.tsx` (14) + `LoginScreen.test.tsx` (12). | **APROBADO (64/64)** |
| **Typecheck TypeScript** | - | `npm run typecheck` en todos los workspaces (`shared`, `web`, `movil`). | **0 ERRORES** |
