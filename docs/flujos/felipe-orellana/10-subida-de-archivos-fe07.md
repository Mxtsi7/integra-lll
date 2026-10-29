# FE-07 — Validar y recibir archivos CSV y cartolas

**Qué hace.** Un endpoint que recibe un `.csv` o una cartola `.pdf`, lo valida
antes de guardar nada (extensión, tamaño, contenido real), aplica la cuota
diaria de la organización, guarda el archivo temporalmente y crea la
importación en `pendiente`. No crea ni toca ninguna suscripción: devuelve el
id de la importación, que es el "job" que FE-09 va a procesar.

**Dónde está.**

| Pieza | Archivo |
|---|---|
| La validación, funciones puras sobre bytes | `connectors/archivos.py` |
| El endpoint | `connectors/views.py` → `SubirArchivoView` |
| El archivo guardado temporalmente | `connectors/models.py` → `ArchivoImportacion`, migración `0003` |
| La purga de archivos vencidos | `manage.py purgar_archivos_importacion [--aplicar]` |
| Los topes | `settings.py`: `IMPORTACION_TAMANO_MAXIMO_BYTES` (5 MB), `IMPORTACION_CUOTA_DIARIA` (20), `IMPORTACION_DIAS_RETENCION` (7) |

## El contrato

```http
POST /api/importaciones/archivos/
X-Organizacion-Id: <uuid>        (lo pone el gateway)
X-Usuario-Id: <id>               (lo pone el gateway)
Content-Type: multipart/form-data; campo `archivo`
```

| Código | Cuándo | Cuerpo |
|---|---|---|
| 201 | archivo válido | la importación de FE-08, en `pendiente` (`id`, `nombre_archivo`, `filas_totales`, `progreso`…) |
| 400 | falta el archivo, formato no admitido, vacío, contenido incompatible | `{"codigo": "...", "archivo": "qué pasó"}` |
| 413 | excede el tamaño máximo | ídem, `codigo: archivo_excedido` |
| 429 | la organización agotó su cuota diaria | `{"codigo": "cuota_excedida", "detail": "..."}` |
| 403 | sin organización o sin usuario | — |

Los `codigo` son estables: `formato_no_admitido`, `archivo_vacio`,
`archivo_excedido`, `contenido_incompatible`, `falta_archivo`,
`cuota_excedida`. El frontend puede decidir por ellos y mostrar `archivo` tal
cual.

Después del 201, el polling es el de FE-08: `GET /api/importaciones/<id>/`.

## Las validaciones, en orden

1. **Nombre**: solo el nombre, sin ruta (`../../x.csv` queda `x.csv`), hasta 255.
2. **Extensión**: `.csv` o `.pdf`, explícitos. Un `.xlsx`, `.txt` o sin
   extensión se rechaza diciendo qué se admite. No se adivina.
3. **Tamaño**: vacío se rechaza; más de `IMPORTACION_TAMANO_MAXIMO_BYTES` se
   rechaza con 413. La vista lee a lo más un byte por sobre el máximo, así que
   un archivo enorme no llega a cargarse en memoria.
4. **Contenido**: la extensión no prueba nada.
   - `.pdf` tiene que empezar con `%PDF-`.
   - `.csv` tiene que ser texto (sin bytes nulos; UTF-8 con o sin BOM, o
     Latin-1, que es lo que exportan los bancos), con cabecera y al menos una
     fila, y con al menos dos columnas en un separador conocido (`,` `;`
     tabulador `|`). Un `.csv` con un PDF adentro, o un `.pdf` que es texto,
     se rechazan.
5. **Cuota**: cuántos archivos subió la organización hoy (solo `origen=csv`;
   las lecturas de correo no la consumen). Se cuenta con el advisory lock de
   la organización tomado, para que dos subidas simultáneas no pasen las dos.

Solo si pasa todo eso se escribe algo, y en una transacción: la importación
y el archivo juntos.

## Decisiones

- **El archivo va en la base, no en disco.** En Kubernetes el disco del pod es
  efímero y no se comparte, y no hay almacenamiento de objetos. Los bytes se
  guardan en `ArchivoImportacion` con tope de tamaño y fecha de vencimiento,
  y así el worker de FE-09 los lee desde cualquier pod.
- **Es temporal de verdad.** `vence_en` = subida + 7 días; el comando de purga
  borra los vencidos y deja la importación con sus candidatos y errores. En
  seco por omisión, como los otros comandos que borran.
- **Separado del viewset de FE-08.** `ImportacionViewSet` sigue siendo de solo
  lectura (sus pruebas no cambian): una importación no nace de un POST suelto,
  nace de recibir un archivo, y eso es un endpoint aparte.
- **`sha256` queda guardado** para que FE-09 pueda decir "este archivo ya lo
  subiste" y comprobar que lee lo que se validó.
- **No se procesa nada acá.** `filas_totales` se estima contando líneas para
  que la barra de FE-08 tenga total desde el principio; el PDF queda en `null`
  (barra indeterminada) hasta que FE-09 lo lea.

## Cómo probarlo

```bash
cd services/connectors
ESQUEMA_BD=connectors SECRET_KEY=x DEBUG=False CLAVES_CIFRADO=x pytest tests/test_subida_archivos.py -q

# a mano, con el stack levantado:
curl -s -X POST http://localhost:8000/api/importaciones/archivos/ \
  -H "Authorization: Bearer $TOKEN" -F archivo=@cartola.csv
```

42 pruebas: el camino feliz con CSV y con PDF, los cuatro separadores y
Latin-1, el nombre sin ruta; cada rechazo (413, extensión, PDF en `.csv`,
texto en `.pdf`, una columna, sin filas, bytes nulos, vacío, sin archivo) y
que ninguno deje rastro; la cuota por organización, de hoy, solo de archivos,
con el lock; el aislamiento; la purga; y la validación sin API. Verificado que
cada validación falla al romperla.

## Lo que queda para otras tarjetas

Procesar el archivo y detectar cobros (FE-09), previsualizar (FE-10),
confirmar y crear suscripciones (FE-11). Si el equipo decide ofrecer `.xlsx`,
es una entrada en `FORMATOS_ADMITIDOS` y su validación de contenido.
