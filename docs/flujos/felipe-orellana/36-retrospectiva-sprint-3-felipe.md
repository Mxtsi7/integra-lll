# Retrospectiva del Sprint 3 — Felipe Orellana (conectores de correo y alertas)

Hecha el 24-11-2026 con lo que se puede comprobar: las PR, sus revisiones en
GitHub y el código. No incluye horas (van en la planilla del equipo). Donde
hay una opinión, dice que es una opinión.

## Qué se entregó

| PR | Tarjetas | Abierta | Fusionada | Rondas con cambios pedidos |
|---|---|---|---|---|
| #147 | S3-FE-01, 11, 12, 13 (candidato común, CSV) | 08-11 | 14-11 | 2 |
| #153 | S3-FE-10 (procesar la importación) | 09-11 | 09-11 (en la rama de #147) | 0 |
| #155 | S3-FE-14 (consultar candidatos) | 09-11 | 11-11 (en la rama de #147) | 1 |
| #158 | S3-FE-16 (rechazar) | 09-11 | 11-11 (en la rama de #147) | 0 |
| #159 | S3-FE-15 (confirmar) | 09-11 | 11-11 (en la rama de #147) | 1 |
| #171 | S3-FE-17 (duplicados) | 13-11 | 14-11 (en la rama de #147) | 1 |
| #172 | S3-FE-02 (leer Gmail) | 13-11 | 16-11 | 1 |
| #177 | S3-FE-04 (leer Outlook) | 13-11 | 16-11 | 1 |
| #180 | S3-FE-19 (renovar credenciales) | 13-11 | 16-11 | 1 |
| #183 | S3-FE-06 (origen del mensaje) | 13-11 | 16-11 | 1 |
| #184 | S3-FE-07 (importe, moneda y fecha) | 13-11 | 18-11 | 2 |
| #185 | S3-FE-08 (tipo de aviso) | 13-11 | 16-11 | 1 |
| #189 | S3-FE-03 y 05 (avance de lectura) | 16-11 | 19-11 | 1 |
| #202 | S3-FE-09 (candidatos de correo) | 19-11 | 24-11 | 0 |
| #203 | S3-FE-21 (envío de alertas) | 19-11 | 23-11 | 0 |
| #214 | S3-FE-18 y 20 (lectura programada) | 23-11 | abierta, revisión respondida | 1 |
| #215 | S3-FE-22 (avisos obsoletos) | 23-11 | abierta, revisión respondida | 1 |
| #222 | S3-FE-23 (pruebas finales) | 24-11 | borrador | — |
| esta | S3-FE-24 (guía y retrospectiva) | 24-11 | borrador | — |

De soporte, en el mismo periodo: #164 (notifications en el namespace de
Maxi), #187 (una prueba de k8s inestable) y #204 (documentación de
reimportación).

Todas las revisiones las hizo Maxi (Mxtsi7). #202 tuvo además la de
Christopher.

## Lo que encontraron las revisiones

Contando las veces que una revisión de Maxi escribe P1 o P2, quedan unas 6
menciones de P1 y unas 40 de P2 en las PR del sprint. Es una cota
**alta**: algunas son la misma observación citada al confirmar que se
corrigió. Ninguna resultó falsa: todas las que se discutieron se
reprodujeron antes de corregirlas.

Agrupadas por tipo, con un ejemplo de cada una:

| Tipo | Ejemplo |
|---|---|
| **Carreras y orden** (dos procesos a la vez, o un evento viejo que llega tarde) | #159: perder la confirmación frente a un rechazo devolvía un éxito falso. #180 (P1): un 401 antiguo podía marcar para reconexión una autorización nueva. #214: el beat arrancaba cadenas de reintento paralelas. #215: el generador creaba un aviso que una cancelación ya había invalidado |
| **Datos que no estaban en la fuente** | #147: un monto `1e3` en USD se convertía en un candidato de 13 USD sin error. #184: un total negativo quedaba positivo y «confirmado», y la fecha del próximo ciclo se tomaba como la del cobro |
| **Leer de menos sin decirlo** | #189 (P1): que Outlook no mande `nextLink` no garantiza que se leyó todo. #177: la paginación descartaba mensajes al bajar el límite |
| **Errores mal clasificados** | #189: cualquier error del proveedor se trataba como cursor inválido |
| **Lo que la limpieza de una organización no borra (MX-07)** | #159 (P1): la tabla del outbox quedaba fuera de la limpieza, y la limpieza respondía 204 conservando datos financieros |

