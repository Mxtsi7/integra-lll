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
| `POST` | `/subscriptions/<id>/uso/` | Registra minutos de uso manual (CU-23 / RF-15 / RF-16) | `200 OK` / `400` / `404` |

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
- `8 REQUESTS` ejecutados (`POST`, `GET`, `PATCH`, `DELETE`, `GET paginado`).
- `15/15` pruebas `pm.test` en estado **`[PASS]`**.
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

---

### 4. Tarea: "Filtro por estado y fecha de cobro" y "Testear filtros"

Esta tarea añade parámetros a la URL del endpoint GET para que el backend devuelva resultados filtrados, garantizando aislamiento multi-tenant y validación adecuada de formatos.

#### Cómo comprobarlo:

**1. Tests unitarios con pytest (Docker)**

Correr solo los tests de filtros:
```bash
docker compose run --rm subscriptions pytest tests/test_views.py::TestSubscriptionFilters -v
```

Correr todos los tests de views:
```bash
docker compose run --rm subscriptions pytest tests/test_views.py -v
```

Correr un test específico por nombre (ej. verificación de 400 ante fecha inválida):
```bash
docker compose run --rm subscriptions pytest tests/test_views.py::TestSubscriptionFilters::test_filter_fecha_invalida_devuelve_400 -v
```

> **Nota sobre la salida de pytest:**  
> Cuando corre con `-v`:
> - `PASSED` → el test pasó ✅
> - `FAILED` → el test falló ❌ (se muestra la aserción que falló)
> - `ERROR` → hubo una excepción antes de llegar a la aserción
> 
> *Filtro por nombre (`-k`)*: Puedes ejecutar por ejemplo `docker compose run --rm subscriptions pytest -k "fecha" -v`.

**2. Prueba manual con curl (con el servicio levantado en el puerto 8002)**

Levantar los servicios con Docker:
```bash
docker compose up -d
```

Realizar peticiones de prueba (reemplazar `<tu-uuid>` por el UUID de tu organización):

Filtrar por estado activo:
```bash
curl "http://localhost:8002/api/suscripciones/?estado=activo" -H "X-Organizacion-Id: <tu-uuid>"
```

Filtrar por estado cancelado (verificando que el resultado cambia):
```bash
curl "http://localhost:8002/api/suscripciones/?estado=cancelado" -H "X-Organizacion-Id: <tu-uuid>"
```

Filtrar por fecha de cobro (alias `fecha_cobro` o `fecha_proximo_cobro` en formato `YYYY-MM-DD`):
```bash
curl "http://localhost:8002/api/suscripciones/?fecha_cobro=2026-10-01" -H "X-Organizacion-Id: <tu-uuid>"
```

Filtro combinado:
```bash
curl "http://localhost:8002/api/suscripciones/?estado=activo&fecha_cobro=2026-10-01" -H "X-Organizacion-Id: <tu-uuid>"
```

Fecha inválida (devuelve 400 Bad Request):
```bash
curl "http://localhost:8002/api/suscripciones/?fecha_cobro=hola" -H "X-Organizacion-Id: <tu-uuid>"
```

---

### 5. Tarea: "Endpoint para registrar uso de una suscripción" y "Test para registrar uso y validación de costo"

Esta tarea expone `POST /subscriptions/<id>/uso/` para registrar manualmente minutos de uso de un servicio (CU-23 / RF-15 / RF-16), actualizando el campo `ultima_actividad`, acumulando `horas_uso_mes`, y reactivando a `activo` aquellas suscripciones que se encontraban en estado `fantasma` (CU-27 / RF-13). Además, rechaza valores negativos o inválidos con `400 Bad Request`.

#### Cómo comprobarlo:

**1. Tests unitarios con pytest (Docker)**

Correr la suite completa de registrar uso:
```bash
docker compose run --rm subscriptions pytest tests/test_views.py::TestSubscriptionRegistrarUso -v
```

Correr un test específico (ej. rechazo de minutos negativos):
```bash
docker compose run --rm subscriptions pytest tests/test_views.py::TestSubscriptionRegistrarUso::test_registrar_uso_minutos_negativos_devuelve_400 -v
```

**2. Prueba manual con curl (puerto 8002)**

Registrar uso válido (actualiza `ultima_actividad` y si estaba en estado `fantasma` vuelve a `activo`):
```bash
curl -X POST "http://localhost:8002/subscriptions/<id>/uso/" \
  -H "Content-Type: application/json" \
  -H "X-Organizacion-Id: <tu-uuid>" \
  -d '{"minutos": 30}'
```

Rechazar minutos negativos (devuelve `400 Bad Request`):
```bash
curl -X POST "http://localhost:8002/subscriptions/<id>/uso/" \
  -H "Content-Type: application/json" \
  -H "X-Organizacion-Id: <tu-uuid>" \
  -d '{"minutos": -10}'
```

---

### 6. Tarea: "Implementar paginación en el listado GET de Suscripciones"

Esta tarea añade paginación al endpoint de listado (`GET /subscriptions/` y `GET /api/suscripciones/`) para no devolver todos los registros de golpe cuando el usuario u organización posea muchas suscripciones.

