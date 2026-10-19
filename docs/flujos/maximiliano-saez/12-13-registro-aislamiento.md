# MX-12 y MX-13 — Registro y aislamiento

Tarjetas Must: [MX-12](https://trello.com/c/MWCPTdFH) y
[MX-13](https://trello.com/c/3RpH5SWy). Matriz de requisitos: RF-01 cubre registro
y contexto de identidad; RF-20 cubre el aislamiento entre organizaciones. La
prioridad Must proviene de las tarjetas.

MX-12 amplía `tests/test_register.py`: titular crea exactamente una organización,
integrante reutiliza la organización válida aunque intente imponer otro rol o id,
y código inexistente/consentimiento inválido dejan ambas tablas sin filas nuevas.
Un fallo de base de datos inyectado al crear usuario comprueba el rollback de la
organización recién creada y la conservación de una organización preexistente.

MX-13 ejecuta `tests/test_aislamiento_gateway.py` con dos organizaciones A/B y
dos integrantes autenticados mediante login real. Cada organización conserva su
titular. El recorrido usa `gateway.app.proxy.reenviar`, validación JWT, control
de sesiones, vistas/serializers Auth y PostgreSQL reales. Solo `requests.request`
tiene un doble que entrega método, ruta, query, cuerpo y cabeceras a `APIClient`
de Auth: no es una prueba HTTP con servidores independientes. El estado Redis
usa el doble LocMem de `conftest.py`; no se invoca un proveedor OAuth externo.
La dependencia `tests/test_google.py` sustituye `id_token.verify_oauth2_token`;
los certificados y el servicio real de Google no intervienen en esas pruebas.
En este módulo PBKDF2 sigue siendo real, con 1000 iteraciones para las fixtures;
no modifica configuración de producción ni las pruebas específicas del hasher.

| Operación | Contexto A/B y resultado comprobado |
|---|---|
| GET me / organización | Solo sujeto/miembros propios; ignora ids, rol y sesión falsos en cabeceras y query |
| GET usuario ajeno | 404 y ningún dato ajeno en respuesta |
| PATCH me | Cambia solo nombre propio; rechaza ids, rol y organización del cuerpo |
| PATCH / DELETE usuario ajeno por id | 405 y ninguna fila modificada |
| DELETE me | Elimina solo al sujeto, aunque cuerpo/cabeceras señalen otro id; revoca su JWT y conserva el ajeno |
| JWT alterado | 401 antes del transporte hacia Auth |
| Usuario inactivo | GET me/detalle y PATCH: 404; organización: 403 |
| Pertenencia cambiada después del login | GET me/detalle, PATCH y organización: 403; DELETE: 404 |

La regresión descubrió que `GET /api/usuarios/<id>/` devolvía 200 a una cuenta
inactiva o con organización de JWT obsoleta. `UserDetailView.get_queryset` ahora
reutiliza `usuario_del_contexto`, igual que me/perfil, y devuelve 404/403 antes de
leer el detalle. No cambia el alcance del filtro: siempre conserva solo al sujeto.

Desde `services/auth`, con PostgreSQL de pruebas configurado:

```powershell
python -m pytest -q tests/test_register.py tests/test_aislamiento_gateway.py tests/test_user_detail.py
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py spectacular --validate --file "$env:TEMP/auth-schema-pruebas.yaml"
```

Dependencias de comportamiento: [perfil/clave](05-06-perfil-clave.md),
[sesiones](29-10-sesiones.md), [verificación de correo](28-verificacion-correo.md),
[eliminación](07-eliminar-cuenta.md) y
[Google Login](../../../services/auth/GOOGLE-LOGIN.md).
