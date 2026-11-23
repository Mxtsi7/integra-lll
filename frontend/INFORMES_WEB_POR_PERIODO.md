# AN-22 — Informes web por periodo

**Responsable:** Andrea Travola · **Ruta:** `/informes` (antes "Próximamente")

> La tarjeta de Trello de AN-22 no se encontró. El alcance sale del nombre ("Construir Informes web por periodo"), de la matriz MX-22 (RF-11 y RF-15; depende de VI-06, VI-04 y VI-25) y del Informe móvil (AN-23). Si la tarjeta pide algo más, se registra aparte.

## Qué hace
- **Selector de periodo**: Mes anterior / Este mes / Mes siguiente. El mes vive en la URL (`?mes=YYYY-MM`): Atrás/Adelante del navegador recorren los meses vistos y al recargar se queda en el mismo. Un mes mal escrito se ignora y se usa el de hoy. No se avanza más allá del mes actual.
- **Gasto del periodo**: tabla con una fila por moneda (gastado, por cobrar, total estimado). Nunca se suman monedas distintas.
- **Suscripciones por estado** y total.
- **Resumen en texto**: la misma frase que el Informe móvil.
- Estados de carga, error con reintento (distingue "sin conexión") y vacío.

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `src/pages/InformesPage.tsx` | La página: selector y estados |
| `src/components/Informes/ResumenDelPeriodo.tsx` | La tabla, el conteo y el texto |
| `src/components/Informes/Informes.module.css` | Estilos |
| `src/hooks/useResumenPeriodo.ts` | Carga; descarta respuestas de un mes que ya se dejó |
| `src/pages/InformesPage.test.tsx` | Pruebas |
| `shared/src/api/resumenPanel.ts` | La llamada y las ayudas, compartidas con el móvil |

## Cómo se conecta
`InformesPage` → `useResumenPeriodo` → `getResumenDelPeriodo` (shared) → `GET /api/suscripciones/resumen/?mes=…&moneda=…` por cada moneda activa.

## Pendiente / límites
- **Exportar a CSV (VI-25)** no está en este PR: la llamada actual (`pedir`) solo entiende JSON y habría que agregar una descarga con sesión. Si la tarjeta de AN-22 lo pide, va en otro PR.
- **Historial por suscripción (VI-04)** tampoco: no se pidió en el nombre de la tarea.
- Sin gráficos; la tabla y el texto son la vista.
- No se ejecutaron tests, tipos ni lint donde se escribió el código; se corren en el repo.
