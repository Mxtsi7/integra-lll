# Frontend

Un workspace de npm con tres paquetes. La regla que lo ordena todo:

> **La lógica se escribe una vez en `shared/`. Las pantallas se escriben dos
> veces, una por cliente.**

| Paquete | Qué contiene | Quién |
|---|---|---|
| `shared/` | Cliente de API, tipos del dominio, formato es-CL, cálculos | Se toca de a poco y con aviso: lo usan los dos clientes |
| `web/` | React + Vite. Pantallas, rutas, estilos de la web | Frontend web |
| `movil/` | React Native + Expo. Pantallas, navegación, push | Frontend móvil |

Qué **no** se comparte, porque no se puede: componentes (`<div>` contra
`<View>`), estilos, navegación. Cada cliente hace su interfaz. Lo que sí se
comparte es todo lo que hay debajo: qué es una suscripción, cómo se formatea
un monto, cómo se calcula el costo por hora.

## Comandos

Desde `frontend/`:

```bash
npm install                     # una vez; instala los tres paquetes
npm run dev                     # la web en http://localhost:5173
npm test                        # las pruebas de shared
npm run typecheck               # TypeScript en todos los paquetes
```

Con Docker no hace falta nada de esto: `docker compose up -d frontend` desde
la raíz del repositorio, y la web queda en http://localhost:5173 con recarga
automática al editar.

## Datos de ejemplo

El servicio `subscriptions` todavía no expone endpoints. Mientras tanto,
`getSuscripciones()` devuelve los datos de `shared/src/api/ejemplo.ts`, que
cubren los cinco estados y varias categorías. Cuando el endpoint exista,
`USAR_DATOS_DE_EJEMPLO` pasa a `false` en `shared/src/api/suscripciones.ts` y
ninguna pantalla cambia.

## Nombres

Los del glosario (`docs/glosario.md`): **suscripción**, **proveedor**,
**cobro**, **uso**. Los campos de los datos van en `snake_case`, igual que
en la API y en el modelo de datos: `fecha_proximo_cobro`, no
`fechaProximoCobro`. Una sola forma de nombrar cada cosa, de la base a la
pantalla.
