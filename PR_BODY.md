## Resumen

Se implementa el endpoint de registro del servicio Auth, compatible con el prefijo que utiliza el gateway.

### Endpoint

`POST /api/auth/register/`

El endpoint:

- Recibe `email`, `password`, `nombre` y `acepta_datos`.
- Exige que `acepta_datos` sea `true`.
- Hashea la contraseña mediante `create_user`/`set_password`.
- Registra `consentimiento_en` con la fecha y hora del consentimiento.
- Nunca devuelve la contraseña.
- Devuelve errores de validación por campo mediante `serializer.errors`.

### Respuestas

- `201`: `{id, email, nombre}`.
- `400`: errores de validación por campo.

### Migraciones

Se dejó una única migración limpia:

`0002_user_nombre_consentimiento.py`

Esta agrega `nombre` y `consentimiento_en`, sin `AlterModelManagers` ni cambios ajenos en `groups` o `user_permissions`.

### Tests

Se cubren seis casos:

1. Registro exitoso.
2. Email duplicado.
3. Falta de email.
4. Falta de contraseña.
5. Falta de nombre.
6. Consentimiento ausente o falso.

### Compatibilidad con frontend

El backend requiere `acepta_datos: true`. El frontend de `main` todavía debe enviar este campo cuando el usuario marque el checkbox de consentimiento. Mientras ese cambio no esté integrado, el registro desde la web responderá `400`.

La respuesta actual del registro es `{id, email, nombre}`; no devuelve tokens. El flujo de la interfaz debe continuar hacia el login, o el tipo `AuthResponse` del frontend debe ajustarse.

### Fuera del alcance

La creación de `Organizacion` al registrar queda para una tarea posterior.