## Incidentes

- **Una prueba de k8s inestable**: medía el plazo del consumidor con
  `date +%s`, que trunca a segundos. Se arregló en #187.
- **La CI de #183 falló dos veces por causas ajenas al cambio**: la primera,
  RabbitMQ no levantó (se volvió a correr); la segunda, la prueba inestable
  de arriba.
- **Una cifra mal informada**: en la descripción de #183 puse 696 pruebas y
  eran 643. Se corrigió en la PR.
- **En Windows falla una prueba que en la CI pasa**: `git` convierte a CRLF
  el CSV de ejemplo de `docs/contratos/fixtures/` y cambia su sha.
- **Sin PostgreSQL en el PC de desarrollo**: las pruebas con dos conexiones
  (carreras) solo se corren en la CI.
- **Dos documentos con el número 31**: dos PR abiertas a la vez tomaron el
  mismo número. Se renumeró a 32 en #214.

## Qué funcionó

- **Reproducir antes de corregir.** Cada observación se reprodujo con una
  prueba que fallaba antes del arreglo. Eso también separó las observaciones
  reales de las que no lo eran.
- **Romper el código a propósito** (pruebas de mutación) encontró pruebas que
  no probaban lo que decían. En S3-FE-22, 2 de 20 roturas sobrevivían y les
  faltaba su prueba.
- **Pruebas con dos conexiones a PostgreSQL** para cada carrera. Son las
  únicas que demuestran el orden de los bloqueos, y por eso Maxi las pidió
  en #215.
- **Responder cada revisión en la PR** con lo que se cambió, cómo se probó y
  qué queda pendiente.

## Qué no funcionó tan bien

- **La cadena de 6 PR apiladas** (#172 ← #177 ← #180 ← #183 ← #184 ← #185):
  cada corrección abajo había que propagarla hacia arriba con merges, y el
  índice de documentos chocó en cada uno. Opinión: para tarjetas que no
  dependen de verdad unas de otras, conviene abrirlas contra `main`.
- **Las carreras aparecen en la revisión y no antes.** Cuatro de las
  observaciones más serias fueron de orden o concurrencia. Opinión: al
  escribir un cambio que toca una fila compartida, preguntarse de entrada
  «¿qué pasa si esto corre dos veces a la vez, o al revés?».
- **El tiempo hasta fusionar** fue de 0 a 6 días (0 en las que entraron a la rama de #147), sobre todo por la ronda
  de revisión. Las que entraron sin cambios pedidos (#202 y #203) igual
  tardaron 4 o 5 días.

## Lo que queda abierto

| Qué | Dónde |
|---|---|
| Confirmar no crea la suscripción ni el cobro: nadie consume `candidato.confirmado` | S3-FE-15, doc 21 |
| El mismo cobro por correo y por CSV deja dos órdenes | hallazgo de S3-FE-23, doc 34 |
| Lo que lee la lectura programada no se ve en la web (la pantalla de importaciones muestra solo las de la persona) | doc 35, sección 4.3 |
| No salen correos de alertas: falta acordar de dónde sale la dirección y programar el despachador | S3-FE-21, doc 31 |
| Ninguna lectura con una cuenta real de Gmail u Outlook ni un SMTP real. Connectors no está deployado en el clúster | S3-FE-23 y 24 |
| La regla `eol=lf` para el CSV de contrato, para que la prueba pase también en Windows | este documento |
| #214, #215, #222 y esta PR, abiertas | — |

## Para el próximo sprint

1. Decidir con Maxi quién consume `candidato.confirmado`, y con eso cómo se
   reconoce el mismo cobro por correo y por CSV. Son la misma conversación.
2. Recorrer la guía (doc 35) con una cuenta de prueba real, y corregirla
   donde no calce.
3. Abrir contra `main` las tarjetas independientes, y apilar solo las que
   dependen de verdad.
4. Desde el primer commit, escribir la prueba de carrera de cualquier
   cambio que toque una fila compartida.
