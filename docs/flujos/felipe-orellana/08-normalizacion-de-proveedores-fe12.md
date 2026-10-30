# FE-12 — Normalizar nombres de proveedores

**Qué hace.** Convierte lo que llega de un CSV o de un correo
(`NETFLIX.COM 1234 SANTIAGO CL`, `PAYPAL *SPOTIFY AB`, `Disney Plus`,
`APPLE.COM/BILL`) en una de tres cosas: un proveedor **reconocido** con su
nombre canónico y categoría, un nombre **ambiguo** con sus candidatos y sin
asignación, o un **desconocido**. Siempre conserva el texto original.

**Dónde está.** `services/connectors/connectors/normalizacion.py`, una función
pura: sin base, sin red, mismo texto → mismo resultado. Lo usan FE-09 (procesar
CSV) y FE-13 (leer correo).

**Cómo se usa.**

```python
from connectors.normalizacion import normalizar

r = normalizar("PAYPAL *NETFLIX.COM 1234 SANTIAGO CL")
r.resultado    # "reconocido"
r.proveedor    # "Netflix"
r.categoria    # "streaming"   (código del catálogo de subscriptions)
r.original     # "PAYPAL *NETFLIX.COM 1234 SANTIAGO CL"  (tal cual)
r.limpio       # "netflix"
r.regla        # "alias 'netflix'"

r = normalizar("APPLE.COM/BILL")
r.resultado    # "ambiguo"
r.proveedor    # None  ← no se inventa
r.candidatos   # ("Apple Music", "Apple TV+", "iCloud")
r.para_revision  # True: FE-09/FE-13 lo muestran sin asignar

r = normalizar("Gimnasio Pacific Fit")
r.resultado    # "desconocido"
```

## Las reglas, en orden

| # | Regla | Ejemplo |
|---|---|---|
| 1 | Sin tildes, minúsculas | `Música` → `musica` |
| 2 | Se quita el intermediario de pago **como prefijo** | `PAYPAL *SPOTIFY` → `spotify` |
| 3 | `+` → ` plus`; separadores (`* . _ / - , :`) → espacio | `Disney+` → `disney plus` |
| 4 | Se quita el ruido: dominios, formas jurídicas, países y ciudades, palabras de cartola, monedas, y los códigos con dígitos (salvo los que son parte de un nombre, como `365`) | `NETFLIX.COM 1234 SANTIAGO CL` → `netflix` |
| 5 | Se busca cada alias del catálogo como frase completa, **del más largo al más corto** | `amazon prime video` gana antes que `amazon` |

El catálogo son dos estructuras en el mismo archivo: `PROVEEDORES` (nombre
canónico, categoría, alias) y `AMBIGUOS` (palabras que calzan con varios, con
sus candidatos). Un alias no puede estar en dos proveedores ni ser ambiguo a la
vez: lo comprueba una prueba.

## Decisiones

- **Catálogo en código, no en la base.** El catálogo global `Proveedor` vive en
  el esquema de `subscriptions`, y connectors no consulta el esquema de otro
  servicio (ADR-002). Los nombres canónicos coinciden con los de allá para que
  FE-11 pueda enlazar por nombre al confirmar.
- **Ambiguo ≠ desconocido.** `APPLE.COM/BILL` no se asigna a ninguno de los
  tres Apple: se devuelven los candidatos y queda para revisión. Es el criterio
  "no fusionar proveedores ambiguos automáticamente".
- **El original se conserva siempre**, con sus espacios y mayúsculas. Es la
  trazabilidad mínima y lo que permite corregir el catálogo cuando un
  desconocido era una variante nueva.
- **El intermediario solo se quita como prefijo.** `PAYPAL *X` dice por dónde se
  pagó, no a quién; pero `Stripe Atlas` en medio de un nombre se respeta.

## Cómo probarlo

```bash
cd services/connectors
ESQUEMA_BD=connectors SECRET_KEY=x DEBUG=False CLAVES_CIFRADO=x pytest tests/test_normalizacion.py -q
```

80 pruebas: las variantes de cada proveedor, los ambiguos, los desconocidos,
cada regla de limpieza por separado y la coherencia del catálogo.

## Lo que NO hace

No aprende ni guarda alias nuevos: agregar una variante es una línea en
`PROVEEDORES` y una prueba. No consulta el catálogo de `subscriptions` ni lo
modifica. No decide categorías fuera de los códigos de `CategoriaSuscripcion`.
