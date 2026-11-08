# Centro de alertas (web)

**Rama:** `Christopher/centro_alertas` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| SE-01 | Construir estructura del Centro web de alertas | ✅ (la toma este PR; asignada a Sebastian Mena) |
| CH-31 | Integrar filtros, lectura y contador en alertas web | ✅ |

**Dependencias:** FE-19 y FE-20 (Felipe), ya en `main`. El gateway enruta `/api/alertas/` a Notifications.
SE-01 no estaba en ninguna rama ni tenía PR, así que este PR arma la página y sus componentes; Sebastian
puede revisarlos como receptor en vez de hacer otra página (criterio «existe una sola página de alertas»).

| Endpoint | Para qué |
|---|---|
| `GET /api/alertas/?page=&page_size=&lectura=` | El listado, de la más nueva a la más vieja. `lectura` es `pendiente`, `leida` o `revisada`; sin él, todas. Una página vacía que no es la primera responde 404 |
| `GET /api/alertas/contador/` | `{ pendientes, total }` de toda la organización, no de la página |
| `POST /api/alertas/<id>/leer/` | Marca una. Idempotente: si ya estaba leída, la devuelve igual |
| `POST /api/alertas/leer-todas/` | Marca todas. Devuelve `{ leidas }`, cuántas cambiaron |

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/api/alertas.ts](shared/src/api/alertas.ts) | Tipos de FE-19 y FE-20, y las cuatro llamadas |
| [web/src/context/ContadorAlertasContext.tsx](web/src/context/ContadorAlertasContext.tsx) | El número de la campana, uno para todas las páginas |
| [web/src/pages/AlertasPage.tsx](web/src/pages/AlertasPage.tsx) | La página `/alertas`: filtro y página en la URL, lectura, estados |
| [web/src/components/alertas/](web/src/components/alertas/) | `FiltrosAlertas`, `ItemAlerta` y `PaginacionAlertas` |
| [web/src/components/layout/BarraSuperior.tsx](web/src/components/layout/BarraSuperior.tsx) | La campana: va a `/alertas` y cuenta las sin leer |
| [web/src/App.tsx](web/src/App.tsx) | La ruta y el provider del contador dentro de `RutaPrivada` |

## Contrato de los componentes (SE-01)

```tsx
// Los chips de lectura. El filtro lo aplica el servidor.
<FiltrosAlertas valor={filtro} alCambiar={(f: FiltroAlertas) => …} pendientes={number | null} />
// FiltroAlertas = 'todas' | 'pendiente' | 'leida'; leerFiltroAlertas(valor) convierte el de la URL.

// Una alerta: título, mensaje, tipo, fecha y estado. Sin alMarcarLeida no hay botón.
<ItemAlerta alerta={alerta} marcando={boolean} alMarcarLeida={(a: Alerta) => …} />

// Anterior / Siguiente con «Página X de Y». hayAnterior y haySiguiente salen de previous y next.
<PaginacionAlertas pagina={n} totalPaginas={n} hayAnterior haySiguiente alCambiar={(p) => …} />

// El contador, desde cualquier página privada.
const { pendientes, actualizar, descontar } = useContadorAlertas();
```

## Qué hace

