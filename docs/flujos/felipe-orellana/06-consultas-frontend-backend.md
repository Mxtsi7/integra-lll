# 06 · Cómo se piden las consultas entre el frontend y el backend

Pendiente del profe (08-10-2026): «aprender la funcionalidad básica entre
backend y frontend, cómo se piden las querys». Acá va con un ejemplo real de
punta a punta: la pantalla de Inicio pidiendo las suscripciones.

**Archivos por los que pasa:**

| Capa | Archivo | Qué hace |
|---|---|---|
| web | `frontend/web/src/main.tsx` | configura la URL base de la API y qué hacer ante un 401 |
| web | la página o componente (ej. `frontend/web/src/pages/Homepage.tsx`) | llama a una función de `@ojoalgasto/shared` |
| shared | `frontend/shared/src/api/suscripciones.ts` | una función por endpoint; traduce lo que llega de la API al tipo del dominio |
| shared | `frontend/shared/src/api/cliente.ts` | `pedir()`: arma el `fetch`, pone el token, maneja errores |
| shared | `frontend/shared/src/auth.ts` | login/register y guardar/leer tokens |
| gateway | `gateway/app/proxy.py` | valida el token y reenvía con la identidad |
| servicio | `services/subscriptions/app/views.py` | el ViewSet que responde |
| servicio | `services/subscriptions/app/serializers.py` | valida el JSON de entrada y arma el de salida |
| servicio | `services/subscriptions/app/models.py` | la tabla |

**Regla de la casa:** las pantallas no hacen `fetch`. Llaman a una función
de `shared/api/` que ya sabe la ruta, el método y cómo traducir la respuesta.
Así la web y la app móvil comparten exactamente el mismo código de acceso a
datos (ADR-006), y si un endpoint cambia se arregla en un solo lugar.

## 1. Al iniciar la app

`main.tsx` configura una sola vez:

```ts
const urlBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";
configurarApi({ urlBase });                  // para pedir()
configureAuthApi({ baseUrl: urlBase });      // para login/register
configurarManejador401(() => { window.location.href = "/login"; });
```

En local `VITE_API_URL` es `http://localhost:8000/api` (el gateway). En el
cluster es `/api`, relativo: la web y la API salen por el mismo dominio y el
nginx del frontend reenvía `/api/` al gateway.

## 2. Login: de dónde sale el token

```
LoginPage ─▶ login({correo, password})            shared/auth.ts
            POST {urlBase}/auth/login/  {email, password}
            ◀─ {access_token, refresh_token, usuario}
         ─▶ guardarTokens(...)                     localStorage: access_token, refresh_token
```

`/api/auth/` es ruta pública en el gateway: no exige token. Es el único
momento en que el frontend manda la contraseña.

## 3. Una consulta con sesión: listar suscripciones

```
Homepage ─▶ getSuscripciones()                                shared/api/suscripciones.ts
               │  for página = 1..N:
               ▼
             pedir<Paginado<SuscripcionDeApi>>("/suscripciones/?page=1")   shared/api/cliente.ts
               │  headers: Content-Type: application/json
               │           Authorization: Bearer <access_token de localStorage>
               ▼
             fetch("http://localhost:8000/api/suscripciones/?page=1")
               ▼
             gateway: valida el JWT, saca Authorization, pone X-Usuario-Id / X-Organizacion-Id / X-Rol
               ▼
             subscriptions: SubscriptionViewSet.list()
                            get_queryset() → Subscription.objects.filter(organizacion_id=<de la cabecera>, activo=True)
                            filtros (?estado=, ?fecha_cobro=) y paginación
                            serializer → JSON
               ▼
             {count, next, previous, results: [{id, nombre, monto: "5990.00", moneda, ...}]}
               ▼
             desdeLaApi(): monto "5990.00" → 5990 (number), null → undefined
               ▼
             Suscripcion[] listo para la pantalla
```

Tres cosas que conviene saber de este camino:

- **`pedir()` pone el token solo.** Ninguna pantalla se preocupa del
  `Authorization`. Si no hay token guardado, la petición va sin él y el
  gateway responde 401.
