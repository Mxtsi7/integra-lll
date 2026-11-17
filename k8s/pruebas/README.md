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
| 11 Comparar tiempos RabbitMQ | tabla HTTP p50/p95 y finalización del trabajo, con avance por ronda; abre en el navegador un snapshot que se actualiza solo e incluye el HPA; generador en el computador, sin pods adicionales | `comparar-cola.sh --tiempos` |
| 12 Autoscaling SIN y CON RabbitMQ | una ronda SIN y una CON con el HPA libre y carga sostenida; cada modo parte con el mínimo de pods y la página muestra hasta cuántos llegó cada uno | `comparar-cola.sh --tiempos` con `AUTOESCALADO=activo` |
| 10 Pods y services | todos los pods con READY, estado, reinicios y nodo, más services y deployments, con conteo | `kubectl get pods/svc/deploy` |

También acepta la acción directa: `prueba-de-carga.sh 100`, `… demo`,
`… liberar`, `… devolver`, `… comprobar`, `… limpiar`, `… explicar`,
`… companeros`, `… pods`, `… comparar`, `… autoescalado`.

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
`40-red.yaml` bloquearía el acceso entre namespaces al Service interno, pero
en este cluster no está aplicado (ver `k8s/README.md`): la prueba usa la
entrada pública porque es la ruta que se quiere medir, no porque la otra esté
cerrada.
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
Genera desde el computador actual (Python 3.9+) contra la URL pública; no
requiere Fortio, otro namespace ni reservas adicionales de pods/CPU/RAM.
El lanzador verifica que Python realmente ejecuta (evita el alias de Microsoft
Store), usa una ruta relativa compatible con Git Bash y salida sin búfer.

```bash
export URL_COMPARACION=https://ojoalgasto-forellana.dev.censei.cl
read -rsp 'Token de la organización SIN: ' TOKEN_SIN; echo
read -rsp 'Token de la organización CON: ' TOKEN_CON; echo
export TOKEN_SIN TOKEN_CON
export AUTOESCALADO=fijo   # o activo: ver "Snapshot en vivo y autoscaling"
bash k8s/pruebas/prueba-de-carga.sh comparar
# Equivalente: bash k8s/pruebas/comparar-cola.sh --tiempos
unset TOKEN_SIN TOKEN_CON
```

**La prueba reinicia la API pública al cambiar de modo.** `Recreate` reemplaza
su pod y provoca interrupciones temporales, también al restaurar el modo.
No aumenta el número de pods concurrentes, pero sí crea pods de reemplazo.
La terminal avisa y exige escribir `SI` antes de acceder al clúster. Para una
ventana controlada ya autorizada y no interactiva:
`bash k8s/pruebas/comparar-cola.sh --tiempos --si`.

Preparar dos organizaciones sintéticas distintas **vacías**, sesiones con
permiso para crear suscripciones y catálogos migrados. Se revisa `exp` al
empezar y antes de cada fase: deben quedar al menos dos minutos; esto no
sustituye la validación de firma/revocación del Gateway. Un fallo puede dejar
datos parciales; no se reutilizan organizaciones no vacías ni se borran datos
sin permiso. Renovar sesiones y usar cuentas nuevas, o eliminar las anteriores
por el flujo normal. No se borra outbox ni se purgan colas para aparentar éxito.

Reservar una ventana sin tráfico, despliegues ni otras tandas. Beat, worker y
consumidor deben estar activos. Se espera el drenaje del outbox y de
`subscriptions.resumen` con reintentos acotados, no una única lectura.

Cada modo hace el mismo recálculo: directo dentro del POST (SIN RabbitMQ para
ese trabajo) o en el consumidor (CON RabbitMQ). El outbox y el broker siguen
activos para los otros eventos del contrato: **no es una app con el broker
retirado ni una prueba de caída de RabbitMQ**.

Por defecto: `OPERACIONES=20` medidas por modo/ronda, `REPETICIONES=3`,
`CONEXIONES=2`, `SEMILLA=100`, `CALENTAMIENTO=2`, `ESPERA=120` segundos por
comprobación final. Los POST de calentamiento usan otra correlación, se espera
su resultado y drenaje y se excluyen de las muestras. Ambas organizaciones
crecen igual, incluido el calentamiento; el orden de los modos alterna.
La carga tiene concurrencia acotada, no QPS fijo.

