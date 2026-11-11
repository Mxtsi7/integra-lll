# FE-28 y FE-29 — Uso por periodo y puntaje de bajo uso

**Qué hace.** Analytics copia los registros de uso que le llegan por evento,
arma un agregado por suscripción y mes (FE-28) y encima calcula un puntaje de 0
a 100 con una clasificación `sin_datos | bajo | normal | alto` (FE-29). Van
separados: el puntaje no escribe nada, así que la fórmula se cambia sin tocar
los datos (docstring de `analytics/uso.py`). Entró con la PR #111 (reemplazó a
#110), mergeada el 28-10-2026 en `b05809c`: el commit base es `f691c6b`
(26-10-2026) y las correcciones de las revisiones son `8661659`, `7f797e0`,
`e93e874`, `f6e0c37` y `43e0175`.

**Dónde está.** Rutas relativas a `services/analytics/`.

| Pieza | Archivo |
|---|---|
| Las cuatro tablas de la proyección | `analytics/models.py` → `SuscripcionObservada`, `CoberturaUso`, `UsoProyectado`, `UsoMensual`; migración `0006_uso_por_periodo` |
| Proyección, agregado, cobertura y puntaje | `analytics/uso.py` → `proyectar_uso`, `recalcular_mes`, `registrar_cobertura`, `primer_hueco`, `puntuar`, `puntuar_organizacion` |
| El adaptador de eventos | `analytics/consumo_uso.py` → `aplicar(sobre)` |
| Las vistas y sus serializers | `analytics/views.py` → `UsoMensualViewSet`, `PuntajesUsoView`; `analytics/serializers.py` → `UsoMensualSerializer`, `PuntajeUsoSerializer` |
| Las rutas | `analytics/urls.py`, incluido dos veces en `analytics_config/urls.py` |
| El lock por clave | `shared/bloqueo.py` (raíz del repo) → espacios `uso_mensual` (28) y `cobertura_uso` (30) |
| Los parámetros (configurables; la evidencia de cada puntaje guarda el umbral y los días mínimos que usó) | `analytics_config/settings.py`: `UMBRAL_BAJO_USO_MINUTOS` (60), `UMBRAL_DIAS_OBSERVACION` (30), `MESES_VENTANA_USO` (3) |

## Las rutas

La ruta pública es `/api/analitica/`, que el gateway manda a analytics
(`RUTAS` en `gateway/config/settings.py`). El servicio incluye las mismas rutas
también bajo `/api/analytics/`, pero ese prefijo no está en `RUTAS`: desde
afuera el gateway responde 404 y queda solo por compatibilidad interna
(comentario en `analytics_config/urls.py`). No va bajo `/api/usos/`, que es de
subscriptions: allá están los registros, acá el agregado y la señal.

| Método | Ruta pública vía gateway | Qué hace | Códigos |
|---|---|---|---|
| GET | `/api/analitica/uso-mensual/` | lista paginada (50) del agregado de la organización; filtros opcionales `?mes=YYYY-MM` y `?suscripcion_id=<uuid>` | 200 · 400 filtro mal formado · 403 |
| GET | `/api/analitica/uso-mensual/{id}/` | un agregado | 200 · 404 si no existe o es de otra organización · 403 |
| GET | `/api/analitica/puntajes-uso/?mes=YYYY-MM` | puntaje de cada suscripción observada, con su evidencia; `mes` obligatorio | 200 · 400 falta `mes`, formato malo o mes que no empieza · 403 |

Las tres son de solo lectura (POST o DELETE dan 405). Sin token, el 401 lo
pone el gateway, que inyecta `X-Usuario-Id`, `X-Organizacion-Id` y `X-Rol`.
`UsoMensualViewSet` filtra por `X-Organizacion-Id` con `MezclaTenant`
(`shared/tenant/base.py`) y `PuntajesUsoView` se la pasa a `puntuar_organizacion`;
sin ella, las dos dan 403 `{"detail": "Falta el contexto de organización"}`. Los 400 nombran
el campo: `{"mes": "Falta el mes, en formato YYYY-MM."}`,
`"Debe tener el formato YYYY-MM."`, `"Ese mes todavía no empieza."` o
`{"suscripcion_id": "No es un UUID."}`.

