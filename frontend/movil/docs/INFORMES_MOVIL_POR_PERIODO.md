# AN-23 — Informes móviles por periodo

**Responsable:** Andrea Travola · **Pantalla:** Panel → Informes por Periodo (`InformesScreen`)

## Qué hace
Es el informe de un mes, con la misma llamada y el mismo componente del Panel (AN-01), en `variante="informe"`:
- Todo lo del Panel, más el **total estimado** de cada moneda.
- **Resumen en texto**: el periodo, la moneda de cada importe y la cantidad de suscripciones en una frase. Es la alternativa textual a cualquier gráfico.
- Un lugar para la acción de **compartir** (AN-26): `renderAcciones(resumen)`. Mientras AN-26 no se haga, no aparece ningún botón.

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `screens/panel/InformesScreen.tsx` | Coloca el contenido y el botón Volver |
| `screens/components/resumen/ResumenPeriodoContenido.tsx` | El mismo componente del Panel |
| `shared/src/api/resumenPanel.ts` | `textoDelResumen`, `etiquetaDelPeriodo` y `desplazarMes`, compartidos con la web |

## Criterios de la tarjeta
- **Periodo y moneda claros en todas las cifras:** el título dice el mes, cada tarjeta dice "Gasto en CLP" y el texto dice "En CLP: …".
- **Informe vacío sin NaN ni gráfico engañoso:** sin gastos dice "Sin gastos registrados ni proyectados"; no hay gráfico.
- **Reutilizar cálculos, formatos y contrato del panel:** misma función de `shared`, mismo `formatearMonto`.

## Para AN-26 (compartir)
`textoDelResumen(resumen)` ya devuelve el texto listo para compartir. En `InformesScreen` basta pasar:
`<ResumenPeriodoContenido variante="informe" renderAcciones={(resumen) => <BotonCompartir texto={textoDelResumen(resumen)} />} />`

## Pendiente / límites
- Sin gráficos: la tarjeta pide cifras legibles con alternativa textual; el gráfico es AN-02.
- No se ejecutaron tests, tipos ni lint donde se escribió el código; se corren en el repo.
- Falta validación del contrato por otra persona.
