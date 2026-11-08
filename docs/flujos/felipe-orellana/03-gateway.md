# 03 · Gateway: proxy, JWT e identidad en cabeceras

**Tareas de la planilla:** Configurar proxy reverso base · Lógica para leer y
decodificar JWT · Validar criptográficamente la firma · Extraer
`X-Usuario-Id`, `X-Organizacion-Id` y `X-Rol` del payload · Inyectar las
cabeceras en las peticiones proxy · Interceptar y devolver errores 401/403 ·
Documentación técnica de arquitectura y variables de entorno.

**Archivos:**

| Archivo | Qué hace |
|---|---|
| `gateway/app/proxy.py` | la única vista: decide servicio, valida, reenvía, devuelve |
| `gateway/app/identidad.py` | lee y valida el JWT, devuelve la identidad |
| `gateway/config/settings.py` | `SERVICIOS`, `RUTAS`, `RUTAS_PUBLICAS`, `TIEMPO_ESPERA_SEGUNDOS` |
| `gateway/README.md` | contrato del token, rutas, códigos, variables |
| `gateway/tests/test_gateway.py` | 17 pruebas, sin base de datos |

El gateway no tiene modelos ni base (`DATABASES = {}`). Es Django porque el
resto del backend ya lo era y así comparte CI, Dockerfile y forma de
configurarse.

## Flujo de una petición

```
GET /api/suscripciones/?page=1
Authorization: Bearer eyJ...
X-Organizacion-Id: 1234   ◀── si el cliente manda esto, se descarta
        │
        ▼ 1. servicio_para("/api/suscripciones/") → "subscriptions"   (404 si no está en RUTAS)
        ▼ 2. copia las cabeceras del cliente SIN las de transporte NI las de identidad
        ▼ 3. ¿ruta pública? /api/auth/* no exige token. El resto sí:
              leer_token()  →  "Bearer <jwt>"           (401 si falta)
              validar()     →  jwt.decode(secreto, HS256, require exp)
                               401 si firma inválida, vencido o sin sub/user_id
        ▼ 4. saca Authorization; pone
              X-Usuario-Id: <sub>
              X-Organizacion-Id: <organizacion_id>   (si viene en el token)
              X-Rol: <rol>                           (ídem)
              X-Correlation-ID: <el del cliente o uno nuevo>
        ▼ 5. requests.request(mismo método, http://subscriptions:8002 + misma ruta y query, mismo cuerpo, timeout 10 s)
        ▼ 6. devuelve el cuerpo y el código tal cual (un 403 del servicio llega como 403)
              502 si el servicio no está levantado · 504 si no respondió en 10 s
```

### Paso 1: enrutamiento

`RUTAS` en `settings.py` es un diccionario prefijo → servicio. La ruta no se
traduce: `/api/suscripciones/` en el gateway llega a `subscriptions` como
`/api/suscripciones/`. Agregar un endpoint nuevo es una línea ahí.

| Prefijo | Servicio |
|---|---|
| `/api/auth/` | auth, **pública** |
| `/api/usuarios/`, `/api/organizacion/` | auth |
| `/api/suscripciones/`, `/api/usos/` | subscriptions |
| `/api/conectores/`, `/api/importaciones/` | connectors |
| `/api/recomendaciones/`, `/api/analitica/`, `/api/asistente/` | analytics |
| `/api/alertas/`, `/api/preferencias-alertas/` | notifications |

`/api/asistente/` es el único prefijo de IA que atiende a clientes. El gateway
valida el JWT y, cuando la ruta lo exige, inyecta `X-Plan: premium` con el plan
verificado en la base de Auth. Un usuario Free recibe **403** y nunca llega a
Analytics. Ningún cliente habla directo con el proveedor externo ni con
`analytics:8004`: el wrapper común está en `shared/ia/cliente.py`.

### Paso 3: decodificar y validar el JWT

`identidad.validar()` usa PyJWT:

```python
jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITMO], options={"require": ["exp"]})
```

Eso verifica en una sola llamada la **firma** (el secreto es el mismo con que
`auth` firmó) y la **expiración**. Se exige `exp`: un token sin vencimiento
no se acepta. El identificador de usuario puede venir como `sub` o como
`user_id` (lo segundo es lo que pone `simplejwt` por defecto).

El contrato completo del token está en `gateway/README.md`. `auth` lo cumple
poniendo `organizacion_id` y `rol` en los claims al hacer login.

### Paso 4: inyectar la identidad

Las tres cabeceras **solo las pone el gateway**. Si el cliente las manda, se
descartan en el paso 2 antes de validar nada. El token no se reenvía: los
servicios internos no lo necesitan y no deberían verlo. Es el corazón del
aislamiento (ver [04-aislamiento-rf26.md](04-aislamiento-rf26.md)).

### Errores que devuelve el gateway por sí mismo

| Código | Cuándo |
|---|---|
| 401 | sin token, firma inválida, vencido, sin usuario. Lleva `WWW-Authenticate: Bearer` |
| 404 | ruta que no está en `RUTAS` |
| 502 | el servicio de destino no está levantado |
| 504 | el servicio no respondió en `TIEMPO_ESPERA_SEGUNDOS` (10 s) |

El **403 no lo genera el gateway**: lo genera el servicio (por ejemplo,
`subscriptions` cuando falta la cabecera de organización) y el gateway lo
deja pasar sin tocarlo. El gateway autentica; autorizar es de cada servicio.

Toda respuesta, de error o no, lleva `X-Correlation-ID`. Sirve para seguir
una misma petición por los logs del gateway y del servicio.

## Dónde está cada cosa en el código

Todo el flujo vive en una función, `reenviar()` en `gateway/app/proxy.py:57`.
Línea por línea:

