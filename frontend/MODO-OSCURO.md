# Modo oscuro y claro: verificación y correcciones (web)

**Rama:** `Christopher/modo_oscuro` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-24 | Verificar y completar modo oscuro web | ✅ |

**Sin dependencias.** Lo que ya había (el hook `useTema`, `iniciarTema` en `main.tsx`, los dos juegos de
variables en `theme.css` y el selector en Ajustes) funciona. La frase "el selector no hace nada" del
adjunto ya no es cierta. Lo que faltaba era contraste y la carga sin parpadeo.

## Cómo se buscó

1. Se midió el contraste WCAG de **cada texto visible** en el navegador, con un script que compone el
   fondo real de cada elemento (sus fondos sobre `--fondo`).
2. Se hizo en tema claro y oscuro, en todas las páginas:
   - con sesión: Panel, Inicio, detalle, Calendario, Agenda, Perfil, Cuentas, Ajustes, Recomendaciones e
     Informes;
   - sin sesión: Login, Registro, Recuperar y Restablecer;
   - el modal "Nueva suscripción".
3. Con la ventana oculta las transiciones no avanzan y algunos botones se medían con el color del tema
   anterior. Por eso la medición se hizo con las transiciones apagadas.

**Antes**, todo lo que quedaba bajo 4,5:1 (3:1 para el foco):

| Tema | Qué | Contraste | Dónde |
|---|---|---|---|
| claro | `--tinta-3` (etiquetas chicas, pie, ayuda de los campos, placeholder) | 2,7–3,0 | todas las páginas |
| claro | `--acento` usado como letra (menú activo, enlaces, botón sutil) | 2,7–3,0 | todas |
| claro | letra blanca sobre el naranjo (botón primario, burbujas, contador de la campana) | 3,1 | todas |
| claro | `--verde`, `--turquesa`, `--coral` como letra (insignias, montos) | 3,2–4,2 | Panel, Inicio |
| claro | `--foco` (borde de foco) | 2,7 | todas |
| claro y oscuro | contador de los filtros (`opacity: 0.65`) | 3,0 / 4,1 | Inicio |
| oscuro | `--tinta-3` | 3,9–4,4 | todas |

**Después:** ninguna página tiene texto bajo el mínimo, en los dos temas. Solo quedan marcados los textos
sobre un degradado, que el script no compone, y se calcularon aparte:
- letra oscura sobre el naranjo del botón primario: 4,9–6,2 en claro y más de 8 en oscuro;
- letra blanca sobre la escena del Panel, que es oscura en los dos temas: más de 13.

## Qué se cambió

- **Tokens** ([web/src/styles/theme.css](web/src/styles/theme.css)). Se oscurecieron lo justo para
  llegar a 4,5:1; los `-suave` (tintes de fondo) son los mismos.

  | Token | Oscuro | Claro |
  |---|---|---|
  | `--tinta-3` | #6f7891 → **#7d86a2** | #8a93a8 → **#646c7e** |
  | `--acento-texto` (nuevo) | #ff8a3d | **#a25013** |
  | `--acento-tinta` | #1a0d05 | #ffffff → **#1a0d05** (letra oscura sobre el naranjo, como en oscuro) |
  | `--verde` / `--turquesa` / `--azul` / `--morado` | morado #9b7bff → **#9f80ff** | **#107452 / #0b736b / #2061d3 / #694bdf** |
  | `--coral` | — | #d64545 → **#c02a2a** |
  | `--coral-tinta` (nuevo) | #1a0606 | **#ffffff** |
  | `--foco` | — | #e5731f → **#a25013** |

- **`--acento` es el relleno y `--acento-texto` la letra.** Los 21 `color: var(--acento)` de 14 archivos
  CSS pasaron a `--acento-texto`. Los rellenos, bordes y `accent-color` siguen con `--acento`, así que
  la marca se ve igual. El botón de peligro usa `--coral-tinta` en vez de un `#1a0606` fijo.
- **Contador de los filtros** ([web/src/pages/Homepage.module.css](web/src/pages/Homepage.module.css)):
  ya no usa `opacity`; se distingue por el peso.
- **El tema se pone antes de pintar** ([web/index.html](web/index.html)). Un script en línea lee
  `oag-tema` antes de que cargue la app. Antes, quien había elegido el claro veía un instante el oscuro al
  recargar, porque el tema recién se aplicaba al ejecutarse `main.tsx`. La clave es `CLAVE_TEMA`
  (ahora exportada de `useTema.ts`) y la prueba comprueba que sea la misma.
- **La barra del navegador del teléfono** (`<meta name="theme-color">`) toma el `--fondo` del tema; antes
  quedaba siempre oscura.
- **Lo que ya estaba bien y se dejó:**
  - los colores fijos del Panel, porque su escena es oscura a propósito en los dos temas;
  - la bolita blanca de los interruptores;
  - el logo;
  - el avatar, que es decorativo (`aria-hidden`).

## Cómo se comprobó

- [web/src/styles/theme.test.ts](web/src/styles/theme.test.ts), 36 pruebas. Lee `theme.css` y calcula el
  contraste de cada token de texto en los dos temas:
  - sobre el fondo, el tile y la superficie de los modales;
  - cada color sobre su propio tinte (insignias);
  - la letra de los botones sobre su relleno (el primario, en los dos extremos del degradado);
  - el foco a 3:1.

  Además recorre todos los CSS y falla si alguno vuelve a usar `color: var(--acento)`.
- [web/src/hooks/useTema.test.tsx](web/src/hooks/useTema.test.tsx), 11 pruebas:
  - oscuro por omisión;
  - se conserva al recargar, y lo elegido se aplica y lo ve otra pantalla (navegar);
  - un valor inválido se ignora;
  - funciona sin `localStorage`;
  - el `theme-color`;
  - el script de `index.html` corrido de verdad: misma clave, va antes de la app, ignora valores
    inválidos y no rompe sin `localStorage`.
- **Mutaciones:** se rompió a propósito cada corrección y en las 19 falla alguna prueba:
  - cada token devuelto a su valor anterior (tinta-3 en los dos temas, letra blanca sobre el naranjo,
    naranjo de letra igual al de relleno, verde, turquesa, azul, coral, morado, letra oscura sobre el
    coral y el foco);
  - los enlaces o un componente con `--acento` como letra;
  - el `theme-color` que no cambia;
  - el tema guardado que no se aplica o no se guarda;
  - `index.html` sin el script, aceptando cualquier valor o sin `try`.
- **Navegador:**
  - la auditoría de arriba, antes y después;
  - elegir Claro en Ajustes, navegar a Inicio y recargar: sigue claro desde antes de que monte React, y
    el `theme-color` pasa a `#eef1f8`.
- CI local desde `frontend/`: typecheck, pruebas de todos los paquetes y build.

## Fuera de esta tarea

- **Las páginas de las PR abiertas:**
  - Recomendaciones (CH-26 y CH-32), Avisos de Ajustes (CH-30) e Importaciones (CH-27) se corrigieron en
    sus propias ramas, con los mismos tokens;
  - este cambio no toca sus archivos, para que no choquen.

  Al mergearlas, la prueba de `color: var(--acento)` también las cubre.
- Seguir el tema del sistema (`prefers-color-scheme`) cuando nadie eligió: hoy el valor por omisión es
  oscuro a propósito (está escrito así en `useTema.ts`).
