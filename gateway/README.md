# Gateway

El único punto de entrada del sistema. Los clientes —la web y la app móvil—
hablan solo con el gateway; nunca con un servicio directamente.

Hace tres cosas, y nada más:

1. **Valida el JWT** que emitió `auth`, una sola vez por petición.
2. **Pone la identidad en cabeceras** y reenvía la petición al servicio que
   corresponde según la ruta.
3. **Devuelve la respuesta** del servicio tal cual.

No tiene base de datos ni modelos. Es el ADR-004 hecho código.

## Cómo fluye una petición

```
navegador ──Authorization: Bearer <jwt>──▶ gateway :8000
                                              │  valida firma y expiración
                                              │  descarta X-* que venga de afuera
                                              │  X-Usuario-Id / X-Organizacion-Id / X-Rol  ◀── del token
                                              │  X-Correlation-ID
                                              ▼
                               subscriptions :8002  (confía en las cabeceras)
```

Los servicios internos **no validan el token**: confían en las cabeceras
porque solo el gateway puede alcanzarlos. Por eso ningún servicio interno
debe quedar expuesto fuera de la red de Docker.

## Enrutamiento

La ruta no cambia, solo el host. `GET /api/suscripciones/` en el gateway
llega a `subscriptions` como `GET /api/suscripciones/`. Cada servicio expone
su API bajo `/api/` y no hay traducción.

| Prefijo | Servicio |
|---|---|
| `/api/auth/` | `auth` — **pública**, no exige token (registro, login, refresco) |
| `/api/usuarios/`, `/api/organizaciones/` | `auth` |
| `/api/suscripciones/`, `/api/usos/` | `subscriptions` |
| `/api/conectores/` | `connectors` |
| `/api/recomendaciones/`, `/api/asistente/` | `analytics` |
| `/api/alertas/` | `notifications` |

Para agregar una ruta: una línea en `RUTAS` de `config/settings.py`.

## El contrato del token

`auth` firma; el gateway valida. Para que encajen:

| | Valor |
|---|---|
| Algoritmo | `HS256` (`JWT_ALGORITMO`) |
| Secreto | `JWT_SECRET` del `.env`, **idéntico en `auth` y en el gateway** |
| `sub` o `user_id` | id del usuario. Obligatorio. `simplejwt` usa `user_id` por defecto; ambos se aceptan |
| `organizacion_id` | id de la organización. Opcional mientras no exista el modelo; si viene, se propaga |
| `rol` | `titular` o `integrante`. Opcional, ídem |
| `exp` | obligatorio; un token vencido es 401 |

Si `auth` usa `djangorestframework-simplejwt`, hace falta en su `settings.py`:

```python
SIMPLE_JWT = {
    "SIGNING_KEY": env("JWT_SECRET"),      # no SECRET_KEY: el gateway no lo conoce
    "ALGORITHM": env("JWT_ALGORITMO", default="HS256"),
}
```

y un serializer de token que agregue `organizacion_id` y `rol` a los claims
cuando existan.

## Qué responde el gateway por sí mismo

| Código | Cuándo |
|---|---|
| `401` | Sin token, token con firma inválida, vencido, o sin usuario. Lleva `WWW-Authenticate: Bearer` |
| `404` | Ruta que no está en `RUTAS` |
| `502` | El servicio de destino no está levantado |
| `504` | El servicio no respondió en `TIEMPO_ESPERA_SEGUNDOS` (10 s) |

Cualquier otro código —incluido un `403` del servicio— llega al cliente tal
cual. El gateway autentica; autorizar es de cada servicio.

Toda respuesta lleva `X-Correlation-ID`. Si el cliente manda uno, se respeta;
si no, se genera. Sirve para seguir una petición por los logs de todos los
servicios.

## Aislamiento (RF-26)

Cualquier `X-Usuario-Id`, `X-Organizacion-Id` o `X-Rol` que venga del cliente
**se descarta** antes de reenviar. Las únicas cabeceras de identidad que
reciben los servicios son las que el gateway pone desde el token. Nadie
fabrica su organización desde afuera.

El token tampoco se reenvía: se queda en el gateway.

## Variables de entorno

| Variable | Para qué | Ejemplo |
|---|---|---|
| `SECRET_KEY` | Django | (del `.env`) |
| `DEBUG` | Django | `True` en local |
| `ALLOWED_HOSTS` | Django | `localhost,127.0.0.1,gateway` |
| `JWT_SECRET` | validar la firma | el mismo que `auth` |
| `JWT_ALGORITMO` | ídem | `HS256` |
| `CORS_ALLOWED_ORIGINS` | desde qué orígenes acepta el navegador | `http://localhost:5173` |
| `URL_AUTH` … `URL_NOTIFICATIONS` | dónde vive cada servicio | las inyecta `docker-compose.yml` |

## Probar

```bash
docker compose up -d gateway
docker compose exec gateway pytest -v          # 17 pruebas, sin base de datos
curl -i http://localhost:8000/api/suscripciones/   # 401: falta el token
```

Para probar con un token a mano, desde dentro del contenedor:

```bash
docker compose exec gateway python -c "
import jwt, os, datetime as dt
print(jwt.encode({'sub': 'demo', 'organizacion_id': 'org', 'rol': 'titular',
  'exp': dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)},
  os.environ['JWT_SECRET'], algorithm='HS256'))"
```

y `curl -H "Authorization: Bearer <token>" http://localhost:8000/api/suscripciones/`.
