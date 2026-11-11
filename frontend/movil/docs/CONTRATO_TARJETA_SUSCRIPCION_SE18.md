# Contrato de Integración y Evidencia: SE-18

**Tarjeta:** SE-18: Crear tarjeta móvil de suscripción  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P1  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** SE-05 (Inicializar app móvil Expo y comprobar arranque)  
**Desbloquea:** SE-19 (Conectar listado móvil paginado), SE-21 (Construir Detalle móvil de suscripción)  

---

## 1. Resumen de Implementación (SE-18)

- **Componente Reutilizable ([`TarjetaSuscripcion.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/components/TarjetaSuscripcion.tsx)):**
  - Implementado en `src/screens/components/` para consumo transversal entre listados y pantallas móviles.
  - Presenta: nombre de la suscripción, categoría, avatar con inicial, monto y divisa (`formatearMonto`), frecuencia (`sufijoFrecuencia`: `/mes` o `/año`), fecha de cobro (`formatearFecha`) y estado explícito.
- **Prevención de desbordes con textos largos:**
  - `nombreTexto` y `categoriaTexto` utilizan `numberOfLines={1}`, `ellipsizeMode="tail"` y `flexShrink: 1` con `minWidth: 0`.
  - El bloque de monto tiene `flexShrink: 0`, garantizando que nombres o categorías extremadamente largas nunca compriman, desplacen ni oculten el monto ni el badge de estado.
- **Estado comunicado con texto y alto contraste (No solo color):**
  - Cada estado del dominio (`activo`, `prueba`, `fantasma`, `por_confirmar`, `cancelado`) cuenta con texto legible explícito en pantalla ("Activa", "Prueba gratis", "Sin uso", "Por confirmar", "Cancelada") y colores contrastantes según pautas WCAG.
  - El lector de pantalla recibe verbalmente la descripción del estado mediante `accessibilityLabel` (`"estado: Activa"`, etc.).
- **Tratamiento explícito de valores opcionales:**
  - `fin_prueba`: Para suscripciones en estado `prueba`, muestra "Prueba termina: <fecha>" en lugar del cobro regular.
  - `horas_uso_mes`: Si está definido y es mayor a 0, calcula y despliega el costo por hora usando `costoPorHora` y `formatearHoras` de `@ojoalgasto/shared`.
  - `categoria`: Si no viene definida o es vacía, aplica fallback seguro `"General"`.
  - `cancelado`: Si el estado es cancelado, muestra explícitamente `"Sin cobros pendientes"`.
- **Área táctil y accesibilidad:**
  - La tarjeta completa actúa como un `Pressable` táctil de más de 48 dp con `accessibilityRole="button"`, sugerencia accesible `accessibilityHint` y retroalimentación interactiva al pulsar (`onPress`).
- **Sin datos hardcodeados y retrocompatibilidad limpia:**
  - Se eliminaron verificaciones hardcodeadas de IDs o usuarios ficticios.
  - [`TarjetaSuscripcionMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/TarjetaSuscripcionMovil.tsx) re-exporta `TarjetaSuscripcion` directamente, manteniendo compatibilidad con `HomeScreen` sin duplicar tipos ni código.

---

## 2. Criterios de Aceptación Verificados

- [x] **Textos largos no ocultan monto ni acciones:**  
  Probado con nombres extensos corporativos; el monto y las insignias preservan su tamaño y visibilidad completa mediante layout flex optimizado.
- [x] **Estado no se comunica solo con color:**  
  Todos los estados del dominio poseen etiquetas textuales explícitas y anuncios accesibles en el árbol de accesibilidad.
- [x] **Evidencia enlazada y revisión por otra persona:**  
  15 pruebas unitarias en `TarjetaSuscripcion.test.tsx` y 12 pruebas en `HomeScreen.test.tsx` aprobadas con 0 fallos.

---

## 3. Matriz de Verificación y Pruebas Automatizadas

Comandos ejecutados:
```bash
npm test --workspace=movil -- src/screens/components/TarjetaSuscripcion.test.tsx
npm run typecheck
npm test --workspace=movil
```

- **Pruebas de SE-18 (`TarjetaSuscripcion.test.tsx`):** 15/15 pasadas
  1. `renderiza nombre, categoría, monto formateado, frecuencia y próximo cobro`
  2. `formatea correctamente suscripciones anuales con sufijo /año`
  3. `suscripción con nombre y categoría extremadamente largos conserva el monto y badge visibles`
  4. `para estado "activo" muestra el texto explícito "Activa" y lo anuncia en accesibilidad`
  5. `para estado "prueba" muestra el texto explícito "Prueba gratis" y lo anuncia en accesibilidad`
  6. `para estado "fantasma" muestra el texto explícito "Sin uso" y lo anuncia en accesibilidad`
  7. `para estado "por_confirmar" muestra el texto explícito "Por confirmar" y lo anuncia en accesibilidad`
  8. `para estado "cancelado" muestra el texto explícito "Cancelada" y lo anuncia en accesibilidad`
  9. `muestra costo por hora cuando horas_uso_mes está presente y es mayor a 0`
  10. `no muestra costo por hora cuando horas_uso_mes no está definido o es 0`
  11. `muestra "Sin cobros pendientes" explícitamente cuando estado es cancelado`
  12. `muestra "Prueba termina: <fecha>" cuando estado es prueba y tiene fin_prueba`
  13. `usa fallback "General" si categoria viene vacía`
  14. `dispara onPress con la suscripción completa al presionar el área táctil`
  15. `permite sobreescribir el testID si se especifica explícitamente`

- **Suite completa móvil:** 14 archivos de prueba pasados (14/14), **206 pruebas aprobadas (206/206)**.
- **Chequeo de tipos:** `tsc --noEmit` sin errores en todo el monorepo (`shared`, `web`, `movil`, `desktop`).

---

## 4. Ejemplo de Consumo del Contrato

```tsx
import { TarjetaSuscripcion } from '../components/TarjetaSuscripcion';
import type { Suscripcion } from '@ojoalgasto/shared';

export function MiListaSuscripciones({ suscripciones, onSeleccionar }: {
  suscripciones: Suscripcion[];
  onSeleccionar: (s: Suscripcion) => void;
}) {
  return (
    <FlatList
      data={suscripciones}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TarjetaSuscripcion
          suscripcion={item}
          onPress={onSeleccionar}
        />
      )}
    />
  );
}
```
