# 04 · Aislamiento entre cuentas (RF-26 del modelado, RF-20 en la numeración evaluada)

**Tarea de la planilla:** Probar el aislamiento (RF-26).

**Archivos:**

| Archivo | Qué hace |
|---|---|
| `gateway/app/proxy.py` | descarta las cabeceras de identidad que vengan de afuera y pone las del token |
| `shared/tenant/base.py` | `ModeloTenant`, `ContextoTenantMiddleware`, `TenantViewSet` |
| `gateway/tests/test_gateway.py` | el gateway no deja fabricar identidad |
| `services/subscriptions/tests/test_views.py` | otra cuenta recibe 404; sin cabecera, 403 |

El aislamiento se sostiene en **dos capas** que tienen que fallar las dos
para que una cuenta vea datos de otra.

## Capa 1: el gateway es el único que pone la identidad

```
cliente ──X-Organizacion-Id: <ajena>──▶ gateway: la descarta
cliente ──Authorization: Bearer <jwt>──▶ gateway: valida y pone X-Organizacion-Id desde el token
```

La organización sale del token firmado por `auth`. Un cliente no puede
inventarla por cabecera (se descarta) ni por token (no tiene el secreto para
firmar uno). Pruebas: `test_descarta_cabeceras_de_identidad_que_manda_el_cliente`,
`test_firma_con_otro_secreto_es_401`, `test_inyecta_usuario_organizacion_y_rol_desde_el_token`.

Esto depende de que los servicios **no estén expuestos**. En Kubernetes se
cumple: el ingress solo apunta al Service `web`, y `auth` y `subscriptions`
son Services internos (ClusterIP). En compose, en cambio, `auth` y
`subscriptions` publican 8001 y 8002 en `localhost` para poder probarlos a
mano; ahí uno puede mandar cualquier cabecera a `localhost:8002` directo. Es
comodidad de desarrollo, no una brecha en producción, pero conviene
saberlo.

## Capa 2: cada servicio filtra siempre por organización

`shared/tenant/base.py` se monta igual en todos los servicios. Es el único
código compartido entre ellos, a propósito: el aislamiento tiene que
comportarse exactamente igual en todos.

- **`ModeloTenant`**: toda tabla de negocio hereda de acá y lleva
  `organizacion_id` (UUID indexado). No es clave foránea: la tabla de
  organizaciones vive en el esquema de `auth`, que `subscriptions` no consulta.
- **`ContextoTenantMiddleware`**: lee `X-Organizacion-Id`, `X-Usuario-Id`,
  `X-Rol` y `X-Correlation-ID` y los deja en `request`.
- **`TenantViewSet`**: todo ViewSet de datos hereda de acá.
  - `get_queryset()` filtra por `request.organizacion_id`. Cubre listar,
    detalle, editar y borrar de una vez, porque todas pasan por ahí. Una
    suscripción de otra cuenta **no existe** para la consulta, así que
    responde 404, sin revelar que hay algo.
  - `perform_create()` asigna `organizacion_id` desde la cabecera e ignora
    cualquier `organizacion_id` que venga en el cuerpo.
  - Si la cabecera no viene, **403** en vez de devolver todo. Que falte
    significa que algo está mal configurado y, ante la duda, no se entregan
    datos.

Los ids son UUID y no enteros (`ModeloBase`): con `id=1, 2, 3` cualquiera
prueba `id=2` a ver qué sale.

## Flujo completo de un intento de acceso ajeno

```
cuenta A pide PATCH /api/suscripciones/<id de B>/
   gateway: token válido de A → X-Organizacion-Id: <org A>
   subscriptions: get_queryset() = Subscription.filter(organizacion_id=<org A>)
                  <id de B> no está en ese conjunto → 404
```

## Dónde está cada cosa en el código

