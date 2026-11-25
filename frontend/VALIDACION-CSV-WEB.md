# Validación de tipo y tamaño de CSV en la web

**Responsable:** Sebastian Mena · **Tarjeta:** S3-SE-03 (anteriormente S3-CH-02) · **Sprint:** 3

| # | Tarea | Estado |
|---|---|---|
| S3-SE-03 | Validar en la web el tipo y tamaño del CSV antes de enviarlo | ✅ |

**Dependencia:** S3-SE-02 (Conectar la selección y carga de CSV con el servicio de importación), ya implementada.
**Contrato del backend:** FE-07 (`services/connectors/connectors/archivos.py`, `POST /api/importaciones/archivos/`).

---

## Qué hace

1. **Validación preventiva en el cliente antes de enviar:**
   - **Formato y extensión:** Solo se admiten archivos con extensión `.csv` (case-insensitive: `.csv`, `.CSV`). Archivos con otras extensiones (`.xlsx`, `.txt`, `.pdf`, etc.) o sin extensión se rechazan antes de tocar la red con el mensaje:
     `"Formato no admitido. Solo se admiten archivos .csv."`
   - **Archivo vacío:** Archivos con `size === 0` se rechazan con:
     `"El archivo está vacío."`
   - **Límite de tamaño:** Archivos que superan `IMPORTACION_TAMANO_MAXIMO_BYTES` (5 MB = 5.242.880 bytes) se rechazan con:
     `"El archivo supera el tamaño máximo permitido de 5 MB."`

2. **Posibilidad de corregir:**
   - Cuando se selecciona un archivo incompatible, se muestra el error de inmediato en pantalla (`role="alert"`) y el botón "Subir archivo" queda deshabilitado.
   - El usuario puede volver a interactuar con el selector para elegir un archivo correcto.
   - Al seleccionar un archivo válido, el error se limpia automáticamente y el botón de subida se habilita.

3. **Sujeción estricta a la validación del servidor:**
   - La aprobación en el cliente garantiza únicamente que la extensión y el tamaño reportado por el sistema de archivos caben dentro de los topes permitidos.
   - La comprobación definitiva del contenido (ausencia de bytes nulos, decodificación UTF-8 / Latin-1, presencia de cabecera con separador reconocido y al menos una fila de datos) y la cuota diaria de la organización continúan realizándose en el servidor en `POST /api/importaciones/archivos/`.
   - Si el backend rechaza con un 400 (`contenido_incompatible`, `archivo_vacio`, etc.) o 429 (`cuota_excedida`), el mensaje devuelto por el servidor se presenta tal cual en la interfaz.

4. **Recuperación tras error de transporte sin bloquear reintento:**
   - La validez del archivo se calcula a partir del `File` y las reglas de `validarArchivoCsv`, separada del estado de error de subida o red.
   - Si ocurre una desconexión o falla de transporte (`TypeError` / red caída), el error se expone en `role="alert"`, pero el botón de subida se mantiene habilitado con el archivo ya seleccionado, permitiendo reintentar de inmediato sin tener que volver a buscar el archivo en el explorador.
   - En caso de seleccionar un archivo inválido (extensión incorrecta o tamaño excedido), el botón permanece deshabilitado.

---

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/validaciones.ts](shared/src/validaciones.ts) | Función pura `validarArchivoCsv(archivo, tamanoMaximoBytes?)`, constantes y tipos de validación. |
| [shared/src/validaciones.test.ts](shared/src/validaciones.test.ts) | Pruebas unitarias de las reglas de extensión, archivo vacío, límites de 5 MB y mayúsculas. |
| [web/src/components/importaciones/SubirArchivoCsv.tsx](web/src/components/importaciones/SubirArchivoCsv.tsx) | Integración de la validación en el cambio de archivo (`onChange`) y previo al envío (`onSubmit`). |
| [web/src/components/importaciones/SubirArchivoCsv.test.tsx](web/src/components/importaciones/SubirArchivoCsv.test.tsx) | Pruebas de interfaz: rechazo sin envío, habilitación tras corrección y sujeción a error del servidor. |

---

## Cómo se comprobó

1. **Pruebas en `shared`:**
   - `shared/src/validaciones.test.ts`: 6 pruebas nuevas verificando:
     - Aceptación de `.csv` de tamaño válido.
     - Extensión en mayúsculas (`.CSV`).
     - Límite exacto de 5 MB.
     - Rechazo con código `formato_no_admitido`.
     - Rechazo con código `archivo_vacio`.
     - Rechazo con código `archivo_excedido`.
   - 57 pruebas pasando en la suite.

2. **Pruebas en `web`:**
   - `web/src/components/importaciones/SubirArchivoCsv.test.tsx`: 10 pruebas pasando, cubriendo:
     - Bloqueo de archivos incompatibles (no llaman a `onSubir`).
     - Despeje de error y habilitación de botón al corregir selección.
     - Error por archivo vacío y por exceder 5 MB.
     - Simulación de archivo aprobado por el cliente que es rechazado por el backend con 400 (`contenido_incompatible`), comprobando que se muestra el mensaje del servidor.
     - Reintento con el mismo archivo tras un fallo de red o transporte (`TypeError`), manteniendo el botón habilitado.

3. **Typecheck general:**
   - `npm run typecheck`: 0 errores en todos los paquetes.