- **401 = sesión vencida.** `pedir()` borra los tokens y llama al manejador
  configurado en `main.tsx`, que manda al login. Pasa a los 30 minutos
  (`JWT_MINUTOS_ACCESO`).
- **La traducción vive en el borde.** Django manda los `DecimalField` como
  texto para no perder precisión. Si la pantalla sumara `"5990.00"` daría
  `NaN`; por eso `desdeLaApi()` convierte una sola vez y las pantallas
  reciben números.

Un detalle de la paginación: la API devuelve `next` con el host interno
(`http://subscriptions:8002/...`), que el navegador no alcanza. Por eso
`getSuscripciones()` arma la URL de cada página por su cuenta y usa `next`
solo para saber si queda otra.

## 4. Escribir: crear una suscripción

```
NuevaSuscripcionForm ─▶ crearSuscripcion({nombre, monto: 5990, moneda: "CLP", frecuencia, fecha_proximo_cobro, estado, categoria})
                        pedir("/suscripciones/", {method: "POST", body: datos})
                        gateway → subscriptions: SubscriptionViewSet.create()
                                  serializer.is_valid()  → 400 con {campo: ["mensaje"]} si algo falla
                                  perform_create()       → organizacion_id desde la cabecera; el del body se ignora
                        ◀─ 201 {id, ...}
```

Para escritura, `monto` va como número y Django lo acepta; solo se traduce
lo que **llega**, no lo que se envía. Editar es `PATCH /suscripciones/<id>/`
con los campos que cambian; retirar es `DELETE` y hace borrado lógico
(`activo=False`).

## Dónde está cada cosa en el código

Siguiendo el mismo orden del flujo de listar:

| Paso | Archivo y línea | Qué buscar |
|---|---|---|
| URL base de la API | `frontend/web/src/main.tsx:12-14` | `import.meta.env.VITE_API_URL`, `configurarApi({ urlBase })`, `configureAuthApi({ baseUrl })` |
| Qué hacer ante un 401 | `main.tsx:15-17` | `configurarManejador401(() => { window.location.href = "/login" })` |
| La URL base en producción se fija al compilar | `k8s/Dockerfile.web:23-24`, `k8s/desplegar.sh:27` | `ARG VITE_API_URL`; `--build-arg "VITE_API_URL=/api"` |
| nginx manda `/api/` al gateway | `frontend/web/nginx.conf:17-20` | `location /api/` → `proxy_pass http://gateway:8000`, `proxy_set_header Host gateway` |
| **Login** | `frontend/shared/src/auth.ts:75-80` | `login()` → `postJSON("/auth/login/", { email, password })` |
| El `fetch` del login | `auth.ts:23-48` | `postJSON()`: `fetch(`${apiUrl}${path}`, { method: "POST" ... })`; errores → `AuthError` |
| Guardar los tokens | `auth.ts:114-123` | `ACCESS_TOKEN_KEY = "access_token"`, `guardarTokens()` → `storage.setItem` |
| Ruta pública en el gateway | `gateway/config/settings.py:90` | `RUTAS_PUBLICAS = ("/api/auth/",)` |
| **Listar: la pantalla llama a shared** | `frontend/web/src/pages/Homepage.tsx:58-61` | `useEffect(() => { getSuscripciones()...` |
| Recorre las páginas | `frontend/shared/src/api/suscripciones.ts:48-66` | `getSuscripciones()`: `for (pagina = 1; ...)`, `pedir("/suscripciones/?page=N")`, corta cuando `!respuesta.next` |
| Tope de páginas | `suscripciones.ts:46` | `MAX_PAGINAS = 20` |
| Traducción API → dominio | `suscripciones.ts:26-38` | `type SuscripcionDeApi`, `desdeLaApi()`: `Number(s.monto)`, `?? undefined` |
| Datos de ejemplo apagados | `suscripciones.ts:10` | `USAR_DATOS_DE_EJEMPLO = false` |
| `pedir()`: arma el fetch | `frontend/shared/src/api/cliente.ts:47-66` | `headers["Content-Type"]`, `fetch(`${urlBase}${path}`, ...)` |
| `pedir()`: pone el token | `cliente.ts:61-63` | `obtenerAccessToken()` → `headers.Authorization = `Bearer ${token}`` |
| `pedir()`: 401 = sesión vencida | `cliente.ts:73-75` | `logout()` y `manejadorNoAutorizado?.()` |
| `pedir()`: error con mensaje legible | `cliente.ts:36-45` y `:78-87` | `mensajeDesdeCuerpo()`; `throw new ErrorDeApi(message, res.status)` |
| `pedir()`: 204 sin cuerpo | `cliente.ts:90` | `if (res.status === 204) return undefined` |
| Gateway valida y reenvía | `gateway/app/proxy.py:57-114` | `reenviar()` (detalle en [03-gateway.md](03-gateway.md)) |
| El ViewSet que responde | `services/subscriptions/app/views.py:30` | `class SubscriptionViewSet(TenantViewSet)` |
| Filtro por organización + activas | `views.py:52-54` → `shared/tenant/base.py:108-112` | `super().get_queryset().filter(activo=True)`; el `super()` filtra por `organizacion_id` |
| Filtros `?estado=` y `?fecha_cobro=` | `views.py:62-78` | `query_params.get("estado")`, `query_params.get("fecha_cobro")`, `parse_date` |
| Paginación | `services/subscriptions/config/settings.py:75-76` | `DEFAULT_PAGINATION_CLASS: PageNumberPagination`, `PAGE_SIZE: 50` |
| JSON de salida y validación de entrada | `services/subscriptions/app/serializers.py:9` | `class SubscriptionSerializer(ModelSerializer)`; uso en `:69` y `:95` |
| La tabla | `services/subscriptions/app/models.py:10` | `class Subscription(ModeloTenant)`, con `Moneda`, `Categoria`, `Estado`; `RegistroUso` en `:262` |
| **Crear** | `Homepage.tsx:103` → `suscripciones.ts:85-93` | `crearSuscripcion(nueva)` → `pedir("/suscripciones/", { method: "POST", body })` |
| Crear: la organización viene de la cabecera | `shared/tenant/base.py:114-118` | `perform_create()` → `serializer.save(organizacion_id=org)` |
| **Editar** | `Homepage.tsx:138` → `suscripciones.ts:114-122` | `actualizarSuscripcion(id, {...})` → `PATCH` |
| **Retirar** (borrado lógico) | `suscripciones.ts:126-127` → `views.py:84-86` | `eliminarSuscripcion()` → `DELETE`; `perform_destroy()` → `instance.activo = False` |
| **Uso** | `suscripciones.ts:139-143` → `views.py:89-90` | `registrarUso()` → `POST /suscripciones/<id>/uso/`; `@action(url_path="uso")` |

