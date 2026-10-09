# 07 · Cifrado de tokens en reposo (FE-06, Sprint 2)

**Tarjeta del Trello:** FE-06 · Cifrar tokens de conectores y gestionar
claves · P0 · CÓDIGO. Alcance: almacenamiento cifrado, claves por entorno
fuera del repositorio, estrategia de rotación, y secretos fuera de logs,
respuestas y errores. Referencias: RN-SEG-001, ADR-005 consecuencia 2.

**Criterios de aceptación de la tarjeta:**

- La BD no contiene tokens legibles.
- Lectura con clave inválida falla sin filtrar el secreto ni inutilizar otras cuentas.

**Rama:** `felipe/fe-06-cifrado-tokens` (desde `origin/main` `c48c879`).

**Archivos:**

| Archivo | Qué hace |
|---|---|
| `shared/cifrado/cifrador.py` | el cifrador Fernet con varias claves; sin Django |
| `shared/cifrado/campos.py` | `CampoCifrado`: el campo de modelo que cifra al guardar y descifra al leer |
| `shared/cifrado/serializers.py` | `CampoSecretoSerializer`: el token entra por la API y nunca sale |
| `shared/cifrado/rotacion.py` | `rotar_claves()`: re-cifra lo guardado con una clave anterior |
| `shared/cifrado/README.md` | guía de uso y de rotación para el equipo |
| `shared/cifrado/tests/` | 32 pruebas con sqlite en memoria y una app de prueba |
| `shared/conftest.py`, `shared/pytest.ini`, `shared/requirements-pruebas.txt` | para correr `pytest shared` fuera de un servicio |
| `.env.example`, `k8s/desplegar.sh` | la variable `CLAVES_CIFRADO` en local y en el Secret del cluster |
| `services/connectors/requirements.txt` | agrega `cryptography` |
| `.github/workflows/ci.yml` | trabajo nuevo `shared · cifrado` |

## Por qué en `shared/` y no en `connectors/`

`services/connectors/` es un esqueleto sin `settings.py` ni `manage.py`;
dejarlo ejecutable es VI-27 (Víctor) y casi todas mis tarjetas dependen de
eso. La tarjeta dice "comprobar qué existe para extenderlo sin duplicarlo".
`shared/` ya es el lugar del código que todos los servicios montan
(`shared/tenant` es el ejemplo), así que el cifrado queda listo para que
FE-01 (`CuentaConectada`) lo importe cuando exista el servicio, y también
para `notifications` o cualquier otro que guarde un secreto.

## Flujo de datos

```
POST /api/connectors/accounts/   {"access_token": "ya29..."}
        │
        ▼  CampoSecretoSerializer: acepta el valor (write_only)
        ▼  modelo.access_token = "ya29..."
        ▼  save() → CampoCifrado.get_prep_value()
              → obtener_cifrador()            lee CLAVES_CIFRADO una vez por proceso
              → Cifrador.cifrar()             Fernet con la PRIMERA clave
        ▼  Postgres guarda  "gAAAAABn..."     (no se puede buscar ni leer sin la clave)

GET /api/connectors/accounts/
        ▼  SELECT → CampoCifrado.from_db_value()
              → Cifrador.descifrar()          prueba TODAS las claves en orden
              ├─ ok      → TextoDescifrado("ya29...", cifrado_con_clave_actual=True/False)
              └─ falla   → SECRETO_ILEGIBLE (falsy) + warning en el log SIN el valor
        ▼  CampoSecretoSerializer no lo incluye en la respuesta
```

### Qué es Fernet

Cifrado simétrico autenticado de la librería `cryptography`: AES-128-CBC
para cifrar y HMAC-SHA256 para firmar. "Autenticado" significa que si
alguien edita un byte en la base, descifrar falla en vez de devolver basura.
Cada cifrado lleva un IV distinto, así que el mismo token guardado dos veces
produce dos textos distintos: la base no puede responder "¿quién tiene este
token?". Por lo mismo, `filter(access_token=x)` nunca coincide, y es a
propósito.

### Varias claves a la vez: la rotación

`CLAVES_CIFRADO` es una lista separada por comas. **La primera cifra, todas
descifran** (`MultiFernet`). Rotar sin apagar nada:

1. Generar `NUEVA`. Dejar `CLAVES_CIFRADO=NUEVA,VIEJA`. Redesplegar. Lo nuevo
   se cifra con `NUEVA`; lo viejo sigue legible por `VIEJA`.
2. `rotar_claves(CuentaConectada.objects.all(), ["access_token", "refresh_token"])`
   re-cifra solo las filas que quedaron con `VIEJA`.
3. Dejar `CLAVES_CIFRADO=NUEVA`. Redesplegar.

Si se salta el paso 2, esas filas quedan `SECRETO_ILEGIBLE` y las cuentas
tienen que reautorizar. No se pierde nada más y el dato original no se pisa.

### Una fila ilegible no rompe a las demás

