# Contrato de Integración y Evidencia: SE-21

**Tarjeta:** SE-21: Construir Detalle móvil de suscripción  
**Responsable:** Sebastian Mena  
**Sprint:** Sprint 3  
**Tipo:** CÓDIGO  
**Prioridad:** P1  
**Estado:** COMPLETADO Y VERIFICADO  
**Dependencias satisfechas:** SE-06 (Configurar navegación principal móvil), SE-07 (Configurar cliente HTTP móvil por entorno), SE-18 (Crear tarjeta móvil de suscripción)  
**Esta tarea desbloquea / Entrega a:**  
- **SE-24 (Sebastian Mena):** Crear formulario móvil de edición (`onEditar`)  
- **SE-26 (Sebastian Mena):** Confirmar retiro y ejecutar DELETE móvil (`onEliminar`)  
- **SE-28 (Sebastian Mena):** Registrar minutos de uso desde móvil (`onRegistrarUso`)  
- **SE-30 (Sebastian Mena):** Mostrar historial móvil de uso por fecha (`seccion-historial-uso`)  
- **QA-04:** Validar flujos principales en móvil  

---

## 1. Resumen de Implementación (SE-21)

- **Consulta y obtención de datos propios (`getSuscripcion(id)`):**
  - La pantalla [`SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx) obtiene el parámetro `id` tipado desde `route.params`.
  - Consume la función de dominio `getSuscripcion(id)` de `@ojoalgasto/shared`, mapeando los datos de la API mediante `desdeLaApi` sin duplicación de lógica ni modelos.
  - El componente contenedor permite la inyección de `onCargarSuscripcion` y `estadoInicial` para pruebas unitarias aisladas sin acoplamiento a la red física.
- **Presentación de datos y estados (`SuscripcionDetalleView`):**
  - **Encabezado:** Nombre de suscripción (`accessibilityRole="header"`), categoría, identificador visible para trazabilidad y soporte (`ID Suscripción: ${id}`) y botón de retorno seguro `"Volver a la lista"` (`testID="go-back"`).
  - **Tarjeta principal:** Monto recurrente formateado con su divisa (`formatearMonto`), sufijo de frecuencia (`/mes` o `/año`) y badge de estado accesible con texto explícito y contraste WCAG (Activa, Prueba gratis, Sin uso, Por confirmar, Cancelada).
  - **Equivalencia mensual:** Para suscripciones de periodicidad anual, calcula y muestra automáticamente el equivalente mensual (`equivalenteMensual`).
  - **Aviso de suscripción fantasma:** Cuando `estado === 'fantasma'`, despliega un contenedor de aviso (`testID="aviso-fantasma"`) informando que lleva más de 45 días sin uso y cuantificando el ahorro mensual al retirarla.
  - **Cuadrícula de detalles:** Próximo cobro formateado según el estado (`formatearTextoCobro`), periodicidad, horas de uso registradas en el mes actual (`formatearHoras`) y costo por hora calculado (`costoPorHora`).
- **Tratamiento seguro de errores 404, 403 y fallos de red (Seguridad y Privacidad):**
  - **404 (Suscripción inexistente / retirada):** Muestra mensaje neutro: *"No encontramos esa suscripción. Puede que haya sido eliminada."* No revela información privada ni rompe la navegación; incluye botón de retorno a la lista (`testID="go-back"`).
  - **403 (Suscripción ajena / sin permiso):** Muestra mensaje seguro: *"No tienes permiso para ver esta suscripción."* Protege la privacidad multi-organización y no revela existencia ni datos de recursos de terceros. Incluye botón de retorno a la lista (`testID="go-back"`).
  - **Fallo de red / Error 500:** Muestra componente `NetworkError` (`role="alert"`) con botón para reintentar la carga y botón para volver a la lista sin atrapar al usuario.
- **Protección de respuestas por generación e ID activo (concurrencia y desmontaje):**
  - Cada petición genera una nueva generación numérica (`generacionRef.current += 1`) y registra el ID vigente (`idActualRef.current`).
  - La condición de vigencia (`sigueVigente()`) se comprueba estrictamente antes de **todas** las escrituras de estado (éxito, 404, 403 y error de red).
  - Al cambiar `route.params.id` o desmontarse el componente, la función de limpieza de `useEffect` invalida inmediatamente la generación previa (`generacionRef.current += 1`).
  - **Garantía contractual:** Un éxito antiguo de una suscripción previa nunca reemplaza un 403/404 de la suscripción actual, ni un fallo atrasado sobrescribe un estado exitoso vigente.
- **Puntos de integración para tarjetas subsecuentes:**
  - **SE-24:** Botón *"Editar Suscripción"* (`testID="btn-editar-suscripcion"`) conectado a prop `onEditar(suscripcion)`.
  - **SE-26:** Botón *"Retirar Suscripción"* (`testID="btn-eliminar-suscripcion"`) con variante de peligro conectada a prop `onEliminar(suscripcion)`.
  - **SE-28:** Botón *"Registrar Uso"* (`testID="btn-registrar-uso"`) conectado a prop `onRegistrarUso(suscripcion)`.
  - **SE-30:** Contenedor de sección de uso e historial (`testID="seccion-historial-uso"`).

---

## 2. Criterios de Aceptación Verificados

- [x] **Id correcto muestra sus datos actuales:**  
  La pantalla renderiza la información de la suscripción consultada (monto, cobro, estado accesible, categoría, uso y cálculo de costo por hora). Cubre casos especiales de suscripciones anuales, en prueba, fantasma y canceladas.
- [x] **Id inexistente/ajeno no rompe navegación ni revela información:**  
  Las respuestas 404 y 403 se tratan como estados de error controlados con mensajes neutros y seguros. El usuario siempre dispone del botón `"Volver a la lista"` (`testID="go-back"`), preservando la pila de navegación intacta y evitando la exposición de datos sensibles. Adicionalmente, el estado queda blindado contra respuestas desfasadas cuando el ID cambia en la misma instancia del componente.
- [x] **Evidencia enlazada y revisión por otra persona; contrato validado:**  
  Contrato formalizado con puntos de extensión documentados para SE-24, SE-26, SE-28 y SE-30. 20 pruebas unitarias y de integración pasando en `SuscripcionDetalleScreen.test.tsx` y 17 pruebas en `navigation.test.tsx`.

---

## 3. Matriz de Pruebas Automatizadas

Comandos ejecutados:
```bash
npm test --workspace=movil -- src/screens/home/SuscripcionDetalleScreen.test.tsx
npm test --workspace=movil -- src/navigation/navigation.test.tsx
npm run typecheck
npm test --workspace=movil
```

### Resultados en `SuscripcionDetalleScreen.test.tsx` (20/20 pasadas):
- **Criterio 1: Id correcto muestra sus datos actuales**
  - `renderiza encabezado, monto, periodicidad, próximo cobro, badge de estado y datos de uso`
  - `para suscripciones anuales calcula y muestra el equivalente mensual`
  - `para suscripciones fantasma muestra el aviso preventivo de ahorro`
  - `para suscripciones canceladas muestra "Sin cobros pendientes" y badge Cancelada`
  - `para suscripciones en prueba muestra fecha de fin de prueba`
- **Criterio 2: Id inexistente/ajeno no rompe navegación ni revela información**
  - `ante error 404 (no encontrada / retirada) muestra mensaje neutro y permite volver a la lista`
  - `ante error 403 (ajeno / sin permiso) muestra mensaje seguro de acceso no autorizado y permite volver`
  - `ante fallo de red (500/offline) muestra NetworkError con reintento y botón de retorno`
  - `mientras carga muestra indicador Loading con role="progressbar" y botón volver`
- **Puntos de Integración (SE-24, SE-26, SE-28, SE-30)**
  - `dispara onEditar con la suscripción al pulsar Editar Suscripción`
  - `dispara onEliminar con la suscripción al pulsar Retirar Suscripción`
  - `dispara onRegistrarUso con la suscripción al pulsar Registrar Uso`
  - `renderiza la sección ancla de Historial y Registro de Uso (SE-30)`
- **Componente Contenedor SuscripcionDetalleScreen y Concurrencia**
  - `consume onCargarSuscripcion automáticamente al montarse`
  - `mapea ErrorDeApi con status 404 a estado no-encontrada`
  - `mapea ErrorDeApi con status 403 a estado no-autorizada`
  - `navega hacia atrás con navigation.goBack() al presionar volver`
  - `protección de concurrencia: éxito antiguo de A no reemplaza 403 de B al actualizar route.params.id`
  - `protección de concurrencia: error antiguo de A no reemplaza éxito de B al actualizar route.params.id`
  - `desmontaje invalida respuestas pendientes sin actualizar estado`

### Cobertura Global Móvil:
- **15 suites de pruebas pasadas** (232 pruebas aprobadas, 0 fallos).
- **TypeScript `tsc --noEmit`**: 0 errores en `@ojoalgasto/shared`, `web`, `movil` y `desktop`.

---

## 4. Contrato de Interfaz y Puntos de Extensión

### Tipos de Estado y Props del Componente
```typescript
export type EstadoDetalle =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; suscripcion: Suscripcion }
  | { tipo: 'no-encontrada' }
  | { tipo: 'no-autorizada' }
  | { tipo: 'error'; mensaje?: string };

