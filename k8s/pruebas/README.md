# Pruebas desde dentro del cluster

## Si solo quieres correr la prueba: un archivo

```bash
NS_CARGA=student-TUUSUARIO ./k8s/pruebas/prueba-de-carga.sh  # namespace externo autorizado
```

Es el único punto de entrada que hay que conocer. Muestra el estado del
cluster, explica qué hace cada opción y llama a los demás scripts por ti:

| Opción | Qué hace | Por debajo |
|---|---|---|
| 1 Panel en vivo | abre otra ventana que acumula durante 30 s (reinicio automático, o manual con `r`/Enter) las peticiones reales, la CPU frenada por el límite y si el pod sigue en el Service; la ventana anterior queda resumida | `ver-estres.sh` |
| 2 Lanzar carga | levanta un pod de Fortio dentro del cluster a N peticiones/s | `estresar.sh N` |
| 3 Demo completa | 1 + 2 seguidos; mientras tanto se navega la web | |
| 4 Cuota | explica el uso de un namespace externo; conserva los workers activos | |
| 5 Devolver | todo de vuelta a 1 réplica, gateway incluido | `kubectl scale … --replicas=1` |
| 6 Comprobar | BusyBox llama al gateway por la red interna y se borra | `diagnostico-busybox.yaml` |
| 7 Limpiar | borra Jobs de Fortio y el pod de diagnóstico | |
| 8 Explicar | qué es esto, qué se va a ver y los números de referencia | |
| 9 Compañeros | los demás lanzan su Fortio (25 qps) desde su namespace; aquí se abre el panel, se muestra el comando que ellos pegan, cuenta regresiva y conteo final | `carga-fortio-otro-namespace.yaml` por URL |
| 11 Comparar tiempos RabbitMQ | tabla HTTP p50/p95 y finalización del trabajo; generador en el computador, sin pods adicionales | `comparar-cola.sh --tiempos` |
| 10 Pods y services | todos los pods con READY, estado, reinicios y nodo, más services y deployments, con conteo | `kubectl get pods/svc/deploy` |

También acepta la acción directa: `prueba-de-carga.sh 100`, `… demo`,
`… liberar`, `… devolver`, `… comprobar`, `… limpiar`, `… explicar`,
`… companeros`, `… pods`, `… comparar`.

El generador corre en otro namespace, con cuota propia y acceso a la entrada
pública (Ingress → web → Gateway). El HPA máximo ocupa **12/12 pods, 2688/2752 MiB y 1750/2000m CPU**;
sumar `carga-fortio.yaml` localmente exige **13 pods y 2816 MiB** y falla.
No se apagan consumidores ni el worker de eliminación para la demostración.
`NS_CARGA` debe ser distinto de `student-forellana` y accesible con tu kubeconfig.
Si tu cuenta solo accede al namespace de aplicación, otro integrante ejecuta
[`GUIA-EQUIPO.md`](GUIA-EQUIPO.md) con su cuenta; aquí se observa el panel.
El manifiesto externo usa la URL pública de `/health/`, sin alterar Host.
Comprobar su cuota, DNS y salida HTTP antes de la demostración.

El CI comprueba explícitamente aplicación y generador externo, y prueba que
el escenario local excedido devuelve error:

```bash
python k8s/pruebas/presupuesto.py k8s --generador k8s/pruebas/carga-fortio-otro-namespace.yaml --namespace-generador student-TUUSUARIO
# El comparador tiene su propio escenario: Job y Secret en student-carga.
python k8s/pruebas/presupuesto.py k8s --generador k8s/pruebas/carga-comparar.yaml --namespace-generador student-carga
# Debe fallar por pods y memoria:
python k8s/pruebas/presupuesto.py k8s --generador k8s/pruebas/carga-fortio.yaml --namespace-generador student-forellana
```

