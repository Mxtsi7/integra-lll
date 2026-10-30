# Correcciones de interfaz (web)

**Rama:** `Christopher/correcciones_interfaz` · **Responsable:** Christopher Solís

Cuatro errores vistos en capturas de la app, más uno que apareció en las mismas capturas: el borde
recto bajo el filtro elegido de Inicio. Se siguió el plan del 29 de octubre de 2026
(`2026-10-29-plan-correcciones-interfaz.md`).

| # | Error | Causa | Arreglo |
|---|---|---|---|
| 1 | La campana llevaba al Panel | `to="/dashboard"` y la etiqueta decía «ver el Panel» | Abre `/configuracion` (Avisos es la primera sección) |
| 2 | El interruptor «Activa» no hacía nada | Era un dibujo `aria-hidden` dentro del botón que abre el detalle: pulsarlo abría el detalle | Botón propio (`role="switch"`) que cancela o reactiva con las transiciones del backend |
| 3 | En PC, el menú lateral se cortaba abajo | El riel mide ~755 px; en un notebook (1366×768 con la barra del navegador, ~657 px) «Ajustes» terminaba en 685 px, fuera de alcance | Con poca altura el riel se compacta, quita el lema y, si igual no cabe, se desplaza |
| 4 | Brillo cuadrado en el anillo y el arco del Panel | El trazo llega al borde del SVG y un SVG recorta lo que sale de su caja. Además el halo era blanco: `drop-shadow(currentColor)` tomaba el color del texto | `overflow: visible` en esos SVG y `color` igual al trazo |
| — | Borde recto bajo el filtro «Todas» | El scroll horizontal de los filtros también recorta en vertical la sombra del elegido | Padding para la sombra, compensado con margen negativo |

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué cambió |
|---|---|
| [web/src/components/layout/BarraSuperior.tsx](web/src/components/layout/BarraSuperior.tsx) | La campana: destino, nombre y descripción del conteo |
| [shared/src/api/suscripciones.ts](shared/src/api/suscripciones.ts) | `reactivarSuscripcion(id)`: `POST /suscripciones/<id>/reactivar/` (VI-09) |
| [web/src/components/subscriptions/TarjetaSuscripcion.tsx](web/src/components/subscriptions/TarjetaSuscripcion.tsx) | El interruptor como control propio, hermano del botón del detalle |
| [web/src/pages/Homepage.tsx](web/src/pages/Homepage.tsx) | Confirmar, cancelar o reactivar, errores y actualización de listas |
| [web/src/components/subscriptions/CancelarSus.tsx](web/src/components/subscriptions/CancelarSus.tsx) | Aclara que el cobro real se cancela con el proveedor (también en el detalle) |
| [web/src/components/layout/BarraLateral.module.css](web/src/components/layout/BarraLateral.module.css) | El riel con poca altura |
| [web/src/components/layout/BarraSuperior.module.css](web/src/components/layout/BarraSuperior.module.css), [web/src/styles/theme.css](web/src/styles/theme.css) | Barra superior alineada con el contenido; ancho útil de 1320 a 1600 px |
| [web/src/components/Dashboard/Medidores.tsx](web/src/components/Dashboard/Medidores.tsx) y su `.module.css` | Brillo del color del trazo y sin recorte; en 0 % no se dibuja el punto |
| [web/src/pages/Homepage.module.css](web/src/pages/Homepage.module.css), [TarjetaSuscripcion.module.css](web/src/components/subscriptions/TarjetaSuscripcion.module.css) | Sombra del filtro; espacio para editar y eliminar en la tarjeta |

## Qué hace

### 1. La campana

- Va a `/configuracion` y se llama **«Configurar notificaciones»** siempre, con o sin avisos.
- El número no es parte del nombre: va como descripción ("3 cosas piden atención"). Son cobros de
  la semana y suscripciones sin uso, no notificaciones sin leer.
