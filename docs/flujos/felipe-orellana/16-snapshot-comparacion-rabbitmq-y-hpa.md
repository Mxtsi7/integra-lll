# Snapshot en vivo de la comparación con y sin RabbitMQ, con autoscaling

**Qué hace.** El profesor pidió ver la comparación con y sin RabbitMQ en vivo,
como un snapshot. El comparador de #141 corría en la terminal y mostraba los
números recién al final. Ahora, al empezar, abre en el navegador una página
que se recarga sola cada 5 s mientras corre la prueba: cada POST medido, el
tiempo del primer evento al resumen, las rondas y el autoscaling de Kubernetes
(CPU por pod contra el objetivo del HPA, réplicas reales y las que pide el
HPA). Al terminar queda fija como evidencia, junto a un JSON con los mismos
datos. La terminal también avanza ronda por ronda, en vez de quedarse muda
hasta la tabla final.

Con `AUTOESCALADO=fijo` (por defecto) el HPA se congela para medir los dos
modos con las mismas réplicas, como antes, y la página muestra cuántas habría
pedido. Con `AUTOESCALADO=activo` el HPA queda libre: cada modo parte con el
mínimo de pods y la página muestra hasta cuántos llegó cada uno.

Lo que pidió el equipo para la defensa es **una corrida SIN RabbitMQ con
autoscaling y otra CON RabbitMQ con autoscaling**. Eso es la opción 12 del menú
(`prueba-de-carga.sh autoescalado`): una ronda de cada modo, con el HPA libre y
una carga sostenida (500 operaciones, 8 conexiones) para que el HPA alcance a
reaccionar.

**Dónde está.**

