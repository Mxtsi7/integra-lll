"""Genera tipos de componentes OpenAPI JSON de Auth sin dependencias externas.

Uso: python scripts/generar-tipos-auth.py [--check]
El snapshot se exporta antes con manage.py spectacular --format openapi-json.
"""
import argparse
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def tipo(schema):
    if not schema:
        return "unknown"
    if "$ref" in schema:
        valor = f"AuthSchemas[{json.dumps(schema['$ref'].rsplit('/', 1)[-1])}]"
    elif "enum" in schema:
        valor = " | ".join(json.dumps(v, ensure_ascii=False) for v in schema["enum"])
    elif any(k in schema for k in ("oneOf", "anyOf", "allOf")):
        clave = next(k for k in ("oneOf", "anyOf", "allOf") if k in schema)
        operador = " & " if clave == "allOf" else " | "
        valor = "(" + operador.join(tipo(s) for s in schema[clave]) + ")"
    elif schema.get("type") == "array":
        valor = f"Array<{tipo(schema.get('items', {}))}>"
    elif schema.get("type") == "object" or "properties" in schema:
        obligatorios = schema.get("required", [])
        campos = [f"{json.dumps(k)}{'' if k in obligatorios else '?'}: {tipo(v)};"
                  for k, v in schema.get("properties", {}).items()]
        adicional = schema.get("additionalProperties", False)
        if adicional:
            # unknown permite las propiedades declaradas junto al índice.
            campos.append("[key: string]: unknown;")
        valor = "{ " + " ".join(campos) + " }" if campos else "Record<string, unknown>"
    else:
        valor = {"string": "string", "integer": "number", "number": "number",
                 "boolean": "boolean", "null": "null"}.get(schema.get("type"), "unknown")
    return f"({valor}) | null" if schema.get("nullable") and valor != "null" else valor


def generar():
    esquema = json.loads((RAIZ / "docs/api/auth.openapi.json").read_text(encoding="utf-8"))
    lineas = ["// Generado por scripts/generar-tipos-auth.py; no editar a mano.",
              "// Fuente: docs/api/auth.openapi.json (MX-14).", "export interface AuthSchemas {"]
    for nombre, schema in sorted(esquema["components"]["schemas"].items()):
        lineas.append(f"  {json.dumps(nombre)}: {tipo(schema)};")
    return "\n".join(lineas + ["}", ""])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    destino = RAIZ / "frontend/shared/src/contratos/auth.generated.ts"
    contenido = generar()
    if args.check:
        if not destino.exists() or destino.read_text(encoding="utf-8") != contenido:
            raise SystemExit("Tipos Auth desactualizados. Ejecutar scripts/generar-tipos-auth.py")
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(contenido, encoding="utf-8", newline="\n")