Es la decisión de diseño más importante. Si `from_db_value` lanzara una
excepción, un listado de 50 cuentas con una sola fila cifrada con una clave
perdida devolvería 500. En cambio devuelve `SECRETO_ILEGIBLE`, que es falsy:
el listado responde, y esa cuenta se puede marcar como "requiere
reautorizar". Intentar **guardar** esa fila sí lanza, para no sobrescribir el
cifrado original con basura; los demás campos se guardan con
`save(update_fields=[...])`.

### Nada de secretos en errores ni logs

Ningún mensaje de excepción incluye el texto plano, el cifrado ni la clave.
Las excepciones se lanzan con `from None` para no arrastrar la interna de
`cryptography`. El warning del campo dice el nombre del campo y nada más.
`redactar()` devuelve `***` para logs y `dumpdata` exporta `***`.

## Dónde está cada cosa en el código

| Paso | Archivo y línea | Qué buscar |
|---|---|---|
| Nombre de la variable | `shared/cifrado/cifrador.py:26` | `VARIABLE_DE_ENTORNO = "CLAVES_CIFRADO"` |
| Los tres errores (sin secretos en el mensaje) | `cifrador.py:30-39` | `ErrorDeCifrado`, `CifradoNoConfigurado`, `ClaveDeCifradoInvalida` |
| Generar una clave | `cifrador.py:42` | `generar_clave()` → `Fernet.generate_key()` |
| Para logs | `cifrador.py:48` | `redactar()` → `"***"` o `"(vacío)"` |
| Clave mal formada se rechaza sin mostrarla | `cifrador.py:55-62` | `_fernet_desde()`; el mensaje dice `#posición`, no la clave; `from None` |
| Lista de claves, la primera manda | `cifrador.py:65-76` | `Cifrador.__init__`: `self._actual = self._fernets[0]`, `self._todas = MultiFernet(...)` |
| Leer `CLAVES_CIFRADO` | `cifrador.py:79-86` | `Cifrador.desde_entorno()`; `CifradoNoConfigurado` si falta |
| Cifrar con la clave vigente | `cifrador.py:92-96` | `cifrar()` → `self._actual.encrypt(...)` |
| Descifrar probando todas | `cifrador.py:98-106` | `descifrar()` → `self._todas.decrypt(...)`; `except InvalidToken` → `ClaveDeCifradoInvalida ... from None` |
| ¿Necesita rotación? | `cifrador.py:108` | `cifrado_con_clave_actual()`: intenta solo con la primera |
| Re-cifrar un valor | `cifrador.py:116` | `rotar()` = `cifrar(descifrar(x))` |
| Una instancia por proceso | `cifrador.py:126-139` | `_cifrador`, `obtener_cifrador()`, `reiniciar_cifrador()` |
| El valor falsy para filas ilegibles | `shared/cifrado/campos.py:31-53` | `class SecretoIlegible` (`__bool__` → `False`, `__str__` → `<secreto ilegible>`), `SECRETO_ILEGIBLE` |
| El `str` que recuerda con qué clave venía | `campos.py:56` | `class TextoDescifrado(str)`, atributo `cifrado_con_clave_actual` |
| El campo de modelo | `campos.py:68` | `class CampoCifrado(models.TextField)` |
| Cifrar al guardar | `campos.py:73-83` | `get_prep_value()` → `obtener_cifrador().cifrar(str(value))` |
| No pisar un secreto ilegible | `campos.py:76-77` | `isinstance(value, SecretoIlegible)` → `raise ClaveDeCifradoInvalida` |
| Descifrar al leer | `campos.py:85-99` | `from_db_value()`; `except` → `log.warning(... self.name)` → `return SECRETO_ILEGIBLE`; si no, `TextoDescifrado(texto, ...)` |
| `dumpdata` no exporta el texto plano | `campos.py:106` | `value_to_string()` → `"***"` |
| El token entra pero no sale | `shared/cifrado/serializers.py:22-24` | `class CampoSecretoSerializer(CharField)`, `kwargs["write_only"] = True` |
| Si alguien lo fuerza, salta acá y no en una respuesta | `serializers.py:29-32` | `to_representation()` → `raise AssertionError` |
| La rotación | `shared/cifrado/rotacion.py:23-57` | `rotar_claves(queryset, campos)`: `iterator(chunk_size)`, salta `SecretoIlegible`, junta los campos con `cifrado_con_clave_actual == False`, `objeto.save(update_fields=pendientes)`; devuelve `{"revisadas", "rotadas", "ilegibles"}` |
| La variable en local | `.env.example:48` | `CLAVES_CIFRADO=` con la instrucción para generarla |
| La variable en el cluster (secret nuevo) | `k8s/desplegar.sh:69` | `--from-literal=CLAVES_CIFRADO="$(openssl rand -base64 32 \| tr '+/' '-_')"` |
| La variable en el cluster (secret existente) | `k8s/desplegar.sh:87-90` | si el secret no la tiene, `kubectl patch secret ojoalgasto` la agrega; nunca la regenera |
| Dependencia | `services/connectors/requirements.txt:16` | `cryptography==44.0.0` |
| Configuración de Django para probar `shared/` | `shared/conftest.py:18-21` | `pytest_configure()` → `settings.configure(...)` con sqlite en memoria; no hace nada si un servicio ya trae `DJANGO_SETTINGS_MODULE` |
| Que un servicio no recoja estas pruebas | `shared/cifrado/tests/conftest.py:10` | `collect_ignore_glob = ["*"]` cuando hay `DJANGO_SETTINGS_MODULE` |
| Fixture que simula una rotación | `shared/cifrado/tests/conftest.py:15` | `claves(monkeypatch)`: fija `CLAVES_CIFRADO` y reinicia el cifrador |
| Modelo de prueba | `shared/cifrado/tests/app_prueba/models.py` | `CuentaDePrueba` con dos `CampoCifrado` |
| El trabajo del CI | `.github/workflows/ci.yml:73-90` | job `shared` → `pytest shared -v` |

