# Documentación y Contratos de Integración Móvil

Este directorio centraliza los contratos técnicos, guías de arquitectura y especificaciones de integración para el cliente móvil Expo / React Native (`frontend/movil`).

## Índice de Contratos por Tarjeta

| Tarjeta | Documento | Responsable | Estado | Descripción |
|---|---|---|---|---|
| **SE-06** | [`CONTRATO_NAVEGACION.md`](CONTRATO_NAVEGACION.md) | Sebastian Mena | ✅ Verificado | Contrato de navegación pública y privada, Tabs, Stacks y enrutamiento reactivo en `RootNavigator`. |
| **SE-07** | [`CONTRATO_CLIENTE_HTTP.md`](CONTRATO_CLIENTE_HTTP.md) | Sebastian Mena | ✅ Verificado | Resolución de `EXPO_PUBLIC_API_URL` por entorno, consistencia de Gateway y adaptación de errores de red. |
| **SE-08** | [`CONTRATO_SESION_SEGURA.md`](CONTRATO_SESION_SEGURA.md) | Sebastian Mena | ✅ Verificado | Adaptador síncrono/asíncrono con `expo-secure-store`, ciclo de hidratación en arranque y purga en logout/401. |
| **SE-09** | [`CONTRATO_LOGIN_SCREEN.md`](CONTRATO_LOGIN_SCREEN.md) | Sebastian Mena | ✅ Verificado | Maqueta de Iniciar Sesión, `LoginFormProps`, `KeyboardAvoidingView`, encadenamiento de foco y accesibilidad. |
| **SE-10** | [`CONTRATO_LOGIN_AUTH.md`](CONTRATO_LOGIN_AUTH.md) | Sebastian Mena | ✅ Verificado | Conexión de Login con `@ojoalgasto/shared`, traducción `correo` -> `email`, distinción 401 vs red y recuperación de `/usuarios/me/`. |

---

## Consolidado de Sprint

* [`PULL_REQUEST.md`](PULL_REQUEST.md): Informe consolidado del Pull Request en la rama `Seba_sprint2`, con la matriz completa de criterios de aceptación y evidencia de 70 pruebas aprobadas.
