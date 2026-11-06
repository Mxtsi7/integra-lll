# Contrato de Componente y Entrega: SE-11 (Construir pantalla móvil Registro)

**Tarea:** SE-11: Construir pantalla móvil Registro  
**Responsable:** Sebastian Mena  
**Tipo:** DISEÑO / COMPONENTES  
**Estado:** **COMPLETADO / VERIFICADO**  
**Dependencias satisfechas:** SE-06 (Configurar navegación principal móvil)  
**Entrega y desbloquea:** SE-12 (Conectar Registro móvil y validaciones del servidor)  

---

## 📋 Resumen del Cumplimiento de Alcance

| Requisito de la Tarjeta | Estado | Implementación en Código |
|---|---|---|
| **Maquetación de campos** | **CUMPLIDO** | Campos para Nombre, Correo electrónico, Contraseña y Confirmar contraseña en `RegistroForm` / `RegistroScreen.tsx`. |
| **Errores por campo** | **CUMPLIDO** | Mensajes de error específicos ubicados directamente debajo de cada campo con `role="alert"` / `accessibilityRole="alert"` y bordes reactivos (`#f87171`). |
| **Limpieza de errores al tipear** | **CUMPLIDO** | Modificar un campo limpia inmediatamente su error individual sin borrar los errores de los otros campos. |
| **Alternar visibilidad de contraseña** | **CUMPLIDO** | Botones independientes "Ver" / "Ocultar" para la contraseña y su confirmación (`toggle-password`, `toggle-confirmacion`). |
| **Casilla de consentimiento** | **CUMPLIDO** | Casilla para aceptación de tratamiento de datos desmarcada por defecto (`false`) con rol accesible `checkbox`. |
| **Estado ocupado (loading)** | **CUMPLIDO** | Prop `cargando`: bloquea inputs, deshabilita botones y muestra spinner con `aria-busy="true"`. |
| **Reutilización de política común** | **CUMPLIDO** | Validación previa con `validarRegistro` de `@ojoalgasto/shared`, garantizando las mismas reglas que Web y Backend (DRF). |
| **Navegación y ruteo público** | **CUMPLIDO** | Integración nativa con `AuthNavigator` de React Navigation: botón "Ya tengo cuenta (Iniciar sesión)" hacia `Login` y botón "Volver". |

---

## ✅ Cumplimiento de Criterios de Aceptación

