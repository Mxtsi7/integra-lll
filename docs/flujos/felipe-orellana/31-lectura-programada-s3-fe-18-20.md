# S3-FE-18 y S3-FE-20 — La lectura programada del correo

**Qué hace.** Junta lo que ya existía en una tarea que corre sola cada 15
minutos. Lee cada cuenta conectada, guarda sus candidatos, reintenta los
errores transitorios con espera y deja de leer una cuenta que se desconecta.

```
beat ─▶ programar_lecturas_de_correo     una tarea por cuenta que toca leer
          └▶ leer_cuenta_de_correo       hasta 20 páginas, con reintentos
               └▶ leer_siguiente_lote    S3-FE-03/05: cursor + renovación (S3-FE-19)
                    └▶ guardar_pagina    S3-FE-09: candidatos y errores
```

| Criterio | Dónde se cumple |
|---|---|
| FE-18: simular un fallo transitorio conserva el cursor y permite retomar | el cursor solo se mueve si la página se guardó; el reintento lee la misma página |
| FE-18: el agotamiento y el error permanente quedan observables | `AvanceDeLectura.estado_lectura`, `fallos_seguidos`, `ultimo_error` (código y detalle) y el log |
| FE-20: desconectar durante una lectura evita resultados posteriores | la cuenta se mira con su fila tomada antes de guardar cada página |
| FE-20: las tareas programadas dejan de leer la cuenta | solo se programan cuentas `conectada`, y una tarea ya encolada se cancela sola al despertar |

## S3-FE-20: una cuenta desconectada no se lee ni se guarda

La desconexión puede llegar en cualquier momento, así que se mira en tres
lugares:

1. **Al programar.** Solo se encolan cuentas `conectada` de Gmail u Outlook.
2. **Al empezar la tarea.** Una tarea que estaba en la cola cuando el usuario
   desconectó encuentra la cuenta desconectada y no lee nada. Es la forma de
   «cancelar los trabajos pendientes» que no depende de que el broker deje
   revocar mensajes: la tarea se cancela sola al despertar.
3. **Antes de guardar cada página, con la fila de la cuenta tomada**
   (`select_for_update`, en la misma transacción que mueve el cursor):
   - si la desconexión ganó, no se guarda nada y el cursor no se mueve;
   - si la lectura ganó, la desconexión **espera** a que termine de guardar:
     lo guardado es de antes de desconectar.

Además, `DELETE /api/conectores/<id>/` llama `cancelar_lectura`, que descarta
la corrida a medias y cierra como `fallida` (`cuenta_desconectada`) la
importación que estuviera abierta. Una reconexión empieza limpia desde la
última marca.

## S3-FE-18: reintentos con espera y con tope

| Lo que pasó | Qué se hace | `estado_lectura` |
|---|---|---|
| `ErrorTransitorio` (red, 429, 5xx) | se reintenta a los 1, 5, 15, 30 y 60 minutos, o con el `Retry-After` si es mayor (tope: 60 minutos) | `reintentando` |
| se acabaron los 5 reintentos | no se reintenta más; la cuenta descansa 1 hora antes de volver a programarse | `agotada` |
| `ErrorDelProveedor` (permanente) | no se reintenta; no se vuelve a programar mientras la cuenta tenga **las mismas credenciales** (una reconexión la reactiva) | `detenida` |
| la cuenta no se puede leer (desconectada, pide reconexión) | no se reintenta; deja de programarse por su estado | sin cambio |
| la lectura funcionó | `fallos_seguidos` vuelve a 0 | `al_dia` |

El tope lo pone la lista de esperas, no `max_retries` de Celery: la tarea es
la que decide cuándo parar y lo deja anotado.

## Una importación por ejecución, no por corrida

`guardar_pagina` escribe en una `Importacion`. Cada **ejecución** de la tarea
abre la suya al guardar la primera página con mensajes, y la cierra al
terminar, también cuando falla a mitad de camino (queda `completada` con lo
que alcanzó a guardar).

Si fuera una por corrida, una corrida esperando su reintento quedaría abierta
más de 30 minutos, y el rescate de S3-FE-10 la cerraría como «interrumpida»
con el mensaje de un archivo CSV. Si aun así el rescate cierra una entre dos
páginas, la tarea abre otra y vuelve a leer la misma página: no se pierde
nada.

El `usuario_id` es `lectura-programada`: la cuenta conectada no guarda quién
la conectó, y los candidatos se listan por organización (S3-FE-14).

## Configuración

| Variable | Por omisión | Qué es |
|---|---|---|
| `CONECTORES_LECTURA_CORREO_SEGUNDOS` | 900 | cada cuánto programa beat |

## Dónde está

| Pieza | Archivo |
|---|---|
| La lectura programada | `services/connectors/connectors/lectura_programada.py` |
| Las tareas de Celery | `connectors/tasks.py` → `programar_lecturas_de_correo`, `leer_cuenta_de_correo` |
| El estado observable | `AvanceDeLectura` en `models.py`, migración `0012_lectura_programada` |
| Cancelar al desconectar | `views.py`, la acción que desconecta |
| Las pruebas | `tests/test_lectura_programada_s3_fe_18_20.py` (26) y `tests/test_carrera_desconexion_postgres.py` (1) |

## Cómo se comprobaron las pruebas

Se usan `avance_lectura`, `renovacion` y `candidatos_correo` reales. Solo el
lector se reemplaza por uno que entrega páginas programadas, y los correos son
recibos que de verdad producen un candidato.

Se rompió el código a propósito 26 veces y cada vez falló al menos una prueba:

- leer una cuenta no conectada, o no mirarla al guardar, o mirarla sin tomarla;
- programar cuentas no conectadas, de CSV, detenidas, o agotadas sin
  enfriamiento, o dejar una detenida para siempre;
- reintentar para siempre, ignorar `Retry-After` o aceptarlo sin tope;
- reintentar un error permanente;
- no anotar el agotamiento ni dejarlo en el log;
- no contar los fallos, o no limpiarlos con el éxito;
- abrir una importación sin mensajes, o no cerrarla;
- no reabrir tras el rescate;
- leer sin tope de páginas;
- que cancelar no descarte la corrida, o cierre importaciones de otra cuenta;
- que la API no cancele;
- que la tarea no reintente, o que programar no encole.

La prueba con dos conexiones a PostgreSQL (la desconexión espera a que la
lectura termine de guardar) **no se corrió en local**: no había PostgreSQL ni
Docker disponibles. La corre la CI, contra PostgreSQL 16.
