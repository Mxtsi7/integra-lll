# ADR-008 — Cliente Windows con Electron

Fecha: 2026-10-21. Estado: propuesta implementada para revisión del equipo.
Responsable: Maximiliano Sáez. [MX-23](https://trello.com/c/Ll8g4eCM).
Amplía ADR-006 con el cliente Windows solicitado en el nuevo tablero.

## Opciones y decisión

| Opción | Encaje y costo de implementación |
|---|---|
| Electron | Reutiliza React/Vite y TypeScript/JavaScript; incluye Chromium/Node y aumenta el tamaño de distribución. Permite probar el mismo renderer y empaquetar un portable x64. |
| Tauri 2 | Reutiliza React, pero añade Rust y herramientas Windows/WebView2 a la base de conocimientos y compilación. Su menor runtime es atractivo para evaluar después. |
| Solo web instalada | No entrega en este alcance un ejecutable Windows ni una base específica para SE-04. |

Se elige Electron para levantar una base verificable con el frontend actual.
No se afirma acuerdo humano ya obtenido; este PR entrega la comparación y el
prototipo para esa revisión. No introduce otro diseño de interfaz ni API paralela.
Electron 45.0.0 y packager 20.3.0 quedan fijados en el lockfile.

[Seguridad oficial Electron](https://www.electronjs.org/docs/latest/tutorial/security):
sandbox y contextIsolation activos, sin Node en renderer, navegación/orígenes
restringidos, permisos denegados y CSP. [Prerrequisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/)
fundamentan el costo adicional de Rust/toolchain Windows, no una prueba local
de rendimiento comparativo. Revisar las versiones antes de distribuir.

## Evidencia y consecuencias

En Windows local, el exe empaquetado abre React y consume /health/ de un
Gateway Django real mediante CORS app://ojoalgasto. La prueba automática
verifica renderer=true, nodeAislado=true, estadoApi=200. La captura y resultado
se conservan en [evidencia MX-23](../evidencias/MX23-windows.json) y su PNG.
El workflow Cliente Windows lo reproduce y adjunta el portable.

Se asume una distribución mayor y actualizaciones de Chromium frecuentes.
Faltan firma, instalador, actualización automática y pruebas de negocio
autenticadas. No hay aceptación de calendario SE-04 ni OAuth desktop/móvil.
El README del workspace documenta arranque, API y contrato de recepción.
