# MX-29 y MX-10 — cierre y renovación de sesión

Trello: [MX-29](https://trello.com/c/LKvkdcZ9), [MX-10](https://trello.com/c/dlybrwRf).
RF-01.6 (Must, matriz de trazabilidad). La renovación conserva ese contrato de sesión.

1. Login bloquea el usuario y crea `Sesion` con UUID `sid`, JTI de refresh y vencimiento.
2. Los JWT incluyen `sid`, `session_version`, usuario, organización y rol. Redis conserva
   la versión de credenciales y una entrada por dispositivo hasta vencer el refresh.
3. Gateway exige ambos registros en cada petición protegida. Borra las cabeceras de
   identidad recibidas y propaga `X-Sesion-Id` del JWT, además de usuario/organización/rol.
4. `POST /api/auth/logout/` sin cuerpo revoca exclusivamente el dispositivo autenticado.
   Devuelve 204; su access y refresh dejan de funcionar inmediatamente (límite RF: 60 s).
5. `POST /api/auth/refresh/` es público; recibe `{"refresh_token":"..."}` y devuelve
   `access_token` y `refresh_token`. La rotación guarda un nuevo JTI bajo bloqueo.
   Reutilizar un refresh revoca toda esa familia, sin cerrar otros dispositivos.

El vencimiento de la sesión es fijo desde login. Un access vencido no impide renovar
con refresh vigente. Reset/cambio de contraseña invalida las familias al sustituir la
versión global. Un usuario inactivo o una pertenencia/rol cambiados no puede renovar.
La pérdida de Redis rechaza sesiones; un error de conexión devuelve 503 sin autorizar.
Los JWT anteriores sin `sid` requieren iniciar sesión nuevamente al desplegar.

Las rutas públicas son coincidencias exactas; `/api/auth/` ya no es un prefijo público.
Los servicios siguen confiando en el Gateway y deben permanecer en la red interna.

Aplicar `python manage.py migrate` en Auth antes de desplegar. Se reutiliza
`SESSION_REDIS_URL` existente; no hay secretos nuevos.

Verificación: `pytest tests/test_sesiones.py tests/test_confirmacion_recuperacion.py`
en Auth con PostgreSQL; `pytest` en Gateway. Se cubren revocación por dispositivo,
reutilización, expiración, fallo de Redis y cabeceras falsificadas.
