# PR: Implementación Móvil Sprint 3 — SE-14, SE-17 y SE-18

**Rama:** `SE_1X`  
**Responsable:** Sebastian Mena  
**Tarjetas:** 
- `SE-14`: Solicitar recuperación desde móvil (P1 / Must)
- `SE-17`: Construir Home móvil de suscripciones (P1 / Must)
- `SE-18`: Crear tarjeta móvil de suscripción (P1 / Must)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen de Cambios

### SE-14: Solicitar recuperación desde móvil
- **Pantalla y formulario de recuperación:** Creación de `RecuperarContrasenaScreen.tsx` y `RecuperarContrasenaScreen.styles.ts` en `src/screens/auth/`.
- **Confirmación neutra (anti-enumeración):** `RecuperarContrasenaConfirmacionView` despliega el mismo feedback informativo sin revelar si la cuenta existe o no en el sistema.
- **Tolerancia a fallos de red:** Captura excepciones con `isNetworkError`, finaliza el estado de carga al instante, muestra error de red amigable en español y preserva el correo para reintentar de inmediato.
- **Accesibilidad y navegación:** Soporte para botón físico de retroceso en Android (`BackHandler`), roles semánticos y botones para volver a Login.

### SE-17: Construir Home móvil de suscripciones
- **Estructura y presentación de Home:** Implementación de `HomeScreen.tsx` y `HomeScreen.styles.ts` con diseño visual inspirado en la versión web.
- **Integración de estados con AN-28:** Consumo de `ContenidoConEstado` para manejar de forma desacoplada los estados `cargando` (`Loading`), `error` (`NetworkError` con reintento), `vacio` (`EmptyState` con botón para crear suscripción) y `listo` (`FlatList`).
- **Resumen financiero:** Cálculo del gasto mensual proyectado (`gastosPorMoneda`) y formato por divisas (`formatearTotales`) desde `@ojoalgasto/shared`.
- **Consumo real de la API:** La pantalla invoca `getSuscripciones()` al montarse; se eliminaron completamente suscripciones falsas o datos hardcodeados en el componente.

### SE-18: Crear tarjeta móvil de suscripción
- **Componente transversal `TarjetaSuscripcion`:** Creado en `src/screens/components/TarjetaSuscripcion.tsx` con estilos desacoplados en `TarjetaSuscripcion.styles.ts`.
- **Protección contra desbordes:** Uso de `flexShrink: 1`, `minWidth: 0` y `numberOfLines={1}` con `ellipsizeMode="tail"` en nombres y categorías extensas; el bloque de monto e importe cuenta con `flexShrink: 0`, garantizando que nunca se comprima ni oculte.
- **Estado sin depender únicamente del color:** Cada estado (`activo`, `prueba`, `fantasma`, `por_confirmar`, `cancelado`) cuenta con etiqueta textual explícita en pantalla ("Activa", "Prueba gratis", "Sin uso", "Por confirmar", "Cancelada") y anuncio verbalizado en `accessibilityLabel`.
- **Valores opcionales:** Tratamiento explícito de `horas_uso_mes` (mostrando costo por hora vía `costoPorHora`), `fin_prueba` ("Prueba termina: <fecha>"), estado cancelado ("Sin cobros pendientes") y fallback seguro para categorías ausentes ("General").
- **Área táctil accesible:** Contenedor interactivo (`Pressable`) con altura mínima superior a 48 dp, sugerencia accesible `accessibilityHint` y re-exportación limpia en `TarjetaSuscripcionMovil.tsx` sin duplicación de código.

---

## 2. Criterios de Aceptación Verificados

### SE-14
- [x] Solicitud genera feedback sin revelar existencia de cuenta (anti-enumeración).
- [x] Caída de red termina la espera y permite reintentar.
- [x] Evidencia y contrato documentados en `CONTRATO_RECUPERAR_CONTRASENA_SE14.md`.

### SE-17
- [x] Pantalla acepta datos y callbacks sin lógica de dominio duplicada (usa funciones de `shared`).
- [x] Rendimiento y accesibilidad adecuados para listas (uso de `FlatList` con `keyExtractor` y roles accesibles).
- [x] Evidencia y contrato documentados en `CONTRATO_HOME_SUSCRIPCIONES_SE17.md`.

### SE-18
- [x] Textos largos no ocultan monto ni acciones.
- [x] Estado no se comunica solo con color (etiquetas textuales y accesibilidad para todos los estados).
- [x] Evidencia y contrato documentados en `CONTRATO_TARJETA_SUSCRIPCION_SE18.md`.

---

## 3. Pruebas y Evidencia de Verificación

Comandos de validación ejecutados:
```bash
npm run typecheck
npm test --workspace=movil
```

- **Cobertura de suites agregadas:**
  - `RecuperarContrasenaScreen.test.tsx`: 13 pruebas aprobadas.
  - `HomeScreen.test.tsx`: 13 pruebas aprobadas.
  - `TarjetaSuscripcion.test.tsx`: 15 pruebas aprobadas.
  - `navigation.test.tsx`: 17 pruebas de integración aprobadas.
- **Resultado global en móvil:** 14 suites pasadas, **207/207 pruebas aprobadas**.
- **Chequeo de tipos:** 0 errores de TypeScript en todo el monorepo (`shared`, `web`, `movil`, `desktop`).

---

## 4. Archivos Modificados y Creados

```
frontend/movil/
├── docs/
│   ├── CONTRATO_RECUPERAR_CONTRASENA_SE14.md
│   ├── CONTRATO_HOME_SUSCRIPCIONES_SE17.md
│   ├── CONTRATO_TARJETA_SUSCRIPCION_SE18.md
│   └── PR_SPRINT3_SE14_SE17_SE18.md
├── src/
│   ├── navigation/
│   │   └── navigation.test.tsx
│   └── screens/
│       ├── auth/
│       │   ├── RecuperarContrasenaScreen.styles.ts
│       │   ├── RecuperarContrasenaScreen.test.tsx
│       │   └── RecuperarContrasenaScreen.tsx
│       ├── components/
│       │   ├── TarjetaSuscripcion.styles.ts
│       │   ├── TarjetaSuscripcion.test.tsx
│       │   └── TarjetaSuscripcion.tsx
│       └── home/
│           ├── HomeScreen.styles.ts
│           ├── HomeScreen.test.tsx
│           ├── HomeScreen.tsx
│           └── TarjetaSuscripcionMovil.tsx
└── test/
    └── react-native-shim.tsx
```