## 5. Cómo leer un error

`pedir()` lanza `ErrorDeApi` con `status` y un `message` sacado del cuerpo:
`detail` si viene (los errores del gateway y de DRF), o el primer mensaje del
primer campo si es un 400 de validación. La pantalla lo muestra en un toast.

| Código | Quién lo generó | Qué significa |
|---|---|---|
| 400 | el serializer del servicio | datos inválidos; el cuerpo dice qué campo |
| 401 | el gateway | sin token o vencido; la web vuelve al login |
| 403 | el servicio | falta la organización en la cabecera (mal configurado) |
| 404 | el servicio | no existe **para esta cuenta** (puede ser de otra) |
| 502 / 504 | el gateway | el servicio está caído o tardó más de 10 s |

## Para seguir una petición con las herramientas del navegador

1. F12 → pestaña *Network* → filtrar `suscripciones`.
2. En *Headers* se ve `Authorization: Bearer ...` saliendo y
   `X-Correlation-ID` volviendo.
3. Ese `X-Correlation-ID` aparece en los logs del gateway y del servicio:
   `docker compose logs gateway subscriptions | grep <id>`.

## Para agregar un endpoint nuevo (receta)

1. **Servicio:** modelo + migración, serializer, ViewSet (hereda de
   `TenantViewSet`), ruta en `urls.py`, tests.
2. **Gateway:** si el prefijo es nuevo, una línea en `RUTAS`.
3. **Shared:** tipo en `tipos.ts`, función en `api/<recurso>.ts` que llame a
   `pedir()`, test en `api/<recurso>.test.ts`.
4. **Web:** la pantalla llama a esa función. Nada de `fetch` en componentes.