```http
GET /api/analitica/uso-mensual/?mes=2026-09
200 {"count": 1, "next": null, "previous": null, "results": [
     {"id": "<uuid>", "suscripcion_id": "<uuid>", "mes": "2026-09-01", "minutos": 30,
      "dias_con_uso": 2, "ultimo_uso": "2026-09-04", "actualizado_en": "2026-11-01T20:32:28.261307-03:00"}]}

GET /api/analitica/puntajes-uso/?mes=2026-10        (lista sin paginar; "meses" abreviado)
200 [{"suscripcion_id": "<uuid>", "mes_final": "2026-10", "meses_evaluados": 3,
      "minutos_totales": 30, "minutos_por_mes": 10.0, "dias_con_uso": 2,
      "puntaje": 17, "clasificacion": "bajo",
      "evidencia": {"umbral_minutos_al_mes": 60, "dias_minimos_de_observacion": 30,
        "dias_observados": 152, "observada_desde": "2026-06-01", "medido_hasta": "2026-10-31",
        "mes_en_curso": false, "meses": [{"mes": "2026-08", ...},
          {"mes": "2026-09", "minutos": 30, "dias_con_uso": 2, "proyectado": true}, {"mes": "2026-10", ...}],
        "meses_observados_en_la_ventana": 3, "uso_cero_real": false,
        "motivo": "10.0 minutos al mes, bajo el umbral de 60.",
        "cobertura_tramos": [{"desde": "2026-06-01", "hasta": "2026-10-31"}],
        "cobertura_necesaria_desde": "2026-08-01", "cobertura_faltante": null}}]
```

Hay que mirar `clasificacion`, no `puntaje`: con `sin_datos` el puntaje viene
en 0 y no significa bajo uso (`PuntajeUsoSerializer`, docstring de la vista).

## El flujo

```
ESCRITURA (por eventos; el consumidor todavía no está cableado, ver al final)
subscriptions ─ suscripcion.creada ─┐
¿quién?  ────── uso.registrado ─────┤
                                    ▼
consumo_uso.aplicar(sobre) ── bloquear_organizacion(compartido) ── eliminada → se descarta
   ├ creada → registrar_suscripcion ─▶ suscripcion_observada (observada_desde = ocurrido_en)
   └ uso    → proyectar_uso, en UNA transacción:
                INSERT uso_proyectado (evento_id único) ── duplicado → False, no suma
                recalcular_mes: lock uso_mensual(org, susc, mes) → SUM/COUNT/MAX ─▶ uso_mensual
sincronización ─▶ registrar_cobertura: lock cobertura_uso(org, susc) → funde tramos ─▶ cobertura_uso

LECTURA
navegador ─▶ gateway (JWT → X-Organizacion-Id) ─▶ analytics
   /api/analitica/uso-mensual/  ─▶ uso_mensual de la organización
   /api/analitica/puntajes-uso/ ─▶ puntuar_organizacion(mes, hasta=hoy) ─▶ lee suscripcion_observada,
                                   uso_mensual, uso_proyectado (mes en curso) y cobertura_uso; no escribe
```

**El agregado (FE-28).** `recalcular_mes` no suma sobre lo que había: rearma el
mes desde `UsoProyectado` (`minutos` = suma, `dias_con_uso` = días distintos,
`ultimo_uso` = el máximo). Siempre coincide con los registros, y un uso de
marzo que llega en octubre recalcula marzo y nada más.

**El puntaje (FE-29).** Ventana de 3 meses que termina en `mes`.
`minutos_por_mes = minutos_totales / meses_observados`, contando solo los meses
que la suscripción vivió y que ya empezaron al corte; `puntaje = min(100,
round(100 × minutos_por_mes / umbral))`, o sea 100 es "llega al umbral". Bajo
el umbral es `bajo`; desde el umbral, `normal`; desde el doble, `alto`. El
corte lo pone la vista con la fecha de hoy y `puntuar` lo recorta al último día
del mes pedido. Si el mes del corte sigue abierto, se cuenta desde
`UsoProyectado` hasta ese día y no desde `UsoMensual`, que tiene el mes entero.

**Antes de afirmar nada**, `puntuar` responde `sin_datos` si: (1) analytics no
conoce la suscripción; (2) hay un hueco de cobertura entre el corte y el inicio
de la ventana o el día en que nació, lo que sea más tarde; o (3) lleva menos de
`UMBRAL_DIAS_OBSERVACION` días observada. Pasado eso, cero minutos es `bajo`
con `uso_cero_real: true`.

**Los huecos.** `registrar_cobertura` solo funde tramos que se solapan o se
tocan (`desde - 1`, `hasta + 1`), así que entre dos filas siempre queda un día
sin acreditar. `primer_hueco`, función pura, devuelve el primero y la evidencia
lo trae en `cobertura_faltante`. Un tramo al revés lo rechaza también la base.

## Decisiones

- **Una sola fuente de escritura.** Solo el consumidor escribe; no hay POST.
- **Reprocesar no duplica minutos, y lo garantiza la base.** `UsoProyectado.evento_id`
  es único y es el `id` del sobre. Un `IntegrityError` solo cuenta como
  reproceso si existe la fila con ese `evento_id`; si no, sube.