- Ya en Ajustes, pulsarla no desmonta el formulario ni pierde un cambio sin guardar: es la misma ruta.

### 2. El interruptor de la tarjeta

El dominio tiene cinco estados, no un booleano. **Encendido = la seguimos contando**: solo una
cancelada está apagada, y cada tarjeta conserva su etiqueta.

| Estado | Interruptor | Al pulsarlo |
|---|---|---|
| `activo`, `fantasma`, `prueba`, `por_confirmar` | Encendido, con «Activa», «Sin uso», «Prueba gratis» o «Por confirmar» | Pide confirmar y cancela (`POST …/cancelar/`) |
| `cancelado` | Apagado, «Cancelada» | Reactiva enseguida (`POST …/reactivar/`); el backend la deja `activo` |

- **Nunca** un PATCH al estado (el backend lo rechaza) ni el campo `activo`, que es eliminar.
- Es un `button` con `role="switch"`, `aria-checked` y nombre fijo «Seguimiento de cobros de X». La
  etiqueta del estado se anuncia como descripción. El área es de 44×44 y funciona con Enter y Espacio.
- La confirmación es la de CH-10 (`CancelarSuscripcionDialog`). «Volver» no manda nada.
- **Una operación por suscripción:** se reserva en una ref en el mismo instante, así un doble clic
  manda una sola. Mientras viaja, la tarjeta dice «Guardando…» y no se puede editar ni eliminar.
- **Lo que se ve es lo que devuelve el servidor:**
  - se reemplaza en la lista completa (conteos, resumen, campana);
  - en la grilla, con los filtros actuales, una cancelada sale de «Activas» sin esperar la recarga;
  - después se vuelve a pedir la lista.
- **Lecturas viejas:** cada cambio confirmado sube una generación.
  - Una lectura que salió antes no pisa el resultado.
  - La lista completa se vuelve a pedir; la grilla espera la recarga que pide el cambio.
- **Errores:**
  - al cancelar, el mensaje queda en la confirmación para reintentar;
  - al reactivar, va en un aviso;
  - en ambos casos la suscripción no cambia.
  - Un 404 avisa que ya no existe y recarga la lista.
  - Si el cambio se guardó pero la recarga falló: «Guardamos el cambio, pero no pudimos actualizar la
    lista».
