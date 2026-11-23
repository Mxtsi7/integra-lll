# AN-02 — Gráfico de gastos móvil con alternativa textual

**Responsable:** Andrea Travola · **Dónde:** dentro de cada tarjeta de moneda del Panel (AN-01) y del Informe (AN-23)

## Qué hace
Una barra por moneda que reparte el gasto del periodo en **gastado** y **por cobrar**.
- Las dos partes se distinguen por relleno (sólido / solo borde), no solo por color.
- La leyenda dice el nombre y el porcentaje: "● Gastado 66%" y "○ Por cobrar 34%".
- El lector de pantalla lee una sola descripción: "Gráfico de gasto en CLP: gastado $25.000 (66%), por cobrar $12.990 (34%)."
- La alternativa textual equivalente son las filas de la misma tarjeta (Gastado, Por cobrar, Total estimado) y, en el Informe, el "Resumen en texto".
- Sin gasto no se dibuja nada: queda el texto "Sin gastos registrados ni proyectados".

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `screens/components/resumen/reglasGrafico.ts` | Calcula porcentajes e importes con formato. Es la única fuente de las cifras del gráfico |
| `screens/components/resumen/GraficoGastos.tsx` | Dibuja la barra, la leyenda y la descripción |
| `screens/components/resumen/ResumenPeriodoContenido.tsx` | Muestra el gráfico dentro de cada tarjeta de moneda |
| `screens/components/resumen/grafico.test.tsx` | Pruebas |

## Criterios de la tarjeta
- **Gráfico y texto muestran las mismas cifras:** usan los mismos importes de `GastoPorMoneda` y el mismo `formatearMonto`; la descripción, la leyenda y la barra salen de `datosDelGrafico`.
- **Se entiende sin color o sin gráfico:** relleno distinto + porcentaje escrito + descripción accesible + filas con importes.

## Decisiones y límites
- No hay gráfico "por categoría": el resumen de VI-06 no trae categorías. Si más adelante el backend las expone, se agrega otra barra con el mismo patrón.
- "Por periodo" es el periodo que se elige en el selector del Panel/Informe. No se compara entre meses porque eso obligaría a pedir varios meses por cada moneda.
- Una barra por moneda: no se suman monedas distintas.
- Sin librería de gráficos: es una barra de `View`, así no se agrega una dependencia.
- No se ejecutaron tests, tipos ni lint donde se escribió el código; se corren en el repo.
- Falta validación del contrato por otra persona.
