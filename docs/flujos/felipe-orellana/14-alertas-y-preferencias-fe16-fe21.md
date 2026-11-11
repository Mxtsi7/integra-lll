# FE-16, FE-19, FE-20 y FE-21 — Alertas: estados, listado, contador y preferencias

**Qué hace.** El lado de lectura de las alertas en notifications. FE-16 es el
modelo `Alerta`: cinco tipos, tres estados de lectura (`pendiente`, `leida`,
`revisada`) y como máximo una alerta por evento en cada organización. FE-19
lista las alertas de la organización con filtros y paginación. FE-20 marca
una alerta leída o revisada, marca todas de una vez y cuenta las pendientes
para la campana.
FE-21 guarda qué avisos quiere cada persona, por qué canales y con cuántos
días de anticipación. Ninguna de estas rutas crea alertas: las crea el
generador de [FE-17 y FE-18](09-alertas-generadas-fe17-fe18.md), que además
lee las preferencias de FE-21.

**Dónde está.** Rutas relativas a `services/notifications/`, salvo las de
`gateway/` y `shared/`, que van desde la raíz del repo.

| Pieza | Archivo |
|---|---|
| El modelo y sus marcas de lectura (FE-16) | `notifications/models.py` → `Alerta`, `marcar_leida()`, `marcar_revisada()`; migraciones `0001` y `0002` |
| Listado, detalle, contador y acciones (FE-19, FE-20) | `notifications/views.py` → `AlertaViewSet`, `AlertaPagination` |
| Las preferencias por persona (FE-21) | `models.py` → `PreferenciaNotificacion`, migración `0003`; `views.py` → `PreferenciasNotificacionView` |
| El JSON de entrada y salida | `notifications/serializers.py` → `AlertaSerializer`, `ContadorSerializer`, `PreferenciaNotificacionSerializer` |
| Las rutas | `notifications/urls.py` (router `alertas` y `preferencias-alertas/`), bajo `api/` en `notifications_config/urls.py` |
| Los canales que de verdad se entregan | `notifications_config/settings.py` → `CANALES_HABILITADOS`, por omisión `email` e `in_app` |
| El enrutamiento | `gateway/config/settings.py` → `RUTAS`: `/api/alertas/` y `/api/preferencias-alertas/` van a `notifications` |

## Las rutas

| Método | Ruta pública vía gateway | Qué hace | Códigos |
|---|---|---|---|
| GET | `/api/alertas/` | Lista las de la organización, paginada y con filtros | 200 · 400 filtro inválido · 403 sin organización · 404 página que no existe |
| GET | `/api/alertas/{id}/` | Detalle | 200 · 403 · 404 ajena, inexistente o id que no es UUID |
| POST o PATCH | `/api/alertas/{id}/leer/` | `pendiente` → `leida`; devuelve la alerta | 200, también si ya estaba leída · 403 · 404 |
| POST o PATCH | `/api/alertas/{id}/revisar/` | La descarta sin tocar la suscripción (RF-07); devuelve la alerta | 200 · 403 · 404 |
| GET | `/api/alertas/contador/` | `{"pendientes": n, "total": m}` de toda la organización | 200 · 403 |
| POST o PATCH | `/api/alertas/leer-todas/` | Marca leídas todas las pendientes; `{"leidas": n}` | 200 · 403 |
| GET | `/api/preferencias-alertas/` | Las propias; la primera vez crea los valores por omisión | 200 · 403 sin organización, sin usuario, o usuario u organización eliminados |
| PATCH | `/api/preferencias-alertas/` | Cambia solo lo que viene en el cuerpo | 200 · 400 sin guardar nada · 403 |

- El gateway responde 401 antes si falta el token o no vale
  ([03-gateway.md](03-gateway.md)). Al servicio llegan `X-Usuario-Id`,
  `X-Organizacion-Id` y `X-Rol`; `ContextoTenantMiddleware`
  (`shared/tenant/base.py`) las deja en `request`.
- POST, PUT, PATCH y DELETE sobre `/api/alertas/` y `/api/alertas/{id}/` dan
  405; PUT, POST y DELETE sobre `/api/preferencias-alertas/`, también.
- El 410 `organizacion_eliminada` y el 403 `organizacion_invalida` en POST y
  PATCH los pone `shared/borrado/middleware.py` (MX-07), no estas tarjetas.

