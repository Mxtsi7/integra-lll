# Pull Request: Integración Móvil - SE-07, SE-08, SE-09 y SE-10

**Responsable:** Sebastian Mena  
**Rama:** `Seba_sprint2`  
**Stack:** React Native 0.86, Expo SDK 57, TypeScript, Vitest, `@ojoalgasto/shared`, `expo-secure-store`

---

## Índice
1. [SE-07: Configurar cliente HTTP móvil por entorno](#se-07-configurar-cliente-http-móvil-por-entorno)
2. [SE-08: Implementar almacenamiento seguro y sesión móvil](#se-08-implementar-almacenamiento-seguro-y-sesión-móvil)
3. [SE-09: Construir pantalla móvil Iniciar sesión](#se-09-construir-pantalla-móvil-iniciar-sesión)
4. [SE-10: Conectar Login móvil con Auth](#se-10-conectar-login-móvil-con-auth)
5. [Matriz de Criterios de Aceptación](#matriz-de-criterios-de-aceptación)
6. [Tareas Desbloqueadas](#tareas-desbloqueadas)
7. [Evidencia de Pruebas y Tipos](#evidencia-de-pruebas-y-tipos)

---

## SE-07: Configurar cliente HTTP móvil por entorno

### Resumen del Cambio
Se implementó el servicio centralizado de cliente HTTP móvil (`src/services/clienteHttp.ts`) y se integró en la raíz de la aplicación (`App.tsx`) y en la pantalla de acceso (`LoginScreen.tsx`). La solución resuelve la configuración del cliente según el entorno a través de `EXPO_PUBLIC_API_URL`, valida la accesibilidad de la URL para dispositivos físicos y emuladores, garantiza que Login y API consumen el mismo Gateway, adapta de forma estandarizada los fallos de red sin duplicar la lógica de dominio de DRF y `@ojoalgasto/shared`, y asegura que el build público del cliente móvil no contenga credenciales sensibles.

### Puntos Destacados
* **Sincronización de Gateway:** `configurarClienteHttp()` configura de manera simultánea e inequívoca tanto `configurarApi` (recursos y endpoints protegidos) como `configureAuthApi` (login, registro, recuperación de contraseña y revocación).
* **Validación de URL en Dispositivo:** Normalización de barras finales y advertencia preventiva ante el uso de `localhost` o `127.0.0.1` en Android (donde `localhost` apunta al propio celular y requiere `10.0.2.2` en emulador o la IP local de la máquina en dispositivos físicos vía Expo Go).
* **Adaptación de Errores de Red:** Detección de fallos de red (`TypeError: Network request failed`, timeouts) mediante `esErrorDeRed`, preservando intactos los errores de dominio DRF (`AuthError` y `ErrorDeApi`) con sus códigos, status y diccionarios de campos para validaciones en formularios.
* **Seguridad de Build:** Limpieza de `.env` y `.env.example`, eliminando secretos de infraestructura backend.
* **Contrato de Integración:** Documentado en [`CONTRATO_CLIENTE_HTTP.md`](CONTRATO_CLIENTE_HTTP.md).

---

## SE-08: Implementar almacenamiento seguro y sesión móvil

### Resumen del Cambio
Se implementó el servicio de almacenamiento seguro móvil (`src/services/storageSeguro.ts`) adaptando `expo-secure-store` (Keychain en iOS, EncryptedSharedPreferences / KeyStore en Android) a la interfaz síncrona requerida por `@ojoalgasto/shared` (`TokenStorage`). Se integró la hidratación asíncrona de sesión en el ciclo de arranque de la aplicación móvil (`App.tsx` y `AuthContext.tsx`), garantizando que la sesión se restaure antes de montar las rutas privadas o públicas, evitando parpadeos de navegación (flash of unauthenticated content), purgue atómicamente la memoria y el almacenamiento seguro tras logout o respuesta 401 del servidor, y jamás acceda a `window.localStorage` en dispositivos móviles.

### Puntos Destacados
* **Adaptador Dual Asíncrono/Síncrono:** Una capa de caché en memoria RAM implementa la interfaz `TokenStorage` de `shared` (`getItem`, `setItem`, `removeItem`), mientras que las escrituras y eliminaciones se replican de forma asíncrona y no bloqueante en el hardware seguro con `expo-secure-store`.
* **Arranque e Hidratación Atómica (`hidratarSesionSegura`):** Al inicializarse el `AuthProvider`, el estado se fija en `'cargando'` (pantalla splash/loading). Se leen en paralelo `access_token`, `refresh_token` y `desfase_reloj_ms` desde `SecureStore`. Si el token es válido y no expirado, se conmuta a `'autenticado'`; si expiró o no existe, se limpian los restos en `SecureStore` y se conmuta a `'anonimo'`.
* **Cero `localStorage` web en móvil:** El adaptador sustituye por completo cualquier lectura o escritura en `window.localStorage`, resolviendo la incompatibilidad nativa en Android e iOS.
* **Limpieza Coherente en Cascada:** Al cerrar sesión (manual o vía interceptor 401 de `@ojoalgasto/shared`), `limpiarSesionSegura()` vacía la memoria y elimina todas las claves de `SecureStore`, reseteando el usuario a `null` y conmutando de inmediato al estado anónimo.
* **Contrato de Integración:** Documentado en [`CONTRATO_SESION_SEGURA.md`](CONTRATO_SESION_SEGURA.md).

---

## SE-09: Construir pantalla móvil Iniciar sesión

### Resumen del Cambio
Se maquetó y estructuró de forma desacoplada la pantalla y formulario de inicio de sesión (`src/screens/auth/LoginScreen.tsx`), implementando usabilidad con teclado abierto (`KeyboardAvoidingView`, `keyboardShouldPersistTaps="handled"`, encadenamiento de foco entre correo y contraseña), prevención de doble envío mediante botón atenuado con soporte `disabled`/`loading` (`NavButton.tsx`), contenedor de avisos estable para presentar errores sin saltos de layout, y atributos de accesibilidad móvil (etiquetas accesibles dinámicas en alternador de clave, roles accesibles, autocompletado y tamaño táctil mínimo accesible de 48dp).

### Puntos Destacados
* **Desacople Presentacional (`LoginForm`) vs Contenedor (`LoginScreen`):** Expone la interfaz `LoginFormProps` que permite a **SE-10 (Conectar Login con Auth)** inyectar `loading`, `error` y `onSubmit` sin necesidad de refactorizar la vista ni alterar el diseño.
* **Usabilidad con Teclado Abierto:** `KeyboardAvoidingView` evita oclusión; `keyboardShouldPersistTaps="handled"` permite accionar botones al primer toque; foco encadenado de correo a contraseña vía ref en `onSubmitEditing`.
* **Prevención de Doble Envío:** `NavButton` soporta `disabled` y `loading`, aplicando `opacity: 0.55`, spinner `ActivityIndicator` e ignorando toques adicionales.
* **Estabilidad Visual sin Saltos:** Contenedor de alerta accesible (`role="alert"`, `aria-live="polite"`) con diseño estructurado que evita desplazamientos verticales abruptos del formulario.
* **Contrato de Integración:** Documentado en [`CONTRATO_LOGIN_SCREEN.md`](CONTRATO_LOGIN_SCREEN.md).

---

## SE-10: Conectar Login móvil con Auth

### Resumen del Cambio
Se conectó de extremo a extremo la pantalla de inicio de sesión (`LoginScreen.tsx`) con el cliente de autenticación de backend provisto por `@ojoalgasto/shared` (`login`), el almacenamiento seguro nativo (`storageSeguro.ts`) y la navegación reactiva (`RootNavigator`). El sistema traduce de forma transparente las credenciales de entrada `{ correo, password }` al contrato backend DRF `{ email, password }`, almacena de forma persistente y cifrada tanto el `access_token` como el `refresh_token` en `SecureStore`, dispara la navegación automática a rutas privadas (`MainTabs`), recupera el usuario autorizado y su organización desde `/api/usuarios/me/`, y distingue estrictamente los fallos de credenciales de los errores de red o conectividad.

### Puntos Destacados
* **Traducción y Consumo Compartido:** Se consume la función `login()` de `@ojoalgasto/shared`, mapeando los datos de formulario al endpoint del Gateway `/api/auth/login/`.
* **Distinción Estricta de Errores (Criterio 1):**
  - **Credenciales inválidas (401):** Muestra el mensaje `"Usuario o contraseña inválidos"`. No guarda tokens ni navega.
  - **Fallo de conexión / transporte:** `esErrorDeRed(err)` adapta la falla con `MENSAJE_ERROR_RED` (`"No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo."`).
* **Persistencia Atómica y Reconstrucción del Usuario (Criterio 2):**
  - Al recibir 200 OK, `guardarTokensSeguros(tokens)` persiste `access_token`, `refresh_token` y `desfase_reloj_ms` en `SecureStore` nativo y memoria RAM.
  - El estado conmuta a `'autenticado'`, y `cargarPerfil()` consulta `/api/usuarios/me/` con `Bearer <access_token>`, hidratando el usuario con su `rol` (titular/integrante), `organizacion_id` y `plan`.
* **Contrato de Integración:** Documentado en [`CONTRATO_LOGIN_AUTH.md`](CONTRATO_LOGIN_AUTH.md).

---

## Matriz de Criterios de Aceptación

### SE-07: Cliente HTTP por Entorno
| Criterio | Estado | Evidencia |
|---|---|---|
| El build no contiene secretos en variables públicas | **CUMPLIDO** | `frontend/movil/.env.example` y `.env` limpios de credenciales backend. Test automatizado `src/services/clienteHttp.test.ts` valida que ninguna variable pública contenga patrones sensibles. |
| Login y API usan el mismo Gateway configurado | **CUMPLIDO** | `configurarClienteHttp()` configura de forma atómica `configurarApi` y `configureAuthApi`. Verificado con pruebas unitarias donde ambas utilidades apuntan al mismo host normalizado. |
| Evidencia enlazada y revisión por otra persona | **CUMPLIDO** | Documentado en [`CONTRATO_CLIENTE_HTTP.md`](CONTRATO_CLIENTE_HTTP.md) y 18 tests en `src/services/clienteHttp.test.ts`. |

### SE-08: Almacenamiento Seguro y Sesión Móvil
| Criterio | Estado | Evidencia |
|---|---|---|
| Reinicio recupera sesión sin leer `localStorage` web | **CUMPLIDO** | `hidratarSesionSegura()` lee tokens directamente desde `expo-secure-store` y puebla la memoria síncrona. Verificado en `AuthContext.test.tsx` ("reinicio: bootstrap con tokens válidos en SecureStore hidrata y recupera sesión"). Cero invocaciones a `localStorage`. |
| Logout limpia tokens persistentes y caché de datos privados | **CUMPLIDO** | `limpiarSesionSegura()` purga atómicamente la caché en memoria y ejecuta `deleteItemAsync` en `SecureStore`. Verificado en `storageSeguro.test.ts` y en `AuthContext.test.tsx` (logout manual y respuesta 401). |
| Evidencia enlazada y revisión por otra persona | **CUMPLIDO** | Contrato en [`CONTRATO_SESION_SEGURA.md`](CONTRATO_SESION_SEGURA.md), 7 tests en `src/services/storageSeguro.test.ts`, 13 tests en `context/AuthContext.test.tsx`. |

### SE-09: Pantalla Iniciar Sesión Móvil
| Criterio | Estado | Evidencia |
|---|---|---|
| Pantalla es usable con teclado abierto | **CUMPLIDO** | `KeyboardAvoidingView` evita oclusión en iOS/Android; `keyboardShouldPersistTaps="handled"` permite accionar botones al primer toque; foco encadenado de correo a contraseña vía ref en `onSubmitEditing`. Verificado en `src/screens/auth/LoginScreen.test.tsx`. |
| Errores y espera se presentan sin saltos ni envío duplicado | **CUMPLIDO** | Botón bloqueado con spinner y `disabled=true` durante `loading` (no permite llamadas duplicadas); contenedor de error accesible (`role="alert"`, `aria-live="polite"`) sin saltos bruscos de layout. Verificado en `src/screens/auth/LoginScreen.test.tsx`. |
| Evidencia enlazada y revisión por otra persona | **CUMPLIDO** | Contrato en [`CONTRATO_LOGIN_SCREEN.md`](CONTRATO_LOGIN_SCREEN.md), 12 tests en `src/screens/auth/LoginScreen.test.tsx`, suite de 70 tests móviles aprobada. |

### SE-10: Conectar Login móvil con Auth
| Criterio | Estado | Evidencia |
|---|---|---|
| Credenciales incorrectas y error de conexión tienen mensajes distintos | **CUMPLIDO** | 401 DRF entrega `"Usuario o contraseña inválidos"`; fallos de red (`Network request failed`) entregan `MENSAJE_ERROR_RED`. Validado en `src/screens/auth/LoginAuth.test.tsx` con pruebas de exclusión mutua. |
| Sesión iniciada persiste ambos tokens y recupera el usuario | **CUMPLIDO** | `SecureStore.getItemAsync` valida la presencia de `access_token` y `refresh_token`; `/usuarios/me/` hidrata el usuario autenticado con su rol, organización y plan, montando reactivamente la pestaña Home. |
| Evidencia enlazada y revisión por otra persona | **CUMPLIDO** | Contrato en [`CONTRATO_LOGIN_AUTH.md`](CONTRATO_LOGIN_AUTH.md), 6 tests en `src/screens/auth/LoginAuth.test.tsx`, suite de 70 tests móviles aprobada. |

---

## Tareas Desbloqueadas

| Tarea | Responsable | Impacto de la Integración (SE-07 a SE-10) |
|---|---|---|
| **SE-15** | Sebastian Mena | Dashboard de gastos consumiendo tokens seguros de sesión iniciada. |
| **SE-16** | Sebastian Mena | Listado de suscripciones consumiendo API autenticada mediante tokens Bearer. |
| **SE-19** | Sebastian Mena | Nueva suscripción con validaciones de servidor y manejo de errores de red. |
| **SE-21** | Sebastian Mena | Detalle móvil de suscripción con `getSuscripcion()` y reintentos. |
| **SE-23** | Sebastian Mena | Creación móvil con `crearSuscripcion()`. |
| **SE-25** | Sebastian Mena | Actualización con `actualizarSuscripcion()` y feedback de error. |
| **AN-03** | Andrea Travola | Perfil móvil consumiendo `getUsuarioActual()`. |
| **AN-19** | Andrea Travola | Métricas y gráficos móviles con sesión autenticada. |

---

## Evidencia de Pruebas y Tipos

### 1. Pruebas de Integración Login con Auth (SE-10)
```bash
npm test --workspace=movil -- src/screens/auth/LoginAuth.test.tsx
```
```
 ✓ src/screens/auth/LoginAuth.test.tsx (6)
   ✓ Conectar Login móvil con Auth (SE-10) (6)
     ✓ Criterio 1: Distinción entre credenciales incorrectas y error de conexión (3)
       ✓ credenciales incorrectas (401) muestra mensaje específico de usuario/clave inválidos
       ✓ error de conexión física (Network request failed) muestra mensaje específico de red y conexión
       ✓ los mensajes de credenciales y conexión son mutuamente excluyentes y claramente distintos
     ✓ Criterio 2: Persistencia de ambos tokens y recuperación del usuario (3)
       ✓ traduce correo a email en payload HTTP hacia /auth/login/
       ✓ persiste ambos tokens (access y refresh) en SecureStore y memoria al iniciar sesión
       ✓ recupera el usuario autorizado desde /usuarios/me/ y navega a rutas privadas
```
**Resultado:** 6/6 aprobadas.

### 2. Suite Completa del Espacio de Trabajo Móvil (70 Pruebas)
```bash
npm test --workspace=movil
```
```
 Test Files  6 passed (6)
      Tests  70 passed (70)
   Duration  10.89s
```
*6 archivos de prueba:*
- `clienteHttp.test.ts` (18 tests - SE-07)
- `storageSeguro.test.ts` (7 tests - SE-08)
- `AuthContext.test.tsx` (13 tests - SE-08)
- `navigation.test.tsx` (14 tests - SE-06)
- `LoginScreen.test.tsx` (12 tests - SE-09)
- `LoginAuth.test.tsx` (6 tests - SE-10)

### 3. Verificación Estática de Tipos
```bash
npm run typecheck
```
**Resultado:** 0 errores de TypeScript en los tres workspaces (`shared`, `web`, `movil`).