### Qué significan los tiempos

| Fila | Medición y límite |
|---|---|
| HTTP p50/p95 (ms) | Reloj monotónico del computador, petición completa. Incluye proxies/red y trabajo síncrono. |
| Lote eventos→resumen BD (s), mínimo/p50/máximo | `max(TrabajoDerivado.hecho_en) - min(OutboxEvento.ocurrido_en)` por correlación. Excluye el sondeo, calentamiento, seeding y rollouts; empieza al registrar el primer evento, no al entrar el primer HTTP. |
| Outbox/Beat→marca publicación (ms), mínimo/p50/máximo | `publicado_en - ocurrido_en` por evento CON. Incluye el ciclo de Beat **cada 10 s**, despacho y confirmación; no es tiempo puro del broker. |
| Marca publicación→evidencia (ms), mínimo/p50/máximo | `hecho_en - publicado_en` por evento CON: desfase firmado entre marcas persistidas, no latencia AMQP aislada. |

**La espera de Beat no se atribuye al costo de RabbitMQ.** Las tres rondas
pueden caer en diferentes fases de su ciclo de diez segundos; se exponen
mínimo y máximo junto con la mediana. Los percentiles HTTP agrupan peticiones;
las estadísticas del lote usan una duración por ronda; las etapas CON usan
una duración por evento. No se suman medianas de etapas para construir un total.

`despacho.py` guarda `publicado_en` después de recibir el confirm y cerrar la
conexión AMQP. El consumidor puede acreditar antes: el último desfase puede
ser negativo por **solapamiento**, que se cuenta y muestra sin truncarlo a
cero. No implica viaje hacia atrás ni una mejora de RabbitMQ. Las marcas las
generan procesos de aplicación y requieren relojes sincronizados; no son
marcas del commit de PostgreSQL ni un perfil interno del broker.

El sondeo sirve solo para acreditar cantidades, autores y resumen final; no
se suma a los tiempos BD aunque arranque Django o tarde varios segundos.
Se espera además la publicación antes de seguir. Cualquier error, falta de
evidencia o vencimiento invalida la comparación. La variación usa
`(CON - SIN) / SIN × 100`: positivo significa que CON tardó más.

### Snapshot en vivo y autoscaling

Al empezar, la terminal imprime la ruta de una página y la abre en el navegador
(`ABRIR_SNAPSHOT=0` para no abrirla). Es un HTML que no necesita internet ni
servidor: se recarga cada 5 s mientras corre la prueba y queda fijo al terminar,
junto a un JSON con los mismos datos, en `k8s/pruebas/resultados/` (git lo
ignora). Sirve para mostrar la comparación en vivo y para guardarla como
evidencia. No contiene tokens ni identificadores de organización.

La página muestra cada POST medido apenas responde (hueco hasta que se acredita
el trabajo de su ronda), el tiempo del primer evento al resumen por
ronda, la tabla de rondas con las réplicas, la tabla final cuando termina y el
autoscaling: la CPU promedio por pod de `gateway` y `subscriptions` contra el
objetivo de 120m, sus réplicas y las que pide el HPA, con franjas que marcan
cuándo corrieron los POST de cada modo y los reinicios de la API. El muestreo es
`kubectl get hpa` cada 5 s, solo lectura. Si la comparación falla, la página
queda marcada como inválida con el motivo.

La terminal también avanza por ronda: p50/p95 HTTP, tiempo evento→resumen y
estado del HPA de cada fase, más una tabla parcial al cerrar cada ronda.

`AUTOESCALADO` elige qué hace el HPA mientras se mide:

| Valor | Qué pasa | Para qué |
|---|---|---|
| `fijo` (por defecto) | El HPA se fija en las réplicas actuales; si cambian, la comparación se invalida. La página muestra lo que habría pedido el HPA con su fórmula: `ceil(réplicas × CPU ÷ objetivo)`, tolerancia de 10 % y límites originales. | Comparar tiempos con la misma cantidad de pods. |
| `activo` | El HPA queda libre. Antes de la carga de cada modo se espera que vuelva a su mínimo de pods, así ninguno hereda los que escaló el anterior. Exige un HPA de 1 a 2 réplicas para `gateway` y otro para `subscriptions`: si no, no parte. Se sigue exigiendo la misma imagen y recursos, y al menos un pod disponible. | Ver cuántos pods necesita cada modo. |