---

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
kubectl -n student-TUUSUARIO apply -f k8s/pruebas/carga-fortio-otro-namespace.yaml
kubectl -n student-TUUSUARIO logs -f job/carga-desde-afuera
```

Fortio devuelve percentiles de latencia (p50, p75, p99), peticiones por segundo
reales y el conteo de códigos de respuesta.

El blanco y la intensidad se editan en `args` dentro del YAML:

| Blanco | Qué atraviesa |
|---|---|
| `http://ojoalgasto-forellana.dev.censei.cl/health/` | Ingress, web y salud de Gateway, sin base de datos |

Las APIs internas no son blancos autorizados para estos generadores.
Para medir operaciones de suscripciones usar
`NS_CARGA=student-carga ./k8s/pruebas/comparar-cola.sh` con `TOKEN_SIN` y
`TOKEN_CON` de dos organizaciones de prueba distintas y vacías. Mantener el
contexto de kubectl en la aplicación; solo el Job y su Secret temporal van al
namespace externo. `40-red.yaml` permite a ese comparador contactar únicamente
al Gateway por su DNS completo, con `Host: gateway`; este valida la identidad.
El namespace externo debe existir y tener cuota y permisos para Job/Secret.
No ejecutar el Job Fortio del comparador dentro del namespace de aplicación: con el HPA máximo excede pods y memoria. La alternativa `--tiempos` siguiente no crea ese Job.

## Que cada integrante pruebe desde su propio notebook

`carga-fortio-otro-namespace.yaml` es para eso: cada persona lo aplica **en su
propio namespace, con su propia cuenta**. Nadie necesita acceso al namespace del
proyecto.

El paso a paso completo está en [`GUIA-EQUIPO.md`](GUIA-EQUIPO.md).

Tiene ventaja sobre correrlo todo desde una sola máquina: cada uno gasta **su**
cuota de CPU, así que el sistema recibe carga real de varios orígenes a la vez.

Desde otro namespace se usa `http://ojoalgasto-forellana.dev.censei.cl/health/`.
El Ingress conserva el host público; web fija `Host: gateway` hacia el backend.
Las políticas siguen bloqueando el acceso entre namespaces al Service interno.
Esta prueba incluye los proxies y la red de entrada.

## Reglas del namespace que hay que respetar

Estas no se pueden consultar (`kubectl get resourcequota` da *Forbidden*), solo
se descubren chocando. Están documentadas en `k8s/README.md`:

- **Mínimo 25m de CPU y 64Mi de memoria** por contenedor
- **Techo de 2 CPU (2000m) en límites para todo el namespace**

Los diez pods del sistema suman **1350m** en reposo
(comprobados con `presupuesto.py` y el escenario externo indicado arriba):

```
worker 300m · subscriptions 200m · gateway 200m · auth 150m · postgres 150m
rabbitmq 100m · auth-eliminaciones 100m · redis 50m · beat 50m · web 50m
```

Con el HPA al máximo son **1750m** y quedan **250m**, pero no queda ningún pod
libre. El generador debe correr en otro namespace aunque sobre CPU. El pod
de diagnóstico también consume cuota: retirarlo antes de medir el HPA máximo.

## Antes de correr una prueba de carga

El cluster es compartido con el resto del curso. Conviene avisar, y no dejar
una prueba corriendo sola: el `Job` termina y se borra a los 10 minutos, pero
el pod de diagnóstico hay que borrarlo a mano.


## Demostrar el autoescalado

El HPA agrega réplicas cuando el promedio de CPU por pod pasa los 120m
(`k8s/30-autoescalado.yaml`). Para verlo reaccionar en vivo hacen falta dos
terminales.

En la primera, mirando el HPA:

```bash
kubectl get hpa -w
```

En la segunda, la carga:

```bash
kubectl -n student-TUUSUARIO apply -f k8s/pruebas/carga-fortio-otro-namespace.yaml
```

En la primera terminal, `REPLICAS` debería pasar de 1 a 2 en menos de un
minuto. Al terminar la carga baja sola, pero con calma: hay dos minutos de
ventana para que no entre en vaivén.

Si la columna `TARGETS` dice `<unknown>` en vez de un número, el HPA no está
recibiendo métricas y no va a escalar nunca. Eso es metrics-server, no el
manifiesto.

