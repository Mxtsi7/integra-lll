# Cliente Windows — MX-23

Reutiliza la aplicación React/Vite y el cliente API de shared. Es un cliente
Electron portable de Windows x64; los servicios siguen ejecutándose en el
entorno API. [Decisión y alternativas](../../docs/arquitectura/ADR-008-cliente-windows.md).

Requisitos: Windows x64, Node >=22.12 y npm. Desde frontend:

```powershell
npm ci
$env:DESKTOP_API_URL='http://127.0.0.1:8000/api'
npm run build --workspace=desktop
npm start --workspace=desktop
npm run package:win --workspace=desktop
.\desktop\release\OjoAlGasto-win32-x64\OjoAlGasto.exe
```

Distribuir **toda** la carpeta OjoAlGasto-win32-x64, no solo el exe.
No incluye instalador, firma de editor, actualización automática ni API
embebida. El prototipo no acredita una distribución de producción.

DESKTOP_API_URL se lee al arrancar, exige /api sin credenciales/query/hash.
HTTPS para un servidor remoto; HTTP solamente localhost/127.0.0.1/[::1].
El Gateway debe permitir el origen `app://ojoalgasto` mediante
CORS_ALLOWED_ORIGINS además de sus orígenes web. Nunca usar un wildcard para
resolver CORS ni incluir secretos en esta configuración.

La ventana carga únicamente archivos empaquetados y navegación interna.
Sandbox, aislamiento de contexto, Node deshabilitado en el renderer,
permisos denegados y CSP con conexiones solo al origen API configurado.
El bridge de preload expone solo apiUrl de lectura; no archivos, shell ni IPC.
No se abren redirecciones OAuth externas en la ventana; la recepción segura de
OAuth desktop necesita su contrato específico antes de habilitarla.

## Comprobación reproducible

```powershell
npm test --workspace=desktop
$env:DESKTOP_API_URL='http://127.0.0.1:8015/api'
$env:DESKTOP_SMOKE_OUTPUT="$PWD\MX23-windows.json"
.\desktop\release\OjoAlGasto-win32-x64\OjoAlGasto.exe --smoke-test
```

Con Gateway real en 8015, crea JSON y PNG: comprueba montaje React, aislamiento
de Node y GET /health/ desde el renderer con CORS real. Se cierra solo y tiene
timeout de 30 s. No prueba login con cuentas ni operaciones de negocio.
La CI Windows repite la prueba sobre el exe empaquetado y guarda el portable
y la evidencia durante siete días.

## Entrega a Sebastian (SE-04) y Victor (VI-15)

- Punto de entrada: frontend/web/main.tsx. El calendario debe añadirse como
  pantalla React del cliente existente y usar shared/api, conservando apiUrl.
- SE-04 recibe esta base Windows; su integración depende de CH-18/19/20.
  No se afirma recepción ni aceptación de Sebastian sin su revisión.
- VI-15 puede verificar el cliente contra su backend Docker en Windows.
  Arrancar Docker por sí solo no demuestra que el cliente abre.
- La ampliación de ADR-006 queda documentada; el OAuth móvil sigue siendo
  una ampliación separada pendiente de su responsable.