| Paso | Archivo y línea | Qué buscar |
|---|---|---|
| Correlation id: el del cliente o uno nuevo | `gateway/app/proxy.py:58` | `request.headers.get("X-Correlation-ID") or uuid.uuid4().hex` |
| 1. Decide el servicio por prefijo | `proxy.py:60` → `proxy.py:37-41` | `servicio_para(request.path)`; recorre `settings.RUTAS` |
| Tabla de prefijos | `gateway/config/settings.py:77-88` | `RUTAS = { "/api/auth/": "auth", ... }` |
| URL de cada servicio | `gateway/config/settings.py:65-71` | `SERVICIOS = { "auth": env("URL_AUTH", ...) }` |
| 404 si el prefijo no existe | `proxy.py:61-62` | `respuesta_de_error(404, "Ruta desconocida", ...)` |
| 2. Copia cabeceras sin transporte ni identidad | `proxy.py:66-71` | diccionario que excluye `CABECERAS_DE_SALTO` (`:30`) y `CABECERAS_DE_IDENTIDAD` (`:27`) |
| 3. ¿Ruta pública? | `proxy.py:73` → `proxy.py:44-45` | `es_publica()`; `RUTAS_PUBLICAS = ("/api/auth/",)` en `settings.py:90` |
| 3. Leer el `Bearer` | `gateway/app/identidad.py:22-29` | `leer_token()`: exige el prefijo `Bearer ` y que no venga vacío |
| 3. Decodificar y validar firma + expiración | `identidad.py:31-43` | `validar()` → `jwt.decode(token, settings.JWT_SECRET, algorithms=[...], options={"require": ["exp"]})` |
| 3. Secreto y algoritmo | `gateway/config/settings.py:59-60` | `JWT_SECRET = env("JWT_SECRET")`, `JWT_ALGORITMO` default `HS256` |
| 3. `sub` o `user_id` | `identidad.py:45-47` | `claims.get("sub") or claims.get("user_id")`; sin eso, `TokenInvalido` |
| 3. 401 con `WWW-Authenticate` | `proxy.py:75-77` → `proxy.py:48-54` | `except TokenInvalido` → `respuesta_de_error(401, ...)`; la cabecera se pone en `:52` |
| 4. Saca el token | `proxy.py:81` | `cabeceras.pop("Authorization", None)` |
| 4. Inyecta `X-Usuario-Id` | `proxy.py:82` | `cabeceras["X-Usuario-Id"] = identidad["usuario_id"]` |
| 4. Inyecta `X-Organizacion-Id` (si viene) | `proxy.py:83-84` | `if identidad["organizacion_id"]:` |
| 4. Inyecta `X-Rol` (si viene) | `proxy.py:85-86` | `if identidad["rol"]:` |
| 4. Inyecta `X-Correlation-ID` | `proxy.py:88` | siempre, pública o no |
| 5. Arma el destino y reenvía | `proxy.py:90-98` | `destino = SERVICIOS[servicio] + request.get_full_path()`; `requests.request(method, destino, headers, data=request.body, timeout=...)` |
| 5. Tiempo de espera | `gateway/config/settings.py:93` | `TIEMPO_ESPERA_SEGUNDOS = 10` |
| 5. 504 / 502 | `proxy.py:100-103` | `except requests.Timeout` → 504; `except requests.ConnectionError` → 502 |
| 6. Devuelve tal cual | `proxy.py:105-114` | `HttpResponse(upstream.content, status=upstream.status_code, ...)`; copia cabeceras menos las de salto; pone `X-Correlation-ID` |
| Sin base de datos | `gateway/config/settings.py:49` | `DATABASES = {}` |
| Sin CSRF (es un proxy, no un formulario) | `proxy.py:56` | `@csrf_exempt` sobre `reenviar` |
| Las 17 pruebas | `gateway/tests/test_gateway.py` | `test_*`; el fixture `upstream` es el servicio falso |

## Variables de entorno

| Variable | Para qué |
|---|---|
| `JWT_SECRET`, `JWT_ALGORITMO` | validar la firma; idénticos a los de auth |
| `URL_AUTH` … `URL_NOTIFICATIONS` | dónde vive cada servicio; las inyecta compose o el ConfigMap de k8s |
| `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` | Django y el navegador |

## Cómo probarlo

```bash
docker compose up -d gateway
docker compose exec gateway pytest -v                 # 17 pruebas
curl -i http://localhost:8000/api/suscripciones/      # 401, falta el token
curl -i http://localhost:8000/api/lo-que-sea/         # 404
```

Las 17 pruebas levantan un servicio falso (`upstream`) y cubren: reenvío de
método, ruta, query y cuerpo; cada prefijo a su servicio; 404; 401 por falta
de token, otro secreto, vencido y sin usuario; inyección de las tres
cabeceras; `user_id` de simplejwt; no inventa la cabecera de organización si
el token no la trae; descarta las cabeceras que manda el cliente; `/api/auth/`
no exige token; el 403 del servicio pasa tal cual; 502; 504; correlation id.

Con un token real, el camino corto es hacer login y usar el `access_token`:

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/auth/login/ -H "Content-Type: application/json" \
  -d '{"email":"demo@ojoalgasto.cl","password":"Demo-2026-ojo"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" localhost:8000/api/suscripciones/
```

## Qué queda pendiente

- No hay renovación de token: cuando vence el access (30 min), la web manda
  al login. El `refresh_token` se guarda pero no se usa todavía.
- El 10 s de `TIEMPO_ESPERA_SEGUNDOS` fue lo que delató el login lento en el
  cluster (504). Quedó documentado en `k8s/README.md`.
