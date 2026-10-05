# Probar Ojo al Gasto desde el cluster — guía para el equipo

Esto es para que **cada uno, desde su propio notebook**, lance una prueba de
carga contra los servicios del proyecto que corren en Kubernetes.

Cada persona usa **su propia cuenta y su propio namespace**. No necesitas acceso
al namespace de nadie.

**Tiempo: 15 minutos la primera vez, 1 minuto las siguientes.**

---

## Antes de la clase, no durante

Hagan los pasos 1 al 4 **antes**. El paso 4 confirma que todo quedó bien; si
falla, hay tiempo de arreglarlo. En vivo solo se corre el paso 5.

---

## 1. Instalar las dos herramientas

Abre PowerShell y pega esto:

```powershell
winget install -e --id Kubernetes.kubectl
winget install -e --id int128.kubelogin
```

- **kubectl** es el que habla con el cluster.
- **kubelogin** es el que abre el navegador para que entres con tu usuario.

Cierra y vuelve a abrir PowerShell para que tome el PATH.

Comprueba que quedaron:

```powershell
kubectl version --client
kubectl oidc-login --version
```

> Si `kubectl oidc-login` dice que no existe, kubelogin quedó instalado pero
> fuera del PATH. Busca la carpeta con:
> ```powershell
> Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "kubectl-oidc_login.exe" | Select-Object -First 1 -ExpandProperty DirectoryName
> ```
> y agrégala al PATH, o copia ese `.exe` a la misma carpeta donde está `kubectl`.

## 2. Poner el kubeconfig

Felipe les pasa el archivo **`kubeconfig-plantilla.yaml`** por el grupo.
No está en el repositorio a propósito: es público, y un archivo de
configuración de cluster ahí se presta a confusiones aunque no lleve claves.

**No tiene contraseñas ni tokens**: solo dice dónde está el cluster. Tú entras
con tu propio usuario LDAP desde el navegador.

Ábrelo con el Bloc de notas y **reemplaza las 3 apariciones de `TUUSUARIO`** por
tu usuario institucional (el del correo, sin el `@alu.uct.cl`).

Por ejemplo, si tu correo es `jperez2024@alu.uct.cl`, tu usuario es `jperez2024`:

```yaml
    namespace: student-jperez2024
  name: estudiante-jperez2024
current-context: estudiante-jperez2024
```

Guárdalo como el archivo `config` (sin extensión) dentro de la carpeta `.kube`
de tu usuario:

```powershell
mkdir "$env:USERPROFILE\.kube" -Force
# después copia ahí el archivo, renombrado a  config  (sin .yaml)
```

## 3. Entrar al cluster

```powershell
kubectl get pods
```

Se abre el navegador y te pide tu usuario y clave institucional. Al terminar
dice *"authentication complete"* y puedes cerrar esa pestaña.

Si tu namespace está vacío, la respuesta normal es:

```
No resources found in student-TUUSUARIO namespace.
```

**Eso significa que funcionó.** Estás dentro.

> ⚠️ El login por navegador **expira a los 3 minutos**. Si te demoras, vuelve a
> correr el comando.

> ⚠️ Si usas Docker Compose del proyecto, apágalo antes: el login usa un puerto
> local y el gateway del proyecto puede estar ocupándolo.

## 4. Comprobar que alcanzas los servicios del proyecto

Este es el paso que hay que hacer **antes** de la clase, porque si falla hay que
pedirle algo al profe.

```powershell
kubectl run prueba --rm -it --restart=Never --image=busybox:1.36 --overrides='{\"spec\":{\"containers\":[{\"name\":\"p\",\"image\":\"busybox:1.36\",\"command\":[\"wget\",\"-qO-\",\"-T\",\"8\",\"--header=Host: gateway\",\"http://gateway.student-forellana.svc.cluster.local:8000/health/\"],\"resources\":{\"requests\":{\"cpu\":\"25m\",\"memory\":\"64Mi\"},\"limits\":{\"cpu\":\"50m\",\"memory\":\"64Mi\"}}}]}}'
```