- **Sesión:** se anota la sesión con que se montó Inicio, con el mismo patrón que el detalle (#128).
  - Un resultado que llega después de cambiar de cuenta, o de salir de Inicio, no se aplica.
  - Con la sesión ya cambiada, el interruptor no opera con el token nuevo.
- Reactivar no inventa una fecha ni restaura `prueba` o `fantasma`: queda lo que responde el backend.

### 3. Layout en PC

Medido con la API falsa, con `scrollWidth` contra `clientWidth`, buscando elementos fuera de la
ventana y midiendo dónde termina el riel.

| Viewport | Antes | Después |
|---|---|---|
| 1366×657 (notebook 1366×768) | «Ajustes» hasta 685 px, cortado; lema fuera | Riel completo hasta 567 px, sin desplazar |
| 1440×789, 1181, 1101, 901 | Sin scroll horizontal | Igual; riel compacto completo |
| 1920×937 | Contenido 1376 px centrado; barra de borde a borde | Contenido 1656 px; marca y «Cerrar sesión» alineadas con el contenido |
| 2560×1297 | 550 px vacíos a cada lado | 1656 px; 400 px a cada lado, alineado |
| 900, 641, 375, 320 | Barra inferior, sin scroll horizontal | Igual; la paginación no queda bajo la barra |

- Sin `overflow-x: hidden` global, `transform: scale` ni anchos fijos de página.
- La tarjeta reserva a la derecha el espacio de editar y eliminar. Con un monto de diez dígitos en
  320 px, el monto llegaba a ellos.

### 4. Brillo de los medidores

- El halo es `drop-shadow(0 0 6px currentColor)` y `currentColor` es el color del trazo: verde o
  coral en el anillo, naranja en el arco. Antes era blanco.
- Los dos SVG tienen `overflow: visible`. El tile tiene 20-22 px de padding, que alcanzan para el halo.
- En 0 % el trazo del valor no se dibuja: con la punta redonda quedaba un punto suelto. La pista
  se conserva.
- La animación se llena desde vacío. Antes partía de `stroke-dashoffset: 1000` y el trazo daba
  vueltas antes de quedar quieto.

## Cómo se comprobó

- **Pruebas nuevas:**
  - `BarraSuperior.test.tsx` (5): destino y nombre con 0, 1, 3 y 12 avisos, y la descripción.
  - `App.test.tsx` (+3): desde `/home` y `/dashboard` la campana monta Ajustes con Avisos, y Atrás
    vuelve. Ya en Ajustes, con un borrador, no lo pierde.
  - `suscripciones.test.ts` (+2): reactivar es un POST a `…/reactivar/`, sin cuerpo, convierte los
    Decimal y propaga el error.
  - `TarjetaSuscripcion.test.tsx` (10): los cinco estados; el interruptor no abre el detalle; las
    acciones son independientes; no hay controles anidados; «Guardando…» y bloqueo; insignia sin
    la acción.
  - `Homepage.test.tsx` (+12), todas con StrictMode:
    - confirmar y «Volver»;
    - doble clic;
    - «Activas» sin esperar la recarga;
    - reactivar sin confirmar;
    - errores de cancelar y de reactivar, un 404, y una recarga fallida tras guardar;
    - la lista completa vieja y una lectura de la grilla que llega junto con el cambio;
    - cambio de cuenta y salir de Inicio mientras se espera.
  - `Medidores.test.tsx` (17): 0, 1, 50, 99, 100 y fuera de rango; color igual al trazo; `--inicio`;
    sin punto en 0 %; tamaño y etiqueta; varias instancias.
- **Navegador**, contra la API falsa:
  - la campana con Enter va a Ajustes y Atrás vuelve;
  - interruptor:
    - «Volver» no hizo ningún POST;
    - un doble clic en confirmar hizo uno solo;
    - Activas pasó de 7 a 6 y el gasto al mes bajó;
    - con Espacio reactivó sin confirmar y el foco quedó en el interruptor;
    - el cambio siguió después de recargar;
    - un 500 dejó la suscripción como estaba y el reintento funcionó;
  - el riel y el layout en la tabla de arriba;
  - el anillo verde y el arco naranja sin recorte;
  - la sombra del filtro sin borde recto.
- **Mutaciones:** se rompió a propósito cada comportamiento y en las 28 falla alguna prueba:
  - campana: Panel, nombre con el número, sin descripción;
  - tarjeta: abre el detalle, encendido como antes, sin bloqueo, sin «Guardando…», insignia;
  - Inicio:
    - doble clic, sesión al empezar y al terminar;
    - lecturas viejas, «Activas», conteos, recarga, mensaje tras guardar, 404;
    - confirmar al reactivar, «Volver», error en la confirmación;
  - medidores: color, `--inicio`, punto en 0 %, tope de 100.

  Dos se escapaban al principio (los clics en el mismo instante y la lista completa vieja tras un
  404): se reforzaron esas pruebas. Otra mostró una comprobación repetida en `cambiarSeguimiento`,
  y se quitó.
- Desde `frontend/`: typecheck, pruebas (shared 223, web 463, móvil 101) y build.

## Fuera de esta corrección

- Los interruptores de los tiles «Sin uso» y «Pruebas gratis» del Panel tienen el mismo dibujo
  decorativo dentro de un enlace al detalle. No estaban en las capturas: quedan como están.
- Las capturas son de Chrome. Firefox y el zoom de Windows al 125 % no se probaron a mano.
