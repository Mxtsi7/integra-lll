# PR: Implementación Móvil Sprint 3 — SE-20 y SE-21

**Rama:** `SE_20-21`  
**Responsable:** Sebastian Mena  
**Tarjetas:** 
- `SE-20`: Mostrar vacío móvil y acceso a primera suscripción (P1 / Must)
- `SE-21`: Construir Detalle móvil de suscripción (P1 / Must)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen de Cambios

### SE-20: Mostrar vacío móvil y acceso a primera suscripción
- **Paridad con Home Web (`Homepage.tsx` y `EmptyState.tsx`):**
  - Título orientativo: *"Todavía no registras suscripciones"* con `accessibilityRole="header"`.
  - Descripción de valor: *"Agrega la primera y empieza a ver cuánto gastas al mes, qué cobros vienen y cuáles pagas sin usar."*
  - CTA primario: *"Agregar suscripción"* (`testID="btn-crear-primera-suscripcion"`), con touch target $\ge 44\text{px}$, color de acento de marca y navegación tipada hacia la ruta `'SuscripcionNueva'`.
- **Extensión del componente reusable `EmptyState`:**
  - Soporte para `testID` en el contenedor y en el botón de acción.
  - Soporte para `variante?: 'primario' | 'porDefecto'`, aplicando los estilos `estilos.botonPrimario` y `estilos.botonTextoPrimario` de `estilos.ts`.
- **Diferenciación estricta de estados:**
  - A través de `ContenidoConEstado` y `vistaDeEstado`, un fallo de red o caída del servidor (500, timeout, error HTTP) **nunca** se presenta como cuenta vacía: renderiza exclusivamente `NetworkError` (`role="alert"`) con botón de reintento.
  - El estado de carga presenta `Loading` (`role="progressbar"`), nunca vacío.
  - Cuando la cuenta tiene 0 suscripciones, se ocultan el resumen numérico y el listado para focalizar al usuario en el alta.

### SE-21: Construir Detalle móvil de suscripción
- **Pantalla completa de detalle de suscripción:**
  - Reemplazo del placeholder temporal por la implementación completa en `SuscripcionDetalleScreen.tsx` y su hoja de estilos modular `SuscripcionDetalleScreen.styles.ts`.
  - Desacoplamiento entre el componente presentacional puro (`SuscripcionDetalleView`) y el componente contenedor (`SuscripcionDetalleScreen`).
- **Consulta de id propio y consumo real de API:**
  - Obtención del parámetro obligatorio `id` vía `route.params`.
  - Consumo directo de `getSuscripcion(id)` de `@ojoalgasto/shared` sin modelos ni tipos duplicados.
- **Presentación de datos actuales y estados:**
  - Encabezado con nombre de suscripción, categoría, ID visible para trazabilidad (`ID Suscripción: ${id}`) y botón de retorno `"Volver a la lista"` (`testID="go-back"`).
  - Tarjeta principal con monto recurrente (`formatearMonto`), sufijo de frecuencia (`/mes` o `/año`) y badge de estado accesible con texto explícito (Activa, Prueba gratis, Sin uso, Por confirmar, Cancelada).
  - Cálculo automático de equivalencia mensual en suscripciones anuales (`equivalenteMensual`).
  - Alerta visual para suscripciones fantasma (`testID="aviso-fantasma"`), notificando inactividad mayor a 45 días y cuantificando el ahorro mensual al retirarla.
  - Cuadrícula de detalles con próximo cobro descriptivo (`formatearTextoCobro`), horas de uso mensual (`formatearHoras`) y costo por hora estimado (`costoPorHora`).
- **Tratamiento seguro de errores 404 y 403 (Privacidad y Navegación intacta):**
  - **404 (No encontrada / retirada):** Mensaje neutro *"No encontramos esa suscripción. Puede que haya sido eliminada."* sin exponer datos ni romper la navegación, con botón `go-back`.
  - **403 (Ajena / sin permiso):** Mensaje neutro seguro *"No tienes permiso para ver esta suscripción."*, protegiendo la confidencialidad multi-organización y permitiendo retorno con `go-back`.
  - **Error de red / 500:** `NetworkError` con opción de reintentar y botón de retorno.
- **Protección de respuestas por generación e ID activo (concurrencia y desmontaje):**
  - Cada petición genera una nueva generación numérica (`generacionRef.current += 1`) y registra el ID vigente (`idActualRef.current`).
  - La condición de vigencia (`sigueVigente()`) se comprueba estrictamente antes de **todas** las escrituras de estado (éxito, 404, 403 y error de red).
  - Al cambiar `route.params.id` o desmontarse el componente, la función de limpieza de `useEffect` invalida inmediatamente la generación previa (`generacionRef.current += 1`).
  - **Garantía contractual:** Un éxito antiguo de una suscripción previa nunca reemplaza un 403/404 de la suscripción actual, ni un fallo atrasado sobrescribe un estado exitoso vigente.
