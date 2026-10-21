# App móvil

Todavía no está creada. Este directorio reserva el lugar para que la
estructura del workspace sea la que describe el README de la raíz:
`web/`, `movil/` y `shared/`.

## Cómo crearla

Desde `frontend/`:

```bash
npx create-expo-app@latest movil --template blank-typescript
```

Después:

1. Agregar `"movil"` a `workspaces` en `frontend/package.json`.
2. Agregar `"@ojoalgasto/shared": "0.1.0"` a las dependencias de `movil/package.json`
   y correr `npm install` desde `frontend/`.
3. Metro (el empaquetador de Expo) no sigue enlaces simbólicos por defecto.
   En `movil/metro.config.js`:

   ```js
   const { getDefaultConfig } = require('expo/metro-config');
   const path = require('path');

   const config = getDefaultConfig(__dirname);
   const raiz = path.resolve(__dirname, '..');

   config.watchFolders = [raiz];
   config.resolver.nodeModulesPaths = [
     path.resolve(__dirname, 'node_modules'),
     path.resolve(raiz, 'node_modules'),
   ];

   module.exports = config;
   ```

4. Al arrancar la app, configurar la API una sola vez, igual que la web:

   ```ts
   import { configurarApi } from '@ojoalgasto/shared';
   configurarApi({ urlBase: process.env.EXPO_PUBLIC_API_URL });
   ```

## Qué va acá y qué no

Las pantallas, la navegación, los estilos y las notificaciones push. Nada de
lógica de dominio: el cliente de API, los tipos, el formato y los cálculos
están en `shared/` y se importan. Si un cálculo se necesita y no está, se
agrega en `shared/`, no acá.
