# AN-26 — Compartir el resumen de gastos móvil

**Responsable:** Andrea Travola · **Dónde:** botón "Compartir resumen" bajo el Informe (Panel → Informes)

## Qué hace
Abre el menú de compartir del teléfono con el **texto del resumen del periodo que se está viendo** (por ejemplo: "Resumen de Octubre de 2026. En CLP: gastado $25.000, por cobrar $12.990, total estimado $37.990. Suscripciones: 4 en total…"). La persona elige a dónde enviarlo.

## Decisión: exportación local, sin archivo ni enlace
La tarjeta pide elegir entre exportación local o enlace/archivo CSV autenticado. Se eligió **texto local** porque:
- No crea archivos: no queda nada privado abandonado en el teléfono.
- No crea enlaces: no hay una URL abierta que otra persona pueda abrir. Otro usuario no accede a nada: solo recibe lo que la persona decide enviarle.
- No agrega dependencias: `expo-sharing` y `expo-file-system` no están en el proyecto.
- El CSV autenticado (VI-25) necesita descargar con sesión y guardar un archivo, y limpiarlo después. Queda como mejora aparte.

## Comportamiento
- Comparte el periodo **seleccionado** (usa el mismo resumen ya cargado, no vuelve a pedir ni toma el mes actual).
- **Cancelar** el menú no cambia nada ni muestra error.
- La app **nunca dice "compartido"**: el teléfono no informa si la persona terminó de enviar.
- Si el teléfono no puede abrir el menú, avisa y deja reintentar.
- Un doble toque abre el menú una sola vez.
- El botón solo aparece cuando el informe ya cargó.

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `screens/components/resumen/BotonCompartirResumen.tsx` | El botón y su lógica |
| `screens/panel/InformesScreen.tsx` | Lo coloca con `renderAcciones` (gancho de AN-23) |
| `screens/components/resumen/compartir.test.tsx` | Pruebas |
| `shared/src/api/resumenPanel.ts` | `textoDelResumen`, el texto que se comparte |

## Pendiente / límites
- CSV autenticado de VI-25: no incluido (ver arriba).
- Se prueba con una función de compartir simulada; no se probó en un teléfono real ni en iOS/Android.
- No se ejecutaron tests, tipos ni lint donde se escribió el código; se corren en el repo.
- Falta validación del contrato por otra persona.
