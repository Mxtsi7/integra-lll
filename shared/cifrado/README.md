# Cifrado de secretos en reposo (`shared/cifrado`)

Tarea FE-06 · RN-SEG-001 · ADR-005, consecuencia 2: *los tokens de los
conectores se almacenan cifrados y nunca se exponen en la interfaz ni en los
registros*.

Es código compartido, igual que `shared/tenant`: cualquier servicio lo
importa. El primero en usarlo es `connectors` (tokens OAuth de Gmail/Outlook,
FE-01 y FE-04).

## Qué garantiza

| Criterio de FE-06 | Cómo |
|---|---|
| La base no contiene tokens legibles | `CampoCifrado` cifra con Fernet antes de escribir y descifra al leer. En la columna solo hay un token `gAAAAA…` |
| Leer con una clave inválida falla sin filtrar el secreto | `ClaveDeCifradoInvalida` dice el motivo; ningún mensaje ni log incluye el cifrado, el texto plano ni la clave |
| …y sin inutilizar otras cuentas | La fila que no se puede descifrar entrega `SECRETO_ILEGIBLE` (falsy) en vez de lanzar. Un listado con 50 cuentas y una ilegible sigue respondiendo; esa cuenta se marca "reautorizar" |
| Claves por entorno, fuera del repo | Variable `CLAVES_CIFRADO`. En local va en `.env` (ignorado por git); en el cluster, en el Secret `ojoalgasto`, que `k8s/desplegar.sh` genera |
| Estrategia de rotación | Varias claves a la vez: la primera cifra, todas descifran. `rotar_claves()` re-cifra lo viejo sin apagar nada |
| Secretos fuera de respuestas | `CampoSecretoSerializer`: el token entra por POST/PATCH y nunca sale en un GET |

## Cómo se usa

**Modelo** (en `services/connectors/app/models.py`, por ejemplo):

```python
from shared.cifrado import CampoCifrado
from shared.tenant.base import ModeloTenant

class CuentaConectada(ModeloTenant):
    proveedor = models.CharField(max_length=20)
    access_token = CampoCifrado(null=True, blank=True)
    refresh_token = CampoCifrado(null=True, blank=True)
```

Se lee y escribe como un texto normal: `cuenta.access_token = "ya29..."`,
`cuenta.save()`, `cuenta.access_token` devuelve el texto plano.

**Serializer**: los campos cifrados se declaran **siempre explícitos**. Un
`ModelSerializer` con `fields = "__all__"` devolvería el token descifrado,
porque para Django ya es texto.

```python
from shared.cifrado import CampoSecretoSerializer

class CuentaConectadaSerializer(serializers.ModelSerializer):
    access_token = CampoSecretoSerializer(required=False)
    refresh_token = CampoSecretoSerializer(required=False)

    class Meta:
        model = CuentaConectada
        fields = ["id", "proveedor", "estado", "access_token", "refresh_token"]
```

**Logs**: nunca el valor. `redactar(token)` devuelve `***`.

**Cuenta ilegible** (su clave ya no está en la lista):

```python
if not cuenta.access_token:          # None o SECRETO_ILEGIBLE
    cuenta.estado = "reautorizar"
```

Guardar una fila cuyo secreto es ilegible lanza `ClaveDeCifradoInvalida`:
el dato original queda intacto para cuando vuelva la clave. Los demás campos
se pueden guardar con `save(update_fields=[...])`.

**Lo que no se puede hacer**: filtrar por un campo cifrado
(`filter(access_token=x)` nunca coincide, cada cifrado lleva otro IV). Es a
propósito.

## La variable `CLAVES_CIFRADO`

Una o más claves Fernet separadas por coma. **La primera cifra, todas
descifran.**

Generar una:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

| Dónde | Cómo llega |
|---|---|
| Local | `.env` (`.env.example` tiene la línea vacía con la instrucción) |
| Docker Compose | `env_file: .env` |
| Kubernetes | `k8s/desplegar.sh` la agrega al Secret `ojoalgasto` si no existe |
| CI | no hace falta: las pruebas generan claves al vuelo |

Si falta, el servicio arranca igual y falla recién al cifrar o descifrar con
`CifradoNoConfigurado` (mensaje claro, sin secretos).

## Rotar la clave

Sin apagar el servicio y sin perder lo guardado:

1. Generar `NUEVA`. Dejar `CLAVES_CIFRADO=NUEVA,VIEJA` (la nueva **primera**).
2. Redesplegar. Desde ahora todo lo nuevo se cifra con `NUEVA`; lo viejo
   sigue legible por `VIEJA`.
3. Re-cifrar lo que quedó con la vieja:

   ```python
   from shared.cifrado import rotar_claves
   rotar_claves(CuentaConectada.objects.all(), ["access_token", "refresh_token"])
   # {'revisadas': 120, 'rotadas': 118, 'ilegibles': 0}
   ```

   Cuando `connectors` tenga su `manage.py`, esto va en un comando
   `rotar_claves_cifrado` que llama a esa función.
4. Dejar `CLAVES_CIFRADO=NUEVA` y redesplegar.

Si se salta el paso 3, las filas viejas quedan `SECRETO_ILEGIBLE` y esas
cuentas tienen que reautorizar. `rotar_claves` las cuenta en `ilegibles` y
no las sobrescribe.

## Cómo funciona por dentro

- **Fernet** (`cryptography`): AES-128-CBC + HMAC-SHA256 con clave derivada
  de los 32 bytes de la clave. Cifrado autenticado: si alguien edita un byte
  en la base, descifrar falla en vez de devolver basura.
- **`MultiFernet`**: la lista de claves. `cifrar` usa la primera;
  `descifrar` prueba en orden.
- **`CampoCifrado(TextField)`**: `get_prep_value` cifra al guardar (también
  al guardar un valor que vino de la base, así cada `save()` re-cifra con la
  clave vigente); `from_db_value` descifra al leer y devuelve un
  `TextoDescifrado`, que es un `str` con la marca
  `cifrado_con_clave_actual`, lo que permite a `rotar_claves` saber qué
  filas tocar.
- **Una instancia por proceso** (`obtener_cifrador()`): lee la variable una
  vez. `reiniciar_cifrador()` la olvida (pruebas, o después de rotar en un
  proceso vivo).

## Pruebas

```bash
pip install -r shared/requirements-pruebas.txt
pytest shared -v        # 32 pruebas: cifrador, campo, serializer, rotación
```

Corren con sqlite en memoria y una app de prueba (`tests/app_prueba`). El
CI tiene el trabajo `shared · cifrado`. Si un servicio recoge estas pruebas
por accidente (porque `shared/` va dentro de la imagen), el `conftest` las
excluye.

## Archivos

| Archivo | Qué hay |
|---|---|
| `cifrador.py` | `Cifrador`, `generar_clave`, `redactar`, errores. Sin Django |
| `campos.py` | `CampoCifrado`, `SECRETO_ILEGIBLE`, `TextoDescifrado` |
| `serializers.py` | `CampoSecretoSerializer` |
| `rotacion.py` | `rotar_claves` |
| `tests/` | las pruebas y la app de prueba |
