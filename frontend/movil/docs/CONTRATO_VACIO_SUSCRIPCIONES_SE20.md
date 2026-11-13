# Contrato de Integración y Evidencia: SE-20

**Tarjeta:** SE-20: Mostrar vacío móvil y acceso a primera suscripción  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P1  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** SE-17 (Construir Home móvil de suscripciones), AN-28 (Crear estados reutilizables para pantallas móviles)  
**Entrega a:** SE-21 (Diseñar formulario móvil de suscripción), QA-04 (Validar flujos principales en móvil)  

---

## 1. Resumen de Implementación (SE-20)

- **Paridad de experiencia con Home Web (`frontend/web/src/pages/Homepage.tsx` y `EmptyState.tsx`):**
  - Se adaptó el estado vacío para alinearse conceptual y textualmente con la web:
    - **Título:** *"Todavía no registras suscripciones"* (con `accessibilityRole="header"`).
    - **Descripción orientativa:** *"Agrega la primera y empieza a ver cuánto gastas al mes, qué cobros vienen y cuáles pagas sin usar."*
    - **Acción (CTA):** Botón *"Agregar suscripción"* configurado con variante primaria (`variante: 'primario'`), utilizando los colores de acento ya definidos en `estilos.ts` (`COLORES_ESTADOS.acento`), tamaño táctil mínimo de 44px y etiqueta accesible.
- **Mejora en componente reutilizable `EmptyState` (`frontend/movil/src/components/estados/EmptyState.tsx`):**
  - Soporte para `testID` en el contenedor y en el botón de acción (`testID: 'empty-state-home'`, `testID: 'btn-crear-primera-suscripcion'`).
  - Soporte para propiedad opcional `variante?: 'primario' | 'porDefecto'`, aplicando las clases `estilos.botonPrimario` y `estilos.botonTextoPrimario` cuando se indique.
- **Separación estricta de estados mediante `ContenidoConEstado` y `vistaDeEstado`:**
  - **Fallo de red / error HTTP:** Si la llamada a `getSuscripciones()` falla (rechazo de promesa, 500, timeout), el estado conmuta a `{ tipo: 'error' }`. `ContenidoConEstado` renderiza `<NetworkError />` con `role="alert"` y opción de reintento. **Bajo ninguna circunstancia se muestra el estado vacío ante un fallo de red.**
  - **Estado cargando:** Durante la petición inicial o reintento, el estado es `{ tipo: 'cargando' }`, mostrando `<Loading />` con `role="progressbar"`, sin presentar estado vacío.
  - **Lista vacía legítima:** Solo cuando el backend responde exitosamente con `datos: []`, `esVacio(datos)` evalúa `true` y se renderiza la instrucción útil con el CTA primario.
  - **Ocultamiento de resumen y lista:** Cuando la cuenta no tiene suscripciones, los módulos de proyección mensual (`resumen-gastos`) y el listado (`lista-suscripciones`) permanecen ocultos para enfocar la pantalla en la acción de inicio.
- **Conexión de navegación tipada:**
  - Al pulsar el CTA *"Agregar suscripción"* (`btn-crear-primera-suscripcion`), se ejecuta `onNuevaSuscripcion`, que navega de forma tipada a la ruta `'SuscripcionNueva'` del stack privado `HomeStackParamList`.

---

## 2. Criterios de Aceptación Verificados

- [x] **Cuenta sin suscripciones ve instrucción útil:**  
  La pantalla presenta título claro y descripción informativa que explica el valor del sistema (control mensual, cobros futuros, suscripciones sin uso) y dispone de un botón CTA accesible y destacado para agregar la primera suscripción.
- [x] **Un fallo de red no se presenta como cuenta vacía:**  
  Cualquier error de conexión o del servidor activa `NetworkError` con `role="alert"` y botón de reintento. Las pruebas verifican que en fallo de red no existe `empty-state-home` ni el botón de creación de suscripción.
- [x] **Evidencia enlazada y revisión por otra persona; contrato validado:**  
  Contrato formalizado para receptores SE-21 (formulario de alta móvil) y QA-04 (validación de flujos). Suite de pruebas automatizadas completa con 212 pruebas aprobadas en el workspace móvil y typecheck limpio.

---

## 3. Matriz de Pruebas Automatizadas

Comandos ejecutados:
```bash
npm test --workspace=movil -- src/screens/home/HomeScreen.test.tsx
npm run typecheck
npm test --workspace=movil
```

Resultados en `HomeScreen.test.tsx` (18/18 pruebas aprobadas):
- **Criterio 1:**
  - `muestra encabezado, descripción de valor basada en web y CTA primario sin mostrar lista ni resumen`
  - `muestra estado vacio (EmptyState) con acción para crear suscripción`
- **Criterio 2:**
  - `en estado error muestra NetworkError con role="alert" y NUNCA el estado vacío ni su CTA`
  - `en estado cargando muestra Loading con role="progressbar" y NUNCA el estado vacío`
  - `en contenedor HomeScreen: caída de API muestra error y al reintentar exitoso con [] muestra vacío`
- **Navegación:**
  - `navega a SuscripcionNueva al pulsar el CTA del estado vacío en HomeScreen`

Resultado global del workspace móvil:
- **14/14 suites aprobadas** (212 pruebas pasadas, 0 fallos).
- **TypeScript `tsc --noEmit`**: 0 errores en `@ojoalgasto/shared`, `web`, `movil` y `desktop`.

---

## 4. Contrato de Interfaz para SE-21 y QA-04

### Entradas y Salidas de `EmptyState`
```typescript
export interface EmptyStateProps {
  titulo: string;
  descripcion?: string;
  accion?: {
    etiqueta: string;
    onPress: () => void;
    variante?: 'primario' | 'porDefecto';
    testID?: string;
  };
  testID?: string;
}
```

### Contrato de Navegación hacia SE-21
- **Ruta destino:** `SuscripcionNueva`
- **Parámetros:** `undefined` (sin parámetros iniciales)
- **Stack:** `HomeStackParamList` (`HomeScreen` -> `SuscripcionNueva`)
