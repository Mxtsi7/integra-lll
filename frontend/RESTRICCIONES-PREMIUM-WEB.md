# Restricciones y Permisos de Planes Premium en Web (SE-02)

## 1. Identificación y Responsable
- **Código de tarea:** S3-SE-02 (reutiliza SE-02)
- **Título:** Mostrar restricciones Premium en web
- **Responsable:** Sebastian Mena
- **Sprint:** 3
- **Prioridad:** Must (P1)
- **Estado:** Implementado y verificado

---

## 2. Alcance Concreto y Objetivos
1. Resolver la política de plan y features de manera transversal y reutilizable para las vistas de la aplicación web:
   - **Perfil** (`PerfilPage` / MX-08)
   - **Ajustes** (`ConfiguracionPage`)
   - **Asistente Financiero / Chat** (`AsistentePage` / S3-CH-14, S3-CH-15, S3-CH-16)
2. Eliminar textos fijos o estados hardcodeados ("Plan Gratuito") en Perfil y Ajustes, mostrando siempre el plan vigente real reportado por el servidor.
3. Garantizar un modelo seguro por omisión (*fail-closed*): ante estados de carga o fallos de red/servidor en la consulta de permisos, el sistema nunca concede privilegios Premium por defecto; en caso de fallo, se explica el rechazo y se ofrece reintento.
4. Proveer la base que consume la tarea de chat (S3-CH-16), permitiendo bloquear la interacción del asistente financiero para usuarios con plan gratuito sin duplicar la política de validación ni los estilos de bloqueo.
5. Recordar que las restricciones visuales en el cliente son un mecanismo de experiencia de usuario; la seguridad real es forzada por el backend mediante códigos de estado HTTP 403 Forbidden.

---

## 3. Endpoints y Contratos de Integración

### `GET /api/usuarios/me/permisos/`
Contrato expuesto por `PermisosPlanView`:
```json
{
  "plan": "free",
  "features": {
    "asistente_financiero": false,
    "recomendaciones_automaticas": false
  }
}
```
Para plan premium:
```json
{
  "plan": "premium",
  "features": {
    "asistente_financiero": true,
    "recomendaciones_automaticas": true
  }
}
```

### `GET /api/usuarios/me/`
Contrato expuesto por `UsuarioActualSerializer`:
```json
{
  "id": 1,
  "nombre": "Ana Pérez",
  "correo": "ana@ejemplo.com",
  "rol": "titular",
  "organizacion_id": "org-1",
  "plan": "free"
}
```

---

## 4. Arquitectura y Componentes Implementados

### 4.1. Shared (`@ojoalgasto/shared`)
- **Archivo:** `frontend/shared/src/api/planes.ts`
- **Funcionalidades:**
  - `NOMBRES_FEATURES`: mapeo tipado y legible de nombres de features (`asistente_financiero` -> "Asistente financiero", `recomendaciones_automaticas` -> "Recomendaciones automáticas").
  - `FEATURES_PREMIUM`: lista de features exclusivas del plan Premium.
  - `leerPermisos(datos)`: parser defensivo que normaliza respuestas del backend, tolera datos corruptos o incompletos y garantiza tipado estricto.
  - `incluyeFeature(permisos, feature)`: verificación booleana estricta de acceso a un feature (*fail-closed*).
  - `esPlanPremium(plan)`: determina si un identificador de plan corresponde a Premium (`'premium'`).
  - `describirPlan(plan)`: retorna la etiqueta amigable ("Plan Premium" o "Plan Gratuito").
  - `describirDetallePlan(plan)`: retorna la descripción de capacidades del plan.
- **Pruebas:** `frontend/shared/src/api/planes.test.ts` (12 casos de prueba unitarios).

