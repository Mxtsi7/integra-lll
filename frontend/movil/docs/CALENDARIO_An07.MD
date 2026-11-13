# Calendario y agenda móviles (AN-07)

## Qué hace
La pestaña **Calendario** deja de ser un placeholder:
- Cuadrícula del mes (semana de lunes a domingo) con un punto en los días que tienen cobros; hoy va con borde.
- Mes anterior / siguiente y botón "Hoy". El mes que se consulta es `YYYY-MM`, igual que la web (`GET /api/suscripciones/calendario-cobros/?mes=`).
- Al elegir un día se listan sus cobros. Debajo, la agenda de todo el mes. Las dos listas salen de los mismos datos, así el día elegido y la agenda no pueden mostrar eventos distintos.
- Importes con su moneda. El total del mes va **por moneda**, nunca sumando monedas distintas. Los cobros proyectados se marcan como "Proyectado".
- Estados de carga, error con reintento y mes vacío (reutiliza AN-28).
- Si se cambia de mes rápido, la respuesta tardía del mes anterior se descarta.

## Fechas sin desfase por zona horaria
Los días se manejan como texto `YYYY-MM-DD` y se arman con la fecha local; no se pasan por UTC. Hay pruebas para el 30 de noviembre, el cambio de año y el inicio de semana.

## Archivos (`frontend/movil/src/screens/`)
| Archivo | Para qué |
|---|---|
| `calendario/CalendarioScreen.tsx` | reemplaza el placeholder; solo coloca el contenido |
| `components/calendario/CalendarioContenido.tsx` | coordina mes, día elegido y estados |
| `components/calendario/CuadriculaMes.tsx`, `ListaCobros.tsx` | dibujan la cuadrícula y las listas |
| `components/calendario/useCobrosDelMes.ts` | carga del mes |
| `components/calendario/fechas.ts`, `reglasCalendario.ts` | funciones puras de fechas y de cobros |
| `components/calendario/estilos.ts` | paleta (reutiliza la de Perfil) |
| `components/calendario/calendario.test.tsx` | 16 pruebas |



## Nota para el revisor
`fechas.ts` repite funciones de `frontend/web/src/utils/calendario.ts`. Se copiaron en vez de moverlas a `shared` para no tocar la web en este PR. Si el equipo está de acuerdo, un PR aparte las mueve a `shared`.

## Límites conocidos
- No se probó en dispositivo ni contra el backend desplegado.
- La selección de día y la agenda usan los cobros del mes consultado; no hay búsqueda entre meses.

## Verificación
- [ ] `cd frontend/movil && npx vitest run`
- [ ] `cd frontend/movil && npx tsc --noEmit`
- [ ] `git diff --stat main...HEAD` lista solo los 9 archivos de calendario
- `npx expo lint` no se puede ejecutar: el repo no tiene ESLint configurado.
