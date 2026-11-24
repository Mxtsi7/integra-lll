# S3-FE-22 — Invalidar los avisos que dejaron de corresponder

**Qué hace.** Un aviso de próximo cobro dice «el 23 se cobran $9.990», y uno
de fin de prueba, «la prueba termina el 22». Los dos se arman con la
suscripción de ese momento. Si después la fecha cambia o la suscripción se
cancela, el aviso viejo miente. Ahora queda **obsoleto**: no sale por correo,
no se ve en la campana ni se cuenta, y no se vuelve a crear.

| Criterio de la tarjeta | Dónde se cumple | ¿Demostrado? |
|---|---|---|
| Cancelar o cambiar la fecha evita enviar la alerta antigua | `proyeccion.aplicar` llama a `invalidacion.revisar` en la misma transacción; sus correos en espera pasan a `descartada` (`alerta_obsoleta`), y `entregas.reclamar` descarta uno que se reclame después | Sí, en pruebas, con la proyección, el generador y el reclamo reales |
| Los eventos repetidos no recrean notificaciones obsoletas | `revisar` corre solo si `aplicar` cambió algo; el generador arma el id del aviso con la fecha (`id_de_ventana`), y el de la fecha vieja choca con su propio id | Sí, en pruebas |
| Respetar versión y orden | lo que ya hace `aplicar`: un evento más viejo que lo que se sabe no cambia nada, y entonces tampoco invalida ni reactiva | Sí, en pruebas |

## Cuándo un aviso queda obsoleto

| Aviso | Queda obsoleto si | Motivo |
|---|---|---|
| próximo cobro | la suscripción ya no está vigente | `no_vigente` |
| próximo cobro | `proximo_cobro` ya no es la fecha del aviso | `cobro_cambiado` |
| fin de prueba | la suscripción ya no está en prueba | `prueba_terminada` |
| fin de prueba | `fin_prueba` ya no es la fecha del aviso | `prueba_cambiada` |

Los demás tipos (alza de tarifa, doble cobro, presupuesto) cuentan algo que ya
pasó y siguen siendo ciertos: no se tocan.

Un aviso obsoleto **no se borra**. Queda con `invalidada_en` y
`motivo_invalidacion` (migración `0009_alertas_obsoletas`), y un segundo
cambio no pisa ni cuándo ni por qué quedó obsoleto. Un correo que ya estaba
saliendo (`enviando`) no se puede atajar: el proveedor ya lo tiene.

## Si la fecha vuelve a la de antes

El aviso de la fecha original quedó obsoleto, y el generador no puede crear
otro porque su id es el mismo. Si no volviera, ese cobro no se avisaría
nunca. Por eso un aviso obsoleto **por un cambio de fecha** vuelve a valer
cuando la fecha vuelve a ser la suya, y sus correos descartados por obsoletos
vuelven a esperar turno. Los que se descartaron por otra razón no vuelven. Un
aviso obsoleto porque la suscripción dejó de estar vigente no vuelve solo.

## La carrera con el generador (revisión de #215)

El generador lee la proyección sin bloqueo y después crea los avisos. Si una
cancelación entraba entre esa lectura y el INSERT, `revisar` corría antes de
que el aviso existiera y no encontraba nada que invalidar. El aviso nacía
con los datos viejos y vigente.

Ahora `generador._crear_una_vez`, con la organización ya tomada, toma la
fila de la suscripción `FOR UPDATE` y compara su `observada_en` con la que
leyó la corrida. Si cambió, no crea nada: lo cuenta como `obsoleta` y la
próxima corrida avisa con lo nuevo, si todavía corresponde. El comando
`generar_alertas` lo informa como «postergada(s)».

El orden de bloqueos es el mismo que en `aplicar` (organización, suscripción,
avisos), así que no se cruzan:

- si `aplicar` tomó la fila primero, el generador espera, la relee cambiada y
  no crea;
- si el generador la tomó primero, `aplicar` espera a que el aviso exista, y
  su `revisar` lo invalida.

## Dónde está

| Pieza | Archivo |
|---|---|
| La regla | `services/notifications/notifications/invalidacion.py` |
| El enganche con los eventos | `proyeccion.py` → `aplicar` |
| La relectura del generador | `generador.py` → `_crear_una_vez` |
| El correo que se reclama tarde | `entregas.py` → `reclamar` |
| La campana y el listado | `views.py`, el queryset base y el del contador |
| Las pruebas | `tests/test_invalidacion_s3_fe_22.py` (26) y `tests/test_carrera_generador_postgres.py` (2) |

## Cómo se comprobaron las pruebas

Los avisos nacen de una suscripción proyectada con eventos con la forma del
catálogo MX-21 v2, y pasan por el generador, la planificación y el reclamo
reales. La intercalación de la revisión se reproduce aplicando el evento
después de que la corrida leyó y antes de que cree el aviso.

Se rompió el código a propósito 20 veces y cada vez falló al menos una prueba.
Las roturas cubrieron:

- en el generador: no releer la fila; solo mirar que la fila exista; no contar
  las postergadas o perderlas al sumar los dos generadores;
- en la regla: quitar cada uno de los cuatro motivos; no descartar los
  correos; no reactivar, o reactivar por cualquier motivo, o sin devolver sus
  correos, o devolviendo los descartados por otra razón; tocar avisos de otra
  suscripción; re-invalidar y pisar la fecha;
- en la proyección, el reclamo y la campana: que la proyección no revise, o
  revise con la fila sin recargar; que el reclamo mande un aviso obsoleto; que
  el listado o el contador los muestren.

Las 2 pruebas con dos conexiones a PostgreSQL (una por cada orden de la
carrera) **no se corrieron en local**, porque no había PostgreSQL. Las corre
la CI.
