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

Verificación: en Auth, ejecutar `pytest tests/test_perfil_clave.py tests/test_user_detail.py`
contra PostgreSQL. Los casos incluyen contraseña incorrecta, política, confirmación,
revocación, fallo de Redis, organización ajena y campos de perfil no permitidos.
