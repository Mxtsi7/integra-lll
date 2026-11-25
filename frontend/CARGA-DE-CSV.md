# Carga y selección de archivos CSV para importación (web)

**Responsable:** Sebastian Mena · **Tarjeta:** S3-SE-02 (anteriormente S3-CH-01) · **Sprint:** 3

| # | Tarea | Estado |
|---|---|---|
| S3-SE-02 | Conectar la selección y carga de CSV con el servicio de importación | ✅ |

**Dependencias previas:**
- **FE-07 (Felipe Orellana):** `POST /api/importaciones/archivos/` mediante `multipart/form-data`, campo `archivo`.
- **S3-MX-25 (Maximiliano Sáez):** Formato común de candidatos v1 (`docs/contratos/candidatos-v1.md`).
- **CH-27 (Christopher Solís):** Polling y visualización del progreso en `/importaciones/<id>`.

---

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/api/cliente.ts](shared/src/api/cliente.ts) | Soporte nativo para `FormData` (multipart sin forzar `Content-Type: application/json`), conservación de JWT y lectura de `codigo`/`archivo` en errores. |
| [shared/src/api/importaciones.ts](shared/src/api/importaciones.ts) | `subirArchivoImportacion(archivo, nombreArchivo?)` conectada a `POST /importaciones/archivos/`. |
| [shared/src/api/importaciones.test.ts](shared/src/api/importaciones.test.ts) | Pruebas unitarias de llamada con multipart y campo `archivo`. |
| [shared/src/api/cliente.test.ts](shared/src/api/cliente.test.ts) | Pruebas de `FormData` con token `Authorization` y decodificación de errores de connectors. |
| [web/src/components/importaciones/SubirArchivoCsv.tsx](web/src/components/importaciones/SubirArchivoCsv.tsx) | Selector accesible de archivo CSV, botón de envío con spinner, manejo de errores y redirección. |
| [web/src/components/importaciones/SubirArchivoCsv.module.css](web/src/components/importaciones/SubirArchivoCsv.module.css) | Estilos integrados con el sistema de variables de diseño. |
| [web/src/components/importaciones/SubirArchivoCsv.test.tsx](web/src/components/importaciones/SubirArchivoCsv.test.tsx) | Pruebas de interacción, estados, errores y descarte de respuestas ante cambio de sesión. |
| [web/src/pages/ImportacionesPage.tsx](web/src/pages/ImportacionesPage.tsx) | Integración del componente `SubirArchivoCsv` en la vista de importaciones. |

---

## Qué hace

1. **Selector de archivos CSV accesible:**
   - Input de tipo `file` con filtro `accept=".csv,text/csv"`, con etiqueta accesible (`aria-label`).
   - Botón de envío deshabilitado hasta que el usuario selecciona un archivo válido.

2. **Envío seguro y sin pérdida de sesión:**
   - Construye un `FormData` con el campo `archivo` requerido por `SubirArchivoView` (FE-07).
   - Inyecta el token Bearer correspondiente y no fija `Content-Type` manual en `fetch` para permitir la correcta delimitación de partes (`boundary`).
   - Captura la marca de sesión al iniciar el envío; si el usuario cierra sesión o cambia de cuenta mientras la petición viaja, la respuesta tardía se descarta y no se redirige en la cuenta ajena.

3. **No afirma éxito antes de tiempo:**
   - La subida devuelve `201 Created` con el ID de la importación en estado `pendiente`.
   - La interfaz no muestra mensajes prematuros de "éxito" ni "archivo importado". Inmediatamente redirige a `/importaciones/<id>`, donde el componente de progreso (CH-27) realiza el seguimiento veraz de las filas leídas, candidatos detectados y errores.

4. **Manejo de errores del contrato:**
   - Si el backend rechaza por formato, tamaño (413), archivo vacío o cuota diaria excedida (429), muestra el mensaje claro mediante `role="alert"`.
   - Distingue fallos de red (`TypeError`) mostrando `MENSAJE_SIN_RED`.

---

## Cómo se comprobó

1. **Pruebas en `shared`:**
   - `shared/src/api/cliente.test.ts`: 13 pruebas, cubriendo `FormData` sin `Content-Type` forzado, cabecera `Authorization` y lectura de `{ codigo, archivo }`.
   - `shared/src/api/importaciones.test.ts`: llamada a `POST /importaciones/archivos/` con `FormData`.
   - Total: 403 pruebas pasando.

2. **Pruebas en `web`:**
   - `web/src/components/importaciones/SubirArchivoCsv.test.tsx`: 6 pruebas específicas cubriendo:
     - Botón deshabilitado inicialmente.
     - Habilitación tras selección.
     - Envío, estado cargando y redirección con el `id`.
     - Errores del servidor (`ErrorDeApi`).
     - Errores de red (`TypeError`).
     - Aislamiento de sesión en vuelo.
   - `web/src/pages/ImportacionPage.test.tsx`, `ImportacionPage.sesion.test.tsx` e `ImportacionPage.reconexion.test.tsx`: 46 pruebas pasando sin regresiones tras integrar el componente en `ImportacionesPage.tsx`.

3. **Typecheck general:**
   - `npm run typecheck`: 0 errores en todos los paquetes (`shared`, `web`, `movil`, `desktop`, `extension`).
