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
- **Registrar uso y cancelar no se cruzan** (revisión de #112). Las dos devuelven la suscripción completa
  y, si estaban en vuelo a la vez, una respuesta vieja podía tapar a la nueva. La primera corrección
  reconciliaba con recargas, pero si la última recarga fallaba la pantalla quedaba Activa después del
  aviso de cancelación. Ahora se serializan: mientras se registra uso, "Cancelar suscripción" queda
  deshabilitado; con la confirmación abierta o la cancelación en vuelo, el formulario de uso no envía.
  Así cada respuesta es la única en vuelo y se muestra tal cual, sin recargas. Al terminar, bien o mal,
  los controles vuelven. La página también lo verifica (por si se salta la interfaz), y el formulario
  evita el doble envío en el mismo instante con una ref.
- **La reserva es por suscripción** (tercera revisión de #112). Había una sola: si quedaba pendiente el
  uso de A, operar en B y volver a A la borraba, se podía cancelar A y la respuesta vieja del uso la
  devolvía a Activa. Ahora cada suscripción guarda la suya y solo se libera la que terminó. Al volver a A
  con algo pendiente, cancelar y el formulario siguen bloqueados; si lo pendiente es la cancelación, el
  diálogo sigue en curso y muestra cómo terminó. La respuesta que llega se muestra (es lo último que pasó
  con A en el servidor) y la carga de la vuelta que siga en vuelo se descarta, porque puede traer lo de
  antes.

## Cómo se comprobó

La página también aísla cada sesión. Al cerrar sesión o cambiar de cuenta en otra pestaña,
las respuestas pendientes de detalle, historial, uso y cancelación ya no actualizan datos ni
avisos de la cuenta nueva. Los formularios y las reservas se reinician para esa sesión.
La comprobación usa la marca de `AuthContext`, que cambia antes de terminar `/usuarios/me/`;
no depende de que el perfil nuevo ya haya llegado. El formulario de uso descarta además sus
confirmaciones y errores locales cuando termina una petición de la sesión anterior.

- `web/src/pages/SuscripcionDetallePage.sesion.test.tsx`: nueve regresiones con tokens,
  `AuthProvider`, rutas privadas y componentes reales; solo se simula la red. Cubren logout,
  cambio entre cuentas de organizaciones distintas, éxito/error tardíos de cancelación,
  respuestas antiguas de uso/detalle/historial y `/me` de la cuenta nueva todavía pendiente.

- `shared/src/api/suscripciones.test.ts`: la URL es `.../cancelar/` con `POST` y sin cuerpo; un rechazo
  llega como `ErrorDeApi` con su estado.
- `web/src/pages/SuscripcionDetallePage.test.tsx` (página real, solo se simula la red): confirmar,
  cerrar de tres formas sin cambios, doble envío, cuatro tipos de error con reintento, una ya cancelada
  no ofrece cancelar, y la respuesta tardía de otra suscripción.
- Revisión de #112, con la página real:
  - con el uso pendiente, cancelar está deshabilitado y no se envía; al terminar, la cancelación muestra
    Cancelada, "Sin cobros pendientes" y las horas, sin recargar el detalle;
  - con la cancelación en vuelo o la confirmación abierta, el formulario de uso no envía nada, ni
    enviándolo detrás del diálogo;
  - los controles vuelven cuando la cancelación sale bien o falla, y cuando registrar uso falla;
  - dos envíos del uso en el mismo instante mandan uno solo;
  - una operación sola no vuelve a pedir el detalle;
  - A con uso pendiente → uso en B → A: no se cancela hasta que termina el uso de A, y queda Cancelada;
  - si termina primero lo de A estando en B, no libera la reserva de B;
  - al volver a una que se está cancelando, el diálogo sigue en curso y muestra el error si falla;
  - la carga de la vuelta que llega después de la respuesta (de cancelar o de uso) no la revierte.
- **Mutaciones:** se rompió a propósito cada guarda (descartar la respuesta tardía, no cerrar mientras
  envía, cerrar al cambiar de suscripción, mensaje del 403, pedir confirmación, cerrar tras confirmar,
  aclarar que no elimina) y en las 7 falla alguna prueba. Para la serialización de #112, otras 9:
  - el botón Cancelar no se deshabilita;
  - el formulario no se bloquea, o solo se bloquea en vuelo;
  - el formulario envía aunque esté bloqueado;
  - el doble envío se controla con estado en vez de ref;
  - la operación nunca se libera;
  - se puede cerrar el diálogo mientras se cancela;
  - uso o cancelar no reservan la suscripción.

  Para la reserva por suscripción, otras 8, todas detectadas: una sola reserva (empezar en B borra la
  de A), terminar libera todas, la carga de la vuelta no se descarta, mostrar una respuesta no se cuenta,
  al volver no sigue la confirmación en curso, el formulario solo se bloquea por la cancelación, se puede
  cerrar el diálogo mientras se cancela y el uso no reserva. Con el código anterior fallan 4 de las 5
  pruebas nuevas; la quinta (terminar A no libera B) ya se cumplía.
- **Navegador** contra una API falsa: diálogo, confirmar, estado cancelado y aviso, sin errores en consola.
- CI local desde `frontend/`, con `main` ya incorporado a la rama: typecheck, pruebas y build.

## Fuera de esta tarea

- **Reactivar** (VI-09, `POST .../reactivar/`) ya existe en el backend, pero ninguna tarjeta CH lo pide.
- Cancelar desde la tarjeta de Inicio: no se agregó para no tocar `Homepage.tsx`, que cambia en la rama
  de filtros y orden (CH-11 a CH-13).
