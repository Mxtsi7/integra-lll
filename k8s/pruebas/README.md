# Pruebas desde dentro del cluster

Dos cosas que **no se pueden ver desde internet**, porque desde afuera solo
existe el ingress:

- si el DNS del cluster resuelve los Services y los pods se alcanzan entre sí
- cómo responde un servicio bajo carga, sin el ruido del proxy de la universidad

## Por qué desde dentro y no desde un notebook

Son dos mediciones distintas y conviene no confundirlas.

| Desde dónde | Qué recorre | Qué mide |
|---|---|---|
| Un computador cualquiera, contra `https://ojoalgasto-forellana.dev.censei.cl` | proxy UCT → nginx → gateway → servicio | la cadena completa |
| Un pod del cluster, contra `http://auth:8001` | solo el servicio | el servicio solo |

La primera no necesita permiso ni Kubernetes: el sitio es público, basta
instalar Fortio en cualquier máquina. Pero si sale lento, no se sabe cuál de
los cuatro saltos fue. La segunda es la que aísla el problema.

## Diagnóstico de red (BusyBox)

```bash
kubectl apply -f k8s/pruebas/diagnostico-busybox.yaml
kubectl exec -it diagnostico -- sh
```

Dentro del pod:

```sh
nslookup auth                        # el DNS del cluster resuelve el Service
wget -qO- http://auth:8001/health/
wget -qO- http://subscriptions:8002/health/
wget -qO- http://gateway:8000/health/
```

Al terminar:

```bash
kubectl delete -f k8s/pruebas/diagnostico-busybox.yaml
```

El pod se apaga solo a la hora si alguien se olvida.

## Prueba de carga (Fortio)

```bash
kubectl apply -f k8s/pruebas/carga-fortio.yaml
kubectl logs -f job/carga-fortio
```

Fortio devuelve percentiles de latencia (p50, p75, p99), peticiones por segundo
reales y el conteo de códigos de respuesta.

El blanco y la intensidad se editan en `args` dentro del YAML:

| Blanco | Qué atraviesa |
|---|---|
| `http://gateway:8000/health/` | solo el gateway, sin tocar la base |
| `http://auth:8001/health/` | Django + una consulta a Postgres |
| `http://subscriptions:8002/health/` | ídem, el otro servicio |

Correr los tres en ese orden cuenta una historia: cuánto cuesta el gateway,
cuánto agrega la base, y si los dos servicios se comportan igual.

## Que cada integrante pruebe desde su propio notebook

`carga-fortio-otro-namespace.yaml` es para eso: cada persona lo aplica **en su
propio namespace, con su propia cuenta**. Nadie necesita acceso al namespace del
proyecto.

El paso a paso completo está en [`GUIA-EQUIPO.md`](GUIA-EQUIPO.md).

Tiene ventaja sobre correrlo todo desde una sola máquina: cada uno gasta **su**
cuota de CPU, así que el sistema recibe carga real de varios orígenes a la vez.

**Las dos cosas que cambian respecto del uso interno:**

| | Dentro del namespace | Desde otro namespace |
|---|---|---|
| URL | `http://gateway:8000` | `http://gateway.student-forellana.svc.cluster.local:8000` |
| Cabecera | ninguna | `-H "Host: gateway"` |

La cabecera **no es opcional**. Los servicios corren con `DEBUG=False` y Django
solo acepta los hosts de `ALLOWED_HOSTS`, donde está `gateway` pero no el nombre
largo. Medido:

```
gateway:8000                                      ->  200 OK
gateway.student-forellana.svc.cluster.local:8000  ->  400 Bad Request
el mismo + Host: gateway                          ->  200 OK
```

## Reglas del namespace que hay que respetar

Estas no se pueden consultar (`kubectl get resourcequota` da *Forbidden*), solo
se descubren chocando. Están documentadas en `k8s/README.md`:

- **Mínimo 25m de CPU y 64Mi de memoria** por contenedor
- **Techo de 2 CPU (2000m) en límites para todo el namespace**

Los nueve pods del sistema ya consumen **1600m**:

```
auth 250m · postgres 250m · subscriptions 250m · gateway 200m
worker 200m · rabbitmq 150m · redis 100m · beat 100m · web 100m
```

Quedan **~400m**. Por eso el Job de carga pide 200m y el de diagnóstico 50m.
Subir esos números puede dejar el pod en `Pending` o, peor, impedir que un
despliegue levante los suyos.

## Antes de correr una prueba de carga

El cluster es compartido con el resto del curso. Conviene avisar, y no dejar
una prueba corriendo sola: el `Job` termina y se borra a los 10 minutos, pero
el pod de diagnóstico hay que borrarlo a mano.
