# Servicio de Suscripciones (`subscriptions`)

Microservicio núcleo del dominio de **Ojo al Gasto** (puerto `8002`).

Gestiona las suscripciones, proveedores y cobros recurrentes de cada hogar/organización, garantizando aislamiento multi-tenant estricto según **ADR-002**.

---

## Modelo de Datos y Contrato

- **Herencia Multi-Tenant**: Hereda de `shared.tenant.base.ModeloTenant` (`id` UUID, `organizacion_id`, `creado_en`, `actualizado_en`). No posee clave foránea a `User` (cumpliendo ADR-002).
- **Estados (RF-13)**: `prueba`, `activo`, `por_confirmar`, `cancelado`, `fantasma`.
- **Alineación Frontend (`tipos.ts`)**: `nombre`, `monto`, `moneda` (CLP/USD), `frecuencia` (mensual/anual), `fecha_proximo_cobro`, `categoria` (RF-12), `fin_prueba`, `horas_uso_mes`.

---

## Endpoints Disponibles

| Método | Ruta | Descripción | Estado HTTP |
|---|---|---|:---:|
| `GET` | `/subscriptions/` | Lista las suscripciones de la organización | `200 OK` |
| `POST` | `/subscriptions/` | Crea una nueva suscripción para la organización | `201 Created` |
| `GET` | `/subscriptions/<id>/` | Obtiene el detalle de una suscripción propia | `200 OK` / `404` |
| `PUT` | `/subscriptions/<id>/` | Actualiza por completo una suscripción propia | `200 OK` / `404` |
| `PATCH` | `/subscriptions/<id>/` | Actualiza parcialmente (ej. estado) | `200 OK` / `404` |
| `DELETE` | `/subscriptions/<id>/` | Elimina una suscripción propia | `204 No Content` / `404` |

> **Aislamiento de cuenta**: Toda petición debe incluir la cabecera `X-Organizacion-Id`. Si falta, responde `403 Forbidden`. Si se intenta acceder, modificar o eliminar una suscripción de otra organización, responde `404 Not Found` sin revelar su existencia.

---

## Cómo ejecutar las pruebas (Demostración de Endpoints Update y Delete)

### Opción 1: Tests Automatizados con Pytest

Desde la carpeta `services/subscriptions`:

```powershell
# Solo los tests de endpoints (PUT, PATCH, DELETE y Aislamiento Tenant)
.\venv\Scripts\pytest.exe tests\test_views.py -v

# Toda la suite (23 tests: serializadores, validaciones y vistas)
.\venv\Scripts\pytest.exe -v
```

O dentro de Docker:
```bash
docker compose run --rm subscriptions pytest -v
```

### Opción 2: Script Interactivo de Demostración en Vivo

Ejecuta el script de verificación paso a paso que simula todas las operaciones contra la base de datos:

```powershell
.\venv\Scripts\python.exe verificar_todo.py
```

Este script comprueba en vivo:
1. Creación de suscripción inicial para la Organización A.
2. `PATCH /subscriptions/<id>/` actualizando a `"cancelado"` (`200 OK`).
3. `PUT /subscriptions/<id>/` con payload completo (`200 OK`).
4. Intento de acceso/modificación por parte de Organización B (`404 Not Found`).
5. Intento de llamada sin cabecera de organización (`403 Forbidden`).
6. Intento de reasignar `organizacion_id` en el body (inmutable).
7. `DELETE /subscriptions/<id>/` (`204 No Content`) y confirmación de borrado.
8. Versión de `psycopg[binary]==3.2.3` alineada en los 5 servicios.
