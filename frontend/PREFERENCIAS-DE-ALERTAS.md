# Canales y tipos de alertas en Configuración (web)

**Rama:** `Christopher/preferencias_alertas` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-30 | Configurar canales y tipos de alertas en web | ✅ |

**Dependencia:** FE-21 (Felipe), ya en `main` (PR #115). `GET` y `PATCH /api/preferencias-alertas/`,
enrutadas por el gateway a Notifications. Son las preferencias de quien consulta: la organización y el
usuario los pone el gateway, así que no hay id. El primer GET crea los valores por omisión. Un PATCH
inválido responde 400 y no guarda nada.

## Dónde está

Rutas relativas a `frontend/`.

| Archivo | Qué hace |
|---|---|
| [shared/src/api/preferencias.ts](shared/src/api/preferencias.ts) | Tipos de FE-21, `getPreferenciasAlertas`, `guardarPreferenciasAlertas` y `cambiosDePreferencias` |
| [web/src/components/Configuracion/PreferenciasAvisos.tsx](web/src/components/Configuracion/PreferenciasAvisos.tsx) | La sección "Avisos": leer, editar, guardar y avisar cambios sin guardar |
| [web/src/pages/ConfiguracionPage.tsx](web/src/pages/ConfiguracionPage.tsx) | Usa `<PreferenciasAvisos />` en vez de los cuatro estados locales |

## Qué hace

- **Lee lo guardado.** Al entrar a Ajustes se pide `GET /preferencias-alertas/` y los interruptores
  muestran eso. Antes eran `useState(true)` que se perdían al recargar. Mientras carga lo dice; si falla,
  `ErrorConReintento`.
- **Por dónde:** correo, push y dentro de la app. **De qué:** antes de cada cobro, fin de prueba gratis,
  alza de tarifa, posible doble cobro y presupuesto excedido. Son uno por cada tipo de alerta de FE-21.
  "Antes de cada cobro" dice los días que trae `dias_anticipacion`, en vez de un texto fijo.
- **No promete lo que no llega.** Si un canal no está en `canales_disponibles` (hoy, push), se puede
  encender y queda guardado, pero la fila dice "Todavía no lo enviamos". Si se apagan los tres canales,
  avisa que no llegará ningún aviso.
- **Editar no es guardar.** Los interruptores cambian un borrador, y el pie dice cuál es cuál:
  "Tienes cambios sin guardar." o "Guardado · <fecha>" (`actualizado_en`). Si se vuelve al valor
  original, deja de haber cambios. **Descartar** vuelve a lo guardado sin llamar a la API.
- **El PATCH lleva solo lo que cambió:**

  ```ts
  const enviar = cambiosDePreferencias(carga.guardadas, editadas); // p. ej. { por_push: true }
  const guardadas = await guardarPreferenciasAlertas(enviar);
  ```

  Mientras viaja, los interruptores y los botones quedan deshabilitados, y un doble clic manda un solo
  PATCH. Lo que queda como guardado es lo que devuelve el servidor.
- **Si falla, no se pierde nada:** lo editado sigue en pantalla como pendiente, con el error
  (`role="alert"`). Puede ser sin red, un 400 con el mensaje del backend o un 500. "Guardar cambios"
  reintenta. FE-21 es todo o nada, así que no hay mitades guardadas.
- **Cambios sin guardar (como CH-16):** cerrar o recargar la pestaña lo pregunta el navegador
  (`useAvisoAlSalir`). Navegar dentro de la app queda retenido (`useBlocker`) con el mismo aviso de
  CH-16: "Seguir editando" se queda y "Descartar cambios" sigue. Si se guarda con la navegación
  retenida, después de guardar se completa.
- **Fuera:** "Consejos para gastar menos" no existe en FE-21. Era un interruptor que no guardaba nada,
  así que se quitó.

## Cambio de sesión (revisión de #129)

Si otra pestaña entraba como B, el formulario seguía con el borrador de A, y "Guardar cambios" lo
mandaba con el token de B.

- **El límite común de #128.** `<RutaPrivada>` usa la marca de sesión de `AuthContext` como `key`: al
  cambiar de cuenta, Configuración se vuelve a montar desde cero. Se descartan lo guardado, el borrador,
  los errores, el indicador de guardado y el bloqueo de navegación, y se piden las preferencias de B,
  aunque `/usuarios/me/` de B siga pendiente. Un refresh del token no cambia la marca.
- **El formulario anota su sesión.** `PreferenciasAvisos` guarda la sesión con que se montó y cubre el
  instante entre el cambio y el nuevo montaje:
  - con la sesión ya cambiada no se manda el PATCH;
  - si la confirmación llega para la sesión anterior, o con la página ya cerrada, no reemplaza lo que
    se ve, no avisa ni ejecuta `proceed()` de una navegación retenida.

## Cómo se comprobó

- `shared/src/api/preferencias.test.ts`: rutas y métodos, que los cambios sean solo lo distinto y que lo
  editable no incluya lo del servidor.
- `web/src/components/Configuracion/PreferenciasAvisos.test.tsx` (componente real con un router de
  datos como el de `main.tsx`; solo se simula la red), 16 pruebas:
  - leer lo guardado, push no disponible y error de carga con reintento;
  - pendiente contra guardado, volver al original y PATCH con solo lo cambiado;
  - deshabilitado mientras guarda y lo confirmado como guardado;
  - el fallo sin red, con 400 y con 500, conservando lo editado y con reintento;
  - Descartar, el doble clic y los canales apagados;
  - navegación retenida con Seguir editando, Descartar cambios y guardar, y sin cambios no se retiene.
- `web/src/components/Configuracion/PreferenciasAvisos.sesion.test.tsx` (revisión de #129):
  `AuthProvider`, guarda privada, router de datos y tokens reales; solo se simula la red. Son 9 pruebas:
  - editar como A y entrar B por `storage`: se ven las de B y Guardar no manda nada;
  - un clic en Guardar en el mismo instante del cambio;
  - el GET de A y el PATCH de A que terminan después del cambio;
  - la confirmación de A en el mismo instante, con la navegación retenida, que no sigue;
  - cerrar sesión y entrar B;
  - salir de la página mientras guarda;
  - el fallo dentro de la misma sesión, con reintento;
  - el refresh del token durante el guardado, que no lo invalida.
- **Mutaciones de la revisión:** sin `key` en la guarda, guardar sin revisar la sesión antes de enviar o
  después de la respuesta, la sesión vigente sin mirar el montaje o sin mirar la sesión, y un refresh
  como cambio de cuenta. En las 6 falla alguna prueba.
- **Sobre `main` actualizado** (con #128): shared 219, web 385 y móvil 37 pruebas, typecheck y build.
- **Contrato con las vistas reales** de `services/notifications` (código de main, SQLite), con lo que
  manda la web: 5 pruebas temporales, fuera del repo, más las 32 de FE-21, todas pasan.
  - El GET trae exactamente las claves que lee la web.
  - El PATCH de solo cambios no pisa lo demás y se recupera al recargar.
  - Los tres canales apagados se aceptan.
  - `dias_anticipacion: 99` responde 400 con un mensaje por campo y tampoco guarda el valor válido que
    iba con él.
- **Mutaciones:** se rompió a propósito cada comportamiento y en las 15 falla alguna prueba:
  - el PATCH con todo, o guardar al instante;
  - revertir sin avisar, o no distinguir pendiente de guardado;
  - no tomar lo guardado de la respuesta;
  - editar mientras guarda, o doble PATCH;
  - Descartar que no vuelve;
  - prometer el push, o no avisar de los canales apagados;
  - no retener la navegación, no completarla al guardar o retenerla sin cambios;
  - esconder el error de carga;
  - días de anticipación fijos (esta se escapaba con el valor por omisión, 3, y se agregó la prueba
    con 7 y con 1).
- **Navegador** contra una API falsa con la forma de FE-21:
  - el PATCH llevó solo `{"por_push":true,"avisar_alza_tarifa":false}`;
  - la navegación quedó retenida con el aviso y el foco en "Seguir editando";
  - al recargar se conservó;
  - con un 500 lo editado siguió como pendiente;
  - 375 px sin scroll horizontal.
  - Contraste en tema claro y oscuro: el subtítulo y el aviso de pendiente usaban `--tinta-3` y
    `--acento`, cerca de 3:1 en tema claro. Ahora usan `--tinta-2` y `--tinta` (más de 6:1), y el
    pendiente lleva un punto de color.
  - Dos pestañas (revisión de #129), con preferencias distintas por cuenta:
    - con un borrador de A, la otra pestaña entró como B; la página pasó sola a las preferencias de B,
      sin el borrador, y Guardar no mandó nada;
    - con el guardado de A en vuelo entró B; la confirmación no mostró aviso ni error, y ningún PATCH
      salió con la cuenta de B.
- CI local desde `frontend/`: typecheck, pruebas de todos los paquetes y build.

## Fuera de esta tarea

- Editar `dias_anticipacion` (1 a 30): FE-21 lo acepta, pero la tarjeta pide los interruptores. Por ahora
  solo se muestra.
- El push real (FE-22) y el centro de alertas (CH-31, que espera a SE-01).
