# MX-09 / MX-16 — Permisos y catálogo de planes

[MX-09](https://trello.com/c/cP9ziws6), [MX-16](https://trello.com/c/JxKWL5Wp).
PR apilado sobre Maxi-planes (MX-15/MX-08).

Ambos GET requieren sesión en Gateway y usuario/contexto vigente en Auth:

- `/api/planes/`: lista de código, nombre, precio decimal **string**, moneda,
  periodo, precio_demo y features. Consultar no contrata ni modifica datos.
- `/api/usuarios/me/permisos/`: `{plan, features}` calculado desde contratación.

La matriz RF-17/18 concede `asistente_financiero` y
`recomendaciones_automaticas` exclusivamente a Premium. No se añaden
restricciones a CSV, panel u otras funciones que el requisito no hace Premium.
El catálogo inicial se rotula demo; los importes no son una oferta comercial.

Gateway consulta Auth en cada llamada a `/api/asistente/` y
`/api/recomendaciones/`, incluidos sus subrecursos. Free recibe 403 antes de
llamar a Analytics. Una caída/contrato inválido de Auth da 503; nunca autoriza
por un claim o cabecera del navegador. `X-Plan`/`X-Features` se descartan.
No hay caché de plan ni permisos en JWT: no existe una ventana de concesión
obsoleta tras vencimiento. Los servicios internos permanecen en la red privada
según ADR-004; cualquier ruta Premium nueva debe aplicar el mismo control.

Web y móvil usan `getPlanes`/`getPermisosPlan` de shared. Tras contratar o
cancelar, recargan permisos; ocultar un botón no reemplaza el control backend.
VI-22 y VI-17 reciben este contrato para integrar sus endpoints de dominio;
este PR no implementa chat, recomendaciones ni pantallas de otros responsables.

Pruebas: Auth `test_permisos_plan.py`, Gateway `test_permisos_plan.py`,
OpenAPI estricto, TypeScript y suite compartida/web. Revisión y aceptación
de Sebastian/Andrea/Victor pendientes, sin atribuirlas a los tests.
