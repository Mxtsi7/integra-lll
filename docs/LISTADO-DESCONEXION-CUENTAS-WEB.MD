#### `docs/tareas/AN-17-listado-desconexion-cuentas-web.md`

```markdown

## Qué hace esta tarea
Conecta la página `/cuentas` con el backend real de `connectors` para listar todas las cuentas conectadas de la organización (recorriendo todas las páginas), permitir reautorizar cuentas vencidas y desconectar cuentas con confirmación previa.

## Archivos creados y modificados

| Archivo | Qué hace |
| :--- | :--- |
| `frontend/shared/src/api/cuentas.ts` | Reutiliza `getCuentasConectadas()` (recorre `GET /api/conectores/?page=N&page_size=100` hasta que `next` sea `null`) y `desconectarCuenta(id)` (`DELETE /api/conectores/{id}/`, que devuelve la cuenta actualizada con estado `desconectada`). |
| `frontend/web/src/components/Cuentas/ListaCuentas.tsx` | Muestra cada cuenta con proveedor, correo, última revisión, insignia de estado y los botones **Volver a autorizar** (cuando `necesita_reautorizacion` es `true`) y **Desconectar** (cuando no está desconectada). |
| `frontend/web/src/pages/CuentasConectadasPage.tsx` | Maneja la carga del listado, el modal de confirmación de desconexión (`<Modal tipo="alerta">`), el bloqueo contra doble clic y la protección contra respuestas tardías (`revocadasRef`) para que una respuesta vieja nunca reviva una cuenta ya revocada. |
| `frontend/web/src/components/Cuentas/Cuentas.module.css` | Estilos de alineación de botones en cada fila y pie del modal de confirmación. |
| `frontend/web/src/App.tsx` | Pasa a `<CuentasConectadasPage />` las funciones reales `getCuentasConectadas`, `ConectarCorreo`, `desconectarCuenta` e `iniciarFlujoCorreo`. |
| `frontend/web/src/pages/CuentasConectadasPage.test.tsx` | Pruebas de listado paginado, estados, manejo de errores, confirmación de desconexión con `DELETE` único y flujo de reautorización. |

## Flujo paso a paso (para explicar en defensa)
1. **Listado completo:** Al abrir `/cuentas`, `getCuentasConectadas()` consulta `GET /api/conectores/` página por página (`page_size=100`) y entrega un arreglo plano de `CuentaConectada[]`.
2. **Desconexión segura:** Al pulsar **Desconectar**, se abre un modal advirtiendo que dejarán de leerse correos nuevos pero se conservará el historial importado.
3. Al confirmar, se ejecuta `DELETE /api/conectores/{id}/` una sola vez. El backend revoca tokens en el proveedor y responde HTTP 200 con la cuenta en estado `desconectada` (sin borrar el registro histórico).
4. La cuenta se actualiza en pantalla y se registra en `revocadasRef` para evitar que una respuesta tardía de red sobreescriba su estado revocado.
5. **Reautorización:** Si una cuenta venció (`necesita_reautorizacion`), el botón **Volver a autorizar** reutiliza el mismo flujo OAuth de `AN-15` y `AN-16`.

## Cómo probarlo
```bash
cd frontend/web && npx vitest run src/pages/CuentasConectadasPage.test.tsx
