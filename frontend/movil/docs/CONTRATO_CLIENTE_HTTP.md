# Contrato de Integración: Cliente HTTP Móvil por Entorno (SE-07)

**Responsable:** Sebastian Mena  
**Estado:** IMPLEMENTADO / VERIFICADO  
**Dependencias:** Reutiliza cliente y excepciones de `@ojoalgasto/shared` (`configurarApi`, `configureAuthApi`, `AuthError`, `ErrorDeApi`).  
**Tareas Desbloqueadas:** SE-10, SE-12, SE-14, SE-19, SE-21, SE-23, SE-25 (Sebastian Mena), AN-03 (Andrea Travola).

---

## 1. Resumen y Propósito

El servicio `clienteHttp` (`src/services/clienteHttp.ts`) centraliza la configuración de comunicación HTTP para el cliente móvil React Native / Expo, resolviendo la URL base según el entorno de ejecución, validando el acceso desde dispositivos móviles físicos y emuladores, y adaptando fallos de red sin duplicar la lógica de negocio ni alterar los errores de dominio de DRF y `@ojoalgasto/shared`.

---

## 2. Variables de Entorno y Seguridad del Build

En Expo / React Native, **toda variable con prefijo `EXPO_PUBLIC_*` se incrusta en el bundle cliente público (JS/APK)**.
Por regla de seguridad estricta:
- **`frontend/movil/.env.example` y `.env` únicamente contienen variables públicas de cliente.**
- **Cero secretos en el build móvil:** Secretos de base de datos (`POSTGRES_PASSWORD`), tokens JWT (`JWT_SECRET`), claves privadas o API keys backend no deben existir en el entorno móvil.

### Variable Soportada

| Variable | Tipo | Propósito | Valor por Defecto |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | `string` | URL base del API Gateway de Ojo al Gasto | Emulador Android: `http://10.0.2.2:8000/api`<br>Web/Local: `http://localhost:8000/api` |

---

## 3. Guía de Conexión por Entorno y Dispositivo

En desarrollo móvil, `localhost` se resuelve como el propio teléfono o emulador. Para contactar el backend en la máquina anfitriona:

### A. Emulador Oficial de Android Studio
El alias de red del emulador para el host local es `10.0.2.2`.
```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api
```

### B. Dispositivo Físico Real (Expo Go / APK vía Wi-Fi)
El celular debe estar conectado a la misma red local que la computadora:
```env
EXPO_PUBLIC_API_URL=http://192.168.1.45:8000/api
```
*(Reemplazar `192.168.1.45` por la IP local de tu máquina obtenida con `ip addr` o `ifconfig`).*

### C. Entornos Remotos / Staging
```env
EXPO_PUBLIC_API_URL=https://api.staging.ojoalgasto.cl/api
```

---

## 4. Consistencia del Gateway (Login y API)

Al inicializar la aplicación en `App.tsx`:
```tsx
import { configurarClienteHttp } from './src/services/clienteHttp';

configurarClienteHttp();
```
`configurarClienteHttp` ejecuta de manera atómica:
1. Lectura y normalización de `EXPO_PUBLIC_API_URL` (recorte de espacios y barras finales).
2. Validación de formato de URL y advertencia preventiva si se detecta `localhost` en Android.
3. Sincronización simultánea de:
   - `configurarApi({ urlBase })` -> Utilizado por `pedir()`, listados, suscripciones, perfiles, etc.
   - `configureAuthApi({ baseUrl: urlBase })` -> Utilizado por `login()`, `register()`, `revocarSesion()`, `solicitarRecuperacion()`.

**Garantía:** Tanto la autenticación como los recursos de la API consumen exactamente el mismo origen y ruta base del Gateway.

---

## 5. Adaptación de Errores de Red vs Lógica de Dominio

### Separación de Responsabilidades

| Tipo de Error | Origen | Manejo en Móvil |
|---|---|---|
| **Error de Red** (`TypeError: Network request failed`, `Failed to fetch`, `AbortError`, timeout) | Falla de conexión física, modo avión, host inalcanzable | Capturado por `esErrorDeRed` y adaptado con `MENSAJE_ERROR_RED` / `NetworkError` para ofrecer reintento. |
| **Error de Dominio Auth** (`AuthError`) | Backend DRF (400, 401, 404, 410, 503) | **Preservado íntegramente.** Mantiene `status`, `codigo` y `campos` para renderizado bajo cada input. |
| **Error de Dominio API** (`ErrorDeApi`) | Backend DRF (400, 403, 404, 422, 500) | **Preservado íntegramente.** Mantiene `status` y `campos` para formularios y mensajes de servidor. |

