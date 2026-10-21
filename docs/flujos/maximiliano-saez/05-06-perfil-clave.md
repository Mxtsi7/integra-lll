# MX-05 y MX-06 — perfil y contraseña

Trello: [MX-05](https://trello.com/c/up0nSpgG), [MX-06](https://trello.com/c/5kr9ZaP8).
Implementa RF-01.5 (Must) y el perfil requerido por la matriz de aislamiento MX-13.

Gateway autentica el JWT y elimina las cabeceras de identidad del cliente. Auth
consulta al usuario activo del contexto y comprueba que su organización siga
coincidiendo con la sesión. Los cambios bloquean la fila del usuario.

`PATCH /api/usuarios/me/` acepta únicamente `{"nombre":"Nombre actualizado"}`.
Devuelve la representación vigente: id, nombre, correo, rol y organizacion_id.
Campos adicionales, nombre vacío o mayor de 150 caracteres producen 400.
El correo se modifica mediante verificación MX-28; PATCH no lo activa directamente.

`POST /api/auth/change-password/` recibe `password_actual`, `password` y
`password_confirmacion`. Comprueba identidad con la contraseña actual, exige
coincidencia y reutiliza RF-01.1: ocho caracteres, una letra y un número.
Al guardar el hash sustituye la versión en Redis para revocar todos los access y
refresh anteriores. Devuelve 200 y exige iniciar sesión nuevamente. Si Redis falla,
responde 503 y la transacción no cambia la contraseña. No devuelve contraseñas.

## Contrato para los clientes y correcciones de revisión

Tras un PATCH válido, un GET independiente de `/api/usuarios/me/` devuelve el nombre
persistido y conserva `correo`, `rol` y `organizacion_id`; la prueba también recarga
el usuario desde PostgreSQL. No se acepta como evidencia solo la respuesta del PATCH.
GET devuelve 403 si falta un contexto válido o si la organización del token ya no
coincide con la pertenencia actual; 404 si la cuenta no existe o está inactiva.
El bootstrap web debe descartar la sesión obsoleta y solicitar un nuevo login ante
ese 403. Se documenta en OpenAPI y se prueba el cambio de organización tras emitir el contexto.

El cambio de clave devuelve `200 {"detail":"Contraseña actualizada. Inicia sesión nuevamente."}`,
también definido en OpenAPI. Revoca la sesión actual: CH-29/AN-03 deben limpiar
credenciales locales y volver a login. Clave actual incorrecta devuelve
`400 {"password_actual":[...]}`; confirmación distinta, `400 {"password_confirmacion":[...]}`;
Redis no disponible, `503 {"detail":...}`. Campos extra de perfil producen
`400 {"non_field_errors":[...]}`. Auth usa `detail`; los errores originados en Gateway
usan `detalle`. Gateway conserva los cuerpos de las respuestas de Auth.

Integración: aprobar e integrar #68 primero; después cambiar la base de #69 a `main`
y repetir CI. La aprobación formal y la validación de CH-08/CH-29/AN-03 siguen pendientes;
esta documentación no las sustituye. El aislamiento de `/api/usuarios/<id>/` ya se
aborda en #73 (MX-13), sin duplicar esa modificación en esta rama.

Seguimientos fuera de MX-05/MX-06 señalados por la revisión: serializar login con
la revocación para evitar que publique una versión antigua en Redis durante el
commit, y definir límites de intentos en login/cambio de contraseña. No se consideran
resueltos por este ajuste; requieren trabajo de sesiones/seguridad con pruebas concurrentes.

Verificación: en Auth, ejecutar `pytest tests/test_perfil_clave.py tests/test_user_detail.py`
contra PostgreSQL. Los casos incluyen contraseña incorrecta, política, confirmación,
revocación, fallo de Redis, organización ajena, sesión con pertenencia obsoleta,
campos no permitidos y GET posterior a PATCH con recarga desde PostgreSQL.
Corrección de revisión: **25 casos aprobados contra PostgreSQL 16**, PBKDF2 por
defecto y Redis sustituido por LocMem de pruebas. Django `check`, ausencia de
migraciones pendientes y OpenAPI validado sin advertencias; se comprobó que el
esquema generado incluye `detail` en el 200 y el motivo actualizado del 403.