- **Puntos de integración expuestos para tareas desbloqueadas:**
  - **SE-24 (Formulario de edición):** Botón *"Editar Suscripción"* (`testID="btn-editar-suscripcion"`) con prop `onEditar(suscripcion)`.
  - **SE-26 (Confirmar retiro y DELETE):** Botón *"Retirar Suscripción"* (`testID="btn-eliminar-suscripcion"`) con variante de peligro y prop `onEliminar(suscripcion)`.
  - **SE-28 (Registrar minutos de uso):** Botón *"Registrar Uso"* (`testID="btn-registrar-uso"`) con prop `onRegistrarUso(suscripcion)`.
  - **SE-30 (Historial de uso):** Contenedor de sección de uso e historial (`testID="seccion-historial-uso"`).
- **Consistencia en pruebas de navegación (`navigation.test.tsx`):**
  - Actualización del mock de `fetch` para retornar el objeto individual de suscripción en endpoints `/suscripciones/<id>/` y lista paginada en `/suscripciones/`.

---

## 2. Criterios de Aceptación Verificados

### SE-20
- [x] **Cuenta sin suscripciones ve instrucción útil:**  
  La pantalla muestra título descriptivo, mensaje formativo de beneficios y botón CTA primario para crear la primera suscripción hacia `SuscripcionNueva`.
- [x] **Un fallo de red no se presenta como cuenta vacía:**  
  Cualquier fallo de API muestra exclusivamente `NetworkError` con reintento; se verificó que el estado vacío nunca se presenta ante caídas de red ni durante la carga.
- [x] **Evidencia enlazada y contrato validado:**  
  Documentado en [`frontend/movil/docs/CONTRATO_VACIO_SUSCRIPCIONES_SE20.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_VACIO_SUSCRIPCIONES_SE20.md).

### SE-21
- [x] **Id correcto muestra sus datos actuales:**  
  Renderiza información completa de la suscripción consultada (monto, cobro, estado accesible, categoría, uso y costo por hora), con tratamiento de anuales, pruebas, fantasmas y canceladas.
- [x] **Id inexistente/ajeno no rompe navegación ni revela información:**  
  Los códigos 404 y 403 muestran mensajes neutros seguros en contenedores de alerta sin filtrar información sensible, manteniendo siempre activo el botón `"Volver a la lista"` (`testID="go-back"`). Adicionalmente, el estado queda blindado ante cambios dinámicos de ID en la misma instancia previniendo que respuestas desfasadas sobrescriban estados legítimos.
- [x] **Evidencia enlazada y contrato validado:**  
  Documentado en [`frontend/movil/docs/CONTRATO_DETALLE_SUSCRIPCION_SE21.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_DETALLE_SUSCRIPCION_SE21.md).

---

## 3. Pruebas y Evidencia de Verificación

Comandos de validación ejecutados:
```bash
npm run typecheck
npm test --workspace=movil
```

- **Cobertura de suites involucradas:**
  - `HomeScreen.test.tsx`: 18 pruebas aprobadas (18/18).
  - `SuscripcionDetalleScreen.test.tsx`: 20 pruebas aprobadas (20/20).
  - `TarjetaSuscripcion.test.tsx`: 15 pruebas aprobadas (15/15).
  - `navigation.test.tsx`: 17 pruebas de integración aprobadas (17/17).
- **Resultado global en móvil:** 15 suites pasadas, **232/232 pruebas aprobadas**.
- **Chequeo de tipos:** 0 errores de TypeScript en todo el monorepo (`shared`, `web`, `movil`, `desktop`).

---

## 4. Archivos Modificados y Creados

```
frontend/movil/
├── docs/
│   ├── CONTRATO_VACIO_SUSCRIPCIONES_SE20.md
│   ├── CONTRATO_DETALLE_SUSCRIPCION_SE21.md
│   └── PR_SPRINT3_SE20_SE21.md
└── src/
    ├── components/
    │   └── estados/
    │       └── EmptyState.tsx
    ├── navigation/
    │   └── navigation.test.tsx
    └── screens/
        └── home/
            ├── HomeScreen.styles.ts
            ├── HomeScreen.test.tsx
            ├── HomeScreen.tsx
            ├── SuscripcionDetalleScreen.styles.ts
            ├── SuscripcionDetalleScreen.test.tsx
            └── SuscripcionDetalleScreen.tsx
```
