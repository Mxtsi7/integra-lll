# — Cambiar el correo desde Perfil


## Qué hace
- El botón **Editar** del correo abre el formulario **Cambiar correo**: pide el correo nuevo y la contraseña actual.
- El backend manda un enlace **al correo nuevo**. El correo actual sigue activo y es el que Perfil muestra **hasta que se confirma** el enlace.
- Al abrir el enlace (`/verificar-correo?token=…`) se confirma el cambio. Si en ese navegador hay una sesión abierta, se vuelve a leer el usuario y Perfil y la barra superior muestran el correo nuevo sin pedir otro login.

## Dónde está cada cosa
| Archivo | Para qué |
|---|---|
| `shared/src/api/cambioCorreo.ts` | `solicitarCambioCorreo({ correo, password })` → `POST /api/auth/email-verification/request/` |
| `shared/src/api/cliente.ts` | `ErrorDeApi` ahora guarda el `code` del backend (`codigo`) |
| `web/src/components/Perfil/CambiarCorreo.tsx` | El formulario y sus avisos |
| `web/src/pages/PerfilPage.tsx` | Habilita **Editar** y abre el formulario |
| `web/src/pages/VerificarCorreoPage.tsx` | Avisa con `onVerificado` cuando el backend confirmó |
| `web/src/components/VerificarCorreoConectado.tsx` | Relee el usuario de la sesión abierta al confirmar |

## Cómo se distinguen los errores
| Respuesta del backend | Qué ve la persona |
|---|---|
| 400 `identidad_invalida` | "La contraseña no es correcta." bajo la contraseña |
| 400 `correo_no_disponible` | "Ese correo no está disponible. Prueba con otro." bajo el correo |
| 429 `limite_reenvio` (5 por hora, 1 por minuto) | "Pediste demasiados enlaces…" arriba de los botones |
| 401 | "Tu sesión expiró…" |
| 503 (el envío falló y se revirtió) | El mensaje del servidor; nada cambió |
| Sin red | "No pudimos conectar con el servidor…" |

Enlace vencido (410 `token_expirado`), usado (`token_usado`) o inválido: los resuelve `VerificarCorreoPage` (AN-13), que ofrece pedir un enlace nuevo.

## Reglas
- Pedir el cambio **no** modifica el correo que se ve: solo aparece un aviso "Te enviamos un enlace a …".
- Antes de enviar se valida el formato y que no sea el mismo correo de siempre.
- Un doble toque manda una sola solicitud y no se puede cancelar mientras se envía.
- Si mientras se enviaba se cerró la sesión o entró otra cuenta, la respuesta no se muestra como propia.
- Al releer el usuario tras confirmar, el contexto descarta la respuesta si la sesión cambió, y se conservan los campos que `/usuarios/me/` no trae.

## Pruebas
`CambiarCorreo.test.tsx` (validaciones, cada error, doble toque, otra sesión), `VerificarCorreoConectado.test.tsx`, `VerificarCorreoPage.test.tsx` (aviso de verificado), `PerfilPage.test.tsx` (el correo no cambia al pedirlo) y `cambioCorreo.test.ts` (shared).

## Pendiente / no verificado
- No se probó contra el backend real ni con un correo real; las pruebas usan respuestas simuladas con el formato del contrato.
- El texto del correo que recibe la persona lo define el backend.
