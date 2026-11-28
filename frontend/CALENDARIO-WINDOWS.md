# SE-04: Integración del Calendario en el Cliente Windows

**Responsable:** Sebastian Mena · **Tarjeta:** SE-04 · **Sprint:** 3 · **Requisito:** RF-12  
**Dependencias previas recibidas y aceptadas:** MX-23 (Maximiliano Sáez), CH-18, CH-19, CH-20 (Christopher Solis), VI-07 (Victor Gonzales).

---

## 1. Alcance y Objetivo

Reutilizar la pantalla de calendario web y sus componentes dentro del shell portable de Windows (Electron), garantizando coherencia funcional completa, validación de navegación, red y tamaño de ventana, sin mantener un segundo cálculo de fechas en el ejecutable.

### Criterios de Aceptación

- [x] **Windows muestra los mismos eventos que web:** el cliente desktop consume el mismo contrato `GET /api/suscripciones/calendario-cobros/?mes=YYYY-MM` a través de `@ojoalgasto/shared` (`getCobrosDelMes`), mapeando cobros confirmados y proyectados sin discrepancias.
- [x] **Mes, hoy y detalle funcionan en el ejecutable y no solo en navegador:** navegación de meses anterior/siguiente, retorno a la fecha actual con el botón "Hoy", selección interactiva del día con desglose de cobros y totales por moneda sin mezclar CLP con USD.
- [x] **Evidencia y verificación documentada:** suite de pruebas automatizadas en `desktop` (`node:test`) y `web` (Vitest), y contrato validado con la base Windows de MX-23.

---

## 2. Decisiones de Arquitectura e Integración

### Reutilización sin duplicar cálculo de fechas
Siguiendo las directrices del proyecto y de la tarjeta, el cliente desktop no implementa una lógica paralela para el cálculo ni manipulación de fechas:
- Toda la lógica de fechas reside en `@ojoalgasto/shared` y `web/src/utils/calendario.ts` (`sumarMeses`, `partesDeMes`, `primerDiaDelMes`, `esDelMes`, etc.).
- Las fechas se manejan en formato local `"YYYY-MM-DD"`, previniendo desfases horarios de UTC.
- Los totales por moneda se calculan con `totalesPorMoneda` de `shared`, acumulando en enteros para evitar errores de precisión flotante.
- El shell desktop actúa exclusivamente como contenedor seguro (Chromium + Node sandbox aislado).

### Navegación en el Shell Desktop
- Las rutas `/calendario` y `/calendario/agenda` (así como parámetros de consulta `?mes=YYYY-MM`) se gestionan mediante el protocolo seguro `app://ojoalgasto/`.
- `main.cjs` y `seguridad.cjs` resuelven cualquier ruta SPA sin extensión hacia `renderer/index.html`, permitiendo a React Router montar la vista de calendario sin recargar ni romper la sesión.
- Se implementó `obtenerRutaInicial(argv, env)` para permitir la parametrización de la ruta de inicio mediante `--ruta=/calendario` o la variable de entorno `DESKTOP_RUTA`, evitando el hardcoding a `/login` pero garantizando que cualquier URL externa o insegura sea rechazada (`esInterna`).

### Seguridad y Red (CSP / CORS)
- La directiva de Content Security Policy (`politicaCSP`) autoriza explícitamente `connect-src` al origen de la API configurada (`DESKTOP_API_URL`).
- El cliente API reutiliza `window.ojoDesktop.apiUrl` inyectada mediante `preload.cjs`, manteniendo aislamiento de contexto (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).

### Dimensiones de Ventana y Responsividad
- Constantes unificadas en `DIMENSIONES_VENTANA`:
  - Ancho por defecto: `1280 px`, Alto: `800 px`
  - Ancho mínimo: `900 px`, Alto mínimo: `650 px`
- Comportamiento responsive del calendario:
  - En anchos menores a `1440 px` (incluyendo la resolución por defecto de `1280 px` y la mínima de `900 px`), el panel de detalle del día se ubica debajo de la cuadrícula mensual (`grid-template-columns: minmax(0, 1fr)`). Esto previene que las casillas de los 7 días queden angostas y garantiza que los textos de los cobros se lean sin truncamiento ni scroll horizontal.
  - En pantallas ultra anchas (≥1440 px), el detalle pasa automáticamente a la columna lateral derecha de 320 px.

---

## 3. Archivos y Modificaciones

### Modificados en `frontend/desktop/`:
- `seguridad.cjs`: definición y exportación de `DIMENSIONES_VENTANA` y `obtenerRutaInicial`.
- `main.cjs`: integración de `DIMENSIONES_VENTANA` y `obtenerRutaInicial` en la creación de la ventana y navegación; reporte de dimensiones y ruta actual en `--smoke-test`.
- `README.md`: registro de la recepción y aceptación de SE-04 por Sebastian Mena.

### Nuevos en `frontend/desktop/`:
- `test/calendario.test.cjs`: suite de 6 pruebas automatizadas (`node:test`) que verifican navegación segura, resolución SPA de `/calendario`, directiva CSP de red, dimensiones de ventana y ausencia de cálculo de fechas duplicado en el shell.

### Nuevos en `frontend/web/`:
- `src/pages/CalendarioDesktop.test.tsx`: suite de 4 pruebas con Vitest que simulan la ejecución dentro del entorno desktop (`window.ojoDesktop`), verificando carga de eventos desde la API, interacción de mes/hoy/detalle, cambio a Agenda y responsividad a 1280px y 900px.

---

## 4. Verificación y Pruebas Reproducibles

### Pruebas del cliente desktop (Node.js):
```powershell
npm test --workspace=desktop
```
Resultado: 10 pruebas pasando (4 de seguridad base + 6 de integración de calendario).

### Pruebas de interfaz web bajo entorno desktop (Vitest):
```powershell
npm test --workspace=web -- src/pages/CalendarioDesktop.test.tsx
```
Resultado: 4 pruebas pasando con simulación de `window.ojoDesktop`.

### Verificación de compilación:
```powershell
npm run typecheck --workspace=desktop
npm run build --workspace=web
```
Resultado: typecheck y build en verde.
