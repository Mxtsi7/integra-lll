# FE-01 a FE-05 — Cuentas conectadas: modelo, listado, OAuth y desconexión

**Qué hace.** Deja a una organización conectar su Gmail o su Outlook y
desconectarlo. FE-01 modela la cuenta por organización, con los tokens
cifrados. FE-02 la lista con su estado. FE-03 abre el flujo de OAuth (state,
PKCE, scopes de solo lectura) y FE-04 procesa el retorno: canjea el código,
valida el `id_token` y guarda la cuenta. FE-05 la desconecta y le pide al
proveedor que revoque el acceso, mandando primero el token de refresco. No
publica eventos ni usa Celery: todo pasa dentro de la petición, salvo el
reintento de revocaciones, que es un comando de `manage.py`.

**Dónde está.** Todo bajo `services/connectors/`.

| Pieza | Archivo |
|---|---|
| La cuenta (FE-01) | `connectors/models.py` → `CuentaConectada`; migraciones `0001` y `0003` (`credenciales_version`, `revocado_en`) |
| El flujo abierto (FE-03/04) | `connectors/models.py` → `AutorizacionPendiente`, migración `0003` |
| Entrada y salida | `connectors/serializers.py` → `CuentaConectadaSerializer`, `IniciarAutorizacionSerializer`, `AutorizacionIniciadaSerializer`, `CallbackAutorizacionSerializer` |
| Vistas y rutas | `connectors/views.py` → `CuentaConectadaViewSet`, `IniciarAutorizacionView`, `CallbackAutorizacionView`; `connectors/urls.py` (las de OAuth van antes del router) |
| Lo de Google y Microsoft: URLs, scopes, canje, revocación, `id_token` | `connectors/proveedores.py` |
| Desconectar y revocar (FE-05) | `connectors/revocacion.py`; reintento con `manage.py reintentar_revocaciones [--aplicar] [--organizacion UUID]` |
| Configuración | `connectors_config/settings.py`: `OAUTH_REDIRECT_URI`, `OAUTH_RETORNOS_PERMITIDOS`, `OAUTH_CREDENCIALES` (`OAUTH_GMAIL_CLIENT_ID`, `OAUTH_GMAIL_CLIENT_SECRET` y los de Outlook); cluster: `k8s/00-configuracion.yaml`, aunque connectors todavía no tiene Deployment ahí |

## Las rutas

El gateway enruta `/api/conectores/` a connectors sin traducir la ruta
(`RUTAS` en `gateway/config/settings.py`). Ninguna es pública: sin JWT, 401.
Con JWT saca `Authorization` y pone `X-Usuario-Id`, `X-Organizacion-Id`,
`X-Rol` y `X-Sesion-Id` (claim `sid`); `ContextoTenantMiddleware`
(`shared/tenant/base.py`) las deja en `request`.

| Método | Ruta pública vía gateway | Qué hace | Códigos |
|---|---|---|---|
| GET | `/api/conectores/` | Lista paginada de la organización: 10 por página, `?page_size=` hasta 100. Filtros `?estado=`, `?proveedor=`, `?necesita_reautorizacion=true\|false` | 200 · 400 filtro con valor que no existe · 403 sin organización |
| GET | `/api/conectores/{id}/` | Detalle; los filtros no se aplican | 200 · 404 no existe o es de otra organización · 403 |
| DELETE | `/api/conectores/{id}/` | Desconecta y revoca (FE-05). No borra la fila | 200 con la cuenta `desconectada` · 404 · 403 |
| POST | `/api/conectores/autorizaciones/` | Abre el flujo y devuelve la URL de consentimiento (FE-03) | 200 · 400 proveedor `csv` o inventado, retorno fuera de la lista blanca, falta `OAUTH_REDIRECT_URI` · 403 sin organización o usuario |
| POST | `/api/conectores/autorizaciones/callback/` | Cierra el flujo: guarda la cuenta (FE-04) o registra la cancelación | 200 · 400 state desconocido, vencido o usado; sin `codigo` ni `error`; canje o `id_token` rechazado · 403 otra organización, otro usuario u otra sesión |

POST, PUT y PATCH sobre `/api/conectores/` y `/api/conectores/{id}/`
responden 405.

