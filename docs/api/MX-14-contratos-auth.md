# MX-14: contratos Auth compartidos

Tarjeta: https://trello.com/c/USauKRiT

`auth.openapi.json` es el contrato versionado generado por drf-spectacular.
`frontend/shared/src/contratos/auth.generated.ts` contiene sus tipos; web y
móvil los consumen a través de `@ojoalgasto/shared`. No se generan tokens ni
secretos reales al exportar. Los ejemplos de credenciales son ficticios.

El esquema describe el acceso por **Gateway**: `GatewayBearer` en rutas
protegidas y `security: []` en las coincidencias públicas exactas. Auth recibe
cabeceras internas sobre una red privada. El cliente envía `Authorization:
Bearer <access_token>`; nunca decide `X-Usuario-Id`, `X-Organizacion-Id` o `X-Rol`.
Logout y refresh verifican el refresh del body incluso con access vencido.
Logout responde 204 sin JSON; refresh rota ambos tokens y un replay revoca la
familia. Los fallos de comprobación de sesión producen 503, no una sesión válida.

## Rutas y resultados

| Ruta | Método y cuerpo | Éxito | Errores relevantes |
|---|---|---|---|
| `/api/auth/register/` | POST Register | 201 usuario sin password | 400 consentimiento, política o correo |
| `/api/auth/login/` | POST email/password | 200 tokens + usuario | 400, 401 neutro, 503 |
| `/api/auth/password-reset/` | POST email | 200 detail neutro | 400 |
| `/api/auth/password-reset/confirm/` | POST token/password | 200 detail | 400 token_invalido o campos, 410 token_expirado/token_usado, 503 |
| `/api/auth/refresh/` | POST refresh_token | 200 access_token/refresh_token | 400, 401, 503 |
| `/api/auth/logout/` | POST refresh_token | 204 vacío | 400, 401, 503 |
| `/api/auth/change-password/` | POST password_actual/password/password_confirmacion | 200 detail y revoca todas las sesiones | 400, 403, 404, 503 |
| `/api/usuarios/me/` | GET / PATCH nombre | 200 usuario con plan vigente | 400, 403 tenant obsoleto, 404 inactivo |
| `/api/usuarios/me/` | DELETE password/confirmacion y confirmacion_organizacion si último titular | 204 o 202 operacion_id/estado | 400, 403, 409 confirmación, 503 |
| `/api/usuarios/me/permisos/` | GET | 200 plan/features/límites | 403, 404 |
| `/api/planes/` | GET | 200 catálogo de planes | 401 Gateway |
| `/api/auth/email-verification/request/` | POST email/password opcionales | 200 detail | 400, 403, 404, 429, 503 |
| `/api/auth/email-verification/confirm/` | POST token | 200 detail | 400, 410, 503 |
| `/api/auth/google/nonce/` | GET, conserva cookie HttpOnly | 200 nonce/client_id/vence_en_segundos | 503 |
| `/api/auth/google/` | POST id_token/nonce/password opcional | 200 tokens + usuario | 400 cancelación, 401 identidad/vinculación, 409 completar registro, 503 |

Todas las rutas protegidas también pueden responder 401/503 en Gateway. Las
respuestas DRF de validación son objetos de campos con listas de mensajes;
otros errores contienen `detail`, `code` o ambos. No se transforma un 204 en
un cuerpo JSON. `id` de usuario es numérico y `organizacion_id` puede ser null:
el adaptador compartido normaliza esos valores para el tipo de presentación
existente. `plan` en el wire usa `free`/`premium`.

DELETE publica un `requestBody` obligatorio con `EliminarCuentaRequest`:
`password` (solo entrada) y `confirmacion=ELIMINAR` son obligatorios.
`confirmacion_organizacion=ELIMINAR` se exige al último titular; omitirla en ese
caso produce 409. `EsquemaEliminarCuenta` resuelve el serializer anotado para
esa operación, porque drf-spectacular 0.28.0 omite cuerpos de DELETE por defecto.
No modifica la reautenticación ni los cuerpos de respuesta del backend.

## Regenerar y comprobar

Desde `services/auth`, con las variables del entorno de desarrollo:

```sh
python manage.py spectacular --format openapi-json --validate --fail-on-warn --file ../../docs/api/auth.openapi.json
```

Desde la raíz del repositorio:

```sh
python scripts/generar-tipos-auth.py
python scripts/generar-tipos-auth.py --check
cd services/auth
pytest tests/test_contratos_openapi.py
```

Las pruebas contrastan el JSON real con el esquema, verifican coincidencias
públicas del Gateway, regeneración del snapshot y tipos, política de campos y
ausencia de cuerpos en 204. El esquema valida con fail-on-warn.

## Dependencia explícita

Esta rama parte de `Maxi-eliminar-cuenta` (#72), para incluir DELETE real y la
operación asíncrona. #72 sigue en borrador por la evidencia de revocación de
Outlook; MX-14 no afirma resuelto ese bloqueo ni el plazo de 72 horas. Integrar
primero #72 y después retargetear este PR a main. No se modifica la política de
retención ni la revocación con esta documentación. Google usa pruebas con
identidad verificada simulada: no acredita una conexión externa real.
