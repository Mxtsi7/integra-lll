# FE-08 — Modelar importaciones y exponer su progreso

**Qué hace.** Define la tabla `importacion` en connectors: una carga de datos
(un CSV o cartola, o una lectura de correo) con su estado, sus filas, sus
candidatos y sus errores resumidos. Encima, dos endpoints de solo lectura para
que la web pregunte "¿cómo va?" hasta que termine. Esta API no crea
importaciones: las crea la subida de FE-07 y las mueve el proceso que las
ejecuta. Commit `cbef307` (PR #116) y la corrección `e7ecf39`.

**Dónde está.**

| Pieza | Archivo |
|---|---|
| El modelo, la máquina de estados, el progreso y los errores | `connectors/models.py` → `Importacion`, migración `0002_importaciones` |
| La respuesta | `connectors/serializers.py` → `ImportacionSerializer` |
| Los endpoints y los filtros | `connectors/views.py` → `ImportacionViewSet` |
| La ruta (`importaciones`, en español) | `connectors/urls.py`, registrada en el `DefaultRouter` |
| El prefijo en el gateway | `gateway/config/settings.py` → `RUTAS["/api/importaciones/"] = "connectors"` |
| La limpieza de la organización (MX-07) | `connectors/eliminacion.py`, `Importacion` está en su lista de modelos |

## Las rutas

El gateway reenvía `/api/importaciones/` a connectors con la misma ruta (ver
[03-gateway.md](03-gateway.md)), valida el JWT y pone `X-Usuario-Id`,
`X-Organizacion-Id` y `X-Rol`. Esta vista usa la organización para aislar y
el usuario para `?mias=true`; `X-Rol` llega pero no se mira.

| Método | Ruta pública vía gateway | Qué hace | Códigos |
|---|---|---|---|
| GET | `/api/importaciones/` | Las de la organización, más nuevas primero, de a 10. Filtros: `?estado=`, `?origen=`, `?mias=true`, `?page=`, `?page_size=` (máx. 100) | 200 · 400 filtro inválido · 403 sin organización, o `mias=true` sin usuario · 401 del gateway sin token |
| GET | `/api/importaciones/{id}/` | Una, para hacerle polling. Ignora los filtros | 200 · 404 no existe, es de otra organización o el id no es UUID · 403 sin organización · 401 del gateway |
| POST, PUT, PATCH, DELETE | las mismas | No existen: es `SoloLecturaTenantViewSet` | 405 |

`POST /api/importaciones/archivos/` es la subida de [FE-07](10-subida-de-archivos-fe07.md);
va antes del router en `urls.py` para que `archivos` no se lea como un `{id}`.

Detalle de una importación (forma real de `ImportacionSerializer`):

```json
{
  "id": "663fa339-9c4b-4193-ad86-5f7d69e4a14e", "origen": "csv",
  "origen_legible": "Archivo CSV o cartola", "nombre_archivo": "cartola-octubre.csv",
  "cuenta": null, "estado": "procesando", "estado_legible": "Procesando",
  "terminada": false, "progreso": 25, "filas_totales": 200, "filas_procesadas": 50,
  "candidatos_detectados": 0, "candidatos_confirmados": false,
  "errores": [{"codigo": "fila_invalida", "mensaje": "falta el monto", "fila": 3}],
  "errores_totales": 1, "terminada_en": null, "confirmada_en": null,
  "creado_en": "2026-11-01T20:22:39.105060-03:00",
  "actualizado_en": "2026-11-01T20:22:39.106320-03:00"
}
```

El listado lo envuelve en `{"count", "next", "previous", "results"}`. Un 400
trae `{"estado": "Debe ser uno de: pendiente, procesando, completada, fallida."}`
(o `origen`, o `{"mias": "Debe ser true o false."}`); un 403,
`{"detail": "Falta el contexto de organización"}`, o
`{"detail": "Falta el contexto de usuario"}` si llega `?mias=true` sin
`X-Usuario-Id`.

## El flujo

```
navegador (CH-27: useProgresoImportacion)
   │  GET /api/importaciones/<id>/      Authorization: Bearer <jwt>
   ▼
gateway ── valida JWT · /api/importaciones/ → connectors:8003
   │       pone X-Usuario-Id, X-Organizacion-Id, X-Rol
   ▼
connectors · ImportacionViewSet
   │  MezclaTenant: filter(organizacion_id=X-Organizacion-Id)  (403 sin cabecera; ajena → 404)
   ▼
Postgres, esquema connectors, tabla importacion
   ▲
   │  quién escribe (nunca la API):
   ├─ FE-07 SubirArchivoView ── create(estado=pendiente, filas_totales estimadas)
   ├─ purgar_archivos_importacion ── anotar_error("archivo_vencido") + avanzar_a(fallida)
   └─ FE-09 / FE-13 (no existen todavía) ── procesando → completada | fallida
```

**La máquina de estados.** `TRANSICIONES` en el modelo dice de dónde se puede
pasar a dónde; lo que no está, no se puede. `completada` y `fallida` son
terminales: si una pudiera volver a `procesando`, la web que dejó de
preguntar se quedaría con una respuesta vieja para siempre.

```
pendiente ──▶ procesando ──▶ completada   (terminal)
    └──────┬───────┘
           ▼
        fallida   (terminal)
```

`avanzar_a(estado)`: al mismo estado devuelve `False` y no toca nada; a uno
no declarado (pendiente → completada, o salir de una terminal) lanza
`ValueError`, porque es un error de programación; a uno válido hace
`UPDATE ... WHERE pk=<id> AND estado=<el que esta instancia cree>`. Una fila
cambiada es `True`; cero significa que otra instancia se adelantó, y entonces
relee la fila y devuelve `False`. Al llegar a una terminal sella `terminada_en`.

**El progreso.** Es una propiedad, no una columna: terminal → `100` aunque
nunca se haya sabido el total; `filas_totales` en null (o 0) → `null`; si
no, `min(100, round(100 * filas_procesadas / filas_totales))`. `null` no es
`0`: una barra indeterminada no es una vacía, y una lectura de correo no sabe
cuántos mensajes hay hasta pedirlos. FE-07 estima el total contando líneas
del CSV; un PDF queda en null hasta que se lea.

**Los errores.** `anotar_error(codigo, mensaje, fila)` suma siempre
`errores_totales`, pero guarda en `errores` solo los primeros
`MAXIMO_ERRORES` (20), con el mensaje cortado a 200 caracteres: un CSV de
5.000 filas malas no puede devolver 5.000 errores en cada polling. No guarda
en la base; el llamador decide cuándo, para no hacer un UPDATE por fila.

**El polling** lo hace la web: 1 s, el doble sin avance hasta 10 s, de vuelta
a 1 s al avanzar, y se detiene con `terminada: true`. Un 404 no se reintenta.
Ver [frontend/PROGRESO-DE-IMPORTACION.md](../../../frontend/PROGRESO-DE-IMPORTACION.md).

**La purga.** Si el archivo vence (7 días) con la importación en `pendiente`
o `procesando`, `purgar_archivos_importacion --aplicar` anota
`archivo_vencido` y la pasa a `fallida` antes de borrarlo; si ya estaba
terminada, no toca su estado. Detalle en [FE-07](10-subida-de-archivos-fe07.md).

## Decisiones

- **Terminar el análisis no es confirmar los candidatos.** `completada`
  significa "listos para que alguien los mire" (FE-10). La aceptación es
  `confirmada_en`, un campo aparte y no un estado, porque una importación
  puede quedarse completada para siempre si la persona dice que no. La API
  devuelve `terminada` y `candidatos_confirmados` por separado.
  `confirmar_candidatos()` solo funciona desde `completada`.
- **La guarda va en el WHERE, no en memoria** (`e7ecf39`, hallazgo de la
  revisión de #116). Con dos instancias leídas de la misma fila en
  `procesando`, la segunda pisaba la `completada` de la primera con
  `fallida`. `confirmar_candidatos` tenía el mismo problema y la misma
  corrección.
- **Solo lectura.** Un `create` abierto permitiría inventar una importación
  `completada` sin haber procesado nada.
- **Aislamiento por organización, 404 para la ajena.** Un 403 confirmaría que
  el id existe. Dentro de la organización todos ven todas las cargas;
  `usuario_id` (el valor crudo de `X-Usuario-Id`) sirve para `?mias=true`.
  Los filtros solo aplican al listado: un query param colgado en el detalle
  no puede hacer desaparecer el recurso.
- **`cuenta` con SET_NULL.** Si se desconecta el correo, la importación que
  ya ocurrió sigue siendo un hecho.

## Cómo probarlo

```bash
cd services/connectors
env PYTHONPATH=<raíz del repo> DEBUG=True SECRET_KEY=x ALLOWED_HOSTS=localhost,127.0.0.1,testserver JWT_SECRET=solo-prueba-solo-prueba-solo-prueba-32 JWT_ALGORITMO=HS256 CELERY_BROKER_URL=redis://localhost:6379/0 ESQUEMA_BD=connectors CLAVES_CIFRADO=x DATABASE_URL=sqlite://:memory: python -m pytest -q -p no:cacheprovider tests/test_importaciones.py

# a mano, con el stack levantado:
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/importaciones/?mias=true"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/importaciones/<id>/
```

48 pruebas en `tests/test_importaciones.py`: la máquina de estados (las
cuatro combinaciones de terminal hacia atrás y que la tabla calce con los
terminales), cinco de instancias obsoletas (incluida la reproducción de la
revisión y que el polling nunca vea retroceder una terminal), análisis contra
confirmación, progreso, errores resumidos, aislamiento, solo lectura (405),
filtros y la cuenta con SET_NULL. El commit `cbef307` anota que se
rompieron a propósito las siete propiedades y las pruebas fallaron.

El cruce con la purga lo cubren las pruebas de FE-07:
`tests/test_subida_archivos.py::TestPurgaDejaLaImportacionFallida` y
`tests/test_purga_intercalada.py` (13 pasan; 2 se saltan sin PostgreSQL).

## Lo que queda para otras tarjetas

- **Nadie mueve todavía una importación a `procesando`.** Según
  `connectors/tasks.py`, el procesamiento (FE-09) y la lectura de correo
  (FE-13) no existen: hoy una importación queda en `pendiente` hasta que la
  purga la deja `fallida`.
- Previsualizar (FE-10) y confirmar (FE-11): `confirmar_candidatos()` ya está
  en el modelo, pero no hay endpoint.
