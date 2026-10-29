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
| [web/src/context/AuthContext.tsx](web/src/context/AuthContext.tsx) | La marca de sesión también como estado (`sesion`); un refresh no la cambia |
| [web/src/components/RutaPrivada.tsx](web/src/components/RutaPrivada.tsx) | `<Outlet key={sesion} />`: lo privado se vuelve a montar al cambiar de sesión |
| [shared/src/auth.ts](shared/src/auth.ts) | `sesionDelToken(token)`: de qué usuario, organización y `sid` es un token |

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

## Cambio de sesión (revisión de #128)

Si otra pestaña entraba como B, esta seguía mostrando las recomendaciones de A en la misma ruta: la
guarda privada conserva el `Outlet` y el hook solo cargaba al montar.

- **Un límite común.** `AuthContext` expone la marca de sesión como estado (`sesion`) y
  `<RutaPrivada>` la usa de `key`. Al cambiar de cuenta, todo lo privado se desmonta y se vuelve a
  montar: la lista, los errores, los descartes y sus refs empiezan de cero y se pide la lista de B.
  Pasa al instante, aunque `/usuarios/me/` de B siga pendiente. Sirve igual para las demás pantallas
  privadas, sin un mecanismo por página.
- **Un refresh no es otra sesión.** Antes cualquier token distinto contaba como otra cuenta. Ahora se
  comparan el usuario (`user_id` o `sub`), la organización y el `sid`, que el servicio auth conserva al
  rotar el token. Si coinciden, no se recarga nada; otro login (otro `sid`) sí es otra sesión. Sin esos
  claims se sigue tratando como otra, como antes.
- **Respuestas tardías.** `descartar()` anota la sesión con la que se montó la página. Si al confirmar
  cambió la sesión o se cerró la página, devuelve `null`: no hay aviso, no se mueve el foco y no se toca
  la lista. Con la sesión ya cambiada tampoco se manda un descarte nuevo. Una carga de A que llega
  tarde queda en la página desmontada.

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
- `web/src/pages/RecomendacionesPage.sesion.test.tsx` (revisión de #128): `AuthProvider`, guarda
  privada y tokens reales; solo se simula la red. Cubre:
  - A→B por evento `storage` en la misma ruta, con `/usuarios/me/` de B pendiente;
  - la lista de A, o su error, que llega después del cambio;
  - el descarte de A confirmado tarde, en el mismo instante del cambio o con error;
  - un clic en la tarjeta de A en ese instante;
  - el descarte después de cerrar sesión o de salir de la página;
  - el refresh del token, que no recarga nada.
- `web/src/context/AuthContext.test.tsx` y `shared/src/auth.test.ts`: la marca cambia con otra cuenta,
  con otro login, al salir y al entrar, pero no con un refresh.
- **Mutaciones de la revisión:** sin `key` en la guarda, un refresh como cambio de cuenta, la marca no
  observable, el descarte tardío sin revisar la sesión, sin revisar antes de enviar, y `sigueVigente`
  sin la sesión o sin el montaje. En las 7 falla alguna prueba, y también en las 5 de `sesionDelToken`.
- **Sobre `main` actualizado** (con #131, #122 y #117): shared 215, web 352 y móvil 37 pruebas,
  typecheck y build.
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
  - 375 px sin scroll horizontal;
  - dos pestañas (revisión de #128). Un refresh de A en la otra pestaña no hizo ninguna petición. Con un
    descarte de A en vuelo entró B: la página pasó sola a las recomendaciones de B, y la confirmación
    tardía de A no mostró aviso ni movió el foco.

## Fuera de esta tarea

- **CH-22** (motivo, ahorro y explicación) sigue esperando a MX-25, la explicación en lenguaje natural.
  Aquí solo se formateó el ahorro con su moneda, porque al activar la página el número crudo con "$"
  quedaba mal para USD.
- La evidencia (`evidencia.url`) y el `motivo` opcional del descarte que acepta VI-18 no se muestran ni se
  piden.
