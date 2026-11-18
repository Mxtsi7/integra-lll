# Contrato de Integración: Conectar Listado Móvil Paginado (SE-19)

- **Tarjeta:** SE-19 (Conectar listado móvil paginado)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Prioridad:** Must / P1
- **Depende de:** [SE-17] Home móvil de suscripciones
- **Desbloquea a:** [SE-27] Aplicar filtros móviles por estado y fecha
- **Implementación de referencia:**
  - [`frontend/shared/src/api/suscripciones.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts)
  - [`frontend/movil/src/screens/home/HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx)
  - [`frontend/movil/src/screens/home/HomeScreen.styles.ts`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.styles.ts)
  - [`frontend/movil/src/screens/home/HomeScreen.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.test.tsx)

---

## 1. Resumen y Propósito

El contrato SE-19 implementa la paginación real por servidor para el listado móvil de suscripciones, sustituyendo el patrón de descarga masiva en bucle en el cliente por el consumo página a página de la paginación estándar de Django Rest Framework (`PageNumberPagination`, con tamaño de página predeterminado de 10 elementos).

### Objetivos Clave

1. **Consumo por demanda de páginas:** Cada solicitud pide una única página (`/suscripciones/?page=N`) sin traer todo el catálogo a memoria del dispositivo.
2. **Criterio 1 — Deduplicación estricta entre páginas:** Al concatenar páginas consecutivas, la función pura [`deduplicarSuscripciones`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx) filtra cualquier elemento cuyo `id` ya exista en la lista acumulada (protección contra inserciones concurrentes o solapamientos de ordenación en backend). Cada suscripción aparece exactamente una vez en pantalla.
3. **Criterio 2 — Aislamiento asíncrono y refresco limpio:**
   - La recarga mediante pull-to-refresh (`onRefresh`) reinicia a la página 1 y reemplaza los datos existentes sin mezclar respuestas viejas con nuevas.
   - El control de concurrencia mediante `generacionRef` invalida respuestas tardías o desordenadas.
4. **Tolerancia a fallos:** Un error de conexión al cargar páginas subsecuentes no corrompe ni borra las suscripciones ya visualizadas de la página previa.

---

## 2. Contrato de API y Tipos Compartidos (`@ojoalgasto/shared`)

### 2.1. Interfaz `SuscripcionesPaginadas`

```typescript
export interface SuscripcionesPaginadas {
  count: number;
  next: string | null;
  previous: string | null;
  results: Suscripcion[];
}
```

### 2.2. Función `getSuscripcionesPaginadas`

```typescript
export async function getSuscripcionesPaginadas(
  consulta: ConsultaSuscripciones = {},
  pagina = 1,
): Promise<SuscripcionesPaginadas>
```

- **Endpoint consumido:** `GET /suscripciones/?page=${pagina}&...filtros`
- **Normalización:** Convierte el campo `monto` de string/decimal a `number`.
- **Validación:** Lanza `RangeError` si el parámetro de orden no es admitido por el servidor.
- **Compatibilidad:** Mantiene [`getSuscripciones()`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts) sin alteraciones para no romper consumidores legacy.

---

## 3. Comportamiento en la Interfaz Móvil (`HomeScreen` y `HomeView`)

### 3.1. Roles y TestIDs

| Elemento | TestID | Rol de Accesibilidad | Función |
| :--- | :--- | :--- | :--- |
| **Lista de Suscripciones** | `lista-suscripciones` | `list` | `FlatList` virtualizado que renderiza las tarjetas de suscripción. |
| **Botón Cargar Más** | `btn-cargar-mas` | `button` | Solicita la siguiente página (`paginaActual + 1`). Visible solo si `hayMas === true`. |
| **Contador de Paginación** | `contador-paginacion` | `text` | Muestra `Mostrando X de Y` suscripciones cargadas. |
| **Pull-to-refresh** | `flatlist-refresh-button` | `button` | Reinicia a la página 1, reemplazando la lista acumulada y actualizando totales. |

### 3.2. Deduplicación por Identificador (`deduplicarSuscripciones`)

```typescript
export function deduplicarSuscripciones(
  acumuladas: Suscripcion[],
  nuevas: Suscripcion[],
): Suscripcion[] {
  const idsVistos = new Set(acumuladas.map((s) => s.id));
  const unicas = nuevas.filter((s) => !idsVistos.has(s.id));
  return [...acumuladas, ...unicas];
}
```

---

## 4. Matriz de Estados de Paginación

| Estado / Evento | Condición | Comportamiento en UI | Estado de Datos |
| :--- | :--- | :--- | :--- |
| **Carga Inicial** | Montaje de pantalla | Muestra indicador de carga (`progressbar`). | Llama a página 1. Al responder, inicializa lista con `results`, `hayMas = Boolean(next)` y `totalGeneral = count`. |
| **Cargar Siguiente Página** | Pulsar `btn-cargar-mas` | Botón cambia a `"Cargando más..."` y se deshabilita (`cargandoMas = true`). | Pide página `N + 1`, aplica `deduplicarSuscripciones`, actualiza `hayMas` con el nuevo `next`. |
| **Última Página Alcanzada** | Servidor responde `next: null` | `btn-cargar-mas` desaparece de la vista. Al completarse todas las páginas, el resumen pasa a global. | Muestra la totalidad de los elementos cargados. |
| **Fallo en Cargar Más** | Rechazo de red en página `N + 1` | `cargandoMas` vuelve a `false`. Botón se rehabilita. | La lista y totales de las páginas previas permanecen intactos sin mostrar pantalla de error destructiva. |
| **Invalidación por Refresco o Filtro (P2.2)** | Cambio de filtro, foco o pull-to-refresh mientras página 2 está pendiente | Se resetea `cargandoMas = false` de inmediato; la respuesta tardía se descarta por `generacionRef`. | El nuevo listado no hereda el bloqueo ni los datos obsoletos de la página en vuelo. |
| **Resumen Parcial vs Global (P2.1)** | Conjunto parcial en memoria (`hayMas === true` o `totalGeneral > cargadas`) | Etiquetado inequívoco: `"Subtotal mensual proyectado (parcial)"` y subtítulo `"Subtotal de X de Y suscripciones (parcial)"`. | No atribuye el gasto parcial a la totalidad. Si el servidor provee `resumenGlobal` o `totales`, se conserva la proyección global. |
| **Pull-to-refresh** | Deslizar hacia abajo | Muestra indicador de refresco activo. | Invoca página 1, descarta la lista acumulada previa y restablece `cargandoMas = false`. |

---

## 5. Mensaje de Commit Propuesto

```text
feat(movil): conectar listado movil paginado por servidor (SE-19)

- Agregar getSuscripcionesPaginadas y SuscripcionesPaginadas en @ojoalgasto/shared para consumir paginacion de DRF pagina a pagina.
- Implementar funcion pura deduplicarSuscripciones para garantizar que cada suscripcion se muestre una sola vez entre paginas (Criterio 1).
- Conectar boton accesible btn-cargar-mas, contador de paginacion y pull-to-refresh en HomeScreen y HomeView.
- Implementar tolerancia a fallos en carga de paginas subsecuentes e invalidacion concurrente via generacionRef.
- Agregar suite completa de pruebas unitarias e integracion en HomeScreen.test.tsx y suscripciones.test.ts.
```
