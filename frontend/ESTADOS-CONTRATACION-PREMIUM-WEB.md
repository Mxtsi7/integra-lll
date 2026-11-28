# Estados de Contratación Premium en Web (S2-SE-03)

## 1. Identificación y Responsable
- **Código de tarea:** S2-SE-03
- **Título:** Implementar estados de contratación Premium en web
- **Responsable:** Sebastian Mena
- **Sprint:** 2
- **Prioridad:** P1 / Could
- **Estado:** Implementado, corregido y verificado

---

## 2. Alcance Concreto y Objetivos
1. Conectar los botones "Mejorar a Premium" de **Perfil** (`PerfilPage`) y **Ajustes** (`ConfiguracionPage` / `PlanPremium`) al flujo unificado de contratación demo/mock.
2. Manejo estricto de **clave de idempotencia (UUID v4)** persistida por usuario y organización (`localStorage`), garantizando que reintentos o respuestas perdidas no generen cobros ni contrataciones duplicadas.
3. Exposición de interfaz para todos los estados del ciclo de vida:
   - **Inicial / Disponible:** Permite iniciar contratación a usuarios titulares de la organización con aviso de precio demo.
   - **Pendiente:** Ofrece "Continuar al pago", "Verificar estado" y "Cancelar contratación".
   - **Exitosa:** Reconocimiento de pago confirmado en espera de sincronización de permisos por el servidor.
   - **Cancelada:** Confirmación de que no se realizó ningún cobro y posibilidad de reintentar.
   - **Fallida:** Explicación del fallo sin cobro y opción de reintento.
4. **Reconciliación segura al volver (`/planes/retorno`):**
   - Limpieza inmediata de los parámetros de la URL (`contratacion_id`).
   - Una URL manipulada (ej. indicar éxito en query string) **nunca** concede Premium en el cliente; el plan se activa única y exclusivamente cuando `GET /api/usuarios/me/permisos/` confirma `plan: "premium"`.
5. **Identificación explícita de precios y checkout demo:** Se aclara de manera visible que se trata de una demostración y que no se ejecuta ningún cobro comercial real.

---

## 3. Endpoints y Contratos de Integración

Reutilizados desde `frontend/shared/src/api/planes.ts`:

### `GET /api/planes/` (`getPlanes`)
Obtiene la lista de planes disponibles y su bandera de demostración:
```json
[
  {
    "codigo": "premium",
    "nombre": "Plan Premium",
    "precio": "4990.00",
    "moneda": "CLP",
    "periodo": "mensual",
    "precio_demo": true,
    "features": {
      "asistente_financiero": true,
      "recomendaciones_automaticas": true
    }
  }
]
```

### `POST /api/contrataciones/` (`iniciarContratacion`)
Inicia una contratación enviando la clave de idempotencia:
```json
// Body:
{
  "plan_codigo": "premium",
  "clave_idempotencia": "c56a4180-65aa-42ec-a945-5fd21dec0538"
}
```
Respuesta:
```json
{
  "id": "c-123",
  "estado": "pendiente",
  "plan_id": "premium",
  "importe": "4990.00",
  "moneda": "CLP",
  "precio_demo": true,
  "vigente_desde": null,
  "vigente_hasta": null,
  "url_checkout": "https://pagos.ejemplo.cl/api/pagos/mock/?token=xyz",
  "url_retorno": "https://app.ejemplo.cl/planes/retorno?contratacion_id=c-123",
  "permisos": { "plan": "free", "features": { ... } }
}
```

### `GET /api/contrataciones/{id}/` (`getContratacion`)
Consulta el estado de una contratación existente.

### `POST /api/contrataciones/{id}/cancelar/` (`cancelarContratacion`)
Cancela una contratación pendiente.

### `GET /api/usuarios/me/permisos/` (`getPermisosPlan`)
Reconciliación definitiva del plan y features vigentes.

---

## 4. Arquitectura y Componentes en Web

1. **`useContratacionPremium` (`web/src/hooks/useContratacionPremium.ts`)**:
   - Coordina la máquina de estados de contratación.
   - Candado contra doble clic (`enCurso.current`).
   - Almacenamiento seguro por alcance `usuario.id:usuario.organizacion_id` (`crearAlmacenIntento`).
   - Validación estricta de protocolo en URLs de checkout (`esUrlCheckoutValida`).
   - Aislamiento de sesión: descarta respuestas si la sesión activa cambia mientras se espera a la pasarela.

2. **`usePlanPremium` (`web/src/hooks/usePlanPremium.ts`)**:
   - Conecta `usePermisosPlan` con `useContratacionPremium`.
   - Expone estado, contratación, indicador `esGratuitoConfirmado` y aviso de activación en vuelo (`avisoActivacion`).
   - **Corrección aplicada:** Se ajustó la guarda de sincronización a `if (estado.tipo !== 'listo' || !usuario) return;` para evitar errores de tipo ante usuarios no autenticados o durante hidratación.

3. **`AccionesPremium` (`web/src/components/Planes/AccionesPremium.tsx`)**:
   - Renderiza los botones y mensajes para cada estado (`pendiente`, `exitosa`, `cancelada`, `fallida`).
   - Control de rol: solo el titular de la organización puede contratar.
   - Muestra aviso de precio demo: *"Precio de demostración: no se hace ningún cobro real."*.

4. **`PlanesRetornoPage` (`web/src/pages/PlanesRetornoPage.tsx`)**:
   - Página de retorno tras la pasarela de pago (`/planes/retorno`).
   - Limpia de inmediato los query params.
   - Consulta simultáneamente `getContratacion` y `getPermisosPlan`.
   - Si el retorno es manipulado o no existe, muestra estado de error / no encontrada; no concede Premium sin confirmación de permisos.

5. **`PerfilPage` y `ConfiguracionPage`**:
   - Ambos puntos de entrada consumen la misma arquitectura, garantizando paridad funcional.

---

## 5. Resumen de Pruebas y Evidencia

| Suite de Pruebas | Archivo | Casos | Estado |
| :--- | :--- | :---: | :---: |
| Almacén de intento e idempotencia | `web/src/components/Planes/almacenIntentoContratacion.test.ts` | 4 | Aprobado |
| Reglas de validación y checkout | `web/src/components/Planes/reglasContratacion.test.ts` | 9 | Aprobado |
| UI PlanPremium en Ajustes | `web/src/components/Planes/PlanPremium.test.tsx` | 10 | Aprobado |
| Máquina de estados de contratación | `web/src/hooks/useContratacionPremium.test.tsx` | 26 | Aprobado |
| Retorno y reconciliación de pago | `web/src/pages/PlanesRetornoPage.test.tsx` | 5 | Aprobado |
| Plan en Ajustes | `web/src/pages/ConfiguracionPage.plan.test.tsx` | 4 | Aprobado |
| Plan en Perfil (SE-03) | `web/src/pages/PerfilPage.test.tsx` | 24 | Aprobado |
| **Total suite contratación** | | **82** | **100% Aprobado** |