**Quién ve qué.** Las alertas son de la organización: `SoloLecturaTenantViewSet`
filtra por `X-Organizacion-Id` y da 403 si falta, y `contador` y `leer-todas`
exigen lo mismo con `_del_tenant()`. Una alerta ajena da 404. La lectura vive
en la fila de la alerta: si una persona la marca leída, queda leída para toda
la organización. Ninguna vista de estas tarjetas mira `X-Rol` (`request.rol`):
todos los roles de la organización ven y marcan lo mismo. Las preferencias son
de la persona: la llave es (organización, usuario), las dos de las cabeceras,
sin listado ni `{id}`; `organizacion_id` o `usuario_id` en el cuerpo se ignoran.

**Filtros, orden y paginación.** `?lectura=` (`pendiente`, `leida`,
`revisada`), `?tipo=` (`proximo_cobro`, `fin_prueba`, `alza_tarifa`,
`doble_cobro`, `presupuesto_excedido`) y `?suscripcion_id=<uuid>`, combinables.
Un valor fuera de la lista da 400 (`{"lectura": "Debe ser uno de: pendiente,
leida, revisada."}`) en vez de listar todo. Solo filtran el listado: el
detalle y las acciones los ignoran. El orden es fijo, `-creado_en` y después
`-id`. Páginas de 10, con `?page=` y `?page_size=` hasta 100. Así responde
`GET /api/alertas/?lectura=pendiente`:

```json
{"count": 12, "next": "…/api/alertas/?lectura=pendiente&page=2", "previous": null,
 "results": [{"id": "3e1f0c04-…", "tipo": "proximo_cobro", "tipo_legible": "Próximo cobro",
   "titulo": "Netflix se cobra en 3 días",
   "mensaje": "El cobro de 9.990 CLP de Netflix está programado para el 04-11-2026.",
   "suscripcion_id": "fbb2d3ea-…", "datos": {"origen": "generador", "fecha_cobro": "2026-11-04",
     "dias_faltantes": 3, "anticipacion_dias": 3, "monto": "9990.00", "moneda": "CLP"},
   "lectura": "pendiente", "lectura_legible": "Pendiente", "pendiente": true,
   "leida_en": null, "revisada_en": null, "creado_en": "2026-11-01T20:22:04.562240-03:00"}]}
```

**Leer contra revisar.** `leer` solo cambia una `pendiente`: la deja `leida`
con `leida_en`. `revisar` deja la alerta `revisada` con `revisada_en`; si
estaba pendiente también le pone `leida_en`, y si ya estaba leída conserva esa
fecha. Repetir cualquiera de las dos responde 200 sin mover fechas, y `leer`
sobre una revisada la deja revisada. `contador` cuenta `pendientes` (solo
`lectura=pendiente`) y `total`, sin filtros. `leer-todas` devuelve en `leidas`
cuántas pendientes encontró y marcó: las ya leídas o revisadas no suman.

**Preferencias.** El primer GET devuelve:

```json
{"por_email": true, "por_push": false, "en_la_app": true, "avisar_proximo_cobro": true,
 "avisar_fin_prueba": true, "avisar_alza_tarifa": true, "avisar_doble_cobro": true,
 "avisar_presupuesto_excedido": true, "dias_anticipacion": 3,
 "canales_disponibles": ["email", "in_app"], "canales_elegidos": ["email", "in_app"],
 "actualizado_en": "2026-11-01T20:22:04.685866-03:00"}
```

El PATCH acepta cualquier subconjunto de los nueve primeros, por ejemplo
`{"por_push": true}`, y devuelve el objeto completo. `dias_anticipacion` va de
1 a 30; fuera de eso, o un valor no booleano en un campo booleano, da 400
(`{"dias_anticipacion": ["Asegúrese de que este valor es menor o igual a
30."]}`) y no se guarda nada, ni lo válido que venía al lado. Los tres
últimos son de solo lectura, y una clave desconocida se ignora con 200.

## El flujo

```
navegador ─ Bearer ─▶ gateway ─ valida JWT (401) ─ pone X-Usuario-Id / X-Organizacion-Id / X-Rol
                                    │  RUTAS: /api/alertas/, /api/preferencias-alertas/
                                    ▼
             notifications:8005  ContextoTenantMiddleware → request.organizacion_id, usuario_id
              ├─ AlertaViewSet ── WHERE organizacion_id = … ──────────────▶ alerta
              │     leer / revisar: UPDATE condicionado por lectura (marcar_leida / marcar_revisada)
              └─ PreferenciasNotificacionView ── get_or_create(org, usuario) ─▶ preferencia_notificacion
                                                                                   │ la lee
             manage.py generar_alertas (FE-17/18) ◀────────────────────────────────┘
                   └── crea en pendiente ──▶ alerta
```

