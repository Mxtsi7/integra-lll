# Probar Ojo al Gasto desde el cluster — versión Linux

Es la misma actividad de [`GUIA-EQUIPO.md`](GUIA-EQUIPO.md), pero con los
comandos para una terminal Linux (Ubuntu, Debian, Fedora, Arch o WSL2 da lo
mismo: todo va con `curl`, no con el gestor de paquetes de cada distro).

**Tiempo: 15 minutos la primera vez, 1 minuto las siguientes.**

Hagan los pasos 1 al 4 **antes** de la clase. En vivo solo se corre el paso 5.

---

## 1. Instalar las dos herramientas

Necesitas `curl` y `unzip`. Si no están: `sudo apt install curl unzip` (Debian/Ubuntu)
o `sudo dnf install curl unzip` (Fedora).

**kubectl** (el que habla con el cluster):

```bash
cd /tmp
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl
kubectl version --client
```

**kubelogin** (el que abre el navegador para entrar con tu usuario). Ojo con el
nombre final del binario: kubectl lo busca como `kubectl-oidc_login`, con guion
bajo, y el zip lo trae como `kubelogin`.

```bash
cd /tmp
curl -LO https://github.com/int128/kubelogin/releases/download/v1.36.4/kubelogin_linux_amd64.zip
unzip -o kubelogin_linux_amd64.zip
sudo install -m 0755 kubelogin /usr/local/bin/kubectl-oidc_login
kubectl oidc-login --version
```

Si la última línea imprime una versión, quedó bien.

> Si tu máquina es ARM (por ejemplo una Raspberry o un notebook con chip ARM),
> cambia `amd64` por `arm64` en las dos descargas.

## 2. Poner el kubeconfig

Felipe les pasa el archivo **`kubeconfig-plantilla.yaml`** por el grupo. No tiene
contraseñas ni tokens: solo dice dónde está el cluster. Tú entras con tu propio
usuario LDAP desde el navegador.

Reemplaza `TUUSUARIO` por tu usuario institucional (el del correo, sin el
`@alu.uct.cl`). Si tu correo es `jperez2024@alu.uct.cl`, tu usuario es `jperez2024`:

```bash
mkdir -p ~/.kube
cp ~/Descargas/kubeconfig-plantilla.yaml ~/.kube/config    # ajusta la ruta si lo bajaste a otro lado
sed -i 's/TUUSUARIO/jperez2024/g' ~/.kube/config            # <- pon TU usuario
chmod 600 ~/.kube/config
grep -c jperez2024 ~/.kube/config                           # debe decir 3
```

Si el `grep` dice 3, las tres apariciones quedaron reemplazadas.

## 3. Entrar al cluster

```bash
kubectl get pods
```

Se abre el navegador y te pide tu usuario y clave institucional. Al terminar dice
*"authentication complete"* y puedes cerrar esa pestaña.

Si tu namespace está vacío, la respuesta normal es:

```
No resources found in student-TUUSUARIO namespace.
```

**Eso significa que funcionó.** Estás dentro.

> ⚠️ El login por navegador **expira a los 3 minutos**. Si te demoras, vuelve a
> correr el comando.

> **Si no se abre ningún navegador** (WSL2, una máquina por SSH, un escritorio sin
> `xdg-open`): el comando igual imprime una URL que empieza con
> `https://auth.dev.censei.cl/...`. Cópiala y ábrela a mano en cualquier
> navegador del mismo computador. En WSL2 sirve el navegador de Windows: el
> puerto `127.0.0.1:18000` que usa el login se comparte entre Windows y WSL.

## 4. Comprobar que alcanzas los servicios del proyecto

Este es el paso que hay que hacer **antes** de la clase, porque si falla hay que
pedirle algo al profe.

Desde aquí todos los comandos se corren **parados en la raíz del repositorio**
(la carpeta donde está `docker-compose.yml`):

```bash
cd ~/ruta/al/repo/integra-lll      # ajusta
git checkout main && git pull
```

Se levanta un pod de prueba, se le pide que llame al gateway, y se borra:

```bash
kubectl apply -f k8s/pruebas/diagnostico-busybox.yaml
kubectl wait --for=condition=Ready pod/diagnostico --timeout=90s
kubectl exec diagnostico -- wget -qO- -T 8 --header="Host: gateway" http://gateway.student-forellana.svc.cluster.local:8000/health/
kubectl delete -f k8s/pruebas/diagnostico-busybox.yaml
```

**Si el `exec` responde esto, estás listo:**

```json
{"servicio": "gateway", "estado": "ok"}
```

**Si se queda colgado o dice que no se puede conectar**, hay una regla de red
entre namespaces y el profe tiene que abrirla. Avisen en el grupo apenas pase.

## 5. Lanzar la prueba de carga (esto es lo de la clase)

Parado en la raíz del repositorio. El archivo es
`carga-fortio-otro-namespace.yaml`, no `carga-fortio.yaml` (ese solo funciona
desde el namespace del proyecto):

```bash
kubectl apply -f k8s/pruebas/carga-fortio-otro-namespace.yaml
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

Al terminar, **borra el Job**, o te quedas con la cuota de CPU ocupada:

```bash
kubectl delete -f k8s/pruebas/carga-fortio-otro-namespace.yaml
```

Qué significa cada línea, qué pasa cuando todos lanzan a la vez y las dos cosas
que **no** hay que cambiar del YAML están explicadas en
[`GUIA-EQUIPO.md`](GUIA-EQUIPO.md), desde "Qué mirar en el resultado".

## Problemas típicos en Linux

| Lo que ves | Qué pasa |
|---|---|
| `error: unknown command "oidc-login"` | el binario no se llama `kubectl-oidc_login` o no está en el PATH; repite el `install` del paso 1 |
| `permission denied` al leer `~/.kube/config` | te faltó el `chmod 600`, o copiaste el archivo con `sudo` y quedó de root: `sudo chown $USER ~/.kube/config` |
| `dial tcp [::1]:8080: connect: connection refused` | kubectl no encontró `~/.kube/config`; revisa el paso 2 |
| no se abre el navegador | copia la URL que imprime el comando y ábrela a mano (ver paso 3) |
| `context deadline exceeded` | el login expiró (3 min), repítelo |
| `couldn't get current server API group list` | se venció la sesión, corre `kubectl get pods` de nuevo |
| `the path "..." does not exist` | no estás en la raíz del repo |
| El Job queda en `Pending` | te quedaste sin cuota de CPU; borra Jobs o pods viejos |
| `No resources found` | **no es error**, tu namespace está vacío |
