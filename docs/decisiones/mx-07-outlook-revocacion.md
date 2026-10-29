# MX-07 — Evidencia de revocación para Outlook

- **Estado:** decisión registrada el 29 de octubre de 2026; **visto bueno de Felipe Orellana PENDIENTE**.
- **Fecha:** 29 de octubre de 2026.
- **Alcance:** PR #72, eliminación de organización, servicio Connectors / FE-05.
- **Decidido por:** [NOMBRE], usuario de esta sesión (completar antes de publicar).
- **Visto bueno de Felipe Orellana (Connectors / FE-05):** PENDIENTE.
- **Firma de Maximiliano Sáez (producto / PR #72):** no registrada; este documento no la simula.
- **Naturaleza:** registra la opción elegida y sus límites. No acredita que Outlook cumpla RF-01.7 ni sustituye la ratificación pendiente.
- **Estado de la fase 1:** investigación y documentación. No se modificaron `eliminacion.py`, `revocacion.py`, `proveedores.py` ni migraciones; no se ejecutó ninguna llamada de revocación contra Microsoft.
- **Estado de la fase 2:** implementada la opción 3 en código y pruebas; ver la sección 0 y el informe del PR.

## 0. Decisión registrada

- **Opción elegida:** **3**, acotada a Outlook y a la eliminación de organización.
- **Qué se acepta:** cerrar la limpieza de una organización con cuentas Outlook **sin revocación ante Microsoft**, porque no existe una operación aplicable para cuentas personales y las opciones para trabajo/escuela tienen efectos y permisos que esta PR no puede asumir.
- **Qué se destruye:** nuestras credenciales cifradas de Outlook, únicamente como parte final de la limpieza, en la misma transacción que borra las filas de `CuentaConectada`. Nunca en una ruta que termine en 409.
- **Qué NO se hace:** no se escribe `revocado_en` para Outlook, no se reutiliza ese campo con otro significado, no se llama a Microsoft Graph desde la limpieza, no se retira Connectors de los destinos y no se edita la migración publicada `0003_autorizacion_y_revocacion`.
- **Riesgo residual:** un refresh token que Microsoft ya emitió podría seguir válido hasta que expire o hasta que el usuario retire el acceso desde su cuenta Microsoft. Nosotros ya no tendremos copia, así que explotarlo exigiría que alguien hubiera obtenido el token antes. No se controla lo que Microsoft haga con tokens ya emitidos.
- **Requisito:** RF-01.7 **no se modifica**. Outlook queda como **incumplimiento documentado de RF-01.7 con mitigación y riesgo residual**, hasta que el equipo ratifique una enmienda. La propuesta de enmienda no aprobada se incluye en `INFORME-PR72.md`.
- **Ratificación pendiente:** el visto bueno de Felipe Orellana y la propuesta de enmienda a cargo del dueño de la matriz de requisitos (MX-22) siguen PENDIENTES. Este documento no afirma que estén aprobados.

### Hechos de Microsoft citados en la decisión

1. `revokeSignInSessions` **no está soportado en modo delegado para cuentas personales**. En cuentas de trabajo/escuela exige `User.RevokeSessions.All`, y además invalida **todos** los refresh tokens del usuario en **todas** las aplicaciones y las cookies de sesión del navegador. Se descarta por su efecto global. Fuente: <https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0>.
2. Para cuentas personales no hay una API documentada para revocar el consentimiento; el usuario debe retirarlo manualmente en <https://account.live.com/consent/Manage>. **Esta afirmación proviene de una respuesta de Microsoft Q&A, no de documentación oficial**, y se marca como no oficial: <https://learn.microsoft.com/en-us/answers/questions/5563534/how-to-revoke-consent-through-api-after-the-third>.
3. Los access tokens no se pueden revocar; en Entra duran una hora por defecto. Fuente: <https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access>.
4. Para cuentas de trabajo/escuela, quitar el grant de consentimiento exige permisos de administrador y no invalida los access tokens ya emitidos. Esta afirmación proviene de un blog de terceros, **no está verificada** y queda **fuera de alcance**.

> Las secciones 1 a 12 conservan el análisis y las opciones de la fase 1. Donde dicen que no hay decisión, se leen junto con esta sección 0 y con el estado de ratificación pendiente.

## 1. El problema, en cinco líneas

1. La limpieza de Connectors exige `revocado_en` para toda cuenta que no sea CSV.
2. Outlook nunca recibe ese dato porque su adaptador no tiene una revocación de token que confirmar.
3. Por eso cada reintento devuelve `409 revocacion_proveedor_pendiente`, para siempre.
4. El usuario y sus datos de Auth ya se borraron; la organización y los datos de Connectors quedan retenidos, fuera del plazo de 72 horas de RF-01.7.
5. No se puede resolver inventando `revocado_en`, borrando el ciphertext mientras el estado sea pendiente, ni retirando Connectors de los destinos de limpieza. Hace falta decidir qué evidencia se acepta.

## 2. Qué hace hoy el flujo, con citas

### 2.1. La configuración de Outlook no tiene URL de revocación

`services/connectors/connectors/proveedores.py:96-101` define Outlook con `url_revocacion=""`. El comentario del propio archivo dice que Microsoft no publica un endpoint de revocación por token y que se revoca desde la cuenta del usuario.

`services/connectors/connectors/proveedores.py:213-239` implementa `revocar()`: si `url_revocacion` está vacía, devuelve `False` sin hacer ninguna llamada externa. Para Gmail sí hay URL (`https://oauth2.googleapis.com/revoke`, líneas 78-86) y solo devuelve `True` ante `200` o `204`.

**Consecuencia:** para Outlook no existe hoy una respuesta del proveedor que pueda considerarse confirmación.

### 2.2. `revocado_en` solo se escribe con confirmación real

`services/connectors/connectors/revocacion.py:96-104` toma la versión de credenciales y el token disponible. `revocacion.py:131-139` llama a `proveedores.revocar()` y recibe `False` para Outlook.

`revocacion.py:147-168` es explícito:

- si el proveedor confirma, borra los tokens y escribe `revocado_en`;
- si no confirma, conserva los tokens cifrados y deja `revocado_en` en `NULL`;
- si no había nada que revocar (`sin_nada`), tampoco escribe `revocado_en`, porque la ausencia de token no demuestra una revocación externa.

La escritura es condicional a `credenciales_version` (`revocacion.py:170-177`) para no acreditar una concesión distinta de la que realmente se intentó revocar.

`services/connectors/connectors/models.py:141-151` documenta el campo: se llena **solo** cuando el proveedor confirmó y la limpieza de #72 exige ese dato.

### 2.3. La limpieza prepara, valida y se bloquea

`services/connectors/connectors/eliminacion.py:19-35` recorre las cuentas no CSV con `revocado_en` nulo. Si `revocar_y_desconectar` no confirma, o si hubo reconexión, revierte los cambios locales de esa cuenta para conservar estado y credenciales.

`eliminacion.py:37-43` vuelve a comprobar la evidencia bajo bloqueo. Si queda alguna cuenta no CSV sin `revocado_en`, responde:

```json
{"code": "revocacion_proveedor_pendiente"}
```

con estado HTTP 409.

`shared/eliminacion.py:53-74` muestra el orden: primero se ejecuta la preparación durable, después se valida dentro de una transacción, y si hay bloqueo se revierte también lo que hubiera hecho el validador. Solo si la validación pasa se marca la organización como eliminada y se borran los modelos.

### 2.4. El worker reintenta y la operación no termina

`services/auth/app/eliminacion.py:94-108` crea `EliminacionOrganizacion` con los destinos y devuelve 202. `eliminacion.py:112-142` solo quita un destino de `pendientes` cuando recibe 204; con 409 lo conserva. La organización solo se borra cuando no quedan pendientes.

`services/auth/app/management/commands/procesar_eliminaciones.py:14-29` ejecuta el reintento cada 60 segundos con `--continuo`. Un 409 permanente se convierte en un bucle de reintentos y en una organización que nunca se elimina.

### 2.5. Lo que ya está probado

Las pruebas actuales confirman el bloqueo seguro, no que la eliminación complete:

- `services/connectors/tests/test_eliminacion.py:62-83`: Gmail falla, se conserva el token y se reintenta; cuando el proveedor confirma, la limpieza termina en 204.
- `test_eliminacion.py:86-91`: una cuenta Outlook sin tokens sigue bloqueando, porque la ausencia de tokens no se toma como evidencia.
- `test_eliminacion.py:94-115`: Gmail confirmado no se vuelve a revocar; Outlook pendiente mantiene el bloqueo y su token.
- `test_eliminacion.py:135-150`: un ciphertext ilegible se conserva y no se llama al proveedor.

### 2.6. El plazo que se incumple

`docs/investigacion/requisitos-vigentes.md:161-169` define RF-01.7 y la tabla de retención: las credenciales y tokens de conectores deben tener revocación inmediata y eliminación definitiva en máximo 72 horas. La línea 177 exige que, transcurridas 72 horas, ninguna consulta ni exportación devuelva datos personales del titular.

## 3. Búsqueda de una decisión previa

No se encontró una decisión versionada sobre Outlook:

- `docs/arquitectura/ADR-001` a `ADR-007` no tratan la revocación de Outlook.
- `docs/flujos/maximiliano-saez/07-eliminar-cuenta.md:63-74` solo registra el estado actual: Outlook sigue pendiente y no se sustituye por desconexión, expiración o tokens nulos.
- Los comentarios de `revocacion.py`, `proveedores.py` y las pruebas describen el comportamiento técnico, pero no autorizan una política de evidencia alternativa.
- `CONTEXTO-PR72.md` y `PLAN-PR72.md` son insumos de trabajo de esta PR; no son una decisión aprobada ni están versionados.

Por eso las opciones siguientes quedan abiertas.

## 4. Verificación contra documentación oficial de Microsoft

Consultado el **29 de octubre de 2026**. Convenciones:

- **[V]** verificado en documentación oficial de Microsoft.
- **[M]** verificado en el metadata OIDC público de Microsoft.
- **[S]** sin verificar contra un tenant, una cuenta personal o una llamada real; no se ejecutó ninguna revocación.
- **[P]** decisión de política interna, no una capacidad del proveedor.

Hechos verificados que enmarcan las opciones:

| Hecho | Resultado | Fuente |
| --- | --- | --- |
| `POST /me/revokeSignInSessions` invalida todos los refresh tokens del usuario y las cookies de sesión del navegador; puede tardar unos minutos. | [V] | [user: revokeSignInSessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0&tabs=http) |
| `revokeSignInSessions` con cuenta personal de Microsoft: **Not supported**. | [V] | misma página, tabla de permisos |
| `revokeSignInSessions` delegado para trabajo o escuela requiere `User.RevokeSessions.All`; ese permiso tiene `AdminConsentRequired: Yes`. | [V] | [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference?view=graph-rest-1.0#userrevokesessionsall) |
| `DELETE /oAuth2PermissionGrants/{id}` revoca la concesión delegada, pero los access tokens existentes siguen válidos hasta su vencimiento. | [V] | [Delete oAuth2PermissionGrant](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete?view=graph-rest-1.0&tabs=http) |
| Esa eliminación de concesión no está soportada para cuentas personales y exige `DelegatedPermissionGrant.ReadWrite.All` y un rol administrativo para trabajo o escuela. | [V] | misma página |
| `invalidateAllRefreshTokens` sigue en beta, **no** se promoverá a disponibilidad general y Microsoft recomienda `revokeSignInSessions`. | [V] | [user: invalidateAllRefreshTokens](https://learn.microsoft.com/en-us/graph/api/user-invalidateallrefreshtokens?view=graph-rest-beta&tabs=http) |
| El refresh token por defecto dura 90 días en escenarios que no son SPA ni OTP; el access token dura entre 60 y 90 minutos. | [V] | [Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens), [Access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) |
| El metadata OIDC de `common` no publica `revocation_endpoint`; sí publica `end_session_endpoint`. | [M] | `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration` |
| La app usa la autoridad `common`, por lo que acepta cuentas personales y de trabajo/escuela. | [V] | `services/connectors/connectors/proveedores.py:96-110` |
| La app solo pide `Mail.Read`, `offline_access`, `openid` y `email`; no tiene permiso para revocar sesiones ni concesiones. | [V] | `proveedores.py:102-107` |
| El callback guarda el correo, pero no guarda `tid` ni distingue cuenta personal de trabajo/escuela. | [V] | `proveedores.py:259-334`; `views.py:355-408` |

> **Límite de la verificación:** no se llamó a Microsoft Graph, no se usó una cuenta real y no se probó ningún flujo de consentimiento administrativo. Las opciones 1 y 2 están verificadas documentalmente, pero **no** están probadas en un tenant ni en una cuenta personal.

## 5. Opciones

### Opción 1 — Revocación real con Microsoft Graph (`revokeSignInSessions`)

**Qué haría:** pedir a Graph `POST /me/revokeSignInSessions` con un token delegado que tenga `User.RevokeSessions.All`. Si Graph responde 2xx, se podría escribir `revocado_en` porque habría una invalidación real de los refresh tokens del usuario.

**Ventajas**

- Es una revocación real del lado de Microsoft, no una simple desconexión local.
- Es la API recomendada por Microsoft en lugar de `invalidateAllRefreshTokens`.
- La evidencia es objetiva: respuesta 2xx de Graph.

**Riesgos y límites**

- **No aplica a cuentas personales**: la tabla oficial dice “Not supported” para delegated personal Microsoft account. La app usa `common`, así que una parte de los usuarios de Outlook quedaría fuera.
- Requiere `User.RevokeSessions.All`, que exige consentimiento administrativo. Un usuario individual de trabajo/escuela no puede concederlo por sí solo.
- Revoca **todas** las sesiones y refresh tokens del usuario para **todas** las aplicaciones que consintió, no solo los de esta app. Es una acción más amplia que la eliminación de nuestra cuenta y puede afectar otros servicios del usuario.
- La app no pide ese permiso hoy. Habría que volver a consentir; las cuentas ya conectadas no podrían revocar sin un nuevo flujo interactivo.
- Microsoft advierte una demora de unos minutos y que no revoca usuarios externos/B2B en el tenant de recursos.
- Para distinguir cuentas personales de trabajo/escuela haría falta guardar `tid` o el tipo de cuenta en el callback; hoy solo se guarda el correo (`proveedores.py:259-334`). Eso implica diseño y probablemente migración.
- Un 2xx de `revokeSignInSessions` es evidencia de revocación de sesiones, pero no demuestra que el usuario haya retirado el consentimiento de la app; es una operación distinta.

**Evidencia que produciría:** respuesta 2xx de Graph y timestamp; recién entonces `revocado_en`. **No** se usaría para cuentas personales.

**Verificación:** [V] documental; [S] sin llamada real ni prueba de consentimiento administrativo.

**Veredicto:** no es una solución universal. Solo serviría si el producto acepta limitar Outlook a cuentas de trabajo/escuela con consentimiento administrativo, o como rama híbrida para esos casos.

### Opción 2 — Revocar la concesión delegada (`oAuth2PermissionGrants`)

**Qué haría:** localizar el `oAuth2PermissionGrant` de la app y el usuario y borrarlo con `DELETE /oAuth2PermissionGrants/{id}`.

**Ventajas**

- Revoca la concesión para que no se emitan nuevos access tokens con esos permisos.
- La respuesta 204 es verificable.

**Riesgos y límites**

- **No aplica a cuentas personales** (“Not supported”).
- Requiere `DelegatedPermissionGrant.ReadWrite.All` y un rol administrativo (Application Administrator, Cloud Application Administrator, User Administrator, etc.). No es una operación de autoservicio.
- Los access tokens ya emitidos siguen válidos hasta su vencimiento (60-90 minutos típicos). No es una revocación inmediata de todo el acceso.
- Habría que listar y localizar la concesión correcta; la app no tiene hoy ese permiso ni esa lógica.
- Al igual que la opción 1, no cubre cuentas personales y añade una dependencia administrativa fuerte.

**Evidencia que produciría:** 204 de Graph; aun así no probaría que los access tokens vigentes dejaron de servir.

**Verificación:** [V] documental; [S] sin llamada real.

**Veredicto:** no es viable como solución general y tampoco cumple estrictamente la revocación inmediata.

### Opción 3 — Evidencia alternativa explícita, aprobada por el equipo

**Qué haría:** reconocer que Microsoft no ofrece una revocación por token aplicable a cuentas personales y registrar, en un campo **distinto** de `revocado_en`, que:

- las credenciales locales se destruyeron como parte de la eliminación;
- el proveedor no ofrece revocación por token para este caso;
- el usuario debe retirar el acceso desde su cuenta Microsoft.

`revocado_en` seguiría significando **solo** “el proveedor confirmó una revocación”. Nunca se reutilizaría con otro significado.

**Diseño mínimo a decidir (no implementado en esta fase)**

- Un estado explícito, por ejemplo `revocacion_proveedor_estado`, con valores del estilo:
  - `CONFIRMADA` (Gmail o Graph real; permite `revocado_en`);
  - `LIMITACION_PROVEEDOR` (Outlook sin revocación por token; **no** escribe `revocado_en`);
  - `PENDIENTE` (reintentable; conserva credenciales).
- Un timestamp de la evidencia, por ejemplo `evidencia_revocacion_en`, y una versión/código de política, por ejemplo `politica_revocacion = "MX-07-OUTLOOK-1"`.
- El validador aceptaría `LIMITACION_PROVEEDOR` solo para `proveedor=OUTLOOK`, con política aprobada y timestamp no nulo. Gmail conservaría su comportamiento actual.
- Si se necesita que la evidencia sobreviva al borrado de la fila, habría que registrarla además en un log/auditoría fuera de `CuentaConectada`. La fila se borra al completar la limpieza; el timestamp dentro de ella no queda como historial.

**Qué significa “cumplido” con esta opción**

No significa “Microsoft revocó el token”. Significa: “cerramos el acceso local, documentamos que el proveedor no ofrece revocación por token para este caso y le indicamos al usuario cómo retirar el acceso”. Es un cambio de definición y requiere aprobación humana explícita, no solo un cambio de código.

**Ventajas**

- Es la única opción que cubre cuentas personales y de trabajo/escuela sin exigir consentimiento administrativo.
- No requiere pedir permisos nuevos ni depender de una llamada a Graph.
- Permite cerrar la eliminación dentro de 72 horas y deja de producir 409 infinitos.
- Mantiene `revocado_en` honesto y conserva el ciphertext mientras el estado sea pendiente.
- Es compatible con una mejora futura: si más adelante se aprueba Graph, las cuentas de trabajo/escuela podrían usar la opción 1 y escribir `revocado_en`; las personales seguirían en la opción 3.

**Riesgos y límites**

- **No hay revocación real del refresh token.** Si el usuario no retira el acceso desde su cuenta Microsoft, el refresh token puede seguir siendo válido hasta 90 días (o hasta que Microsoft lo revoque por otro motivo). El access token dura 60-90 minutos.
- Traslada al usuario una acción que hoy no se le exige. Hay que decidir si se le informa antes de confirmar la eliminación, si se le exige una confirmación explícita y qué pasa si no la da.
- Cambia el significado de “eliminación completa” y puede requerir revisión legal/privacidad (Ley 21.719, RF-01.7).
- No recupera automáticamente a los usuarios que ya quedaron bloqueados: sus cuentas de Auth ya se borraron y sus organizaciones siguen retenidas. Habría que decidir si se aplica retroactivamente a operaciones pendientes o solo a nuevas solicitudes.
- Si el ciphertext se destruye al borrar la fila, ya no se puede reintentar una revocación real posterior. Eso es aceptable solo si la política se aprueba; no es aceptable mientras el estado sea “pendiente”.
- No debe aplicarse a Gmail ni a otros proveedores sin una decisión equivalente.

**Evidencia que produciría:** estado `LIMITACION_PROVEEDOR`, timestamp, versión de política y, si se exige, acuse del usuario. No produce `revocado_en`.

**Verificación:** la limitación del proveedor está [V] documentada; la política es [P]. No se probó el flujo de aceptación ni la retención del token durante 90 días.

**Veredicto:** es la opción más viable para un producto de autoservicio que acepta cuentas personales, pero solo si Maxi y Felipe aceptan formalmente el riesgo residual y la nueva definición de “cumplido”.

### Opción 4 — No cerrar la organización hasta intervención manual

**Qué haría:** mantener el bloqueo y escalar a una persona para que contacte al usuario o al proveedor, retire el acceso y marque la operación manualmente.

**Ventajas**

- No debilita la exigencia de revocación real.
- No requiere migración ni cambiar el validador.

**Riesgos y límites**

- **Incumple las 72 horas** de RF-01.7 por diseño.
- El usuario y sus datos de Auth ya se borraron; puede no haber forma de contactarlo.
- No escala: cada cuenta Outlook requiere intervención humana.
- Una marca manual no es evidencia verificable salvo que se diseñe un procedimiento y un registro aparte.
- El 409 infinito actual ya es, de hecho, una versión no visible de esta opción.

**Evidencia que produciría:** una marca manual y un registro de la intervención; no una confirmación del proveedor.

**Verificación:** [P]; no requiere verificación de Microsoft.

**Veredicto:** peor opción para el requisito de 72 horas. Solo tendría sentido como contención temporal mientras se decide, y aun así debería dejar de reintentar en silencio y generar una alerta visible.

## 6. Opciones descartadas

| Opción | Por qué se descarta |
| --- | --- |
| `invalidateAllRefreshTokens` | Sigue en beta, Microsoft no la promoverá a GA y recomienda `revokeSignInSessions`. No es apta para producción. |
| `end_session_endpoint` / logout OIDC | Solo cierra la sesión del navegador; no revoca refresh tokens. El metadata de `common` lo publica, pero no es una revocación. |
| Rotar el client secret de la app | Invalida a todos los usuarios y rompe la integración; no es una revocación por usuario. |
| Esperar el vencimiento del refresh token | El valor por defecto es 90 días; incumple 72 horas. |
| Borrar el ciphertext para “desbloquear” | Destruye la única credencial con la que se podría reintentar una revocación real y contradice la regla de conservar credenciales mientras el estado sea pendiente. |
| Escribir `revocado_en` con la fecha de desconexión | Sería una evidencia falsa: `revocado_en` significa confirmación del proveedor. |
| Retirar Connectors de los destinos | Evita el problema en vez de resolverlo y deja datos de Connectors sin limpiar. |

## 7. Recomendación original (propuesta, no aprobada; superada por la decisión 0)

**Nota de implementación:** la fase 2 implementó la opción 3 por decisión del usuario de la sesión, con el visto bueno de Felipe **PENDIENTE**. La condición 7 de esta recomendación —firma de Felipe y Maxi antes de tocar código— **no se cumplió tal como estaba escrita**; queda registrada como ratificación pendiente y no se presenta como aprobada.

**Propuesta:** adoptar la **opción 3**, acotada a Outlook, con un estado explícito distinto de `revocado_en` y una instrucción al usuario para retirar el acceso desde su cuenta Microsoft.

La razón es concreta: las opciones 1 y 2 no cubren cuentas personales y exigen consentimiento/rol administrativo; la opción 4 incumple el plazo. La opción 3 es la única que permite cerrar la eliminación para todos los Outlook sin pedir permisos nuevos, siempre que el equipo acepte que no hay revocación real del refresh token y que el usuario debe actuar.

La propuesta incluye estas condiciones mínimas:

1. `revocado_en` sigue siendo exclusivo de una confirmación real del proveedor. Para Outlook con limitación queda en `NULL`.
2. El validador distingue tres estados: evidencia aceptada, pendiente reintentable y bloqueo permanente por configuración. Un bloqueo permanente no debe ser un 409 silencioso e infinito; debe tener código/log visible.
3. Mientras el estado sea pendiente, el ciphertext se conserva intacto. La destrucción ocurre solo al completar la limpieza, no como atajo para desbloquear.
4. La interfaz de eliminación informa al usuario, antes de confirmar, que debe retirar el acceso de la app desde su cuenta Microsoft; se decide si se exige un acuse explícito.
5. La política se registra con versión y fecha, y se aplica solo a Outlook. Gmail no cambia.
6. Si más adelante se aprueba Graph para trabajo/escuela, esa rama puede escribir `revocado_en`; las cuentas personales conservan la evidencia de limitación.
7. La decisión queda por escrito y firmada por Felipe y Maxi antes de tocar código de producción.

**Advertencia:** esta recomendación **no** debe interpretarse como aprobada. Si Maxi o Felipe consideran inaceptable el riesgo de que el refresh token siga vivo hasta 90 días, la opción 3 no sirve y habría que elegir entre limitar el producto a cuentas de trabajo/escuela con consentimiento administrativo (opción 1), aceptar la intervención manual (opción 4) o mantener la PR bloqueada.

## 8. Preguntas concretas para la decisión

### Para Felipe Orellana (Connectors / FE-05)

1. ¿Acepta que exista un estado distinto de `revocado_en` para “el proveedor no ofrece revocación por token”, sin reutilizar ese campo?
2. ¿Qué nombre y qué estados propone para el campo? ¿`LIMITACION_PROVEEDOR` es suficiente o prefiere separar “credenciales destruidas localmente” de “revocación no disponible”?
3. ¿La limitación se aplica a **todo** Outlook o solo a cuentas personales? Si es solo a personales, ¿acepta guardar `tid`/tipo de cuenta en el callback y hacer una migración nueva?
4. ¿Debe la evidencia sobrevivir al borrado de `CuentaConectada` en un log/auditoría? ¿Dónde y por cuánto tiempo?
5. ¿Cómo interactúa el nuevo estado con `credenciales_version`, una reconexión y el comando `reintentar_revocaciones`?
6. ¿Acepta que Gmail conserve exactamente su comportamiento actual y que el nuevo estado sea exclusivo de Outlook?
7. ¿Qué prueba de aceptación considera suficiente para demostrar que un fallo no destruye credenciales y que un reintento con evidencia termina en 204?

### Para Maximiliano Sáez (producto / PR #72)

1. ¿Acepta que, para Outlook, “eliminación completa” signifique cierre local + limitación documentada + instrucción al usuario, en vez de revocación confirmada por Microsoft?
2. ¿Acepta el riesgo residual de que el refresh token pueda seguir válido hasta 90 días si el usuario no retira el acceso?
3. ¿La pantalla de eliminación debe exigir un acuse explícito del usuario antes de confirmar? ¿Eso cambia el alcance de UX de esta PR?
4. ¿La política se aplica solo a nuevas solicitudes o también a las operaciones que ya están bloqueadas con usuarios ya borrados?
5. ¿Se necesita revisión legal/privacidad por Ley 21.719 y por el texto de RF-01.7 antes de implementar?
6. Si no se aprueba la opción 3, ¿la PR queda en draft y se documenta que MX-07 no puede cumplir 72 horas para Outlook, o se elige la opción 1/4?
7. ¿Quién firma la decisión y con qué fecha, para poder citarla en el informe y en el flujo `07-eliminar-cuenta.md`?

## 9. Prueba de aceptación que debía cumplir la opción elegida

La fase 1 no la implementó. La fase 2 implementó las pruebas de `services/connectors/tests/test_eliminacion.py`; las condiciones 1 y 2 de esta lista describían el comportamiento anterior de Outlook y quedaron reemplazadas por la decisión de la sección 0: Outlook ya no devuelve 409 por sí solo. Se conserva la lista como registro de lo que se esperaba antes de decidir.

1. **Fallo inicial:** organización con Outlook; el primer `DELETE` interno devuelve 409, `revocado_en` sigue `NULL`, el ciphertext sigue intacto, la cuenta sigue en estado conectado y la organización no queda marcada como eliminada.
2. **Reintento sin evidencia:** un segundo `DELETE` vuelve a devolver 409; no se borra nada y no se escribe evidencia falsa.
3. **Evidencia aceptada:**
   - opción 1: Graph responde 2xx y se escribe `revocado_en`;
   - opción 3: se registra el estado de limitación con timestamp y versión de política, sin escribir `revocado_en`.
4. **Cierre:** el siguiente `DELETE` devuelve 204, la cuenta y sus datos se borran, y la organización queda eliminada.
5. **Repetibilidad:** un `DELETE` posterior vuelve a devolver 204 sin volver a llamar al proveedor ni duplicar evidencia.
6. **Gmail conviviendo con Outlook:** Gmail confirmado no se vuelve a revocar; el resultado final depende de que Outlook tenga evidencia aceptada. Se verifica el número de llamadas al proveedor.
7. **Aislamiento:** una organización B no se ve afectada por la limpieza de A.
8. **Credenciales ilegibles:** se conserva el ciphertext y no se llama al proveedor, igual que hoy.

## 10. Impacto técnico si se aprueba (solo orientativo)

- Si se agrega un campo, crear una **migración nueva**; no editar `connectors.0003_autorizacion_y_revocacion`, que ya está publicada en `main`.
- El validador de `LimpiezaConnectorsView` debe distinguir aceptado, pendiente y bloqueo permanente, y no convertir una limitación conocida en un 409 infinito sin visibilidad.
- La preparación durable debe conservar la evidencia aunque otra cuenta bloquee la limpieza, y la validación final debe reverificarla bajo bloqueo.
- El nuevo estado no debe tocar cuentas de otra organización ni alterar el camino de Gmail.
- Si se elige la opción 1, además hay que resolver el consentimiento de `User.RevokeSessions.All`, el nuevo scope y la identificación de cuentas personales vs. trabajo/escuela.

## 11. Fuentes consultadas

- Microsoft Learn, [user: revokeSignInSessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0&tabs=http), actualizado 2025-07-23.
- Microsoft Learn, [Delete oAuth2PermissionGrant](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete?view=graph-rest-1.0&tabs=http), actualizado 2025-07-23.
- Microsoft Learn, [Microsoft Graph permissions reference — User.RevokeSessions.All](https://learn.microsoft.com/en-us/graph/permissions-reference?view=graph-rest-1.0#userrevokesessionsall), actualizado 2026-09-15.
- Microsoft Learn, [Refresh tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens), actualizado 2026-06-15.
- Microsoft Learn, [Access tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens), actualizado 2026-07-17.
- Microsoft Learn, [user: invalidateAllRefreshTokens (beta)](https://learn.microsoft.com/en-us/graph/api/user-invalidateallrefreshtokens?view=graph-rest-beta&tabs=http).
- Metadata OIDC de Microsoft, `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`, consultado 2026-10-29: no incluye `revocation_endpoint`.
- Página de cuenta de Microsoft para revisar acceso de aplicaciones: `https://account.microsoft.com/privacy/app-access`, consultada 2026-10-29. Es una página de usuario; no se verificó su contenido con una sesión real ni se usó como API.
