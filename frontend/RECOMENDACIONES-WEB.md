# Recomendaciones: estado vacío y "No me interesa" (web)

**Rama:** `Christopher/recomendaciones_web` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-26 | Integrar estado vacío de Recomendaciones web | ✅ |
| CH-32 | Descartar recomendaciones desde web | ✅ |

**Dependencias, ya en `main`:**
- AN-20 (Andrea, PR #64): la página `/recomendaciones` y `useRecomendaciones`.
- VI-17 (Victor, PR #105): `GET /api/recomendaciones/`, enrutada por el gateway a Analytics.
- VI-18 (Victor, PR #109): `POST /api/recomendaciones/<id>/dismiss/`, idempotente y con vigencia (30 días por omisión).

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/api/recomendaciones.ts](shared/src/api/recomendaciones.ts) | `RECOMENDACIONES_DISPONIBLES = true`, tipos de VI-17 y `descartarRecomendacion(id)` |
| [web/src/hooks/useRecomendaciones.ts](web/src/hooks/useRecomendaciones.ts) | Lee la lista (con `disponible` y el motivo) y `descartar(id)` |
| [web/src/pages/RecomendacionesPage.tsx](web/src/pages/RecomendacionesPage.tsx) | Tarjetas, estado vacío, error con reintento y botón "No me interesa" |
| [web/src/pages/RecomendacionesPage.module.css](web/src/pages/RecomendacionesPage.module.css) | Colores del tema en vez de blancos fijos |
| [web/src/App.tsx](web/src/App.tsx) | Solo el comentario de la ruta: ya no muestra "Próximamente" |

## Qué hace

- **La página ya es la real.** Mientras VI-17 no existía, `/recomendaciones` mostraba "Próximamente".
  Ahora la bandera es `true` y la página pide la lista. La bandera se queda, por si hay que volver atrás
  sin tocar las rutas.
- **Estado vacío (CH-26).** Reutiliza `EmptyState`. Hay dos casos y no se mezclan:
  - la respuesta llegó bien y `results` viene vacío: "No tienes recomendaciones por ahora", con el motivo
    que da el backend (por ejemplo, "Todavía no hay recomendaciones de consolidación generadas.");
  - `disponible: false`, es decir, Analytics no tiene umbral de ahorro configurado: "Las recomendaciones
    todavía no están disponibles". No es lo mismo que "no hay ninguna".

  En los dos casos no se muestra ningún ahorro, ni siquiera "$0".
- **Error ≠ vacío.** Si la API falla (sin red, 5xx o un formato inesperado) se muestra `ErrorConReintento`,
  con `role="alert"` y botón **Reintentar**. Si se reintenta antes de que llegue la carga anterior, la
  respuesta vieja se descarta.
- **Filtro vacío:** esta página no tiene filtros (VI-17 acepta `?moneda=`, pero la web no lo usa), así
  que el "sin coincidencias" de Inicio no aplica aquí.
- **No me interesa (CH-32).** Cada tarjeta tiene el botón, con nombre accesible
  `No me interesa: <suscripción>`:

  ```ts
  export async function descartarRecomendacion(id: string): Promise<RecomendacionDescartada> {
    return await pedir(`/recomendaciones/${encodeURIComponent(id)}/dismiss/`, { method: 'POST' });
  }
  ```

  - Mientras viaja, el botón queda deshabilitado con spinner. Un doble clic manda un solo descarte
    (se controla con una ref).
  - La tarjeta se retira **solo** cuando el servidor confirma. Entonces aparece el aviso "Listo, dejamos
    de mostrarte esa recomendación." y el foco vuelve a la lista, para no perderse.
  - Si falla, la tarjeta se queda con el error dentro (`role="alert"`) y el mismo botón sirve para
    reintentar. Un 404 dice que ya no está disponible.
  - **No reaparece al recargar:** el backend la excluye mientras el descarte esté vigente. Además, si
    una carga en vuelo la trae porque el servidor la respondió antes de guardar el descarte, la web
    también la filtra.
- **Tarjetas.** El ahorro se formatea con su moneda (`$5.000`, `US$4,50`); antes se mostraba el número
  crudo con un "$". El título es el `nombre` de la suscripción. "Ver suscripción" es un enlace y solo
  aparece si la recomendación trae `suscripcion_id`. La tarjeta ya no es un `div` clicable: así no se
  navega sin querer al apuntar a "No me interesa".
- **Tema claro.** El CSS anterior tenía blancos fijos (`#ffffff`) y en tema claro el título quedaba
  blanco sobre fondo claro. Ahora usa `--tinta`, `--tinta-2`, `.tile`, `Insignia` y `Boton`.

## Cómo se comprobó

- `shared/src/api/recomendaciones.test.ts`: la ruta `.../dismiss/` con `POST` y sin cuerpo, y el id
  codificado.
- `web/src/hooks/useRecomendaciones.test.tsx`:
  - vacío con motivo, `disponible: false` y formato desconocido como error;
  - la carga vieja tras reintentar;
  - descartar: retira solo al confirmar, si falla se queda y se reintenta, doble clic, la carga
    respondida antes del descarte y el 404.
- `web/src/pages/RecomendacionesPage.test.tsx` (página real, solo se simula la red):
  - el ahorro con su moneda y el enlace solo con `suscripcion_id`;
  - los dos vacíos, sin ahorro ni "Reintentar";
  - el error sin red y con 403, con reintento;
  - descartar con el botón deshabilitado en vuelo, el aviso y el foco;
  - el fallo con su alerta en la tarjeta, y descartar la última.
- `web/src/App.test.tsx`: `/recomendaciones` ya no muestra "En construcción" y pide VI-17.
- **Contrato con las vistas reales** de `services/analytics` (código de main, SQLite), con lo que manda
  la web: 6 pruebas temporales, fuera del repo, más las 31 de VI-17/VI-18 del backend, todas pasan.
  - `ahorro_estimado` llega como número.
  - Los motivos reales del vacío: sin recomendaciones, bajo el umbral y sin umbral (este último con
    `disponible: false`).
  - El descarte sin cuerpo responde 200 con `vigente_hasta` a 30 días, desaparece del listado y
    repetirlo es idempotente.
  - Un id inexistente o que no es UUID responde 404.
- **Mutaciones:** se rompió a propósito cada comportamiento y en las 13 falla alguna prueba:
  - retirar antes de confirmar, o también al fallar;
  - sin freno al doble clic;
  - la carga vieja que la vuelve a mostrar, y la carga vieja tras reintentar;
  - ignorar `disponible`, o no mostrar el motivo;
  - ocultar el error de la tarjeta;
  - el botón que no se deshabilita, o el foco que no vuelve;
  - el ahorro sin su moneda;
  - el enlace sin `suscripcion_id`;
  - mostrar un error como vacío.
- **Navegador** contra una API falsa con la forma de VI-17 y VI-18:
  - los estados de lista, vacío, sin umbral y error;
  - descartar con éxito y con fallo;
  - recargar después de descartar;
  - los colores calculados en tema claro y oscuro;
  - 375 px sin scroll horizontal.

## Fuera de esta tarea

- **CH-22** (motivo, ahorro y explicación) sigue esperando a MX-25, la explicación en lenguaje natural.
  Aquí solo se formateó el ahorro con su moneda, porque al activar la página el número crudo con "$"
  quedaba mal para USD.
- La evidencia (`evidencia.url`) y el `motivo` opcional del descarte que acepta VI-18 no se muestran ni se
  piden.