**Si responde esto, estás listo:**

```json
{"servicio": "gateway", "estado": "ok"}
```

**Si se queda colgado o dice que no se puede conectar**, hay una regla de red
entre namespaces y el profe tiene que abrirla. Avisen en el grupo apenas pase.

## 5. Lanzar la prueba de carga (esto es lo de la clase)

```powershell
kubectl apply -f carga-fortio-otro-namespace.yaml
kubectl logs -f job/carga-desde-afuera
```

Dura 30 segundos. Al final muestra algo así:

```
Code 200 : 750 (100.0 %)
All done 750 calls, 155.740 ms avg, 25.0 qps
# target 50% 0.181831
# target 99% 0.248946
Sockets used: 758 (for perfect keepalive, would be 4)
```

Al terminar, **borra el Job**:

```powershell
kubectl delete -f carga-fortio-otro-namespace.yaml
```

---

## Qué mirar en el resultado

| Línea | Qué significa |
|---|---|
| `Code 200 : ... (100.0 %)` | ninguna petición falló |
| `avg` y `target 99%` | latencia promedio y la del 1% más lento |
| `qps` | peticiones por segundo que realmente logró |
| `Sockets used` | conexiones TCP abiertas (ver abajo) |

**Lo interesante pasa cuando todos lanzan a la vez.** Cada notebook pide 25
peticiones por segundo. Con cuatro personas son 100, y el gateway del proyecto
se queda en unos **51** — porque tiene asignada una quinta parte de un núcleo de
CPU. Ahí se ve la saturación en vivo, y la latencia sube.

**El dato de los sockets** también da para conversar: Fortio avisa que *"for
perfect keepalive, would be 4"* pero usa una conexión por petición. Es porque el
servidor cierra la conexión después de cada respuesta — gunicorn con workers
`sync` no mantiene conexiones abiertas, para no dejar un worker bloqueado
esperando a un cliente que quizás no pida nada más.

---

## Las dos cosas que NO hay que cambiar

En el archivo `carga-fortio-otro-namespace.yaml`:

**1. El nombre completo del servicio.**
`gateway.student-forellana.svc.cluster.local` — el nombre corto `gateway` solo
funciona dentro del namespace del proyecto, no desde el tuyo.

**2. La cabecera `-H "Host: gateway"`.**
Sin ella **todas las peticiones responden 400** y la prueba no mide nada. Los
servicios corren con `DEBUG=False` y Django solo acepta los nombres de host que
tiene en su lista; el nombre largo no está.

Comprobado:

```
gateway:8000                                      ->  200 OK
gateway.student-forellana.svc.cluster.local:8000  ->  400 Bad Request
el mismo + Host: gateway                          ->  200 OK
```

## Si quieren apuntar a otro servicio

Hay que cambiar **las dos cosas juntas**:

| Servicio | URL | Cabecera |
|---|---|---|
| gateway | `gateway.student-forellana.svc.cluster.local:8000` | `Host: gateway` |
| auth | `auth.student-forellana.svc.cluster.local:8001` | `Host: auth` |
| subscriptions | `subscriptions.student-forellana.svc.cluster.local:8002` | `Host: subscriptions` |

`gateway/health/` no toca la base de datos; `auth/health/` y
`subscriptions/health/` sí hacen una consulta. Comparar los tres muestra cuánto
cuesta la base.

## Problemas típicos

| Lo que ves | Qué pasa |
|---|---|
| `Code 400 : ...` | te falta la cabecera `-H "Host: gateway"` |
| El Job queda en `Pending` | te quedaste sin cuota de CPU; baja el `limits` o borra pods viejos |
| `couldn't get current server API group list` | se venció el login, corre `kubectl get pods` de nuevo |
| `context deadline exceeded` | el login del navegador expiró (3 min), repítelo |
| `No resources found` | **no es error**, tu namespace está vacío |
