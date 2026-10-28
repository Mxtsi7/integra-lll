# VI-21 — Decisión sobre RN-REC-001: umbral de ahorro por moneda

- **Estado:** decidido e implementado en Analytics (VI-17/VI-21).
- **Fecha:** 2026-10-28.
- **Alcance:** regla que decide qué recomendaciones de ahorro se listan.
- **Servicio responsable:** Analytics, que genera y expone las recomendaciones.

## Contexto

VI-17 lista las recomendaciones de consolidación que produce VI-20. RN-REC-001
pide no sugerir ahorros menores a un umbral configurable. La implementación
anterior en Subscriptions resolvía el caso sin configuración con
`UMBRAL_AHORRO_DEFAULT = Decimal("0.01")`, lo que en la práctica desactivaba el
filtro: cualquier ahorro positivo pasaba.

La revisión de la PR #105 lo marcó como bloqueante: sin configuración válida no
se debe inventar un umbral monetario. VI-21 es, además, una tarjeta de estudio:
la decisión y sus alternativas deben quedar por escrito.

## Valor vigente de RN-REC-001

**No existe un valor aprobado por moneda en este repositorio.** El catálogo
`umbral_ahorro` se entrega vacío y no se cargan datos semilla. Por lo tanto, el
valor vigente hoy es *sin configurar* para todas las monedas:

| Moneda | Umbral vigente | Efecto |
|---|---|---|
| CLP | Sin configurar | No se listan recomendaciones en CLP; se informa el motivo |
| USD | Sin configurar | No se listan recomendaciones en USD; se informa el motivo |
| Otras ISO 4217 | Sin configurar | Igual que las anteriores |

Cargar un monto es una decisión operativa del producto y debe hacerse con una
fila explícita en `umbral_ahorro`; no se deduce del monto de una suscripción ni
de una conversión de moneda.

## Alternativas evaluadas

### A. Fallback fijo `0.01` (descartada)

- **Ventaja:** el listado siempre responde con datos.
- **Problema:** inventa una regla de negocio. Con la tabla vacía, el filtro no
  filtra y se presentan ahorros irrelevantes como si cumplieran RN-REC-001.
  Incumple el criterio de aceptación de VI-21.

### B. Umbral global único, sin distinguir moneda (descartada)

- **Ventaja:** una sola configuración y menos mantenimiento.
- **Problema:** 1.000 CLP y 1.000 USD no representan el mismo ahorro. Un único
  número obliga a comparar magnitudes no homogéneas y a fijar un valor sesgado
  hacia una moneda. Además, el job ya mantiene las monedas separadas.

### C. Catálogo por moneda, sin valor por defecto (elegida)

- **Ventaja:** respeta la separación de monedas que ya existe en VI-20; permite
  que producto defina cada umbral sin tocar código; hace visible la ausencia de
  configuración en vez de ocultarla.
- **Costo:** hasta que se cargue una fila, el listado devuelve vacío con motivo.
  Es el comportamiento buscado: es preferible no recomendar a recomendar con una
  regla inventada.

### D. Eliminar el filtro por completo (descartada)

- **Problema:** deja sin implementar RN-REC-001 y mezcla recomendaciones
  irrelevantes con las accionables.

## Decisión

Se implementa la alternativa C:

1. `analytics.models.UmbralAhorro` es un catálogo global (`ModeloBase`) con
   `moneda` única, `monto` positivo y `activo`.
2. `analytics.reglas.umbral_minimo(moneda)` es la única lectura de la regla.
   Devuelve `None` si no hay fila activa; **nunca** un valor por defecto.
3. El listado `GET /api/recomendaciones/` aplica RN-REC-001:
   - incluye solo recomendaciones `vigentes` cuyo `ahorro_estimado` sea mayor o
     igual al umbral de su moneda;
   - si una moneda no tiene configuración, excluye sus filas, marca
     `disponible: false`, la agrega a `umbrales_no_configurados` y explica el
     motivo en `motivo_sin_sugerencias`;
   - un `?moneda=` sin configuración también responde indisponible, aunque no
     existan filas de esa moneda.
4. La generación y la persistencia **no** filtran por umbral. El job de VI-20
   sigue siendo una función pura y la tabla conserva la evidencia completa. La
   regla se aplica al listar, que es el único punto donde el umbral puede cambiar
   sin reprocesar eventos. Así, al configurar una moneda, las recomendaciones ya
   persistidas se vuelven visibles sin reemitir el solapamiento.
5. El ahorro se guarda normalizado a mensual (un costo anual se divide por 12)
   y en su moneda original. No se convierten ni suman monedas.

## Operación

Para habilitar una moneda, un responsable de producto debe crear o actualizar
una fila con un monto aprobado. Ejemplo de forma (el valor es ilustrativo y no
se carga por migración):

```python
from decimal import Decimal
from analytics.models import UmbralAhorro

UmbralAhorro.objects.update_or_create(
    moneda="CLP",
    defaults={"monto": Decimal("<monto aprobado>"), "activo": True},
)
```

Para deshabilitar una moneda sin borrar el historial, se usa `activo=False`.

## Consecuencias

- Sin configuración no hay recomendaciones visibles y el cliente recibe un
  motivo. No se devuelve `0.01` ni otro fallback.
- La decisión queda centralizada en Analytics y no se duplica en Subscriptions,
  que no genera recomendaciones.
- El valor concreto de cada moneda sigue pendiente de aprobación de producto.
  Este documento fija el mecanismo y deja explícito que el valor vigente es
  "sin configurar" hasta que exista esa aprobación.

## Verificación

- `analytics/test_recommendation_api.py` cubre: sin configuración no hay
  resultados ni fallback, filtro inclusivo `>=`, configuración inactiva,
  normalización de moneda, filtro por moneda y aislamiento por tenant.
- `makemigrations --check` no detecta cambios y las migraciones de Analytics
  cuelgan linealmente de `0002_limites_negocio_ia`.
