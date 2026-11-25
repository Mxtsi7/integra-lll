

## Qué hace
`useAlertas` (en `screens/components/alertas/useAlertas.ts`) trae las alertas y el contador del backend y permite marcarlas como leídas.

| Acción | Endpoint | Qué pasa en pantalla |
|---|---|---|
| Cargar | `GET /api/alertas/?page=1` + `GET /api/alertas/contador/` | Lista y badge salen del backend |
| Filtrar "Sin leer" | `GET /api/alertas/?lectura=pendiente` | Se vuelve a pedir desde la página 1; una alerta marcada leída sale de la lista |
| Volver a la pantalla | Igual que cargar, en segundo plano | Se actualizan filas y badge; no reaparece una alerta ya leída |
| Ver más | `GET /api/alertas/?page=N` | Agrega sin repetir alertas ya mostradas |
| Marcar una | `POST /api/alertas/<id>/leer/` | Se usa la alerta que devuelve el backend; el badge baja 1 solo si estaba pendiente |
| Marcar todas | `POST /api/alertas/leer-todas/` | Después se vuelve a pedir todo y se muestra lo que confirma el backend |

## Reglas de seguridad y concurrencia
- Respuesta tardía (se recargó o se salió de la pantalla): se descarta (`numeroDeCarga`).
- Marcar leída no depende de recargas de la lista: su resultado vale aunque la lista cambie en el medio.
- Doble toque: una sola petición por alerta (candado por id).
- Si falla marcar, se avisa y la alerta sigue pendiente; no se dice "leída" sin confirmación del backend.
- El badge nunca baja de 0.
- El filtro cambia solo la lista: el badge siempre es el del backend para toda la organización, no depende de la página ni del filtro.
- Una recarga en segundo plano que falla deja lo que ya se ve.

## Contrato
El badge es `pendientes` de `GET /api/alertas/contador/` (de toda la organización, no de la página). Para mostrarlo fuera de esta pantalla, se reutiliza `getContadorAlertas` de shared.

## Pendiente / límites
- "Badge global": este PR deja el contador listo en `useAlertas` y lo muestra en el Centro de alertas. Mostrarlo en la barra de navegación (otras vistas) necesita tocar la navegación de Sebastian (SE-06) y queda fuera de este PR.
- Al volver a la pantalla se recarga la página 1: las páginas extra cargadas con "Ver más" se pierden.
- Probado solo con funciones falsas; falta probar contra el backend real.
- Un receptor debe validar el contrato (criterio de la tarjeta).
