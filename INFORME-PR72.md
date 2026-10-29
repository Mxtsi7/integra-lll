# Informe — PR #72 (MX-07)

## 1. Resumen en 5 líneas

1. Se completó la Tarea B: las rutas internas de limpieza quedaron fuera del OpenAPI público y las pruebas de eliminación conservaron su línea base.
2. Se completó la Tarea A fase 1 con el documento de decisión y se implementó la fase 2 con la opción 3 para Outlook: cierre local sin revocación ante Microsoft.
3. Outlook ya no bloquea la limpieza por sí solo; sus credenciales se destruyen únicamente con la fila, al final del borrado, y nunca se escribe `revocado_en` para ese proveedor.
4. Gmail conserva su comportamiento: un fallo sigue dando 409, conserva el ciphertext y se reintenta; una confirmación real sigue escribiendo `revocado_en`.
5. Outlook queda como **mitigación con riesgo residual e incumplimiento documentado de RF-01.7** hasta que Felipe Orellana dé su visto bueno y el dueño de la matriz de requisitos (MX-22) ratifique una enmienda.

## 2. Tareas completadas

| Tarea | Estado | Commit |
|---|---|---|
| Tarea B — excluir rutas internas del OpenAPI | Completada | `d666f6c` |
| Tarea A fase 1 — documentar opciones de Outlook | Completada | `1c290a0` |
| Tarea A fase 2 — registrar la decisión | Completada | `1c1e0ba` |
| Tarea A fase 2 — implementación y pruebas | Completada | `f2a9b50` |
| Tarea C — actualizar el flujo de eliminación | Completada | `56f79ab` |
| Tarea C — informe y cuerpo propuesto del PR | Completada | `6e7c3bf` (informe) + `30d05ef` y `2cd433c` (precisión) |

La Tarea A fase 2 no creó migraciones: la limpieza ya borra las filas de `CuentaConectada`, así que la política se resolvió en código. `services/connectors/connectors/migrations/0003_autorizacion_y_revocacion.py` sigue idéntica a `main`.

## 3. Tareas bloqueadas

No quedó bloqueada ninguna tarea de código de este PR.

Quedan pendientes de ratificación humana, no de implementación:

- El visto bueno de Felipe Orellana (Connectors / FE-05) sobre la política de Outlook.
- La propuesta de enmienda a RF-01.7 a cargo del dueño de la matriz de requisitos (MX-22).
- Por lo anterior, **no se puede declarar que Outlook cumpla RF-01.7**. Se documenta como mitigación con riesgo residual hasta la ratificación.

## 4. Pruebas

Todas las cifras de esta tabla son ejecuciones locales contra PostgreSQL 16 y RabbitMQ 3.13. **No se ejecutó GitHub Actions ni Python 3.12.**

| Servicio | Pruebas ejecutadas | Aprobadas | Omitidas | Falladas | Notas |
|---|---:|---:|---:|---:|---|
| Auth | 29 | 29 | 0 | 0 | 20 de `test_eliminacion.py`, 3 de aislamiento Gateway, 6 de retención de consentimiento |
| Subscriptions | 28 | 28 | 0 | 0 | 19 de `test_eliminacion.py`, 7 de `test_eventos_eliminacion.py`, 2 de carrera PostgreSQL |
| Connectors | 16 de eliminación/migración | 16 | 0 | 0 | 7 pruebas netas nuevas respecto de la línea base de 9 (9 agregadas; 2 reemplazadas porque su comportamiento cambió); suite completa del servicio: 190 aprobadas |
| Analytics | 4 | 4 | 0 | 0 | Sin omisiones |
| Notifications | 3 | 3 | 0 | 0 | Sin omisiones |

**Concurrencia con PostgreSQL:** ejecutadas y aprobadas. Connectors: 3 pruebas de `test_carrera_revocacion_postgres.py`. Subscriptions: 2 pruebas de `test_carrera_resumen_postgres.py`. Auth incluye la prueba de dos titulares concurrentes dentro de sus 20. No hubo omisiones por falta de PostgreSQL.

**Mutaciones deliberadas:** se rompieron a propósito tres propiedades y se revirtieron:

1. **Gate del proveedor:** se hizo que `validar_limpieza` no bloqueara a Gmail; `test_gmail_sin_evidencia_sigue_bloqueando` falló con 204 en vez de 409.
2. **Orden de destrucción:** se hizo que `preparar_limpieza` borrara los tokens de Outlook antes de la validación final; `test_fallo_de_gmail_conserva_tambien_outlook_y_luego_termina` falló porque el token de Outlook ya no existía.
3. **Rollback:** se quitó `transaction.set_rollback(True)` del fallo de Gmail; `test_revocacion_externa_pendiente_conserva_token_cifrado_para_reintento` falló porque la cuenta quedó `desconectada` en vez de `conectada`.

