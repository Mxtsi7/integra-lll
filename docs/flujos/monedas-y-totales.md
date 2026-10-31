# Monedas escalables y totales

## Comportamiento

- Inicio muestra una proyección por moneda, identificada por su código. El gasto
  sin uso también se separa; no se convierten divisas ni se suman CLP con USD.
- En Panel, «Moneda del panel» filtra cifras, gráficos, listas y CSV. Las opciones
  proceden de los códigos de las suscripciones cargadas, incluidos históricos
  inactivos; las etiquetas se completan desde el catálogo cuando está disponible.
- Cambiar de moneda reinicia los gráficos para no animar cifras de una divisa
  como si pertenecieran a otra. El total de categorías incluye todas, aunque el
  gráfico muestre solo las seis principales.
- Se recorren las páginas del listado antes de calcular. Si se alcanza el tope
  de seguridad de 20 páginas y todavía hay más, se muestra error en vez de totales
  parciales. Para volúmenes mayores se requiere un flujo con agregados de servidor.

## Presupuesto y resumen

`Presupuesto` y `ResumenOrganizacion` conservan códigos, pero eliminan el enum
CLP/USD. GET de presupuesto/resumen acepta cualquier moneda existente en el
catálogo, activa o inactiva; la lectura histórica no deja de funcionar.

POST presupuesto normaliza el código a mayúsculas y exige una moneda activa
para un registro nuevo. Un presupuesto existente de esa organización, mes y
moneda puede conservar su divisa inactiva al actualizar el importe. El ORM
habitual aplica la misma política mediante `ReferenciasCatalogo`; escrituras
masivas siguen requiriendo validación explícita, como explica ADR-007.

Flujo: pantalla → API compartida → gateway → Suscripciones → catálogo/ORM →
Postgres. El trabajo derivado de eventos mantiene un agregado por organización
y moneda; esta entrega no altera su consumidor ni su contrato.

## Precisión y despliegue

Se mantiene el contrato de importes con dos decimales en backend, serializados
como texto. Más decimales se rechazan. El frontend recibe números; la proyección
agrupa doceavos de centavo por moneda, sin redondear el resultado numérico.
Inicio y las sumas del Panel usan las mismas unidades enteras; cada indicador
conserva su selección de estados. El único redondeo ocurre al presentar con
`Intl.NumberFormat` (CLP sin decimales, EUR/USD con dos). Así, seis anuales de
EUR 5,03 muestran EUR 2,52 al mes y un anual de CLP 5,94 muestra $0, sin el doble
redondeo 0,495 → 0,50 → $1. Los porcentajes de salud usan el valor sin redondear
y el total de categorías se calcula antes de formatear sus subtotales.
No se agrega soporte de
almacenamiento de tres decimales ni conversión de divisas.

Aplicar `python manage.py migrate` en Suscripciones antes de desplegar la nueva
versión. La migración 0015 altera los campos sin modificar códigos ni importes;
0016 une esa rama con 0015_hallazgo_cobro, incorporada en main, sin operaciones
adicionales sobre los datos.
Agregar/renombrar/desactivar monedas usa `gestionar_catalogo`, como en ADR-007.

## Verificación

Backend: `pytest tests/test_monedas_escalables.py tests/test_presupuesto_panel.py
tests/test_catalogos.py`; también ejecutar la suite completa contra PostgreSQL.
Frontend: desde `frontend/`, ejecutar `npm run typecheck`, `npm test` y
`npm run build`. Hay casos con CLP/USD/EUR, céntimos, anuales, catálogo caído,
históricos inactivos, aislamiento de organizaciones y exportación filtrada.
