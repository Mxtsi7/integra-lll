# Ojo al Gasto - Cliente Móvil

Aplicación móvil de Ojo al Gasto desarrollada con **React Native (v0.86)**, **Expo SDK 57**, **TypeScript** y **@ojoalgasto/shared**.

---

## Documentación y Contratos Técnicos

Toda la documentación técnica, contratos de integración y PRs están centralizados en la carpeta [`docs/`](docs/):

* [`docs/CONTRATO_NAVEGACION.md`](docs/CONTRATO_NAVEGACION.md): Enrutamiento React Navigation v7 (SE-06).
* [`docs/CONTRATO_CLIENTE_HTTP.md`](docs/CONTRATO_CLIENTE_HTTP.md): Cliente HTTP por entorno y adaptación de errores de red (SE-07).
* [`docs/CONTRATO_SESION_SEGURA.md`](docs/CONTRATO_SESION_SEGURA.md): Almacenamiento seguro nativo con `expo-secure-store` y ciclo de vida de sesión (SE-08).
* [`docs/CONTRATO_LOGIN_SCREEN.md`](docs/CONTRATO_LOGIN_SCREEN.md): Maqueta de Iniciar Sesión, foco/teclado y accesibilidad (SE-09).
* [`docs/CONTRATO_LOGIN_AUTH.md`](docs/CONTRATO_LOGIN_AUTH.md): Conexión de Login con Auth, distinción 401 vs red y recuperación de perfil (SE-10).
* [`docs/PULL_REQUEST.md`](docs/PULL_REQUEST.md): Resumen consolidado del Pull Request en `Seba_sprint2`.

---

## Requisitos de Entorno

* **Node.js:** v22.x (recomendado `nvm use 22`).
* **Expo Go / Emulador Android:** Emulador oficial (`10.0.2.2:8000/api`) o celular físico conectado a la misma red Wi-Fi.

---

## Comandos Principales

Desde la raíz del repositorio o dentro de `frontend/movil`:

```bash
# Iniciar servidor de desarrollo de Expo con caché limpia
npx expo start -c

# Ejecutar en emulador de Android
npx expo start --android

# Ejecutar suite de pruebas unitarias
npm test --workspace=movil

# Comprobación de tipos de TypeScript
npm run typecheck --workspace=movil
```