### Funciones Utilitarias Exportadas

```typescript
import {
  esErrorDeRed,
  adaptarErrorRed,
  procesarErrorHttp,
  MENSAJE_ERROR_RED,
} from './src/services/clienteHttp';
```

#### 1. `esErrorDeRed(error: unknown): boolean`
Retorna `true` únicamente si el error fue producido por la capa de red o transporte (nunca para `AuthError` o `ErrorDeApi`).

#### 2. `adaptarErrorRed(error: unknown, mensajePersonalizado?: string): string | null`
Devuelve el mensaje de error de red estandarizado o `null` si es un error de dominio, permitiendo que la pantalla atienda sus propios casos de negocio.

#### 3. `procesarErrorHttp(error: unknown, fallback?: string): ResultadoErrorHttp`
Convierte cualquier excepción en una estructura uniforme:
```typescript
type ResultadoErrorHttp = {
  esRed: boolean;
  esDominio: boolean;
  mensaje: string;
  status?: number;
  campos?: Record<string, string[]>;
  codigo?: string;
};
```

---

## 6. Ejemplos de Integración para Tareas Desbloqueadas

### Ejemplo 1: Conectar Login con Auth (SE-10)
```tsx
import { login, AuthError } from '@ojoalgasto/shared';
import { esErrorDeRed, adaptarErrorRed } from '../../services/clienteHttp';

try {
  const tokens = await login({ correo, password });
  iniciarSesion(tokens);
} catch (err: unknown) {
  if (err instanceof AuthError && err.status === 401) {
    setError('Usuario o contraseña incorrectos');
  } else if (err instanceof AuthError) {
    setError(err.message);
  } else if (esErrorDeRed(err)) {
    setError(adaptarErrorRed(err));
  } else {
    setError('Ocurrió un error inesperado');
  }
}
```

### Ejemplo 2: Formularios con Validación del Servidor (SE-12, SE-23, SE-25)
```tsx
import { crearSuscripcion, ErrorDeApi } from '@ojoalgasto/shared';
import { procesarErrorHttp } from '../../services/clienteHttp';

try {
  await crearSuscripcion(datos);
} catch (err: unknown) {
  const procesado = procesarErrorHttp(err);
  if (procesado.esRed) {
    mostrarToast(procesado.mensaje); // "No se pudo conectar con el servidor..."
  } else if (procesado.campos) {
    setErroresPorCampo(procesado.campos); // Errores DRF asignados a cada campo
  } else {
    mostrarToast(procesado.mensaje);
  }
}
```

### Ejemplo 3: Pantallas con Listados y Estado de Carga (SE-19, SE-21, AN-03)
Integración transparente con `ContenidoConEstado` y `NetworkError`:
```tsx
import { ContenidoConEstado } from '../../components/estados';

<ContenidoConEstado
  estado={estadoSuscripciones}
  onReintentar={cargarDatos}
  vacio={{ titulo: 'Sin suscripciones', accion: { texto: 'Crear', onPress: irACrear } }}
>
  {(datos) => <ListadoSuscripciones items={datos} />}
</ContenidoConEstado>
```

---

## 7. Criterios de Aceptación Verificados

- [x] **El build no contiene secretos en variables públicas:** `.env.example` y `.env` en `frontend/movil` no contienen claves ni credenciales privadas; las pruebas unitarias validan que ninguna clave `EXPO_PUBLIC_*` contenga patrones sensibles.
- [x] **Login y API usan el mismo Gateway configurado:** `configurarClienteHttp()` enlaza atómicamente `configurarApi` y `configureAuthApi` a la misma URL resuelta desde `EXPO_PUBLIC_API_URL`.
- [x] **Evidencia enlazada y revisión por otra persona:** Contrato documentado en `CONTRATO_CLIENTE_HTTP.md`, pruebas automatizadas en `clienteHttp.test.ts` (18 tests aprobados), y registro de cambios en `PULL_REQUEST.md`.
