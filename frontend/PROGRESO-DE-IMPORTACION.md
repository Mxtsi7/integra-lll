# Progreso de importación de documentos (web)

**Rama:** `Christopher/progreso_importacion` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-27 | Mostrar progreso de importación de documentos | ✅ |

**Dependencia:** FE-08 (Felipe), ya en `main` (PR #116): `GET /api/importaciones/` y
`GET /api/importaciones/<id>/`, enrutadas por el gateway a Connectors.
- Es de solo lectura: una importación la crea el proceso que la ejecuta, FE-07 al subir un CSV (todavía
  es la PR #120) o FE-13 al leer el correo.
- `completada` y `fallida` son terminales y no cambian más.
- Terminar el análisis **no** es confirmar los candidatos: eso es FE-11.

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/api/importaciones.ts](shared/src/api/importaciones.ts) | Tipos de FE-08, `getImportacion(id)` y `getMisImportaciones(pagina)` |
| [web/src/hooks/useProgresoImportacion.ts](web/src/hooks/useProgresoImportacion.ts) | El polling: backoff, pausa con la pestaña oculta y limpieza |
| [web/src/pages/ImportacionPage.tsx](web/src/pages/ImportacionPage.tsx) | `/importaciones/:id`: estado, barra, candidatos y errores por fila |
| [web/src/pages/ImportacionesPage.tsx](web/src/pages/ImportacionesPage.tsx) | `/importaciones`: las propias (`?mias=true`), con "Ver más" |
| [web/src/App.tsx](web/src/App.tsx) | Las dos rutas, dentro de `RutaPrivada` |
| [web/src/pages/CuentasConectadasPage.tsx](web/src/pages/CuentasConectadasPage.tsx) | Enlace "Ver importaciones" en "Tus cuentas" |

## Qué hace

- **Desde el id.** `/importaciones/<id>` es lo que FE-07 abrirá después de subir un archivo. Mientras
  tanto se llega desde Cuentas conectadas → "Ver importaciones", que lista las propias de la más nueva a
  la más vieja.
- **Los cuatro estados:**
  - `pendiente`: "En cola";
  - `procesando`: "Leyendo el archivo…" o "Leyendo tus correos…", con barra;
  - `completada`: "El análisis terminó";
  - `fallida`: no se pudo terminar y no se tocó ninguna suscripción.

  La insignia usa `estado_legible` del backend.
- **La barra no inventa avance.** Con total conocido es un `progressbar` con `aria-valuenow` y el texto
  "100 de 250 filas (40 %)" (en el correo, "mensajes"). Con `progreso: null`, por ejemplo una lectura de correo que todavía no sabe
  cuántos mensajes hay, es indeterminada, sin `aria-valuenow`: null no es 0. Con
  `prefers-reduced-motion` no se mueve.
- **Polling** (`useProgresoImportacion`):

  ```ts
  espera = avanzo ? INTERVALO_INICIAL_MS : Math.min(espera * 2, INTERVALO_MAXIMO_MS); // 1 s … 10 s
  ```

  - Pregunta hasta el estado terminal y **ahí se detiene**.
  - **Al desmontar o cambiar de id** corta el temporizador y descarta la respuesta en vuelo.
  - Con la pestaña oculta no pregunta, y al volver pregunta enseguida.
  - Si no hay avance, o si falla, espera el doble cada vez, hasta 10 s.
  - Si una consulta falla, sigue mostrando lo último con "Seguimos intentando…". Después de 3 fallos
    seguidos deja de preguntar, avisa que lo que se ve puede estar desactualizado y ofrece Reintentar.
  - Un 404 (no existe o es de otra organización) se dice y no se reintenta.
- **No se afirma una importación exitosa.** Al completarse dice cuántos cobros posibles encontró y
  aclara **"Todavía no se creó ni cambió ninguna suscripción"**. Nunca dice "importado". Si ya se
  confirmaron (`candidatos_confirmados`), lo dice con la fecha.
- **Paso a previsualización:** el botón "Revisar cobros encontrados" se ve, pero está deshabilitado,
  porque la previsualización (FE-10) todavía no existe en la web.
- **Errores por fila:** "Fila 3 · mensaje", o solo el mensaje si el error no es de una fila. FE-08
  guarda los primeros 20 y el total real va aparte, así que se muestra "Y N más.".
- **Listado:** de a 10, como la API. "Ver más" pide la página siguiente sin repetir la que se corrió si
  entró una nueva mientras tanto. Tiene estado vacío y error con reintento.

## Cómo se comprobó

- `shared/src/api/importaciones.test.ts`: las URLs, con el id codificado y `?mias=true&page=N`.
- `web/src/hooks/useProgresoImportacion.test.tsx` (reloj falso), 8 pruebas:
  - hasta el terminal y se detiene;
  - el backoff 1-2-4-8-10-10 s, que vuelve a 1 s al avanzar;
  - desmontar;
  - la pestaña oculta y al volver;
  - los fallos (sigue mostrando lo último, se detiene tras 3 y Reintentar sin borrar lo que se veía);
  - el error sin datos;
  - el 404;
  - el cambio de id con la respuesta vieja.
- `web/src/pages/ImportacionPage.test.tsx` (páginas reales, solo se simula la red), 13 pruebas:
  - la barra con total y sin total;
  - pendiente;
  - completada sin afirmar éxito y con el paso deshabilitado;
  - confirmada y sin candidatos;
  - fallida con errores y "Y 42 más", y completada con errores;
  - el 404;
  - la actualización sola hasta terminar, y el aviso de desactualizado con reintento;
  - el listado, el vacío con error y "Ver más" sin repetir.
- `web/src/pages/CuentasConectadasPage.test.tsx`: el enlace a `/importaciones`.
- **Contrato con las vistas reales** de `services/connectors` (código de main, SQLite), con las URLs que
  arma la web: 4 pruebas temporales, fuera del repo, más las 48 de FE-08, todas pasan.
  - Cada estado trae los campos que lee la web.
  - El polling ve `pendiente → procesando (40) → completada`, y se mantiene.
  - `progreso` es null sin total.
  - Los errores llegan como `{codigo, mensaje, fila}`, con `fila: null` cuando no son de una fila.
  - Otra organización, y el id `a%2Fb%3Fc`, responden 404.
  - `?mias=true&page=N` pagina de a 10, sin las de otra persona del hogar.
- **Mutaciones:** se rompió a propósito cada comportamiento y en las 18 falla alguna prueba:
  - no detenerse al terminar, o no limpiar el temporizador;
  - mostrar la respuesta vieja;
  - sin backoff, sin volver a 1 s o sin tope de 10 s;
  - preguntar con la pestaña oculta, o no preguntar al volver;
  - no detenerse por fallos, o borrar lo último al fallar;
  - reintentar el 404;
  - barra con 0 inventado;
  - decir "importación exitosa", o no aclarar que no se tocó ninguna suscripción;
  - esconder el "Y N más", o la fila del error;
  - "Ver más" con repetidas;
  - no avisar que puede estar desactualizado.
- **Navegador** contra una API falsa con la forma de FE-08:
  - de Cuentas conectadas a la lista y al progreso;
  - la barra avanzó 0 → 20 → 40 → 60 → 80 % hasta "El análisis terminó", con 7 consultas y ninguna
    más en los 12 s siguientes;
  - el correo sin total (barra indeterminada que habla de mensajes, no de filas: se corrigió aquí);
  - fallida con "Y 24 más.";
  - tema claro;
  - 375 px sin scroll horizontal.
- CI local desde `frontend/`: typecheck, pruebas de todos los paquetes y build.

## Fuera de esta tarea

- **Subir el archivo** es FE-07 (PR #120). Cuando esté, después de subir solo hay que navegar a
  `/importaciones/<id>`.
- La **previsualización y confirmación de candidatos** son FE-10 y FE-11.
