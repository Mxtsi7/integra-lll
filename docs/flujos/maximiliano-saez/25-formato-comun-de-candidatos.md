# S3-MX-25 — Contrato y ejemplos compatibles

La entrega formaliza el formato ya implementado por Felipe en PR #147.
El [contrato v1](../../contratos/candidatos-v1.md) enlaza conceptualmente las
tres fronteras existentes: candidato interno, consulta HTTP y orden confirmada.
El esquema y los ejemplos viven junto al documento; no hay productor nuevo.

Flujo comprobado: fixture CSV sintética → `csv_candidatos.leer()` →
`Candidato.como_json()` → esquema común. Un correo sintético atraviesa el mismo
dataclass/esquema. Ambos pasan por `CobroCandidato.desde_candidato()` y el
serializer HTTP en memoria. No se consulta ni escribe una base de datos.

`services/connectors/tests/test_contrato_candidatos_v1.py` comprueba esa
compatibilidad y rechaza, entre otros casos, importes de cero o negativos.
`jsonschema[format]==4.26.0` queda declarado en las dependencias de CI.

La PR apunta a `main` e incluye el parser de #147 y la procedencia CSV de #171.
El consumidor trata las identidades CSV y correo como valores opacos. Quedan
pendientes la aceptación de los responsables y la validación de la extracción
con una cuenta autorizada, además de la publicación y consumo de eventos.