### 4.2. Hook Transversal en Web (`web`)
- **Archivo:** `frontend/web/src/hooks/usePermisosPlan.ts`
- **Funcionalidades:**
  - Consulta `GET /api/usuarios/me/permisos/` utilizando el token de sesión vigente.
  - Sincroniza y aísla la carga de permisos con el ciclo de vida de la sesión (evita condiciones de carrera entre cambios de usuario o sesiones revocadas).
  - Expone `{ cargando, error, plan, features, tieneFeature, esPremium, nombrePlan, detallePlan, reintentar }`.
  - Mantiene retrocompatibilidad con la firma anterior `{ estado, reintentar }`.
- **Pruebas:** `frontend/web/src/hooks/usePermisosPlan.test.tsx` (6 pruebas de integración de ciclo de vida, sesión y reintentos).

### 4.3. Componente UI `BloqueoPremium` (`web`)
- **Archivo:** `frontend/web/src/components/planes/BloqueoPremium.tsx` y `BloqueoPremium.module.css`
- **Funcionalidades:**
  - Envuelve cualquier componente o vista que requiera permisos Premium.
  - Si el usuario cuenta con el feature activo, renderiza los `children` sin interferencias.
  - Si está cargando los permisos, presenta un indicador accesible de carga (`Spinner` con mensaje explicativo).
  - Si ocurre un error de transporte o servidor, renderiza `ErrorConReintento` para volver a consultar los permisos sin asumir privilegios.
  - Si el usuario no tiene la suscripción requerida, muestra la tarjeta de restricción con descripción de beneficios y botón/enlace de mejora a Premium.
  - Se exporta también `BloqueoPremiumAuto` para vistas que deseen instanciar el hook internamente de forma declarativa.
- **Pruebas:** `frontend/web/src/components/planes/BloqueoPremium.test.tsx` (5 pruebas de interfaz y accesibilidad).

### 4.4. Integración en Pantallas

#### Asistente Financiero (`AsistentePage.tsx`)
- Envuelve el chat interactivo (`ChatAsistente`) con `BloqueoPremium` verificando el feature `asistente_financiero`.
- El chat queda completamente protegido en el cliente frente a planes gratuitos, complementando la protección 403 del gateway.

#### Ajustes / Configuración (`ConfiguracionPage.tsx`)
- Reemplaza el bloque estático "Plan Gratuito" por el hook reactivo `usePermisosPlan`.
- Maneja estados de carga ("Comprobando plan…"), error con reintento y presentación dinámica de plan vigente con enlace de suscripción a `/perfil`.

#### Perfil (`PerfilPage.tsx`)
- Utiliza las funciones unificadas `describirPlan`, `describirDetallePlan` y `esPlanPremium` basadas en los datos de usuario del backend (`GET /api/usuarios/me/`), garantizando consistencia semántica en toda la plataforma.

---

## 5. Resumen de Pruebas y Evidencia

| Suite de Pruebas | Archivo | Casos | Estado |
| :--- | :--- | :---: | :---: |
| Reglas puras de planes | `shared/src/api/planes.test.ts` | 12 | Aprobado |
| Hook de permisos y sesión | `web/src/hooks/usePermisosPlan.test.tsx` | 6 | Aprobado |
| Componente BloqueoPremium | `web/src/components/planes/BloqueoPremium.test.tsx` | 5 | Aprobado |
| Asistente Financiero (con bloqueo) | `web/src/pages/AsistentePage.premium.test.tsx` | 6 | Aprobado |
| Asistente Financiero (regresiones) | `web/src/pages/AsistentePage.test.tsx`, `.sesion.test.tsx` | 12 | Aprobado |
| Ajustes / Configuración (Plan) | `web/src/pages/ConfiguracionPage.plan.test.tsx` | 4 | Aprobado |
| Ajustes / Configuración (Eliminar) | `web/src/pages/ConfiguracionPage.eliminar.test.tsx` | 2 | Aprobado |
| Perfil de Usuario | `web/src/pages/PerfilPage.test.tsx` | 20 | Aprobado |
