# PR: SE_28 — Registrar minutos de uso desde móvil

**Rama:** `SE-28-30`  
**Base:** `main`  
**Responsable:** Sebastian Mena  
**Tarjeta cubierta:** `SE-28`: Registrar minutos de uso desde móvil (P1 / Should)  
**Estado:** LISTO PARA REVISIÓN / MERGE  

---

## 1. Resumen de Cambios

### SE-28: Registrar minutos de uso desde móvil
- **Componente Accesible de Formulario de Uso ([`RegistrarUsoFormMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoFormMovil.tsx)):**
  - Input para minutos de uso (`input-minutos`, `inputMode="numeric"`, `keyboardType="numeric"`).
  - Input para fecha acordada (`input-fecha`, valor predeterminado `hoyEnTexto()`, formato `AAAA-MM-DD`). Si se envía vacía o en blanco, omite la propiedad en el cuerpo para que el backend aplique hoy por defecto sin error de formato.
  - Validación local estricta con [`validarUso`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/validacionesSuscripcion.ts) de `@ojoalgasto/shared`: rechaza minutos vacíos, cero, negativos, decimales, mayores a 44.640, fechas inexistentes o fechas futuras.
  - Bloqueo de doble envío mediante `useRef` de envío activo y estado de carga (`guardando`, `aria-disabled="true"`).
  - Notificación de confirmación accesible con rol `status` que distingue si el registro suma a las horas del mes actual o si pertenece a un mes anterior (VI-10).
  - Manejo de errores por campo del backend (`erroresDesdeServidor`) y alertas accesibles ante caídas de conexión o 500.

- **Modal Accesible de Registro ([`RegistrarUsoModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoModal.tsx)):**
  - Diálogo modal con overlay y diseño consistente con [`ConfirmarRetiroModal`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/ConfirmarRetiroModal.tsx).
  - Encabezado con el nombre de la suscripción y botón para cancelar sin interrumpir operaciones en curso.

- **Integración con Pantalla de Detalle Móvil ([`SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)):**
  - Conexión del botón `btn-registrar-uso` en la sección `seccion-historial-uso`.
  - Inyección de `onRegistrarUsoApi` (por defecto [`registrarUso`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/shared/src/api/suscripciones.ts)).
  - **Criterio 1:** Al completar el registro con éxito, actualiza reactivamente el estado de la suscripción, recalculando inmediatamente `horas_uso_mes` y el costo por hora estimado en la vista de detalle.
  - **Criterio 2:** En caso de entrada inválida o error en el servidor, no altera las métricas previas y nunca presenta la operación como guardada.

---

## 2. Criterios de Aceptación Verificados

- [x] **Criterio 1 — Registro positivo actualiza métricas:**
  - El registro positivo de minutos envía `POST /suscripciones/<id>/uso/` y la respuesta con `horas_uso_mes` actualizada se refleja de inmediato en los indicadores de la pantalla de detalle.
- [x] **Criterio 2 — Cero/negativo/error no se presenta como guardado:**
  - Minutos en 0, negativos o decimales son bloqueados en cliente con mensajes de error accesibles (`error-minutos`).
  - Fechas inexistentes o futuras son bloqueadas en cliente (`error-fecha`).
  - Fallos de red o errores del backend muestran su alerta correspondiente sin confirmar guardado ni modificar métricas previas.
- [x] **Bloqueo de doble envío:**
  - Múltiples pulsaciones rápidas mientras la solicitud está en vuelo no duplican peticiones.
- [x] **Contrato validado:**
  - Documentado en [`CONTRATO_REGISTRAR_USO_SE28.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_REGISTRAR_USO_SE28.md).

---

## 3. Pruebas y Evidencia de Verificación

Comandos ejecutados exitosamente:

```bash
# 1. Pruebas de Registrar Uso móvil (12/12 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/RegistrarUso.test.tsx

# 2. Pruebas de Detalle de Suscripción (27/27 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil -- src/screens/home/SuscripcionDetalleScreen.test.tsx

# 3. Suite completa del workspace móvil (24 archivos, 461/461 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=movil

# 4. Suite completa de shared (19 archivos, 278/278 aprobadas)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm test --workspace=@ojoalgasto/shared

# 5. Typecheck TypeScript estricto en todos los workspaces (0 errores)
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && npm run typecheck
```

---

## 4. Archivos Modificados y Creados

- [`frontend/movil/src/screens/home/RegistrarUsoFormMovil.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoFormMovil.tsx)
- [`frontend/movil/src/screens/home/RegistrarUsoModal.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUsoModal.tsx)
- [`frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionDetalleScreen.tsx)
- [`frontend/movil/src/screens/home/RegistrarUso.test.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/RegistrarUso.test.tsx)
- [`frontend/movil/docs/CONTRATO_REGISTRAR_USO_SE28.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/CONTRATO_REGISTRAR_USO_SE28.md)
- [`frontend/movil/docs/PR_SPRINT3_SE28.md`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/docs/PR_SPRINT3_SE28.md)

---

## 5. Mensaje de Commit Propuesto

```text
feat(movil): registrar minutos de uso desde detalle de suscripcion (SE-28)

- Crear componente accesible RegistrarUsoFormMovil con inputs numerico y de fecha, validaciones locales de negocio y bloqueo de doble envio.
- Crear RegistrarUsoModal para apertura accesible desde SuscripcionDetalleScreen.
- Conectar onRegistrarUso y actualizar reactivamente las metricas de horas de uso y costo por hora tras registro exitoso (Criterio 1).
- Garantizar que ceros, negativos, fechas invalidas o errores del backend no se confirmen como guardados (Criterio 2).
- Agregar suite de 12 pruebas unitarias y de integracion en RegistrarUso.test.tsx.
- Formalizar contrato de integracion en CONTRATO_REGISTRAR_USO_SE28.md.
```