Tras revertir las tres mutaciones, la suite completa de Connectors volvió a pasar: 190 pruebas. Las 16 de eliminación/migración también pasaron.

## 5. Comandos exactos que ejecuté

Variables comunes (valores de prueba, sin secretos reales): `DATABASE_URL=postgres://postgres:postgres@localhost:5432/suscripciones`, `PYTHONPATH=<raíz del repo>`, `ESQUEMA_BD=<servicio>`, `DEBUG=True`, `SECRET_KEY` y `JWT_SECRET` de prueba. Para Subscriptions agregué `RABBITMQ_PRUEBA_URL=amqp://guest:guest@localhost:5672/`.

```powershell
# Auth
python -m pytest tests/test_eliminacion.py -q
python -m pytest tests/test_aislamiento_eliminacion_gateway.py -q
python -m pytest tests/test_retencion_consentimiento.py -q

# Subscriptions
python -m pytest tests/test_eliminacion.py tests/test_eventos_eliminacion.py -q
python -m pytest tests/test_carrera_resumen_postgres.py -q

# Connectors
python -m pytest tests/test_eliminacion.py tests/test_migracion_eliminacion_importaciones.py -q
python -m pytest tests/test_eliminacion.py tests/test_migracion_eliminacion_importaciones.py tests/test_oauth.py tests/test_carrera_revocacion_postgres.py -q
python -m pytest -q

# Analytics
python -m pytest tests/test_eliminacion.py -q

# Notifications
python -m pytest tests/test_eliminacion.py -q

# Configuración y migraciones, en cada uno de los cinco servicios
python manage.py check
python manage.py makemigrations --check --dry-run

# OpenAPI estricto
python manage.py spectacular --validate --fail-on-warn --file <temporal>.yaml

# Git
git diff --check
git diff main -- services/connectors/connectors/migrations/0003_autorizacion_y_revocacion.py
```

El `git diff` de la migración `0003` quedó vacío. `git diff --check` no reportó errores.

## 6. Cosas que no pude verificar

- **CI de GitHub Actions:** no lo ejecuté. La CI usa Python 3.12; mis ejecuciones fueron con Python 3.13. No afirmo que la CI pase.
- **Microsoft Graph / cuentas reales:** no llamé a Graph, no usé una cuenta personal ni un tenant de trabajo/escuela, y no probé consentimiento administrativo.
- **Revocación real de Outlook:** no existe llamada implementada; la política es explícitamente de cierre local sin revocación.
- **Página de consentimiento personal:** la ruta `https://account.live.com/consent/Manage` viene de una respuesta de Microsoft Q&A, no de documentación oficial; no la probé con una cuenta real.
- **Trabajo/escuela:** el paso por el administrador del tenant o el portal de aplicaciones de Microsoft no está verificado.
- **AN-18 / frontend:** no modifiqué ni probé la pantalla de borrado de cuenta; el aviso al usuario es una recomendación, no una implementación.
- **Despliegue:** no ejecuté Kubernetes, Compose ni un entorno desplegado.
- **PRs #123, #127 y #97:** no los toqué ni verifiqué su estado.
- **RF-01.7:** no edité requisitos, V-03 ni la matriz. La interpretación legal/requisito no está ratificada.
- **Analytics OpenAPI:** el comando estricto sigue terminando con 1 advertencia conocida en `RecomendacionConsolidacionSerializer.get_evidencia`; es de otro alcance y no la corregí. Las rutas internas no aparecen.

## 7. Riesgos o sorpresas

- **RF-01.7 contradice la interpretación original del plazo.** El texto real exige revocación inmediata de tokens, no solo destrucción local dentro de 72 horas. Se detuvo la implementación, se consultó al usuario y se autorizó la opción 2: mantener RF-01.7 intacto y documentar Outlook como incumplimiento con mitigación. No se editó ningún documento de requisitos.
- **Riesgo residual de Outlook:** un refresh token ya emitido por Microsoft podría seguir válido hasta su vencimiento o hasta que el usuario retire el acceso. Ya no conservamos copia; explotarlo exigiría que alguien lo hubiera obtenido antes.
- **El 204 no lleva cuerpo.** El contrato actual del consumidor acepta un 204 sin cuerpo; añadir datos ahí podía romperlo. La auditoría mínima va en logs estructurados: organización, cantidad de cuentas y proveedores, sin correos ni tokens.
- **Desconexión directa de Outlook:** conserva las credenciales y no se reintenta; la destrucción definitiva ocurre con el borrado de la organización. `pendientes_de_revocar` y `reintentar_revocaciones` excluyen Outlook.
- **Registro de decisión:** el documento usa el placeholder `[NOMBRE]` para la persona que decidió en la sesión. No se inventó una firma ni un visto bueno.
- **Analytics:** la advertencia de `get_evidencia` sigue siendo la única del esquema estricto y está fuera del alcance de este PR.

