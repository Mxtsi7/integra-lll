# Filtros, orden y limpiar en Inicio (web)

**Rama:** `Christopher/filtros_orden_suscripciones` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-11 | Conectar filtros web de estado y fecha | ✅ |
| CH-12 | Ordenar suscripciones web | ✅ |
| CH-13 | Limpiar filtros y distinguir búsqueda sin coincidencias | ✅ |

**Dependencias:** CH-11 no tiene. CH-12 dependía de **VI-02** (Victor), ya en `main` (PR #101): orden
en el servidor con lista cerrada de campos y desempate por id. CH-13 depende de CH-11 y CH-12, que están
en esta misma rama.

## Dónde está cada tarea

Rutas relativas a `frontend/`.

| Tarea | Archivo | Qué hace |
|---|---|---|
| CH-11, 12 | [shared/src/api/suscripciones.ts](shared/src/api/suscripciones.ts) | `getSuscripciones(consulta)`: estado, fecha y orden a la API |
| CH-11, 12, 13 | [web/src/pages/Homepage.tsx](web/src/pages/Homepage.tsx) | Controles, vista en la URL, grilla desde la API, limpiar y sin coincidencias |
| CH-11 | [web/src/components/layout/BarraSuperior.tsx](web/src/components/layout/BarraSuperior.tsx) | Buscar en Inicio ya no borra los filtros de la URL |
| CH-13 | [web/src/components/subscriptions/EmptyState.tsx](web/src/components/subscriptions/EmptyState.tsx) | `actionIcon`: el botón no muestra "+" cuando no invita a crear |

## Cómo funciona

**Antes:** Inicio pedía todas las suscripciones y filtraba por estado en el navegador. No había filtro
por fecha ni orden, y el filtro elegido se perdía al ir a un detalle y volver.

**La consulta va a la API (CH-11, CH-12).** `getSuscripciones()` acepta los filtros y el orden con los
nombres del backend y los manda en **todas** las páginas, así el backend filtra y ordena antes de
paginar:

```ts
export async function getSuscripciones(consulta: ConsultaSuscripciones = {}): Promise<Suscripcion[]> {
  if (consulta.orden !== undefined && !esOrdenSuscripciones(consulta.orden)) {
    throw new RangeError(`Orden de suscripciones no permitido: ${String(consulta.orden)}`);
  }
  // ...por cada página: `/suscripciones/?${parametrosDePagina(consulta, pagina)}`
}
```

- `ORDENES_SUSCRIPCIONES` es la misma lista cerrada que acepta VI-02. Un orden fuera de ella no llega a
  la API: lanza `RangeError` sin hacer ninguna petición.
- El query string se arma con `URLSearchParams`, que codifica cada valor: un filtro no puede colar otro
  parámetro (p. ej. `&page_size=`).

**La vista vive en la URL** (`/home?estado=&fecha_cobro=&orden=&q=`): se conserva al ir a un detalle y
volver, al recargar o al compartir el enlace. La URL la puede escribir cualquiera, así que `leerVista()`
valida cada valor: un estado, una fecha que no existe (`2026-02-30`) o un orden inventado vuelven al
valor predeterminado y nunca viajan a la API. Buscar desde la barra superior ya no borra los demás
parámetros.

**Sin resultados inválidos.** La grilla guarda lo que devolvió la API junto a la consulta que lo pidió.
Al cambiar un filtro se vuelve a la página 1 y, mientras llega la respuesta nueva, se muestran tarjetas
de carga en vez de las de la consulta anterior. Una respuesta tardía de un filtro anterior se descarta.

**Lo que no cambia:**
- El resumen (gasto del mes, conteos de cada estado y si la cuenta está vacía) sale de la lista completa,
  sin filtros.
- La búsqueda por nombre se sigue aplicando en el navegador sobre lo que devolvió la API. Así "Netflíx"
  encuentra "netflix", cosa que el `icontains` del backend no hace. Filtrar no cambia el orden.

**Orden (CH-12).** Un selector "Ordenar por" con seis opciones: nombre, monto o próximo cobro, cada uno
en las dos direcciones. El texto de la opción dice el criterio y la dirección, y un ícono de flecha la
repite. El orden predeterminado es **próximo cobro, el más cercano primero**. Antes se usaba el del
modelo, que muestra primero el cobro más lejano.

**Limpiar y sin coincidencias (CH-13).**
- **Limpiar filtros** aparece solo si hay algo distinto del valor predeterminado. Vuelve a todas, sin
  fecha, al orden predeterminado, sin búsqueda y a la página 1.
- Si la cuenta tiene suscripciones pero ninguna cumple los filtros, se muestra "Ninguna suscripción
  coincide" con los filtros puestos ("en Canceladas, con «net» en el nombre y con cobro el 30 nov
  2026") y un botón para limpiar.
- La cuenta vacía sigue mostrando la invitación a agregar la primera, aunque la URL traiga filtros.

**Al crear** con filtros puestos se quitan el estado y la fecha (la nueva podría no cumplirlos), se
respeta el orden elegido y se muestra la página donde quedó la nueva.

## Cómo se comprobó

- **Pruebas** en `shared/src/api/suscripciones.test.ts` (parámetros en todas las páginas, orden fuera de
  la lista, codificación) y en `web/src/pages/Homepage.test.tsx` (página real, solo se simula la red):
  - estado y fecha combinados;
  - cambiar de filtro estando en la página 2;
  - respuesta tardía de un filtro anterior;
  - la URL se conserva al navegar;
  - buscar sin perder los filtros;
  - orden entre páginas;
  - valores inventados en la URL;
  - limpiar;
  - sin coincidencias frente a cuenta vacía;
  - crear con filtros puestos.
- **Mutaciones:** se rompieron a propósito 17 guardas (validación de la URL, volver a la página 1, no
  mostrar la consulta anterior, descartar respuestas tardías, mandar la fecha, no reordenar en el
  navegador, limpiar orden y búsqueda, mensaje sin coincidencias, chip elegido visible, crear, buscar,
  y en shared la lista cerrada, la codificación y el orden en las páginas siguientes). En todas falla
  alguna prueba.
- **API real:** las vistas de `services/subscriptions` de `main` (SQLite en memoria) con las mismas URLs
  que arma la web. Estado y fecha combinados dan el subconjunto correcto. El orden `-monto` en dos
  páginas es numérico (no como texto) y sin repetidos. Se aceptan los seis órdenes. `orden=password` y
  `fecha_cobro=2026-02-30` dan 400. Las pruebas de VI-01/02/04 y VI-03/09 del backend también pasan
  (29, y 2 se saltan porque necesitan PostgreSQL).
- **Navegador** contra una API falsa: escritorio y celular, tema claro y oscuro, sin coincidencias y
  limpiar.
- CI local desde `frontend/`: typecheck, pruebas (shared 164, web 188) y build. Las pruebas de Inicio
  también pasan con `TZ=UTC` y `TZ=Asia/Tokyo`.

## Notas

- El orden por monto es el del backend: compara el número sin mirar la moneda (USD 10 queda antes que
  CLP 5.990).
- El filtro de fecha es por día exacto del próximo cobro, que es lo que ofrece la API (`fecha_cobro`).