### 1. [x] Campos son accesibles y permanecen visibles con teclado
* **Prevención de superposición:** La pantalla completa se envuelve en `KeyboardAvoidingView` (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`) y `ScrollView` con `keyboardShouldPersistTaps="handled"`. Al abrir el teclado virtual, la vista sube suavemente evitando que los campos inferiores queden ocultos tras el teclado.
* **Flujo continuo entre inputs:** Los campos cuentan con referencias (`useRef<TextInput>`) y `returnKeyType="next"`. Al presionar la tecla "Siguiente" del teclado virtual:
  - Nombre salta a Correo.
  - Correo salta a Contraseña.
  - Contraseña salta a Confirmar contraseña.
  - Confirmar contraseña activa el envío con `returnKeyType="done"`.
* **Accesibilidad (A11y):** Cada campo y control cuenta con `accessibilityLabel`, `accessibilityHint`, `autoComplete` (`name`, `email`, `new-password`) y soporte para lectores de pantalla. Los mensajes de error poseen `accessibilityRole="alert"`.

### 2. [x] Consentimiento no está premarcado
* **Estado inicial desmarcado:** La propiedad y el estado interno `aceptaDatos` inician estrictamente en `false`.
* **Accesibilidad estándar:** El control tiene `role="checkbox"`, `accessibilityRole="checkbox"`, y refleja su estado mediante `accessibilityState={{ checked: valorAceptaDatos }}` y `aria-checked="false"`.
* **Sin marcas previas:** La casilla se muestra vacía; el icono `✓` solo aparece si el usuario pulsa activamente sobre el componente.
* **Validación obligatoria:** Si el usuario intenta registrarse sin marcar la casilla, se despliega el mensaje: *"Debes aceptar el tratamiento de tus datos."*.

### 3. [x] Evidencia enlazada y contrato validado para integración (SE-12)
* **Separación de responsabilidades:**
  - `RegistroForm`: Componente presentacional puro desacoplado, ideal para pruebas unitarias y reutilización.
  - `RegistroScreen`: Contenedor conectado al stack de React Navigation (`AuthScreenProps<'Registro'>`).
* **Soporte de errores del servidor:** Acepta tanto `errores` por campo (`ErroresRegistro`) como `errorGeneral` (para errores 500, de red o `non_field_errors`).

---

## 📐 Especificación del Contrato de Componente (Props y Tipos)

El componente exporta sus tipos e interfaces para consumo directo por la tarjeta **SE-12**:

```tsx
import {
  type DatosRegistro,
  type ErroresRegistro,
  type CampoRegistro,
} from '@ojoalgasto/shared';

export interface RegistroFormProps {
  /** Nombre controlado (opcional) */
  nombre?: string;
  onNombreChange?: (nombre: string) => void;

  /** Correo controlado (opcional) */
  correo?: string;
  onCorreoChange?: (correo: string) => void;

  /** Contraseña controlada (opcional) */
  password?: string;
  onPasswordChange?: (password: string) => void;

  /** Confirmación de contraseña (opcional) */
  confirmacion?: string;
  onConfirmacionChange?: (confirmacion: string) => void;

  /** Consentimiento (debe ser false por defecto) */
  aceptaDatos?: boolean;
  onAceptaDatosChange?: (acepta: boolean) => void;

  /** Diccionario de errores por campo del backend o validación previa */
  errores?: ErroresRegistro;

  /** Mensaje de alerta general (ej. error de red, 500, o non_field_errors) */
  errorGeneral?: string | null;

  /** Estado ocupado: bloquea el formulario y muestra indicador de carga */
  cargando?: boolean;

  /** Deshabilita la interacción general */
  deshabilitado?: boolean;

  /** Callback al enviar formulario válido */
  onSubmit?: (datos: DatosRegistro) => void | Promise<void>;

  /** Navegación hacia Login */
  onNavegarLogin?: () => void;

  /** Navegación de retroceso */
  onVolver?: () => void;

  /** Identificador de pruebas */
  testID?: string;
}
```

---

## 💻 Guía de Integración para SE-12 (Conexión con el Servidor)

El desarrollador que tome **SE-12** puede integrar el formulario con el servicio de autenticación de la siguiente manera:

```tsx
import React, { useState } from 'react';
import {
  erroresRegistroDesdeServidor,
  type DatosRegistro,
  type ErroresRegistro,
} from '@ojoalgasto/shared';
import RegistroScreen, { RegistroForm } from './RegistroScreen';
import { apiPost } from '../../services/clienteHttp';

export function RegistroConectado({ navigation }: any) {
  const [cargando, setCargando] = useState(false);
  const [errores, setErrores] = useState<ErroresRegistro>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const handleRegistro = async (datos: DatosRegistro) => {
    try {
      setCargando(true);
      setErrorGeneral(null);
      setErrores({});

      // 1. Enviar al endpoint de registro del backend
      const respuesta = await apiPost('/api/auth/register/', {
        nombre: datos.nombre,
        email: datos.correo,
        password: datos.password,
        acepta_datos: datos.aceptaDatos,
      });

      // 2. Navegar a verificación o a login según el flujo del backend
      navigation.navigate('Login', { registrado: true });
    } catch (err: any) {
      if (err.status === 400 && err.datos) {
        // Mapeo automático de errores de Django Rest Framework a los campos de la UI
        const { porCampo, general } = erroresRegistroDesdeServidor(err.datos);
        setErrores(porCampo);
        if (general.length > 0) {
          setErrorGeneral(general.join(' '));
        }
      } else {
        setErrorGeneral('No fue posible completar el registro. Comprueba tu conexión.');
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <RegistroForm
      cargando={cargando}
      errores={errores}
      errorGeneral={errorGeneral}
      onSubmit={handleRegistro}
      onNavegarLogin={() => navigation.navigate('Login')}
      onVolver={() => navigation.goBack()}
    />
  );
}
```

---

## 🧪 Pruebas Automatizadas y Verificación

Se incorporó una suite exhaustiva en [`src/screens/auth/RegistroScreen.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/auth/RegistroScreen.test.tsx):

- **Maquetación, controles y accesibilidad básica:**
  - Renderizado de títulos, campos, etiquetas accesibles y roles.
  - Alternancia independiente de visibilidad de contraseña (Ver / Ocultar).
- **Consentimiento no premarcado:**
  - Inicia desmarcado (`false`) con `aria-checked="false"`.
  - Conmutación correcta de marcado/desmarcado y aparición del tilde `✓`.
- **Validación con política común compartida (`@ojoalgasto/shared`):**
  - Despliegue de errores por campo bajo cada input.
  - Validación de contraseña segura (mínimo 8 caracteres, letra y número).
  - Coincidencia estricta de contraseñas.
  - Limpieza individual del error del campo al comenzar a tipear en él.
  - Llamada a `onSubmit` con datos limpios y recortados.
- **Estado ocupado y deshabilitación:**
  - Bloqueo de inputs y botón en estado `cargando`.
  - Despliegue de alerta para `errorGeneral`.
- **Ruteo y navegación:**
  - Ejecución de `onNavegarLogin` y `onVolver`.
  - Integración nativa con `navigation.navigate('Login')` y `navigation.goBack()`.

### Resultados de Ejecución

```bash
npm test --workspace=movil
```
* **10 archivos de prueba pasados (10/10)**
* **131 pruebas aprobadas (131/131)**

```bash
npm run typecheck
```
* **0 errores en `@ojoalgasto/shared`, `web`, `movil`, y `desktop`**.