- **Paginador**: `PageNumberPagination` de DRF configurado con `page_size = 10`.
- **Estructura de respuesta**:
  ```json
  {
    "count": 15,
    "next": "http://localhost:8002/subscriptions/?page=2",
    "previous": null,
    "results": [ ... 10 suscripciones ... ]
  }
  ```
- **Soporte de rutas**: Funciona tanto en `/subscriptions/` (ejemplo de la tarjeta Trello) como en `/api/suscripciones/` (estándar REST del gateway).
- **Parámetros**:
  - `?page=2`: Obtiene la segunda página (`next: null`, `previous: ...`, y los registros 11 al 15).
  - `?page_size=X`: Permite parametrizar el tamaño de página (hasta 100).
  - Compatible con los filtros existentes (`?estado=activo&page=2`).
  - Páginas inválidas o fuera de rango responden `404 Not Found`.

#### Cómo comprobarlo:

**1. Tests unitarios con pytest:**
```powershell
cd services/subscriptions
.\venv\Scripts\pytest.exe tests/test_views.py::TestSubscriptionPagination -v
```

Comprueba:
- `test_pagination_default_page_size_and_structure`: Valida estructura con 10 items en página 1 y enlace `next`.
- `test_pagination_page_2_success`: `GET ?page=2` devuelve los 5 items restantes, `next=None` y `previous` con URL.
- `test_pagination_trello_card_example_suscripciones_page_2`: `GET /api/suscripciones/?page=2` funciona con la estructura paginada.
- `test_pagination_custom_page_size_param`: Soporte para `?page_size=5`.
- `test_pagination_invalid_page_returns_404`: Páginas fuera de rango responden 404.
- `test_pagination_combined_with_filters`: Paginación combinada con `?estado=activo&page=2`.
- `test_pagination_respects_tenant_isolation`: Garantiza aislamiento estricto entre organizaciones.
- `test_pagination_single_page_when_fewer_than_page_size`: Respuestas con < 10 elementos tienen `next=None` y `previous=None`.

**2. Prueba manual con curl (puerto 8002):**
```bash
curl "http://localhost:8002/api/suscripciones/?page=2" \
  -H "X-Organizacion-Id: <tu-uuid>"
```

---

### 7. Tarea: "Test de paginación de Suscripciones"

Esta tarea exige confirmar que la paginación funciona de forma sólida con **distintos volúmenes de datos**, asegurando el ejemplo de la tarjeta (con 25 suscripciones sembradas, `GET /subscriptions/` devuelve 10 resultados y `next` a la página 2) y validando el shape exacto que Sebastián y el Frontend consumirán en los controles de paginación de Home (`count`, `next`, `previous`, `results`).

#### Cómo comprobarlo:

**1. Correr la suite dedicada de pruebas de paginación (13 tests):**
```powershell
cd services/subscriptions
.\venv\Scripts\pytest.exe tests/test_paginacion.py -v
```

Comprueba:
- **Ejemplo Trello**: `test_ejemplo_trello_25_suscripciones_sembradas`: Con 25 suscripciones, `GET /subscriptions/` devuelve 10 resultados, `count=25`, y `next` con link a página 2.
- **Recorrido completo**: `test_recorrido_completo_3_paginas_con_25_suscripciones`: Navega las 3 páginas secuencialmente (10, 10 y 5 elementos) validando integridad (25 IDs únicos sin duplicados ni omisiones) y `404 Not Found` en página 4.
- **Distintos volúmenes**:
  - `test_volumen_cero_suscripciones`: 0 elementos (`count=0`, `results=[]`, `next=None`, `previous=None`).
  - `test_volumen_una_suscripcion`: 1 elemento (`count=1`, `len=1`).
  - `test_volumen_menor_a_page_size_7_items`: 7 elementos (< 10).
  - `test_volumen_exacto_limite_de_pagina_10_items`: 10 elementos exactos (`next=None`, sin enlace fantasma).
  - `test_volumen_limite_mas_uno_11_items`: 11 elementos (10 en pág 1 con `next`, 1 en pág 2).
  - `test_gran_volumen_50_suscripciones`: 50 elementos (5 páginas exactas).
- **Contrato y Shape para Sebastián / Frontend**:
  - `test_shape_exacto_respuesta_raiz`: Valida que la respuesta tenga exclusivamente `{"count", "next", "previous", "results"}` con tipos estrictos (`int`, `str|None`, `str|None`, `list`).
  - `test_shape_exacto_cada_elemento_en_results`: Valida los campos de cada suscripción en `results` (`id`, `nombre`, `monto`, `moneda`, `frecuencia`, `fecha_proximo_cobro`, etc.).
  - `test_shape_identico_en_ruta_espanol_y_ruta_ingles`: Mismo contrato en `/subscriptions/` y `/api/suscripciones/`.
- **Aislamiento y filtros**:
  - `test_paginacion_aislamiento_entre_organizaciones_con_volumenes_distintos`: Org A (25) y Org B (15) no comparten registros ni contadores.
  - `test_paginacion_combinada_con_filtro_estado`: Paginación sobre resultados filtrados (18 activas, 7 canceladas).

**2. Correr toda la suite de Suscripciones (96 tests):**
```powershell
cd services/subscriptions
.\venv\Scripts\pytest.exe -v
```



