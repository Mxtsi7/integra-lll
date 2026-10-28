# Cancelar una suscripción sin borrarla (web)

**Rama:** `Christopher/cancelar_suscripcion` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-10 | Cancelar suscripción desde web sin borrarla | ✅ |

**Dependencia:** VI-03 (Victor), ya en `main` (PR #103): `POST /api/suscripciones/<id>/cancelar/`.
Pasa la suscripción a `cancelado` por la máquina de estados, conserva sus cobros y es idempotente
(cancelar una ya cancelada responde 200 sin repetir nada).

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/api/suscripciones.ts](shared/src/api/suscripciones.ts) | `cancelarSuscripcion(id)`: `POST .../cancelar/`, traduce la respuesta como el resto |
| [web/src/components/subscriptions/CancelarSus.tsx](web/src/components/subscriptions/CancelarSus.tsx) | Cuerpo de la confirmación: qué se conserva y que no elimina |
| [web/src/pages/SuscripcionDetallePage.tsx](web/src/pages/SuscripcionDetallePage.tsx) | Botón "Cancelar suscripción", diálogo y estado cancelado |

## Qué hace

- En el detalle, **Cancelar suscripción** abre un diálogo (`alertdialog`) que explica que se dejan de
  contar los próximos cobros, que el historial de cobros y de uso se conserva, y que **no** la elimina.
  El foco empieza en **Volver**, la opción que no cambia nada.
- **Volver**, la X y Escape cierran sin llamar a la API. Mientras la cancelación viaja no se puede
  cerrar ni confirmar dos veces.
- Al confirmar se usa la transición del backend, no `DELETE` ni `PATCH`:

  ```ts
  export async function cancelarSuscripcion(id: string): Promise<Suscripcion> {
    const cancelada = await pedir<SuscripcionDeApi>(`/suscripciones/${id}/cancelar/`, { method: 'POST' });
    return desdeLaApi(cancelada);
  }
  ```

- Con la respuesta, el detalle muestra la insignia **Cancelada**, "Sin cobros pendientes" en vez de la
  fecha (igual que la tarjeta de Inicio) y una nota en lugar del botón. El historial de uso sigue ahí.
- **Proyección:** `gastoProyectado()` ya excluye las canceladas y el calendario del backend también, así
  que el gasto del mes y el calendario dejan de contarla sin más cambios. Inicio vuelve a pedir la lista
  al entrar, así que también la muestra cancelada.
- **Eliminar sigue siendo otra cosa:** `DELETE` (en Inicio) la saca de la lista; cancelar no.
- **Errores:** sin red, 403 (rol sin permiso), 404 (ya no existe) y cualquier otro mensaje del backend
  se muestran dentro del diálogo, la suscripción no cambia y se puede reintentar.
- Si se pasa a otra suscripción mientras se cancela, la respuesta tardía no se muestra en la nueva y el
  diálogo de la anterior se cierra.
- **Registrar uso y cancelar a la vez** (revisión de #112). Las dos operaciones devuelven la suscripción
  completa y sus respuestas pueden llegar en cualquier orden. Cada operación del detalle lleva un número
  y solo la última que empezó puede mostrar su respuesta. Si llega una cuando ya empezó otra, no se
  muestra y se vuelve a pedir el detalle (`GET /suscripciones/<id>/`), así manda el servidor y no el orden
  de llegada. Una recarga vieja tampoco tapa a una más nueva, y si la recarga falla no se muestra la
  respuesta vieja. Con una sola operación no hay petición extra.

## Cómo se comprobó

- `shared/src/api/suscripciones.test.ts`: la URL es `.../cancelar/` con `POST` y sin cuerpo; un rechazo
  llega como `ErrorDeApi` con su estado.
- `web/src/pages/SuscripcionDetallePage.test.tsx` (página real, solo se simula la red): confirmar,
  cerrar de tres formas sin cambios, doble envío, cuatro tipos de error con reintento, una ya cancelada
  no ofrece cancelar, y la respuesta tardía de otra suscripción.
- Revisión de #112, con la página real: registrar → cancelar → llega tarde el uso (sigue Cancelada, con
  las horas del servidor y el historial recargado); el orden inverso (llega tarde la cancelación: queda
  Cancelada sin perder las horas); las dos tardías con una recarga vieja; la recarga que falla; y que una
  sola operación no vuelve a pedir el detalle. Las tres primeras fallaban antes de la corrección.
- **Mutaciones:** se rompió a propósito cada guarda (descartar la respuesta tardía, no cerrar mientras
  envía, cerrar al cambiar de suscripción, mensaje del 403, pedir confirmación, cerrar tras confirmar,
  aclarar que no elimina) y en las 7 falla alguna prueba. Para la corrección de #112, otras 5: mostrar
  cualquier respuesta, descartar sin recargar, registrar o cancelar sin número propio, y una recarga
  vieja que se muestra.
- **Navegador** contra una API falsa: diálogo, confirmar, estado cancelado y aviso, sin errores en consola.
- CI local desde `frontend/`: typecheck, pruebas (shared 162, web 191) y build; también mezclada con
  `main` actual.

## Fuera de esta tarea

- **Reactivar** (VI-09, `POST .../reactivar/`) ya existe en el backend, pero ninguna tarjeta CH lo pide.
- Cancelar desde la tarjeta de Inicio: no se agregó para no tocar `Homepage.tsx`, que cambia en la rama
  de filtros y orden (CH-11 a CH-13).
