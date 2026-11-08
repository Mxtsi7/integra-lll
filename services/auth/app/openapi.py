"""Describe el acceso externo por Gateway; no cambia la autorización en runtime."""
from copy import deepcopy

from drf_spectacular.openapi import AutoSchema


class EsquemaEliminarCuenta(AutoSchema):
    """drf-spectacular 0.28 omite DELETE aunque se anote su request serializer."""

    def _get_request_body(self, direction="request"):
        if self.method != "DELETE":
            return super()._get_request_body(direction)
        componente = self.resolve_serializer(self.get_request_serializer(), direction)
        return {
            "required": True,
            "content": {tipo: {"schema": componente.ref} for tipo in self.map_parsers()},
        }


# Coincidencias exactas del Gateway. Las pruebas verifican que no se desvíen.
RUTAS_PUBLICAS = {
    "/api/pagos/webhook/", "/api/pagos/mock/",
    "/api/auth/register/", "/api/auth/login/", "/api/auth/refresh/",
    "/api/auth/password-reset/", "/api/auth/password-reset/confirm/",
    "/api/auth/email-verification/confirm/", "/api/auth/google/nonce/",
    "/api/auth/google/", "/api/auth/logout/",
}

ERROR = {
    "type": "object",
    "description": "Error DRF por campo, mensaje detail o código de negocio. Las propiedades dependen del caso.",
    "properties": {"detail": {"type": "string"}, "code": {"type": "string"}},
    "additionalProperties": {"oneOf": [
        {"type": "string"}, {"type": "array", "items": {"type": "string"}},
    ]},
}


def completar_contrato_gateway(result, generator, request, public):
    result.setdefault("components", {}).setdefault("securitySchemes", {})["GatewayBearer"] = {
        "type": "http", "scheme": "bearer", "bearerFormat": "JWT",
        "description": "Access token validado y revocado por Gateway. El cliente no envía cabeceras internas X-Usuario-Id/X-Organizacion-Id/X-Rol.",
    }
    for ruta, operaciones in result["paths"].items():
        if not ruta.startswith("/api/") or ruta == "/api/schema/":
            continue
        for metodo, operacion in operaciones.items():
            if metodo not in {"get", "post", "patch", "put", "delete", "head", "options"}:
                continue
            protegida = ruta not in RUTAS_PUBLICAS
            operacion["security"] = [{"GatewayBearer": []}] if protegida else []
            operacion["parameters"] = [p for p in operacion.get("parameters", []) if not (
                p.get("in") == "header" and p.get("name", "").lower() in {
                    "x-usuario-id", "x-organizacion-id", "x-rol",
                }
            )]
            respuestas = operacion.setdefault("responses", {})
            if protegida:
                respuestas.setdefault("401", {"description": "Gateway: access ausente, vencido o revocado."})
                respuestas.setdefault("503", {"description": "Gateway: no se pudo comprobar la sesión o contactar Auth."})
            for codigo, respuesta in respuestas.items():
                if codigo.isdigit() and int(codigo) >= 400 and "content" not in respuesta:
                    respuesta["content"] = {"application/json": {"schema": deepcopy(ERROR)}}
    return result