```http
POST /api/conectores/autorizaciones/      {"proveedor": "gmail", "retorno": "https://ojoalgasto-forellana.dev.censei.cl/conectores"}
→ 200 {"url_autorizacion": "https://accounts.google.com/o/oauth2/v2/auth?…&state=…&code_challenge=…&code_challenge_method=S256&access_type=offline&prompt=consent",
       "estado_oauth": "<43 caracteres>", "expira_en": "<ahora + 10 minutos>"}

POST /api/conectores/autorizaciones/callback/
{"estado_oauth": "…", "codigo": "…"}              aceptó  → 200 con la cuenta
{"estado_oauth": "…", "error": "access_denied"}   canceló → 200 {"resultado": "cancelada", "proveedor": "gmail", "detalle": "access_denied", "retorno": "…"}
```

La cuenta, igual en el listado (en `results`, con `count`, `next`, `previous`),
el detalle, el callback y el DELETE. `access_token` y `refresh_token` son
`write_only` y nunca salen:

```json
{"id": "…", "proveedor": "gmail", "proveedor_legible": "Gmail", "cuenta_externa": "persona@gmail.com",
 "estado": "conectada", "estado_legible": "Conectada", "detalle_del_estado": "", "necesita_reautorizacion": false,
 "token_expira_en": "…", "ultima_sincronizacion": null, "creado_en": "…", "actualizado_en": "…"}
```

## El flujo

```
navegador ─POST /autorizaciones/─▶ gateway (JWT → cabeceras) ─▶ IniciarAutorizacionView
            AutorizacionPendiente.abrir() ─▶ INSERT autorizacion_pendiente
            (state, verificador PKCE cifrado, usuario, sesión, vence en 10 min)
          ◀── 200 url_autorizacion          (no se llama al proveedor)
navegador ─▶ Google / Microsoft ─▶ OAUTH_REDIRECT_URI (el frontend) con ?code=…&state=…
navegador ─POST /autorizaciones/callback/─▶ gateway ─▶ CallbackAutorizacionView
   1. busca el state; exige la misma organización, usuario y sesión     400 / 403
   2. vigente y marcar_usada(): UPDATE … WHERE usada_en IS NULL          400 si pierde
   3. si vino `error` → 200 cancelada, sin cuenta
   4. canjear_codigo() ─▶ token endpoint del proveedor, code + code_verifier, 10 s
   5. correo_autorizado(): iss, aud, exp y email del id_token           400 si falla
   6. update_or_create(organización, proveedor, correo) → tokens con CampoCifrado
   7. registrar_credenciales_nuevas(): credenciales_version + 1, revocado_en = NULL
          ◀── 200 la cuenta, sin tokens
```

El state es `secrets.token_urlsafe(32)`, único global porque el callback lo
busca antes de saber la organización. El verificador PKCE queda cifrado con
FE-06 ([07-cifrado-de-tokens-fe06.md](07-cifrado-de-tokens-fe06.md)); al
proveedor va su SHA-256 en base64url sin relleno. Scopes: `gmail.readonly` y
`Mail.Read`, más `openid` y `email`; Google lleva `access_type=offline` y
`prompt=consent`, Microsoft `offline_access`. El retorno se compara por origen
completo contra `OAUTH_RETORNOS_PERMITIDOS`, vacía por omisión. Reconectar la
misma cuenta (única por `organizacion_id`, `proveedor`, `cuenta_externa`, el
correo en minúsculas) actualiza la misma fila, la deja `conectada` y, si el
proveedor no mandó refresh token, conserva el anterior.

```
DELETE /api/conectores/{id}/ ─▶ gateway ─▶ CuentaConectadaViewSet.destroy
  get_object() filtra por X-Organizacion-Id (ajena = 404, no se llama al proveedor)
  revocacion.revocar_y_desconectar(cuenta)            anota credenciales_version
    ├─ Outlook: no llama a nadie; desconectada, credenciales se quedan, revocado_en NULL
    ├─ ningún token legible: desconectada, el cifrado no se borra
    ├─ sin tokens: desconectada, nada que revocar
    └─ refresh (o access si no hay o es ilegible) ─▶ POST https://oauth2.googleapis.com/revoke, 10 s
          200 / 204           → tokens y token_expira_en a NULL, revocado_en = ahora
          400 invalid_token   → se conservan cifrados, queda pendiente
          red, timeout, otro  → se conservan cifrados, queda pendiente
  UPDATE … WHERE id = … AND credenciales_version = <la anotada>
    (si alguien reconectó entretanto, 0 filas: no se toca la concesión nueva)
  ◀── 200 la cuenta `desconectada`; detalle_del_estado dice cuál caso fue
```

Las pendientes (desconectadas, sin `revocado_en`, con algún token, sin
Outlook) las retoma `reintentar_revocaciones`, en seco por omisión.

