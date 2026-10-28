# CH-18, CH-19, CH-20 y CH-21: Calendario de cobros y Agenda

Rama: `Christopher/calendario_cobros`. Sale de `Christopher/perfil_cuentas_calendario`
porque extiende el Calendario de CH-17.

Las cuatro tareas usan el endpoint de **VI-07** (Victor, ya en `main`):

```
GET /api/suscripciones/calendario-cobros/?mes=YYYY-MM
→ [{ id, suscripcion_id, fecha, servicio, importe: "14990.00", moneda, tipo: "confirmado" | "proyectado" }]
```

No hay datos en el código. Todo sale de ese endpoint, y si falla la pantalla
lo dice; nunca muestra "sin cobros" cuando no lo sabe.

| Tarea | Qué hace | Dónde está |
|---|---|---|
| CH-18 | Cada cobro en su día, confirmado o previsto | `web/src/components/calendario/CuadriculaMes.tsx` |
| CH-19 | Anterior / Hoy / siguiente, y el mes en la URL | `web/src/components/calendario/NavegacionMes.tsx`, `web/src/hooks/useMesEnUrl.ts` |
| CH-20 | Detalle del día elegido con su total | `web/src/components/calendario/DetalleDia.tsx` |
| CH-21 | Agenda: los mismos cobros en lista | `web/src/pages/AgendaPage.tsx` (ruta `/calendario/agenda`) |

---

## La pieza común: `useCobrosDelMes(mes)`

`web/src/hooks/useCobrosDelMes.ts`. Lo usan el Calendario y la Agenda, así
**los dos muestran exactamente los mismos cobros**. El resultado se guarda
junto con el mes al que pertenece:

```ts
const estado = resultado?.mes === mes ? resultado.estado : { tipo: 'cargando' };
```

Al cambiar de mes no se ven los cobros del anterior, ni siquiera durante un
render. Una respuesta que llega tarde de un mes que ya se dejó se descarta.
Hay un test que revisa **cada** render del hook para comprobarlo.

En `shared`:
- `getCobrosDelMes(mes)` (`shared/src/api/calendario.ts`) convierte el importe
  a número y no manda meses mal escritos.
- `totalesPorMoneda()` (`shared/src/calculos.ts`) suma en centavos y nunca
  mezcla CLP con USD.

## CH-18: cobros en su día

- En pantalla caben dos cobros por casilla ("Netflix $9.990") y el resto se
  resume en "+N más". En celular solo se ve cuántos hay.
- **Varios cobros el mismo día son accesibles:** el nombre del botón los lee
  todos, por ejemplo "sábado, 24 de octubre de 2026, 3 cobros: Netflix,
  $9.990, previsto; …".
- Confirmado se ve con relleno y Previsto con un borde punteado. Además el
  tipo va escrito en la leyenda y en el nombre accesible, así que no depende
  solo del color. Los textos están en `presentacion.ts`.
- **Sin cambios de día por UTC:** las fechas se manejan como "YYYY-MM-DD"
  locales. Los tests fijan la zona de Chile para que fallen si alguien usa
  `new Date("2026-10-01")`.
- Mientras carga, la cuadrícula sigue a la vista, pero los días no dicen
  "sin cobros" porque todavía no se sabe (`aria-busy`).

## CH-19: navegar meses y volver a hoy

- El mes vive en la URL (`/calendario?mes=2026-11`). Atrás y Adelante del
  navegador recorren los meses, al recargar se mantiene el mes y al pasar a la
  Agenda se conserva.
- Un `?mes=` inválido (por ejemplo `2026-13`) muestra el mes actual, y nunca se
  pide a la API un mes mal escrito.
- **Diciembre ↔ enero** con `sumarMeses()` (`web/src/utils/calendario.ts`).
- **Hoy** vuelve al mes actual y elige el día de hoy.
- **Teclado:** las flechas cruzan de mes y el foco llega al día de destino.
  RePág y AvPág mueven un mes sin desbordarse: del 31 de enero se llega al 28
  de febrero, no al 3 de marzo.

## CH-20: detalle del día

- Elegir un día cambia solo el panel de detalle, que muestra sus cobros con un
  enlace a cada suscripción y el **total por moneda** ("Total del día: $15.980
  y US$20,00").
- Si el día no tiene cobros, lo dice. Si el mes no se pudo cargar, lo dice en
  vez de mostrar "sin cobros".
- Al cambiar de mes, el detalle pasa a hoy (si es de ese mes) o al día 1.
- En pantallas anchas (≥1440 px) va al costado del mes; si no, debajo. Al
  costado dejaba las casillas angostas y los nombres se cortaban.

## CH-21: Agenda

- `/calendario/agenda?mes=…` muestra los cobros agrupados por día, en orden de
  fecha, con el total del mes por moneda y "Hoy" marcado.
- Usa la misma navegación y el mismo hook que el Calendario. El cambio entre
  Mes y Agenda es un par de enlaces con `aria-current="page"`.

---

## Archivos

**Nuevos**
- `shared/src/api/calendario.ts` y su test
- `web/src/hooks/useCobrosDelMes.ts` (+ test) y `web/src/hooks/useMesEnUrl.ts`
- `web/src/components/calendario/`: `NavegacionMes.tsx`, `DetalleDia.tsx`,
  `ListaCobros.tsx`, `presentacion.ts`, `rutas.ts`
- `web/src/pages/AgendaPage.tsx`
- `CALENDARIO-DE-COBROS.md`

**Modificados**
- `shared/src/tipos.ts` (`CobroCalendario`), `shared/src/calculos.ts`
  (`totalesPorMoneda`), `shared/src/formato.ts` (`conMayuscula`), `shared/src/index.ts`
- `web/src/components/calendario/CuadriculaMes.tsx` y `Calendario.module.css`
- `web/src/pages/CalendarioPage.tsx` (+ test), `web/src/utils/calendario.ts` (+ test)
- `web/src/App.tsx` (+ test): ruta de la Agenda
- `PERFIL-CUENTAS-Y-CALENDARIO.md`: nota de que el calendario ahora usa VI-07

## Cómo se comprobó

- Typecheck y build en verde. Tests: shared 116 → 127 y web 149 → 169. Pasan en
  hora local, UTC y Tokio.
- Rompí a propósito 22 comportamientos clave (datos viejos al cambiar de mes,
  respuesta tardía, sumar CLP con USD, desborde de RePág, Hoy, mes inválido,
  orden de la Agenda, enlaces…) y **los 22 hacen fallar algún test**.
- En el navegador, contra una API falsa: los cobros en la cuadrícula, el
  detalle con pesos y dólares, cruzar de mes con flechas y AvPág, Hoy, Atrás
  del navegador, la Agenda y el celular sin scroll horizontal. Ahí se vieron y
  corrigieron dos cosas visuales: nombres cortados y el "Previsto" poco visible.
