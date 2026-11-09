# Contrato de Integración y Entrega: SE-12 (Conectar Registro móvil y validaciones del servidor)

**Tarea:** SE-12: Conectar Registro móvil y validaciones del servidor  
**Responsable:** Sebastian Mena  
**Tipo:** CÓDIGO  
**Estado:** **COMPLETADO / VERIFICADO**  
**Dependencias satisfechas:** SE-07 (Cliente HTTP por entorno), SE-11 (Pantalla móvil Registro), MX-30 (Alinear política de contraseña backend)  
**Entrega y desbloquea:** SE-13 (Mostrar cuenta creada y continuar a Login móvil)  

---

## 📋 Resumen del Cumplimiento de Alcance

| Requisito de la Tarjeta | Estado | Implementación en Código |
|---|---|---|
| **Conexión con `register` compartido** | **CUMPLIDO** | `RegistroScreen.tsx` conecta con la función `register` de `@ojoalgasto/shared` a través de la URL base del Gateway configurada por entorno (`EXPO_PUBLIC_API_URL`). |
| **Mapeo `correo` ↔ `email` y `aceptaDatos` ↔ `acepta_datos`** | **CUMPLIDO** | Los datos del formulario móvil se serializan automáticamente al esquema JSON esperado por Django REST Framework (`RegisterRequest` OpenAPI). |
| **Adaptación de `codigo_organizacion`** | **CUMPLIDO** | Se extendió `RegisterPayload` en `shared/src/auth.ts` y `RegistroScreen.tsx` para recibir `codigoOrganizacion` (por props o por `route.params`) e incluirlo en la llamada al endpoint. Si DRF lo rechaza, se mapea limpiamente a la alerta general. |
| **Prevención de envíos dobles** | **CUMPLIDO** | Control estricto del estado ocupado (`estaCargando`): si una petición está en vuelo, cualquier pulsación subsiguiente es descartada de inmediato, deshabilitando el botón y bloqueando entradas. |
| **Mapeo de errores de DRF** | **CUMPLIDO** | Se procesan los errores estructurados de DRF con `erroresRegistroDesdeServidor`: correo duplicado bajo `input-correo`, contraseña bajo `input-password`, y errores globales en `registro-error-general`. |
| **Conservación de datos ante rechazo** | **CUMPLIDO** | Al fallar la API (400, 500 o red), el formulario **no** se reinicia; los valores tipeados por el usuario permanecen intactos para que pueda corregir el campo correspondiente. |
| **Limpieza reactiva al editar** | **CUMPLIDO** | Modificar un campo con error del servidor limpia inmediatamente su mensaje de error sin esperar a un reenvío. |
| **Manejo de red y errores 500** | **CUMPLIDO** | Integración con `esErrorDeRed` y `adaptarErrorRed` de `clienteHttp.ts` para presentar mensajes claros de conectividad en vez de excepciones crudas, permitiendo reintentar. |
| **Transición hacia SE-13** | **CUMPLIDO** | Expone el callback `onRegistroExitoso(respuesta: RegisterResponse)` para que **SE-13** pueda montar la vista de confirmación ("cuenta creada") o continuar a Login. |

---

## ✅ Cumplimiento de Criterios de Aceptación

### 1. [x] Registro válido crea cuenta una sola vez
* **Control de concurrencia y carrera:**
  - `handleRegistro` evalúa `if (estaCargando) return;` antes de disparar la petición HTTP.
  - Al iniciar, conmuta `setCargandoInterno(true)`, lo que desactiva el botón con `aria-busy="true"` y coloca los campos en modo de solo lectura (`editable={false}`).
  - Peticiones concurrentes o múltiples toques sobre el botón son ignorados.
* **Mapeo exacto de contrato:**
  - Limpia espacios con `.trim()` en `nombre` y `correo`.
  - Preserva intactos los espacios en la contraseña (`trim_whitespace=False` según regla MX-30 / DRF).
  - Mapea `aceptaDatos` booleano a `acepta_datos`.
* **Evidencia en pruebas:**
  - `RegistroScreen.test.tsx`: *"envía los datos limpios a la API con mapeo de campos (email y acepta_datos)"*.
  - `RegistroScreen.test.tsx`: *"previene envíos duplicados mientras la petición está en vuelo (crea la cuenta una sola vez)"*.

### 2. [x] Rechazo API no navega a éxito y conserva los errores útiles
* **Sin navegación errónea:**
  - En cualquier escenario de rechazo (HTTP 400 por campos, 500 del servidor, o excepción de red), `onRegistroExitoso` **no** se ejecuta y `navigation.navigate('Login')` **no** se llama.