**Con la limpieza de MX-07.** Auth llama `DELETE /internal/organizaciones/<uuid>/`
firmado con HMAC, sin pasar por el gateway. `LimpiezaConnectorsView`
(`connectors/eliminacion.py`) anota la versión de cada cuenta y revoca cada
Gmail sin `revocado_en` en su propia transacción. Responde 409
`credenciales_cambiadas` si alguien reconectó o conectó otra cuenta, y 409
`revocacion_proveedor_pendiente` si queda una Gmail sin evidencia. Outlook no
bloquea: sus credenciales se borran con la fila. Si la fila desaparece a mitad
de la revocación, `revocar_y_desconectar` devuelve `ya_no_existe`. Detalle en
`docs/flujos/maximiliano-saez/07-eliminar-cuenta.md` y
`docs/decisiones/mx-07-outlook-revocacion.md`.

## Decisiones

- **Tenant sin FK y unicidad por organización** (ADR-002): dos organizaciones
  pueden conectar el mismo correo. Una cuenta no nace de un POST, solo del callback.
- **El state vive en la base y se quema antes de canjear**: con el UPDATE
  condicional, de dos callbacks con el mismo código gana uno.
- **El flujo es de quien lo abrió**: state y PKCE prueban que es legítimo, no
  quién vuelve. Se comparan usuario y sesión (revisión de #107); un flujo
  abierto sin `sid` solo compara usuario.
- **Del `id_token` se validan `iss`, `aud` y `exp`, no la firma**: llega por TLS
  directo del canje. No sirve para un `id_token` que venga del navegador.
- **DELETE no borra la fila y responde 200**: los cobros importados apuntan a la
  cuenta, y el frontend recibe el estado nuevo sin pedir el listado otra vez.
- **Los tokens se borran solo si el proveedor confirmó**; un secreto ilegible no
  es un secreto ausente.
- **Primero el de refresco** (c75c2be): el de acceso dura una hora y connectors
  no lo refresca. `invalid_token` no acredita: c75c2be lo acreditaba sobre el de
  refresco y la integración con MX-07 (3a28f19) lo dejó pendiente.
- **`credenciales_version`**: la escritura de la revocación es condicional a la
  versión leída, y el reintento exige la versión que seleccionó.
- **Outlook declara `revocacion_soportada=False`**: no se inventa `revocado_en`.
- **Filtro y propiedad comparten `ESTADOS_QUE_EXIGEN_REAUTORIZAR`** (b91f09a).

## Cómo probarlo

```bash
cd services/connectors
env PYTHONPATH=../.. DEBUG=True SECRET_KEY=x ALLOWED_HOSTS=localhost,127.0.0.1,testserver \
  JWT_SECRET=solo-prueba-solo-prueba-solo-prueba-32 JWT_ALGORITMO=HS256 \
  CELERY_BROKER_URL=redis://localhost:6379/0 ESQUEMA_BD=connectors CLAVES_CIFRADO=x \
  DATABASE_URL=sqlite://:memory: python -m pytest -q -p no:cacheprovider \
  tests/test_cuenta_conectada.py tests/test_listar_cuentas.py tests/test_oauth.py \
  tests/test_revocacion_refresco.py tests/test_carrera_revocacion_postgres.py
```

145 pasan y 3 se saltan (01-11-2026, `main` 3430095): `test_cuenta_conectada.py`
14, `test_listar_cuentas.py` 19, `test_oauth.py` 90 (inicio, callback,
desconexión, reintento, reconexión concurrente, ilegibles, sesión) y
`test_revocacion_refresco.py` 22. Las 3 de `test_carrera_revocacion_postgres.py`
usan dos conexiones reales y solo corren con PostgreSQL. El cruce con MX-07
está en `tests/test_eliminacion.py`, de Maximiliano.

A mano: `.env.example` no trae `OAUTH_*`, así que el inicio da 400 hasta
configurarlas. El listado sí responde:
`curl -s -H "Authorization: Bearer $TOKEN" localhost:8000/api/conectores/`.

## Lo que queda para otras tarjetas

- Leer el correo de las cuentas `conectada` (FE-13). Connectors todavía no
  refresca el token de acceso.
- Purgar las `AutorizacionPendiente` vencidas: hay índice (`autorizacion_expira`)
  pero no comando. Programar `reintentar_revocaciones` sigue como decisión del
  equipo (`services/connectors/WORKER-CELERY.md`).
- El frontend no llama todavía a estas rutas: `CuentasConectadasPage` recibe
  `cargarCuentas` y `accionConectar` por props (AN-17, AN-15).
- El docstring de `AutorizacionPendiente` todavía dice que el callback llega
  sin `X-Organizacion-Id`; la vista ya lo corrigió y exige las cabeceras.