- **La campana** abre `/alertas` y se llama «Alertas». El número son las sin leer de la organización
  (`/contador/`), con descripción para lectores («3 alertas sin leer») y «9+» desde diez. Antes contaba
  cobros de la semana y suscripciones sin uso, calculados en Inicio y el Panel, y llevaba a Ajustes
  (#134). Ajustes queda a un clic: «Configurar avisos» en el encabezado del Centro.
- **El contador es uno solo.** Vive en un provider dentro de `RutaPrivada`, así que se vuelve a montar con
  la sesión: el número de una cuenta no queda en la campana de otra. Pregunta al montarse, al volver a
  la pestaña y con cada filtro o página nuevos del Centro: si nacieron alertas, la lista, el chip y la
  campana dicen lo mismo. Si el servidor falla, se queda con lo último que supo.
- **Filtros: Todas, Sin leer y Leídas.** Los aplica el servidor (`?lectura=`). El chip «Sin leer» lleva el
  número de la campana. El filtro y la página viven en la URL (`/alertas?lectura=pendiente&pagina=2`),
  como en Inicio; un valor inventado vale «Todas» y la página 1.
- **Cambiar de filtro no mezcla filas.** Lo cargado lleva la clave de su filtro y página
  (`pendiente|2`), y solo se muestra si es la de la vista actual: ni siquiera en el render que sigue al
  cambio se ven filas del anterior. Mientras, «Cargando tus alertas…». Una respuesta del filtro anterior
  que llega tarde se descarta. Otro filtro empieza en la página 1.
- **Páginas numeradas, no «Ver más».** Al leer con «Sin leer», la alerta sale del filtro y las de atrás
  corren un lugar; acumulando páginas, la que pasó a la página anterior quedaría sin verse. Así cada
  página es la del servidor. Si la página que se estaba viendo ya no existe (404 al recargarla), se pasa
  a la anterior; si llegó así por la URL, a la primera.
- **Marcar como leída** (solo en las sin leer):
  - un POST por alerta: un doble clic manda uno solo, y el botón gira mientras viaja;
  - al confirmar, la fila, la campana y el chip cambian a la vez. La campana baja al instante y después
    vale lo que diga el servidor; una respuesta del contador pedida antes no la vuelve a subir;
  - en «Todas» la fila se queda en su lugar como «Leída»; en «Sin leer» sale y se vuelve a pedir la
    página, que trae la que corrió a su lugar. Si se vació una página que no es la primera, se pasa a la
    anterior sin decir «Estás al día»;
  - si falla, lo dice en un aviso y no cambia nada. Si ya no existe (404), lo dice, la saca y corrige la
    campana.
- **Marcar todas como leídas** aparece si hay alguna sin leer. Un POST, la campana se vacía con lo que
  devuelve (`leidas`) y las filas cambian; después se vuelve a pedir la página.
- **Estados:** cargando, error con Reintentar en la primera carga, y si una recarga falla con la lista a la
  vista, la lista se queda con un aviso y Reintentar. Vacíos con el `EmptyState` de siempre: «No tienes
  alertas», «Estás al día» y «No tienes alertas leídas», los dos últimos con «Ver todas».
- **Ver suscripción** lleva a su detalle cuando la alerta es de una suscripción.
- **Contraste (AA, 4,5:1) en los dos temas.** La insignia «Sin leer» es neutra: en tema claro ningún tono
  de color de `Insignia` llega a 4,5:1 con 12 px (acento 2,6; morado 4,5). Lo sin leer lo marcan la
  franja, el ícono y el título. La fecha usa `--tinta-2` (con `--tinta-3` daba 3,0 y 3,9), el número del
  chip va sin la opacidad de Inicio (3,0 en claro) y «Configurar avisos» es secundario (el sutil daba
  2,7).

## Criterios de aceptación

| Criterio | Cómo se cumple |
|---|---|
| CH-31 · Lectura actualiza fila y contador coherentemente | La fila, la campana y el chip cambian con la misma respuesta; el contador se confirma con el servidor y descarta respuestas viejas |
| CH-31 · Cambiar filtro no duplica ni conserva elementos fuera del filtro | Solo se muestra lo cargado para el filtro y la página actuales, las respuestas tardías se descartan y en «Sin leer» la leída sale |
| SE-01 · Existe una sola página de alertas reutilizable | `/alertas`, con tres componentes y el contador como contrato (arriba) |
| SE-01 · Estados visuales y contrato entregados | Cargando, error, recarga fallida, tres vacíos, sin leer, leída y revisada |
| Evidencia enlazada y revisión por otra persona | Pendiente: revisión del PR. Sebastian como receptor del contrato de SE-01 |

## Diferencias con el texto original

- **Tres estados, no dos.** FE-16 tiene `pendiente`, `leida` y `revisada` (descartada, RF-07). Los chips
  son Todas, Sin leer y Leídas; una revisada se ve en «Todas» con su insignia. Descartar desde la web no
  es parte de estas tarjetas.
- **Las rutas están en español** (`/api/alertas/…/leer/`) y no como en el texto (`/api/alerts/{id}/read/`).
  El cliente usa POST, que el backend acepta igual que PATCH.
- **La campana cambia de destino.** En #134 iba a Ajustes porque no había Centro; ahora va al Centro.
- **Paginar:** numerada y no por acumulación, por lo explicado arriba.

## Cómo se verificó

- **Pruebas nuevas:**
  - `alertas.test.ts` (8): URL del listado con página, tamaño y filtro; contador; leer una con el id
    codificado; leer todas; errores.
  - `ContadorAlertasContext.test.tsx` (7): pregunta al montarse; descontar y confirmar; una respuesta
    vieja no lo sube; nunca baja de cero; un error no lo borra; al volver a la pestaña; fuera del
    provider.
  - `AlertasPage.test.tsx` (25), con StrictMode y un servidor en memoria que filtra, pagina y responde
    404 como DRF:
    - listado y campana; leer; la campana baja sin esperar al contador; doble clic;
    - «Sin leer»: la leída sale aunque la página tarde, y la página trae la que corrió a su lugar;
    - filtros y URL; alertas nuevas al cambiar de filtro; respuesta tardía; sin filas mientras carga;
    - Anterior y Siguiente; vaciar la última página sin mostrar «Estás al día» ni un instante; de la 3 a
      la 2; página inexistente; URL inventada;
    - marcar todas (filas al instante, en «Sin leer» y en la página 2);
    - errores al leer y 404; primera carga fallida, con «Cargando» al reintentar; recarga fallida;
      vacío; enlaces.
  - `BarraSuperior.test.tsx` (7, reescrito): destino, nombre, descripción y «9+»; sin provider; contador
    caído.
  - `App.test.tsx`: la campana desde Inicio y el Panel abre el Centro y Atrás vuelve; «Configurar avisos»
    llega a Ajustes; con un borrador en Ajustes, la campana pregunta antes de salir; con otra cuenta en
    otra pestaña, la campana no muestra el número de la anterior.
- **Suites:** typecheck de los tres paquetes, shared 231, web 505, móvil 101 y build.
- **Mutaciones:** 29 cambios dirigidos, todos detectados (sacar la reserva por alerta, no descontar,
  dejar la leída en «Sin leer», aceptar respuestas viejas, mostrar lo cargado para otra vista, volver a
  la página equivocada, no actualizar la campana con una vista nueva, la campana a Ajustes, sin provider,
  etc.). Las cinco que sobrevivieron la primera vuelta mostraron dos errores reales, ya corregidos: un
  instante de «Estás al día» al retroceder de página, y que de la página 3 se volvía a la 1.
- **Navegador**, contra una API falsa con las reglas de FE-19 y FE-20 (lectura con 700 ms):
  - la campana dice «7 alertas sin leer» en Inicio y lleva al Centro, que muestra 10 de 13 y «Página 1
    de 2»;
  - con 11 sin leer, un doble clic hizo un solo POST, el botón quedó deshabilitado, la leída salió y
    entró la undécima; campana y chip bajaron a 10;
  - con alertas nuevas, al cambiar de filtro la lista, el chip y la campana dijeron 9;
  - una lectura fallida dejó todo igual con su aviso; marcar todas vació la campana y dejó «Estás al
    día»;
  - a 375 px, sin scroll horizontal y con las acciones bajo el texto;
  - contraste en los dos temas: todo lo de esta página pasa. Quedan sin medir los fondos con degradado
    (el chip elegido y el botón primario, como en Inicio).

## Pendiente

- Revisión del PR por otra persona y validación del contrato por Sebastian (SE-01).
- Hoy casi no nacen alertas reales: las generan FE-17 y FE-18 (PR #119, abierto) y el consumidor de FE-24.
- Fuera de este PR, el mismo contraste bajo 4,5:1 en tema claro está en los chips de Inicio (número con
  opacidad), en los tonos de color de `Insignia` y en el botón `sutil`.