## Cómo probarlo

```bash
pip install -r shared/requirements-pruebas.txt
pytest shared -v                                   # 32 pruebas, ~1 s, sin Postgres
```

O con Docker, igual que el CI:

```bash
docker build -t ojoalgasto-tests-shared -f - shared <<'EOF'
FROM python:3.12-slim
COPY requirements-pruebas.txt /tmp/req.txt
RUN pip install --no-cache-dir -q -r /tmp/req.txt
EOF
docker run --rm -v "$PWD:/repo" -w /repo -e PYTHONPATH=/repo ojoalgasto-tests-shared pytest shared -v
```

Qué prueba cada archivo, y qué criterio de la tarjeta cubre:

| Archivo | Pruebas | Criterio |
|---|---|---|
| `test_cifrador.py:19-123` | 13: ida y vuelta, el cifrado no contiene el texto y cambia cada vez, otra clave falla **sin filtrar nada** (`test_con_otra_clave_no_se_descifra_y_el_error_no_filtra_nada`), dato alterado, texto plano guardado sin cifrar, la primera cifra y todas descifran, sin claves, clave mal formada sin mostrarla, lectura del entorno, caché, solo texto, clave válida, `redactar` | "falla sin filtrar el secreto" |
| `test_campo.py:29-145` | 10: **la columna no contiene el token** (`test_la_base_no_contiene_el_token_legible`), vuelve el texto plano, `NULL`, no se puede buscar, **una fila con clave perdida no rompe a las demás** y el log no incluye el valor, un ilegible no se sobrescribe, con la vieja en la lista se lee y se marca, cada guardado re-cifra, `dumpdata`, `SecretoIlegible` | "la BD no contiene tokens legibles", "sin inutilizar otras cuentas" |
| `test_serializer.py:25-64` | 6: entra pero no sale, `write_only` no se puede apagar, no recorta espacios, representar a la fuerza falla, `ModelSerializer` crea y responde sin el token, y el caso **descuidado** con `fields="__all__"` que sí lo expone (documenta el riesgo) | "nunca en respuestas" |
| `test_rotacion.py:18-58` | 3: re-cifra solo lo viejo, dos veces no cambia nada, cuenta las ilegibles y no las pisa | "estrategia de rotación" |

Resultado del 09-10-2026 en Docker:

```
32 passed in 0.95s
```

Y la verificación de que un servicio no se contamina: con `shared/` copiado
dentro de la imagen de auth (como la deja `k8s/Dockerfile.servicio`),
`pytest --collect-only` recoge 55 pruebas de auth y 0 de `shared/`.

## Un problema que apareció

Las imágenes copian `shared/` adentro (`k8s/Dockerfile.servicio:30`), así
que el `pytest` de auth en el pod recogía estas pruebas y fallaba porque auth
no instala `cryptography`. La causa: `tests/` tenía `__init__.py`, pytest lo
importaba como subpaquete de `shared.cifrado`, y eso ejecuta el `__init__`
del padre, que importa el cifrador. Se quitó ese `__init__.py` (la carpeta de
pruebas no necesita ser paquete) y el guard del `conftest` hace el resto.

## Qué queda pendiente

- **FE-01**: el modelo `CuentaConectada` que use `CampoCifrado`. Necesita
  VI-27 (connectors ejecutable).
- **Comando `manage.py rotar_claves_cifrado`** en connectors, que llame a
  `rotar_claves()`. Sin `manage.py` no hay dónde ponerlo todavía.
- **El pod de connectors en `k8s/`**: la clave ya queda en el Secret
  esperando a que exista el Deployment.
- **Permisos por esquema en Postgres** (sigue pendiente de `01-esquemas.sql`):
  hoy el cifrado protege el token aunque alguien lea la base; con usuarios
  por esquema además no podría leerla.
