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
compatibilidad y rechaza ocho variantes incompatibles. `jsonschema==4.26.0`
queda declarado en las dependencias usadas por la CI existente.

La rama depende de #147; #171 puede cambiar la identidad CSV sin obligar al
consumidor a interpretarla. Faltan aceptación de responsables y validación
contra cuenta real autorizada; este trabajo no acredita extracción de correo,
publicación ni consumo de eventos. El contrato enumera esas fronteras.