| Capa | Paso | Archivo y línea | Qué buscar |
|---|---|---|---|
| 1 gateway | Cabeceras que solo pone el gateway | `gateway/app/proxy.py:27` | `CABECERAS_DE_IDENTIDAD = {"x-usuario-id", "x-organizacion-id", "x-rol"}` |
| 1 gateway | Se descartan si vienen del cliente | `proxy.py:66-71` | el diccionario `cabeceras` las excluye |
| 1 gateway | La organización sale del token firmado | `gateway/app/identidad.py:34-38` → `proxy.py:83-84` | `jwt.decode(...)` → `cabeceras["X-Organizacion-Id"]` |
| 1 gateway | El token no sigue hacia adentro | `proxy.py:81` | `cabeceras.pop("Authorization", None)` |
| 1 gateway | Pruebas | `gateway/tests/test_gateway.py` | `test_descarta_cabeceras_de_identidad_que_manda_el_cliente`, `test_firma_con_otro_secreto_es_401`, `test_inyecta_usuario_organizacion_y_rol_desde_el_token` |
| 1 red | Solo `web` sale a internet | `k8s/20-ingress.yaml:29-37` | `host: ojoalgasto-forellana.dev.censei.cl` → `name: web`, `port: 80` |
| 1 red | nginx solo reenvía `/api/` al gateway | `frontend/web/nginx.conf:17-20` | `location /api/` → `proxy_pass http://gateway:8000` |
| 2 servicio | UUID en vez de enteros | `shared/tenant/base.py:31` | `id = models.UUIDField(primary_key=True, default=uuid.uuid4)` |
| 2 servicio | Toda tabla de negocio lleva `organizacion_id` | `shared/tenant/base.py:40-51` | `class ModeloTenant` → `organizacion_id = models.UUIDField(db_index=True)` |
| 2 servicio | Las cabeceras pasan a `request` | `shared/tenant/base.py:63-80` | `ContextoTenantMiddleware.__call__`: `request.organizacion_id = request.headers.get("X-Organizacion-Id")` |
| 2 servicio | Filtro en todas las operaciones | `shared/tenant/base.py:108-112` | `TenantViewSet.get_queryset()` → `.filter(organizacion_id=org)` |
| 2 servicio | 403 si falta la cabecera | `shared/tenant/base.py:111` y `:116` | `raise PermissionDenied("Falta el contexto de organización")` |
| 2 servicio | Al crear, ignora el `organizacion_id` del cuerpo | `shared/tenant/base.py:114-118` | `perform_create()` → `serializer.save(organizacion_id=org)` |
| 2 servicio | El ViewSet de suscripciones hereda todo eso | `services/subscriptions/app/views.py:30, 52-54` | `class SubscriptionViewSet(TenantViewSet)`; `super().get_queryset().filter(activo=True)` |
| 2 servicio | Borrado lógico (el histórico no se pierde) | `services/subscriptions/app/views.py:84-86` | `perform_destroy()` → `instance.activo = False` |
| 2 servicio | Uso e histórico pasan por el mismo filtro | `services/subscriptions/app/views.py:89-90` | `@action(detail=True, ..., url_path="uso")` → `get_object()` usa `get_queryset()` |
| 2 servicio | Pruebas | `services/subscriptions/tests/test_views.py:211, 227, 241, 253, 328, 343, 417, 802, 815, 1017, 1028` | las listadas abajo |
| 2 servicio | Los modelos heredan de `ModeloTenant` | `services/subscriptions/app/models.py:10, 262` | `class Subscription(ModeloTenant)`, `class RegistroUso(ModeloTenant)` |
| 2 servicio | El middleware está activado | `services/subscriptions/config/settings.py:51` | `"shared.tenant.base.ContextoTenantMiddleware"` en `MIDDLEWARE` |

## Cómo probarlo

```bash
docker compose exec gateway pytest -v -k "descarta or firma or inyecta"
docker compose exec subscriptions pytest tests/test_views.py -v -k "isolation or aislamiento or missing_header or sin_cabecera or payload_organization or reassign"
```

Las pruebas de `subscriptions` que lo cubren:

- `test_tenant_isolation_patch_from_other_account_returns_404`
- `test_tenant_isolation_delete_from_other_account_returns_404`
- `test_registrar_uso_aislamiento_tenant_otra_org_devuelve_404`
- `test_historico_uso_aislamiento_otra_organizacion_devuelve_404`
- `test_request_missing_organization_header_returns_403` (y las equivalentes de crear, listar, uso e histórico)
- `test_cannot_reassign_organization_via_payload`, `test_create_subscription_ignores_payload_organization`

A mano, con dos cuentas en producción: entrar con una, copiar el id de una
suscripción, entrar con la otra y pedir `GET /api/suscripciones/<ese id>/`.
Tiene que dar 404.

## Qué queda pendiente

- `ContextoTenantMiddleware` tiene `RUTAS_LIBRES` declarado pero no lo usa:
  hoy `/health/` funciona porque la vista de salud no pasa por un
  `TenantViewSet`. Es limpieza, no un hueco.
- La separación por esquema en Postgres se apoya en el `search_path`, no en
  permisos. El usuario por servicio quedó comentado en
  `infra/migraciones/01-esquemas.sql` para un sprint posterior.