* **Conservación de datos:**
  - Los campos de texto mantienen exactamente lo ingresado por el usuario (`value={valorNombre}`, `value={valorCorreo}`, etc.), evitando frustración al usuario.
* **Mapeo útil por campo y alertas generales:**
  - Correo duplicado (`{ email: ["user with this email already exists."] }`): aparece visible bajo el input con `testID="error-correo"`.
  - Contraseña no aceptada por el backend (`{ password: ["..."] }`): aparece bajo el input con `testID="error-password"`.
  - Código de organización inválido (`{ codigo_organizacion: ["..."] }`): se despliega en la alerta superior con `testID="registro-error-general"`.
  - Errores de red (`TypeError: Failed to fetch` o timeout): muestra mensaje legible de revisión de internet.
  - Errores 500: muestra alerta del servidor y deja el botón habilitado para reintentar cuando el backend responda.
* **Evidencia en pruebas:**
  - 7 pruebas dedicadas en `RegistroScreen.test.tsx` bajo la sección *"Criterio de Aceptación: Rechazo API no navega a éxito y conserva los errores útiles"*.

### 3. [x] Evidencia enlazada y contrato validado para SE-13
* **Punto de integración para SE-13:**
  El componente `RegistroScreen` expone las propiedades necesarias para acoplar la pantalla de cuenta creada:

```tsx
export interface RegistroScreenPropsContainer {
  navigation?: AuthScreenProps<'Registro'>['navigation'];
  route?: Partial<AuthScreenProps<'Registro'>['route']> & {
    params?: {
      codigoOrganizacion?: string | null;
      [key: string]: unknown;
    };
  };
  /** Callback ejecutado tras crear exitosamente la cuenta (consumido por SE-13) */
  onRegistroExitoso?: (respuesta: RegisterResponse) => void;
  /** Código de organización opcional si el flujo lo incluye */
  codigoOrganizacion?: string | null;
  /** Cliente inyectable para pruebas o servicios personalizados */
  onRegisterApi?: (payload: RegisterPayload) => Promise<RegisterResponse>;
  /** Sobrescribe onSubmit para testing de navegación */
  onSubmit?: (datos: DatosRegistro) => void | Promise<void>;
  /** Estado de carga forzado para testing visual */
  cargando?: boolean;
  /** Error general forzado para testing visual */
  errorGeneral?: string | null;
  /** Identificador de pruebas */
  testID?: string;
}
```

---

## 💻 Guía de Consumo para SE-13 (Mostrar cuenta creada y continuar a Login móvil)

Para implementar **SE-13**, el desarrollador puede enlazar el resultado de **SE-12** mostrando la confirmación visual de cuenta creada:

```tsx
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import type { RegisterResponse } from '@ojoalgasto/shared';
import RegistroScreen from './RegistroScreen';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

export function FlujoRegistroConExito({ navigation }: AuthScreenProps<'Registro'>) {
  const [cuentaCreada, setCuentaCreada] = useState<RegisterResponse | null>(null);

  // SE-13: Si la cuenta fue creada, muestra la pantalla/modal de éxito
  if (cuentaCreada) {
    return (
      <View testID="pantalla-cuenta-creada">
        <Text>¡Cuenta creada exitosamente, {cuentaCreada.nombre}!</Text>
        <Text>Te enviamos un correo de verificación a {cuentaCreada.email}.</Text>
        <NavButton
          testID="btn-continuar-login"
          title="Continuar a Iniciar Sesión"
          onPress={() => navigation.navigate('Login')}
        />
      </View>
    );
  }

  // SE-12: Formulario conectado con validaciones de servidor
  return (
    <RegistroScreen
      navigation={navigation}
      onRegistroExitoso={(respuesta) => {
        setCuentaCreada(respuesta);
      }}
    />
  );
}
```

---

## 🧪 Pruebas Automatizadas y Verificación

### 1. Pruebas Unitarias de Pantalla y Servidor
```bash
npm test --workspace=movil -- src/screens/auth/RegistroScreen.test.tsx
```
* **26 pruebas pasadas al 100% (26/26)**:
  - 15 pruebas de maquetación, accesibilidad, validaciones locales y ruteo (SE-11).
  - 11 pruebas de integración de servidor, mapeo DRF, concurrencia y errores de red (SE-12).

### 2. Suite Completa Móvil
```bash
npm test --workspace=movil
```
* **10 archivos de prueba pasados (10/10)**, **142 pruebas aprobadas (142/142)**.

### 3. Chequeo de Tipos TypeScript Monorepo
```bash
npm run typecheck
```
* **0 errores** en `@ojoalgasto/shared`, `web`, `movil`, y `desktop`.
