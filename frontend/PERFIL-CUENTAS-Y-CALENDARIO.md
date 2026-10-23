# CH-08, CH-29, CH-23 y CH-17: Perfil, Cuentas conectadas y Calendario

Rama: `Christopher/perfil_cuentas_calendario` (sale de `main`).
Las cuatro tareas no esperan a nadie: el backend que usan ya está en `main`
o no lo necesitan. Ningún dato está escrito en el código: todo sale de la API
o, si la API todavía no existe, la pantalla lo dice.

| Tarea | Qué hace | Dónde está |
|---|---|---|
| CH-08 | Editar el nombre desde Perfil | `web/src/components/perfil/EditarNombre.tsx` |
| CH-29 | Cambiar la contraseña con la sesión iniciada | `web/src/components/perfil/CambiarContrasena.tsx` |
| CH-23 | Página de Cuentas conectadas y sus estados | `web/src/pages/CuentasConectadasPage.tsx`, `web/src/components/Cuentas/ListaCuentas.tsx` |
| CH-17 | Página Calendario con la cuadrícula del mes | `web/src/pages/CalendarioPage.tsx`, `web/src/components/calendario/CuadriculaMes.tsx` |

---

## CH-08: editar el nombre

En Perfil, "Editar" abre el campo en la misma fila. Se guarda con
`PATCH /api/usuarios/me/` (MX-06) y **se muestra lo que respondió el
backend**, no lo que se escribió:

```tsx
// web/src/components/perfil/EditarNombre.tsx
const usuario = await actualizarNombre(valor); // shared: PATCH solo con { nombre }
onGuardado(usuario);                            // Perfil y la barra superior
```

- La validación es la del backend (`validarNombre` en `shared/src/validaciones.ts`):
  se recorta, no puede quedar vacío y tiene máximo 150 caracteres contados como
  Python (150 emojis valen 150). Lo comprobé pasando los mismos casos por
  `CambioPerfilSerializer`.
- Cancelar, Escape o un error **conservan el último nombre confirmado**. El
  campo queda abierto con lo escrito para corregir.
- La barra superior cambia sin recargar: `AuthContext` tiene `actualizarUsuario()`.
- Sin cambios no se llama a la API, y dos envíos seguidos mandan un solo PATCH.

## CH-29: cambiar la contraseña

El botón "Cambiar" de la fila Contraseña (Perfil) abre un formulario con la
contraseña actual, la nueva y la confirmación. Usa `POST /api/auth/change-password/` (MX-05).

> La tarjeta dice "desde Configuración"; el pedido original dice
> "Configuración/Perfil". La fila Contraseña ya existía en Perfil, así que
> quedó ahí para no tener dos entradas.

- Si la confirmación no coincide, **no se envía** (`validarCambioContrasena`).
  La nueva contraseña usa la misma política que el registro (MX-30).
- Cada error del backend va a su campo. Por ejemplo, "La contraseña actual no es
  válida." aparece bajo *Contraseña actual*.
- **Efecto sobre la sesión:** al cambiar la contraseña el backend invalida
  todas las sesiones, también la de este navegador. Por eso se cierra la sesión
  local y `RutaPrivada` lleva al login, que después vuelve a Perfil:

```tsx
// web/src/pages/PerfilPage.tsx
const alCambiarContrasena = useCallback(() => {
  cerrarSesionLocal();                           // igual que al restablecer (CH-07)
  toast.exito(MENSAJE_CONTRASENA_CAMBIADA);
}, [cerrarSesionLocal, toast]);
```

- Con un 503 o sin red la contraseña no cambió: se avisa y la sesión sigue.
  Mientras se envía no se puede cerrar el formulario.

## CH-23: Cuentas conectadas

Ruta `/cuentas` con **una sola página** y un componente base. La integración
real es de Andrea, que solo tiene que pasarle dos props desde `App.tsx`:

```tsx
// Contrato (web/src/pages/CuentasConectadasPage.tsx)
cargarCuentas?: () => Promise<CuentaConectada[]>; // AN-17: listado de connectors
accionConectar?: ReactNode;                        // AN-15: <ConectarCorreo … />
```

- El tipo `CuentaConectada` (`shared/src/tipos.ts`) copia
  `CuentaConectadaSerializer` del servicio connectors (FE-01), sin los tokens.
- Estados: conectada, **pendiente** (= `requiere_reautorizacion`, la cuenta
  necesita que el usuario vuelva a autorizar), con error y desconectada. Además
  hay tres estados de pantalla: sin cuentas, cargando, y error con Reintentar.
  El texto del estado lo manda el backend (`estado_legible`); el código solo
  elige el color.