export interface SuscripcionDetalleContainerProps {
  navigation?: {
    goBack?: () => void;
    navigate?: (pantalla: any, params?: any) => void;
  };
  route?: {
    params?: { id?: string };
  };
  onCargarSuscripcion?: (id: string) => Promise<Suscripcion>;
  estadoInicial?: EstadoDetalle;
  onEditar?: (suscripcion: Suscripcion) => void;
  onEliminar?: (suscripcion: Suscripcion) => void;
  onRegistrarUso?: (suscripcion: Suscripcion) => void;
}
```

### Tabla de Integración para Tareas Desbloqueadas

| Tarea Desbloqueada | Responsable | Elemento en UI | Prop / Callback | TestID |
|---|---|---|---|---|
| **SE-24: Formulario de edición** | Sebastian Mena | Botón "Editar Suscripción" | `onEditar?: (suscripcion: Suscripcion) => void` | `btn-editar-suscripcion` |
| **SE-26: Confirmar y DELETE** | Sebastian Mena | Botón "Retirar Suscripción" | `onEliminar?: (suscripcion: Suscripcion) => void` | `btn-eliminar-suscripcion` |
| **SE-28: Registrar minutos uso** | Sebastian Mena | Botón "Registrar Uso" | `onRegistrarUso?: (suscripcion: Suscripcion) => void` | `btn-registrar-uso` |
| **SE-30: Historial de uso** | Sebastian Mena | Bloque Historial y Uso | Sección ancla lista para incrustar listado | `seccion-historial-uso` |
