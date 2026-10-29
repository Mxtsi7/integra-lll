# E2E móvil ↔ backend (VI-16)

Prueba real, sin mocks, del contrato que usa la app móvil. Todo pasa por el
**gateway** (`:8000`); el script no conoce ni llama a `auth:8001`,
`analytics:8004` ni a ningún servicio interno.

## Qué verifica

`scripts/e2e_movil_backend.py` recorre:

1. `GET /health/` del gateway.
2. `POST /api/auth/login/` con correo y contraseña → access + refresh.
3. `GET /api/usuarios/me/` con el access (endpoint protegido).
4. `POST /api/auth/refresh/` → access **y refresh nuevos** (rotación).
5. `GET /api/usuarios/me/` con el access renovado.
6. Reutilizar el refresh **viejo** → `401`.
7. `GET /api/usuarios/me/` con un token inventado → `401`.

El paso 6 va al final a propósito: el backend cierra la familia de tokens al
detectar reutilización (MX-29). Si se hiciera antes, los pasos siguientes
fallarían por diseño.

El script **no imprime tokens**, sólo códigos HTTP y longitudes.

## Requisitos

- Stack sano:

  ```powershell
  docker compose up -d --build
  python scripts\verificar_servicios.py
  ```

- Usuario del seed de desarrollo (o uno propio):

  | Correo | Clave |
  |---|---|
  | `demo@ojoalgasto.cl` | `Demo-2026-ojo` |

- Python 3.12 en Windows (sólo para ejecutar el script; no para el backend).

## Ejecución

Contra el host de desarrollo:

```powershell
python scripts\e2e_movil_backend.py
```

Con una URL explícita y credenciales propias:

```powershell
python scripts\e2e_movil_backend.py `
  --url http://192.168.1.20:8000/api `
  --correo demo@ojoalgasto.cl `
  --clave "Demo-2026-ojo"
```

Desde la perspectiva del teléfono (rechaza `localhost`):

```powershell
python scripts\e2e_movil_backend.py --desde-movil --url http://192.168.1.20:8000/api
```

Contra una build de producción (exige `https`):

```powershell
python scripts\e2e_movil_backend.py --produccion --url https://api.ejemplo.cl/api
```

Variables equivalentes: `E2E_API_URL`, `E2E_CORREO`, `E2E_CLAVE`.

## Salida esperada

```text
>> backend: http://192.168.1.20:8000/api
1. gateway /health/
2. login
   OK  access=... chars, refresh=... chars
3. endpoint protegido con el access
4. refresh con rotación
   OK  refresh nuevo distinto del anterior
5. endpoint protegido con el access renovado
6. reutilizar el refresh viejo
7. token inválido

OK: login, JWT, endpoint protegido, refresh, reutilización y 401 verificados.
```

Sale con código 0 si todo se cumple y 1 si algo falla. Un fallo típico:

| Fallo | Causa probable |
|---|---|
| `no se pudo contactar ...` | Backend caído, URL mal escrita o firewall |
| `login: se esperaba 200, llegó 401` | Credenciales incorrectas o seed no ejecutado |
| `refresh: se esperaba 200, llegó 503` | Redis no disponible (`SESSION_REDIS_URL`) |
| `reutilizar un refresh rotado debía dar 401` | Se desactivó la rotación/revocación de sesiones |
| `un token inválido debía dar 401` | El gateway no está validando la firma |
| `debe terminar en /api` | URL apuntando a un servicio interno o al host sin path |

## Contrato de refresh

`POST /api/auth/refresh/`:

```json
{ "refresh_token": "..." }
```

- `200`: devuelve `access_token` y un `refresh_token` **nuevo**. Hay que
  guardar los dos antes de reintentar.
- `400/401/403`: el refresh no sirve; el cliente descarta la sesión.
- `503`: Redis no disponible; el cliente conserva los tokens y puede reintentar.

El cliente compartido (`frontend/shared/src/auth.ts`) aplica una sola
renovación en vuelo, serializa entre pestañas con `navigator.locks` cuando
existe, y en el móvil usa `expo-secure-store` con un espejo en memoria
hidratado al arrancar.

## Qué cubre cada prueba del cliente

| Prueba | Qué demuestra |
|---|---|
| `frontend/shared/src/auth.test.ts` → `renovarSesion` | Rotación, single-flight, 401 descarta, 503 conserva y reintenta una vez, sin red conserva |
| `frontend/shared/src/api/cliente.test.ts` | 401 → renueva y repite una vez; refresh fallido cierra; 503 conserva la sesión |
| `frontend/movil/src/config/api.test.ts` | La URL exige `/api`, rechaza localhost en nativo, https en producción y credenciales embebidas |
| `frontend/movil/src/storage/sesionSegura.test.ts` | Los tokens sobreviven a reabrir la app y el logout borra lo persistido |
| `shared/ia/tests/test_sin_urls_internas.py` | `shared/` no contiene URLs internas que el móvil heredaría |

## Backend caído sin exponer datos previos

El arranque de `AuthContext`:

1. hidrata el espejo desde SecureStore;
2. si el access venció y hay refresh, intenta renovar;
3. si el backend no responde, `renovarSesion()` devuelve `false` y **conserva**
   los tokens;
4. la app queda en login/error de red, sin mostrar el perfil cacheado como si
   fuera una sesión válida.

Cuando el backend vuelve, el usuario puede reintentar el login o la renovación.
No hay un almacén inseguro de respaldo (`localStorage`/`AsyncStorage` en claro)
para “que funcione igual”.

## Seguridad

- El script usa la URL pública del gateway; no necesita la API key de IA ni
  secretos de servicios.
- No registrar tokens en logs ni en capturas. Si se pega una salida, revisar
  que no incluya `access_token`/`refresh_token`.
- Las credenciales por defecto son las del seed de desarrollo y están
  documentadas; no son secretos de producción.
- En producción, ejecutar con `--produccion` y credenciales de una cuenta de
  prueba creada para ese fin.