#### Autoscaling SIN y CON RabbitMQ (opción 12)

Para mostrar el autoscaling en los dos modos, la opción 12 (`prueba-de-carga.sh
autoescalado`) corre una ronda SIN y una CON con `AUTOESCALADO=activo` y una
carga sostenida: 500 operaciones con 8 conexiones y 300 s para acreditar el
trabajo. Se cambian con `OPERACIONES_HPA`, `CONEXIONES_HPA` y `ESPERA_HPA`,
para no mezclarlas con las de la opción 11.

```bash
export URL_COMPARACION=https://ojoalgasto-forellana.dev.censei.cl
read -rsp 'Token de la organización SIN: ' TOKEN_SIN; echo
read -rsp 'Token de la organización CON: ' TOKEN_CON; echo
export TOKEN_SIN TOKEN_CON
bash k8s/pruebas/prueba-de-carga.sh autoescalado
unset TOKEN_SIN TOKEN_CON
```

La carga tiene que ser larga porque el HPA no ve picos: recalcula cada ~15 s
con el promedio de CPU por pod que entrega metrics-server, y un pod nuevo
tarda decenas de segundos en estar listo. Con 20 operaciones la ráfaga dura
segundos y el promedio no alcanza el objetivo de 120m. Cada modo parte con el
mínimo de pods: el comparador espera hasta 6 minutos a que el HPA baje (su
ventana de bajada es de 120 s) y, si no baja, invalida la prueba en vez de
medir con pods heredados.

La página muestra arriba hasta cuántos pods llegó cada HPA en cada modo, y la
tabla de rondas la CPU máxima. Con estos parámetros, en cada modo el
`gateway` hace el mismo trabajo, mientras que `subscriptions` hace el
recálculo solo en SIN. Se espera que SIN necesite más pods de `subscriptions`
que CON, pero eso lo dice la corrida real, no el diseño. Cada corrida deja
unas 600 suscripciones sintéticas en cada organización (semilla, calentamiento
y las 500 medidas): para repetirla, usar organizaciones nuevas y vacías. El techo sigue siendo 2 réplicas por HPA, y
el respaldo y `--restaurar` funcionan igual que en la opción 11.

### Recuperación después de cerrar la ventana

Antes de cambiar HPA o modo se guarda el original en la anotación
`ojoalgasto.cl/comparador-original` de la **metadata del Deployment**, sin
provocar rollout. Contiene HPA, UID de objetos y forma exacta del override de
API (ausente/literal/valueFrom), **sin tokens**. La creación usa la versión
del objeto para impedir que dos procesos adquieran el respaldo a la vez.

Una ejecución nueva rechaza una marca pendiente. Incluso si el proceso murió
por SIGKILL o se cerró el computador, recuperar desde el mismo contexto y
namespace, sin URL ni sesiones:

```bash
bash k8s/pruebas/comparar-cola.sh --restaurar
```

Se restauran y comprueban API y HPA antes de retirar la marca. Si algo falla,
se conserva y se imprimen los valores originales y comandos Bash exactos para
repararlos; reintentar `--restaurar` para verificar y limpiar. No quitar la
anotación a mano ni iniciar una comparación sobre el estado dañado.
Se rechaza también un HPA previamente fijado o un literal de API ajeno al
manifiesto; estados heredados sin respaldo deben conciliarse con la
configuración aprobada antes de medir, sin adivinar sus valores anteriores.

Ctrl+C, SIGTERM y SIGHUP intentan recuperación automática. Durante esa limpieza
se difieren las señales y los kubectl corren en un grupo independiente para
que Ctrl+C de la terminal no mate al comando que está restaurando. SIGKILL
no admite limpieza automática: para eso existe el respaldo durable.

**Memoria:** no se agregan reservas ni procesos permanentes. El generador usa
RAM del computador; las operaciones y las verificaciones Django temporales
consumen dentro de los límites existentes de API/BD/consumidor/RabbitMQ. El
broker conserva su memoria base en ambos modos: **la tabla no demuestra ahorro
de RAM al retirarlo**. Los datos sintéticos permanecen hasta eliminarlos.

El modo Fortio anterior sigue sin `--tiempos` y conserva su namespace externo.
Mide Gateway interno; no mezclar esos tiempos con esta prueba pública.