- **Insertar y recalcular van en la misma transacción.** Con el recálculo
  afuera, si fallaba, la reentrega chocaba con la restricción y el mes no se
  reparaba nunca. Lo encontró la revisión de la PR.
- **El lock va antes del SUM, y es advisory.** Con read committed, dos
  recálculos intercalados dejaban el agregado viejo. `select_for_update` no
  sirve porque la fila del agregado puede no existir todavía (`shared/bloqueo.py`).
  `registrar_cobertura` toma el suyo antes de leer los tramos. En SQLite no hace nada.
- **En `puntajes-uso` el mes es obligatorio.** Un puntaje sin saber de qué mes
  es no se puede comparar ni reproducir; por lo mismo `puntuar` no mira el reloj.
- **La antigüedad no es cobertura.** `observada_desde` sale del `ocurrido_en`
  de `suscripcion.creada`: una creación vieja que llega hoy daba 56 días y
  `bajo` (`e93e874`). Y la cobertura son tramos, no dos fechas: unir los extremos
  acreditaba seis semanas que nunca llegaron (`f6e0c37`).
- **Sobre roto u organización eliminada.** `aplicar` lanza `SobreInvalido` ante,
  por ejemplo, un sobre sin `organizacion_id`, una fecha imposible o minutos
  que no son entero >= 0 (un booleano tampoco pasa). Con la organización
  eliminada devuelve `False` sin escribir, y la limpieza de MX-07 borra las
  cuatro tablas (`analytics/eliminacion.py`).

## Cómo probarlo

```bash
cd services/analytics
env PYTHONPATH=../.. DEBUG=True SECRET_KEY=x ALLOWED_HOSTS=localhost,127.0.0.1,testserver \
  JWT_SECRET=solo-prueba-solo-prueba-solo-prueba-32 JWT_ALGORITMO=HS256 \
  CELERY_BROKER_URL=redis://localhost:6379/0 ESQUEMA_BD=analytics CLAVES_CIFRADO=x \
  DATABASE_URL=sqlite://:memory: \
  python -m pytest -q -p no:cacheprovider tests/test_uso.py tests/test_consumo_uso.py tests/test_carrera_postgres.py
```

130 pruebas: 107 en `test_uso.py` (agregado, reproceso, datos tardíos,
fórmula, sin datos, corte temporal, cobertura y tramos), 21 en
`test_consumo_uso.py` (adaptador, sobres rotos, organización eliminada) y 2 en
`test_carrera_postgres.py`. En SQLite pasan 124 y se saltan 6 (las 4 de
`pg_locks` y las 2 de la carrera); contra PostgreSQL pasan las 130. La carrera
usa dos conexiones: A se detiene justo después del SUM y la prueba exige que B
quede esperando el lock (`pg_locks` con `granted = false`) y que el agregado
final sea la suma de la fuente. Las vistas no tienen prueba HTTP propia.

Ojo: en SQLite la base de prueba es el archivo `test_analytics` (`TEST NAME` en
`analytics_config/settings.py`), así que la corrida borra
`services/analytics/test_analytics`, versionado desde `989d2c9`. Después:
`git checkout -- services/analytics/test_analytics`.

## Lo que queda abierto

- **Quién publica `uso.registrado`.** El catálogo (`shared/events/catalogo.md`)
  lo pone en connectors ("llegan datos de uso desde una API externa") y
  `consumo_uso.py` repite eso, pero `models.py` dice que la fuente de verdad es
  `RegistroUso` de subscriptions. En `main` ninguno de los dos lo publica.
- **El consumidor no está cableado.** Fuera de las pruebas nadie llama a
  `consumo_uso.aplicar`: `event_consumer.py` y `consumir_solapamientos` solo
  atienden solapamientos y ninguna cola de analytics escucha `suscripcion.creada`.
- **Nadie acredita cobertura.** La fuente no publica un marcador de
  sincronización. Hoy, sin consumidor, las tablas están vacías y `puntajes-uso`
  responde `[]`; aunque se cablee, sin cobertura cada suscripción sale
  `sin_datos`. Es lo correcto mientras tanto (ver `docs/pruebas/MX-27-seed-uso.md`).
- **Una llave de idempotencia más fuerte.** Si `uso.registrado` trae el id del
  registro de origen, conviene usarlo: dos publicaciones del mismo uso tienen
  sobres distintos (help_text de `UsoProyectado.evento_id`).
- **VI-17** es quien debía consumir `puntajes-uso`; todavía no lo llama, y el
  frontend tampoco. Fuera de las dos vistas, solo el asistente de VI-22
  (`analytics/asistente.py`) lee `uso_mensual` y los nombres de `suscripcion_observada`.