**El techo no es arbitrario.** `gateway` y `subscriptions` llegan a 2
porque la cuota permite 12 pods y la base son 10. Pedir más réplicas no daría
más capacidad: el ReplicaSet recibiría `exceeded quota` y el pod no nacería.


## Comparar tiempos con y sin RabbitMQ en la terminal

Para la defensa, usar la opción **11** del menú o la acción `comparar`.
No modifica la página ni necesita Fortio, otro namespace o nuevos permisos:
usa el computador actual (Python 3.9+) y los accesos kubectl existentes.

```bash
export URL_COMPARACION=https://ojoalgasto-forellana.dev.censei.cl
read -rsp 'Token de la organización SIN: ' TOKEN_SIN; echo
read -rsp 'Token de la organización CON: ' TOKEN_CON; echo
export TOKEN_SIN TOKEN_CON
bash k8s/pruebas/prueba-de-carga.sh comparar
# Equivalente: bash k8s/pruebas/comparar-cola.sh --tiempos
unset TOKEN_SIN TOKEN_CON
```

Preparar dos organizaciones sintéticas distintas **vacías**, sesiones con
permiso para crear suscripciones y catálogos migrados. La prueba agrega datos;
no borra suscripciones ni mensajes. Usar cuentas descartables y después seguir
el flujo normal de eliminación de cuentas. Reservar una ventana sin tráfico,
despliegues ni otras tandas; Beat, worker y consumidor deben estar activos.
El outbox y `subscriptions.resumen` deben estar drenados al empezar.

Cada modo hace el mismo recálculo: directo dentro del POST (SIN RabbitMQ para
ese trabajo) o en el consumidor (CON RabbitMQ). El outbox y el broker siguen
activos para los otros eventos del contrato: **no es una app con RabbitMQ
retirado ni una prueba de caída del broker**.

Por defecto: `OPERACIONES=20` por modo/ronda, `REPETICIONES=3`, `CONEXIONES=2`,
`SEMILLA=100`, `ESPERA=120` segundos por comprobación final. Se alterna el orden;
ambas organizaciones crecen igual entre rondas. La carga es de concurrencia
acotada, no de QPS fijo. Se fijan temporalmente ambos HPA a sus réplicas actuales
y se restauran sus límites y el override exacto de la API al terminar o fallar.
No cerrar a la fuerza la terminal: usar Ctrl+C y verificar la restauración.

La tabla muestra p50/p95 HTTP (milisegundos), mediana del tiempo observado hasta
completar el resumen por ronda (segundos), operaciones, errores y variación
`(CON - SIN) / SIN × 100`. Un valor positivo indica que CON tardó más: no se
fabrica una mejora. Los percentiles HTTP agrupan todas las peticiones; la
mediana total usa una duración por ronda. El total empieza antes de los POST
y termina cuando la BD acredita los eventos, su autor y el resumen correcto;
incluye la consulta y el sondeo de **1 s**, no seeding/rollouts/restauración.
Puede sobreestimar el final real por el sondeo y la conexión kubectl. La
publicación pendiente se espera aparte antes del siguiente modo. Un 201 o una
cola vacía solos no prueban finalización; fallos invalidan la comparación.

**Memoria:** no se agregan pods, requests/limits ni procesos permanentes. El
generador consume RAM en el computador; las creaciones y eventos agregan carga
transitoria a API, BD, consumidor y RabbitMQ. Las comprobaciones abren Django
shell temporalmente dentro del contenedor API y comparten su límite de RAM;
no son consumo gratuito. El broker conserva su memoria
base en ambos modos; esta tabla **no demuestra ahorro de RAM** al retirarlo.
Las organizaciones conservan datos de prueba hasta su eliminación normal.

El modo Fortio anterior sigue disponible sin `--tiempos`; mide otra ruta
(Gateway interno) y conserva su requisito de namespace externo autorizado.
No mezclar sus tiempos con los de esta prueba pública, que incluye los proxies.
