// Generado por scripts/generar-tipos-auth.py; no editar a mano.
// Fuente: docs/api/auth.openapi.json (MX-14).
export interface AuthSchemas {
  "CambioClaveConfirmado": { "detail": string; };
  "CambioClaveRequest": { "password_actual": string; "password": string; "password_confirmacion": string; };
  "CambioPerfilRequest": { "nombre": string; };
  "CodeEnum": "token_invalido" | "token_expirado" | "token_usado";
  "CodigoPlanCatalogoEnum": "free" | "premium";
  "CodigoPlanEnum": "free" | "premium";
  "ConfirmacionEliminacionEnum": "ELIMINAR";
  "ConfirmacionRecuperacionRequest": { "token": string; "password": string; };
  "ConfirmacionVerificacionRequest": { "token": string; };
  "Contratacion": { "id": string; "estado": (AuthSchemas["ContratacionEstadoEnum"]); "plan_id": (AuthSchemas["CodigoPlanCatalogoEnum"]); "importe": string; "moneda": string; "precio_demo": boolean; "vigente_desde": (string) | null; "vigente_hasta": (string) | null; "url_checkout": string; "url_retorno": string; "permisos": (AuthSchemas["PermisosPlan"]); };
  "ContratacionEstadoEnum": "pendiente" | "exitosa" | "cancelada" | "fallida";
  "EliminacionAceptada": { "operacion_id": string; "estado": AuthSchemas["EliminacionAceptadaEstadoEnum"]; };
  "EliminacionAceptadaEstadoEnum": "pendiente";
  "EliminarCuentaRequest": { "password": string; "confirmacion": AuthSchemas["ConfirmacionEliminacionEnum"]; "confirmacion_organizacion"?: (AuthSchemas["ConfirmacionEliminacionEnum"]); };
  "ErrorConfirmacionRecuperacion": (AuthSchemas["ErrorRecuperacion"] | AuthSchemas["ErrorPasswordRecuperacion"]);
  "ErrorPasswordRecuperacion": { "password": Array<string>; };
  "ErrorRecuperacion": { "code": AuthSchemas["CodeEnum"]; "detail": string; "solicitar_nuevo_enlace": string; };
  "EventoPagoEstadoEnum": "exitosa" | "cancelada" | "fallida";
  "EventoPagoRequest": { "evento_id": string; "contratacion_id": string; "organizacion_id": string; "estado": AuthSchemas["EventoPagoEstadoEnum"]; "importe": string; "moneda": string; };
  "GoogleRequest": { "id_token": string; "nonce": string; "password"?: string; };
  "LoginRequest": { "email": string; "password": string; };
  "LoginRespuesta": { "access_token": string; "refresh_token": string; "usuario": AuthSchemas["UsuarioLogin"]; };
  "MensajeAuth": { "detail": string; };
  "MiRolEnum": "titular" | "integrante";
  "Miembro": { "id": number; "nombre": string; "correo": string; "rol": ((AuthSchemas["RolEnum"] | AuthSchemas["NullEnum"])) | null; };
  "Nonce": { "nonce": string; "client_id": string; "vence_en_segundos": number; };
  "NullEnum": null;
  "Opcion": { "codigo": string; "nombre": string; "activo": boolean; "orden": number; };
  "OrganizacionDetalle": { "id": string; "nombre": string; "miembros": Array<AuthSchemas["Miembro"]>; "mi_rol": (AuthSchemas["MiRolEnum"]); };
  "PeriodoEnum": "mensual";
  "PermisosPlan": { "plan": AuthSchemas["CodigoPlanEnum"]; "features": { [key: string]: unknown; }; };
  "Plan": { "codigo": (AuthSchemas["CodigoPlanCatalogoEnum"]); "nombre": string; "precio": string; "moneda": string; "periodo": (AuthSchemas["PeriodoEnum"]); "precio_demo": boolean; "features": { [key: string]: unknown; }; };
  "PlanCodigoEnum": "premium";
  "RefreshRequest": { "refresh_token": string; };
  "RegisterRequest": { "email": string; "nombre": string; "password": string; "acepta_datos": boolean; "codigo_organizacion"?: (string) | null; };
  "RolEnum": "titular" | "integrante";
  "SolicitudContratacionRequest": { "plan_codigo": AuthSchemas["PlanCodigoEnum"]; "clave_idempotencia": string; };
  "SolicitudRecuperacionRequest": { "email": string; };
  "SolicitudVerificacionRequest": { "email"?: string; "password"?: string; };
  "Tokens": { "access_token": string; "refresh_token": string; };
  "User": { "id": number; "email": string; "nombre": string; };
  "UsuarioActual": { "id": number; "nombre": string; "correo": string; "rol": ((AuthSchemas["RolEnum"] | AuthSchemas["NullEnum"])) | null; "organizacion_id": (string) | null; "plan": (AuthSchemas["CodigoPlanEnum"]); };
  "UsuarioLogin": { "id": number; "nombre": string; "correo": string; };
}
