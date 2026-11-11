# Contrato de Integración y Evidencia: SE-17

**Tarjeta:** SE-17: Construir Home móvil de suscripciones  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P1  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** SE-06 (Configurar navegación principal móvil), AN-28 (Crear estados reutilizables para pantallas móviles)  

---

## 1. Resumen de Implementación (SE-17)

- **Estructura visual y base funcional (inspirada en Web):**
  - Se implementó `HomeScreen.tsx` y su hoja de estilos modular [`HomeScreen.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.styles.ts).
  - Incluye encabezado con saludo y usuario autenticado, barra de acciones principales ("Crear Nueva Suscripción" y "Cerrar Sesión") y resumen de gasto mensual proyectado calculado con `gastosPorMoneda` y formateado con `formatearTotales` de `@ojoalgasto/shared`.
- **Componente de Tarjeta Móvil ([`TarjetaSuscripcionMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/TarjetaSuscripcionMovil.tsx)):**
  - Muestra nombre, categoría, avatar con inicial, monto y divisa (`formatearMonto`), frecuencia y próximo cobro (`formatearFecha`).
  - Badge accesible con colores de estado contrastantes: `activo` (Activa), `prueba` (Prueba), `fantasma` (Sin uso), `por_confirmar` (Por confirmar), `cancelado` (Cancelada).
- **Integración con AN-28 (`ContenidoConEstado`):**
  - La pantalla maneja limpiamente los estados `cargando` (`Loading` con progressbar), `error` (`NetworkError` con alerta y reintento), `vacio` (`EmptyState` con acción directa para crear suscripción) y `listo` (`FlatList` con optimizaciones de rendimiento y accesibilidad).
- **Cero duplicación de tipos y sin lógica de dominio redundante:**
  - Se reutilizan estrictamente los tipos del dominio (`Suscripcion`, `EstadoSuscripcion`, `Usuario`, `EstadoCarga`) y funciones de cálculo de `@ojoalgasto/shared`.
  - La arquitectura desacopla el componente presentacional puro (`HomeView`) del contenedor (`HomeScreen`) para permitir inyección de estados y pruebas unitarias aisladas.
- **Rendimiento y accesibilidad:**
  - `FlatList` con `keyExtractor={(item) => item.id}`, `initialNumToRender={10}`, `maxToRenderPerBatch={10}`, `windowSize={5}`.
  - Roles nativos `accessibilityRole="button"`, `accessibilityRole="header"`, `accessibilityRole="list"`, y etiquetas descriptivas completas para lectores de pantalla.
- **Compatibilidad total:**
  - Mantiene compatibilidad con los testIDs existentes de la suite de navegación (`screen-home`, `go-detalle`, `go-nueva-suscripcion`, `logout`).

---

## 2. Criterios de Aceptación Verificados

- [x] **Pantalla acepta datos y callbacks sin lógica de dominio duplicada:**  
  `HomeView` opera como componente presentacional puro recibiendo `estado`, `usuario`, `onSuscripcionPress`, `onNuevaSuscripcion`, `onReintentar` y `onLogout`.
- [x] **Rendimiento y accesibilidad son adecuados para listas de prueba:**  
  Listado basado en `FlatList` optimizado con `keyExtractor`, sin renderizado superfluo y con roles de accesibilidad semánticos para lectores de pantalla.
- [x] **Evidencia enlazada y revisión por otra persona:**  
  12 pruebas automatizadas en `HomeScreen.test.tsx` y 17 pruebas de integración en `navigation.test.tsx` aprobadas sin fallos.

---

## 3. Matriz de Verificación y Pruebas Automatizadas

Comandos ejecutados:
```bash
npm test --workspace=movil -- src/screens/home/HomeScreen.test.tsx
npm run typecheck
npm test --workspace=movil
```

- **Pruebas de SE-17 (`HomeScreen.test.tsx`):** 12/12 pasadas
  1. `renderiza encabezado con título, usuario y botones de acción principales`
  2. `renderiza resumen de gasto mensual proyectado y total de suscripciones`
  3. `renderiza lista de tarjetas con nombre, categoría, monto y badge de estado`
  4. `dispara onSuscripcionPress con los datos de la suscripción al pulsar una tarjeta`
  5. `dispara onNuevaSuscripcion al presionar el botón de acción Crear Nueva Suscripción`
  6. `dispara onLogout al presionar el botón de Cerrar Sesión`
  7. `muestra estado cargando (Loading con progressbar) cuando tipo es cargando`
  8. `muestra estado error (NetworkError con alert) y reintenta con onReintentar`
  9. `muestra estado vacio (EmptyState) con acción para crear suscripción`
  10. `navega a SuscripcionDetalle con id al presionar una suscripción`
  11. `navega a SuscripcionNueva al presionar botón Crear Nueva Suscripción`
  12. `soporta recarga mediante onCargarSuscripciones en reintento`

- **Suite completa móvil:** 13 archivos de prueba pasados (13/13), **191 pruebas aprobadas (191/191)**.
- **Verificación de tipos:** `tsc --noEmit` completado con 0 errores en monorepo (`shared`, `web`, `movil`, `desktop`).

---

## 4. Ejemplo de Consumo del Contrato

### 1. Uso en el navegador de la aplicación (`HomeNavigator.tsx`):
```tsx
import HomeScreen from '../screens/home/HomeScreen';

<Stack.Screen
  name="HomeScreen"
  component={HomeScreen}
  options={{ title: 'Suscripciones' }}
/>
```

### 2. Uso desacoplado en tareas dependientes (SE-19: Conexión Paginada o SE-20: Vacío):
```tsx
import { HomeView } from './HomeScreen';
import type { EstadoCarga, Suscripcion } from '@ojoalgasto/shared';

export function HomeConectado({ estado, onRecargar, navigation }) {
  return (
    <HomeView
      estado={estado}
      usuario={usuario}
      onSuscripcionPress={(s) => navigation.navigate('SuscripcionDetalle', { id: s.id })}
      onNuevaSuscripcion={() => navigation.navigate('SuscripcionNueva')}
      onReintentar={onRecargar}
      onLogout={() => auth.cerrarSesion()}
    />
  );
}
```
