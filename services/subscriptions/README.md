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

---

## Testing y Verificación de Tareas (Trello)

A continuación se detalla cómo comprobar y demostrar que cada una de las tareas del Sprint 1 funciona al 100%.

---

### 1. Tarea: "Enviar peticiones simuladas (por ejemplo, vía Postman) para asegurar que devuelven los códigos HTTP correctos"

Esta tarea exige armar una colección en Postman con peticiones simuladas (`POST` para crear y `GET` para listar) comprobando que `POST` responde `201 Created` con el objeto creado y `GET` responde `200 OK` con un arreglo que incluye dicho objeto, además de verificar códigos `403 Forbidden`, `204 No Content` y `404 Not Found`.

#### Forma A: Desde la interfaz gráfica de Postman (Importar Colección)
1. Abrir **Postman** y pulsar el botón **Import** (arriba a la izquierda).
2. Seleccionar el archivo oficial de la colección:
   [`services/subscriptions/subscriptions.postman_collection.json`](subscriptions.postman_collection.json)
3. La colección ya viene preconfigurada con variables dinámicas (`base_url`, `org_id`, `org_id_b`, `subscription_id`) y scripts de prueba JavaScript (`pm.test`):
   - **`POST /subscriptions/`**: Envía el payload de creación con la cabecera `X-Organizacion-Id`. Valida código **`201 Created`**, que el cuerpo contenga `id`, `nombre` y `moneda`, y guarda dinámicamente el `subscription_id`.
   - **`GET /subscriptions/`**: Valida código **`200 OK`** y confirma que la lista contiene el objeto creado anteriormente.
   - **`GET /subscriptions/:id/`**: Valida código **`200 OK`** al consultar el recurso propio.
   - **`PATCH /subscriptions/:id/`**: Valida código **`200 OK`** al actualizar el estado a `"cancelado"`.
   - **`GET /subscriptions/ (Org B)`**: Valida código **`200 OK`** pero 0 resultados de la Organización A (aislamiento multi-tenant).
   - **`GET /subscriptions/ (Sin cabecera)`**: Valida código **`403 Forbidden`** (seguridad).
   - **`DELETE /subscriptions/:id/`**: Valida código **`204 No Content`** y luego **`404 Not Found`**.
4. Haz clic derecho en la colección y selecciona **Run Collection** para ejecutar todas las pruebas de una vez.

#### Forma B: Desde la terminal con el simulador CLI (sin abrir Postman)
Ejecuta el script que reproduce exactamente las peticiones de Postman y evalúa en consola las 12 aserciones `pm.test`:

```powershell
cd services/subscriptions
.\venv\Scripts\python.exe simular_postman.py
```

**Resultado esperado:**
- `7 REQUESTS` ejecutados (`POST`, `GET`, `PATCH`, `DELETE`).
- `12/12` pruebas `pm.test` en estado **`[PASS]`**.
- Códigos HTTP verificados: `201 Created`, `200 OK`, `403 Forbidden`, `204 No Content`, `404 Not Found`.

---

### 2. Tarea: "Endpoints create y list"

Esta tarea exige habilitar las rutas `POST /subscriptions/` (crear suscripción propia) y `GET /subscriptions/` (listar exclusivamente las suscripciones de la cuenta autenticada), asegurando que el cliente no elija el propietario sino que el backend lo asigne desde `X-Organizacion-Id`, e incluyendo `moneda` en entrada y salida.

#### Cómo comprobarlo:
1. **Tests unitarios específicos con pytest:**
   ```powershell
   cd services/subscriptions
   .\venv\Scripts\pytest.exe tests/test_views.py -k "TestSubscriptionCreateListViews" -v
   ```
   Comprueba:
   - `test_create_subscription_success`: `POST` responde `201 Created` y guarda `organizacion_id` del contexto.
   - `test_create_subscription_with_legacy_card_aliases`: Soporta alias del ejemplo de Trello (`ciclo`, `fecha_cobro`).
   - `test_create_subscription_ignores_payload_organization`: El backend ignora cualquier intento de adjudicarse otra organización en el body.
   - `test_create_subscription_missing_header_returns_403`: Bloquea creaciones anónimas con `403 Forbidden`.
   - `test_create_subscription_invalid_monto_returns_400`: Bloquea montos $\le 0$ con `400 Bad Request`.
   - `test_list_subscriptions_only_returns_own_tenant`: Org A solo ve las suyas y Org B solo ve las suyas.
   - `test_list_subscriptions_missing_header_returns_403`: Bloquea listados sin cabecera con `403 Forbidden`.

2. **Verificación interactiva en vivo:**
   ```powershell
   cd services/subscriptions
   .\venv\Scripts\python.exe verificar_todo.py
   ```
   (Los pasos 1 y 2 ejecutan `POST` y `GET` demostrando el aislamiento y la respuesta `201`/`200`).

---

### 3. Tarea: "Endpoints update y delete"

Esta tarea exige habilitar `PUT` (actualización completa), `PATCH` (actualización parcial de campos como `estado`) y `DELETE` (eliminación física o lógica), asegurando que una organización no pueda modificar ni borrar recursos de otra cuenta (aislamiento multi-tenant estricto con `404 Not Found`).

#### Cómo comprobarlo:
1. **Tests unitarios específicos con pytest:**
   ```powershell
   cd services/subscriptions
   .\venv\Scripts\pytest.exe tests/test_views.py -k "TestSubscriptionUpdateDeleteViews" -v
   ```
   Comprueba:
   - `test_patch_subscription_success`: `PATCH` actualiza a `"cancelado"` y responde `200 OK`.
   - `test_patch_subscription_supports_cancelada_normalization`: Normaliza `"cancelada"` a `"cancelado"`.
   - `test_put_subscription_success`: `PUT` actualiza todos los campos y responde `200 OK`.
   - `test_delete_subscription_success`: `DELETE` elimina el recurso y responde `204 No Content`.
   - `test_tenant_isolation_patch_from_other_account_returns_404`: Otra cuenta recibe `404 Not Found`.
   - `test_tenant_isolation_delete_from_other_account_returns_404`: Otra cuenta recibe `404 Not Found`.
   - `test_cannot_reassign_organization_via_payload`: `organizacion_id` es inmutable.

2. **Toda la suite completa (35 tests):**
   ```powershell
   cd services/subscriptions
   .\venv\Scripts\pytest.exe -v
   ```
   O en Docker:
   ```bash
   docker compose run --rm subscriptions pytest -v
   ```