## 8. Siguientes pasos para el humano

1. Obtener y registrar el visto bueno de Felipe Orellana sobre la política de Outlook.
2. Llevar la propuesta de enmienda a RF-01.7 al dueño de la matriz de requisitos (MX-22); no está aprobada.
3. No mover el PR a ready ni fusionarlo mientras Outlook siga siendo incumplimiento documentado sin ratificación.
4. Evaluar el aviso al usuario en AN-18 (pantalla de borrado de cuenta); no forma parte de esta implementación.
5. Ejecutar la CI real con Python 3.12 antes de publicar.
6. Revisar el cuerpo propuesto en `PR72-cuerpo-actualizado.md` y pegarlo manualmente si corresponde; no se publicó desde esta sesión.

## Propuesta de enmienda a RF-01.7 (NO APROBADA)

Propuesta de enmienda a RF-01.7 (NO APROBADA)

Estado: propuesta pendiente de ratificación por el dueño de la matriz de requisitos (MX-22) y por el responsable de Connectors (FE-05). No modifica ningún requisito vigente.

Texto actual citado en la revisión del PR #72: "Eliminación definitiva, máximo 72 horas desde la confirmación."

Texto propuesto:

RF-01.7 — Eliminación definitiva. Máximo 72 horas desde la confirmación del usuario.
a) Conectores cuyo proveedor ofrece revocación de acceso (por ejemplo Gmail): se revoca el acceso ante el proveedor y se eliminan las credenciales almacenadas dentro del plazo.
b) Conectores cuyo proveedor no ofrece revocación de acceso (por ejemplo Outlook / Microsoft): se destruyen las credenciales almacenadas dentro del mismo plazo, se registra que no hubo revocación ante el proveedor y se informa al usuario cómo retirar el acceso desde su cuenta del proveedor.
c) El sistema no controla los tokens que el proveedor ya emitió. Ese riesgo residual queda documentado.

Motivo: Microsoft Graph revokeSignInSessions no está soportado en modo delegado para cuentas personales de Microsoft y, en cuentas de trabajo o escuela, exige consentimiento administrativo e invalida los refresh tokens del usuario en todas sus aplicaciones. No hay API para revocar el consentimiento de una cuenta personal.

Mientras esta propuesta no se ratifique, Outlook se trata como incumplimiento documentado de RF-01.7 con mitigación (destrucción local de credenciales) y riesgo residual.

## Diferencias entre la propuesta y el texto real de RF-01.7

No corregí el texto de RF-01.7 ni ninguno de los documentos de requisitos. Las diferencias detectadas son:

1. **La cita no gobierna la fila de conectores.** La frase citada se arma con dos celdas de la fila de `docs/investigacion/requisitos-vigentes.md:168` (“Eliminación definitiva” y “Máximo 72 horas desde la confirmación”), no aparece como una oración literal continua, y corresponde a “Perfil (nombre, correo, contraseña), suscripciones, cobros, registros de uso, conversaciones del chat, alertas, presupuesto y preferencias”. No es el texto de la fila de “Sesiones activas, credenciales y tokens de conectores”.
2. **La fila de tokens exige revocación inmediata.** La línea 167 dice: “Revocación, invalidación y eliminación definitiva” y “Revocación inmediata, en la misma confirmación; eliminación definitiva en máximo 72 horas”. La propuesta traslada todo a un plazo de 72 horas y no conserva la revocación inmediata.
3. **El criterio de aceptación es más exigente.** La línea 176 dice que “sus sesiones y tokens quedan revocados de inmediato y ya no puede autenticar”. La propuesta (b) y (c) acepta que un token del proveedor siga vivo; eso relaja ese criterio, no lo aclara.
4. **La propuesta reduce el alcance de RF-01.7 a conectores.** El requisito real también cubre sesiones activas, perfil, suscripciones, cobros, uso, conversaciones, alertas, presupuesto, preferencias, auditoría, comprobantes y respaldos. La propuesta no reemplaza esas reglas.
5. **El “desde la confirmación” no está en la fila de tokens.** La fila de conectores dice “eliminación definitiva en máximo 72 horas”, dentro de una fila cuya revocación es “en la misma confirmación”. La frase “Máximo 72 horas desde la confirmación” aparece en la fila de perfil y otros datos, no en la de credenciales y tokens.
6. **V-03 sí existe en el repositorio y no fue editado.** Aparece en `docs/investigacion/requisitos-vigentes.md:163` como regla propuesta para ratificación, y en `docs/historico/MATRIZ-DE-TRAZABILIDAD.md:391` como “RNF-13 contradice a RF-01 — regla propuesta, pendiente de ratificación”. La regla se describe en la línea 395; V-03 también aparece en las líneas 436, 446 y 464 de esa matriz. No se modificó ninguno de esos archivos.