Estas rutas no publican eventos ni encolan tareas. Trabajan sobre `alerta` y
`preferencia_notificacion`; además, el bloqueo de MX-07 toma la fila de
`estado_eliminacion_organizacion` y las preferencias revisan
`usuario_eliminado`, todo en el esquema `notifications`. La campana y el
Centro de alertas de la web están en
[frontend/CENTRO-DE-ALERTAS.md](../../../frontend/CENTRO-DE-ALERTAS.md), y
Ajustes en [frontend/PREFERENCIAS-DE-ALERTAS.md](../../../frontend/PREFERENCIAS-DE-ALERTAS.md).
La web todavía no llama a `revisar` (`frontend/shared/src/api/alertas.ts`).

## Decisiones

- **Tres estados, no dos** (b8af7ae). RF-07 permite descartar una anomalía sin
  cambiar la suscripción: verla y darla por resuelta son cosas distintas.
  `evento_id` es la idempotencia, con la restricción `alerta_unica_por_evento`
  sobre (organización, `evento_id`); no sale en la respuesta (36070b6).
- **Las marcas son un UPDATE condicionado por el estado en la base** (12e8f75).
  Con el estado en memoria, dos instancias dejaban una alerta `leida` con
  `revisada_en` informado, un estado que no existe.
- **Solo lectura para el CRUD, verbos para la lectura** (36070b6). Una alerta
  nace de un evento, no de un POST. Las acciones aceptan PATCH porque la
  tarjeta lo pide y POST porque los clientes ya lo usan; el PATCH genérico
  sigue en 405 (caabcc7).
- **`leer-todas` recorre en vez de un `update()` masivo** (36070b6), para que
  cada una quede con su `leida_en`. El UUID de `suscripcion_id` se valida
  antes de filtrar, porque dentro del paginador ya saldría un 500.
- **Sin cabecera, 403 y no cero; orden total** (caabcc7). `contador` y
  `leer-todas` respondían 200 con cero sin organización, y con solo `-creado_en`
  dos alertas del mismo instante podían repetirse entre páginas (migración `0002`).
- **Preferencias: una fila por persona, columnas y solo PATCH** (f7f6302). Dos
  personas del mismo tenant pueden querer avisos distintos; con columnas el esquema
  dice qué existe y una prueba falla si un `Alerta.Tipo` queda sin su campo; un
  PUT con campos de menos borraría lo que el cliente no conoce. El GET crea los
  valores por omisión porque no existe "sin preferencias", existe "todavía no
  las cambió". `por_push` se guarda aunque no se entregue, y
  `canales_disponibles` dice qué llega hoy.
- **Las preferencias respetan la eliminación de cuentas** (426532d, de
  MX-07): el GET y el PATCH pasan por `_mias()`, que toma el bloqueo compartido
  de la organización y da 403 si la organización fue eliminada o si la persona
  está en `UsuarioEliminado`, para que una petición en vuelo no recree la fila.

## Cómo probarlo

```bash
cd services/notifications
ESQUEMA_BD=notifications SECRET_KEY=x DEBUG=False CLAVES_CIFRADO=x DATABASE_URL=sqlite://:memory: pytest tests/test_alerta.py tests/test_listar_alertas.py tests/test_preferencias.py -q

# a mano, con el stack levantado y un $TOKEN (ver 03-gateway.md):
curl -s -H "Authorization: Bearer $TOKEN" "localhost:8000/api/alertas/?lectura=pendiente"
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"por_push": true}' localhost:8000/api/preferencias-alertas/
```

86 pruebas. `test_alerta.py` (24): aislamiento, nace pendiente, marcas
idempotentes, dos instancias de la misma alerta, un evento una alerta, los
cinco tipos y el orden. `test_listar_alertas.py` (30): aislamiento del
listado, el contador y las acciones; filtros y sus 400; paginación y orden
total; leer, revisar y `leer-todas`; 403 sin cabecera; PATCH en las acciones y
405 en el recurso. `test_preferencias.py` (32): un campo por tipo, valores por
omisión, alcance por persona, PATCH parcial, PUT en 405, PATCH inválido todo o
nada, límites 1 y 30, canales disponibles y `debe_avisar`.

## Lo que queda para otras tarjetas

Entregar por correo o push queda para FE-22 en adelante (`generador.py`,
`models.py`): hoy `CANALES_HABILITADOS` no incluye `push` por omisión, y
cuando se agregue nadie tiene que volver a elegirlo. Anular las alertas
pendientes cuando la suscripción cambia, por ejemplo cuando se cancela, es
FE-23 (`docs/investigacion/MX-22-matriz-requisitos.md`).