| Pieza | Archivo |
|---|---|
| El registro, el muestreo del HPA y la página HTML | `k8s/pruebas/snapshot_comparador.py` → `Registro`, `leer_hpa`, `estimar_replicas`, `pagina` |
| Dónde se engancha a la comparación, el avance en la terminal y `AUTOESCALADO` | `k8s/pruebas/comparar_tiempos.py` → `comparar`, `avance`, `mostrar(parcial=…)`, `Cluster.preparar(fijar_hpa)`, `Cluster.verificar`, `Cluster.esperar_base` |
| La opción 12 (autoscaling SIN y CON) | `k8s/pruebas/prueba-de-carga.sh` → `accion_autoescalado` |
| El percentil, ahora compartido por los dos | `k8s/pruebas/metricas_comparador.py` → `percentil` |
| Las pruebas | `scripts/tests/test_comparar_snapshot.py` |
| Dónde quedan los snapshots (fuera de git) | `k8s/pruebas/resultados/`, ignorada en `.gitignore` |
| Cómo se usa | [k8s/pruebas/README.md](../../../k8s/pruebas/README.md#snapshot-en-vivo-y-autoscaling) |

## Las rutas

No agrega endpoints. Usa los mismos caminos que ya usaba el comparador, más
una lectura del HPA:

| Qué | Por dónde | Escribe |
|---|---|---|
| Crear las suscripciones medidas | `POST /api/suscripciones/` por la URL pública (ingress → web → gateway → subscriptions) | Sí, datos sintéticos en dos organizaciones vacías |
| Cambiar de modo | `kubectl set env deployment/subscriptions EVENTOS_ASINCRONOS=0/1` + `rollout status` | Sí, y se restaura |
| Fijar el HPA, solo con `fijo` | `kubectl patch hpa` a mín. = máx. = réplicas actuales | Sí, y se restaura |
| Leer la evidencia | `kubectl exec deployment/subscriptions -- python manage.py shell` | No |
| Muestrear el autoscaling | `kubectl get hpa -o json` cada 5 s | No |
| Esperar el mínimo de pods, solo con `activo` | `kubectl get hpa` y `kubectl get deployments` cada 5 s, hasta 6 min | No |
| La página | `file:///…/k8s/pruebas/resultados/comparacion-AAAAMMDD-HHMMSS.html` | En tu disco |

## El flujo

```
Git Bash (tu PC)
  prueba-de-carga.sh comparar ─▶ comparar-cola.sh --tiempos ─▶ comparar_tiempos.py
                                                                 │
     ┌───────────────────────────────────────────────────────────┤
     │ POST /api/suscripciones/ ─▶ ingress ─▶ web ─▶ gateway ─▶ subscriptions
     │ kubectl: modo, HPA, evidencia en la base, restauración
     │
     └─ Registro (snapshot_comparador.py)
          ├─ hilo aparte: kubectl get hpa cada 5 s (solo lectura)
          └─ escribe resultados/comparacion-<fecha>.html y .json
                         │
navegador ◀──────────────┘  recarga cada 5 s mientras dura; al terminar queda fija
```

Una corrida, en orden:

1. Valida URL, tokens, rangos y `AUTOESCALADO` antes de tocar `kubectl`, y pide escribir `SI`.
2. Comprueba que las dos organizaciones existan, sean distintas y estén vacías.
3. `Registro.iniciar()` toma la primera muestra del HPA, que queda **antes** de fijarlo, escribe la página, imprime su ruta y la abre en el navegador (`ABRIR_SNAPSHOT=0` para no abrirla).
4. `preparar` respalda la configuración en la anotación del Deployment, como en #141, y fija el HPA solo si `AUTOESCALADO=fijo`. Con `activo`, antes de tocar nada exige exactamente un HPA de 1 a 2 réplicas para `gateway` y otro para `subscriptions`; si falta uno, hay duplicados o el rango es otro, la prueba no parte.
5. Por ronda y modo: reinicio de la API (franja gris en la página). Con `activo`, espera a que el HPA vuelva a su mínimo de pods (franja gris clara); si en esa espera falta un HPA, la prueba se invalida. Después vienen el calentamiento, los POST medidos (franja SIN o CON), la espera de la evidencia y `verificar`, que ahora devuelve las réplicas. Cada fase se anota al entrar, así la página la dibuja abierta mientras dura. Al empezar los POST medidos se toma una lectura del HPA como base, y cada POST aparece en la página apenas responde, hueco hasta que se acredita su ronda. Al acreditarla se guardan los máximos del HPA de las lecturas que empezaron desde sus POST (pods, CPU y lo que pidió), y se escriben en la terminal junto a su p50/p95 y su tiempo evento→resumen.
6. Al cerrar cada ronda, menos la última, la terminal muestra la tabla parcial.
7. En el `finally`, primero se corta el muestreo: se espera hasta 25 s a que termine la lectura en curso, y si llega después se descarta. Recién entonces se restaura todo, aunque llegue un Ctrl+C durante esa espera.
8. `terminar` toma una última muestra, que deja constancia del HPA devuelto a 1–2, y fija la página como terminada o inválida, con el motivo.

## Decisiones

- **HTML sin JavaScript ni CDN.** La página tiene que abrir en la sala aunque
  no haya internet. La recarga es un `meta refresh`, los gráficos son SVG
  escritos en Python y los tooltips son `<title>` nativos.
- **Escritura atómica.** Cada actualización escribe un `.tmp` y lo cambia con
  `os.replace`, así el navegador nunca recarga un archivo a medio escribir. En
  Windows reintenta si justo el navegador lo tenía abierto. Si no se puede
  escribir, avisa una vez y la comparación sigue.
- **Sin secretos.** El registro copia campos uno por uno, porque la
  configuración también trae los tokens. Tampoco guarda los identificadores de
  organización. Hay una prueba que busca los tokens y los UUID en el HTML y en
  el JSON.
- **Los snapshots no van al repo.** Son evidencia de cada corrida, como las
  carpetas de evidencia del sprint: se comparten a mano.
- **El muestreo no puede romper la prueba.** Solo lee, corre en un hilo
  aparte, se corta antes de restaurar y, si `kubectl` falla, deja un hueco en
  el gráfico.
- **La evidencia terminada no cambia.** Una lectura del HPA que estaba en
  vuelo al detener el muestreo puede volver con el HPA ya restaurado. Por eso
  `detener` espera al hilo, y lo que llega después de la señal se descarta en
  vez de entrar como muestra de la prueba o reescribir la página.
- **Cada POST se ve al responder, pero cuenta al acreditarse.** `carga` avisa
  al registro por cada respuesta y la escritura periódica lo publica. Esos
  puntos van huecos y no entran en el p50 ni el p95 hasta que se verifican los
  eventos, los autores y el resumen de su ronda.
- **El máximo del HPA es solo de su fase.** Cuentan las lecturas que empezaron
  desde los POST medidos, y la primera es una base que se toma al entrar. Una
  lectura del enfriamiento, con los pods que escaló el modo anterior, no se le
  atribuye a este. Si una fase no alcanza a tener lecturas, queda sin dato.
- **"Pediría" con el HPA fijo.** Se calcula con la fórmula del controlador:
  `ceil(réplicas × CPU por pod ÷ objetivo)`, con 10 % de tolerancia y los
  límites originales. No incluye la ventana de estabilización de bajada, y la
  página lo dice.
- **`activo` no invalida por réplicas, pero cada modo parte del mínimo.** Si
  SIN escala `subscriptions` a 2, el HPA tarda unos 2 a 3 minutos en volver a
  1 (ventana de bajada de 120 s más un paso de 60 s). Sin esperar, CON partiría
  con 2 pods que no pidió y la comparación no diría nada. Por eso, antes de la
  carga de cada modo, `esperar_base` espera hasta 6 minutos a que cada HPA, y
  su Deployment, estén en el mínimo; si no bajan, la prueba se invalida.
  Durante la carga se sigue exigiendo misma imagen, mismos recursos y al menos
  un pod disponible.
- **Sin sus HPA, `activo` no parte.** Mostrar el autoscaling exige un HPA de 1 a
  2 réplicas para `gateway` y otro para `subscriptions`, el límite de la cuota.
  Se comprueba antes de tocar el clúster y en cada espera del mínimo: una lista
  vacía nunca acredita el mínimo. Con `fijo` no se exige, porque ahí el HPA se
  congela igual.
- **La opción 12 tiene sus propias variables** (`OPERACIONES_HPA`,
  `CONEXIONES_HPA`, `ESPERA_HPA`), para que un `OPERACIONES=20` exportado para
  la opción 11 no deje la demo de autoscaling con una ráfaga demasiado corta.
- **Colores revisados para daltonismo.** SIN usa azul, CON naranjo y la CPU
  verde agua. La combinación pasa el validador de daltonismo en modo claro y
  oscuro. Además, cada gráfico lleva rótulos SIN/CON y leyenda, y las tablas
  repiten los números, así que nada depende solo del color.
- **La flecha rompía la tabla final en Windows.** Python de Windows bajo Git
  Bash escribe en cp1252, que no tiene `→`. La tabla de #141 lo usa, así que en
  Git Bash la prueba se caía justo al mostrar el resultado. Ahora `main` fuerza
  UTF-8, lo que también arregla los acentos, y `imprimir` reemplaza el
  carácter en vez de cortar si la terminal igual no puede.

## Cómo probarlo

```bash
python -m unittest discover -s scripts/tests -p 'test_comparar*.py' -v        # 43, 24 nuevas
python -m unittest discover -s scripts/tests -p 'test_metricas_comparador.py' -v  # 14
python -m unittest discover -s scripts/tests -p 'test_estado_comparador.py' -v    # 4
```

Las nuevas cubren las cantidades de CPU de Kubernetes, la fórmula del HPA,
la lectura del HPA, una corrida completa con la página en curso y terminada,
una comparación fallida, el escape del error en el HTML, que `activo` no fija
el HPA y tolera réplicas, que `fijo` sí invalida, el rechazo de un
`AUTOESCALADO` inválido, la tabla en cp1252, la espera hasta el mínimo de pods
(y que invalide si no baja), el orden de fases con `activo` y el resumen de
pods por modo. Las de la revisión de Maxi: un POST que se ve en la página
mientras el siguiente sigue colgado (con `carga()` real y un servidor local),
el máximo del HPA que no hereda la lectura del enfriamiento, la base que toma
la fase medida, la lectura tardía que no cambia la evidencia terminada, y
`activo` sin HPA, con uno faltante, duplicado o con máximo 9, y un Ctrl+C real
mientras se espera al muestreo, que igual restaura. Ninguna toca un
cluster ni abre el navegador. La CI ya corre `test_comparar*.py`, así que las toma sola.

## Lo que queda

- **Correrla contra el cluster antes de la defensa.** Las pruebas usan dobles.
  La primera corrida real tiene que hacerse en una ventana sin otras pruebas,
  porque cambiar de modo reinicia la API.
- **Los 500 × 8 de la opción 12 son una estimación.** No está medido cuánto
  tarda un POST en el cluster. Si en la corrida real la CPU no pasa la línea
  de 120m, subir `OPERACIONES_HPA`; la página lo muestra.
- **Los tooltips son los nativos del navegador.** Alcanzan para leer cada
  punto; no hay cruz ni panel interactivo.
