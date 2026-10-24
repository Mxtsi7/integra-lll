# Formularios de suscripción y uso (web)

**Rama:** `Christopher/suscripciones_formularios_y_uso` · **Responsable:** Christopher Solís

| # | Tarea | Estado |
|---|---|---|
| CH-09 | Completar validaciones del formulario de creación web | ✅ |
| CH-16 | Avisar cambios sin guardar en formularios web | ✅ |
| CH-14 | Registrar minutos de uso desde Detalle web | ✅ |
| CH-15 | Mostrar historial de uso web por fecha | ✅ |

**Dependencias:** CH-09 no tiene. CH-16 depende de CH-09 (está en esta misma rama). CH-14 y CH-15
dependían de **VI-10** (Victor), que ya entró a `main` (PR #67): `horas_uso_mes` se calcula con los
usos del mes actual, así que al cambiar de mes vuelve a 0 sin tareas programadas.

**Integración con los catálogos (PR #77 de Maxi).** Las monedas, categorías y frecuencias del formulario
de creación ya no están escritas en el código: vienen de `GET /api/catalogos/suscripciones/`. La
validación de CH-09 recibe esas opciones (`validarSuscripcion(datos, opciones)`), así que una moneda
o categoría nueva del catálogo vale sin tocar el frontend.

## Dónde está cada tarea

Rutas relativas a `frontend/`.

| Tarea | Archivo | Qué hace |
|---|---|---|
| CH-09, 14 | [shared/src/validacionesSuscripcion.ts](shared/src/validacionesSuscripcion.ts) | Reglas de suscripción y de uso (iguales al backend) |
| CH-09, 14 | [shared/src/api/cliente.ts](shared/src/api/cliente.ts) | `ErrorDeApi.campos`: errores por campo del backend |
| CH-14, 15 | [shared/src/api/suscripciones.ts](shared/src/api/suscripciones.ts) | `getUsos()` y `registrarUso()` con fecha |
| CH-09 | [web/src/components/subscriptions/NuevaSuscripcionForm.tsx](web/src/components/subscriptions/NuevaSuscripcionForm.tsx) | Errores por campo, período de prueba, errores del servidor |
| CH-16 | [web/src/pages/Homepage.tsx](web/src/pages/Homepage.tsx) | Pregunta antes de cerrar un formulario con cambios |
| CH-16 | [web/src/components/subscriptions/AvisoCambiosSinGuardar.tsx](web/src/components/subscriptions/AvisoCambiosSinGuardar.tsx) | Aviso "Seguir editando / Descartar cambios" |
| CH-16 | [web/src/hooks/useAvisoAlSalir.ts](web/src/hooks/useAvisoAlSalir.ts) | Confirmación al cerrar o recargar la pestaña |
| CH-16 | [web/src/components/subscriptions/EditarSuscripcionForm.tsx](web/src/components/subscriptions/EditarSuscripcionForm.tsx) | Detecta cambios al editar |
| CH-14 | [web/src/components/subscriptions/RegistrarUsoForm.tsx](web/src/components/subscriptions/RegistrarUsoForm.tsx) | Formulario de minutos y día |
| CH-15 | [web/src/components/subscriptions/HistorialUso.tsx](web/src/components/subscriptions/HistorialUso.tsx) | Lista de usos con carga, vacío y error |
| CH-14, 15 | [web/src/pages/SuscripcionDetallePage.tsx](web/src/pages/SuscripcionDetallePage.tsx) | Sección "Uso" del detalle |

---

## CH-09 — Validaciones del formulario de creación

**Antes:** un solo mensaje para todo ("Revisa el nombre y el monto…"). `parseFloat("1e400")` da
`Infinity`, que es mayor que 0, así que un monto infinito pasaba; no se revisaban los límites del
backend; no había forma de marcar un período de prueba; y del servidor se mostraba un solo texto.

**Las reglas copian el modelo y el serializer del backend** (`shared/src/validacionesSuscripcion.ts`):

```ts
export function parsearMonto(texto: string): { valor: number } | { error: string } {
  const limpio = texto.trim().replace(',', '.');                 // acepta coma decimal
  if (!limpio) return { error: 'Ingresa el monto.' };
  if (/^-/.test(limpio)) return { error: 'El monto debe ser mayor a 0.' };
  if (/^\d+\.\d{3,}$/.test(limpio)) return { error: 'Usa como máximo 2 decimales.' };
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return { error: 'Ingresa un monto válido, solo con números.' };
  const valor = Number(limpio);
  if (valor <= 0) return { error: 'El monto debe ser mayor a 0.' };          // = validate_monto
  if (valor > MONTO_MAXIMO) return { error: 'El monto no puede superar 99.999.999,99.' }; // DecimalField(10, 2)
  return { valor };
}
```

Y una fecha tiene que **existir**, no solo tener el formato:

```ts
export function esFechaReal(iso: string): boolean {
  // … separa año, mes y día …
  // Date.UTC "corre" las fechas imposibles (30 de febrero → 2 de marzo):
  // si al volver no da el mismo día, no existía.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}
```

**En el formulario**, si algo no cumple no se envía:

```tsx
// opciones = los códigos activos del catálogo (monedas, categorías y frecuencias)
const locales = validarSuscripcion({ nombre, monto, moneda, categoria, frecuencia, fechaProximoCobro, enPrueba, finPrueba }, opciones);
setErrores(locales);
if (Object.keys(locales).length > 0) {
  enfocarPrimerError(locales);   // el foco va al primer campo con error
  return;                        // fecha imposible o monto cero/negativo: no se envía
}
```

- **Período de prueba:** nueva casilla "Está en período de prueba gratis". Si se marca, aparece
  "Termina la prueba", que es obligatorio, y se envía `estado: "prueba"` con `fin_prueba`.
- **El monto es texto con teclado decimal** (antes `type="number"`): acepta la coma que se usa en Chile
  y deja explicar el error. Con `number` el navegador vacía el valor y solo se sabría que "falta".

**Errores del servidor junto al campo correcto.** `ErrorDeApi` ahora trae `campos`, y el formulario los
reparte:

```tsx
const CAMPO_DESDE_API = { nombre: "nombre", monto: "monto", fecha_proximo_cobro: "fechaProximoCobro",
                          fin_prueba: "finPrueba", moneda: "moneda", frecuencia: "frecuencia",
                          categoria: "categoria" };
// …
const { porCampo, general } = erroresDesdeServidor(erroresCampos, CAMPO_DESDE_API);
setErrores(porCampo);          // bajo cada campo
setErroresGenerales(general);  // lo que no es de ningún campo, arriba
```

---

## CH-16 — Avisar cambios sin guardar

**Detectar cambios.** Cada formulario compara con su valor inicial y avisa a `Homepage`:

```tsx
// NuevaSuscripcionForm: contra el formulario sin tocar, con los valores por defecto del catálogo.
// Que el catálogo complete moneda/categoría/frecuencia al cargar NO cuenta como cambio.
const hayCambios = !mismosDatos({ ...formData, moneda: formData.moneda || inicial.moneda, … }, inicial);
useEffect(() => { onCambiosSinGuardar?.(hayCambios); }, [hayCambios, onCambiosSinGuardar]);

// EditarSuscripcionForm: contra los datos con que se abrió
const [inicial] = useState(suscripcion);
const hayCambios = Object.keys(inicial).some((k) => formData[k] !== inicial[k]);
```

Volver a dejar un campo como estaba cuenta como "sin cambios".

**Preguntar antes de cerrar.** Cancelar, la X, Escape y el clic en el fondo pasan por la misma función:

```tsx
const intentarCerrarAgregar = useCallback(() => {
  if (hayCambiosSinGuardar.current) setConfirmandoDescarte(true);  // muestra el aviso
  else cerrarAgregar();                                           // limpio: cierra sin preguntar
}, [cerrarAgregar]);
```

| Acción | Resultado |
|---|---|
| Cerrar un formulario limpio | Se cierra, sin aviso |
| Cerrar con cambios | Aviso dentro del modal; el formulario sigue con todo lo escrito |
| "Seguir editando" | Quita el aviso y el foco vuelve a donde estaba |
| "Descartar cambios" | Cierra; al reabrir, el formulario está vacío |
| Atrás/Adelante o navegar dentro de la app con cambios | La navegación queda retenida (`useBlocker`) y sale el mismo aviso; "Descartar" la completa |
| Cerrar o recargar la pestaña con cambios | El navegador pide confirmación (`beforeunload`) |
| Guardar | Se limpia el estado: no queda ningún aviso pendiente |

**Por qué el estado está en una ref y no en `useState`:** el `Modal` vuelve a enfocar su primer campo
cada vez que cambia su función `alCerrar`. Si esa función dependiera de un estado "con cambios", la
primera tecla en cualquier campo te mandaría el cursor a "Servicio". Hay un test para eso.

El aviso va **dentro** del mismo modal, no como un segundo modal encima: así Escape y el foco siguen
siendo los de un solo diálogo, y el formulario queda montado detrás sin perder nada.

---

## CH-14 — Registrar minutos de uso

En la sección **"Uso"** del detalle (`RegistrarUsoForm.tsx`): minutos y día, con hoy propuesto por
defecto (el contrato admite otra fecha pasada).

```ts
// shared — mismos mensajes que RegistrarUsoSerializer
if (/^-/.test(texto) || /^0+$/.test(texto)) errores.minutos = 'Los minutos de uso no pueden ser negativos ni cero.';
else if (!/^\d+$/.test(texto)) errores.minutos = 'Los minutos deben ser un número entero válido.';
else if (Number(texto) > MINUTOS_MAXIMOS_USO) errores.minutos = 'Los minutos de uso no pueden superar el máximo mensual (44.640 minutos).';
// …
else if (datos.fecha > hoy) errores.fecha = 'No se puede registrar uso de una fecha futura.';
```

**Al registrar** (`SuscripcionDetallePage.tsx`):

```tsx
const actualizada = await registrarUso(id, { minutos, fecha });
if (idActual.current !== id) return;                       // se navegó a otra suscripción
setEstado({ tipo: 'listo', suscripcion: actualizada });     // horas del mes y costo por hora, al día
recargarHistorial();                                        // el registro aparece UNA vez
```

- **Se refleja una sola vez:** el historial se vuelve a pedir en vez de agregar la fila a mano, y un
  doble clic no registra dos veces.
- **Errores claros:** cero, negativo, decimal o fecha futura se marcan bajo su campo sin enviar; un
  error del servidor por campo va bajo ese campo; un 500 o la falta de red, arriba. Siempre se conserva
  lo escrito y se puede reintentar.

## CH-15 — Historial de uso por fecha

`getUsos(id)` en `shared` (`GET /suscripciones/<id>/uso/`) y la lista en `HistorialUso.tsx`:

```tsx
<ol aria-label="Historial de uso">
  {estado.usos.map((uso, i) => (
    <li key={`${uso.fecha}-${i}`}>
      <time dateTime={uso.fecha}>{formatearFecha(uso.fecha)}</time>   {/* 18 oct 2026 */}
      <span>{duracion(uso.minutos)}</span>                             {/* 1 h 30 min */}
    </li>
  ))}
</ol>
```

- **Orden y valores como la API:** del más reciente al más antiguo, tal como los manda el backend, sin
  agrupar ni recalcular.
- **Estados:** "Cargando el historial…", "Todavía no registras uso…" y un error con **Reintentar**.
- **No se mezclan suscripciones:** si navegas de un detalle a otro mientras algo carga, la respuesta
  tardía de la anterior se descarta (`cancelado` en el efecto y `idActual` al registrar).

Además, el detalle ahora se carga con `getSuscripcion(id)` (`GET /suscripciones/<id>/`). Antes bajaba
toda la lista y buscaba el id; el propio código tenía un TODO esperando ese endpoint.

---

## Contrato

```ts
// @ojoalgasto/shared
validarSuscripcion(datos): ErroresSuscripcion       // {} = se puede enviar
validarUso({ minutos, fecha }, hoy?): ErroresUso
parsearMonto(texto): { valor } | { error }
esFechaReal(iso): boolean · hoyLocalIso(): string
erroresDesdeServidor(campos, mapa): { porCampo, general }
getUsos(id): Promise<RegistroUso[]>                 // RegistroUso = { fecha, minutos }
registrarUso(id, { minutos, fecha? }): Promise<Suscripcion>
class ErrorDeApi { status; campos?: Record<string, string[]> }
```

## Tests

**shared:** 97 ✅ · **web:** 82 ✅

| Archivo | Tests | Qué cubre |
|---|---|---|
| `shared/src/validacionesSuscripcion.test.ts` | 48 | Montos, fechas y minutos verificados contra el backend; prueba; mensajes |
| `shared/src/api/suscripciones.test.ts` | +4 | `getUsos`, `registrarUso` con fecha, `ErrorDeApi.campos` |
| `web/src/components/subscriptions/NuevaSuscripcionForm.test.tsx` | 16 | CH-09 |
| `web/src/pages/Homepage.test.tsx` | 13 | CH-16 (con `StrictMode`, como la app) y errores del servidor de CH-09 |
| `web/src/pages/SuscripcionDetallePage.test.tsx` | 17 | CH-14 y CH-15 |

**Reglas UI = API:** se pasaron 35 casos (montos, fechas, minutos y fechas de uso) por el
`SubscriptionSerializer` y el `RegistrarUsoSerializer` reales y por las funciones de `shared`.
Coinciden 34. La diferencia es deliberada: el backend acepta `1e3` (= 1000) y la UI no, porque nadie
escribe así un monto y es la misma vía por la que `1e400` pasaba como infinito.

Cada arreglo se verificó quitándolo a propósito: en todos los casos falló al menos un test. La revisión
en el navegador encontró un error que los tests no veían (el foco tras "Seguir editando" se perdía con
`StrictMode`); se corrigió y ahora los tests montan la página con `StrictMode`.

## Cómo probarlo

```bash
npm ci && npm run typecheck && npm test && npm run build
```

Manual (`npm run dev`, con backend):
- Inicio → "Agregar suscripción" → "Guardar" vacío → errores bajo cada campo. Monto `0` o `1e400` → error.
- Escribir algo y apretar Escape → aviso; "Seguir editando" conserva lo escrito.
- Detalle de una suscripción → "Uso" → registrar `45` → aparece una vez en el historial y suben las horas del mes.

## Diferencias con el texto de las tarjetas

- **CH-09:** la UI rechaza la notación científica (`1e3`), que el backend acepta. Se agregó la casilla
  de período de prueba porque el formulario no tenía cómo indicarlo.
- **CH-16:** para retener Atrás/Adelante, `main.tsx` pasó de `BrowserRouter` a un *data router*
  (`createBrowserRouter`), que es donde funciona `useBlocker`. Las rutas siguen en `App.tsx`.
- **CH-14/15:** van en un solo commit porque comparten la sección "Uso" del detalle.

## Pendiente

- **Revisión por otra persona** (lo piden las cuatro tarjetas).
- **Siguientes:** VI-02 (orden en el servidor) ya entró a `main`, así que CH-11, CH-12 y CH-13 se pueden
  hacer juntas después de esta PR.

## Actualización con `main` (VI-10 y catálogos)

- **Conflictos resueltos:** `shared/src/api/suscripciones.ts` (los dos agregaron `fecha` al registro de
  uso; quedó una sola) y `NuevaSuscripcionForm.tsx` (catálogos de Maxi + validaciones por campo de CH-09
  + cambios sin guardar de CH-16 + casilla de prueba).
- **`horas_uso_mes` llega como texto desde VI-10** ("0.00", "0.50"). Antes no se convertía: "0.00" se
  mostraba como "0.00 h" en vez de "Sin registrar". Ahora `desdeLaApi` lo pasa a número y se muestra con
  coma ("0,5 h", `formatearHoras`).
- Los tests montan los formularios dentro de `CatalogosProvider`, como en la app.
