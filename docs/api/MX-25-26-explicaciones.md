# MX-25 / MX-26: explicación de recomendaciones

Tarjetas: https://trello.com/c/LWr1b2G7 y https://trello.com/c/IQOxqtLx

`GET /api/recomendaciones/{uuid}/explicar/` a través del Gateway exige una
sesión válida y la feature `recomendaciones_automaticas`. No recibe tenant ni
evidencia del cliente: usa el contexto autenticado y el hallazgo persistido.
No existe/otro tenant/UUID inválido/descarte vigente/estado no vigente/ahorro
inferior al umbral o moneda sin umbral devuelven el mismo 404.

La respuesta 200 incluye `explicacion`, `fuente: reglas`, `estado`, `motivo`,
`ahorro_estimado` numérico, `moneda`, `base_calculo`, `evidencia`, `id` y
`suscripcion_id`. Los importes son los almacenados: no vuelve a calcular ni suma
monedas. El ahorro es estimado y se indica como tal. Si faltan motivo, base o
evidencia, `estado: datos_insuficientes` conserva un texto honesto y devuelve
`ahorro_estimado`, `motivo`, `base_calculo` y `evidencia` nulos.

`uso: no_evaluado` y `advertencia_uso` distinguen solapamiento de bajo uso. No se
deduce actividad de la ausencia de registros ni se inventa un puntaje. Las
reglas de FE-29 siguen diferenciando alto/bajo/sin datos/cero acreditado en su
propia API. El cliente compartido exporta `explicarRecomendacion` y su tipo para
web/móvil; la integración visual corresponde a CH-22/AN-21.

Esta entrega usa una explicación determinista y no llama a proveedores. No
envía contexto ni depende de la sanitización VI-23 del PR #122. Una extensión
futura con IA debe recibir ese contrato y usar `PoliticaIA` (3,5 s, 200 llamadas
mensuales por usuario). No hay proveedor configurado ni se afirma integración
IA real. Una caída externa, timeout o cuota no bloquea este endpoint porque
no utiliza esos recursos.

Verificación desde `services/analytics`:

```sh
pytest analytics/test_explicaciones.py analytics/test_recommendation_api.py tests/test_uso.py tests/test_politica_ia.py
```

Las pruebas cubren aislamiento, umbrales por moneda y límites exactos, descartes,
datos faltantes, respuesta estable sin uso y ausencia de llamadas externas.
La suite existente de política comprueba timeout, caída y cuota; FE-29 comprueba
fixtures alto/bajo/ausente. No se envían correos, pagos ni peticiones IA reales.
