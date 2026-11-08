# Accesibilidad de formularios y modales (web)

**Rama:** `Christopher/accesibilidad` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-25 | Mejorar accesibilidad de formularios y modales | ✅ |

**Sin dependencias.**

## Cómo se buscó

1. **Auditoría automática en el navegador.** Un script sin dependencias recorrió cada página y cada modal
   buscando:
   - controles y botones sin nombre accesible;
   - ids repetidos;
   - `aria-labelledby`, `aria-describedby` o `aria-controls` que apuntan a ids que no existen;
   - campos marcados inválidos sin un error asociado;
   - diálogos sin nombre;
   - imágenes sin `alt`.

   Se pasó por el Panel, Inicio, el detalle, Calendario, Agenda, Perfil, Cuentas, Ajustes y
   Recomendaciones. También por los modales Nueva suscripción, Cancelar y Cambiar contraseña, y por Login,
   Registro, Recuperar y Restablecer, enviando los formularios vacíos.
2. **Teclado de verdad en el navegador:** Tab y Shift+Tab repetidos dentro de los modales, y Escape.
3. **Revisión del código** de `Modal` y `Campo`.

**Resultado:** todos los controles ya tenían nombre accesible (`Campo` asocia `label`/`htmlFor` y
`aria-describedby`). Los problemas estaban en el foco:

| Problema | Dónde | Evidencia |
|---|---|---|
| Tab y Shift+Tab salían del modal hacia la página de atrás | todos los modales | Tab desde el último: el foco pasaba a los 52 elementos de atrás |
| Al cerrar, el foco se perdía en `<body>` en vez de volver a quien abrió el modal | Nueva y Editar suscripción | el formulario enfoca su campo antes que el efecto del modal, y el modal guardaba ese campo como "quien lo abrió" |
| Si el padre pasaba un `alCerrar` nuevo en cada render, el foco saltaba al primer campo | `Modal` | el efecto dependía de `alCerrar` y se volvía a correr |
| El foco inicial caía en "Actualizar opciones" y no en el primer campo | Nueva suscripción | tomaba el primero en el DOM entre campos y botones |
| `id="modal-titulo"` fijo; la descripción no describía al diálogo | `Modal` | dos modales repetían el id, y `aria-describedby` faltaba |
| Escape cerraba todos los modales abiertos, no solo el de arriba | `Modal` | un listener por modal, sin orden |
| `id="ojo-fondo"` repetido en cada logo (2–3 por página) | `OjoMarca` | si el primero quedaba oculto, los otros perdían el degradado |
| El error del correo era un aviso suelto, sin asociar al campo, y el foco quedaba en `<body>` | Recuperar contraseña | `aria-invalid` ausente |
| El foco no iba al primer campo con error | Restablecer contraseña | Registro sí lo hacía |

## Qué se cambió

- **[web/src/components/ui/Modal.tsx](web/src/components/ui/Modal.tsx):**
  - **Foco atrapado.** Tab en el último vuelve al primero, Shift+Tab en el primero va al último y, si el
    foco quedó afuera, Tab lo trae de vuelta.
  - **Foco al cerrar.** Vuelve a lo que abrió el modal, que ahora se toma **al renderizar** (antes de
    que los hijos muevan el foco). Si eso ya no existe (la fila eliminada), no se fuerza nada.
  - **Foco inicial.** Va a lo que pida `autoFocus` o `data-autofocus`; si no, al primer campo; si no, al
    primer botón que no sea la X. Si un hijo ya puso el foco adentro, se respeta.
  - **`alCerrar` en una ref.** El efecto corre una sola vez y siempre llama a la última versión.
  - **Ids.** `useId` para el título y la descripción, y `aria-describedby` con la descripción.
  - **Escape** cierra solo el modal de más arriba.
- **[web/src/components/layout/Marca.tsx](web/src/components/layout/Marca.tsx):** el degradado de cada
  ojo tiene su propio id, sin `:` para que `url(#…)` no tenga dudas.
- **[web/src/pages/RecuperarContrasenaPage.tsx](web/src/pages/RecuperarContrasenaPage.tsx):** el error
  del correo va en su campo (`aria-invalid` y descripción) y el foco vuelve ahí. Es así tanto para la
  validación local como para un 400 del backend con `email`. Sin red y los 5xx siguen como aviso general.
- **[web/src/pages/RestablecerContrasenaPage.tsx](web/src/pages/RestablecerContrasenaPage.tsx):** el
  foco va al primer campo con error, también cuando el backend rechaza la contraseña.

## Cómo se comprobó

- [web/src/components/ui/Modal.test.tsx](web/src/components/ui/Modal.test.tsx), 12 pruebas:
  - el foco inicial: el campo antes que el botón, el primer botón sin campos y `data-autofocus`;
  - Tab y Shift+Tab en los bordes, y el foco que quedó afuera;
  - la vuelta del foco al cerrar, también cuando el contenido enfoca su campo, en `StrictMode`, y sin
    romper si quien lo abrió ya no existe;
  - un `alCerrar` nuevo en cada render: el foco no salta y se usa el último;
  - el nombre y la descripción;
  - dos modales: sin ids repetidos y Escape solo al de arriba;
  - el fondo cierra un diálogo y no una alerta;
  - el desplazamiento de la página se restaura.

  **Con el `Modal` anterior fallan 7 de las 12;** las que pasan son lo que ya funcionaba.
- [web/src/components/layout/Marca.test.tsx](web/src/components/layout/Marca.test.tsx): dos ojos, dos
  ids distintos, cada uno pintado con el suyo.
- `RecuperarContrasenaPage.test.tsx` y `RestablecerContrasenaPage.test.tsx`: además del mensaje,
  ahora exigen que el campo esté marcado inválido, que el error sea su descripción accesible y que tenga
  el foco.
- **Mutaciones:** se rompió a propósito cada corrección y en las 19 falla alguna prueba:
  - sin trampa, Shift+Tab o Tab que salen, o el foco de afuera que no vuelve;
  - Escape a todos;
  - id del título fijo, o sin `aria-describedby`;
  - el foco que no vuelve, o el abridor tomado tarde;
  - pisar el foco del hijo, o el foco inicial como antes;
  - el primer `alCerrar`;
  - sin restaurar el desplazamiento;
  - id del logo fijo;
  - el error del correo fuera del campo, sin foco, o el 400 como aviso general;
  - Restablecer sin foco, en la validación y tras el rechazo del backend.
- **Navegador:**
  - en Nueva suscripción el foco empieza en "Servicio";
  - 25 Tab y 30 Shift+Tab reales no sacan el foco del diálogo;
  - Escape lo devuelve a "Agregar suscripción";
  - en Cancelar empieza en "Volver" y vuelve a "Cancelar suscripción";
  - en Recuperar con el correo vacío, el foco va al campo con su error asociado, y en Restablecer va a
    la confirmación;
  - la auditoría automática, repetida al final, da 0 problemas en todas las páginas y en el modal.
- CI local desde `frontend/`: typecheck, pruebas de todos los paquetes y build.

## Fuera de esta tarea

- Las páginas de las PR abiertas (Recomendaciones, Avisos de Ajustes e Importaciones) no se tocaron, para
  que no choquen. En Recomendaciones, la tarjeta clicable (`div` con `onClick`) ya se reemplazó por un
  enlace en su rama (CH-26 y CH-32).
- El Login no valida localmente los campos vacíos: los manda al backend y muestra su respuesta. No es de
  accesibilidad, pero se nota al probar con el teclado.
