# Tandas: demostrar un flujo de D-03 dentro de la cuota

Una **tanda** es una configuración acotada que levanta **un** servicio de D-03
completo —con sus procesos, no solo su API— para demostrar un flujo de punta a
punta. Se arma a mano, se demuestra y se revierte.

Existe porque los tres servicios no caben juntos y **no hay más capacidad que
pedir**.

## Por qué no caben

Medido con `k8s/pruebas/presupuesto.py` sobre los manifiestos de este repo:

| Configuración | Pods | Límites de memoria |
|---|---:|---:|
| Núcleo con los dos HPA al máximo (lo que corre hoy) | 12 / 12 | 2688 / 2752 Mi |
| Núcleo + las tres APIs de D-03, sin autoescalado | **13 / 12** | **3776 / 2752 Mi** |
| Núcleo + las tres APIs **y sus workers**, con autoescalado | **17 / 12** | **3968 / 2752 Mi** |

Faltan 1024 Mi y un pod en el caso más benigno. Agrupar contenedores en menos
pods no ayuda: la cuota de memoria suma igual. Y las optimizaciones de memoria
en estudio darían del orden de 192 Mi, un quinto de lo que falta.

## Lo que sí cabe

Soltando `subscriptions-beat` —que en modo síncrono no hace falta, porque los
eventos se publican dentro de la petición— entra **uno** de los tres, completo:

| Tanda | Pods | Límites de memoria | Holgura |
|---|---:|---:|---:|
| Núcleo sin beat + `notifications` (API + consumidor + generador) | 10 / 12 | 2592 Mi | 160 Mi |
| Núcleo sin beat + `connectors` (API + worker) | 10 / 12 | 2528 Mi | 224 Mi |
| Núcleo sin beat + `analytics` (API + worker) | 10 / 12 | 2528 Mi | 224 Mi |

`auth-eliminaciones` se queda arriba en las tres: el borrado de cuentas no se
sacrifica.

**Dos a la vez no entran** (2848 Mi, 96 por encima).

## Qué falta en el repositorio antes de poder hacer la tanda de notifications

Esto no lo resuelve la cuota:

1. **El consumidor de eventos** que alimenta `SuscripcionVigilada` (FE-24).
   Vive en `felipe/fe-23-24-broker-notificaciones`, sin fusionar. Sin él la
   proyección queda vacía y no hay nada de qué generar alertas.
2. **El manifiesto de `notifications`**: no existe. `desplegar.sh` tampoco
   construye ni publica su imagen.
3. El generador: resuelto acá, en `alertas-notifications.yaml`.

## Por qué estos manifiestos no están en `k8s/`

`desplegar.sh` aplica los manifiestos numerados de `k8s/`, y una prueba exige
que los aplique **todos**. Estos no deben aplicarse en cada despliegue: apuntan
a servicios que no están desplegados y fallarían en cada corrida. Es el mismo
criterio por el que la purga de FE-07 no tiene CronJob (ver `k8s/README.md`).

Al vivir en un subdirectorio quedan fuera de ese glob, y
`scripts/tests/test_tandas.py` comprueba que siga siendo así, que respeten el
mínimo de 64 Mi y 25m por contenedor, y que los CronJob no se acumulen ni se
cuelguen ocupando un pod.

## Lo que un pod de tanda tiene que traer

Dos cosas que no se heredan y que, si faltan, fallan tarde:

- **Etiquetas en `spec.template.metadata.labels`.** Las de `metadata` describen
  el objeto, no el pod. Sin ellas el pod nace pelado y `k8s/40-red.yaml` no lo
  deja llegar a PostgreSQL: `dominio-a-postgres` solo admite los `app` de una
  lista. El síntoma aparece recién cuando las políticas se apliquen con un CNI
  que las haga cumplir.
- **La credencial restringida de su esquema**, `ojoalgasto-bd-<servicio>`. El
  Secret global `ojoalgasto` trae la URL del usuario `postgres`, que es
  superusuario. `ESQUEMA_BD` fija el `search_path` pero **no** limita
  privilegios.

`scripts/tests/test_tandas.py` comprueba las dos sobre todos los manifiestos de
esta carpeta, cruzando las etiquetas contra los selectores reales de
`40-red.yaml`.

## Cómo se aplica

```bash
# Con la imagen de notifications ya publicada:
sed "s|IMAGEN_NOTIFICATIONS|$REGISTRO/ojoalgasto-notifications:$ETIQUETA|g" \
  k8s/tandas/alertas-notifications.yaml | kubectl apply -f -
```

Para la demostración no hay que esperar a la hora en punto:

```bash
kubectl create job --from=cronjob/generar-alertas alertas-ahora
kubectl logs job/alertas-ahora
```

Al terminar la tanda:

```bash
kubectl delete -f k8s/tandas/alertas-notifications.yaml
kubectl scale deployment/subscriptions-beat --replicas=1
```