- **Sin `cargarCuentas` la página dice que todavía no está disponible.** No
  muestra "no tienes cuentas" (sería falso) ni cuentas inventadas.
- Configuración tenía "No conectado" y "No disponible" escritos a mano. Ahora
  esa sección enlaza a `/cuentas`.

## CH-17: Calendario

Ruta `/calendario` con el mes actual de lunes a domingo, hoy marcado y un día
elegido.

> **Actualización:** desde CH-18 los cobros del calendario vienen del endpoint
> de VI-07 (`calendario-cobros`). Ver `CALENDARIO-DE-COBROS.md`.

- **Datos reales:** cada suscripción aporta su próximo cobro, con la misma
  regla que la proyección del Panel. La regla se sacó de `gastoProyectado` a
  `generaCobro()` (`shared/src/calculos.ts`). CH-18 reemplazará esta fuente
  por el rango mensual de VI-07 usando el mismo contrato:

```ts
// web/src/components/calendario/CuadriculaMes.tsx
export interface EventoCalendario {
  id: string; fecha: string; titulo: string; monto: number; moneda: Moneda; suscripcionId: string;
}
```

- **Accesible:** es una tabla `role="grid"`. Cada día es un botón que dice
  "jueves, 1 de octubre de 2026, 1 cobro" y hoy lleva `aria-current="date"`. Se
  recorre con las flechas, Inicio y Fin, y solo un día recibe Tab a la vez. Por
  ahora no se sale del mes: cruzar a otro mes es CH-19.
- **Fechas sin UTC:** todo se arma en hora local (`web/src/utils/calendario.ts`).
  `new Date("2026-10-01")` sería el 30 de septiembre en Chile. Los tests fijan
  la zona de Chile para detectar ese error aunque CI corra en UTC.
- Meses de 28 a 31 días y de 4 a 6 semanas, con estados de carga, error con
  Reintentar y "No hay cobros este mes".
- Los nombres de meses y días los da `Intl` (es-CL), en `shared/src/formato.ts`.

---

## Archivos

**Nuevos**
- `shared/src/api/usuarios.test.ts`, `shared/src/formato.test.ts`
- `web/src/components/perfil/` (EditarNombre, CambiarContrasena, Perfil.module.css)
- `web/src/components/Cuentas/` (ListaCuentas, Cuentas.module.css)
- `web/src/components/calendario/` (CuadriculaMes, Calendario.module.css)
- `web/src/components/ui/ErrorConReintento.tsx` (+ css)
- `web/src/pages/CuentasConectadasPage.tsx`, `web/src/pages/CalendarioPage.tsx` y sus tests, `web/src/pages/PerfilPage.test.tsx`
- `web/src/utils/calendario.ts` (+ test), `web/src/utils/mensajes.ts`

**Modificados**
- `shared/src/api/cliente.ts`: `ErrorDeApi.campos`, **idéntico al de la PR #80**,
  así que no hay conflicto al mergear.
- `shared/src/api/usuarios.ts`, `shared/src/validaciones.ts`, `shared/src/tipos.ts`,
  `shared/src/formato.ts`, `shared/src/calculos.ts` (+ sus tests)
- `web/src/context/AuthContext.tsx`, `web/src/pages/PerfilPage.tsx`,
  `web/src/pages/ConfiguracionPage.tsx`, `web/src/pages/ProximamentePage.tsx`,
  `web/src/App.tsx` (+ test)

## Cómo se comprobó

- Typecheck y build en verde. Tests: shared 84 → 113 y web 79 → 133. Pasan en
  UTC, Chile, Tokio, UTC+14 y Los Ángeles.
- Rompí a propósito 20 comportamientos clave y los tests detectan 19. El que
  queda no se puede detectar con un test: es el estado inicial de Cuentas, que
  el efecto corrige al instante.
- En el navegador, contra una API falsa: guardar el nombre (barra superior
  incluida), contraseña actual incorrecta, contraseña cambiada (vuelve al
  login), las cuatro cuentas con sus estados, el calendario con teclado, y el
  tema claro y celular sin scroll horizontal.
- **Conflicto esperado con AN-20 (Andrea):** en `App.tsx`, las líneas de las
  rutas están juntas. Se resuelve dejando las tres:
  `/calendario` → `CalendarioPage`, `/recomendaciones` → `RecomendacionesPage`,
  `/cuentas` → `CuentasConectadasPage`.
