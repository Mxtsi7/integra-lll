# [MX-07] Eliminar cuenta y coordinar limpieza entre servicios

> Cuerpo propuesto para el PR #72. **No se publicó desde esta sesión** y no se cambió su estado (draft/ready). No se movió a ready, no se fusionó y no se hizo force-push.

## Resumen

Este PR implementa la eliminación de cuenta de punta a punta y la limpieza coordinada entre Auth, Subscriptions, Connectors, Analytics y Notifications. La identidad sale del contexto del Gateway; el `DELETE` exige contraseña y confirmación explícita; las operaciones entre servicios son durables y reintentables; y las rutas internas de limpieza quedaron fuera del contrato OpenAPI público.

La limpieza de organización en Connectors ya no se bloquea para siempre por Outlook. Se adoptó una **mitigación documentada**: Outlook se cierra sin revocación ante Microsoft, se destruyen las credenciales cifradas al final del borrado y se registra que no hubo revocación. **Outlook no cumple RF-01.7**; queda como incumplimiento documentado con riesgo residual hasta la ratificación indicada abajo.

## Qué incluye

- **Auth:** eliminación de integrante, titular con otro titular y último titular; revocación de sesiones; evidencia de consentimiento disociada; outbox durable y reintentos.
- **Subscriptions:** limpieza de suscripciones, cobros, hallazgos, outbox, resumen y trabajo derivado; bloqueo por tenant inconsistente; idempotencia y reintentos.
- **Connectors:** revocación de Gmail, cierre local de Outlook, limpieza de autorizaciones, importaciones y cuentas; exclusión de Outlook de los reintentos permanentes.
- **Notifications:** limpieza personal de preferencias; la retención global de notificaciones de la organización queda fuera de este PR.
- **Analytics:** limpieza de datos del tenant.
- **OpenAPI:** las rutas internas de limpieza se excluyeron con `@extend_schema(exclude=True)` y no aparecen en el esquema generado.
- **Migraciones:** no se agregó ninguna migración nueva y `0003_autorizacion_y_revocacion.py` quedó idéntica a `main`.

## Política de Outlook (decisión registrada)

- Outlook **no ofrece una revocación por token aplicable**: `revokeSignInSessions` no está soportado para cuentas personales y, para trabajo/escuela, exige consentimiento administrativo y afecta a todas las aplicaciones del usuario.
- La limpieza **no llama a Microsoft Graph**, no intenta revocar Outlook y **no escribe `revocado_en`** para ese proveedor.
- Las credenciales cifradas de Outlook se destruyen **solo como parte final del borrado**, en la misma transacción que elimina las filas de `CuentaConectada`, después de pasar todas las validaciones. Un 409 deja el ciphertext intacto.
- `pendientes_de_revocar` y `reintentar_revocaciones` excluyen Outlook: su limitación es permanente, no un pendiente reintentable.
- La limpieza registra en logs estructurados cuántas cuentas se cerraron sin revocación del proveedor, sin correos ni tokens. No se añadió cuerpo al 204 para no romper al consumidor actual.
- **Riesgo residual:** un refresh token ya emitido por Microsoft podría seguir válido hasta que expire o hasta que el usuario retire el acceso. Ya no conservamos copia; explotarlo exigiría que alguien lo hubiera obtenido antes.
- **Paso manual para el usuario:** en cuentas personales, retirar el acceso en <https://account.live.com/consent/Manage>. La fuente es una respuesta de Microsoft Q&A, **no documentación oficial**. En trabajo/escuela, la vía es el administrador del tenant o el portal de aplicaciones de Microsoft; **no está verificada** y queda fuera de alcance.
- La pantalla de borrado de cuenta (AN-18) todavía no muestra este aviso. Se recomienda agregarlo, pero no forma parte de esta PR.

La decisión completa, con fuentes y límites, está en `docs/decisiones/mx-07-outlook-revocacion.md`.

## Pendiente de ratificación

- Visto bueno de Felipe Orellana sobre la política de Outlook: **PENDIENTE**.
- Propuesta de enmienda a RF-01.7, a cargo del dueño de la matriz de requisitos (MX-22): **PENDIENTE**.

No se simula ninguna aprobación ni se inventan aprobadores. Mientras ambas ratificaciones no existan, Outlook se trata como **incumplimiento documentado de RF-01.7 con mitigación y riesgo residual**. No se editó RF-01.7, V-03, la matriz de trazabilidad ni `docs/investigacion/requisitos-vigentes.md`.

## Pruebas locales

Ejecutadas contra PostgreSQL 16 y RabbitMQ 3.13, con Python 3.13. **No se ejecutó GitHub Actions ni Python 3.12**, así que no se afirma que la CI pase.

| Servicio | Aprobadas | Omitidas | Falladas |
|---|---:|---:|---:|
| Auth (eliminación + Gateway + retención) | 29 | 0 | 0 |
| Subscriptions (eliminación + eventos + carrera PostgreSQL) | 28 | 0 | 0 |
| Connectors (eliminación/migración) | 17 | 0 | 0 |
| Connectors (suite completa) | 191 | 0 | 0 |
| Analytics | 4 | 0 | 0 |
| Notifications | 3 | 0 | 0 |

También se ejecutaron `manage.py check` y `makemigrations --check --dry-run` en los cinco servicios, sin cambios detectados. La migración publicada `0003` no cambió. El OpenAPI estricto de Connectors, Subscriptions y Notifications pasó; Analytics conserva una advertencia conocida y ajena a este PR en `RecomendacionConsolidacionSerializer.get_evidencia`. Las rutas internas no aparecen en ninguno de los esquemas generados.

Se rompieron a propósito tres propiedades y se revirtieron: el gate de proveedor, el orden de destrucción de credenciales y el rollback ante fallo. Las pruebas correspondientes fallaron con cada mutación y volvieron a pasar al revertirlas.

## No verificado

- CI de GitHub Actions y Python 3.12.
- Llamadas reales a Microsoft Graph, cuentas personales o tenants de trabajo/escuela.
- La página de consentimiento personal y el portal de aplicaciones de Microsoft.
- Despliegue en Kubernetes/Compose o en un entorno real.
- La pantalla AN-18 y el aviso al usuario.
- Los PRs #123, #127 y #97.
- La ratificación de Felipe Orellana y la enmienda de RF-01.7 por MX-22.

## Notas para revisión

- El 204 de limpieza sigue sin cuerpo para no romper al consumidor; la auditoría va en logs estructurados.
- Un fallo de Gmail conserva el ciphertext y devuelve 409; una confirmación real escribe `revocado_en` y borra tokens.
- Outlook nunca escribe `revocado_en` ni se reintenta como si fuera un fallo transitorio.
- El documento de decisión usa `[NOMBRE]` para la persona que decidió en la sesión; no se inventó una firma.
